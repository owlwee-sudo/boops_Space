/**
 * BOOPS global interactive chrome:
 * - Sidebar chrome injected into every screen: Offline / Simulated tags beside the brand, action rows
 *   (Readings status, Tool Guides, Export / Summary) above the Emergency button, and the crew switcher
 *   inside the Profile card
 * - "Demo & debug" section with the Demo / Debug switch on the Settings screen
 * - Mission-day stepper in each page header (right of the title), so the app has no separate top bar
 * - Demo / Debug bar (day 1-180 slider, Demo Story jumps), hidden in the clean Crew App view
 * - Right-side Tool-Guide Drawer (7 measurement guides from content/tool_guides.json)
 * - Privacy-aware Export Modal (CSV, JSON, and Printable Flight-Surgeon Summary Sheet)
 * - Persistent safety disclaimer footer
 */

import "../styles/boops.css";
import { Activity, Bluetooth, BookOpen, ChevronsUpDown, Database, FileDown, createElement, type IconNode } from "lucide";
import { getDataMode, personalMissionDayToday } from "../services/dataMode";
import { h } from "../lib/dom";
import { type DeviceHubTab, createDeviceHubModal } from "./DeviceHubModal";
import { printDocumentWithNativeBridge } from "../services/nativeBridge";
import {
  CREW_PROFILES,
  DEMO_JUMPS,
  type BoopsBundle,
  type SharingSettings,
  buildExportPayload,
  downloadTextFile,
  formatExportCsv,
  formatRiskLevel,
  getCrewProfile,
  getDailyRecord,
  getEngineDay,
  getRangeSeries,
} from "../services/boopsData";

export type BoopsUiMode = "app" | "debug";

function detectInitialUiMode(): BoopsUiMode {
  if (getDataMode() === "mine") return "app";
  try {
    const url = new URL(window.location.href);
    const qMode = url.searchParams.get("mode")?.toLowerCase();
    const qDebug = url.searchParams.get("debug")?.toLowerCase();
    if (qMode === "debug" || qDebug === "1" || qDebug === "true") return "debug";
    if (qMode === "app" || qDebug === "0" || qDebug === "false") return "app";
    const preset = (window as unknown as { __BOOPS_DEFAULT_MODE?: string }).__BOOPS_DEFAULT_MODE;
    if (preset === "debug") return "debug";
    if (window.sessionStorage?.getItem("boops_ui_mode") === "debug") return "debug";
  } catch {
    // Ignore storage/URL errors in restricted offline contexts.
  }
  return "app";
}

export interface OverlayController {
  topbar: HTMLElement;
  footer: HTMLElement;
  drawerBackdrop: HTMLElement;
  exportBackdrop: HTMLElement;
  deviceHubBackdrop: HTMLElement;
  updateBar: () => void;
  openDrawer: (guideId?: string) => void;
  closeDrawer: () => void;
  openExport: () => void;
  closeExport: () => void;
  openDeviceHub: (tab?: DeviceHubTab) => void;
  closeTopOverlay: () => boolean;
  openCameraCheck: (simulated?: boolean) => void;
  getUiMode: () => BoopsUiMode;
  setUiMode: (mode: BoopsUiMode) => void;
  /** Places the shared controls into a freshly rendered screen (sidebar rows, Settings debug switch). */
  mountScreenControls: (artboard: HTMLElement, screenId: string) => void;
}

export interface OverlayCallbacks {
  getBundle: () => BoopsBundle | null;
  getContext: () => { astronautId: "A1" | "A2" | "A3"; missionDay: number; sharing: SharingSettings };
  setContext: (astronautId: "A1" | "A2" | "A3", missionDay: number, jumpHome?: boolean) => void;
  onToggleSharing: (key: "daily_summary" | "raw_data", val: boolean) => void;
  onDataIngested?: () => void;
  onOpenSettings?: () => void;
  onUiModeChange?: (mode: BoopsUiMode) => void;
  /** Opens the demo / my-data choice (welcome step 2). */
  onSwitchData?: () => void;
  onToast: (msg: string) => void;
}

