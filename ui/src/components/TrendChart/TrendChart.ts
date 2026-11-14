import "./TrendChart.css";
import { h, nextId, observeWidth, s, setText } from "../../lib/dom";
import { icon } from "../../lib/icons";
import { VITALS, VITAL_ORDER } from "../../lib/vitals";
import type { TrendSeries, VitalKey } from "../../types";

const HEIGHT = 248;
const PAD = { top: 12, right: 12, bottom: 28, left: 44 };
const STEP_SECONDS = 1800;

function niceStep(rough: number) {
  const power = 10 ** Math.floor(Math.log10(rough));
  const n = rough / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
}

function clock(unixSeconds: number) {
  const d = new Date(unixSeconds * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 24-hour trend for one vital, with the normal range shaded and a hover readout. */
export function createTrendChart({ onMetricChange }: { onMetricChange: (key: VitalKey) => void }) {
  const gradientId = nextId("trend-grad");
  const subtitle = h("p", { class: "card__subtitle" });

  const tabs = new Map<VitalKey, HTMLButtonElement>();
  const segmented = h(
    "div",
    { class: "segmented", role: "group", "aria-label": "Vital sign" },
    VITAL_ORDER.map((key) => {
      const button = h(
        "button",
        { class: "segmented__item", type: "button", "aria-pressed": "false", onClick: () => onMetricChange(key) },
        VITALS[key].short,
      );
      tabs.set(key, button);
      return button;
    }),
  );

  const stats = h("div", { class: "trend-chart__stats" });
  const svgEl = s("svg", { class: "trend-chart__svg", height: HEIGHT, role: "img" });
  const tooltip = h("div", { class: "trend-chart__tooltip", hidden: true });
  const plot = h("div", { class: "trend-chart__plot" }, svgEl, tooltip);
  const primaryLabel = h("span", null);
  const secondaryKey = h(
    "span",
    { class: "trend-chart__legend-item" },
    h("span", { class: "trend-chart__key trend-chart__key--dashed" }),
    "Diastolic",
  );
  const legend = h(
    "div",
    { class: "trend-chart__legend" },
    h("span", { class: "trend-chart__legend-item" }, h("span", { class: "trend-chart__key trend-chart__key--line" }), primaryLabel),
    secondaryKey,
    h("span", { class: "trend-chart__legend-item" }, h("span", { class: "trend-chart__key trend-chart__key--band" }), "Normal range"),
    h("span", { class: "trend-chart__legend-hint" }, "Hover the chart for exact readings"),
  );

  const el = h(
    "section",
    { class: "card trend-chart", id: "trends" },
    h(
      "div",
      { class: "card__header trend-chart__header" },
      h("div", null, h("h2", { class: "card__title" }, icon("chart", 16), "Trends · last 24 h"), subtitle),
      segmented,
    ),
    stats,
    plot,
    legend,
  );

  let width = 0;
  let series: TrendSeries | undefined;
  let nowUnix = 0;
  let hoverIndex: number | null = null;

  function geometry() {
    if (!series) return null;
    const meta = VITALS[series.key];
    const all = [...series.values, ...(series.secondary ?? [])];
    const [nlo, nhi] = meta.normal;
    const bandLo = meta.normalSecondary ? meta.normalSecondary[0] : nlo;
    let min = Math.min(...all, bandLo);
    let max = Math.max(...all, nhi);
    const padY = (max - min) * 0.08 || 1;
    min -= padY;
    max += padY;
    const step = niceStep((max - min) / 4);
    min = Math.floor(min / step) * step;
    max = Math.ceil(max / step) * step;

    const innerW = width - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const n = series.values.length;
    const x = (i: number) => PAD.left + (i / (n - 1)) * innerW;
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * innerH;
    return { meta, min, max, step, x, y, n, innerW };
  }

  function linePath(values: number[], x: (i: number) => number, y: (v: number) => number) {
    return `M${values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("L")}`;
  }

  function render() {
    const g = geometry();
    if (!g || !series || width < 100) return;
    const { meta, min, max, step, x, y, n } = g;
    const decimals = meta.decimals;

    const grid: SVGElement[] = [];
    for (let v = min; v <= max + step / 2; v += step) {
      grid.push(
        s("line", { x1: PAD.left, x2: width - PAD.right, y1: y(v), y2: y(v), class: "trend-chart__grid" }),
        s("text", { x: PAD.left - 10, y: y(v) + 4, class: "trend-chart__axis", "text-anchor": "end" }, v.toFixed(step < 1 ? 1 : 0)),
      );
    }
    for (let i = 0; i < n; i += 8) {
      const t = nowUnix - (n - 1 - i) * STEP_SECONDS;
      grid.push(s("text", { x: x(i), y: HEIGHT - 8, class: "trend-chart__axis", "text-anchor": "middle" }, clock(t)));
    }
    grid.push(s("text", { x: x(n - 1), y: HEIGHT - 8, class: "trend-chart__axis trend-chart__axis--now", "text-anchor": "end" }, "Now"));

    const band = (lo: number, hi: number, cls: string) =>
      s("rect", {
        x: PAD.left,
        width: width - PAD.left - PAD.right,
        y: y(Math.min(hi, max)),
        height: Math.max(0, y(Math.max(lo, min)) - y(Math.min(hi, max))),
        class: cls,
      });

    const primaryLine = linePath(series.values, x, y);
    const area = `${primaryLine}L${x(n - 1)},${y(min)}L${x(0)},${y(min)}Z`;
    const children: SVGElement[] = [
      s(
        "defs",
        null,
        s(
          "linearGradient",
          { id: gradientId, x1: 0, y1: 0, x2: 0, y2: 1 },
          s("stop", { offset: "0%", class: "trend-chart__stop-top" }),
          s("stop", { offset: "100%", class: "trend-chart__stop-bottom" }),
        ),
      ),
      band(meta.normal[0], meta.normal[1], "trend-chart__band"),
      ...(meta.normalSecondary ? [band(meta.normalSecondary[0], meta.normalSecondary[1], "trend-chart__band trend-chart__band--secondary")] : []),
      ...grid,
      s("path", { d: area, fill: `url(#${gradientId})` }),
    ];
    if (series.secondary) {
      children.push(s("path", { d: linePath(series.secondary, x, y), class: "trend-chart__line trend-chart__line--secondary" }));
    }
    children.push(s("path", { d: primaryLine, class: "trend-chart__line" }));

    if (hoverIndex != null) {
      const i = hoverIndex;
      children.push(s("line", { x1: x(i), x2: x(i), y1: PAD.top, y2: HEIGHT - PAD.bottom, class: "trend-chart__crosshair" }));
      if (series.secondary) children.push(s("circle", { cx: x(i), cy: y(series.secondary[i]), r: 4, class: "trend-chart__point trend-chart__point--secondary" }));
      children.push(s("circle", { cx: x(i), cy: y(series.values[i]), r: 4.5, class: "trend-chart__point" }));

      const reading = series.secondary
        ? `${series.values[i].toFixed(0)}/${series.secondary[i].toFixed(0)}`
        : series.values[i].toFixed(decimals);
      tooltip.replaceChildren(
        h("span", { class: "trend-chart__tooltip-time" }, `${clock(nowUnix - (n - 1 - i) * STEP_SECONDS)} GMT`),
        h("span", { class: "trend-chart__tooltip-value num" }, reading, h("small", null, ` ${meta.unit}`)),
      );
      tooltip.hidden = false;
      const left = Math.min(Math.max(x(i), 70), width - 70);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(y(series.values[i]) - 58, 0)}px`;
    } else {
      tooltip.hidden = true;
    }

    svgEl.setAttribute("viewBox", `0 0 ${width} ${HEIGHT}`);
    svgEl.setAttribute("width", String(width));
    svgEl.setAttribute("aria-label", `${meta.label} over the last 24 hours`);
    svgEl.replaceChildren(...children);
  }

  function renderStats() {
    if (!series) return;
    const meta = VITALS[series.key];
    const values = series.values;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const outside = values.filter((v) => v < meta.normal[0] || v > meta.normal[1]).length;
    const fmt = (v: number) => v.toFixed(meta.decimals);
    const stat = (label: string, value: string) =>
      h("div", { class: "trend-chart__stat" }, h("span", { class: "trend-chart__stat-label" }, label), h("span", { class: "trend-chart__stat-value num" }, value));
    stats.replaceChildren(
      stat("Average", `${fmt(avg)} ${meta.unit}`),
      stat("Low", `${fmt(Math.min(...values))}`),
      stat("High", `${fmt(Math.max(...values))}`),
      stat("Out of range", `${Math.round((outside / values.length) * 100)}% of day`),
    );
  }

  svgEl.addEventListener("pointermove", (event) => {
    const g = geometry();
    if (!g) return;
    const rect = svgEl.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const i = Math.round(((px - PAD.left) / g.innerW) * (g.n - 1));
    const next = Math.min(Math.max(i, 0), g.n - 1);
    if (next !== hoverIndex) {
      hoverIndex = next;
      render();
    }
  });
  svgEl.addEventListener("pointerleave", () => {
    hoverIndex = null;
    render();
  });

  observeWidth(plot, (w) => {
    width = w;
    render();
  });

  function update(next: TrendSeries, crewName: string, now: number) {
    series = next;
    nowUnix = now;
    el.style.setProperty("--metric", VITALS[next.key].color);
    setText(subtitle, `${crewName} · ${VITALS[next.key].label}`);
    setText(primaryLabel, next.secondary ? "Systolic" : VITALS[next.key].label);
    secondaryKey.hidden = !next.secondary;
    for (const [key, tab] of tabs) tab.setAttribute("aria-pressed", String(key === next.key));
    renderStats();
    render();
  }

  return { el, update };
}
