/**
 * B.O.O.P.S. global interactive chrome:
 * - Mission Control Bar (crew selector, day 1-180 slider, Demo Story jumps, Data-Quality badge)
 * - Right-side Tool-Guide Drawer (7 measurement guides from content/tool_guides.json)
 * - Privacy-aware Export Modal (CSV, JSON, and Printable Flight-Surgeon Summary Sheet)
 * - Persistent safety disclaimer footer
 */

import "../styles/boops.css";
import { h } from "../lib/dom";
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
  getEngineDay,
  getRangeSeries,
} from "../services/boopsData";

export type BoopsUiMode = "app" | "debug";

function detectInitialUiMode(): BoopsUiMode {
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
  updateBar: () => void;
  openDrawer: (guideId?: string) => void;
  closeDrawer: () => void;
  openExport: () => void;
  closeExport: () => void;
  openCameraCheck: (simulated?: boolean) => void;
  getUiMode: () => BoopsUiMode;
  setUiMode: (mode: BoopsUiMode) => void;
}

export interface OverlayCallbacks {
  getBundle: () => BoopsBundle | null;
  getContext: () => { astronautId: "A1" | "A2" | "A3"; missionDay: number; sharing: SharingSettings };
  setContext: (astronautId: "A1" | "A2" | "A3", missionDay: number, jumpHome?: boolean) => void;
  onToggleSharing: (key: "daily_summary" | "raw_data", val: boolean) => void;
  onOpenEmergency: () => void;
  onToast: (msg: string) => void;
}

