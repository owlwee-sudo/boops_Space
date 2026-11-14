import "./StatusBadge.css";
import { h, setText } from "../../lib/dom";
import { STATUS_LABEL } from "../../lib/vitals";
import type { Status } from "../../types";

/**
 * Coloured dot + "Nominal" / "Watch" / "Alert".
 * `pill` (default) has a tinted background; `plain` is just dot + text for tight spaces.
 */
export function createStatusBadge(initial: Status = "nominal", labelOverride?: string, variant: "pill" | "plain" = "pill") {
  const label = h("span", { class: "status-badge__label" });
  const el = h(
    "span",
    { class: `status-badge status-badge--${variant}` },
    h("span", { class: "status-badge__dot" }),
    label,
  );

  function update(status: Status, text = labelOverride ?? STATUS_LABEL[status]) {
    el.dataset.status = status;
    setText(label, text);
  }

  update(initial);
  return { el, update };
}
