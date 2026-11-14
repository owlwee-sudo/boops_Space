/**
 * Hydrates rendered Figma 52-screen artboards with live B.O.O.P.S. engine outputs,
 * daily telemetry, tool-guide hooks, emergency protocols, and sharing controls.
 */

import { h } from "../lib/dom";
import type { ScreenId } from "../screens";
import {
  CREW_PROFILES,
  type BoopsBundle,
  type DailyRecordRow,
  type EmergencyProtocol,
  type EngineDayOutput,
  type SharingSettings,
  appendManualLog,
  dotForLevel,
  formatRiskLevel,
  formatStars,
  getCrewProfile,
  getCumulativeRadiation,
  getDailyRecord,
  getEngineDay,
  getRangeSeries,
  getSourceCitation,
  loadChecklistTimestamps,
  loadManualLogs,
  toggleChecklistTimestamp,
} from "../services/boopsData";

export interface AppContextState {
  astronautId: "A1" | "A2" | "A3";
  missionDay: number;
  activeEmergencyId: string;
  emergencyPatientId: "A1" | "A2" | "A3";
  sharing: SharingSettings;
  onChangeEmergencyPatient: (id: "A1" | "A2" | "A3") => void;
  onToggleSharing: (key: "daily_summary" | "raw_data" | { risk: string }, nextVal: boolean) => void;
  openToolGuide: (guideId: string) => void;
  openEmergencyProtocol: (protocolId: string) => void;
  openRiskScreen: (riskKey: "immune" | "musculoskeletal" | "cardio") => void;
  showToast: (msg: string) => void;
}

/** Finds direct or descendant paragraph text nodes inside an element by exact or partial match. */
function setParagraphs(root: Element, updates: Array<[number, string]>): void {
  const ps = root.querySelectorAll("p");
  for (const [idx, val] of updates) {
    if (ps[idx]) ps[idx].textContent = val;
  }
}

/** Rewrites root-relative /assets paths to ./assets for file:// offline support and updates branding. */
export function normalizeOfflineAssetsAndBrand(artboard: HTMLElement): void {
  artboard.querySelectorAll<HTMLImageElement>("img[src]").forEach((img) => {
    const raw = img.getAttribute("src") ?? "";
    if (raw.startsWith("/assets/")) {
      img.setAttribute("src", `.${raw}`);
    }
  });

  artboard.querySelectorAll("p").forEach((p) => {
    if (p.textContent?.trim() === "[Name TBD]") {
      p.textContent = "B.O.O.P.S.";
    }
  });
}

/** Updates a metric card with current numeric value, unit, subtitle, badge, and normalized sparkline. */
function hydrateMetricCard(
  card: Element,
  valueText: string,
  unitText: string,
  subtitleText: string,
  statusText: string,
  dotPath: string,
  sparkSeries?: number[],
): void {
  const statusEl = card.querySelector('[data-name="Status"]');
  if (statusEl) {
    const statusDot = statusEl.querySelector("img");
    if (statusDot) statusDot.setAttribute("src", dotPath);
    const statusP = statusEl.querySelector("p");
    if (statusP) statusP.textContent = statusText;
  }

  const valRow = card.querySelector('[data-name="Value row"]');
  if (valRow) {
    const ps = valRow.querySelectorAll("p");
    if (ps[0]) ps[0].textContent = valueText;
    if (ps[1] && unitText) ps[1].textContent = unitText;
  }

  // Subtitle is the direct <p> after [data-name="Value row"]
  const directPs = Array.from(card.children).filter((el) => el.tagName === "P");
  if (directPs[0]) {
    directPs[0].textContent = subtitleText;
  }

  if (sparkSeries && sparkSeries.length > 0) {
    const spark = card.querySelector('[data-name="Sparkline"]');
    if (spark) applySparklineBars(spark, sparkSeries, 8, 28);
  }
}

/** Applies scaled bar heights inside a sparkline or chart container. */
function applySparklineBars(
  container: Element,
  values: number[],
  minPx: number,
  maxPx: number,
  colorFn?: (val: number, idx: number) => string,
): void {
  const bars = Array.from(container.querySelectorAll('[data-name="Bar"]')) as HTMLElement[];
  if (bars.length === 0 || values.length === 0) return;

  const slice = values.slice(-bars.length);
  const minVal = Math.min(...slice);
  const maxVal = Math.max(...slice);
  const span = Math.max(1e-6, maxVal - minVal);

  bars.forEach((bar, i) => {
    const offset = i - (bars.length - slice.length);
    if (offset < 0) {
      bar.style.height = `${minPx}px`;
      bar.style.opacity = "0.22";
      return;
    }
    const v = slice[offset];
    const ratio = (v - minVal) / span;
    const hPx = Math.round(minPx + ratio * (maxPx - minPx));
    bar.style.height = `${hPx}px`;
    bar.style.opacity = "1";
    bar.title = `Value: ${Math.round(v * 10) / 10}`;
    if (colorFn) {
      bar.style.backgroundColor = colorFn(v, offset);
    }
  });
}

/** Updates a left Score card (Health Score, Sleep Score, Stress Score, Risk Summary, Mission Dose). */
function hydrateScoreCard(
  card: Element,
  title: string,
  bigText: string,
  subText: string,
  sparkValues?: number[],
  tagText = "Simulated",
  tooltipNote?: string,
): void {
  const top = card.querySelector('[data-name="Top"]');
  if (top) {
    const ps = top.querySelectorAll("p");
    if (ps[0] && title) ps[0].textContent = title;
    if (ps[1]) ps[1].textContent = bigText;
    if (ps[2]) ps[2].textContent = subText;
    const tagP = top.querySelector('[data-name="Data tag"] p');
    if (tagP) tagP.textContent = tagText;
  }

  if (sparkValues && sparkValues.length > 0) {
    const trend = card.querySelector('[data-name="Trend"]');
    if (trend) applySparklineBars(trend, sparkValues, 8, 32);
  }

  if (tooltipNote) {
    const infoEl = card.querySelector('[data-name="icon/info"]') ?? card.querySelector('[data-name="Info"]');
    if (infoEl) {
      (infoEl as HTMLElement).title = tooltipNote;
    }
  }
}

/** Updates the shared Sidebar profile card and dynamic status badges. */
function hydrateSidebar(
  artboard: HTMLElement,
  engine: EngineDayOutput | null,
  record: DailyRecordRow | null,
  state: AppContextState,
): void {
  const profile = getCrewProfile(state.astronautId);
  const profileCard = artboard.querySelector('[data-name="Profile"] [data-name="Info"]');
  if (profileCard) {
    setParagraphs(profileCard, [
      [0, `${profile.id} · ${profile.name}`],
      [1, `${profile.role} · Day ${state.missionDay}`],
    ]);
  }

  if (!engine || !record) return;

  const radLevel = record.radiation_msv >= 1.5 ? "Act" : record.radiation_msv >= 0.8 ? "Watch" : "Normal";
  const vitalsLabel =
    engine.data_quality.status === "check_device"
      ? "Check"
      : formatRiskLevel(engine.risks.cardio.level);
  const sleepLabel = engine.sleep_score < 45 ? "Watch" : "Normal";
  const stressLabel = engine.stress_score >= 70 ? "Act" : engine.stress_score >= 45 ? "Watch" : "Normal";

  const badgeMap: Record<string, string> = {
    "Nav row/Environment": radLevel,
    "Nav row/Vitals": vitalsLabel,
    "Nav row/Sleep": sleepLabel,
    "Nav row/Mindfulness": stressLabel,
  };

  for (const [navName, text] of Object.entries(badgeMap)) {
    const navRow = artboard.querySelector(`[data-name="${navName}"]`);
    const badgeP = navRow?.querySelector('[data-name="Badge"] p');
    if (badgeP) badgeP.textContent = text;
  }
}

