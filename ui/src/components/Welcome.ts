/**
 * First-launch welcome flow and the "My data" empty state.
 *
 * Welcome steps:
 *   1. What BOOPS is (offline, own baseline, not a medical device)
 *   2. Choose: Try the demo (simulated mission) or Start with my data
 *   3. (My data only) Name, role and today's mission day. Stays on this device.
 *
 * The empty state replaces data screens in "My data" mode until there is an
 * engine run for the user's own readings, so no simulated numbers ever show.
 */

import "./Welcome.css";
import { h } from "../lib/dom";
import {
  type DataMode,
  loadPersonalProfile,
  markWelcomeComplete,
  savePersonalProfile,
  setDataMode,
  startDateForMissionDay,
} from "../services/dataMode";

export interface WelcomeOptions {
  /** Mode chosen on the landing page; skips the choice step. */
  preselected?: DataMode | null;
  /** Start straight at the choice step (used by "Switch data" in the app). */
  startAtChoice?: boolean;
  /** Allows closing without choosing (only when a mode already exists). */
  dismissible?: boolean;
  onDone: (mode: DataMode) => void;
}

const BASELINE_DAYS = 14;

function icon(paths: string): HTMLElement {
  const span = h("span", { className: "boops-welcome-icon", "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return span;
}

const ICONS = {
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  sos: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  guide: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  offline: '<path d="M12 20h.01"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M2 8.8a15 15 0 0 1 4.2-2.8"/><path d="M10.7 5.1A15 15 0 0 1 22 8.8"/><path d="m2 2 20 20"/>',
  demo: '<path d="m5 3 14 9-14 9z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};

/** Shows the welcome flow as a full-screen layer. Returns a function that removes it. */
export function showWelcome(opts: WelcomeOptions): () => void {
  let step: 1 | 2 | 3 = opts.startAtChoice ? 2 : 1;
  let choice: DataMode | null = opts.preselected ?? null;
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const card = h("div", { className: "boops-welcome-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "boops-welcome-title" });
  const layer = h("div", { className: "boops-welcome" }, card);

  function close() {
    layer.remove();
    document.documentElement.classList.remove("boops-welcome-open");
    previouslyFocused?.focus?.();
  }

  function finish(mode: DataMode) {
    setDataMode(mode);
    markWelcomeComplete();
    close();
    opts.onDone(mode);
  }

  function dots() {
    const total = choice === "mine" || step === 3 ? 3 : 2;
    return h(
      "div",
      { className: "boops-welcome-dots", "aria-hidden": "true" },
      ...Array.from({ length: total }, (_, i) =>
        h("span", { className: i + 1 === step ? "is-active" : "" }),
      ),
    );
  }

  function footer() {
    return h("p", { className: "boops-welcome-foot" }, "Prototype · Not a medical device · Works fully offline");
  }

  function closeButton() {
    if (!opts.dismissible) return null;
    return h("button", { type: "button", className: "boops-welcome-close", "aria-label": "Close", onclick: close }, "✕");
  }

  function renderIntro() {
    const startBtn = h(
      "button",
      {
        type: "button",
        className: "boops-welcome-primary",
        onclick: () => {
          if (opts.preselected === "demo") {
            finish("demo");
            return;
          }
          step = opts.preselected === "mine" ? 3 : 2;
          render();
        },
      },
      opts.preselected === "demo" ? "Start the demo" : "Get started",
    );
    card.replaceChildren(
      closeButton() ?? "",
      h("img", { className: "boops-welcome-logo", src: "./boops-logo.svg", alt: "" }),
      h("p", { className: "boops-welcome-kicker" }, "Welcome to BOOPS"),
      h("h1", { className: "boops-welcome-title", id: "boops-welcome-title" }, "Early health warnings that work without Earth."),
      h(
        "p",
        { className: "boops-welcome-lede" },
        "BOOPS compares your daily wearable, sleep and radiation readings with your own first two weeks in flight, and warns you early about immune, bone and muscle, and heart risk.",
      ),
      h(
        "ul",
        { className: "boops-welcome-points" },
        h("li", null, icon(ICONS.pulse), h("div", null, h("strong", null, "Track your health"), h("span", null, "Risk indicators against your personal baseline, with the reasons why."))),
        h("li", null, icon(ICONS.sos), h("div", null, h("strong", null, "Know what to do in an emergency"), h("span", null, "Step-by-step offline protocols, one tap from SOS."))),
        h("li", null, icon(ICONS.guide), h("div", null, h("strong", null, "Use every instrument right"), h("span", null, "How to measure, why it matters, and how to fix a bad reading."))),
        h("li", null, icon(ICONS.offline), h("div", null, h("strong", null, "Private and offline"), h("span", null, "Your data stays on this device. You decide what to share."))),
      ),
      dots(),
      startBtn,
      footer(),
    );
    startBtn.focus();
  }

  function choiceCard(mode: DataMode, title: string, body: string, tag: string, iconPath: string) {
    const selected = choice === mode;
    return h(
      "button",
      {
        type: "button",
        className: `boops-welcome-choice${selected ? " is-selected" : ""}`,
        role: "radio",
        "aria-checked": String(selected),
        onclick: () => {
          choice = mode;
          render();
        },
      },
      icon(iconPath),
      h("span", { className: "boops-welcome-choice-text" }, h("strong", null, title), h("span", null, body)),
      h("span", { className: "boops-welcome-tag" }, tag),
    );
  }

  function renderChoice() {
    const nextBtn = h(
      "button",
      {
        type: "button",
        className: "boops-welcome-primary",
        disabled: !choice,
        onclick: () => {
          if (choice === "demo") finish("demo");
          else if (choice === "mine") {
            step = 3;
            render();
          }
        },
      },
      choice === "mine" ? "Continue" : choice === "demo" ? "Start the demo" : "Choose one to continue",
    );
    card.replaceChildren(
      closeButton() ?? "",
      h("p", { className: "boops-welcome-kicker" }, "Step 2"),
      h("h1", { className: "boops-welcome-title", id: "boops-welcome-title" }, "How do you want to start?"),
      h(
        "div",
        { className: "boops-welcome-choices", role: "radiogroup", "aria-label": "Data to start with" },
        choiceCard(
          "demo",
          "Try the demo first",
          "A simulated 180-day mission with 3 crew: an EVA, a solar storm and an infection caught before symptoms.",
          "Simulated",
          ICONS.demo,
        ),
        choiceCard(
          "mine",
          "Start with my data",
          "An empty dashboard. Log readings or connect a sensor, and your personal baseline builds over 14 days.",
          "Your data",
          ICONS.user,
        ),
      ),
      h("p", { className: "boops-welcome-note" }, "You can switch any time from Data in the menu."),
      dots(),
      h(
        "div",
        { className: "boops-welcome-actions" },
        opts.startAtChoice
          ? null
          : h("button", { type: "button", className: "boops-welcome-secondary", onclick: () => { step = 1; render(); } }, "Back"),
        nextBtn,
      ),
      footer(),
    );
  }

  function renderProfile() {
    const existing = loadPersonalProfile();
    const nameInput = h("input", {
      type: "text",
      id: "boops-welcome-name",
      autocomplete: "name",
      placeholder: "e.g. Alex Rivera",
      value: existing?.name ?? "",
      maxlength: "40",
    }) as HTMLInputElement;
    const roleInput = h("input", {
      type: "text",
      id: "boops-welcome-role",
      placeholder: "e.g. Flight Engineer",
      value: existing?.role ?? "",
      maxlength: "40",
    }) as HTMLInputElement;
    const dayInput = h("input", {
      type: "number",
      id: "boops-welcome-day",
      inputmode: "numeric",
      min: "1",
      max: "180",
      value: "1",
    }) as HTMLInputElement;
    const error = h("p", { className: "boops-welcome-error", role: "alert" });

    const startBtn = h(
      "button",
      {
        type: "button",
        className: "boops-welcome-primary",
        onclick: () => {
          const name = nameInput.value.trim();
          const day = Math.round(Number(dayInput.value));
          if (!name) {
            error.textContent = "Add your name so the app knows whose baseline this is.";
            nameInput.focus();
            return;
          }
          if (!Number.isFinite(day) || day < 1 || day > 180) {
            error.textContent = "Mission day must be between 1 and 180.";
            dayInput.focus();
            return;
          }
          savePersonalProfile({ name, role: roleInput.value.trim(), missionStartDate: startDateForMissionDay(day) });
          finish("mine");
        },
      },
      "Start BOOPS",
    );

    card.replaceChildren(
      closeButton() ?? "",
      h("p", { className: "boops-welcome-kicker" }, "Step 3"),
      h("h1", { className: "boops-welcome-title", id: "boops-welcome-title" }, "About you"),
      h(
        "p",
        { className: "boops-welcome-lede" },
        `Your first ${BASELINE_DAYS} days in flight become your personal baseline. Until then, BOOPS collects readings and keeps alerts quiet.`,
      ),
      h(
        "div",
        { className: "boops-welcome-form" },
        h("label", { htmlFor: "boops-welcome-name" }, "Name"),
        nameInput,
        h("label", { htmlFor: "boops-welcome-role" }, "Role ", h("span", { className: "boops-welcome-optional" }, "(optional)")),
        roleInput,
        h("label", { htmlFor: "boops-welcome-day" }, "Mission day today"),
        dayInput,
        error,
      ),
      h("p", { className: "boops-welcome-note" }, "Stored only on this device. Nothing is sent anywhere."),
      dots(),
      h(
        "div",
        { className: "boops-welcome-actions" },
        opts.preselected === "mine" && !opts.startAtChoice
          ? h("button", { type: "button", className: "boops-welcome-secondary", onclick: () => { step = 1; render(); } }, "Back")
          : h("button", { type: "button", className: "boops-welcome-secondary", onclick: () => { step = 2; render(); } }, "Back"),
        startBtn,
      ),
      footer(),
    );
    nameInput.focus();
  }

  function render() {
    card.scrollTop = 0;
    if (step === 1) renderIntro();
    else if (step === 2) renderChoice();
    else renderProfile();
  }

  layer.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && opts.dismissible) close();
  });

  document.documentElement.classList.add("boops-welcome-open");
  document.body.append(layer);
  render();
  return close;
}

export interface EmptyStateOptions {
  title: string;
  missionDay: number;
  loggedDays: number;
  onLog: () => void;
  onConnect: () => void;
  onTryDemo: () => void;
}

/** Hides the simulated screen content and shows an honest "no readings yet" panel instead. */
export function mountEmptyState(artboard: HTMLElement, opts: EmptyStateOptions): void {
  for (const child of Array.from(artboard.children)) {
    const name = child.getAttribute("data-name") ?? "";
    if (name.startsWith("Sidebar/")) continue;
    child.classList.add("boops-hidden-by-mode");
  }
  artboard.classList.add("boops-artboard-empty");

  const progress = Math.min(opts.loggedDays, BASELINE_DAYS);
  const pct = Math.round((progress / BASELINE_DAYS) * 100);
  const panel = h(
    "section",
    { className: "boops-empty-state", "aria-label": `${opts.title}: no readings yet` },
    h("p", { className: "boops-empty-kicker" }, `${opts.title} · Day ${opts.missionDay}`),
    h("h2", { className: "boops-empty-title" }, progress === 0 ? "No readings yet" : "Building your baseline"),
    h(
      "p",
      { className: "boops-empty-body" },
      progress === 0
        ? "This view fills in from your own readings. Log your first one, or connect a wearable or sensor."
        : `You have readings on ${opts.loggedDays} day${opts.loggedDays === 1 ? "" : "s"}. Risk indicators start once your ${BASELINE_DAYS}-day baseline is complete.`,
    ),
    h(
      "div",
      { className: "boops-empty-progress" },
      h("div", { className: "boops-empty-progress-head" }, h("span", null, "Personal baseline"), h("span", null, `${progress} / ${BASELINE_DAYS} days`)),
      h(
        "div",
        { className: "boops-empty-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(BASELINE_DAYS), "aria-valuenow": String(progress) },
        h("span", { style: { width: `${pct}%` } }),
      ),
    ),
    h(
      "div",
      { className: "boops-empty-actions" },
      h("button", { type: "button", className: "boops-empty-primary", onclick: opts.onLog }, "Log a reading"),
      h("button", { type: "button", className: "boops-empty-secondary", onclick: opts.onConnect }, "Connect a sensor"),
    ),
    h(
      "button",
      { type: "button", className: "boops-empty-link", onclick: opts.onTryDemo },
      "Explore the demo mission instead",
    ),
  );
  artboard.append(panel);
}
