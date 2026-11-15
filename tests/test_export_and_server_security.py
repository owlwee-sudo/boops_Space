"""Phase 1 checks from docs/fix-plan/03-security-privacy-and-native.md.

Run:  pytest tests/test_export_and_server_security.py
Covers: CSV formula neutralisation, NaN-free JSON, multi-section CSV export,
and the local API server's CSRF / input / info-leak guards.
"""
import csv
import io
import json
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.db import csv_safe, dumps_safe, init_db, save_emergency_event  # noqa: E402
from engine.export import export_astronaut_range  # noqa: E402
from engine.server import create_server  # noqa: E402


# --- export helpers ---------------------------------------------------------

@pytest.mark.parametrize("cell", ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"])
def test_formula_cells_are_neutralised(cell):
    assert csv_safe(cell) == "'" + cell


@pytest.mark.parametrize("cell", ["-1.5", "-3", "fatigue", 4.2, -7])
def test_numbers_and_plain_text_are_left_alone(cell):
    assert csv_safe(cell) == cell


def test_json_never_contains_nan_or_infinity():
    text = dumps_safe({"a": float("nan"), "b": [float("inf"), 1.0], "c": {"d": -float("inf")}})
    assert json.loads(text) == {"a": None, "b": [None, 1.0], "c": {"d": None}}


def test_csv_export_keeps_every_enabled_section(tmp_path):
    db_path = tmp_path / "m.db"
    init_db(db_path)
    save_emergency_event("A1", 92, "solar_radiation_storm", "critical", "=HYPERLINK(\"x\")", db_path=db_path)
    text = export_astronaut_range(
        "A1", 90, 95, {"daily_summary": True, "raw_data": True}, fmt="csv", db_path=db_path
    )
    rows = list(csv.DictReader(io.StringIO(text)))
    assert {r["section"] for r in rows} == {"emergency_events"}  # empty db: only the event
    assert rows[0]["summary"].startswith("'=")


# --- local API server -------------------------------------------------------

@pytest.fixture()
def server(tmp_path):
    db_path = tmp_path / "s.db"
    srv = create_server(host="127.0.0.1", port=0, web_dir=ROOT / "web", db_path=db_path)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield srv.server_address[1]
    srv.shutdown()
    srv.server_close()


def _post(port, path, body, headers=None):
    data = body if isinstance(body, bytes) else json.dumps(body).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method="POST")
    for k, v in (headers or {"Content-Type": "application/json"}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as err:
        return err.code


def test_health_does_not_leak_db_path(server):
    with urllib.request.urlopen(f"http://127.0.0.1:{server}/api/health") as resp:
        assert "db_path" not in json.loads(resp.read())


def test_cross_origin_post_is_refused(server):
    status = _post(
        server, "/api/sharing", {"raw_data": True},
        {"Content-Type": "application/json", "Origin": "https://attacker.example"},
    )
    assert status == 403


def test_text_plain_post_is_refused(server):
    assert _post(server, "/api/sharing", {"raw_data": True}, {"Content-Type": "text/plain"}) == 415


def test_same_origin_post_is_accepted(server):
    status = _post(
        server, "/api/log", {"mission_day": 5, "category": "sleep"},
        {"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{server}"},
    )
    assert status == 201


@pytest.mark.parametrize("day", [10**30, -1, 0, True, 2.5, "abc"])
def test_bad_mission_day_is_400(server, day):
    assert _post(server, "/api/log", {"mission_day": day}) == 400


def test_nan_in_json_is_400(server):
    assert _post(server, "/api/log", b'{"mission_day": 3, "x": NaN}') == 400


def test_directory_listing_is_off(server):
    with pytest.raises(urllib.error.HTTPError) as err:
        urllib.request.urlopen(f"http://127.0.0.1:{server}/assets/")
    assert err.value.code == 404