/** Returns compact status summary label for data_quality.status. */
function formatDqLabel(status: EngineDayOutput["data_quality"]["status"]): string {
  switch (status) {
    case "check_device":
      return "Check device";
    case "check_yourself":
      return "Check yourself";
    case "act_now":
      return "Act now";
    default:
      return "Sensor OK";
  }
}

/** Binds the Home screen to real engine data, alert banners, and why/how-to-fix cards. */
function hydrateHealthHome(
  artboard: HTMLElement,
  bundle: BoopsBundle,
  engine: EngineDayOutput,
  record: DailyRecordRow,
  state: AppContextState,
): void {
  const profile = getCrewProfile(state.astronautId);
  const inAdaptation = state.missionDay <= 14;
  const pageHeader = artboard.querySelector('[data-name="Page header"]');
  if (pageHeader) {
    const subParts = [
      `Mission Day ${state.missionDay} of 180`,
      record.date,
      `${profile.id} ${profile.name}`,
      inAdaptation ? "Adaptation phase (alerts dampened)" : formatDqLabel(engine.data_quality.status),
      "Simulated",
    ];
    setParagraphs(pageHeader, [[1, subParts.join(" · ")]]);
  }

  // Alert banner: SPE > Early Warning > Check Device > Risk Act/Watch > Nominal
  const banner = artboard.querySelector('[data-name="Alert banner"]') as HTMLElement | null;
  if (banner) {
    const bannerIcon = banner.querySelector("img");
    const bannerPs = banner.querySelectorAll("p");
    const bannerAction = banner.querySelector('[data-name="Button"]') as HTMLElement | null;
    const cloneActionBtn = bannerAction?.cloneNode(true) as HTMLElement | null;

    if (record.radiation_msv >= 1.5) {
      banner.style.backgroundColor = "#fee2e2";
      banner.style.border = "1.5px solid #ef4444";
      if (bannerIcon) bannerIcon.setAttribute("src", "./assets/figma/imgIconAlertDanger.svg");
      if (bannerPs[0]) bannerPs[0].textContent = `Solar Particle Event (SPE) · Dose ${record.radiation_msv.toFixed(2)} mSv`;
      if (bannerPs[1]) bannerPs[1].textContent = "Move to shielded storm shelter now · NOAA SWPC GOES / OSDR RadLab model";
      if (cloneActionBtn) {
        const bp = cloneActionBtn.querySelector("p");
        if (bp) bp.textContent = "Shelter protocol";
        cloneActionBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          state.openEmergencyProtocol("solar_radiation_storm");
        });
        bannerAction?.replaceWith(cloneActionBtn);
      }
    } else if (engine.flags.infection_early_warning) {
      banner.style.backgroundColor = "#fee2e2";
      banner.style.border = "1.5px solid #ef4444";
      if (bannerIcon) bannerIcon.setAttribute("src", "./assets/figma/imgIconAlertDanger.svg");
      if (bannerPs[0]) {
        bannerPs[0].textContent = `Pre-symptomatic infection early warning · Immune = ${formatRiskLevel(engine.risks.immune.level)}`;
      }
      if (bannerPs[1]) {
        bannerPs[1].textContent = `Resting HR elevated ≥ 2 SD for ≥ 2 days (${record.rhr_bpm.toFixed(0)} bpm) — take morning saliva swab & rest`;
      }
      if (cloneActionBtn) {
        const bp = cloneActionBtn.querySelector("p");
        if (bp) bp.textContent = "Review immune risk";
        cloneActionBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          state.openRiskScreen("immune");
        });
        bannerAction?.replaceWith(cloneActionBtn);
      }
    } else if (engine.data_quality.status === "check_device") {
      banner.style.backgroundColor = "#fef3c7";
      banner.style.border = "1.5px solid #f59e0b";
      if (bannerIcon) bannerIcon.setAttribute("src", "./assets/figma/imgIconAlertWarning.svg");
      if (bannerPs[0]) bannerPs[0].textContent = "Device or astronaut? Check sensor contact before acting";
      if (bannerPs[1]) {
        bannerPs[1].textContent = `${engine.data_quality.reasons[0] ?? "Low signal quality"} · ${engine.data_quality.suggested_step}`;
      }
      if (cloneActionBtn) {
        const bp = cloneActionBtn.querySelector("p");
        if (bp) bp.textContent = "How to fix sensor";
        cloneActionBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const guide = record.temp_c < 34 ? "thermometer" : "wearable_hrv_fit";
          state.openToolGuide(guide);
        });
        bannerAction?.replaceWith(cloneActionBtn);
      }
    } else if (
      engine.risks.immune.level !== "normal" ||
      engine.risks.musculoskeletal.level !== "normal" ||
      engine.risks.cardio.level !== "normal"
    ) {
      const ranked: Array<readonly ["immune" | "musculoskeletal" | "cardio", string, EngineDayOutput["risks"]["immune"]]> = [
        ["immune", "Immune risk", engine.risks.immune] as const,
        ["musculoskeletal", "Bone & muscle risk", engine.risks.musculoskeletal] as const,
        ["cardio", "Heart risk", engine.risks.cardio] as const,
      ];
      ranked.sort((a, b) => b[2].score - a[2].score);
      const [topKey, topLabel, topRisk] = ranked[0];
      const isAct = topRisk.level === "act";
      banner.style.backgroundColor = isAct ? "#fee2e2" : "#fef3c7";
      banner.style.border = isAct ? "1.5px solid #ef4444" : "1px solid #f59e0b";
      if (bannerIcon) {
        bannerIcon.setAttribute(
          "src",
          isAct ? "./assets/figma/imgIconAlertDanger.svg" : "./assets/figma/imgIconAlertWarning.svg",
        );
      }
      if (bannerPs[0]) {
        bannerPs[0].textContent = `${topLabel}: ${formatRiskLevel(topRisk.level)} (${topRisk.score}/100)`;
      }
      if (bannerPs[1]) {
        bannerPs[1].textContent = `Top action: ${engine.actions[0]?.text ?? "See system drivers below"}`;
      }
      if (cloneActionBtn) {
        const bp = cloneActionBtn.querySelector("p");
        if (bp) bp.textContent = "See why & fix";
        cloneActionBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          state.openRiskScreen(topKey);
        });
        bannerAction?.replaceWith(cloneActionBtn);
      }
    } else {
      banner.style.backgroundColor = "#ecfdf5";
      banner.style.border = "1px solid #d1fae5";
      if (bannerIcon) bannerIcon.setAttribute("src", "./assets/figma/imgDotNormal.svg");
      if (bannerPs[0]) {
        bannerPs[0].textContent = inAdaptation
          ? "Adaptation phase (Days 1–14): baseline learning & alerts dampened"
          : "All body systems nominal vs your personal Day 1–14 baseline";
      }
      if (bannerPs[1]) {
        bannerPs[1].textContent = `Sensor quality ${Math.round(record.signal_quality * 100)}% · Sleep ${record.sleep_hours.toFixed(1)} h · RHR ${record.rhr_bpm.toFixed(0)} bpm`;
      }
      if (cloneActionBtn) {
        const bp = cloneActionBtn.querySelector("p");
        if (bp) bp.textContent = "Tool guides";
        cloneActionBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          state.openToolGuide("wearable_hrv_fit");
        });
        bannerAction?.replaceWith(cloneActionBtn);
      }
    }
  }

  // Overview score & 14-day series
  const series = getRangeSeries(bundle, state.astronautId, Math.max(1, state.missionDay - 19), state.missionDay);
  const compositeScores = series.map(({ engine: e }) =>
    Math.max(5, Math.round(100 - (e.risks.immune.score * 0.4 + e.risks.musculoskeletal.score * 0.3 + e.risks.cardio.score * 0.3))),
  );
  const todayComposite = compositeScores[compositeScores.length - 1] ?? 82;

  const scoreCard = artboard.querySelector('[data-name="Score card"]');
  if (scoreCard) {
    hydrateScoreCard(
      scoreCard,
      "Health Score",
      String(todayComposite),
      inAdaptation ? "Baseline building (Days 1–14)" : `Status: ${formatDqLabel(engine.data_quality.status)}`,
      compositeScores,
      "Simulated",
      "Composite indicator comparing stress, sleep, vitals & downstream risks to YOUR Day 1–14 baseline (not a diagnosis).",
    );
  }

  // 3 Overview Metric Cards
  const metricCards = Array.from(artboard.querySelectorAll('[data-name="Metric card"]'));
  for (const card of metricCards) {
    const category = card.querySelector('[data-name="Category"] p')?.textContent?.trim();
    if (category === "Heart") {
      const zRhr = engine.z.rhr_bpm ?? 0;
      const isGlitch = engine.data_quality.status === "check_device" && record.rhr_bpm > 150;
      const st = isGlitch ? "Check device" : zRhr >= 2 ? "Watch" : "Normal";
      const dot = isGlitch ? "./assets/figma/imgDotWatch.svg" : zRhr >= 2 ? "./assets/figma/imgDotWatch.svg" : "./assets/figma/imgDotNormal.svg";
      hydrateMetricCard(
        card,
        String(Math.round(record.rhr_bpm)),
        "bpm",
        `Resting HR (z ${zRhr >= 0 ? "+" : ""}${zRhr.toFixed(1)})`,
        st,
        dot,
        series.map(({ record: r }) => (r ? Math.min(115, r.rhr_bpm) : 60)),
      );
    } else if (category === "Stress") {
      const st = engine.stress_score >= 70 ? "Act" : engine.stress_score >= 45 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        String(Math.round(record.hrv_rmssd_ms)),
        "ms",
        `HRV RMSSD · Stress ${engine.stress_score}/100`,
        st,
        dotForLevel(st.toLowerCase()),
        series.map(({ record: r }) => r?.hrv_rmssd_ms ?? 50),
      );
    } else if (category === "Sleep") {
      const st = engine.sleep_score < 45 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        record.sleep_hours.toFixed(1),
        "h",
        `Sleep score ${engine.sleep_score}/100 · Quality ${record.sleep_quality_1to5}/5`,
        st,
        dotForLevel(st.toLowerCase()),
        series.map(({ record: r }) => r?.sleep_hours ?? 6.5),
      );
    }
  }

  // 3 Risk Overview Cards
  const riskCards = Array.from(artboard.querySelectorAll('[data-name="Risk card"]'));
  for (const card of riskCards) {
    const title = card.querySelector('[data-name="Title"] p')?.textContent?.trim() ?? "";
    let riskKey: "immune" | "musculoskeletal" | "cardio" = "immune";
    if (title.includes("Bone") || title.includes("Muscle")) riskKey = "musculoskeletal";
    else if (title.includes("Heart")) riskKey = "cardio";

    const risk = engine.risks[riskKey];
    const levelLabel = formatRiskLevel(risk.level);
    const pill = card.querySelector('[data-name="Risk level pill"]');
    if (pill) {
      const dot = pill.querySelector("img");
      if (dot) dot.setAttribute("src", dotForLevel(risk.level));
      const p = pill.querySelector("p");
      if (p) p.textContent = `${levelLabel} · ${risk.score}`;
    }

    const levelBar = card.querySelector('[data-name="Level bar"]');
    if (levelBar) {
      const segs = Array.from(levelBar.children) as HTMLElement[];
      const filled = risk.level === "act" ? 3 : risk.level === "watch" ? 2 : 1;
      const fillCol = risk.level === "act" ? "#dc2626" : risk.level === "watch" ? "#f59e0b" : "#111827";
      segs.forEach((seg, idx) => {
        seg.style.backgroundColor = idx < filled ? fillCol : "#e5e7eb";
      });
    }

    // Why bullet rows (up to 3 top contributors)
    const whyBlock = card.querySelector('[data-name="Why"]');
    if (whyBlock) {
      const topDrivers = risk.drivers.slice(0, 3);
      const bulletNodes = Array.from(whyBlock.children).slice(1);
      bulletNodes.forEach((node, idx) => {
        const p = node.querySelector("p") ?? (node.tagName === "P" ? node : null);
        if (!p) return;
        const d = topDrivers[idx];
        if (!d) {
          (node as HTMLElement).style.display = "none";
          return;
        }
        (node as HTMLElement).style.display = "";
        const stars = "★".repeat(d.evidence_stars);
        const factorLabel = d.factor.replace(/_/g, " ");
        p.textContent = `${factorLabel} (${stars}, z=${d.z >= 0 ? "+" : ""}${d.z.toFixed(1)})`;
      });
    }

    // What to do action line
    const todoBlock = card.querySelector('[data-name="What to do"]');
    if (todoBlock) {
      const todoPs = todoBlock.querySelectorAll("p");
      const matchingAction =
        engine.actions.find((a) => a.targets === riskKey || (riskKey === "musculoskeletal" && a.targets === "musculoskeletal")) ??
        engine.actions[0];
      if (todoPs[1]) {
        todoPs[1].textContent = matchingAction?.text ?? "Maintain countermeasures";
      }
    }
  }
}

