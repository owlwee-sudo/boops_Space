"""Optional local-only HTTP server for BOOPS offline static assets and SQLite sync.

Serves `/web` files on 127.0.0.1:8000 (configurable) and exposes zero-cloud
local endpoints backed by `data/mission.db`.
"""

from __future__ import annotations

import argparse
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
from typing import Any
from urllib.parse import urlparse

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from engine.db import (  # noqa: E402
    DEFAULT_DB_PATH,
    init_db,
    save_emergency_event,
    save_log_entry,
    save_sharing_settings,
)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEFAULT_WEB_DIR = ROOT_DIR / "web"
MAX_REQUEST_BYTES = 1024 * 1024  # 1 MiB safety cap for local JSON payloads
MAX_MISSION_DAY = 3650           # 10 years; anything bigger is a bad request
REQUEST_TIMEOUT_S = 15           # a slow or stuck client cannot hold a thread forever
LISTEN_BACKLOG = 64              # default is 5, which drops bursts of connections
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def _reject_constant(name: str) -> Any:
    """json.loads hook: NaN / Infinity are not valid JSON and are refused."""
    raise ValueError(f"{name} is not allowed")


def parse_mission_day(value: Any) -> int:
    """Strict mission day: a whole number from 1 to MAX_MISSION_DAY (no bools, no floats)."""
    if isinstance(value, bool):
        raise ValueError("mission_day must be a whole number")
    if isinstance(value, str) and value.strip().isdigit():
        value = int(value.strip())
    if not isinstance(value, int):
        raise ValueError("mission_day must be a whole number")
    if not 1 <= value <= MAX_MISSION_DAY:
        raise ValueError(f"mission_day must be between 1 and {MAX_MISSION_DAY}")
    return value


class BoopsHTTPServer(ThreadingHTTPServer):
    """Threaded server with a larger listen backlog so bursts do not reset sockets."""

    request_queue_size = LISTEN_BACKLOG
    daemon_threads = True


