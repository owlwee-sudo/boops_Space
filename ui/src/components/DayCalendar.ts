/**
 * Mission-day calendar dropdown.
 *
 * The "Day 47 / 180 · 2026-07-03" readout in every page header is a button. Tapping it opens a
 * month grid where each mission day (1-180) is a date you can pick. Days outside the mission are
 * greyed out. A small dot marks days where any risk indicator is Watch (amber) or Act (red).
 *
 * Plain DOM, no native <input type="date">, so it looks and works the same in the browser, the
 * PWA, the Android/iOS WebViews and the desktop app. Fully offline.
 */

import { ChevronDown, createElement } from "lucide";
import { h } from "../lib/dom";
import { getDataMode, loadPersonalProfile } from "../services/dataMode";
import { type BoopsBundle, getDailyRecord, getEngineDay } from "../services/boopsData";

const MAX_MISSION_DAY = 180;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type CrewId = "A1" | "A2" | "A3";

export interface DayCalendarOptions {
  getBundle: () => BoopsBundle | null;
  getContext: () => { astronautId: CrewId; missionDay: number };
  /** Mission day the "Today" button jumps to. */
  getTodayDay: () => number;
  onPick: (missionDay: number) => void;
}

export interface DayCalendar {
  /** The readout button that opens the calendar (sits between the ‹ › stepper buttons). */
  trigger: HTMLButtonElement;
  setLabel: (text: string) => void;
  open: () => void;
  close: (restoreFocus?: boolean) => void;
  isOpen: () => boolean;
  /** Re-render if open (crew or data changed). */
  refresh: () => void;
}

// Dates are handled as UTC midnight so daylight-saving changes never shift a day.
function parseIsoDate(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

function toIso(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10);
}