/** Creates and wires all global B.O.O.P.S. controls outside the Figma artboard. */
export function createBoopsOverlays(cb: OverlayCallbacks): OverlayController {
  let activeGuideId = "wearable_hrv_fit";
  let uiMode: BoopsUiMode = detectInitialUiMode();

  // -------------------------------------------------------------------------
  // 1. Mission Control Bar
  // -------------------------------------------------------------------------
  const crewSelect = h(
    "select",
    { className: "boops-select", "aria-label": "Select Astronaut" },
    ...CREW_PROFILES.map((c) => h("option", { value: c.id }, `${c.id} · ${c.name} (${c.role})`)),
  ) as HTMLSelectElement;

  crewSelect.addEventListener("change", () => {
    const { missionDay } = cb.getContext();
    const id = crewSelect.value as "A1" | "A2" | "A3";
    cb.setContext(id, missionDay, false);
  });

  const prevBtn = h("button", { type: "button", className: "boops-btn", title: "Previous mission day" }, "◀");
  const nextBtn = h("button", { type: "button", className: "boops-btn", title: "Next mission day" }, "▶");
  const daySlider = h("input", {
    type: "range",
    min: "1",
    max: "180",
    value: "96",
    className: "boops-day-slider",
    "aria-label": "Mission Day Slider",
  }) as HTMLInputElement;
  const dayReadout = h("span", { className: "boops-day-readout" }, "Day 96 / 180");

  prevBtn.addEventListener("click", () => {
    const { astronautId, missionDay } = cb.getContext();
    cb.setContext(astronautId, Math.max(1, missionDay - 1), false);
  });

  nextBtn.addEventListener("click", () => {
    const { astronautId, missionDay } = cb.getContext();
    cb.setContext(astronautId, Math.min(180, missionDay + 1), false);
  });

  daySlider.addEventListener("input", () => {
    const { astronautId } = cb.getContext();
    const nextDay = Math.max(1, Math.min(180, Number(daySlider.value) || 1));
    cb.setContext(astronautId, nextDay, false);
  });

  const dqBadge = h("button", { type: "button", className: "boops-dq-pill boops-dq-ok" }, "Sensor OK");
  dqBadge.addEventListener("click", () => {
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
  });

  function launchCameraCheck(simulated = false) {
    const { astronautId } = cb.getContext();
    const qs = simulated ? `?sim=steady&astronaut=${encodeURIComponent(astronautId)}` : `?astronaut=${encodeURIComponent(astronautId)}`;
    const relUrl = `./camera/${qs}`;
    if (!window.location.protocol.startsWith("http")) {
      cb.onToast(`Run "python engine/server.py" and open http://127.0.0.1:8000/camera/${qs} for the camera check.`);
      return;
    }
    const opened = window.open(relUrl, "_blank", "noopener");
    if (!opened) window.location.href = relUrl;
  }

  const guidesBtn = h("button", { type: "button", className: "boops-btn" }, "ⓘ Tool Guides");
  guidesBtn.addEventListener("click", () => openDrawer(activeGuideId));

  const exportBtn = h("button", { type: "button", className: "boops-btn boops-btn-dark" }, "Export / Summary");
  exportBtn.addEventListener("click", () => openExport());

  const emergencyBtn = h("button", { type: "button", className: "boops-btn boops-btn-danger" }, "Emergency Protocols");
  emergencyBtn.addEventListener("click", () => cb.onOpenEmergency());

  const modeToggleBtn = h(
    "button",
    {
      type: "button",
      className: "boops-btn boops-mode-toggle",
      "data-boops-mode-toggle": "1",
      title: "Switch between clean Crew App view and Demo / Debug controls",
    },
    "Demo / Debug",
  );

  function syncModeUi() {
    document.documentElement.dataset.boopsMode = uiMode;
    topbar.dataset.boopsMode = uiMode;
    if (uiMode === "debug") {
      modeToggleBtn.textContent = "← App View";
      modeToggleBtn.classList.add("is-active");
      modeToggleBtn.title = "Switch back to clean Crew App interface";
    } else {
      modeToggleBtn.textContent = "Demo / Debug";
      modeToggleBtn.classList.remove("is-active");
      modeToggleBtn.title = "Open Demo & Debug controls (Day 1–180 scrubber, presets, frame HUD)";
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
  }

  modeToggleBtn.addEventListener("click", () => {
    const next: BoopsUiMode = uiMode === "app" ? "debug" : "app";
    setUiMode(next);
    cb.onToast(next === "debug" ? "Demo & Debug controls enabled" : "Switched to clean Crew App view");
  });

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

  const scrubberGroup = h(
    "div",
    { className: "boops-topbar-group boops-debug-only", "data-boops-scrubber": "1" },
    prevBtn,
    daySlider,
    nextBtn,
  );

  const topbar = h(
    "header",
    { className: "boops-topbar", "data-boops-mode": uiMode },
    h(
      "div",
      { className: "boops-topbar-main" },
      h(
        "div",
        { className: "boops-topbar-group" },
        h(
          "span",
          { className: "boops-brand-pill" },
          "B.O.O.P.S.",
          h("span", { className: "boops-tag-offline" }, "Offline"),
          h("span", { className: "boops-tag-sim" }, "Simulated"),
          h("span", { className: "boops-tag-debug boops-debug-only" }, "Demo / Debug"),
        ),
        crewSelect,
        scrubberGroup,
        dayReadout,
        dqBadge,
      ),
      h(
        "div",
        { className: "boops-topbar-group" },
        guidesBtn,
        exportBtn,
        emergencyBtn,
        modeToggleBtn,
      ),
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
                  className: "boops-btn",
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
            h("span", { className: "boops-tag-sim" }, "Simulated · Not a medical device"),
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
      "B.O.O.P.S. (Biobehavioral Observation & Offline Predictive System) · Prototype · Not a medical device · Sample crew data labeled Simulated",
    ),
  );

  function updateBar() {
    const { astronautId, missionDay } = cb.getContext();
    crewSelect.value = astronautId;
    daySlider.value = String(missionDay);
    dayReadout.textContent = `Day ${missionDay} / 180`;

    const bundle = cb.getBundle();
    const engine = getEngineDay(bundle, astronautId, missionDay);
    if (engine) {
      const status = engine.data_quality.status;
      dqBadge.className = `boops-dq-pill boops-dq-${status}`;
      dqBadge.textContent =
        status === "check_device"
          ? "⚠ Check device"
          : status === "check_yourself"
            ? "⚠ Check yourself"
            : status === "act_now"
              ? "🚨 Act now"
              : "✓ Sensor OK";
      const anomalyMeta =
        typeof engine.data_quality.anomaly_score === "number"
          ? ` | Isolation Forest score: ${engine.data_quality.anomaly_score.toFixed(2)}${engine.data_quality.anomaly_kind ? ` (${engine.data_quality.anomaly_kind})` : ""}`
          : "";
      dqBadge.title =
        (engine.data_quality.reasons.join("; ") || "Readings consistent across sensors") + anomalyMeta;
    }

    for (const { jump, btn } of demoButtons) {
      btn.classList.toggle("is-active", jump.astronautId === astronautId && jump.missionDay === missionDay);
    }
  }

  return {
    topbar,
    footer,
    drawerBackdrop,
    exportBackdrop,
    updateBar,
    openDrawer,
    closeDrawer,
    openExport,
    closeExport,
    openCameraCheck: (simulated = false) => launchCameraCheck(simulated),
    getUiMode: () => uiMode,
    setUiMode,
  };
}
