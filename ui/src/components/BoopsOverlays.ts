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
  const dayReadout = h("span", { className: "text-[12px] font-semibold text-[#111827] min-w-[78px]" }, "Day 96 / 180");

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
    const msg =
      engine.data_quality.reasons.length > 0
        ? `${engine.data_quality.status}: ${engine.data_quality.reasons.join("; ")} -> ${engine.data_quality.suggested_step}`
        : `Sensor quality OK (${astronautId} Day ${missionDay})`;
    cb.onToast(msg);
  });

  const guidesBtn = h("button", { type: "button", className: "boops-btn" }, "ⓘ Tool Guides");
  guidesBtn.addEventListener("click", () => openDrawer(activeGuideId));

  const exportBtn = h("button", { type: "button", className: "boops-btn boops-btn-dark" }, "Export / Summary");
  exportBtn.addEventListener("click", () => openExport());

  const emergencyBtn = h("button", { type: "button", className: "boops-btn boops-btn-danger" }, "Emergency Protocols");
  emergencyBtn.addEventListener("click", () => cb.onOpenEmergency());

  const demoStrip = h("div", { className: "boops-demo-strip" });
  const demoButtons = DEMO_JUMPS.map((jump) => {
    const btn = h("button", { type: "button", className: "boops-demo-chip", title: jump.note }, jump.label);
    btn.addEventListener("click", () => {
      cb.setContext(jump.astronautId, jump.missionDay, true);
      cb.onToast(`${jump.astronautId} Day ${jump.missionDay}: ${jump.note}`);
    });
    demoStrip.append(btn);
    return { jump, btn };
  });

  const topbar = h(
    "header",
    { className: "boops-topbar" },
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
        ),
        crewSelect,
        prevBtn,
        daySlider,
        nextBtn,
        dayReadout,
        dqBadge,
      ),
      h(
        "div",
        { className: "boops-topbar-group" },
        guidesBtn,
        exportBtn,
        emergencyBtn,
      ),
    ),
    demoStrip,
  );

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
      { className: "flex flex-wrap gap-1.5" },
      ...guides.map((g) => {
        const active = g.id === guide?.id;
        const p = h(
          "button",
          {
            type: "button",
            className: active ? "boops-btn boops-btn-dark text-[11px]" : "boops-btn text-[11px]",
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
        h("div", { className: "flex items-center justify-between" }, h("h2", { className: "text-[18px] font-bold" }, "Instrument Tool Guides"), closeBtn),
        h("p", { className: "text-[13px] text-[#6b7280]" }, "Offline bundle not loaded yet."),
      );
      return;
    }

    drawerPanel.replaceChildren(
      h(
        "div",
        { className: "flex items-center justify-between border-b border-[#e5e7eb] pb-3" },
        h(
          "div",
          null,
          h("span", { className: "text-[11px] font-semibold uppercase text-[#6b7280]" }, "OFFLINE INSTRUMENT GUIDE"),
          h("h2", { className: "text-[19px] font-semibold text-[#111827]" }, guide.title),
        ),
        closeBtn,
      ),
      pills,
      h(
        "div",
        { className: "bg-[#f9fafb] border border-[#e5e7eb] rounded-[14px] p-3.5" },
        h("p", { className: "text-[11px] font-bold uppercase text-[#6b7280] mb-1" }, "Why it matters"),
        h("p", { className: "text-[13px] text-[#111827] leading-[1.45]" }, guide.why_it_matters),
      ),
      h(
        "div",
        { className: "flex flex-col gap-1.5" },
        h("p", { className: "text-[11px] font-bold uppercase text-[#6b7280]" }, "Measurement steps"),
        ...guide.steps.map((s, idx) =>
          h(
            "div",
            { className: "flex items-start gap-2.5 bg-white border border-[#e5e7eb] rounded-[12px] p-3 text-[13px] text-[#111827]" },
            h("span", { className: "inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#111827] text-white text-[11px] font-semibold shrink-0" }, String(idx + 1)),
            h("span", null, s),
          ),
        ),
      ),
      h(
        "div",
        { className: "bg-[#fef3c7] border border-[#fde68a] rounded-[14px] p-3.5 flex flex-col gap-1" },
        h("p", { className: "text-[11px] font-bold uppercase text-[#92400e]" }, "Common mistakes"),
        ...guide.common_mistakes.map((m) => h("p", { className: "text-[12px] text-[#78350f]" }, `• ${m}`)),
      ),
      h(
        "div",
        { className: "bg-[#ecfdf5] border border-[#a7f3d0] rounded-[14px] p-3.5 flex flex-col gap-1" },
        h("p", { className: "text-[11px] font-bold uppercase text-[#065f46]" }, "How to fix an odd reading"),
        ...guide.how_to_fix_bad_reading.map((f) => h("p", { className: "text-[12px] text-[#064e3b]" }, `• ${f}`)),
      ),
      h(
        "p",
        { className: "text-[11px] text-[#6b7280]" },
        `Linked CSV / log fields: ${guide.linked_log_fields.join(", ")} · Prototype · Not a medical device`,
      ),
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
      className: "boops-input w-[84px]",
    }) as HTMLInputElement;
    const endInput = h("input", {
      type: "number",
      min: "1",
      max: "180",
      value: String(missionDay),
      className: "boops-input w-[84px]",
    }) as HTMLInputElement;

    const previewBox = h("div", { className: "flex flex-col gap-3" });

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
          { className: "bg-[#f9fafb] border border-[#e5e7eb] rounded-[14px] p-4 flex flex-col gap-2" },
          h(
            "div",
            { className: "flex items-center justify-between" },
            h("strong", { className: "text-[14px] text-[#111827]" }, `Flight-Surgeon Summary · ${profile.id} ${profile.name} (Days ${sDay}–${eDay})`),
            h("span", { className: "boops-tag-sim" }, "Simulated · Not a medical device"),
          ),
          h(
            "p",
            { className: "text-[12px] text-[#374151]" },
            emergencyOnly
              ? "Privacy filter active: Daily Summary OFF & Raw Data OFF -> Exporting EMERGENCY EVENTS ONLY (required for crew safety)."
              : latestSharing.raw_data
                ? "Sharing: Daily Summary + Raw Sensor Readings + Emergency Events (Always ON)."
                : "Sharing: Daily Risk Summary + Emergency Events (Always ON). Raw sensor data excluded.",
          ),
          last && latestSharing.daily_summary
            ? h(
                "p",
                { className: "text-[12px] text-[#111827]" },
                `Latest Day ${last.mission_day}: Immune ${formatRiskLevel(last.risks.immune.level)} (${last.risks.immune.score}), Bone/Muscle ${formatRiskLevel(last.risks.musculoskeletal.level)} (${last.risks.musculoskeletal.score}), Heart ${formatRiskLevel(last.risks.cardio.level)} (${last.risks.cardio.score})`,
              )
            : null,
          h(
            "p",
            { className: "text-[12px] text-[#991b1b] font-medium" },
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
        { className: "flex items-center justify-between border-b border-[#e5e7eb] pb-3" },
        h(
          "div",
          null,
          h("h2", { className: "text-[18px] font-semibold text-[#111827]" }, "Export & Flight-Surgeon Summary"),
          h("p", { className: "text-[12px] text-[#6b7280]" }, "100% offline · Honors crew-first sharing settings"),
        ),
        closeBtn,
      ),
      h(
        "div",
        { className: "flex flex-wrap items-center gap-3 boops-no-print" },
        h("label", { className: "text-[12px] font-medium flex items-center gap-1.5" }, "Start Day", startInput),
        h("label", { className: "text-[12px] font-medium flex items-center gap-1.5" }, "End Day", endInput),
        h(
          "button",
          {
            type: "button",
            className: "boops-btn text-[11px]",
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
            className: "boops-btn text-[11px]",
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
        { className: "flex flex-wrap items-center gap-4 text-[12px] boops-no-print" },
        h("label", { className: "flex items-center gap-1.5 cursor-pointer" }, dailyChk, "Share daily summary"),
        h("label", { className: "flex items-center gap-1.5 cursor-pointer" }, rawChk, "Share raw readings"),
        h("span", { className: "text-[#059669] font-medium" }, "✓ Emergency events: Always ON (locked)"),
      ),
      previewBox,
      h("div", { className: "flex flex-wrap items-center justify-end gap-2 boops-no-print" }, csvBtn, jsonBtn, printBtn),
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
    "B.O.O.P.S. (Biobehavioral Observation & Offline Predictive System) · Prototype · Not a medical device · Sample crew data labeled Simulated",
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
      dqBadge.title =
        engine.data_quality.reasons.join("; ") || "Readings consistent across sensors";
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
  };
}