/** Binds Risk Detail screens (Immune, Bone & Muscle, Heart) with 30-day charts, causal chains, sources, and ranked actions. */
function hydrateRiskDetail(
  artboard: HTMLElement,
  riskKey: "immune" | "musculoskeletal" | "cardio",
  bundle: BoopsBundle,
  engine: EngineDayOutput,
  state: AppContextState,
): void {
  const risk = engine.risks[riskKey];
  const profile = getCrewProfile(state.astronautId);
  const levelLabel = formatRiskLevel(risk.level);
  const levelNum = risk.level === "act" ? 3 : risk.level === "watch" ? 2 : 1;

  const pageHeader = artboard.querySelector('[data-name="Page header"]');
  if (pageHeader) {
    setParagraphs(pageHeader, [
      [1, `Day ${state.missionDay} · ${profile.id} ${profile.name} · ${levelLabel} (${risk.score}/100) · Simulated`],
    ]);
  }

  const start30 = Math.max(1, state.missionDay - 29);
  const series30 = getRangeSeries(bundle, state.astronautId, start30, state.missionDay);
  const riskScores = series30.map(({ engine: e }) => e.risks[riskKey].score);

  const scoreCard = artboard.querySelector('[data-name="Score card"]');
  if (scoreCard) {
    hydrateScoreCard(
      scoreCard,
      "",
      levelLabel,
      `Score ${risk.score}/100 · Level ${levelNum} of 3`,
      riskScores,
      "Simulated",
      `${levelLabel} threshold: <40 Normal, 40–70 Watch, >70 Act.`,
    );
  }

  // 30-day Chart card
  const chartCard = artboard.querySelector('[data-name="Chart card"]');
  if (chartCard) {
    const chartPs = chartCard.querySelectorAll("p");
    if (chartPs[1]) {
      chartPs[1].textContent = `Day ${start30}–${state.missionDay} · simulated · 40 = Watch, 70 = Act`;
    }
    const statusChip = chartCard.querySelector('[data-name="Status"]');
    if (statusChip) {
      const dot = statusChip.querySelector("img");
      if (dot) dot.setAttribute("src", dotForLevel(risk.level));
      const p = statusChip.querySelector("p");
      if (p) p.textContent = levelLabel;
    }
    const plot = chartCard.querySelector('[data-name="Plot"]');
    if (plot) {
      applySparklineBars(plot, riskScores.length ? riskScores : [risk.score], 14, 134, (val) => {
        if (val > 70) return "#dc2626";
        if (val >= 40) return "#f59e0b";
        return "#111827";
      });
    }
  }

  // Why it matters -> replace Chain rows dynamically with drivers + stars + citations
  const whySection = artboard.querySelector('[data-name="Why it matters"]');
  if (whySection) {
    const header = whySection.querySelector('[data-name="Section header"]');
    const rows = risk.drivers.map((driver) => {
      const cite = getSourceCitation(bundle, driver.source_id);
      const citeText = cite?.citation ?? cite?.title ?? driver.source_id;
      const pct = Math.round(driver.contribution * 100);
      return h(
        "div",
        {
          className:
            "bg-[var(--color-bg-card,white)] border border-[var(--color-border-default,#e5e7eb)] border-solid flex items-center justify-between gap-4 px-[20px] py-[14px] rounded-[16px] w-full",
          "data-name": "Chain row",
        },
        h(
          "div",
          { className: "flex flex-col gap-1 min-w-0 flex-1" },
          h(
            "p",
            { className: "font-semibold text-[14px] text-[#111827]" },
            `${driver.chain}`,
          ),
          h(
            "p",
            { className: "text-[12px] text-[#6b7280]" },
            `Factor: ${driver.factor.replace(/_/g, " ")} (z = ${driver.z >= 0 ? "+" : ""}${driver.z.toFixed(2)}, weight +${pct}) · Source: ${citeText}`,
          ),
        ),
        h(
          "div",
          {
            className:
              "bg-[#f4f5f7] px-[10px] py-[4px] rounded-full shrink-0 text-[11px] font-medium text-[#374151] whitespace-nowrap",
          },
          formatStars(driver.evidence_stars),
        ),
      );
    });
    if (header) {
      whySection.replaceChildren(header, ...rows);
    }
  }

  // How to fix -> populate ranked actions
  const fixSection = artboard.querySelector('[data-name="How to fix"]');
  if (fixSection) {
    const header = fixSection.querySelector('[data-name="Section header"]');
    const prioritized = [...engine.actions].sort((a, b) => {
      const aMatch = a.targets === riskKey ? 0 : 1;
      const bMatch = b.targets === riskKey ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return a.rank - b.rank;
    });
    const actionNodes = prioritized.slice(0, 4).map((action) =>
      h(
        "div",
        {
          className:
            "bg-[var(--color-bg-card,white)] border border-[var(--color-border-default,#e5e7eb)] border-solid flex items-center justify-between gap-4 px-[20px] py-[14px] rounded-[16px] w-full",
          "data-name": "Action step",
        },
        h(
          "div",
          { className: "flex items-center gap-3 min-w-0 flex-1" },
          h(
            "span",
            {
              className:
                "inline-flex items-center justify-center w-[26px] h-[26px] rounded-full bg-[#111827] text-white text-[12px] font-semibold shrink-0",
            },
            String(action.rank),
          ),
          h(
            "div",
            { className: "flex flex-col gap-0.5 min-w-0" },
            h("p", { className: "font-medium text-[14px] text-[#111827]" }, action.text),
            h(
              "p",
              { className: "text-[12px] text-[#6b7280]" },
              `Targets: ${action.targets.replace(/_/g, " ")}`,
            ),
          ),
        ),
        h(
          "span",
          {
            className:
              "bg-[#c6f432] px-[10px] py-[4px] rounded-full text-[11px] font-medium text-[#111827] shrink-0 whitespace-nowrap",
          },
          formatStars(action.evidence_stars),
        ),
      ),
    );
    if (header) {
      fixSection.replaceChildren(header, ...actionNodes);
    }
  }

  // Related systems chips navigation
  const relatedChips = Array.from(artboard.querySelectorAll('[data-name="Related systems"] [data-name="Chip"]'));
  for (const chip of relatedChips) {
    const label = chip.textContent?.toLowerCase() ?? "";
    (chip as HTMLElement).style.cursor = "pointer";
    chip.addEventListener("click", () => {
      if (label.includes("immune")) state.openRiskScreen("immune");
      else if (label.includes("bone") || label.includes("muscle") || label.includes("exercise")) {
        state.openRiskScreen("musculoskeletal");
      } else if (label.includes("heart") || label.includes("cardio")) {
        state.openRiskScreen("cardio");
      } else if (label.includes("saliva")) {
        state.openToolGuide("saliva_sample_kit");
      }
    });
  }

  // Crew-first privacy toggle on Risk Detail screen ("Share with mission control" defaults OFF)
  const rawToggle = artboard.querySelector('[data-name="Toggle"]') as HTMLElement | null;
  if (rawToggle) {
    const shareToggle = rawToggle.cloneNode(true) as HTMLElement;
    const isShared = Boolean(state.sharing.risk_detail_share[riskKey]);
    const img = shareToggle.querySelector("img");
    if (img) {
      img.setAttribute("src", isShared ? "./assets/figma/imgToggleOn.svg" : "./assets/figma/imgToggleOff.svg");
    }
    shareToggle.style.cursor = "pointer";
    shareToggle.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const nextVal = !Boolean(state.sharing.risk_detail_share[riskKey]);
      state.onToggleSharing({ risk: riskKey }, nextVal);
    });
    rawToggle.replaceWith(shareToggle);
  }
}