export function createDayCalendar(opts: DayCalendarOptions): DayCalendar {
  const trigger = h(
    "button",
    {
      type: "button",
      className: "boops-day-readout boops-day-trigger",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      title: "Pick a mission day from the calendar",
    },
  ) as HTMLButtonElement;
  const labelEl = h("span", { className: "boops-day-trigger-label" }, "Day 1 / 180");
  const caret = createElement(ChevronDown, {
    width: 14,
    height: 14,
    "stroke-width": 2,
    "aria-hidden": "true",
    class: "boops-day-trigger-caret",
  });
  trigger.append(labelEl, caret);

  const popover = h("div", {
    className: "boops-cal",
    role: "dialog",
    "aria-label": "Choose mission day",
    hidden: true,
  });

  let openState = false;
  /** First day of the month on screen (UTC ms). */
  let viewMonth = 0;
  /** Date that has keyboard focus inside the grid (UTC ms). */
  let focusDate = 0;

  /** UTC ms of mission day 1 for the current crew member. */
  function missionStart(): number {
    const { astronautId, missionDay } = opts.getContext();
    if (getDataMode() === "mine") {
      const start = parseIsoDate(loadPersonalProfile()?.missionStartDate);
      if (start != null) return start;
    }
    const bundle = opts.getBundle();
    const day1 = parseIsoDate(getDailyRecord(bundle, astronautId, 1)?.date);
    if (day1 != null) return day1;
    const current = parseIsoDate(getDailyRecord(bundle, astronautId, missionDay)?.date);
    if (current != null) return current - (missionDay - 1) * DAY_MS;
    // No dates known: count back from today.
    const now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - (missionDay - 1) * DAY_MS;
  }

  function dayForDate(start: number, utc: number): number {
    return Math.round((utc - start) / DAY_MS) + 1;
  }

  function monthStart(utc: number): number {
    const d = new Date(utc);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }

  function addMonths(utc: number, n: number): number {
    const d = new Date(utc);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
  }

  function riskLevel(day: number): "act" | "watch" | null {
    const { astronautId } = opts.getContext();
    const engine = getEngineDay(opts.getBundle(), astronautId, day);
    if (!engine) return null;
    const levels = Object.values(engine.risks).map((r) => r?.level);
    if (levels.includes("act")) return "act";
    if (levels.includes("watch")) return "watch";
    return null;
  }

  function render() {
    const { missionDay } = opts.getContext();
    const start = missionStart();
    const end = start + (MAX_MISSION_DAY - 1) * DAY_MS;
    const firstMonth = monthStart(start);
    const lastMonth = monthStart(end);
    const todayDay = opts.getTodayDay();
    const showRisk = getDataMode() !== "mine";

    const prev = h(
      "button",
      { type: "button", className: "boops-cal-nav", "aria-label": "Previous month", disabled: viewMonth <= firstMonth },
      "‹",
    );
    const next = h(
      "button",
      { type: "button", className: "boops-cal-nav", "aria-label": "Next month", disabled: viewMonth >= lastMonth },
      "›",
    );
    prev.addEventListener("click", () => {
      viewMonth = addMonths(viewMonth, -1);
      render();
    });
    next.addEventListener("click", () => {
      viewMonth = addMonths(viewMonth, 1);
      render();
    });

    const vm = new Date(viewMonth);
    const title = h("div", { className: "boops-cal-title", "aria-live": "polite" }, `${MONTHS[vm.getUTCMonth()]} ${vm.getUTCFullYear()}`);

    const grid = h("div", { className: "boops-cal-grid", role: "grid" });
    for (const wd of WEEKDAYS) grid.append(h("span", { className: "boops-cal-wd", "aria-hidden": "true" }, wd));

    // Monday-first offset.
    const offset = (new Date(viewMonth).getUTCDay() + 6) % 7;
    for (let i = 0; i < offset; i++) grid.append(h("span", { className: "boops-cal-blank" }));

    const daysInMonth = new Date(Date.UTC(vm.getUTCFullYear(), vm.getUTCMonth() + 1, 0)).getUTCDate();
    for (let dom = 1; dom <= daysInMonth; dom++) {
      const utc = Date.UTC(vm.getUTCFullYear(), vm.getUTCMonth(), dom);
      const day = dayForDate(start, utc);
      const inMission = day >= 1 && day <= MAX_MISSION_DAY;
      const level = inMission && showRisk ? riskLevel(day) : null;
      const classes = ["boops-cal-day"];
      if (!inMission) classes.push("is-out");
      if (inMission && day === missionDay) classes.push("is-selected");
      if (inMission && day === todayDay) classes.push("is-today");
      const cell = h(
        "button",
        {
          type: "button",
          className: classes.join(" "),
          disabled: !inMission,
          tabindex: utc === focusDate ? "0" : "-1",
          "data-utc": String(utc),
          "aria-pressed": inMission && day === missionDay ? "true" : "false",
          "aria-label": inMission
            ? `${toIso(utc)}, mission day ${day}${level ? `, ${level === "act" ? "Act" : "Watch"} risk` : ""}`
            : `${toIso(utc)}, outside mission`,
          title: inMission ? `Mission day ${day}` : undefined,
        },
        String(dom),
        level ? h("span", { className: `boops-cal-dot is-${level}`, "aria-hidden": "true" }) : null,
      );
      if (inMission) {
        cell.addEventListener("click", () => {
          opts.onPick(day);
          close(true);
        });
      }
      grid.append(cell);
    }

    const legend = h(
      "div",
      { className: "boops-cal-foot" },
      h("span", null, `Mission ${toIso(start)} → ${toIso(end)}`),
      showRisk
        ? h(
            "span",
            { className: "boops-cal-legend" },
            h("span", { className: "boops-cal-dot is-watch" }),
            "Watch",
            h("span", { className: "boops-cal-dot is-act" }),
            "Act",
          )
        : null,
    );

    popover.replaceChildren(
      h("div", { className: "boops-cal-head" }, prev, title, next),
      grid,
      legend,
    );
  }

  function focusCell() {
    const cell = popover.querySelector<HTMLButtonElement>(`[data-utc="${focusDate}"]`);
    cell?.focus();
  }

  function moveFocus(deltaDays: number) {
    const start = missionStart();
    const end = start + (MAX_MISSION_DAY - 1) * DAY_MS;
    focusDate = Math.max(start, Math.min(end, focusDate + deltaDays * DAY_MS));
    if (monthStart(focusDate) !== viewMonth) viewMonth = monthStart(focusDate);
    render();
    focusCell();
  }

  popover.addEventListener("keydown", (ev) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (ev.key in moves) {
      ev.preventDefault();
      moveFocus(moves[ev.key]);
    } else if (ev.key === "PageUp" || ev.key === "PageDown") {
      ev.preventDefault();
      moveFocus(ev.key === "PageUp" ? -30 : 30);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close(true);
    }
  });

  function position() {
    const r = trigger.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 32);
    popover.style.width = `${width}px`;
    let left = r.left + r.width / 2 - width / 2;
    left = Math.max(16, Math.min(window.innerWidth - width - 16, left));
    popover.style.left = `${left}px`;
    const below = r.bottom + 8;
    const height = popover.offsetHeight || 340;
    const top = below + height > window.innerHeight - 8 && r.top - 8 - height > 8 ? r.top - 8 - height : below;
    popover.style.top = `${top}px`;
  }

  function onOutside(ev: Event) {
    const t = ev.target as Node;
    if (popover.contains(t) || trigger.contains(t)) return;
    close(false);
  }

  function onViewportChange() {
    if (openState) position();
  }

  function open() {
    if (openState) return;
    const { missionDay } = opts.getContext();
    const start = missionStart();
    focusDate = start + (missionDay - 1) * DAY_MS;
    viewMonth = monthStart(focusDate);
    if (!popover.isConnected) document.body.append(popover);
    render();
    popover.hidden = false;
    openState = true;
    trigger.setAttribute("aria-expanded", "true");
    position();
    focusCell();
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
  }

  function close(restoreFocus = false) {
    if (!openState) return;
    openState = false;
    popover.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
    if (restoreFocus && trigger.isConnected) trigger.focus();
  }

  trigger.addEventListener("click", () => (openState ? close(false) : open()));

  return {
    trigger,
    setLabel: (text) => {
      labelEl.textContent = text;
    },
    open,
    close,
    isOpen: () => openState,
    refresh: () => {
      if (openState) render();
    },
  };
}
