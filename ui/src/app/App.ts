import { h } from "../lib/dom";
import { SCREEN_MAP, SCREENS, type ScreenId } from "../screens";

interface SavedLogEntry {
  whenTitle: string;
  whenTime: string;
  headline: string;
  detail: string;
}

const LOG_FOR_HEALTH: Partial<Record<ScreenId, ScreenId>> = {
  HealthHome: "LogEnvironment",
  HealthEnvironment: "LogEnvironment",
  HealthEnvironmentRadiation: "LogEnvironmentRadiation",
  HealthEnvironmentGravity: "LogEnvironmentGravity",
  HealthVitals: "LogVitals",
  HealthNutrition: "LogNutrition",
  HealthSleep: "LogSleep",
  HealthMindfulness: "LogMindfulness",
  HealthRiskDetailImmune: "LogVitals",
  HealthRiskDetailBoneMuscle: "LogEnvironmentGravity",
  HealthRiskDetailHeart: "LogVitals",
  DetailRestingHeartRate: "LogVitals",
  DetailHrv: "LogVitals",
  DetailBloodPressure: "LogVitals",
  DetailBloodOxygenSpo2: "LogVitals",
  DetailSleepDuration: "LogSleep",
  DetailSleepScore: "LogSleep",
  DetailSleepQuality: "LogSleep",
  DetailSleepAidUse: "LogSleep",
  DetailStressScore: "LogMindfulness",
  DetailMood: "LogMindfulness",
  DetailMindfulPractice: "LogMindfulness",
  DetailCaloriesProtein: "LogNutrition",
  DetailWater: "LogNutrition",
  DetailVitaminD: "LogNutrition",
  DetailGlucose: "LogNutrition",
  DetailBodyMass: "LogNutrition",
  DetailSodium: "LogNutrition",
  DetailCabinAirCo2: "LogEnvironment",
  DetailRadiationDose: "LogEnvironmentRadiation",
  DetailMissionCareerDose: "LogEnvironmentRadiation",
  DetailSpaceWeather: "LogEnvironmentRadiation",
  DetailMicrogravityExposure: "LogEnvironmentGravity",
  DetailBoneDensity: "LogEnvironmentGravity",
  DetailExerciseCountermeasures: "LogEnvironmentGravity",
  DetailFluidShiftCountermeasure: "LogEnvironmentGravity",
};

const HEALTH_FOR_LOG: Partial<Record<ScreenId, ScreenId>> = {
  LogEnvironment: "HealthEnvironment",
  LogEnvironmentRadiation: "HealthEnvironmentRadiation",
  LogEnvironmentGravity: "HealthEnvironmentGravity",
  LogVitals: "HealthVitals",
  LogVitalsGuideBloodPressure: "HealthVitals",
  LogVitalsGuideWearableFitCheck: "HealthVitals",
  LogNutrition: "HealthNutrition",
  LogSleep: "HealthSleep",
  LogMindfulness: "HealthMindfulness",
};

function readScreenFromHash(): ScreenId {
  // "#screen=EmergencyFainting&id=chest_pain": extra params (id) must not break the lookup.
  const raw = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("screen") as ScreenId | null;
  if (raw && raw in SCREEN_MAP) return raw;
  return "HealthHome";
}

