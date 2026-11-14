import "./Sparkline.css";
import { h, nextId, observeWidth, s } from "../../lib/dom";

interface SparklineOptions {
  height?: number;
  /** Smallest y-span drawn, so sensor noise doesn't look like a big swing. */
  minSpan?: number;
  label?: string;
}

/**
 * Small live line chart. Colour comes from the `--metric` CSS variable of
 * the parent, so the same component works for every vital.
 */
export function createSparkline({ height = 44, minSpan = 0, label }: SparklineOptions = {}) {
  const gradientId = nextId("spark-grad");
  const svgEl = s("svg", { class: "sparkline__svg", height, role: "img", "aria-label": label ?? "Trend" });
  const el = h("div", { class: "sparkline", style: { height: `${height}px` } }, svgEl);

  let values: number[] = [];
  let width = 0;

  function render() {
    if (!width || values.length < 2) return;
    const pad = 4;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, minSpan) || 1;
    const lo = (min + max) / 2 - span / 2;
    const x = (i: number) => (i / (values.length - 1)) * (width - pad * 2) + pad;
    const y = (v: number) => height - pad - ((v - lo) / span) * (height - pad * 2);

    const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const line = `M${points.join("L")}`;
    const area = `${line}L${x(values.length - 1).toFixed(1)},${height}L${x(0).toFixed(1)},${height}Z`;
    const lastX = x(values.length - 1);
    const lastY = y(values[values.length - 1]);

    svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svgEl.setAttribute("width", String(width));
    svgEl.replaceChildren(
      s(
        "defs",
        null,
        s(
          "linearGradient",
          { id: gradientId, x1: 0, y1: 0, x2: 0, y2: 1 },
          s("stop", { offset: "0%", class: "sparkline__stop-top" }),
          s("stop", { offset: "100%", class: "sparkline__stop-bottom" }),
        ),
      ),
      s("path", { d: area, fill: `url(#${gradientId})` }),
      s("path", { d: line, class: "sparkline__line" }),
      s("circle", { cx: lastX, cy: lastY, r: 6, class: "sparkline__halo" }),
      s("circle", { cx: lastX, cy: lastY, r: 2.75, class: "sparkline__dot" }),
    );
  }

  observeWidth(el, (w) => {
    width = w;
    render();
  });

  function update(next: number[]) {
    values = next;
    render();
  }

  return { el, update };
}
