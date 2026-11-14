import "./VitalCard.css";
import { h, setText } from "../../lib/dom";
import { formatSigned } from "../../lib/format";
import { icon } from "../../lib/icons";
import { VITALS, formatRange, formatVital } from "../../lib/vitals";
import type { Vital, VitalKey } from "../../types";
import { createSparkline } from "../Sparkline/Sparkline";
import { createStatusBadge } from "../StatusBadge/StatusBadge";

/** Minimum sparkline y-span per vital, so noise stays visually small. */
const MIN_SPAN: Record<VitalKey, number> = {
  heartRate: 12,
  spo2: 2,
  temperature: 0.4,
  bloodPressure: 12,
  respiration: 4,
};

/** One live vital sign: value, change vs last hour, 10-minute sparkline. */
export function createVitalCard(key: VitalKey) {
  const meta = VITALS[key];
  const badge = createStatusBadge("nominal", undefined, "plain");
  const value = h("span", { class: "vital-card__value num" });
  const deltaIcon = h("span", { class: "vital-card__delta-icon" });
  const deltaText = h("span", { class: "num" });
  const delta = h("p", { class: "vital-card__delta" }, deltaIcon, deltaText);
  const sparkline = createSparkline({ height: 44, minSpan: MIN_SPAN[key], label: `${meta.label}, last 10 minutes` });

  const el = h(
    "article",
    { class: "card vital-card", style: { "--metric": meta.color } },
    h(
      "header",
      { class: "vital-card__header" },
      h("span", { class: "vital-card__icon" }, icon(meta.icon, 16)),
      h("h3", { class: "vital-card__label" }, meta.label),
    ),
    h("p", { class: "vital-card__reading" }, value, h("span", { class: "vital-card__unit" }, meta.unit)),
    delta,
    sparkline.el,
    h(
      "footer",
      { class: "vital-card__footer" },
      badge.el,
      h(
        "span",
        { class: "vital-card__range num", title: "Normal range" },
        meta.normalSecondary ? formatRange(meta) : `${formatRange(meta)} ${meta.unit}`,
      ),
    ),
  );

  let lastDirection = "";

  function update(vital: Vital) {
    el.dataset.status = vital.status;
    badge.update(vital.status);
    setText(value, formatVital(vital));

    const decimals = meta.decimals;
    const rounded = Number(vital.deltaVsHour.toFixed(decimals));
    const direction = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
    if (direction !== lastDirection) {
      deltaIcon.replaceChildren(icon(direction === "up" ? "arrowUp" : direction === "down" ? "arrowDown" : "minus", 13, 2));
      lastDirection = direction;
    }
    delta.dataset.direction = direction;
    setText(deltaText, `${formatSigned(vital.deltaVsHour, decimals)} vs 1 h avg`);
    sparkline.update(vital.history);
  }

  return { el, update };
}