/** Maps screen IDs and category labels to live numeric values for Health* and Detail* views. */
function hydrateHealthSubAndDetailScreens(
  artboard: HTMLElement,
  screenId: ScreenId,
  bundle: BoopsBundle,
  engine: EngineDayOutput,
  record: DailyRecordRow,
  state: AppContextState,
): void {
  const start30 = Math.max(1, state.missionDay - 29);
  const series30 = getRangeSeries(bundle, state.astronautId, start30, state.missionDay);
  const cumDose = getCumulativeRadiation(bundle, state.astronautId, state.missionDay);

  const pageHeader = artboard.querySelector('[data-name="Page header"]');
  if (pageHeader && screenId.startsWith("Detail")) {
    setParagraphs(pageHeader, [
      [1, `Day ${state.missionDay} · ${getCrewProfile(state.astronautId).name} · Simulated`],
    ]);
  }

  const scoreCard = artboard.querySelector('[data-name="Score card"]');
  if (scoreCard) {
    if (screenId === "HealthSleep" || screenId === "DetailSleepScore") {
      hydrateScoreCard(
        scoreCard,
        "Sleep score",
        String(engine.sleep_score),
        engine.sleep_score < 45 ? "Below baseline" : "Within baseline",
        series30.map((s) => s.engine.sleep_score),
      );
    } else if (screenId === "HealthMindfulness" || screenId === "DetailStressScore") {
      hydrateScoreCard(
        scoreCard,
        "Stress score",
        String(engine.stress_score),
        engine.stress_score >= 70 ? "Elevated strain" : engine.stress_score >= 45 ? "Moderate" : "Low",
        series30.map((s) => s.engine.stress_score),
      );
    } else if (screenId === "HealthEnvironmentRadiation" || screenId === "DetailRadiationDose") {
      hydrateScoreCard(
        scoreCard,
        "Mission dose",
        cumDose.toFixed(1),
        `mSv cumulative (${record.radiation_msv.toFixed(2)} mSv today)`,
        series30.map((s) => s.record?.radiation_msv ?? 0.5),
      );
    } else if (screenId === "HealthEnvironmentGravity" || screenId === "DetailMissionDay") {
      hydrateScoreCard(
        scoreCard,
        "Days in microgravity",
        String(state.missionDay),
        state.missionDay <= 14 ? "of 180 · Adaptation phase" : "of 180",
        series30.map((_, idx) => idx + start30),
      );
    } else if (screenId === "DetailRestingHeartRate") {
      hydrateScoreCard(
        scoreCard,
        "Resting heart rate",
        String(Math.round(record.rhr_bpm)),
        `bpm · Baseline ${(engine.baseline.rhr_bpm?.mean ?? 60).toFixed(0)}`,
        series30.map((s) => Math.min(115, s.record?.rhr_bpm ?? 60)),
      );
    } else if (screenId === "DetailHrv") {
      hydrateScoreCard(
        scoreCard,
        "HRV (RMSSD)",
        String(Math.round(record.hrv_rmssd_ms)),
        `ms · Baseline ${(engine.baseline.hrv_rmssd_ms?.mean ?? 50).toFixed(0)}`,
        series30.map((s) => s.record?.hrv_rmssd_ms ?? 50),
      );
    } else if (screenId === "DetailBloodPressure") {
      hydrateScoreCard(
        scoreCard,
        "Blood pressure",
        `${Math.round(record.sbp_mmhg)}/${Math.round(record.dbp_mmhg)}`,
        `mmHg · Baseline ${(engine.baseline.sbp_mmhg?.mean ?? 110).toFixed(0)}/${(engine.baseline.dbp_mmhg?.mean ?? 72).toFixed(0)}`,
        series30.map((s) => s.record?.sbp_mmhg ?? 110),
      );
    } else if (screenId === "DetailBloodOxygenSpo2") {
      hydrateScoreCard(
        scoreCard,
        "Blood oxygen SpO₂",
        record.spo2_pct.toFixed(1),
        `% · ${record.spo2_pct < 92 ? "Low — check Air/O2" : "Normal"}`,
        series30.map((s) => s.record?.spo2_pct ?? 98),
      );
    } else if (screenId === "DetailSleepDuration") {
      hydrateScoreCard(
        scoreCard,
        "Sleep duration",
        record.sleep_hours.toFixed(1),
        "hours last night",
        series30.map((s) => s.record?.sleep_hours ?? 6.5),
      );
    } else if (screenId === "DetailSleepQuality") {
      hydrateScoreCard(
        scoreCard,
        "Sleep quality",
        String(record.sleep_quality_1to5),
        "of 5 · Self-rated",
        series30.map((s) => s.record?.sleep_quality_1to5 ?? 3),
      );
    } else if (screenId === "DetailExerciseCountermeasures") {
      hydrateScoreCard(
        scoreCard,
        "Resistance exercise",
        String(Math.round(record.resistance_min)),
        `min today · Total exercise ${Math.round(record.exercise_min)} min`,
        series30.map((s) => s.record?.resistance_min ?? 55),
      );
    } else if (screenId === "DetailMood") {
      hydrateScoreCard(
        scoreCard,
        "Mood rating",
        String(record.mood_1to5),
        "of 5 · Self-reported",
        series30.map((s) => s.record?.mood_1to5 ?? 3),
      );
    }
  }

  // Hydrate Metric Cards found across HealthVitals, HealthSleep, HealthMindfulness, HealthEnvironment*, HealthNutrition
  artboard.querySelectorAll('[data-name="Metric card"]').forEach((card) => {
    const label = card.querySelector('[data-name="Category"] p')?.textContent?.trim() ?? "";
    const cardSub = card.querySelector("p.text-\\[color\\:var\\(--color-text-secondary\\,\\#374151\\)\\]")?.textContent ?? "";
    if (label === "Heart" && !cardSub.includes("Blood")) {
      hydrateMetricCard(
        card,
        String(Math.round(record.rhr_bpm)),
        "bpm",
        "Resting heart rate",
        engine.data_quality.status === "check_device" && record.rhr_bpm > 150 ? "Check device" : "Normal",
        dotForLevel(engine.data_quality.status === "check_device" && record.rhr_bpm > 150 ? "watch" : "normal"),
        series30.slice(-14).map((s) => Math.min(115, s.record?.rhr_bpm ?? 60)),
      );
    } else if (label === "Stress" && cardSub.includes("EDA")) {
      hydrateMetricCard(
        card,
        record.eda_mean_us.toFixed(1),
        "µS",
        "EDA skin conductance",
        "Tracked",
        "./assets/figma/imgDotNormal.svg",
        series30.slice(-14).map((s) => s.record?.eda_mean_us ?? 2.3),
      );
    } else if (label === "Stress") {
      const lvl = engine.stress_score >= 70 ? "Act" : engine.stress_score >= 45 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        String(Math.round(record.hrv_rmssd_ms)),
        "ms",
        "HRV (RMSSD)",
        lvl,
        dotForLevel(lvl.toLowerCase()),
        series30.slice(-14).map((s) => s.record?.hrv_rmssd_ms ?? 50),
      );
    } else if (label === "Sleep") {
      hydrateMetricCard(
        card,
        record.sleep_hours.toFixed(1),
        "h",
        `Quality ${record.sleep_quality_1to5}/5 · Sleep today`,
        engine.sleep_score < 45 ? "Watch" : "Normal",
        dotForLevel(engine.sleep_score < 45 ? "watch" : "normal"),
        series30.slice(-14).map((s) => s.record?.sleep_hours ?? 6.5),
      );
    } else if (label === "Radiation") {
      const rLvl = record.radiation_msv >= 1.5 ? "Act" : record.radiation_msv >= 0.8 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        record.radiation_msv.toFixed(2),
        "mSv",
        "Daily absorbed dose",
        rLvl,
        dotForLevel(rLvl.toLowerCase()),
        series30.slice(-14).map((s) => s.record?.radiation_msv ?? 0.5),
      );
    } else if (label === "Exercise" || cardSub.includes("ARED")) {
      const exLvl = record.resistance_min < 25 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        String(Math.round(record.resistance_min)),
        "min",
        `ARED resistance (Total ${Math.round(record.exercise_min)} min)`,
        exLvl,
        dotForLevel(exLvl.toLowerCase()),
        series30.slice(-14).map((s) => s.record?.resistance_min ?? 55),
      );
    }
  });

  // Update 30-day Chart card plots on Detail* screens
  const chartPlot = artboard.querySelector('[data-name="Chart card"] [data-name="Plot"]');
  if (chartPlot) {
    const vals = series30.map(({ record: r, engine: e }) => {
      if (!r) return 50;
      if (screenId === "DetailRestingHeartRate") return Math.min(115, r.rhr_bpm);
      if (screenId === "DetailHrv") return r.hrv_rmssd_ms;
      if (screenId === "DetailStressScore") return e.stress_score;
      if (screenId === "DetailSleepScore") return e.sleep_score;
      if (screenId === "DetailSleepDuration") return r.sleep_hours;
      if (screenId === "DetailRadiationDose") return r.radiation_msv;
      if (screenId === "DetailBloodPressure") return r.sbp_mmhg;
      return r.exercise_min;
    });
    applySparklineBars(chartPlot, vals, 12, 130);
  }
}

