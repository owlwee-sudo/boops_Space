import "./TopBar.css";
import { h, setText } from "../../lib/dom";
import { formatMet } from "../../lib/format";
import { icon } from "../../lib/icons";
import type { MissionSnapshot } from "../../types";

export function createTopBar({ onAlertsClick }: { onAlertsClick: () => void }) {
  const eyebrow = h("p", { class: "topbar__eyebrow" });
  const met = h("span", { class: "topbar__met-value num" }, "000:00:00:00");
  const sourceText = h("span", null);
  const source = h("span", { class: "topbar__source" }, h("span", { class: "topbar__source-dot" }), sourceText);
  const bellCount = h("span", { class: "topbar__bell-count num", hidden: true });
  const bell = h(
    "button",
    { class: "topbar__icon-button", type: "button", "aria-label": "Show alerts", onClick: onAlertsClick },
    icon("bell", 18),
    bellCount,
  );

  const el = h(
    "header",
    { class: "topbar" },
    h("div", { class: "topbar__heading" }, eyebrow, h("h1", { class: "topbar__title" }, "Crew health overview")),
    h(
      "div",
      { class: "topbar__actions" },
      h(
        "div",
        { class: "topbar__met", title: "Mission elapsed time (days:hours:minutes:seconds)" },
        h("span", { class: "topbar__met-label" }, "MET"),
        met,
      ),
      source,
      bell,
      h("span", { class: "topbar__avatar", title: "Flight surgeon on console" }, "FS"),
    ),
  );

  function update(snapshot: MissionSnapshot, activeAlerts: number) {
    setText(eyebrow, `${snapshot.missionName} · Mission day ${snapshot.missionDay} · ${snapshot.crew.length} crew aboard`);
    source.dataset.source = snapshot.source;
    setText(sourceText, snapshot.source === "rust" ? "Live · Rust core" : "Simulated · browser");
    bellCount.hidden = activeAlerts === 0;
    setText(bellCount, String(activeAlerts));
    bell.setAttribute("aria-label", `Show alerts (${activeAlerts} active)`);
  }

  function setMet(seconds: number) {
    setText(met, formatMet(seconds));
  }

  return { el, update, setMet };
}