class BoopsRequestHandler(SimpleHTTPRequestHandler):
    """Serve static `/web` files and handle local SQLite API requests."""

    timeout = REQUEST_TIMEOUT_S

    def __init__(
        self,
        *args: Any,
        directory: str | None = None,
        db_path: Path | str = DEFAULT_DB_PATH,
        **kwargs: Any,
    ) -> None:
        self.db_path = Path(db_path)
        super().__init__(*args, directory=directory, **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Boops-Local-Api", "1")
        super().end_headers()

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def list_directory(self, path: Any) -> None:  # type: ignore[override]
        """No directory listings: they would reveal every file in /web."""
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")
        return None

    def _same_origin_ok(self) -> bool:
        """Allow writes only from this local server's own pages (blocks CSRF).

        The Host must be loopback. If the browser sends Origin (or, failing
        that, Referer) it must point at the same loopback host and port.
        """
        server_port = self.server.server_address[1]
        host_hdr = urlparse(f"http://{self.headers.get('Host', '')}")
        if host_hdr.hostname not in LOOPBACK_HOSTS:
            return False
        source = self.headers.get("Origin") or self.headers.get("Referer")
        if not source:
            return True  # non-browser local client (e.g. curl, tests)
        try:
            src = urlparse(source)
            src_port = src.port or (443 if src.scheme == "https" else 80)
        except ValueError:
            return False
        return src.scheme == "http" and src.hostname in LOOPBACK_HOSTS and src_port == server_port

    def _read_json_body(self) -> tuple[dict[str, Any] | None, tuple[int, str] | None]:
        raw_len = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_len)
        except ValueError:
            return None, (HTTPStatus.BAD_REQUEST, "Invalid Content-Length header.")

        if length < 0 or length > MAX_REQUEST_BYTES:
            # Do not read the oversized body; close the connection after replying.
            self.close_connection = True
            return None, (
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "Request payload exceeds local limit.",
            )

        raw_bytes = self.rfile.read(length)
        if not raw_bytes:
            return None, (HTTPStatus.BAD_REQUEST, "Empty JSON request body.")

        try:
            parsed = json.loads(raw_bytes.decode("utf-8"), parse_constant=_reject_constant)
        except (UnicodeDecodeError, ValueError):
            return None, (HTTPStatus.BAD_REQUEST, "Malformed UTF-8 or JSON payload.")

        if not isinstance(parsed, dict):
            return None, (HTTPStatus.BAD_REQUEST, "JSON body must be an object.")
        return parsed, None

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "offline": True,
                    "db_exists": self.db_path.exists(),
                },
            )
            return
        if path.startswith("/api/"):
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path not in {"/api/log", "/api/log_entries", "/api/sharing", "/api/emergency"}:
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})
            return

        if not self._same_origin_ok():
            self.close_connection = True
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "Cross-origin request refused."})
            return
        content_type = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if content_type != "application/json":
            self.close_connection = True
            self._send_json(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                {"ok": False, "error": "Content-Type must be application/json."},
            )
            return

        data, err = self._read_json_body()
        if err is not None or data is None:
            status, message = err or (HTTPStatus.BAD_REQUEST, "Invalid payload.")
            self._send_json(status, {"ok": False, "error": message})
            return

        try:
            if path in {"/api/log", "/api/log_entries"}:
                astronaut_id = str(data.get("astronaut_id") or "A1")
                mission_day = parse_mission_day(data.get("mission_day", data.get("day", 1)))
                category = str(data.get("category") or data.get("type") or "manual_log")
                payload = data.get("payload", data)
                created_utc = data.get("created_utc")
                row_id = save_log_entry(
                    astronaut_id=astronaut_id,
                    mission_day=mission_day,
                    category=category,
                    payload=payload,
                    created_utc=str(created_utc) if created_utc else None,
                    db_path=self.db_path,
                )
                self._send_json(HTTPStatus.CREATED, {"ok": True, "id": row_id})
                return

            if path == "/api/sharing":
                astronaut_id = str(data.get("astronaut_id") or "A1")
                daily_summary = bool(data.get("daily_summary", True))
                raw_data = bool(data.get("raw_data", False))
                sharing = save_sharing_settings(
                    astronaut_id=astronaut_id,
                    daily_summary=daily_summary,
                    raw_data=raw_data,
                    db_path=self.db_path,
                )
                self._send_json(HTTPStatus.OK, {"ok": True, "sharing": sharing})
                return

            # /api/emergency
            astronaut_id = str(data.get("astronaut_id") or "A1")
            mission_day = parse_mission_day(data.get("mission_day", data.get("day", 1)))
            protocol_id = str(data.get("protocol_id") or "general_emergency")
            severity = str(data.get("severity") or "critical")
            summary = str(data.get("summary") or "")
            created_utc = data.get("created_utc")
            row_id = save_emergency_event(
                astronaut_id=astronaut_id,
                mission_day=mission_day,
                protocol_id=protocol_id,
                severity=severity,
                summary=summary,
                created_utc=str(created_utc) if created_utc else None,
                db_path=self.db_path,
            )
            self._send_json(HTTPStatus.CREATED, {"ok": True, "id": row_id})
        except (TypeError, ValueError, OverflowError) as exc:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": f"Invalid request field: {exc}"},
            )


def create_server(
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    web_dir: Path | str = DEFAULT_WEB_DIR,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> BoopsHTTPServer:
    """Create the local-only BOOPS HTTP + SQLite server without blocking."""
    resolved_db = Path(db_path)
    init_db(resolved_db)
    resolved_web = Path(web_dir)
    handler = partial(
        BoopsRequestHandler,
        directory=str(resolved_web),
        db_path=resolved_db,
    )
    return BoopsHTTPServer((host, port), handler)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the offline BOOPS local web + SQLite server."
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help="Bind address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="TCP port (default 8000)")
    parser.add_argument("--web-dir", type=Path, default=DEFAULT_WEB_DIR, help="Static web directory")
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH, help="SQLite database path")
    args = parser.parse_args()

    server = create_server(
        host=args.host,
        port=args.port,
        web_dir=args.web_dir,
        db_path=args.db_path,
    )
    print(f"BOOPS local server listening at http://{args.host}:{args.port} (offline mode)")
    print(f"Serving {args.web_dir} | SQLite DB: {args.db_path}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down BOOPS local server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
