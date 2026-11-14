import "./SleepCard.css";
import { h, setText } from "../../lib/dom";
import { formatDuration } from "../../lib/format";
import { icon } from "../../lib/icons";
import type { Sleep, SleepStages } from "../../types";
import { createStatusBadge } from "../StatusBadge/StatusBadge";

const STAGES: { key: keyof SleepStages; label: string }[] = [
  { key: "deep", label: "Deep" },
  { key: "light", label: "Light" },
  { key: "rem", label: "REM" },
  { key: "awake", label: "Awake" },
];

const SHORT_NIGHT = 360;

/** Last rest period broken into stages, plus the past 7 nights. */
export function createSleepCard() {
  const badge = createStatusBadge();
  const total = h("span", { class: "sleep-card__total num" });
  const target = h("span", { class: "sleep-card__target" });
  const bar = h("div", { class: "sleep-card__stages", role: "img" });
  const legend = h("div", { class: "sleep-card__legend" });
  const nights = h("div", { class: "sleep-card__nights", role: "img" });

  const el = h(
    "section",
    { class: "card sleep-card", id: "sleep" },
    h("div", { class: "card__header" }, h("h2", { class: "card__title" }, icon("moon", 16), "Sleep · last rest period"), badge.el),
    h("p", { class: "sleep-card__reading" }, total, target),
    bar,
    legend,
    h("div", { class: "sleep-card__week-label" }, h("span", null, "Last 7 nights"), h("span", null, "Target 8 h")),
    nights,
  );

  let signature = "";

  function update(sleep: Sleep, missionDay: number) {
    const key = `${missionDay}:${sleep.last7.join(",")}`;
    if (key === signature) return;
    signature = key;

    const short = sleep.lastMinutes < SHORT_NIGHT;
    badge.update(short ? "watch" : "nominal", short ? "Sleep debt" : "Rested");
    setText(total, formatDuration(sleep.lastMinutes));
    setText(target, `of ${formatDuration(sleep.targetMinutes)} target`);

    bar.replaceChildren(
      ...STAGES.map(({ key: stage }) =>
        h("span", { class: `sleep-card__stage sleep-card__stage--${stage}`, style: { flex: String(sleep.stages[stage]) } }),
      ),
    );
    bar.setAttribute("aria-label", STAGES.map((s) => `${s.label} ${formatDuration(sleep.stages[s.key])}`).join(", "));
    legend.replaceChildren(
      ...STAGES.map(({ key: stage, label }) =>
        h(
          "span",
          { class: "sleep-card__legend-item" },
          h("span", { class: `sleep-card__swatch sleep-card__stage--${stage}` }),
          label,
          h("strong", { class: "num" }, formatDuration(sleep.stages[stage])),
        ),
      ),
    );

    const max = Math.max(sleep.targetMinutes * 1.1, ...sleep.last7);
    nights.style.setProperty("--target", `${(sleep.targetMinutes / max) * 100}%`);
    nights.setAttribute("aria-label", `Sleep per night: ${sleep.last7.map(formatDuration).join(", ")}`);
    nights.replaceChildren(
      ...sleep.last7.map((minutes, i) =>
        h(
          "div",
          { class: "sleep-card__night", title: `Day ${missionDay - 6 + i}: ${formatDuration(minutes)}` },
          h("div", { class: "sleep-card__night-track" }, h("span", {
            class: `sleep-card__night-bar${minutes < SHORT_NIGHT ? " is-short" : ""}`,
            style: { height: `${(minutes / max) * 100}%` },
          })),
          h("span", { class: "sleep-card__night-label num" }, i === 6 ? "Last" : `D${missionDay - 6 + i}`),
        ),
      ),
    );
  }

  return { el, update };
}