/** Wires "How to measure" guide links & displays any manual localStorage log saved for today. */
function hydrateLogScreen(
  artboard: HTMLElement,
  screenId: ScreenId,
  state: AppContextState,
): void {
  const fieldToGuide: Array<[RegExp, string]> = [
    [/blood pressure/i, "blood_pressure_cuff"],
    [/heart rate|hrv|wearable|ecg/i, "wearable_hrv_fit"],
    [/temperature/i, "thermometer"],
    [/saliva|cortisol|symptom/i, "saliva_sample_kit"],
    [/radiation|dosimeter/i, "personal_dosimeter"],
    [/oxygen|spo2|pulse ox/i, "pulse_oximeter"],
    [/exercise|ared|eva|resistance/i, "exercise_device_log"],
  ];

  // Attach tool-guide drawer hooks to every "ⓘ How to measure" text element
  artboard.querySelectorAll('[data-name="Input field"]').forEach((fieldEl) => {
    const labelText = fieldEl.querySelector("p")?.textContent ?? "";
    const matched = fieldToGuide.find(([re]) => re.test(labelText))?.[1] ?? "wearable_hrv_fit";
    fieldEl.querySelectorAll("p, a").forEach((el) => {
      if (el.textContent?.includes("How to measure")) {
        (el as HTMLElement).style.cursor = "pointer";
        (el as HTMLElement).style.textDecoration = "underline";
        el.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          state.openToolGuide(matched);
        });
      }
    });
  });

  // Add quick-launch Tool Guide pill in Page header if not already present
  const header = artboard.querySelector('[data-name="Page header"]');
  if (header && !header.querySelector("[data-boops-guide-btn]")) {
    const defaultGuide =
      screenId === "LogEnvironmentRadiation"
        ? "personal_dosimeter"
        : screenId === "LogEnvironmentGravity"
          ? "exercise_device_log"
          : screenId === "LogSleep" || screenId === "LogMindfulness"
            ? "wearable_hrv_fit"
            : "blood_pressure_cuff";
    const btn = h(
      "button",
      {
        type: "button",
        "data-boops-guide-btn": "1",
        className:
          "mt-1 inline-flex items-center gap-1.5 rounded-full bg-white border border-[#e5e7eb] px-3 py-1 text-[12px] font-medium text-[#111827] hover:bg-[#f4f5f7] cursor-pointer",
      },
      "ⓘ Open Instrument Guide",
    );
    btn.addEventListener("click", () => state.openToolGuide(defaultGuide));
    header.append(btn);
  }

  // Show local saved entry badge if user logged data for this day
  const existing = loadManualLogs().filter(
    (l) => l.astronaut_id === state.astronautId && l.mission_day === state.missionDay && l.screen === screenId,
  );
  if (existing.length > 0 && header) {
    const badge = h(
      "p",
      { className: "text-[12px] font-medium text-[#059669]" },
      `Saved offline for ${state.astronautId} Day ${state.missionDay} (${existing[0].saved_at})`,
    );
    header.append(badge);
  }

  // Capture Save button clicks on Log screens so entries persist in localStorage per astronaut/day
  artboard.querySelectorAll("button, [role='button'], div").forEach((el) => {
    const label = el.textContent?.trim();
    if (label === "Save entry" || label === "Save log" || label === "Save") {
      el.addEventListener("click", () => {
        const fields: Record<string, string> = {};
        artboard.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea").forEach((inp, idx) => {
          const ph = inp instanceof HTMLSelectElement ? "" : inp.placeholder;
          const key = inp.name || ph || `field_${idx}`;
          if (inp.value) fields[key] = inp.value;
        });
        appendManualLog({
          astronaut_id: state.astronautId,
          mission_day: state.missionDay,
          screen: screenId,
          fields,
          saved_at: new Date().toISOString().slice(11, 19) + " UTC",
        });
        state.showToast(`Offline log saved for ${state.astronautId} Day ${state.missionDay}`);
      });
    }
  });
}

