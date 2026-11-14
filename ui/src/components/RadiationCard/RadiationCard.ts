import "./RadiationCard.css";
import { h, setText } from "../../lib/dom";
import { icon } from "../../lib/icons";
import type { Radiation, SpaceWeather, Status } from "../../types";
import { createStatusBadge } from "../StatusBadge/StatusBadge";

const WEATHER: Record<SpaceWeather, [Status, string]> = {
  quiet: ["nominal", "Space weather quiet"],
  elevated: ["watch", "Solar activity elevated"],
  storm: ["alert", "Solar particle event"],
};

/** Cumulative dose against the career limit, plus today's rate. */
export function createRadiationCard() {
  const weather = createStatusBadge();
  const total = h("span", { class: "radiation-card__total num" });
  const share = h("p", { class: "radiation-card__share" });
  const fill = h("div", { class: "radiation-card__fill" });
  const today = h("span", { class: "radiation-card__stat-value num" });
  const avg = h("span", { class: "radiation-card__stat-value num" });
  const remaining = h("span", { class: "radiation-card__stat-value num" });

  const stat = (label: string, value: HTMLElement) =>
    h("div", { class: "radiation-card__stat" }, h("span", { class: "radiation-card__stat-label" }, label), value);

  const projected = h("span", { class: "radiation-card__projected" });
  const projectedText = h("span", { class: "num" });
  const scale = h("div", { class: "radiation-card__scale num" });

  const meter = h(
    "div",
    { class: "radiation-card__meter", role: "meter", "aria-valuemin": 0, "aria-label": "Share of career dose limit" },
    h("div", { class: "radiation-card__track" }, fill, [25, 50, 75].map((p) => h("span", { class: "radiation-card__tick", style: { left: `${p}%` } }))),
    projected,
  );

  const legend = h(
    "div",
    { class: "radiation-card__legend" },
    h("span", { class: "radiation-card__legend-item" }, h("span", { class: "radiation-card__key radiation-card__key--now" }), "To date"),
    h(
      "span",
      { class: "radiation-card__legend-item" },
      h("span", { class: "radiation-card__key radiation-card__key--projected" }),
      "End of mission ",
      projectedText,
    ),
  );

  const el = h(
    "section",
    { class: "card radiation-card", id: "radiation" },
    h("div", { class: "card__header" }, h("h2", { class: "card__title" }, icon("radiation", 16), "Radiation dose"), weather.el),
    h("p", { class: "radiation-card__reading" }, total, h("span", { class: "radiation-card__unit" }, "mSv cumulative")),
    share,
    meter,
    scale,
    legend,
    h("div", { class: "radiation-card__stats" }, stat("Today", today), stat("Daily avg", avg), stat("Days to limit", remaining)),
  );

  let scaleFor = 0;

  function update(r: Radiation) {
    const pct = (r.cumulativeMsv / r.careerLimitMsv) * 100;
    const [status, label] = WEATHER[r.spaceWeather];
    weather.update(status, label);
    setText(total, r.cumulativeMsv.toFixed(1));
    setText(share, `${pct.toFixed(1)}% of the ${r.careerLimitMsv} mSv career limit`);
    fill.style.width = `${Math.min(pct, 100)}%`;
    projected.style.left = `${Math.min((r.projectedMissionMsv / r.careerLimitMsv) * 100, 100)}%`;
    setText(projectedText, `≈ ${r.projectedMissionMsv.toFixed(0)} mSv`);
    if (scaleFor !== r.careerLimitMsv) {
      scaleFor = r.careerLimitMsv;
      scale.replaceChildren(...[0, 0.25, 0.5, 0.75, 1].map((f) => h("span", null, String(Math.round(f * r.careerLimitMsv)))));
    }
    meter.setAttribute("aria-valuemax", String(r.careerLimitMsv));
    meter.setAttribute("aria-valuenow", r.cumulativeMsv.toFixed(1));
    el.dataset.level = pct >= 80 ? "alert" : pct >= 50 ? "watch" : "nominal";
    setText(today, `${r.todayMsv.toFixed(2)} mSv`);
    setText(avg, `${r.dailyAvgMsv.toFixed(2)} mSv`);
    setText(remaining, `≈ ${Math.floor((r.careerLimitMsv - r.cumulativeMsv) / r.dailyAvgMsv)}`);
  }

  return { el, update };
}
