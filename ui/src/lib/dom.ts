// Tiny DOM helpers so components stay plain TypeScript (no framework).

type Child = Node | string | number | null | undefined | false;
type Children = (Child | Child[])[];
type Attrs = Record<string, unknown>;

const SVG_NS = "http://www.w3.org/2000/svg";

function toKebabCase(prop: string): string {
  return prop.startsWith("--") ? prop : prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function applyAttrs(el: Element, attrs: Attrs | null) {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class" || key === "className") {
      el.setAttribute("class", String(value));
    } else if (key === "htmlFor") {
      el.setAttribute("for", String(value));
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(value as Record<string, string | number>)) {
        if (v == null) continue;
        (el as HTMLElement).style.setProperty(toKebabCase(prop), String(v));
      }
    } else if (key === "style" && typeof value === "string") {
      (el as HTMLElement).style.cssText = value;
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

function appendChildren(el: Element, children: Children) {
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

/** Create an HTML element: h("div", { class: "card" }, "Hello"). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Children
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

/** Create an SVG element in the SVG namespace. */
export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Children
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

/** Set text only when it changed, so live updates don't thrash the DOM. */
export function setText(el: Element, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

/** Call `cb` with the element's content width now and whenever it resizes. */
export function observeWidth(el: Element, cb: (width: number) => void) {
  let last = -1;
  const ro = new ResizeObserver((entries) => {
    const width = Math.round(entries[0].contentRect.width);
    if (width !== last && width > 0) {
      last = width;
      cb(width);
    }
  });
  ro.observe(el);
  return () => ro.disconnect();
}

let uid = 0;
/** Unique id for SVG gradients and aria links. */
export function nextId(prefix: string) {
  uid += 1;
  return `${prefix}-${uid}`;
}