/** Creates and wires all global BOOPS controls outside the Figma artboard. */
export function createBoopsOverlays(cb: OverlayCallbacks): OverlayController {
  let activeGuideId = "wearable_hrv_fit";
  let uiMode: BoopsUiMode = detectInitialUiMode();

  // -------------------------------------------------------------------------
  // 1. Sidebar controls + Demo / Debug bar
  // -------------------------------------------------------------------------
  const crewSelect = h(
    "select",
    { className: "boops-side-crew-select", "aria-label": "Select Astronaut", title: "Switch crew member" },
    ...CREW_PROFILES.map((c) => h("option", { value: c.id }, `${c.id} · ${c.name} (${c.role})`)),
  ) as HTMLSelectElement;

  crewSelect.addEventListener("change", () => {
    const wasFocused = document.activeElement === crewSelect;
    const { missionDay } = cb.getContext();
    const id = crewSelect.value as "A1" | "A2" | "A3";
    cb.setContext(id, missionDay, false);
    if (wasFocused && crewSelect.isConnected) {
      crewSelect.focus({ preventScroll: true });
    }
  });
  // The Profile card itself opens Settings on click; keep the crew picker from triggering that.
  crewSelect.addEventListener("click", (ev) => ev.stopPropagation());

  const topCrewSelect = h(
    "select",
    { className: "boops-topbar-crew-select", "aria-label": "Active crew member", title: "Switch crew member" },
    ...CREW_PROFILES.map((c) => h("option", { value: c.id }, `${c.id} · ${c.name} (${c.role})`)),
  ) as HTMLSelectElement;

  topCrewSelect.addEventListener("change", () => {
    const { missionDay } = cb.getContext();
    cb.setContext(topCrewSelect.value as "A1" | "A2" | "A3", missionDay, false);
  });

  const prevBtn = h(
    "button",
    { type: "button", className: "boops-stepper-btn", title: "Previous mission day", "aria-label": "Previous day" },
    "‹",
  );
  const nextBtn = h(
    "button",
    { type: "button", className: "boops-stepper-btn", title: "Next mission day", "aria-label": "Next day" },
    "›",
  );
  const todayBtn = h(
    "button",
    { type: "button", className: "boops-btn boops-today-btn", title: "Jump to current mission day" },
    "Today",
  );
  const daySlider = h("input", {
    type: "range",
    min: "1",
    max: "180",
    value: "45",
    className: "boops-day-slider",
    "aria-label": "Mission Day Slider",
  }) as HTMLInputElement;
  const dayReadout = h("span", { className: "boops-day-readout" }, "Day 45 / 180");

  prevBtn.addEventListener("click", () => {
    const { astronautId, missionDay } = cb.getContext();
    cb.setContext(astronautId, Math.max(1, missionDay - 1), false);
  });

  nextBtn.addEventListener("click", () => {
    const { astronautId, missionDay } = cb.getContext();
    cb.setContext(astronautId, Math.min(180, missionDay + 1), false);
  });

  todayBtn.addEventListener("click", () => {
    const { astronautId } = cb.getContext();
    const targetDay = getDataMode() === "mine" ? personalMissionDayToday() : uiMode === "debug" ? 96 : 45;
    cb.setContext(astronautId, targetDay, false);
  });

  daySlider.addEventListener("input", () => {
    const { astronautId } = cb.getContext();
    const nextDay = Math.max(1, Math.min(180, Number(daySlider.value) || 1));
    cb.setContext(astronautId, nextDay, false);
  });

  const dqBadge = h("span", { className: "boops-side-row-badge boops-dq-ok" }, "Sensor OK");
  const showReadingsStatus = () => {
    const bundle = cb.getBundle();
    const { astronautId, missionDay } = cb.getContext();
    const engine = getEngineDay(bundle, astronautId, missionDay);
    if (!engine) return;
    const anomalySuffix =
      typeof engine.data_quality.anomaly_score === "number"
        ? ` | Isolation Forest: ${engine.data_quality.anomaly_score.toFixed(2)}${engine.data_quality.anomaly_kind ? ` (${engine.data_quality.anomaly_kind})` : ""}`
        : "";
    const msg =
      engine.data_quality.reasons.length > 0
        ? `${engine.data_quality.status}: ${engine.data_quality.reasons.join("; ")} -> ${engine.data_quality.suggested_step}${anomalySuffix}`
        : `Sensor quality OK (${astronautId} Day ${missionDay})${anomalySuffix}`;
    cb.onToast(msg);
  };

  function launchCameraCheck(simulated = false) {
    const { astronautId } = cb.getContext();
    const qs = simulated ? `?sim=steady&astronaut=${encodeURIComponent(astronautId)}` : `?astronaut=${encodeURIComponent(astronautId)}`;
    const relUrl = `./camera/${qs}`;
    const proto = window.location.protocol;
    if (!proto.startsWith("http") && proto !== "boops-app:") {
      cb.onToast(`Run "python engine/server.py" and open http://127.0.0.1:8000/camera/${qs} for the camera check.`);
      return;
    }
    // Same tab: the camera check is a screen of the app (Health / Mindfulness), with its own back link.
    window.location.href = relUrl;
  }

  // Sidebar action rows: same shape as the Figma "Nav row" (18 px icon + label + optional badge).
  function sideRow(label: string, iconNode: IconNode, attrs: Record<string, string> = {}) {
    const iconEl = createElement(iconNode, { width: 18, height: 18, "stroke-width": 1.5, "aria-hidden": "true" });
    return h(
      "button",
      { type: "button", className: "boops-side-row", ...attrs },
      h("span", { className: "boops-side-row-icon" }, iconEl),
      h("span", { className: "boops-side-row-label" }, label),
    );
  }

  const statusBtn = sideRow("Readings", Activity);
  statusBtn.append(dqBadge);
  statusBtn.addEventListener("click", showReadingsStatus);

  // Sensors & Sync used to live in the top bar; it now sits with the other sidebar actions.
  const sensorsBtn = sideRow("Sensors & Sync", Bluetooth);
  sensorsBtn.addEventListener("click", () => deviceHub.open("health"));

  // Demo / My data switch: the badge says which data is on screen right now.
  const dataBtn = sideRow("Data", Database, { title: "Switch between the demo mission and your own data" });
  dataBtn.append(
    h("span", { className: "boops-side-row-badge boops-data-badge" }, getDataMode() === "mine" ? "My data" : "Demo"),
  );
  dataBtn.addEventListener("click", () => cb.onSwitchData?.());

  const guidesBtn = sideRow("Tool Guides", BookOpen);
  guidesBtn.addEventListener("click", () => openDrawer(activeGuideId));

  const exportBtn = sideRow("Export / Summary", FileDown);
  exportBtn.addEventListener("click", () => openExport());

  const sideActions = h(
    "div",
    { className: "boops-side-actions", "data-name": "Sidebar actions" },
    statusBtn,
    sensorsBtn,
    dataBtn,
    guidesBtn,
    exportBtn,
  );

  const brandTags = h(
    "span",
    { className: "boops-side-brand-tags" },
    h("span", { className: "boops-tag-offline" }, "Offline"),
    h("span", { className: "boops-tag-sim" }, "Simulated"),
  );
  const crewChevron = h(
    "span",
    { className: "boops-side-crew-chevron" },
    createElement(ChevronsUpDown, { width: 14, height: 14, "stroke-width": 1.5, "aria-hidden": "true" }),
  );

  // Demo / Debug switch on the Settings screen, rebuilt from the Figma "Data sharing" rows on each render.
  let modeSwitch: HTMLElement | null = null;

  function mountDebugSetting(artboard: HTMLElement) {
    modeSwitch = null;
    const left = artboard.querySelector<HTMLElement>('[data-name="Left"]');
    const rows = Array.from(left?.querySelectorAll<HTMLElement>(':scope > [data-name="Settings row"]') ?? []);
    const headers = Array.from(left?.querySelectorAll<HTMLElement>(':scope > [data-name="Section header"]') ?? []);
    const rowTemplate = rows.find((row) => row.querySelector('[data-name="Toggle"]'));
    const headerTemplate = headers[headers.length - 1];
    if (!left || !rowTemplate || !headerTemplate) return;

    const header = headerTemplate.cloneNode(true) as HTMLElement;
    const headerPs = header.querySelectorAll("p");
    if (headerPs[0]) headerPs[0].textContent = "Demo & debug";
    if (headerPs[1]) headerPs[1].textContent = "For demos and development · off in the crew view";

    const row = rowTemplate.cloneNode(true) as HTMLElement;
    const rowPs = row.querySelectorAll("p");
    if (rowPs[0]) rowPs[0].textContent = "Demo / Debug controls";
    if (rowPs[1]) rowPs[1].textContent = "Day 1–180 scrubber, demo story jumps and frame HUD";

    const toggle = row.querySelector<HTMLElement>('[data-name="Toggle"]');
    if (!toggle) return;
    toggle.setAttribute("data-boops-mode-toggle", "1");
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("tabindex", "0");
    toggle.setAttribute("aria-label", "Demo / Debug controls");
    toggle.style.cursor = "pointer";
    const flip = (ev: Event) => {
      ev.stopPropagation();
      const next: BoopsUiMode = uiMode === "app" ? "debug" : "app";
      setUiMode(next);
      cb.onToast(next === "debug" ? "Demo & Debug controls enabled" : "Switched to clean Crew App view");
    };
    toggle.addEventListener("click", flip);
    toggle.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      flip(ev);
    });

    modeSwitch = toggle;
    left.append(header, row);
    syncModeUi();
  }

  function mountScreenControls(artboard: HTMLElement, screenId: string) {
    // The simulated-mission debug tools make no sense on personal data.
    if (screenId === "SettingsProfile" && getDataMode() !== "mine") mountDebugSetting(artboard);
    const sidebar = artboard.querySelector<HTMLElement>('[data-name^="Sidebar/"]');
    if (!sidebar) return;
    sidebar.querySelector<HTMLElement>('[data-name="Brand"]')?.append(brandTags);
    // The Profile card already names the selected astronaut, so it doubles as the crew switcher.
    const profileCard = sidebar.querySelector<HTMLElement>('[data-name="Profile"]');
    const profileInfo = profileCard?.querySelector<HTMLElement>('[data-name="Info"]');
    if (profileInfo) {
      profileInfo.classList.add("boops-side-crew");
      profileInfo.append(crewChevron, crewSelect);
    }
    const settingsIcon = profileCard?.querySelector<HTMLElement>('[data-name="icon/settings"]');
    if (settingsIcon && !settingsIcon.dataset.boopsSettingsBound) {
      settingsIcon.dataset.boopsSettingsBound = "1";
      settingsIcon.classList.add("boops-side-settings-btn");
      settingsIcon.setAttribute("role", "button");
      settingsIcon.setAttribute("tabindex", "0");
      settingsIcon.setAttribute("aria-label", "Settings & profile");
      settingsIcon.setAttribute("title", "Settings & profile");
      settingsIcon.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        ev.stopPropagation();
        cb.onOpenSettings?.();
      });
    }
    const anchor = sidebar.querySelector<HTMLElement>('[data-name="Emergency button"]');
    if (anchor?.parentElement) anchor.parentElement.insertBefore(sideActions, anchor);
    else sidebar.append(sideActions);
    mountDayControls(artboard);
  }

  // The mission-day stepper sits on the right of each page title (no separate top bar).
  // Log screens already have a header action row there, so the stepper joins it.
  function mountDayControls(artboard: HTMLElement) {
    const logActions = artboard.querySelector<HTMLElement>("[data-boops-log-actions]");
    if (logActions) {
      logActions.prepend(dayGroup);
      return;
    }
    const tools = h(
      "div",
      { className: "boops-artboard-header-actions boops-page-tools", "data-boops-page-tools": "1" },
      dayGroup,
    );
    // Detail screens have a "← Home" pill in the top-right corner; sit just left of it.
    if (artboard.querySelector('[data-name="Back"]')) tools.classList.add("has-back");
    artboard.append(tools);
  }

  function syncModeUi() {
    document.documentElement.dataset.boopsMode = uiMode;
    topbar.dataset.boopsMode = uiMode;
    if (modeSwitch) {
      const debugOn = uiMode === "debug";
      modeSwitch.setAttribute("aria-checked", String(debugOn));
      modeSwitch
        .querySelector("img")
        ?.setAttribute("src", debugOn ? "./assets/figma/imgToggleOn.svg" : "./assets/figma/imgToggleOff.svg");
    }
  }

  function setUiMode(next: BoopsUiMode) {
    uiMode = next;
    try {
      window.sessionStorage?.setItem("boops_ui_mode", next);
    } catch {
      // Ignore storage errors.
    }
    syncModeUi();
    updateBar();
    cb.onUiModeChange?.(next);
  }

  const demoStrip = h("div", { className: "boops-demo-strip boops-debug-only" });
  const demoButtons = DEMO_JUMPS.map((jump) => {
    const btn = h("button", { type: "button", className: "boops-demo-chip", title: jump.note }, jump.label);
    btn.addEventListener("click", () => {
      cb.setContext(jump.astronautId, jump.missionDay, true);
      cb.onToast(`${jump.astronautId} Day ${jump.missionDay}: ${jump.note}`);
    });
    demoStrip.append(btn);
    return { jump, btn };
  });

  const dayStepper = h(
    "div",
    { className: "boops-date-stepper" },
    prevBtn,
    dayReadout,
    nextBtn,
  );
  // One node, moved into each freshly rendered screen by mountDayControls().
  const dayGroup = h("div", { className: "boops-day-group", role: "group", "aria-label": "Mission day" }, dayStepper, todayBtn);

  const scrubberGroup = h(
    "div",
    { className: "boops-topbar-group boops-debug-only", "data-boops-scrubber": "1" },
    h("span", { className: "boops-tag-debug" }, "Demo / Debug"),
    daySlider,
  );

  // Demo / Debug bar only: hidden in the clean Crew App view (see boops.css).
  // Everyday controls live in the sidebar (crew, sensors, guides, export) and the page header (day).
  const topbar = h(
    "header",
    { className: "boops-topbar", "data-boops-mode": uiMode },
    h(
      "div",
      { className: "boops-topbar-main" },
      h("div", { className: "boops-topbar-group" }, topCrewSelect),
      h("div", { className: "boops-topbar-group" }, scrubberGroup),
    ),
    demoStrip,
  );
  syncModeUi();

  // -------------------------------------------------------------------------
  // 2. Tool-Guide Drawer (all 7 offline guides from content/tool_guides.json)
  // -------------------------------------------------------------------------
  const drawerPanel = h("div", { className: "boops-drawer-panel" });
  const drawerBackdrop = h("div", { className: "boops-drawer-backdrop", hidden: true }, drawerPanel);
  drawerBackdrop.addEventListener("click", (ev) => {
    if (ev.target === drawerBackdrop) closeDrawer();
  });

  function renderDrawerContent() {
    const bundle = cb.getBundle();
    const guides = bundle?.toolGuides ?? [];
    const guide = guides.find((g) => g.id === activeGuideId) ?? guides[0];

    const closeBtn = h("button", { type: "button", className: "boops-btn" }, "Close ✕");
    closeBtn.addEventListener("click", () => closeDrawer());

    const pills = h(
      "div",
      { className: "boops-drawer-pills" },
      ...guides.map((g) => {
        const active = g.id === guide?.id;
        const p = h(
          "button",
          {
            type: "button",
            className: active
              ? "boops-btn boops-btn-dark boops-drawer-pill-btn"
              : "boops-btn boops-drawer-pill-btn",
          },
          g.title.replace(/ Guide$/i, "").replace(/ \(Microgravity Protocol\)/i, ""),
        );
        p.addEventListener("click", () => {
          activeGuideId = g.id;
          renderDrawerContent();
        });
        return p;
      }),
    );

    if (!guide) {
      drawerPanel.replaceChildren(
        h(
          "div",
          { className: "boops-drawer-head" },
          h("h2", { className: "boops-drawer-title" }, "Instrument Tool Guides"),
          closeBtn,
        ),
        h("p", { className: "boops-drawer-meta" }, "Offline bundle not loaded yet."),
      );
      return;
    }

    drawerPanel.replaceChildren(
      h(
        "div",
        { className: "boops-drawer-head" },
        h(
          "div",
          null,
          h("span", { className: "boops-drawer-kicker" }, "OFFLINE INSTRUMENT GUIDE"),
          h("h2", { className: "boops-drawer-title" }, guide.title),
        ),
        closeBtn,
      ),
      pills,
      h(
        "div",
        { className: "boops-drawer-card" },
        h("p", { className: "boops-drawer-label" }, "Why it matters"),
        h("p", { className: "boops-drawer-body" }, guide.why_it_matters),
      ),
      h(
        "div",
        { className: "boops-drawer-steps" },
        h("p", { className: "boops-drawer-label" }, "Measurement steps"),
        ...guide.steps.map((s, idx) =>
          h(
            "div",
            { className: "boops-drawer-step" },
            h("span", { className: "boops-drawer-step-num" }, String(idx + 1)),
            h("span", null, s),
          ),
        ),
      ),
      h(
        "div",
        { className: "boops-drawer-card boops-drawer-card-warn" },
        h("p", { className: "boops-drawer-label boops-drawer-label-warn" }, "Common mistakes"),
        ...guide.common_mistakes.map((m) =>
          h("p", { className: "boops-drawer-bullet boops-drawer-bullet-warn" }, `• ${m}`),
        ),
      ),
      h(
        "div",
        { className: "boops-drawer-card boops-drawer-card-ok" },
        h("p", { className: "boops-drawer-label boops-drawer-label-ok" }, "How to fix an odd reading"),
        ...guide.how_to_fix_bad_reading.map((f) =>
          h("p", { className: "boops-drawer-bullet boops-drawer-bullet-ok" }, `• ${f}`),
        ),
      ),
      h(
        "p",
        { className: "boops-drawer-meta" },
        `Linked CSV / log fields: ${guide.linked_log_fields.join(", ")} · Prototype · Not a medical device`,
      ),
      ...(guide.id.includes("camera") || guide.id.includes("rppg")
        ? [
            h(
              "div",
              { className: "boops-drawer-actions" },
              h(
                "button",
                {
                  type: "button",
                  className: "boops-btn boops-btn-dark",
                  onClick: () => launchCameraCheck(false),
                },
                "Open Live Camera Check ↗",
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "boops-btn boops-debug-only",
                  onClick: () => launchCameraCheck(true),
                },
                "Open Simulated Demo (?sim=steady) ↗",
              ),
            ),
          ]
        : []),
    );
  }

  function openDrawer(guideId?: string) {
    if (guideId) activeGuideId = guideId;
    renderDrawerContent();
    drawerBackdrop.hidden = false;
  }

  function closeDrawer() {
    drawerBackdrop.hidden = true;
  }

  // -------------------------------------------------------------------------
  // 3. Privacy-Respecting Export & Flight-Surgeon Summary Modal
  // -------------------------------------------------------------------------
  const modalCard = h("div", { className: "boops-modal-card" });
  const exportBackdrop = h("div", { className: "boops-modal-backdrop", hidden: true }, modalCard);
  exportBackdrop.addEventListener("click", (ev) => {
    if (ev.target === exportBackdrop) closeExport();
  });

  function renderExportModal() {
    const bundle = cb.getBundle();
    const { astronautId, missionDay, sharing } = cb.getContext();
    const profile = getCrewProfile(astronautId);

    const startInput = h("input", {
      type: "number",
      min: "1",
      max: "180",
      value: String(Math.max(1, missionDay - 14)),
      className: "boops-input boops-modal-input-num",
    }) as HTMLInputElement;
    const endInput = h("input", {
      type: "number",
      min: "1",
      max: "180",
      value: String(missionDay),
      className: "boops-input boops-modal-input-num",
    }) as HTMLInputElement;

    const previewBox = h("div", { className: "boops-modal-preview-wrap" });

    const refreshPreview = () => {
      if (!bundle) return;
      const sDay = Math.max(1, Math.min(180, Number(startInput.value) || 1));
      const eDay = Math.max(sDay, Math.min(180, Number(endInput.value) || 180));
      const { sharing: latestSharing } = cb.getContext();
      const series = getRangeSeries(bundle, astronautId, sDay, eDay);
      const alerts = series.filter(
        ({ engine }) =>
          engine.flags.infection_early_warning ||
          engine.risks.immune.level === "act" ||
          engine.risks.musculoskeletal.level === "act" ||
          engine.risks.cardio.level === "act",
      );
      const last = series[series.length - 1]?.engine;
      const emergencyOnly = !latestSharing.daily_summary && !latestSharing.raw_data;

      previewBox.replaceChildren(
        h(
          "div",
          { className: "boops-modal-preview" },
          h(
            "div",
            { className: "boops-modal-preview-head" },
            h(
              "strong",
              { className: "boops-modal-preview-title" },
              `Flight-Surgeon Summary · ${profile.id} ${profile.name} (Days ${sDay}–${eDay})`,
            ),
            h(
              "span",
              { className: uiMode === "debug" ? "boops-tag-sim" : "boops-tag-offline" },
              uiMode === "debug" ? "Simulated · Not a medical device" : "Offline · Not a medical device",
            ),
          ),
          h(
            "p",
            { className: "boops-modal-preview-body" },
            emergencyOnly
              ? "Privacy filter active: Daily Summary OFF & Raw Data OFF -> Exporting EMERGENCY EVENTS ONLY (required for crew safety)."
              : latestSharing.raw_data
                ? "Sharing: Daily Summary + Raw Sensor Readings + Emergency Events (Always ON)."
                : "Sharing: Daily Risk Summary + Emergency Events (Always ON). Raw sensor data excluded.",
          ),
          last && latestSharing.daily_summary
            ? h(
                "p",
                { className: "boops-modal-preview-strong" },
                `Latest Day ${last.mission_day}: Immune ${formatRiskLevel(last.risks.immune.level)} (${last.risks.immune.score}), Bone/Muscle ${formatRiskLevel(last.risks.musculoskeletal.level)} (${last.risks.musculoskeletal.score}), Heart ${formatRiskLevel(last.risks.cardio.level)} (${last.risks.cardio.score})`,
              )
            : null,
          h(
            "p",
            { className: "boops-modal-preview-alert" },
            `Flagged Act / Early-Warning days in window: ${alerts.length > 0 ? alerts.map((a) => `Day ${a.engine.mission_day}`).join(", ") : "None"}`,
          ),
        ),
      );
    };

    const dailyChk = h("input", { type: "checkbox", checked: sharing.daily_summary }) as HTMLInputElement;
    const rawChk = h("input", { type: "checkbox", checked: sharing.raw_data }) as HTMLInputElement;
    dailyChk.addEventListener("change", () => {
      cb.onToggleSharing("daily_summary", dailyChk.checked);
      refreshPreview();
    });
    rawChk.addEventListener("change", () => {
      cb.onToggleSharing("raw_data", rawChk.checked);
      refreshPreview();
    });

    startInput.addEventListener("change", refreshPreview);
    endInput.addEventListener("change", refreshPreview);

    const closeBtn = h("button", { type: "button", className: "boops-btn boops-no-print" }, "Close ✕");
    closeBtn.addEventListener("click", () => closeExport());

    const csvBtn = h("button", { type: "button", className: "boops-btn boops-no-print" }, "Download CSV");
    csvBtn.addEventListener("click", () => {
      if (!bundle) return;
      const sDay = Math.max(1, Math.min(180, Number(startInput.value) || 1));
      const eDay = Math.max(sDay, Math.min(180, Number(endInput.value) || 180));
      const payload = buildExportPayload(bundle, astronautId, sDay, eDay, cb.getContext().sharing);
      const csv = formatExportCsv(payload.rows);
      const ok = downloadTextFile(`boops_${astronautId}_d${sDay}_d${eDay}.csv`, csv, "text/csv;charset=utf-8");
      cb.onToast(ok ? `Downloaded ${payload.rows.length} rows as CSV` : "CSV download blocked by browser");
    });

    const jsonBtn = h("button", { type: "button", className: "boops-btn boops-no-print" }, "Download JSON");
    jsonBtn.addEventListener("click", () => {
      if (!bundle) return;
      const sDay = Math.max(1, Math.min(180, Number(startInput.value) || 1));
      const eDay = Math.max(sDay, Math.min(180, Number(endInput.value) || 180));
      const payload = buildExportPayload(bundle, astronautId, sDay, eDay, cb.getContext().sharing);
      const ok = downloadTextFile(
        `boops_${astronautId}_d${sDay}_d${eDay}.json`,
        JSON.stringify(payload, null, 2),
        "application/json",
      );
      cb.onToast(ok ? `Downloaded ${payload.rows.length} rows as JSON` : "JSON download blocked by browser");
    });

    const printBtn = h(
      "button",
      { type: "button", className: "boops-btn boops-btn-dark boops-no-print" },
      "Print Flight-Surgeon Summary (PDF)",
    );
    printBtn.addEventListener("click", () => {
      if (printDocumentWithNativeBridge("BOOPS_Flight_Surgeon_Summary")) return;
      try {
        window.print();
      } catch {
        cb.onToast("Use Cmd+P / Ctrl+P to save the Flight-Surgeon Summary as PDF");
      }
    });

    modalCard.replaceChildren(
      h(
        "div",
        { className: "boops-modal-head" },
        h(
          "div",
          null,
          h("h2", { className: "boops-modal-title" }, "Export & Flight-Surgeon Summary"),
          h("p", { className: "boops-modal-sub" }, "100% offline · Honors crew-first sharing settings"),
        ),
        closeBtn,
      ),
      h(
        "div",
        { className: "boops-modal-row boops-no-print" },
        h("label", { className: "boops-modal-label" }, "Start Day", startInput),
        h("label", { className: "boops-modal-label" }, "End Day", endInput),
        h(
          "button",
          {
            type: "button",
            className: "boops-btn boops-drawer-pill-btn",
            onClick: () => {
              startInput.value = "85";
              endInput.value = "100";
              refreshPreview();
            },
          },
          "Critical d85–100",
        ),
        h(
          "button",
          {
            type: "button",
            className: "boops-btn boops-drawer-pill-btn",
            onClick: () => {
              startInput.value = "1";
              endInput.value = "180";
              refreshPreview();
            },
          },
          "Full 180d",
        ),
      ),
      h(
        "div",
        { className: "boops-modal-row boops-no-print" },
        h("label", { className: "boops-modal-check" }, dailyChk, "Share daily summary"),
        h("label", { className: "boops-modal-check" }, rawChk, "Share raw readings"),
        h("span", { className: "boops-modal-locked" }, "✓ Emergency events: Always ON (locked)"),
      ),
      previewBox,
      h("div", { className: "boops-modal-actions boops-no-print" }, csvBtn, jsonBtn, printBtn),
    );

    refreshPreview();
  }

  function openExport() {
    renderExportModal();
    exportBackdrop.hidden = false;
  }

  function closeExport() {
    exportBackdrop.hidden = true;
  }

  // -------------------------------------------------------------------------
  // 4. Persistent Footer & Bar Refresh
  // -------------------------------------------------------------------------
  const footer = h(
    "footer",
    { className: "boops-footer" },
    h(
      "span",
      null,
      "BOOPS (Biobehavioral Observation & Offline Predictive System) · Prototype · Not a medical device",
      h("span", { className: "boops-debug-only" }, " · Sample crew data labeled Simulated"),
    ),
  );

  function updateBar() {
    const { astronautId, missionDay } = cb.getContext();
    crewSelect.value = astronautId;
    topCrewSelect.value = astronautId;
    daySlider.value = String(missionDay);

    const bundle = cb.getBundle();
    const rec = getDailyRecord(bundle, astronautId, missionDay);
    const defaultDay = getDataMode() === "mine" ? personalMissionDayToday() : uiMode === "debug" ? 96 : 45;
    dayReadout.textContent = rec?.date ? `Day ${missionDay} / 180 · ${rec.date}` : `Day ${missionDay} / 180`;
    todayBtn.textContent = "Today";
    todayBtn.title = `Jump to today (mission day ${defaultDay})`;
    todayBtn.classList.toggle("is-current-day", missionDay === defaultDay);

    const engine = getEngineDay(bundle, astronautId, missionDay);
    if (engine) {
      const status = engine.data_quality.status;
      dqBadge.className = `boops-side-row-badge boops-dq-${status}`;
      dqBadge.textContent =
        status === "check_device"
          ? "Check device"
          : status === "check_yourself"
            ? "Check yourself"
            : status === "act_now"
              ? "Act now"
              : "Sensor OK";
      const anomalyMeta =
        typeof engine.data_quality.anomaly_score === "number"
          ? ` | Isolation Forest score: ${engine.data_quality.anomaly_score.toFixed(2)}${engine.data_quality.anomaly_kind ? ` (${engine.data_quality.anomaly_kind})` : ""}`
          : "";
      statusBtn.title =
        (engine.data_quality.reasons.join("; ") || "Readings consistent across sensors") + anomalyMeta;
    }

    for (const { jump, btn } of demoButtons) {
      btn.classList.toggle("is-active", jump.astronautId === astronautId && jump.missionDay === missionDay);
    }
  }

  const deviceHub = createDeviceHubModal({
    getBundle: cb.getBundle,
    getContext: cb.getContext,
    onDataIngested: () => {
      updateBar();
      cb.onDataIngested?.();
    },
    onToast: cb.onToast,
  });

  return {
    topbar,
    footer,
    drawerBackdrop,
    exportBackdrop,
    deviceHubBackdrop: deviceHub.backdrop,
    updateBar,
    openDrawer,
    closeDrawer,
    openExport,
    closeExport,
    openDeviceHub: (tab) => deviceHub.open(tab),
    closeTopOverlay: () => {
      if (deviceHub.isOpen()) {
        deviceHub.close();
        return true;
      }
      if (!exportBackdrop.hidden) {
        closeExport();
        return true;
      }
      if (!drawerBackdrop.hidden) {
        closeDrawer();
        return true;
      }
      return false;
    },
    openCameraCheck: (simulated = false) => launchCameraCheck(simulated),
    getUiMode: () => uiMode,
    setUiMode,
    mountScreenControls,
  };
}