/** Hydrates SettingsProfile with live astronaut baseline, crew-first sharing toggles, and locked emergency sharing. */
function hydrateSettingsScreen(
  artboard: HTMLElement,
  engine: EngineDayOutput | null,
  state: AppContextState,
): void {
  const profile = getCrewProfile(state.astronautId);
  const contentLeft = artboard.querySelector('[data-name="Left"]');
  if (contentLeft) {
    const profBox = contentLeft.querySelector('[data-name="Profile"] [data-name="Info"]');
    if (profBox) {
      setParagraphs(profBox, [
        [0, `${profile.id} · ${profile.name}`],
        [1, profile.role],
        [2, `Mission LEO-180 · 3-person crew · Day ${state.missionDay} · Simulated`],
      ]);
    }
  }

  // Baseline rows summary
  if (engine) {
    const rhrBase = engine.baseline.rhr_bpm;
    const hrvBase = engine.baseline.hrv_rmssd_ms;
    artboard.querySelectorAll('[data-name="Settings row"]').forEach((row) => {
      const title = row.querySelector('[data-name="Text"] p')?.textContent?.trim();
      const valPs = row.querySelectorAll("p");
      const valP = valPs[valPs.length - 1];
      if (title === "Status" && valP) {
        valP.textContent =
          state.missionDay <= 14
            ? `Learning: ${state.missionDay} of 14 days`
            : `Active · RHR ${rhrBase?.mean.toFixed(0) ?? 60}±${rhrBase?.sd.toFixed(1) ?? 2} bpm, HRV ${hrvBase?.mean.toFixed(0) ?? 50} ms`;
      } else if (title === "Share daily summary with mission control") {
        const rawTgl = row.querySelector('[data-name="Toggle"]') as HTMLElement | null;
        if (rawTgl) {
          const toggle = rawTgl.cloneNode(true) as HTMLElement;
          const img = toggle.querySelector("img");
          if (img) {
            img.setAttribute(
              "src",
              state.sharing.daily_summary ? "./assets/figma/imgToggleOn.svg" : "./assets/figma/imgToggleOff.svg",
            );
          }
          toggle.style.cursor = "pointer";
          toggle.addEventListener("click", (ev) => {
            ev.stopPropagation();
            state.onToggleSharing("daily_summary", !state.sharing.daily_summary);
          });
          rawTgl.replaceWith(toggle);
        }
      } else if (title === "Share raw data") {
        const rawTgl = row.querySelector('[data-name="Toggle"]') as HTMLElement | null;
        if (rawTgl) {
          const toggle = rawTgl.cloneNode(true) as HTMLElement;
          const img = toggle.querySelector("img");
          if (img) {
            img.setAttribute(
              "src",
              state.sharing.raw_data ? "./assets/figma/imgToggleOn.svg" : "./assets/figma/imgToggleOff.svg",
            );
          }
          toggle.style.cursor = "pointer";
          toggle.addEventListener("click", (ev) => {
            ev.stopPropagation();
            state.onToggleSharing("raw_data", !state.sharing.raw_data);
          });
          rawTgl.replaceWith(toggle);
        }
      } else if (title === "Share emergency events") {
        if (valP) valP.textContent = "Always on (locked for crew safety)";
      }
    });
  }
}