function getCleanText(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function mapMetricTitleToDetail(title: string, current: ScreenId): ScreenId | null {
  const t = title.toLowerCase();
  if (t.includes("health score")) return "DetailHealthScore";
  if (t.includes("resting heart rate") || t.includes("bpm")) return "DetailRestingHeartRate";
  if (t.includes("hrv") || t.includes("38 ms")) return "DetailHrv";
  if (t.includes("blood pressure") || t.includes("mmhg")) return "DetailBloodPressure";
  if (t.includes("blood oxygen") || t.includes("spo") || t.includes("lungs") || t.includes("98 %")) return "DetailBloodOxygenSpo2";
  if (t.includes("sleep duration")) return "DetailSleepDuration";
  if (t.includes("sleep score")) return "DetailSleepScore";
  if (t.includes("sleep quality") || t.includes("sleep efficiency") || t.includes("wake-up")) return "DetailSleepQuality";
  if (t.includes("sleep aid")) return "DetailSleepAidUse";
  if (t.includes("stress score") || t.includes("stress trend")) return "DetailStressScore";
  if (t.includes("mood")) return "DetailMood";
  if (t.includes("mission day")) return "DetailMissionDay";
  if (t.includes("mindful") || t.includes("isolation") || t.includes("calls home")) return "DetailMindfulPractice";
  if (t.includes("calories") || t.includes("protein")) return "DetailCaloriesProtein";
  if (t.includes("water")) return "DetailWater";
  if (t.includes("vitamin d")) return "DetailVitaminD";
  if (t.includes("glucose")) return "DetailGlucose";
  if (t.includes("body mass") || (t.includes("body") && t.includes("kg"))) return "DetailBodyMass";
  if (t.includes("sodium") || t.includes("diet")) return "DetailSodium";
  if (t.includes("cabin") || t.includes("co₂") || t.includes("air") || t.includes("ppm")) return "DetailCabinAirCo2";
  if (t.includes("mission & career") || t.includes("mission dose") || t.includes("career dose") || t.includes("msv so far")) return "DetailMissionCareerDose";
  if (t.includes("space weather") || t.includes("shielded area") || t.includes("solar event")) return "DetailSpaceWeather";
  if (t.includes("radiation") || t.includes("dosimeter")) return "DetailRadiationDose";
  if (t.includes("microgravity") || t.includes("gravity")) return "DetailMicrogravityExposure";
  if (t.includes("bone density") || t.includes("bone")) return "DetailBoneDensity";
  if (t.includes("exercise") || t.includes("muscle") || t.includes("ared")) return "DetailExerciseCountermeasures";
  if (t.includes("fluid-shift")) return "DetailFluidShiftCountermeasure";

  if (t.startsWith("heart")) {
    return current === "HealthVitals" || current === "HealthHome" ? "DetailRestingHeartRate" : "HealthRiskDetailHeart";
  }
  if (t.startsWith("stress")) {
    return current === "HealthVitals" ? "DetailHrv" : "DetailStressScore";
  }
  if (t.startsWith("sleep")) return "DetailSleepDuration";
  return null;
}

function mapLinkTextToScreen(text: string, current: ScreenId): ScreenId | null {
  const t = text.toLowerCase().trim();
  if (t.includes("←") || t === "back") {
    if (t.includes("home")) return "HealthHome";
    if (t.includes("vitals")) return "HealthVitals";
    if (t.includes("sleep")) return "HealthSleep";
    if (t.includes("mindfulness")) return "HealthMindfulness";
    if (t.includes("nutrition")) return "HealthNutrition";
    if (t.includes("radiation")) return "HealthEnvironmentRadiation";
    if (t.includes("gravity")) return "HealthEnvironmentGravity";
    if (t.includes("environment")) return "HealthEnvironment";
    if (t.includes("emergency")) return "EmergencyHub";
    return "HealthHome";
  }
  if (t.includes("immune")) return "HealthRiskDetailImmune";
  if (t.includes("bone & muscle") || t.includes("bone loss")) return "HealthRiskDetailBoneMuscle";
  if (t.includes("heart:")) return "HealthRiskDetailHeart";
  if (t.includes("open log › environment › gravity") || t.includes("log › environment › gravity")) {
    return "LogEnvironmentGravity";
  }
  if (t.includes("open log › environment › radiation") || t.includes("log › environment › radiation")) {
    return "LogEnvironmentRadiation";
  }
  if (t.includes("open log › environment") || t.includes("log › environment")) return "LogEnvironment";
  if (t.includes("open log › vitals") || t.includes("log › vitals")) return "LogVitals";
  if (t.includes("open log › sleep") || t.includes("log › sleep")) return "LogSleep";
  if (t.includes("open log › nutrition") || t.includes("log › nutrition")) return "LogNutrition";
  if (t.includes("open log › mindfulness") || t.includes("log › mindfulness")) return "LogMindfulness";
  if (t.includes("open health › nutrition")) return "HealthNutrition";
  if (t.includes("see calories & protein") || t === "calories & protein") return "DetailCaloriesProtein";
  if (t === "mission & career dose") return "DetailMissionCareerDose";
  if (t.includes("wearable fit check")) return "LogVitalsGuideWearableFitCheck";
  if (t.includes("how to measure blood pressure")) return "LogVitalsGuideBloodPressure";
  if (t.includes("how to collect a saliva sample")) return "HealthRiskDetailImmuneGuideSalivaSample";
  if (t.includes("how to check pulse")) return "LogVitalsGuideWearableFitCheck";
  if (t === "log today") return LOG_FOR_HEALTH[current] ?? "LogVitals";
  return null;
}

function makeLogEntryNode(entry: SavedLogEntry): HTMLElement {
  return h(
    "div",
    {
      className:
        "bg-[var(--color-bg-card,white)] border border-[var(--color-border-default,#e5e7eb)] border-solid content-stretch flex gap-[var(--spacing-lg,16px)] items-center px-[var(--spacing-lg,16px)] py-[var(--spacing-md,12px)] relative rounded-[var(--radius-md,16px)] shrink-0 w-full",
      "data-name": "Log entry",
    },
    h(
      "div",
      {
        className:
          "[word-break:break-word] content-stretch flex flex-col items-start leading-[1.4] not-italic overflow-clip relative shrink-0 w-[72px] whitespace-nowrap",
        "data-name": "When",
      },
      h(
        "p",
        {
          className:
            "font-['Inter:Medium'] font-medium relative shrink-0 text-[14px] text-[color:var(--color-text-primary,#111827)]",
        },
        entry.whenTitle,
      ),
      h(
        "p",
        {
          className:
            "font-['Inter:Regular'] font-normal relative shrink-0 text-[12px] text-[color:var(--color-text-muted,#6b7280)]",
        },
        entry.whenTime,
      ),
    ),
    h(
      "div",
      {
        className:
          "[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[var(--spacing-xs,4px)] items-start leading-[1.4] min-w-px not-italic overflow-clip relative whitespace-nowrap",
        "data-name": "Entry",
      },
      h(
        "p",
        {
          className:
            "font-['Inter:Medium'] font-medium relative shrink-0 text-[14px] text-[color:var(--color-text-secondary,#374151)]",
        },
        entry.headline,
      ),
      h(
        "p",
        {
          className:
            "font-['Inter:Regular'] font-normal relative shrink-0 text-[12px] text-[color:var(--color-text-muted,#6b7280)]",
        },
        entry.detail,
      ),
    ),
  );
}

/** Mounts the Figma 52-screen application with stateful navigation, logging, and preview HUD. */
export function createApp(root: HTMLElement) {
  let activeScreen: ScreenId = readScreenFromHash();
  let previousScreen: ScreenId = "LogVitals";
  let selectedCrew = "Amara Okafor";
  let hudOpen = false;
  let hudFilter = "";
  let toastTimer: number | null = null;

  const MOBILE_BREAKPOINT = 768;
  const TABLET_BREAKPOINT = 1024;
  let mobileNavOpen = false;

  const toggleState = new Map<string, boolean>();
  const checklistState = new Map<string, boolean>();
  const logDrafts = new Map<string, string>();
  const savedLogs = new Map<ScreenId, SavedLogEntry[]>();

  // ---- Mobile/tablet bottom tab bar (hidden on desktop >= 1024px) ----
  // Inline SVG icons use currentColor so active / SOS / emergency states can recolour them.
  const TAB_ICONS: Record<string, string> = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    vitals: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    sos: '<path d="M7 18v-5a5 5 0 0 1 10 0v5"/><path d="M5 21h14"/><path d="M12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4"/>',
    log: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  };
  function tabIcon(name: string) {
    const span = h("span", { className: "boops-tab-icon", "aria-hidden": "true" });
    span.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[name]}</svg>`;
    return span;
  }
  function makeTab(name: string, label: string, onclick: () => void, extraClass = "") {
    return h(
      "button",
      { type: "button", className: `boops-tab ${extraClass}`.trim(), onclick },
      tabIcon(name),
      h("span", { className: "boops-tab-label" }, label),
    );
  }

  /** Log counterpart of the current Health section (e.g. Health / Sleep → Log / Sleep). */
  function logTargetFor(screenId: ScreenId): ScreenId {
    if (screenId.startsWith("Health")) {
      const candidate = `Log${screenId.slice("Health".length)}`;
      if (candidate in SCREEN_MAP) return candidate as ScreenId;
    }
    return "LogVitals";
  }

  const mobileHomeTab = makeTab("home", "Home", () => navigateTo("HealthHome"));
  const mobileVitalsTab = makeTab("vitals", "Vitals", () => navigateTo("HealthVitals"));
  const mobileEmergencyBtn = makeTab("sos", "SOS", () => navigateTo("EmergencyHub"), "boops-tab-sos");
  mobileEmergencyBtn.setAttribute("aria-label", "Emergency (SOS)");
  const mobileLogTab = makeTab("log", "Log", () => {
    const entry = SCREEN_MAP[activeScreen];
    navigateTo(entry.category === "Log" ? activeScreen : logTargetFor(activeScreen));
  });
  const mobileMenuBtn = makeTab("more", "More", () => setMobileNavOpen(!mobileNavOpen));
  mobileMenuBtn.setAttribute("aria-label", "More: full menu");
  mobileMenuBtn.setAttribute("aria-expanded", "false");
  mobileMenuBtn.setAttribute("aria-controls", "boops-mobile-sheet");

  const mobileNavBar = h(
    "nav",
    { className: "boops-bottom-nav", "aria-label": "Primary" },
    mobileHomeTab,
    mobileVitalsTab,
    mobileLogTab,
    mobileEmergencyBtn,
    mobileMenuBtn,
  );
  const mobileScrim = h("div", {
    className: "boops-mobile-scrim",
    hidden: true,
    onclick: () => setMobileNavOpen(false),
  });

  const scaleBox = h("div", { className: "figma-scale-box" });
  const stage = h("div", { className: "app-stage" }, mobileNavBar, mobileScrim, scaleBox);
  const toastEl = h("div", { className: "figma-toast", hidden: true });
  let boopsRuntime: {
    enhanceArtboard: (artboard: HTMLElement, screenId: ScreenId) => void;
    closeTopOverlay?: () => boolean;
  } | null = null;
  const screenHistory: ScreenId[] = [];

  function setMobileNavOpen(next: boolean) {
    const wasOpen = mobileNavOpen;
    mobileNavOpen = next;
    document.documentElement.dataset.boopsNav = next ? "open" : "closed";
    mobileScrim.hidden = !next;
    mobileMenuBtn.setAttribute("aria-expanded", String(next));
    mobileMenuBtn.classList.toggle("is-open", next);
    if (next && !wasOpen) {
      // Move focus into the sheet so keyboard / screen-reader users land in the menu.
      window.requestAnimationFrame(() => {
        scaleBox.querySelector<HTMLElement>(".boops-mobile-drawer-close")?.focus();
      });
    } else if (!next && wasOpen && scaleBox.contains(document.activeElement)) {
      mobileMenuBtn.focus();
    }
  }

  function updateMobileNavChrome(screenId: ScreenId) {
    const entry = SCREEN_MAP[screenId];
    const cat = entry.category;
    const isEmergency = cat === "Emergency";
    const isLog = cat === "Log" || screenId.startsWith("LogVitalsGuide");
    const isSettings = cat === "Settings";
    const isHome = screenId === "HealthHome";
    const isHealth = !isEmergency && !isLog && !isSettings && !isHome;
    const tabs: [HTMLElement, boolean][] = [
      [mobileHomeTab, isHome],
      [mobileVitalsTab, isHealth],
      [mobileLogTab, isLog],
      [mobileEmergencyBtn, isEmergency],
      [mobileMenuBtn, isSettings],
    ];
    for (const [tab, active] of tabs) {
      tab.classList.toggle("is-active", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    mobileNavBar.classList.toggle("is-emergency", isEmergency);
  }

  // Floating 52-Frame Switcher HUD
  const hudPillLabel = h("span", null, "");
  const hudPill = h(
    "button",
    {
      className: "frame-hud__pill",
      type: "button",
      onclick: () => {
        hudOpen = !hudOpen;
        updateHud();
        if (hudOpen) hudSearch.focus();
      },
    },
    h("span", { className: "frame-hud__pill-dot" }),
    hudPillLabel,
  );

  const hudSearch = h("input", {
    className: "frame-hud__search",
    type: "search",
    placeholder: "Search 52 Figma frames...",
    oninput: (ev: Event) => {
      hudFilter = (ev.target as HTMLInputElement).value;
      updateHudList();
    },
  }) as HTMLInputElement;

  const hudList = h("div", { className: "frame-hud__list" });
  const hudPanel = h(
    "div",
    { className: "frame-hud__panel", hidden: true },
    h(
      "div",
      { className: "frame-hud__head" },
      h("span", null, `Figma Frames (${SCREENS.length})`),
      h(
        "button",
        {
          type: "button",
          style: { fontSize: "12px", color: "#6b7280", fontWeight: "500" },
          onclick: () => {
            hudOpen = false;
            updateHud();
          },
        },
        "Close",
      ),
    ),
    hudSearch,
    hudList,
  );

  const hudRoot = h("div", { className: "frame-hud" }, hudPanel, hudPill);
  root.replaceChildren(stage, toastEl, hudRoot);

  function showToast(msg: string) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    if (toastTimer != null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.hidden = true;
    }, 2600);
  }

  function getViewportKind(width: number): "mobile" | "tablet" | "desktop" {
    if (width > 0 && width < MOBILE_BREAKPOINT) return "mobile";
    if (width > 0 && width < TABLET_BREAKPOINT) return "tablet";
    return "desktop";
  }

  function applyScaleAndHeight(artboard: HTMLElement) {
    const w = window.innerWidth;
    const vp = getViewportKind(w);
    document.documentElement.dataset.boopsViewport = vp;

    if (vp !== "desktop") {
      // Below desktop width, render at 1:1 with responsive CSS rather than tiny scaled desktop coordinates.
      (scaleBox as HTMLElement).style.setProperty("zoom", "1");
      artboard.style.minHeight = "";
      const dimEl = artboard.querySelector<HTMLElement>('[data-name="Dim"]');
      if (dimEl) dimEl.style.height = "";
      return;
    }

    setMobileNavOpen(false);
    const zoom = w > 0 && w < 1440 ? w / 1440 : 1;
    (scaleBox as HTMLElement).style.setProperty("zoom", String(zoom));

    window.requestAnimationFrame(() => {
      if (getViewportKind(window.innerWidth) !== "desktop") return;
      const boxRect = artboard.getBoundingClientRect();
      let maxRelBottom = 1024;
      for (const child of Array.from(artboard.children)) {
        const el = child as HTMLElement;
        if (el.getAttribute("data-name") === "Dim") continue;
        const r = el.getBoundingClientRect();
        const relBottom = (r.bottom - boxRect.top) / zoom;
        if (relBottom > maxRelBottom) maxRelBottom = relBottom;
      }
      const finalH = Math.max(1024, Math.ceil(maxRelBottom + 32));
      artboard.style.minHeight = `${finalH}px`;
      const dimEl = artboard.querySelector<HTMLElement>('[data-name="Dim"]');
      if (dimEl) dimEl.style.height = `${finalH}px`;
    });
  }

  function navigateTo(next: ScreenId, pushHistory = true) {
    setMobileNavOpen(false);
    if (next === activeScreen) return;
    if (pushHistory) {
      screenHistory.push(activeScreen);
      if (screenHistory.length > 40) screenHistory.shift();
    }
    if (
      activeScreen !== "LogVitalsGuideBloodPressure" &&
      activeScreen !== "LogVitalsGuideWearableFitCheck" &&
      activeScreen !== "HealthRiskDetailImmuneGuideSalivaSample"
    ) {
      previousScreen = activeScreen;
    }
    activeScreen = next;
    const targetHash = `#screen=${encodeURIComponent(next)}`;
    if (window.location.hash !== targetHash) {
      window.history.replaceState(null, "", targetHash);
    }
    window.scrollTo({ top: 0 });
    renderActiveScreen();
  }

  function updateHudList() {
    const q = hudFilter.trim().toLowerCase();
    const groups = new Map<string, typeof SCREENS[number][]>();
    for (const scr of SCREENS) {
      if (q && !scr.name.toLowerCase().includes(q) && !scr.category.toLowerCase().includes(q)) {
        continue;
      }
      const list = groups.get(scr.category) ?? [];
      list.push(scr);
      groups.set(scr.category, list);
    }

    const items: Node[] = [];
    for (const [cat, list] of groups.entries()) {
      items.push(h("div", { className: "frame-hud__cat" }, `${cat} (${list.length})`));
      for (const scr of list) {
        const isActive = scr.id === activeScreen;
        items.push(
          h(
            "button",
            {
              type: "button",
              className: `frame-hud__item ${isActive ? "frame-hud__item--active" : ""}`,
              onclick: () => {
                navigateTo(scr.id);
              },
            },
            h("span", null, scr.name),
            h("span", { className: "frame-hud__node" }, scr.nodeId),
          ),
        );
      }
    }
    hudList.replaceChildren(...items);
  }

  function updateHud() {
    const entry = SCREEN_MAP[activeScreen];
    hudPillLabel.textContent = `${entry.name} · 52 frames`;
    hudPanel.hidden = !hudOpen;
    if (hudOpen) updateHudList();
  }

  function enhanceFormsAndState(artboard: HTMLElement) {
    // 1. Replace static placeholders inside Input field -> Field with real inline inputs
    const fields = artboard.querySelectorAll<HTMLElement>('[data-name="Input field"]');
    fields.forEach((fieldWrap, idx) => {
      const labelText = getCleanText(fieldWrap.querySelector('[data-name="Label row"] p')) || `field-${idx}`;
      const fieldBox = fieldWrap.querySelector<HTMLElement>('[data-name="Field"]');
      if (!fieldBox) return;
      const firstP = fieldBox.querySelector("p");
      if (!firstP) return;
      const placeholder = getCleanText(firstP);
      const draftKey = `${activeScreen}::${labelText}::${idx}`;
      const input = h("input", {
        type: "text",
        className: "figma-field-input",
        placeholder,
        value: logDrafts.get(draftKey) ?? "",
        "data-draft-key": draftKey,
        "data-field-label": labelText,
        oninput: (ev: Event) => {
          logDrafts.set(draftKey, (ev.target as HTMLInputElement).value);
        },
      }) as HTMLInputElement;
      firstP.replaceWith(input);
    });

    // 1b. Reset Figma's static pre-selected Chip ("Fatigue") / Rating ("3") on Log screens
    if (activeScreen.startsWith("Log")) {
      artboard.querySelectorAll<HTMLElement>('[data-name="Chip"]').forEach((chip) => {
        chip.className =
          "bg-[var(--color-bg-card,white)] border border-[var(--color-border-default,#e5e7eb)] border-solid content-stretch flex items-center px-[var(--spacing-md,12px)] py-[6px] relative rounded-[var(--radius-full,999px)] shrink-0";
        const p = chip.querySelector("p");
        if (p) {
          p.className =
            "[word-break:break-word] font-['Inter:Regular'] font-normal leading-[1.4] not-italic relative shrink-0 text-[14px] text-[color:var(--color-text-secondary,#374151)] whitespace-nowrap";
        }
      });
      artboard.querySelectorAll<HTMLElement>('[data-name="Options"] > div').forEach((opt) => {
        opt.className =
          "bg-[var(--color-bg-card,white)] border border-[var(--color-border-default,#e5e7eb)] border-solid content-stretch flex items-center justify-center overflow-clip relative rounded-[var(--radius-full,999px)] shrink-0 size-[40px]";
        const op = opt.querySelector("p");
        if (op) {
          op.className =
            "[word-break:break-word] font-['Inter:Medium'] font-medium leading-[1.4] not-italic relative shrink-0 text-[14px] text-[color:var(--color-text-secondary,#374151)] whitespace-nowrap";
        }
      });
    }

    // 2. Prepend saved log entries when standalone (without boopsRuntime)
    if (!boopsRuntime) {
      const existingLogs = savedLogs.get(activeScreen);
      if (existingLogs && existingLogs.length > 0) {
        const historyWrap = artboard.querySelector<HTMLElement>('[data-name="History"]');
        const sectionHeader = historyWrap?.querySelector<HTMLElement>('[data-name="Section header"]');
        if (historyWrap && sectionHeader) {
          const frag = document.createDocumentFragment();
          for (const entry of existingLogs) {
            frag.appendChild(makeLogEntryNode(entry));
          }
          sectionHeader.after(frag);
        }
      }
    }

    // 3. Apply stored toggle states (Settings / Risk share toggles)
    artboard.querySelectorAll<HTMLElement>('[data-name="Toggle"], [data-name="Share toggle"]').forEach((tEl, idx) => {
      const rowText = getCleanText(tEl.parentElement) || `toggle-${idx}`;
      const key = `${activeScreen}::${rowText}::${idx}`;
      const img = tEl.querySelector("img");
      if (!img) return;
      if (!toggleState.has(key)) {
        const isOn = img.getAttribute("src")?.includes("imgToggleOn") ?? false;
        toggleState.set(key, isOn);
      } else {
        const isOn = toggleState.get(key) === true;
        img.setAttribute(
          "src",
          isOn
            ? "./assets/figma/imgToggleOn.svg"
            : tEl.getAttribute("data-name") === "Share toggle"
              ? "./assets/figma/imgShareToggle.svg"
              : "./assets/figma/imgToggleOff.svg",
        );
      }
      tEl.dataset.toggleKey = key;
    });

    // 4. Sync EmergencyHub Crew member selection highlight
    if (activeScreen === "EmergencyHub") {
      artboard.querySelectorAll<HTMLElement>('[data-name="Crew member"]').forEach((card) => {
        const name = getCleanText(card.querySelector("p"));
        const isSelected = name === selectedCrew;
        card.className = isSelected
          ? "bg-[var(--color-bg-active,#c6f432)] border-2 border-[var(--color-accent,#c6f432)] border-solid content-stretch flex flex-col gap-[var(--spacing-xs,4px)] items-center p-[var(--spacing-md,12px)] relative rounded-[var(--radius-lg,24px)] shrink-0 w-[150px]"
          : "bg-[var(--color-bg-card,white)] border border-[var(--color-border-default,#e5e7eb)] border-solid content-stretch flex flex-col gap-[var(--spacing-xs,4px)] items-center p-[var(--spacing-md,12px)] relative rounded-[var(--radius-lg,24px)] shrink-0 w-[150px]";
      });
    }

    // 5. Sync Checklist steps state
    artboard.querySelectorAll<HTMLElement>('[data-name="Checklist step"]').forEach((stepEl, idx) => {
      const key = `${activeScreen}::step::${idx}`;
      const box = stepEl.querySelector<HTMLElement>('[data-name="Checkbox"]');
      if (!box) return;
      const defaultChecked = box.className.includes("#c6f432");
      if (!checklistState.has(key)) checklistState.set(key, defaultChecked);
      const checked = checklistState.get(key) === true;
      box.classList.toggle("checklist-box-unchecked", !checked);
      stepEl.dataset.checklistKey = key;
    });
  }

  function wireInteractions(artboard: HTMLElement) {
    artboard.addEventListener("click", (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;

      // Ignore clicks inside editable text input
      if (target.tagName === "INPUT") return;

      // 1. Drawer dismissal (Dim overlay / close icon / Got it button inside Drawer)
      if (target.closest('[data-name="Dim"]') || target.closest('[data-name="Close"]') || target.closest('[data-name="icon/close"]')) {
        if (activeScreen === "HealthRiskDetailImmuneGuideSalivaSample") {
          navigateTo("HealthRiskDetailImmune");
        } else {
          navigateTo(previousScreen.startsWith("Log") ? previousScreen : "LogVitals");
        }
        return;
      }

      const drawerGotIt = target.closest('[data-name="Drawer"] [data-name="Button"], [data-name="Drawer"] [data-name="Primary button"]');
      if (drawerGotIt) {
        if (activeScreen === "HealthRiskDetailImmuneGuideSalivaSample") {
          navigateTo("HealthRiskDetailImmune");
        } else {
          navigateTo(previousScreen.startsWith("Log") ? previousScreen : "LogVitals");
        }
        return;
      }

      // 2. Toggle switches fallback (handled by bindEngineData when boopsRuntime is active)
      if (!boopsRuntime) {
        const toggleEl = target.closest<HTMLElement>('[data-name="Toggle"], [data-name="Share toggle"]');
        if (toggleEl && toggleEl.dataset.toggleKey) {
          const key = toggleEl.dataset.toggleKey;
          const next = !(toggleState.get(key) === true);
          toggleState.set(key, next);
          const img = toggleEl.querySelector("img");
          if (img) {
            img.setAttribute("src", next ? "./assets/figma/imgToggleOn.svg" : "./assets/figma/imgToggleOff.svg");
          }
          showToast(next ? "Setting enabled (local state)" : "Setting disabled (local state)");
          return;
        }
      }

      // 3. Log Chips (toggle active state)
      const chip = target.closest<HTMLElement>('[data-name="Chip"]');
      if (chip) {
        const isActive = chip.className.includes("var(--color-bg-strong");
        const p = chip.querySelector("p");
        if (isActive) {
          chip.className =
            "bg-[var(--color-bg-card,white)] border border-[var(--color-border-default,#e5e7eb)] border-solid content-stretch flex items-center px-[var(--spacing-md,12px)] py-[6px] relative rounded-[var(--radius-full,999px)] shrink-0";
          if (p) {
            p.className =
              "[word-break:break-word] font-['Inter:Regular'] font-normal leading-[1.4] not-italic relative shrink-0 text-[14px] text-[color:var(--color-text-secondary,#374151)] whitespace-nowrap";
          }
        } else {
          chip.className =
            "bg-[var(--color-bg-strong,#111827)] content-stretch flex items-center px-[var(--spacing-md,12px)] py-[6px] relative rounded-[var(--radius-full,999px)] shrink-0";
          if (p) {
            p.className =
              "[word-break:break-word] font-['Inter:Regular'] font-normal leading-[1.4] not-italic relative shrink-0 text-[14px] text-[color:var(--color-text-inverse,white)] whitespace-nowrap";
          }
          // "Nothing" cannot be picked together with a real cause (and vice versa).
          const isNothing = getCleanText(chip).toLowerCase() === "nothing";
          for (const sib of Array.from(chip.parentElement?.children ?? [])) {
            const el = sib as HTMLElement;
            if (el === chip || el.getAttribute("data-name") !== "Chip") continue;
            const sibNothing = getCleanText(el).toLowerCase() === "nothing";
            if (isNothing !== sibNothing && el.className.includes("var(--color-bg-strong")) {
              el.className =
                "bg-[var(--color-bg-card,white)] border border-[var(--color-border-default,#e5e7eb)] border-solid content-stretch flex items-center px-[var(--spacing-md,12px)] py-[6px] relative rounded-[var(--radius-full,999px)] shrink-0";
              const sp = el.querySelector("p");
              if (sp) {
                sp.className =
                  "[word-break:break-word] font-['Inter:Regular'] font-normal leading-[1.4] not-italic relative shrink-0 text-[14px] text-[color:var(--color-text-secondary,#374151)] whitespace-nowrap";
              }
            }
          }
        }
        return;
      }

      // 4. Rating scale (1–5 circles)
      const ratingOpt = target.closest<HTMLElement>('[data-name="Options"] > div');
      if (ratingOpt && ratingOpt.parentElement) {
        for (const opt of Array.from(ratingOpt.parentElement.children)) {
          const el = opt as HTMLElement;
          const p = el.querySelector("p");
          const selected = el === ratingOpt;
          el.className = selected
            ? "bg-[var(--color-bg-strong,#111827)] content-stretch flex items-center justify-center overflow-clip relative rounded-[var(--radius-full,999px)] shrink-0 size-[40px]"
            : "bg-[var(--color-bg-card,white)] border border-[var(--color-border-default,#e5e7eb)] border-solid content-stretch flex items-center justify-center overflow-clip relative rounded-[var(--radius-full,999px)] shrink-0 size-[40px]";
          if (p) {
            p.className = selected
              ? "[word-break:break-word] font-['Inter:Medium'] font-medium leading-[1.4] not-italic relative shrink-0 text-[14px] text-[color:var(--color-text-inverse,white)] whitespace-nowrap"
              : "[word-break:break-word] font-['Inter:Medium'] font-medium leading-[1.4] not-italic relative shrink-0 text-[14px] text-[color:var(--color-text-secondary,#374151)] whitespace-nowrap";
          }
        }
        return;
      }

      // 5. Save entry fallback on Log screens (handled persistently by bindEngineData when boopsRuntime is active)
      const clickedBtn = target.closest<HTMLElement>('[data-name="Button"], [data-name="Primary button"]');
      if (!boopsRuntime && clickedBtn && getCleanText(clickedBtn).toLowerCase() === "save entry") {
        const inputs = Array.from(artboard.querySelectorAll<HTMLInputElement>(".figma-field-input"));
        const filled = inputs
          .filter((inp) => inp.value.trim().length > 0)
          .map((inp) => `${inp.dataset.fieldLabel ?? "Metric"}: ${inp.value.trim()}`);
        const activeChips = Array.from(artboard.querySelectorAll<HTMLElement>('[data-name="Chip"]'))
          .filter((c) => c.className.includes("var(--color-bg-strong"))
          .map((c) => getCleanText(c));
        const activeRating = Array.from(artboard.querySelectorAll<HTMLElement>('[data-name="Options"] > div')).find((o) =>
          o.className.includes("var(--color-bg-strong"),
        );

        const parts = [...filled, ...activeChips.map((c) => c)];
        if (activeRating) parts.push(`Rating ${getCleanText(activeRating)}/5`);
        const summary = parts.length > 0 ? parts.slice(0, 3).join(" · ") : "Manual check logged";

        const now = new Date();
        const utc = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")} UTC`;
        const entry: SavedLogEntry = {
          whenTitle: "Day 43",
          whenTime: utc,
          headline: summary,
          detail: "Logged manually in offline local session",
        };
        const list = savedLogs.get(activeScreen) ?? [];
        list.unshift(entry);
        savedLogs.set(activeScreen, list);

        for (const inp of inputs) {
          inp.value = "";
          if (inp.dataset.draftKey) logDrafts.delete(inp.dataset.draftKey);
        }
        const historyWrap = artboard.querySelector<HTMLElement>('[data-name="History"]');
        const sectionHeader = historyWrap?.querySelector<HTMLElement>('[data-name="Section header"]');
        sectionHeader?.after(makeLogEntryNode(entry));
        showToast("Entry saved to local mission history");
        return;
      }

      // 6. Checklist steps in Emergency screens
      const checkStep = target.closest<HTMLElement>('[data-name="Checklist step"]');
      if (checkStep && checkStep.dataset.checklistKey) {
        // Ignore if user specifically clicked inline guide link like "How to check pulse"
        if (getCleanText(target).toLowerCase().includes("how to check pulse")) {
          navigateTo("LogVitalsGuideWearableFitCheck");
          return;
        }
        const key = checkStep.dataset.checklistKey;
        const next = !(checklistState.get(key) === true);
        checklistState.set(key, next);
        const box = checkStep.querySelector<HTMLElement>('[data-name="Checkbox"]');
        box?.classList.toggle("checklist-box-unchecked", !next);
        return;
      }

      // 7. Crew member selection in EmergencyHub
      const crewCard = target.closest<HTMLElement>('[data-name="Crew member"]');
      if (crewCard) {
        selectedCrew = getCleanText(crewCard.querySelector("p")) || selectedCrew;
        enhanceFormsAndState(artboard);
        showToast(`Selected crew member: ${selectedCrew}`);
        return;
      }

      // 8. Sidebar Tabs ("Health" / "Log")
      const tabEl = target.closest<HTMLElement>('[data-name="Section tabs"] > *');
      if (tabEl) {
        const label = getCleanText(tabEl).toLowerCase();
        if (label === "health") {
          navigateTo(HEALTH_FOR_LOG[activeScreen] ?? "HealthHome");
          return;
        }
        if (label === "log") {
          navigateTo(LOG_FOR_HEALTH[activeScreen] ?? "LogEnvironment");
          return;
        }
      }

      // 9. Sidebar Nav Rows & Sub-rows
      const navRow = target.closest<HTMLElement>('[data-name^="Nav row/"], [data-name^="Nav sub-row/"]');
      if (navRow) {
        const rowName = (navRow.getAttribute("data-name") ?? "").split("/").pop()?.toLowerCase() ?? "";
        const inLog = activeScreen.startsWith("Log");
        if (inLog) {
          if (rowName === "environment") navigateTo("LogEnvironment");
          else if (rowName === "radiation") navigateTo("LogEnvironmentRadiation");
          else if (rowName === "gravity") navigateTo("LogEnvironmentGravity");
          else if (rowName === "vitals") navigateTo("LogVitals");
          else if (rowName === "nutrition") navigateTo("LogNutrition");
          else if (rowName === "sleep") navigateTo("LogSleep");
          else if (rowName === "mindfulness") navigateTo("LogMindfulness");
        } else {
          if (rowName === "home") navigateTo("HealthHome");
          else if (rowName === "environment") navigateTo("HealthEnvironment");
          else if (rowName === "radiation") navigateTo("HealthEnvironmentRadiation");
          else if (rowName === "gravity") navigateTo("HealthEnvironmentGravity");
          else if (rowName === "vitals") navigateTo("HealthVitals");
          else if (rowName === "nutrition") navigateTo("HealthNutrition");
          else if (rowName === "sleep") navigateTo("HealthSleep");
          else if (rowName === "mindfulness") navigateTo("HealthMindfulness");
        }
        return;
      }

      // 10. Sidebar Emergency & Profile / Settings
      if (target.closest('[data-name="Emergency button"]')) {
        navigateTo("EmergencyHub");
        return;
      }
      if (target.closest('[data-name="Profile"]') && target.closest('[data-name^="Sidebar/"]')) {
        navigateTo("SettingsProfile");
        return;
      }

      // 11. Back button
      const backBtn = target.closest<HTMLElement>('[data-name="Back"]');
      if (backBtn) {
        const dest = mapLinkTextToScreen(getCleanText(backBtn), activeScreen);
        if (dest) navigateTo(dest);
        return;
      }

      // 12. Tool guide triggers ("ⓘ How to measure" inside Input fields)
      const labelRowHelp = target.closest<HTMLElement>('[data-name="Label row"] p:last-child');
      if (labelRowHelp && getCleanText(labelRowHelp).toLowerCase().includes("how to measure")) {
        const fieldText = getCleanText(target.closest('[data-name="Input field"]')).toLowerCase();
        if (fieldText.includes("blood pressure")) {
          navigateTo("LogVitalsGuideBloodPressure");
        } else {
          navigateTo("LogVitalsGuideWearableFitCheck");
        }
        return;
      }

      // 13. Emergency Hub protocol tiles
      const emTile = target.closest<HTMLElement>('[data-name="Emergency tile"]');
      if (emTile) {
        const t = getCleanText(emTile).toLowerCase();
        if (t.includes("solar radiation")) navigateTo("EmergencySolarRadiationStorm");
        else if (t.includes("fainting")) navigateTo("EmergencyFainting");
        else showToast(`${getCleanText(emTile.querySelector("p"))} · offline protocol ready`);
        return;
      }

      // 14. Alert banner ("View" -> Emergency / Detail)
      const banner = target.closest<HTMLElement>('[data-name="Alert banner"]');
      if (banner) {
        if (activeScreen === "EmergencyFainting") navigateTo("DetailFluidShiftCountermeasure");
        else navigateTo("EmergencySolarRadiationStorm");
        return;
      }

      // 15. Risk cards ("Immune risk", "Bone & muscle", "Heart", "CO₂ & headaches", etc.)
      const riskCard = target.closest<HTMLElement>('[data-name="Risk card"]');
      if (riskCard) {
        const t = getCleanText(riskCard.querySelector('[data-name="Header"] p') ?? riskCard).toLowerCase();
        if (t.includes("immune")) navigateTo("HealthRiskDetailImmune");
        else if (t.includes("bone & muscle")) navigateTo("HealthRiskDetailBoneMuscle");
        else if (t.startsWith("heart")) navigateTo("HealthRiskDetailHeart");
        else if (t.includes("co₂") || t.includes("headache")) navigateTo("DetailCabinAirCo2");
        else if (t.includes("radiation")) {
          navigateTo(activeScreen === "HealthEnvironment" ? "HealthEnvironmentRadiation" : "DetailRadiationDose");
        } else if (t.includes("microgravity")) {
          navigateTo(activeScreen === "HealthEnvironment" ? "HealthEnvironmentGravity" : "DetailMicrogravityExposure");
        }
        else if (t.includes("return to earth")) navigateTo("DetailExerciseCountermeasures");
        else if (t.includes("bone health link")) navigateTo("DetailBoneDensity");
        else if (t.includes("fatigue risk")) navigateTo("DetailSleepDuration");
        else if (t.includes("stress & mood")) navigateTo("DetailStressScore");
        return;
      }

      // 16. Link rows & header Action buttons ("Log today", "View details", "Open Log...", "See all")
      const linkRow = target.closest<HTMLElement>('[data-name="Link row"]');
      if (linkRow) {
        const dest = mapLinkTextToScreen(getCleanText(linkRow), activeScreen);
        if (dest) {
          navigateTo(dest);
          return;
        }
      }

      const actionBtn = target.closest<HTMLElement>('[data-name="Action"], [data-name="Button"], [data-name="Primary button"], [data-name="Call mission control"]');
      if (actionBtn) {
        const txt = getCleanText(actionBtn).toLowerCase();
        const dest = mapLinkTextToScreen(txt, activeScreen);
        if (dest) {
          navigateTo(dest);
          return;
        }
        if (txt.includes("confirm & notify") || txt.includes("in the shelter") || txt.includes("call mission control")) {
          showToast(`Offline mission alert queued for ${selectedCrew}: "${getCleanText(actionBtn)}"`);
          return;
        }
        if (txt === "export") {
          showToast(`${getCleanText(actionBtn)} · use sidebar Export / Summary`);
          return;
        }
      }

      // 17. Score / Metric / Progress / Chart cards -> Detail screens
      const cardEl = target.closest<HTMLElement>('[data-name="Score card"], [data-name="Metric card"], [data-name="Progress card"], [data-name="Chart card"]');
      if (cardEl) {
        const dest = mapMetricTitleToDetail(getCleanText(cardEl), activeScreen);
        if (dest) {
          navigateTo(dest);
          return;
        }
      }

      // 18. Standalone guide text links (e.g., "How to collect a saliva sample", "See Calories & protein.")
      const textP = target.closest("p");
      if (textP) {
        const dest = mapLinkTextToScreen(getCleanText(textP), activeScreen);
        if (dest) {
          navigateTo(dest);
          return;
        }
      }
    });
  }

  function attachMobileDrawerChrome(artboard: HTMLElement) {
    const sidebar = artboard.querySelector<HTMLElement>('[data-name^="Sidebar/"]');
    if (!sidebar) return;
    sidebar.id = "boops-mobile-sheet";
    if (!sidebar.querySelector(".boops-mobile-drawer-close")) {
      const closeDrawerBtn = h(
        "button",
        {
          type: "button",
          className: "boops-mobile-drawer-close",
          "aria-label": "Close navigation menu",
          onclick: (ev: MouseEvent) => {
            ev.stopPropagation();
            setMobileNavOpen(false);
          },
        },
        "✕",
      );
      sidebar.prepend(closeDrawerBtn);
    }
    sidebar.addEventListener("click", (ev: MouseEvent) => {
      if (getViewportKind(window.innerWidth) === "desktop") return;
      const t = ev.target as HTMLElement | null;
      if (t?.closest('[data-name^="Nav"], [data-name="Section tabs"] a, [data-name="Emergency button"], [data-name="Profile"], [data-name="icon/settings"], .boops-side-row')) {
        setMobileNavOpen(false);
      }
    });
  }

  function renderActiveScreen() {
    const entry = SCREEN_MAP[activeScreen];
    const artboard = entry.render();
    enhanceFormsAndState(artboard);
    wireInteractions(artboard);
    boopsRuntime?.enhanceArtboard(artboard, activeScreen);
    attachMobileDrawerChrome(artboard);
    updateMobileNavChrome(activeScreen);
    scaleBox.replaceChildren(artboard);
    applyScaleAndHeight(artboard);
    updateHud();
  }

  window.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && mobileNavOpen) {
      setMobileNavOpen(false);
    }
  });

  let lastHash = window.location.hash;
  window.addEventListener("hashchange", () => {
    const next = readScreenFromHash();
    const hashChanged = window.location.hash !== lastHash;
    lastHash = window.location.hash;
    if (next !== activeScreen || hashChanged) {
      activeScreen = next;
      setMobileNavOpen(false);
      renderActiveScreen();
    }
  });

  window.addEventListener("resize", () => {
    const artboard = scaleBox.firstElementChild as HTMLElement | null;
    if (artboard) applyScaleAndHeight(artboard);
  });

  const boopsInstallFn = (
    globalThis as unknown as {
      __boopsInstall?: (host: {
        stage: HTMLElement;
        getScreen: () => ScreenId;
        setScreen: (id: ScreenId) => void;
        renderActiveScreen: () => void;
        showToast: (msg: string) => void;
      }) => {
        enhanceArtboard: (artboard: HTMLElement, screenId: ScreenId) => void;
        closeTopOverlay?: () => boolean;
      };
    }
  ).__boopsInstall;
  if (boopsInstallFn) {
    boopsRuntime = boopsInstallFn({
      stage,
      getScreen: () => activeScreen,
      setScreen: (nextId: ScreenId) => {
        if (nextId !== activeScreen) {
          navigateTo(nextId);
        } else {
          renderActiveScreen();
        }
      },
      renderActiveScreen: () => renderActiveScreen(),
      showToast: (msg: string) => {
        toastEl.textContent = msg;
        toastEl.hidden = false;
        if (toastTimer != null) window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
          toastEl.hidden = true;
        }, 3200);
      },
    });
  }

  (globalThis as unknown as { __boopsHandleBack?: () => boolean }).__boopsHandleBack = () => {
    if (boopsRuntime?.closeTopOverlay?.()) return true;
    if (hudOpen) {
      hudOpen = false;
      updateHud();
      return true;
    }
    if (mobileNavOpen) {
      setMobileNavOpen(false);
      return true;
    }
    const prev = screenHistory.pop();
    if (prev && prev !== activeScreen) {
      navigateTo(prev, false);
      return true;
    }
    if (activeScreen !== "HealthHome") {
      navigateTo("HealthHome", false);
      return true;
    }
    return false;
  };

  renderActiveScreen();
}
