import "./AlertsPanel.css";
import { h, setText } from "../../lib/dom";
import { formatAgo } from "../../lib/format";
import { icon } from "../../lib/icons";
import type { Alert } from "../../types";

type Tab = "active" | "acknowledged";

export interface AlertsPanelOptions {
  onAcknowledge: (id: string) => void;
  onSelectCrew: (crewId: string) => void;
}

/** Mission-wide alert feed with Active / Acknowledged tabs. */
export function createAlertsPanel({ onAcknowledge, onSelectCrew }: AlertsPanelOptions) {
  let tab: Tab = "active";
  let alerts: Alert[] = [];
  let acknowledged = new Set<string>();
  let signature = "";

  const count = h("span", { class: "alerts-panel__count num" });
  const activeTab = h("button", { class: "segmented__item", type: "button", onClick: () => setTab("active") });
  const ackTab = h("button", { class: "segmented__item", type: "button", onClick: () => setTab("acknowledged") });
  const list = h("ul", { class: "alerts-panel__list", "aria-live": "polite" });

  const el = h(
    "section",
    { class: "card alerts-panel", id: "alerts" },
    h("div", { class: "card__header" }, h("h2", { class: "card__title" }, icon("bell", 16), "Alerts", count)),
    h("div", { class: "segmented alerts-panel__tabs", role: "group", "aria-label": "Alert filter" }, activeTab, ackTab),
    list,
  );

  function setTab(next: Tab) {
    tab = next;
    signature = "";
    render();
  }

  function renderItem(alert: Alert, isAcked: boolean) {
    const canSelect = alert.crewId !== "all";
    const body = h(
      canSelect ? "button" : "div",
      {
        class: "alerts-panel__body",
        ...(canSelect ? { type: "button", onClick: () => onSelectCrew(alert.crewId), title: "Show this crew member" } : {}),
      },
      h("span", { class: "alerts-panel__title" }, alert.title),
      h("span", { class: "alerts-panel__detail" }, alert.detail),
      h("span", { class: "alerts-panel__time" }, icon("clock", 12), formatAgo(alert.minutesAgo)),
    );

    return h(
      "li",
      { class: "alerts-panel__item", "data-severity": alert.severity },
      h("span", { class: "alerts-panel__icon" }, icon("warning", 16)),
      body,
      isAcked
        ? h("span", { class: "alerts-panel__acked" }, icon("check", 14, 2), "Ack’d")
        : h(
            "button",
            {
              class: "alerts-panel__ack",
              type: "button",
              onClick: () => onAcknowledge(alert.id),
              "aria-label": `Acknowledge: ${alert.title}`,
            },
            icon("check", 14, 2),
            "Ack",
          ),
    );
  }

  function render() {
    const active = alerts.filter((a) => !acknowledged.has(a.id));
    const acked = alerts.filter((a) => acknowledged.has(a.id));
    setText(count, String(active.length));
    count.dataset.empty = String(active.length === 0);
    setText(activeTab, `Active · ${active.length}`);
    setText(ackTab, `Acknowledged · ${acked.length}`);
    activeTab.setAttribute("aria-pressed", String(tab === "active"));
    ackTab.setAttribute("aria-pressed", String(tab === "acknowledged"));

    const shown = tab === "active" ? active : acked;
    // Re-render only when the visible content changes (keeps hover/focus stable).
    const next = `${tab}|${shown.map((a) => `${a.id}:${a.severity}:${a.detail}:${Math.floor(a.minutesAgo)}`).join("|")}`;
    if (next === signature) return;
    signature = next;

    if (shown.length === 0) {
      list.replaceChildren(
        h(
          "li",
          { class: "alerts-panel__empty" },
          icon("circleCheck", 22),
          h("span", null, tab === "active" ? "All clear — no active alerts" : "Nothing acknowledged yet"),
        ),
      );
      return;
    }
    list.replaceChildren(...shown.map((a) => renderItem(a, tab === "acknowledged")));
  }

  function update(next: Alert[], ackedIds: Set<string>) {
    alerts = next;
    acknowledged = ackedIds;
    render();
  }

  return { el, update };
}