/** Returns high-contrast red/white Emergency screens with all 6 protocols and crew lead switching. */
function hydrateEmergencyScreens(
  artboard: HTMLElement,
  screenId: ScreenId,
  bundle: BoopsBundle,
  record: DailyRecordRow | null,
  state: AppContextState,
): void {
  artboard.classList.add("boops-emergency-surface");

  const patient = getCrewProfile(state.emergencyPatientId);
  // Medical officer is Flight Engineer Lena Fischer (A3); if medical officer is the patient, Commander A1 leads.
  const medicalOfficerId = "A3";
  const nextLeader =
    state.emergencyPatientId === medicalOfficerId
      ? getCrewProfile("A1")
      : getCrewProfile(medicalOfficerId);

  const patientRoleNote =
    state.emergencyPatientId === medicalOfficerId
      ? `Medical officer (${patient.name}) is patient -> Next crew member leads: ${nextLeader.name} (${nextLeader.role})`
      : `Responder lead: ${nextLeader.name} (Medical Officer) · Patient: ${patient.name} (${patient.role})`;

  const header = artboard.querySelector('[data-name="Page header"]');
  if (header && !header.querySelector("[data-boops-crew-role]")) {
    const bar = h(
      "div",
      {
        "data-boops-crew-role": "1",
        className:
          "mt-2 flex flex-wrap items-center gap-2 bg-white border-2 border-[#dc2626] rounded-[12px] px-3 py-1.5 text-[12px]",
      },
      h("span", { className: "font-bold text-[#991b1b]" }, "Patient:"),
      ...CREW_PROFILES.map((crew) => {
        const active = crew.id === state.emergencyPatientId;
        const btn = h(
          "button",
          {
            type: "button",
            className: active
              ? "px-2.5 py-0.5 rounded-full bg-[#dc2626] text-white font-semibold cursor-pointer"
              : "px-2.5 py-0.5 rounded-full bg-[#fee2e2] text-[#7f1d1d] font-medium hover:bg-[#fecaca] cursor-pointer",
          },
          `${crew.id} ${crew.name.split(" ")[0]}`,
        );
        btn.addEventListener("click", () => state.onChangeEmergencyPatient(crew.id));
        return btn;
      }),
      h("span", { className: "ml-1 font-medium text-[#111827]" }, patientRoleNote),
    );
    header.append(bar);
  }

  // EmergencyHub: wire all 6 protocol tiles cleanly
  if (screenId === "EmergencyHub") {
    const tiles = Array.from(artboard.querySelectorAll('[data-name="Emergency tile"]'));
    const tileOrder = [
      "solar_radiation_storm",
      "fainting_dizziness",
      "chest_pain",
      "injury_bleeding",
      "severe_rash_fever",
      "breathing_difficulty",
    ];
    tiles.forEach((tile, idx) => {
      const pid = tileOrder[idx];
      const proto = bundle.emergencyProtocols.find((p) => p.id === pid);
      const el = tile as HTMLElement;
      el.style.cursor = "pointer";
      el.style.border = "2px solid #dc2626";
      el.style.backgroundColor = "#ffffff";
      if (proto) {
        const ps = el.querySelectorAll("p");
        if (ps[0]) {
          ps[0].textContent = proto.title;
          (ps[0] as HTMLElement).style.color = "#991b1b";
        }
        if (ps[1]) {
          ps[1].textContent = `${proto.severity.toUpperCase()} · ${proto.first_screen_message.slice(0, 56)}…`;
          (ps[1] as HTMLElement).style.color = "#374151";
        }
      }
      const clone = el.cloneNode(true) as HTMLElement;
      clone.addEventListener("click", () => state.openEmergencyProtocol(pid));
      el.replaceWith(clone);
    });
    return;
  }

  // Protocol detail view (SolarRadiationStorm or Fainting acting as dynamic host for all 6 protocols)
  const protoId =
    state.activeEmergencyId ||
    (screenId === "EmergencySolarRadiationStorm" ? "solar_radiation_storm" : "fainting_dizziness");
  const protocol: EmergencyProtocol | undefined =
    bundle.emergencyProtocols.find((p) => p.id === protoId) ?? bundle.emergencyProtocols[0];
  if (!protocol) return;

  if (header) {
    setParagraphs(header, [
      [0, protocol.title],
      [1, `OFFLINE EMERGENCY PROTOCOL · Severity: ${protocol.severity.toUpperCase()} · Simulated demo`],
    ]);
    const hTitle = header.querySelector("p");
    if (hTitle) (hTitle as HTMLElement).style.color = "#991b1b";
  }

  // Replace Content body (preserving Back & Sidebar) with crisp high-contrast red/white protocol layout
  const content = artboard.querySelector('[data-name="Content"]');
  if (content) {
    const timestamps = loadChecklistTimestamps(protocol.id);
    const cumDose = getCumulativeRadiation(bundle, state.emergencyPatientId, state.missionDay);
    const patientRecord = getDailyRecord(bundle, state.emergencyPatientId, state.missionDay) ?? record;

    const heroCard = h(
      "div",
      {
        className:
          "w-full rounded-[24px] p-[24px] bg-[#dc2626] text-white border-2 border-[#991b1b] flex items-center justify-between gap-6",
      },
      h(
        "div",
        { className: "flex flex-col gap-2 flex-1" },
        h(
          "span",
          { className: "text-[11px] font-bold tracking-wider uppercase text-[#fee2e2]" },
          `IMMEDIATE ACTION · ${protocol.severity.toUpperCase()}`,
        ),
        h("p", { className: "text-[22px] font-semibold leading-[1.3] text-white" }, protocol.first_screen_message),
        h(
          "p",
          { className: "text-[13px] text-[#fee2e2]" },
          protocol.disclaimer,
        ),
      ),
      h(
        "button",
        {
          type: "button",
          className:
            "bg-white text-[#991b1b] font-bold px-5 py-3 rounded-full text-[14px] shrink-0 hover:bg-[#fee2e2] cursor-pointer",
          onClick: () => state.showToast(`Emergency event logged at ${new Date().toISOString().slice(11, 19)} UTC (always shared)`),
        },
        "Log Emergency Event",
      ),
    );

    const stepCards = protocol.steps.map((stepText, idx) => {
      const stepKey = `${protocol.id}_${idx}`;
      const ts = timestamps[stepKey];
      const box = h(
        "button",
        {
          type: "button",
          className: ts
            ? "w-full text-left flex items-center justify-between gap-3 px-4 py-3 rounded-[16px] border-2 border-[#16a34a] bg-[#f0fdf4] cursor-pointer"
            : "w-full text-left flex items-center justify-between gap-3 px-4 py-3 rounded-[16px] border-2 border-[#fca5a5] bg-white hover:bg-[#fef2f2] cursor-pointer",
        },
        h(
          "div",
          { className: "flex items-center gap-3" },
          h(
            "span",
            {
              className: ts
                ? "w-6 h-6 rounded-[7px] bg-[#16a34a] text-white flex items-center justify-center font-bold text-[13px] shrink-0"
                : "w-6 h-6 rounded-[7px] border-2 border-[#dc2626] bg-white text-[#dc2626] flex items-center justify-center font-bold text-[12px] shrink-0",
            },
            ts ? "✓" : String(idx + 1),
          ),
          h("p", { className: "text-[14px] font-medium text-[#111827]" }, stepText),
        ),
        h(
          "span",
          { className: "text-[11px] font-medium text-[#6b7280] shrink-0" },
          ts ? `Completed ${ts}` : "Tap to confirm",
        ),
      );

      box.addEventListener("click", () => {
        const nextTs = toggleChecklistTimestamp(protocol.id, stepKey, !ts);
        const nowDone = Boolean(nextTs[stepKey]);
        state.showToast(nowDone ? `Step ${idx + 1} recorded (${nextTs[stepKey]})` : `Step ${idx + 1} cleared`);
        hydrateEmergencyScreens(artboard, screenId, bundle, record, state);
      });
      return box;
    });

    const vitalsSnapshot = patientRecord
      ? [
          `Patient: ${patient.id} ${patient.name}`,
          `RHR: ${patientRecord.rhr_bpm.toFixed(0)} bpm`,
          `BP: ${patientRecord.sbp_mmhg.toFixed(0)}/${patientRecord.dbp_mmhg.toFixed(0)} mmHg`,
          `SpO2: ${patientRecord.spo2_pct.toFixed(1)}%`,
          `Temp: ${patientRecord.temp_c.toFixed(1)} °C`,
          `Today Dose: ${patientRecord.radiation_msv.toFixed(2)} mSv (Cum: ${cumDose.toFixed(1)} / 600 mSv)`,
        ]
      : ["Simulated patient vitals loaded offline."];

    const guideButtons = protocol.related_tool_guides.map((gid) => {
      const g = bundle.toolGuides.find((item) => item.id === gid);
      const b = h(
        "button",
        {
          type: "button",
          className:
            "px-3 py-1.5 rounded-full border border-[#dc2626] bg-[#fef2f2] text-[#991b1b] text-[12px] font-semibold hover:bg-[#fee2e2] cursor-pointer",
        },
        `ⓘ ${g?.title ?? gid}`,
      );
      b.addEventListener("click", () => state.openToolGuide(gid));
      return b;
    });

    const columns = h(
      "div",
      { className: "w-full flex gap-6 items-start" },
      h(
        "div",
        { className: "flex-1 flex flex-col gap-3" },
        h("h3", { className: "text-[20px] font-semibold text-[#991b1b]" }, "Checklist Steps (timestamped offline)"),
        ...stepCards,
      ),
      h(
        "div",
        { className: "w-[360px] shrink-0 flex flex-col gap-3" },
        h(
          "div",
          { className: "bg-white border-2 border-[#fca5a5] rounded-[20px] p-5 flex flex-col gap-2" },
          h("span", { className: "text-[11px] font-bold text-[#991b1b] uppercase" }, "WHY THIS HAPPENS"),
          h("p", { className: "text-[13px] text-[#111827] leading-[1.45]" }, protocol.why_this_happens),
          h("span", { className: "text-[11px] font-bold text-[#991b1b] uppercase mt-2" }, "WHEN TO ESCALATE"),
          h("p", { className: "text-[13px] font-semibold text-[#991b1b] leading-[1.45]" }, protocol.when_to_escalate),
        ),
        h(
          "div",
          { className: "bg-white border border-[#e5e7eb] rounded-[20px] p-5 flex flex-col gap-1.5" },
          h("span", { className: "text-[11px] font-bold text-[#6b7280] uppercase" }, "PATIENT LIVE SNAPSHOT (SIMULATED)"),
          ...vitalsSnapshot.map((line) => h("p", { className: "text-[12px] text-[#111827] font-medium" }, line)),
          h("div", { className: "flex flex-wrap gap-1.5 mt-2" }, ...guideButtons),
        ),
      ),
    );

    const footerBar = h(
      "div",
      {
        className:
          "w-full bg-white border-2 border-[#dc2626] rounded-[20px] px-6 py-4 flex items-center justify-between gap-4",
      },
      h(
        "button",
        {
          type: "button",
          className:
            "bg-[#dc2626] text-white px-4 py-2 rounded-full text-[13px] font-semibold cursor-pointer hover:bg-[#b91c1c]",
          onClick: () => state.showToast("Emergency packet queued for Flight Surgeon (always-on safety channel)"),
        },
        "Send Emergency Report to Flight Surgeon",
      ),
      h(
        "p",
        { className: "text-[12px] text-[#991b1b] font-medium" },
        `${protocol.disclaimer} · Works 100% offline`,
      ),
    );

    content.replaceChildren(heroCard, columns, footerBar);
    (content as HTMLElement).style.top = "146px";
  }
}

/** Main entry point invoked after rendering any Figma screen artboard. */
export function applyBoopsBindings(
  artboard: HTMLElement,
  screenId: ScreenId,
  bundle: BoopsBundle | null,
  state: AppContextState,
): void {
  normalizeOfflineAssetsAndBrand(artboard);

  const engine = getEngineDay(bundle, state.astronautId, state.missionDay);
  const record = getDailyRecord(bundle, state.astronautId, state.missionDay);

  hydrateSidebar(artboard, engine, record, state);

  if (!bundle || !engine || !record) return;

  if (screenId === "HealthHome") {
    hydrateHealthHome(artboard, bundle, engine, record, state);
  } else if (screenId === "HealthRiskDetailImmune") {
    hydrateRiskDetail(artboard, "immune", bundle, engine, state);
  } else if (screenId === "HealthRiskDetailBoneMuscle") {
    hydrateRiskDetail(artboard, "musculoskeletal", bundle, engine, state);
  } else if (screenId === "HealthRiskDetailHeart") {
    hydrateRiskDetail(artboard, "cardio", bundle, engine, state);
  } else if (screenId === "SettingsProfile") {
    hydrateSettingsScreen(artboard, engine, state);
  } else if (screenId.startsWith("Emergency")) {
    hydrateEmergencyScreens(artboard, screenId, bundle, record, state);
  } else if (screenId.startsWith("Log")) {
    hydrateLogScreen(artboard, screenId, state);
  } else {
    hydrateHealthSubAndDetailScreens(artboard, screenId, bundle, engine, record, state);
  }
}
