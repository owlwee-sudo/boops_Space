/**
 * Hydrates rendered Figma 52-screen artboards with live BOOPS engine outputs,
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
  type ManualLogEntry,
  type SharingSettings,
  appendEmergencyEvent,
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
  loadUserSettings,
  saveUserSettings,
  toggleChecklistTimestamp,
  updateManualLog,
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
  openCameraCheck: (simulated?: boolean) => void;
  openEmergencyProtocol: (protocolId: string) => void;
  openRiskScreen: (riskKey: "immune" | "musculoskeletal" | "cardio") => void;
  navigateScreen: (screenId: ScreenId) => void;
  reRenderScreen: () => void;
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
      p.textContent = "BOOPS";
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

/** Updates a Chart card's X-axis ticks cleanly to [startDay, midDay, endDay]. */
function updateChartXAxis(container: Element, startDay: number, endDay: number): void {
  const xAxis = container.querySelector('[data-name="X axis"]');
  if (!xAxis) return;
  const ps = xAxis.querySelectorAll("p");
  const mid = Math.round((startDay + endDay) / 2);
  if (ps[0]) ps[0].textContent = `Day ${startDay}`;
  if (ps[1]) ps[1].textContent = `Day ${mid}`;
  if (ps[2]) ps[2].textContent = `Day ${endDay}`;
}

/** Updates a Progress card value row, completion track gradient, and subtitle. */
function hydrateProgressCard(
  card: Element,
  valueText: string,
  targetText: string,
  pct: number,
  subText?: string,
): void {
  const valRow = card.querySelector('[data-name="Value row"]');
  if (valRow) {
    const ps = valRow.querySelectorAll("p");
    if (ps[0]) ps[0].textContent = valueText;
    if (ps[1]) ps[1].textContent = targetText;
  }
  const track = card.querySelector<HTMLElement>('[data-name="Track"]');
  if (track) {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    const stop2 = Math.min(100, clamped + 0.01);
    track.style.backgroundImage = `linear-gradient(90deg, rgb(17, 24, 39) 0%, rgb(17, 24, 39) ${clamped}%, rgb(229, 231, 235) ${stop2}%, rgb(229, 231, 235) 100%)`;
  }
  if (subText) {
    const directPs = Array.from(card.children).filter((el) => el.tagName === "P");
    if (directPs[1]) directPs[1].textContent = subText;
  }
}

/** Hydrates a Chart card's subtitle, status pill, bar heights, and X-axis window. */
function hydrateChartCard(
  card: Element,
  subtitle: string,
  statusLabel: string,
  statusLevel: string,
  values: number[],
  startDay: number,
  endDay: number,
  colorFn?: (val: number, idx: number) => string,
): void {
  const textBox = card.querySelector('[data-name="Header"] [data-name="Text"]');
  const textPs = textBox?.querySelectorAll("p");
  if (textPs && textPs[1]) {
    textPs[1].textContent = subtitle;
  }
  const statusChip = card.querySelector('[data-name="Status"]');
  if (statusChip) {
    const dot = statusChip.querySelector("img");
    if (dot) dot.setAttribute("src", dotForLevel(statusLevel));
    const p = statusChip.querySelector("p");
    if (p) p.textContent = statusLabel;
  }
  const plot = card.querySelector('[data-name="Plot"]');
  if (plot && values.length > 0) {
    applySparklineBars(plot, values, 12, 128, colorFn);
  }
  updateChartXAxis(card, startDay, endDay);
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

interface DomainActionItem {
  text: string;
  targets: string;
  evidence_stars: 1 | 2 | 3;
  guideId?: string;
  screenId?: ScreenId;
  actionLabel?: string;
}

/** Returns domain-relevant actions without cross-polluting Immune saliva tasks into Bone/Heart views. */
function getDomainActions(
  riskKey: "immune" | "musculoskeletal" | "cardio",
  engine: EngineDayOutput,
): DomainActionItem[] {
  const belongsToRisk = (targets: string, text: string): boolean => {
    const k = `${targets} ${text}`.toLowerCase();
    if (riskKey === "immune") {
      if (/\b(ared|resistance|bone|muscle|orthostatic)\b/.test(k) && !k.includes("immune")) {
        return false;
      }
      return true;
    }
    if (riskKey === "musculoskeletal") {
      return /\b(musculoskeletal|bone|muscle|ared|resistance|vitamin d|calcium|unload)\b/.test(k);
    }
    return /\b(cardio|heart|fluid|bp|blood pressure|rhr|hrv|aerobic|hydration|sodium|orthostatic)\b/.test(k);
  };

  const inferActionLink = (
    text: string,
  ): Pick<DomainActionItem, "guideId" | "screenId" | "actionLabel"> => {
    const t = text.toLowerCase();
    if (t.includes("saliva")) return { guideId: "saliva_sample_kit", actionLabel: "How to collect saliva" };
    if (t.includes("wearable") || t.includes("hrv")) return { guideId: "wearable_hrv_fit", actionLabel: "Wearable fit check" };
    if (t.includes("blood pressure") || t.includes("cuff")) return { guideId: "blood_pressure_cuff", actionLabel: "BP cuff guide" };
    if (t.includes("sleep")) return { screenId: "LogSleep", actionLabel: "Open Log › Sleep" };
    if (t.includes("ared") || t.includes("resistance") || t.includes("exercise")) {
      return { screenId: "LogEnvironmentGravity", actionLabel: "Open Log › Gravity & Exercise" };
    }
    if (t.includes("vitamin d") || t.includes("protein") || t.includes("calcium") || t.includes("hydrat")) {
      return { screenId: "LogNutrition", actionLabel: "Open Log › Nutrition" };
    }
    if (t.includes("shelter") || t.includes("radiation")) {
      return { screenId: "EmergencySolarRadiationStorm", actionLabel: "Open shelter protocol" };
    }
    if (t.includes("fluid")) {
      return { screenId: "DetailFluidShiftCountermeasure", actionLabel: "View fluid-shift detail" };
    }
    return { screenId: "LogVitals", actionLabel: "Open Log › Vitals" };
  };

  const result: DomainActionItem[] = [];
  const seen = new Set<string>();
  const pushUnique = (item: DomainActionItem) => {
    const key = item.text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  };

  const sortedEngine = [...engine.actions].sort((a, b) => a.rank - b.rank);
  for (const act of sortedEngine) {
    if (act.targets === riskKey || belongsToRisk(act.targets, act.text)) {
      pushUnique({
        text: act.text,
        targets: act.targets,
        evidence_stars: act.evidence_stars,
        ...inferActionLink(act.text),
      });
    }
  }

  const fallbacks: Record<"immune" | "musculoskeletal" | "cardio", DomainActionItem[]> = {
    immune: [
      {
        text: "Prioritize 7.5 h sleep & reduce non-essential workload",
        targets: "sleep deficit & stress reserve",
        evidence_stars: 3,
        screenId: "LogSleep",
        actionLabel: "Open Log › Sleep",
      },
      {
        text: "Collect morning saliva swab to track viral reactivation",
        targets: "early immune detection",
        evidence_stars: 3,
        guideId: "saliva_sample_kit",
        actionLabel: "How to collect saliva",
      },
      {
        text: "Log fever, sore throat, or fatigue in Vitals",
        targets: "symptom surveillance",
        evidence_stars: 3,
        screenId: "LogVitals",
        actionLabel: "Open Log › Vitals",
      },
    ],
    musculoskeletal: [
      {
        text: "Complete scheduled ARED resistance session (45–60 min)",
        targets: "microgravity unloading",
        evidence_stars: 3,
        screenId: "LogEnvironmentGravity",
        actionLabel: "Open Log › Gravity & Exercise",
      },
      {
        text: "Hit daily Vitamin D (800 IU) & protein/calcium target",
        targets: "bone mineral retention",
        evidence_stars: 3,
        screenId: "LogNutrition",
        actionLabel: "Open Log › Nutrition",
      },
      {
        text: "Log post-exercise dizziness or muscle soreness",
        targets: "countermeasure tolerance",
        evidence_stars: 2,
        guideId: "exercise_device_log",
        actionLabel: "Open Exercise guide",
      },
    ],
    cardio: [
      {
        text: "Complete fluid-shift & lower-body orthostatic countermeasure",
        targets: "plasma volume & vascular tone",
        evidence_stars: 3,
        screenId: "DetailFluidShiftCountermeasure",
        actionLabel: "View fluid-shift detail",
      },
      {
        text: "Maintain 25–30 min aerobic CEVIS conditioning as cleared",
        targets: "aerobic cardiac capacity",
        evidence_stars: 3,
        screenId: "DetailExerciseCountermeasures",
        actionLabel: "View exercise detail",
      },
      {
        text: "Measure morning resting BP cuff at heart level",
        targets: "arterial pressure baseline",
        evidence_stars: 3,
        guideId: "blood_pressure_cuff",
        actionLabel: "BP cuff guide",
      },
    ],
  };

  for (const fb of fallbacks[riskKey]) {
    if (result.length >= 4) break;
    pushUnique(fb);
  }
  return result.slice(0, 4);
}

/** Hydrates Alert banner on HealthHome & HealthEnvironment with context-aware routing. */
function hydrateAlertBanner(
  artboard: HTMLElement,
  record: DailyRecordRow,
  engine: EngineDayOutput,
  state: AppContextState,
): void {
  const banner = artboard.querySelector<HTMLElement>('[data-name="Alert banner"]');
  if (!banner) return;

  const inAdaptation = state.missionDay <= 14;
  const bannerIcon = banner.querySelector("img");
  const bannerPs = banner.querySelectorAll("p");
  const bannerAction = banner.querySelector<HTMLElement>('[data-name="Action"], [data-name="Button"]');
  const cloneActionBtn = bannerAction ? (bannerAction.cloneNode(true) as HTMLElement) : null;

  let title = "";
  let body = "";
  let actionText = "View";
  let bg = "#ecfdf5";
  let border = "1px solid #d1fae5";
  let iconPath = "./assets/figma/imgDotNormal.svg";
  let onActivate: () => void = () => state.openToolGuide("wearable_hrv_fit");

  if (record.radiation_msv >= 1.5) {
    bg = "#fee2e2";
    border = "1.5px solid #ef4444";
    iconPath = "./assets/figma/imgIconAlertDanger.svg";
    title = `Solar Particle Event (SPE) · Dose ${record.radiation_msv.toFixed(2)} mSv`;
    body = "Move to shielded storm shelter now · NOAA SWPC GOES / OSDR RadLab model";
    actionText = "Shelter protocol";
    onActivate = () => state.openEmergencyProtocol("solar_radiation_storm");
  } else if (engine.flags.infection_early_warning) {
    bg = "#fee2e2";
    border = "1.5px solid #ef4444";
    iconPath = "./assets/figma/imgIconAlertDanger.svg";
    title = `Pre-symptomatic infection early warning · Immune = ${formatRiskLevel(engine.risks.immune.level)}`;
    body = `Resting HR elevated ≥ 2 SD for ≥ 2 days (${record.rhr_bpm.toFixed(0)} bpm) — take morning saliva swab & rest`;
    actionText = "Review immune risk";
    onActivate = () => state.openRiskScreen("immune");
  } else if (engine.data_quality.status === "check_device") {
    bg = "#fef3c7";
    border = "1.5px solid #f59e0b";
    iconPath = "./assets/figma/imgIconAlertWarning.svg";
    title = "Device or astronaut? Check sensor contact before acting";
    body = `${engine.data_quality.reasons[0] ?? "Low signal quality"} · ${engine.data_quality.suggested_step}`;
    actionText = "How to fix sensor";
    const guide = record.temp_c < 34 ? "thermometer" : "wearable_hrv_fit";
    onActivate = () => state.openToolGuide(guide);
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
    const topAction = getDomainActions(topKey, engine)[0]?.text ?? engine.actions[0]?.text ?? "See system drivers below";
    bg = isAct ? "#fee2e2" : "#fef3c7";
    border = isAct ? "1.5px solid #ef4444" : "1px solid #f59e0b";
    iconPath = isAct ? "./assets/figma/imgIconAlertDanger.svg" : "./assets/figma/imgIconAlertWarning.svg";
    title = `${topLabel}: ${formatRiskLevel(topRisk.level)} (${topRisk.score}/100)`;
    body = `Top action: ${topAction}`;
    actionText = "See why & fix";
    onActivate = () => state.openRiskScreen(topKey);
  } else {
    title = inAdaptation
      ? "Adaptation phase (Days 1–14): baseline learning & alerts dampened"
      : "All body systems nominal vs your personal Day 1–14 baseline";
    body = `Sensor quality ${Math.round(record.signal_quality * 100)}% · Sleep ${record.sleep_hours.toFixed(1)} h · RHR ${record.rhr_bpm.toFixed(0)} bpm`;
    actionText = "Tool guides";
  }

  const bannerTextWrap = banner.querySelector<HTMLElement>('[data-name="Text"]');
  if (bannerTextWrap) {
    bannerTextWrap.classList.remove("whitespace-nowrap");
    bannerTextWrap.style.whiteSpace = "normal";
  }

  banner.style.backgroundColor = bg;
  banner.style.border = border;
  banner.style.cursor = "pointer";
  if (bannerIcon) bannerIcon.setAttribute("src", iconPath);
  if (bannerPs[0]) {
    bannerPs[0].classList.remove("whitespace-nowrap");
    bannerPs[0].textContent = title;
  }
  if (bannerPs[1]) {
    bannerPs[1].classList.remove("whitespace-nowrap");
    bannerPs[1].style.whiteSpace = "normal";
    bannerPs[1].textContent = body;
  }

  if (cloneActionBtn) {
    const bp = cloneActionBtn.querySelector("p");
    if (bp) bp.textContent = actionText;
    cloneActionBtn.style.cursor = "pointer";
    cloneActionBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onActivate();
    });
    bannerAction?.replaceWith(cloneActionBtn);
  }

  banner.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onActivate();
  });
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
  hydrateAlertBanner(artboard, record, engine, state);

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

  // Figma left [data-name="Tooltip"] permanently visible over the alert banner & Heart card.
  // Hide it by default and only show on hover/focus/click of the Health Score info icon.
  const floatingTooltip = artboard.querySelector<HTMLElement>('[data-name="Tooltip"]');
  if (floatingTooltip) {
    floatingTooltip.hidden = true;
    floatingTooltip.style.display = "none";
    floatingTooltip.style.pointerEvents = "none";
    floatingTooltip.style.zIndex = "45";
    floatingTooltip.style.left = "334px";
    floatingTooltip.style.top = "278px";
    const tooltipP = floatingTooltip.querySelector("p");
    if (tooltipP) {
      tooltipP.textContent =
        "Composite indicator comparing stress, sleep, vitals & downstream risks to YOUR Day 1–14 baseline (not a diagnosis).";
    }
    const infoEl = scoreCard?.querySelector<HTMLElement>('[data-name="icon/info"], [data-name="Info"]');
    if (infoEl) {
      infoEl.style.cursor = "help";
      infoEl.tabIndex = 0;
      infoEl.setAttribute("role", "button");
      infoEl.setAttribute("aria-label", "About Health Score");
      const showTip = () => {
        floatingTooltip.hidden = false;
        floatingTooltip.style.display = "flex";
      };
      const hideTip = () => {
        floatingTooltip.hidden = true;
        floatingTooltip.style.display = "none";
      };
      infoEl.addEventListener("mouseenter", showTip);
      infoEl.addEventListener("mouseleave", hideTip);
      infoEl.addEventListener("focus", showTip);
      infoEl.addEventListener("blur", hideTip);
      infoEl.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (floatingTooltip.hidden) showTip();
        else hideTip();
      });
    }
  }

  // 3 Overview Metric Cards
  const metricCards = Array.from(artboard.querySelectorAll('[data-name="Metric card"]'));
  for (const card of metricCards) {
    const subP = Array.from(card.children).find((c) => c.tagName === "P") as HTMLElement | undefined;
    if (subP) {
      subP.classList.remove("whitespace-nowrap");
      subP.style.whiteSpace = "normal";
      subP.style.width = "100%";
    }
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
  const riskRow = riskCards[0]?.parentElement as HTMLElement | null;
  if (riskRow) {
    riskRow.style.alignItems = "stretch";
    riskRow.style.overflow = "visible";
  }
  for (const card of riskCards) {
    (card as HTMLElement).style.alignSelf = "stretch";
    const title = card.querySelector('[data-name="Header"] p, [data-name="Title"] p')?.textContent?.trim() ?? "";
    let riskKey: "immune" | "musculoskeletal" | "cardio" = "immune";
    if (title.includes("Bone") || title.includes("Muscle")) riskKey = "musculoskeletal";
    else if (title.includes("Heart")) riskKey = "cardio";

    const risk = engine.risks[riskKey];
    const levelLabel = formatRiskLevel(risk.level);
    const pill = card.querySelector('[data-name="Level"], [data-name="Risk level pill"]');
    if (pill) {
      const dot = pill.querySelector("img");
      if (dot) dot.setAttribute("src", dotForLevel(risk.level));
      const p = pill.querySelector("p");
      if (p) p.textContent = `${levelLabel} · ${risk.score}`;
    }

    const levelMeter = card.querySelector('[data-name="Level meter"], [data-name="Level bar"]');
    if (levelMeter) {
      const segs = Array.from(levelMeter.children) as HTMLElement[];
      const filled = risk.level === "act" ? 3 : risk.level === "watch" ? 2 : 1;
      const tierColors =
        risk.level === "act"
          ? ["#ef4444", "#dc2626", "#b91c1c"]
          : risk.level === "watch"
            ? ["#22c55e", "#f59e0b", "#e5e7eb"]
            : ["#22c55e", "#e5e7eb", "#e5e7eb"];
      segs.forEach((seg, idx) => {
        seg.style.backgroundColor = idx < filled ? tierColors[idx] : "#e5e7eb";
      });
    }

    // Why bullet rows (up to 3 top contributors + accurate dot indicators)
    const whyBlock = card.querySelector('[data-name="Why"]');
    if (whyBlock) {
      const topDrivers = risk.drivers.slice(0, 3);
      const bulletNodes = Array.from(whyBlock.children).slice(1);
      bulletNodes.forEach((node, idx) => {
        const p = node.querySelector("p") ?? (node.tagName === "P" ? node : null);
        if (!p) return;
        const d = topDrivers[idx];
        const dotImg = node.querySelector("img");
        if (!d) {
          if (idx === 0 && topDrivers.length === 0) {
            (node as HTMLElement).style.display = "";
            if (dotImg) dotImg.setAttribute("src", "./assets/figma/imgDotNormal.svg");
            p.textContent = "All tracked drivers within personal baseline";
          } else {
            (node as HTMLElement).style.display = "none";
          }
          return;
        }
        (node as HTMLElement).style.display = "";
        (node as HTMLElement).style.width = "100%";
        const driverLvl = Math.abs(d.z) >= 1.5 ? "act" : Math.abs(d.z) >= 0.7 ? "watch" : "normal";
        if (dotImg) dotImg.setAttribute("src", dotForLevel(driverLvl));
        const stars = "★".repeat(d.evidence_stars);
        const factorLabel = d.factor.replace(/_/g, " ");
        p.classList.remove("whitespace-nowrap");
        (p as HTMLElement).style.whiteSpace = "normal";
        p.textContent = `${factorLabel} (${stars}, z=${d.z >= 0 ? "+" : ""}${d.z.toFixed(1)})`;
      });
    }

    // Suggested action line (matched strictly to this risk domain)
    const todoBlock = card.querySelector<HTMLElement>('[data-name="Action"], [data-name="What to do"]');
    if (todoBlock) {
      todoBlock.style.marginTop = "auto";
      const todoPs = todoBlock.querySelectorAll("p");
      const matchingAction = getDomainActions(riskKey, engine)[0];
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
    updateChartXAxis(chartCard, start30, state.missionDay);
  }

  // Why it matters -> replace Chain rows dynamically with drivers + stars + citations
  const whySection = artboard.querySelector('[data-name="Why it matters"]');
  if (whySection) {
    const header = whySection.querySelector('[data-name="Section header"]');
    const driverRows =
      risk.drivers.length > 0
        ? risk.drivers.map((driver, idx) => {
            const cite = getSourceCitation(bundle, driver.source_id);
            const citeText = cite?.citation ?? cite?.title ?? driver.source_id;
            const pct = Math.round(driver.contribution * 100);
            return h(
              "div",
              { className: "boops-dyn-row", "data-name": "Chain row" },
              h(
                "div",
                { className: "boops-dyn-head" },
                h("strong", null, `${idx + 1}. ${driver.factor.replace(/_/g, " ")}`),
                h(
                  "span",
                  { className: "boops-dyn-pill boops-dyn-pill-subtle" },
                  formatStars(driver.evidence_stars),
                ),
              ),
              h("p", { className: "boops-dyn-chain" }, driver.chain),
              h(
                "div",
                { className: "boops-dyn-meta" },
                h("span", null, `z = ${driver.z >= 0 ? "+" : ""}${driver.z.toFixed(2)}`),
                h("span", null, `Contribution +${pct} pts`),
                h("span", null, `Source: ${citeText}`),
              ),
            );
          })
        : [
            h(
              "div",
              { className: "boops-dyn-row", "data-name": "Chain row" },
              h(
                "div",
                { className: "boops-dyn-head" },
                h("strong", null, "Within personal baseline"),
                h("span", { className: "boops-dyn-pill" }, "Normal"),
              ),
              h(
                "p",
                { className: "boops-dyn-chain" },
                "No elevated risk drivers detected relative to Days 1–14 baseline.",
              ),
            ),
          ];
    if (header) {
      whySection.replaceChildren(header, ...driverRows);
    }
  }

  // How to fix -> populate domain-specific ranked actions sequentially (1..N)
  const fixSection = artboard.querySelector('[data-name="How to fix"]');
  if (fixSection) {
    const header = fixSection.querySelector('[data-name="Section header"]');
    const domainActions = getDomainActions(riskKey, engine);
    const actionNodes = domainActions.map((action, idx) => {
      const actionLink = action.actionLabel
        ? h(
            "button",
            {
              type: "button",
              className: "boops-dyn-action-btn",
              onClick: (ev: MouseEvent) => {
                ev.stopPropagation();
                if (action.guideId) state.openToolGuide(action.guideId);
                else if (action.screenId) state.navigateScreen(action.screenId);
              },
            },
            `${action.actionLabel} →`,
          )
        : null;

      return h(
        "div",
        { className: "boops-dyn-row", "data-name": "Action step" },
        h(
          "div",
          { className: "boops-dyn-step-row" },
          h("span", { className: "boops-dyn-step-num" }, String(idx + 1)),
          h(
            "div",
            { className: "boops-dyn-step-body" },
            h("p", { className: "boops-dyn-step-text" }, action.text),
            h(
              "div",
              { className: "boops-dyn-meta" },
              h("span", { className: "boops-dyn-pill boops-dyn-pill-subtle" }, `Targets: ${action.targets.replace(/_/g, " ")}`),
              h("span", { className: "boops-dyn-pill" }, formatStars(action.evidence_stars)),
            ),
            actionLink ?? "",
          ),
        ),
      );
    });
    if (header) {
      fixSection.replaceChildren(header, ...actionNodes);
    }
  }

  // Related systems chips navigation
  const relatedChips = Array.from(artboard.querySelectorAll('[data-name="Related systems"] [data-name="Chip"]'));
  for (const chip of relatedChips) {
    const label = chip.textContent?.toLowerCase() ?? "";
    (chip as HTMLElement).style.cursor = "pointer";
    chip.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (label.includes("immune")) state.openRiskScreen("immune");
      else if (label.includes("bone") || label.includes("muscle") || label.includes("exercise")) {
        state.openRiskScreen("musculoskeletal");
      } else if (label.includes("heart") || label.includes("cardio")) {
        state.openRiskScreen("cardio");
      } else if (label.includes("saliva")) {
        state.openToolGuide("saliva_sample_kit");
      } else if (label.includes("sleep")) {
        state.navigateScreen("HealthSleep");
      } else if (label.includes("stress")) {
        state.navigateScreen("HealthMindfulness");
      }
    });
  }

  // Crew-first privacy toggle on Risk Detail screen ("Share with mission control" defaults OFF)
  const rawToggle = artboard.querySelector('[data-name="Toggle"], [data-name="Share toggle"]') as HTMLElement | null;
  if (rawToggle) {
    const shareToggle = rawToggle.cloneNode(true) as HTMLElement;
    const isShared = Boolean(state.sharing.risk_detail_share[riskKey]);
    const isShareAttr = rawToggle.getAttribute("data-name") === "Share toggle";
    const img = shareToggle.querySelector("img");
    if (img) {
      img.setAttribute(
        "src",
        isShared
          ? "./assets/figma/imgToggleOn.svg"
          : isShareAttr
            ? "./assets/figma/imgShareToggle.svg"
            : "./assets/figma/imgToggleOff.svg",
      );
    }
    const footer = rawToggle.parentElement;
    const footerPs = footer ? Array.from(footer.querySelectorAll("p")) : [];
    const statusP = footerPs.find((p) => /^(on|off)$/i.test(p.textContent?.trim() ?? ""));
    if (statusP) {
      statusP.textContent = isShared ? "On" : "Off";
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

interface DetailMetricSpec {
  title: string;
  bigText: string;
  subText: string;
  todayStat: string;
  baselineStat: string;
  statusLabel: string;
  statusLevel: "normal" | "watch" | "act";
  series: number[];
}

function deterministicDelta(astronautId: string, day: number, mod: number): number {
  return Math.abs(astronautId.charCodeAt(1) * 31 + day * 17) % mod;
}

function calcSleepEfficiency(r: DailyRecordRow): number {
  return Math.min(98, Math.max(68, Math.round(74 + r.sleep_quality_1to5 * 4 + (r.sleep_hours - 6) * 2)));
}

function calcWakeUps(r: DailyRecordRow): number {
  return Math.max(0.4, Number((4.6 - r.sleep_quality_1to5 * 0.65 - (r.sleep_hours - 6) * 0.25).toFixed(1)));
}

function calcCabinCo2(r: DailyRecordRow, astronautId: string, day: number): number {
  return Math.round(2150 + (r.eva ? 420 : 0) + ((day * 173 + astronautId.charCodeAt(1) * 97 + Math.round(r.exercise_min * 7)) % 750));
}

function calcBoneRate(r: DailyRecordRow): number {
  return Number((-1.5 + Math.min(0.65, r.resistance_min / 85)).toFixed(1));
}

function calcCalories(r: DailyRecordRow, astronautId: string, day: number): number {
  return Math.round(2150 + r.exercise_min * 7 + (r.eva ? 350 : 0) + (deterministicDelta(astronautId, day, 260) - 130));
}

function calcProtein(r: DailyRecordRow, astronautId: string, day: number): number {
  return Math.round(84 + r.resistance_min * 0.35 + deterministicDelta(astronautId, day, 14));
}

function calcWaterL(r: DailyRecordRow, astronautId: string, day: number): number {
  return Number((2.0 + r.exercise_min * 0.008 + (deterministicDelta(astronautId, day, 6) - 2) * 0.08).toFixed(1));
}

function calcVitD(astronautId: string, day: number): number {
  return Math.min(800, 500 + deterministicDelta(astronautId, day, 4) * 100);
}

function calcGlucose(e: EngineDayOutput, astronautId: string, day: number): number {
  return Math.round(91 + (e.sleep_score < 60 ? 6 : 0) + deterministicDelta(astronautId, day, 11));
}

function calcBodyMass(astronautId: string, day: number): number {
  const base = astronautId === "A2" ? 76.4 : astronautId === "A3" ? 63.8 : 68.5;
  return Number((base - day * 0.006 + Math.sin(day / 5) * 0.25).toFixed(1));
}

function calcSodium(astronautId: string, day: number): number {
  return Number((2.8 + deterministicDelta(astronautId, day, 10) * 0.1).toFixed(1));
}

function getDetailMetricSpec(
  screenId: ScreenId,
  series: Array<{ record: DailyRecordRow | undefined; engine: EngineDayOutput }>,
  record: DailyRecordRow,
  engine: EngineDayOutput,
  cumDose: number,
  state: AppContextState,
): DetailMetricSpec | null {
  const astro = state.astronautId;
  const composite = (e: EngineDayOutput) =>
    Math.max(5, Math.round(100 - (e.risks.immune.score * 0.4 + e.risks.musculoskeletal.score * 0.3 + e.risks.cardio.score * 0.3)));

  switch (screenId) {
    case "DetailHealthScore": {
      const score = composite(engine);
      const lvl = score < 55 ? "act" : score < 72 ? "watch" : "normal";
      return {
        title: "Health score",
        bigText: String(score),
        subText: `of 100 · ${formatRiskLevel(lvl)}`,
        todayStat: `${score} / 100`,
        baselineStat: "Days 1–14 baseline",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => composite(s.engine)),
      };
    }
    case "DetailRestingHeartRate": {
      const zRhr = engine.z.rhr_bpm ?? 0;
      const lvl = Math.abs(zRhr) >= 2 ? "watch" : "normal";
      const baseMean = (engine.baseline.rhr_bpm?.mean ?? 60).toFixed(0);
      return {
        title: "Resting heart rate",
        bigText: String(Math.round(record.rhr_bpm)),
        subText: `bpm · ${formatRiskLevel(lvl)}`,
        todayStat: `${Math.round(record.rhr_bpm)} bpm`,
        baselineStat: `${baseMean} bpm (Days 1–14)`,
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => Math.min(115, s.record?.rhr_bpm ?? 60)),
      };
    }
    case "DetailHrv": {
      const lvl = engine.stress_score >= 70 ? "act" : engine.stress_score >= 45 ? "watch" : "normal";
      const baseMean = (engine.baseline.hrv_rmssd_ms?.mean ?? 50).toFixed(0);
      return {
        title: "HRV (RMSSD)",
        bigText: String(Math.round(record.hrv_rmssd_ms)),
        subText: `ms · ${formatRiskLevel(lvl)}`,
        todayStat: `${Math.round(record.hrv_rmssd_ms)} ms`,
        baselineStat: `${baseMean} ms (Days 1–14)`,
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => s.record?.hrv_rmssd_ms ?? 50),
      };
    }
    case "DetailBloodPressure": {
      const lvl = record.sbp_mmhg >= 135 || record.dbp_mmhg >= 88 ? "watch" : "normal";
      const bp = `${Math.round(record.sbp_mmhg)}/${Math.round(record.dbp_mmhg)}`;
      return {
        title: "Blood pressure",
        bigText: bp,
        subText: `mmHg · ${formatRiskLevel(lvl)}`,
        todayStat: `${bp} mmHg`,
        baselineStat: `${(engine.baseline.sbp_mmhg?.mean ?? 112).toFixed(0)}/${(engine.baseline.dbp_mmhg?.mean ?? 74).toFixed(0)} mmHg`,
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => s.record?.sbp_mmhg ?? 112),
      };
    }
    case "DetailBloodOxygenSpo2": {
      const lvl = record.spo2_pct < 92 ? "act" : record.spo2_pct < 95 ? "watch" : "normal";
      return {
        title: "Blood oxygen (SpO₂)",
        bigText: record.spo2_pct.toFixed(1),
        subText: `% · ${formatRiskLevel(lvl)}`,
        todayStat: `${record.spo2_pct.toFixed(1)} %`,
        baselineStat: `${(engine.baseline.spo2_pct?.mean ?? 98).toFixed(1)} %`,
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => s.record?.spo2_pct ?? 98),
      };
    }
    case "DetailSleepDuration": {
      const lvl = record.sleep_hours < 6 ? "watch" : "normal";
      return {
        title: "Sleep duration",
        bigText: record.sleep_hours.toFixed(1),
        subText: `h · ${formatRiskLevel(lvl)}`,
        todayStat: `${record.sleep_hours.toFixed(1)} h`,
        baselineStat: `${(engine.baseline.sleep_hours?.mean ?? 7.0).toFixed(1)} h`,
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => s.record?.sleep_hours ?? 6.8),
      };
    }
    case "DetailSleepScore": {
      const lvl = engine.sleep_score < 45 ? "act" : engine.sleep_score < 68 ? "watch" : "normal";
      return {
        title: "Sleep score",
        bigText: String(engine.sleep_score),
        subText: `of 100 · ${formatRiskLevel(lvl)}`,
        todayStat: `${engine.sleep_score} / 100`,
        baselineStat: "≥ 70 / 100",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => s.engine.sleep_score),
      };
    }
    case "DetailSleepQuality": {
      const eff = calcSleepEfficiency(record);
      const lvl = eff < 82 ? "watch" : "normal";
      return {
        title: "Sleep efficiency",
        bigText: String(eff),
        subText: `% · ${formatRiskLevel(lvl)}`,
        todayStat: `${eff}% (${record.sleep_quality_1to5}/5)`,
        baselineStat: "≥ 85% efficiency",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => (s.record ? calcSleepEfficiency(s.record) : 85)),
      };
    }
    case "DetailSleepAidUse": {
      const recentPoor = series.slice(-7).filter((s) => (s.record?.sleep_quality_1to5 ?? 4) <= 2 || (s.record?.sleep_hours ?? 7) < 6).length;
      const lvl = recentPoor >= 4 ? "watch" : "normal";
      return {
        title: "Sleep aid use",
        bigText: String(recentPoor),
        subText: `of 7 nights · ${formatRiskLevel(lvl)}`,
        todayStat: `${recentPoor} nights this week`,
        baselineStat: "≤ 2 nights / week",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => ((s.record?.sleep_hours ?? 7) < 6 ? 1 : 0)),
      };
    }
    case "DetailStressScore": {
      const lvl = engine.stress_score >= 70 ? "act" : engine.stress_score >= 45 ? "watch" : "normal";
      return {
        title: "Stress score",
        bigText: String(engine.stress_score),
        subText: `of 100 · ${formatRiskLevel(lvl)}`,
        todayStat: `${engine.stress_score} / 100`,
        baselineStat: "< 45 / 100 (Days 1–14)",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => s.engine.stress_score),
      };
    }
    case "DetailMood": {
      const lvl = record.mood_1to5 <= 2 ? "watch" : "normal";
      return {
        title: "Mood",
        bigText: record.mood_1to5.toFixed(1),
        subText: `/ 5 · ${formatRiskLevel(lvl)}`,
        todayStat: `${record.mood_1to5} / 5`,
        baselineStat: `${(engine.baseline.mood_1to5?.mean ?? 3.8).toFixed(1)} / 5`,
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => s.record?.mood_1to5 ?? 3.5),
      };
    }
    case "DetailMindfulPractice": {
      const mindfulMin = Math.round(series.slice(-7).reduce((acc, s) => acc + ((s.record?.mood_1to5 ?? 3) >= 3 ? 10 : 5), 0));
      return {
        title: "Mindful practice",
        bigText: String(mindfulMin),
        subText: "of 70 min · Normal",
        todayStat: `${mindfulMin} min (7d)`,
        baselineStat: "70 min / week goal",
        statusLabel: "Normal",
        statusLevel: "normal",
        series: series.map((s) => ((s.record?.mood_1to5 ?? 3) >= 3 ? 12 : 6)),
      };
    }
    case "DetailCabinAirCo2": {
      const co2 = calcCabinCo2(record, astro, state.missionDay);
      const lvl = co2 >= 3000 ? "act" : co2 >= 2600 ? "watch" : "normal";
      return {
        title: "Cabin air (CO₂)",
        bigText: co2.toLocaleString("en-US"),
        subText: `ppm · ${formatRiskLevel(lvl)}`,
        todayStat: `${co2.toLocaleString("en-US")} ppm`,
        baselineStat: "< 2,500 ppm nominal",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => (s.record ? calcCabinCo2(s.record, astro, s.engine.mission_day) : 2400)),
      };
    }
    case "DetailRadiationDose": {
      const lvl = record.radiation_msv >= 1.5 ? "act" : record.radiation_msv >= 0.8 ? "watch" : "normal";
      return {
        title: "Radiation dose",
        bigText: record.radiation_msv.toFixed(2),
        subText: `mSv/day · ${formatRiskLevel(lvl)}`,
        todayStat: `${record.radiation_msv.toFixed(2)} mSv/day`,
        baselineStat: `${(engine.baseline.radiation_msv?.mean ?? 0.5).toFixed(2)} mSv/day`,
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => s.record?.radiation_msv ?? 0.5),
      };
    }
    case "DetailMissionCareerDose": {
      const lvl = cumDose >= 450 ? "act" : cumDose >= 250 ? "watch" : "normal";
      let running = 0;
      return {
        title: "Mission & career dose",
        bigText: cumDose.toFixed(1),
        subText: `mSv mission · ${formatRiskLevel(lvl)}`,
        todayStat: `${cumDose.toFixed(1)} / 600 mSv`,
        baselineStat: "NASA 600 mSv career cap",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => {
          running += s.record?.radiation_msv ?? 0.5;
          return running;
        }),
      };
    }
    case "DetailSpaceWeather": {
      const lvl = record.radiation_msv >= 1.5 ? "act" : record.radiation_msv >= 0.8 ? "watch" : "normal";
      return {
        title: "Space weather",
        bigText: record.radiation_msv >= 1.5 ? "SPE" : record.radiation_msv >= 0.8 ? "Elevated" : "Quiet",
        subText: `${formatRiskLevel(lvl)} · GOES/RadLab`,
        todayStat: `${record.radiation_msv.toFixed(2)} mSv/day`,
        baselineStat: "< 0.80 mSv/day quiet",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => s.record?.radiation_msv ?? 0.5),
      };
    }
    case "DetailMissionDay":
    case "DetailMicrogravityExposure": {
      return {
        title: screenId === "DetailMissionDay" ? "Mission day" : "Microgravity exposure",
        bigText: String(state.missionDay),
        subText: state.missionDay <= 14 ? "of 180 · Adaptation" : "of 180 · Normal",
        todayStat: `Day ${state.missionDay} of 180`,
        baselineStat: "Days 1–14 baseline",
        statusLabel: "Normal",
        statusLevel: "normal",
        series: series.map((s) => s.engine.mission_day),
      };
    }
    case "DetailBoneDensity": {
      const rate = calcBoneRate(record);
      const lvl = rate <= -1.2 ? "watch" : "normal";
      return {
        title: "Bone density",
        bigText: `${rate >= 0 ? "+" : ""}${rate.toFixed(1)}`,
        subText: `%/month · ${formatRiskLevel(lvl)}`,
        todayStat: `${rate.toFixed(1)} %/month (est.)`,
        baselineStat: "-1.0 %/month target w/ ARED",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => (s.record ? calcBoneRate(s.record) + 2 : 1.0)),
      };
    }
    case "DetailExerciseCountermeasures": {
      const hrs = (record.exercise_min / 60).toFixed(1);
      const lvl = record.resistance_min < 25 ? "watch" : "normal";
      return {
        title: "Exercise countermeasures",
        bigText: hrs,
        subText: `h/day (${Math.round(record.resistance_min)}m ARED) · ${formatRiskLevel(lvl)}`,
        todayStat: `${hrs} h (${Math.round(record.resistance_min)} min ARED)`,
        baselineStat: "2.0–2.5 h/day + ARED",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => s.record?.exercise_min ?? 60),
      };
    }
    case "DetailFluidShiftCountermeasure": {
      const sessions = Math.min(5, Math.max(1, Math.round(series.slice(-7).filter((s) => (s.record?.exercise_min ?? 0) >= 60).length * 0.75)));
      return {
        title: "Fluid-shift countermeasure",
        bigText: String(sessions),
        subText: "of 5 sessions · Normal",
        todayStat: `${sessions} of 5 sessions (7d)`,
        baselineStat: "5 sessions / week",
        statusLabel: "Normal",
        statusLevel: "normal",
        series: series.map((s) => s.record?.sbp_mmhg ?? 112),
      };
    }
    case "DetailCaloriesProtein": {
      const kcal = calcCalories(record, astro, state.missionDay);
      const prot = calcProtein(record, astro, state.missionDay);
      return {
        title: "Calories & protein",
        bigText: kcal.toLocaleString("en-US"),
        subText: `kcal (${prot} g protein) · Normal`,
        todayStat: `${kcal.toLocaleString("en-US")} kcal · ${prot} g`,
        baselineStat: "2,800 kcal · 110 g protein",
        statusLabel: "Normal",
        statusLevel: "normal",
        series: series.map((s) => (s.record ? calcCalories(s.record, astro, s.engine.mission_day) : 2450)),
      };
    }
    case "DetailWater": {
      const w = calcWaterL(record, astro, state.missionDay);
      const lvl = w < 2.0 ? "watch" : "normal";
      return {
        title: "Water",
        bigText: w.toFixed(1),
        subText: `of 2.5 L · ${formatRiskLevel(lvl)}`,
        todayStat: `${w.toFixed(1)} L today`,
        baselineStat: "2.5 L / day target",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => (s.record ? calcWaterL(s.record, astro, s.engine.mission_day) : 2.2)),
      };
    }
    case "DetailVitaminD": {
      const iu = calcVitD(astro, state.missionDay);
      const lvl = iu < 700 ? "watch" : "normal";
      return {
        title: "Vitamin D",
        bigText: String(iu),
        subText: `of 800 IU · ${formatRiskLevel(lvl)}`,
        todayStat: `${iu} IU`,
        baselineStat: "800 IU / day ISS standard",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => calcVitD(astro, s.engine.mission_day)),
      };
    }
    case "DetailGlucose": {
      const gl = calcGlucose(engine, astro, state.missionDay);
      const lvl = gl >= 110 ? "watch" : "normal";
      return {
        title: "Glucose",
        bigText: String(gl),
        subText: `mg/dL · ${formatRiskLevel(lvl)}`,
        todayStat: `${gl} mg/dL`,
        baselineStat: "75–105 mg/dL fasting",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => calcGlucose(s.engine, astro, s.engine.mission_day)),
      };
    }
    case "DetailBodyMass": {
      const kg = calcBodyMass(astro, state.missionDay);
      return {
        title: "Body mass",
        bigText: kg.toFixed(1),
        subText: "kg · Normal",
        todayStat: `${kg.toFixed(1)} kg`,
        baselineStat: "Maintain ±2% pre-flight",
        statusLabel: "Normal",
        statusLevel: "normal",
        series: series.map((s) => calcBodyMass(astro, s.engine.mission_day)),
      };
    }
    case "DetailSodium": {
      const na = calcSodium(astro, state.missionDay);
      const lvl = na >= 3.3 ? "watch" : "normal";
      return {
        title: "Sodium",
        bigText: na.toFixed(1),
        subText: `g/day · ${formatRiskLevel(lvl)}`,
        todayStat: `${na.toFixed(1)} g/day`,
        baselineStat: "< 3.2 g/day bone-safe cap",
        statusLabel: formatRiskLevel(lvl),
        statusLevel: lvl,
        series: series.map((s) => calcSodium(astro, s.engine.mission_day)),
      };
    }
    default:
      return null;
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
  const isDetail = screenId.startsWith("Detail");
  const winSize = isDetail ? 30 : 14;
  const winStart = Math.max(1, state.missionDay - (winSize - 1));
  const series = getRangeSeries(bundle, state.astronautId, winStart, state.missionDay);
  const series14 = series.slice(-14);
  const cumDose = getCumulativeRadiation(bundle, state.astronautId, state.missionDay);

  if (artboard.querySelector('[data-name="Alert banner"]')) {
    hydrateAlertBanner(artboard, record, engine, state);
  }

  const pageHeader = artboard.querySelector('[data-name="Page header"]');
  if (pageHeader) {
    setParagraphs(pageHeader, [
      [1, `Day ${state.missionDay} · ${getCrewProfile(state.astronautId).id} ${getCrewProfile(state.astronautId).name} · Simulated`],
    ]);
  }

  const detailSpec = isDetail ? getDetailMetricSpec(screenId, series, record, engine, cumDose, state) : null;

  const scoreCard = artboard.querySelector('[data-name="Score card"]');
  if (scoreCard) {
    if (detailSpec) {
      hydrateScoreCard(
        scoreCard,
        detailSpec.title,
        detailSpec.bigText,
        detailSpec.subText,
        detailSpec.series,
      );
    } else if (screenId === "HealthSleep") {
      hydrateScoreCard(
        scoreCard,
        "Sleep score",
        String(engine.sleep_score),
        engine.sleep_score < 45 ? "Below baseline" : "Within baseline",
        series.map((s) => s.engine.sleep_score),
      );
    } else if (screenId === "HealthMindfulness") {
      hydrateScoreCard(
        scoreCard,
        "Stress score",
        String(engine.stress_score),
        engine.stress_score >= 70 ? "Elevated strain" : engine.stress_score >= 45 ? "Moderate" : "Low",
        series.map((s) => s.engine.stress_score),
      );
    } else if (screenId === "HealthEnvironmentRadiation") {
      hydrateScoreCard(
        scoreCard,
        "Mission dose",
        cumDose.toFixed(1),
        `mSv cumulative (${record.radiation_msv.toFixed(2)} mSv today)`,
        series.map((s) => s.record?.radiation_msv ?? 0.5),
      );
    } else if (screenId === "HealthEnvironmentGravity") {
      hydrateScoreCard(
        scoreCard,
        "Days in microgravity",
        String(state.missionDay),
        state.missionDay <= 14 ? "of 180 · Adaptation phase" : "of 180",
        series.map((s) => s.engine.mission_day),
      );
    } else if (screenId === "HealthEnvironment") {
      const co2 = calcCabinCo2(record, state.astronautId, state.missionDay);
      const cabinScore = Math.max(
        40,
        Math.round(95 - Math.max(0, (co2 - 2300) / 100) - Math.max(0, record.radiation_msv - 0.6) * 20),
      );
      hydrateScoreCard(
        scoreCard,
        "Cabin conditions",
        String(cabinScore),
        record.radiation_msv >= 1.5 ? "SPE Shelter Alert" : co2 >= 2600 ? "Watch CO₂" : "Mostly good",
        series.map((s) =>
          s.record ? Math.max(40, Math.round(95 - Math.max(0, s.record.radiation_msv - 0.6) * 20)) : 86,
        ),
      );
    }
  }

  // Update "What it means" Stats on Detail* screens
  if (detailSpec) {
    const todayStatP = artboard.querySelector('[data-name="TODAY"] p:nth-of-type(2)');
    if (todayStatP) todayStatP.textContent = detailSpec.todayStat;
    const baseStatP = artboard.querySelector('[data-name="YOUR BASELINE"] p:nth-of-type(2)');
    if (baseStatP) baseStatP.textContent = detailSpec.baselineStat;
  }

  // Hydrate Metric Cards across Health* screens without colliding shared Category names
  artboard.querySelectorAll('[data-name="Metric card"]').forEach((card) => {
    const label = card.querySelector('[data-name="Category"] p')?.textContent?.trim() ?? "";
    const directPs = Array.from(card.children).filter((el) => el.tagName === "P");
    const cardSub = (directPs[0]?.textContent ?? "").toLowerCase();
    const unitText = (card.querySelector('[data-name="Value row"] p:nth-of-type(2)')?.textContent ?? "").toLowerCase();

    if (label === "Heart" && cardSub.includes("blood pressure")) {
      const bpLvl = record.sbp_mmhg >= 135 || record.dbp_mmhg >= 88 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        `${Math.round(record.sbp_mmhg)}/${Math.round(record.dbp_mmhg)}`,
        "mmHg",
        "Blood pressure",
        bpLvl,
        dotForLevel(bpLvl.toLowerCase()),
        series14.map((s) => s.record?.sbp_mmhg ?? 112),
      );
    } else if (label === "Heart") {
      const isGlitch = engine.data_quality.status === "check_device" && record.rhr_bpm > 150;
      const st = isGlitch ? "Check device" : Math.abs(engine.z.rhr_bpm ?? 0) >= 2 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        String(Math.round(record.rhr_bpm)),
        "bpm",
        "Resting heart rate",
        st,
        dotForLevel(st === "Normal" ? "normal" : "watch"),
        series14.map((s) => Math.min(115, s.record?.rhr_bpm ?? 60)),
      );
    } else if (label === "Lungs" || cardSub.includes("spo")) {
      const lvl = record.spo2_pct < 92 ? "Act" : record.spo2_pct < 95 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        record.spo2_pct.toFixed(1),
        "%",
        "Blood oxygen (SpO₂)",
        lvl,
        dotForLevel(lvl.toLowerCase()),
        series14.map((s) => s.record?.spo2_pct ?? 98),
      );
    } else if (label === "Stress" && cardSub.includes("eda")) {
      hydrateMetricCard(
        card,
        record.eda_mean_us.toFixed(1),
        "µS",
        "EDA skin conductance",
        "Tracked",
        "./assets/figma/imgDotNormal.svg",
        series14.map((s) => s.record?.eda_mean_us ?? 2.3),
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
        series14.map((s) => s.record?.hrv_rmssd_ms ?? 50),
      );
    } else if (label === "Sleep" && cardSub.includes("efficiency")) {
      const eff = calcSleepEfficiency(record);
      const lvl = eff < 82 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        String(eff),
        "%",
        "Sleep efficiency",
        lvl,
        dotForLevel(lvl.toLowerCase()),
        series14.map((s) => (s.record ? calcSleepEfficiency(s.record) : 85)),
      );
    } else if (label === "Sleep" && cardSub.includes("wake")) {
      const w = calcWakeUps(record);
      const lvl = w > 2.2 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        w.toFixed(1),
        "/ night",
        "Wake-ups",
        lvl,
        dotForLevel(lvl.toLowerCase()),
        series14.map((s) => (s.record ? calcWakeUps(s.record) : 1.5)),
      );
    } else if (label === "Sleep") {
      const avg7 =
        series.slice(-7).reduce((acc, s) => acc + (s.record?.sleep_hours ?? record.sleep_hours), 0) /
        Math.max(1, Math.min(7, series.length));
      const lvl = engine.sleep_score < 45 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        avg7.toFixed(1),
        "h",
        `Avg sleep, last 7d (Today ${record.sleep_hours.toFixed(1)} h)`,
        lvl,
        dotForLevel(lvl.toLowerCase()),
        series14.map((s) => s.record?.sleep_hours ?? 6.5),
      );
    } else if (label === "Radiation" && (cardSub.includes("dose rate") || unitText.includes("µsv"))) {
      const rate = Math.round((record.radiation_msv * 1000) / 24);
      const rLvl = record.radiation_msv >= 1.5 ? "Act" : record.radiation_msv >= 0.8 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        String(rate),
        "µSv/h",
        "Current dose rate",
        rLvl,
        dotForLevel(rLvl.toLowerCase()),
        series14.map((s) => Math.round(((s.record?.radiation_msv ?? 0.5) * 1000) / 24)),
      );
    } else if (label === "Radiation") {
      const rLvl = record.radiation_msv >= 1.5 ? "Act" : record.radiation_msv >= 0.8 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        record.radiation_msv.toFixed(2),
        "mSv/day",
        "Daily dose (7-day avg)",
        rLvl,
        dotForLevel(rLvl.toLowerCase()),
        series14.map((s) => s.record?.radiation_msv ?? 0.5),
      );
    } else if (label === "Space weather") {
      const rLvl = record.radiation_msv >= 1.5 ? "Act" : record.radiation_msv >= 0.8 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        record.radiation_msv >= 1.5 ? "Storm" : record.radiation_msv >= 0.8 ? "Elevated" : "Quiet",
        "\u200b",
        "Solar particle event forecast",
        rLvl,
        dotForLevel(rLvl.toLowerCase()),
        series14.map((s) => s.record?.radiation_msv ?? 0.5),
      );
    } else if (label === "Air") {
      const co2 = calcCabinCo2(record, state.astronautId, state.missionDay);
      const lvl = co2 >= 3000 ? "Act" : co2 >= 2600 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        co2.toLocaleString("en-US"),
        "ppm",
        "Cabin CO₂ (24 h avg)",
        lvl,
        dotForLevel(lvl.toLowerCase()),
        series14.map((s) => (s.record ? calcCabinCo2(s.record, state.astronautId, s.engine.mission_day) : 2400)),
      );
    } else if (label === "Gravity") {
      hydrateMetricCard(
        card,
        "~10⁻⁶",
        "g",
        `Current gravity · Day ${state.missionDay}`,
        "Normal",
        "./assets/figma/imgDotNormal.svg",
        series14.map((s) => s.engine.mission_day),
      );
    } else if (label === "Bone") {
      const rate = calcBoneRate(record);
      const lvl = rate <= -1.2 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        rate.toFixed(1),
        "%/month",
        "Est. bone density change",
        lvl,
        dotForLevel(lvl.toLowerCase()),
        series14.map((s) => (s.record ? calcBoneRate(s.record) + 2 : 1)),
      );
    } else if (label === "Muscle" || label === "Exercise" || cardSub.includes("ared")) {
      const hrs = (record.exercise_min / 60).toFixed(1);
      const exLvl = record.resistance_min < 25 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        hrs,
        "h/day",
        `Exercise countermeasures (${Math.round(record.resistance_min)}m ARED)`,
        exLvl,
        dotForLevel(exLvl.toLowerCase()),
        series14.map((s) => s.record?.exercise_min ?? 60),
      );
    } else if (label === "Mood") {
      const lvl = record.mood_1to5 <= 2 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        record.mood_1to5.toFixed(1),
        "/ 5",
        "Mood today",
        lvl,
        dotForLevel(lvl.toLowerCase()),
        series14.map((s) => s.record?.mood_1to5 ?? 3.5),
      );
    } else if (label === "Isolation") {
      hydrateMetricCard(
        card,
        String(state.missionDay),
        "of 180",
        "Mission day",
        "Normal",
        "./assets/figma/imgDotNormal.svg",
        series14.map((s) => s.engine.mission_day),
      );
    } else if (label === "Metabolic") {
      const gl = calcGlucose(engine, state.astronautId, state.missionDay);
      const lvl = gl >= 110 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        String(gl),
        "mg/dL",
        "Avg glucose",
        lvl,
        dotForLevel(lvl.toLowerCase()),
        series14.map((s) => calcGlucose(s.engine, state.astronautId, s.engine.mission_day)),
      );
    } else if (label === "Body") {
      const kg = calcBodyMass(state.astronautId, state.missionDay);
      hydrateMetricCard(
        card,
        kg.toFixed(1),
        "kg",
        "Body mass",
        "Normal",
        "./assets/figma/imgDotNormal.svg",
        series14.map((s) => calcBodyMass(state.astronautId, s.engine.mission_day)),
      );
    } else if (label === "Diet") {
      const na = calcSodium(state.astronautId, state.missionDay);
      const lvl = na >= 3.3 ? "Watch" : "Normal";
      hydrateMetricCard(
        card,
        na.toFixed(1),
        "g/day",
        "Sodium",
        lvl,
        dotForLevel(lvl.toLowerCase()),
        series14.map((s) => calcSodium(state.astronautId, s.engine.mission_day)),
      );
    }
  });

  // Hydrate Progress cards dynamically on Health* subpages
  const last7 = series.slice(-7);
  artboard.querySelectorAll('[data-name="Progress card"]').forEach((card) => {
    const title = (card.querySelector("p")?.textContent ?? "").toLowerCase();
    if (title.includes("career dose")) {
      const pct = (cumDose / 600) * 100;
      hydrateProgressCard(card, cumDose.toFixed(1), "/ 600 mSv", pct, `${pct.toFixed(1)}% used`);
    } else if (title.includes("shielded")) {
      const hrs = record.radiation_msv >= 1.5 ? 6.5 : 0.5;
      hydrateProgressCard(card, hrs.toFixed(1), "/ 8 h", (hrs / 8) * 100, record.radiation_msv >= 1.5 ? "SPE shelter active" : "Routine check");
    } else if (title.includes("dosimeter")) {
      hydrateProgressCard(card, "7", "/ 7 days", 100, "Synced this week");
    } else if (title.includes("countermeasure exercise")) {
      const hrs = Number((record.exercise_min / 60).toFixed(1));
      hydrateProgressCard(card, hrs.toFixed(1), "/ 2.5 h", (hrs / 2.5) * 100, "Daily target");
    } else if (title.includes("fluid-shift")) {
      const sess = Math.min(5, Math.max(1, Math.round(last7.filter((s) => (s.record?.exercise_min ?? 0) >= 60).length * 0.75)));
      hydrateProgressCard(card, String(sess), "/ 5 sessions", (sess / 5) * 100, "This week");
    } else if (title.includes("sleep goal")) {
      const met = last7.filter((s) => (s.record?.sleep_hours ?? 0) >= 7).length;
      hydrateProgressCard(card, String(met), "/ 7 nights", (met / 7) * 100, `Met on ${met} of ${last7.length || 7} nights`);
    } else if (title.includes("sleep aid")) {
      const aid = last7.filter((s) => (s.record?.sleep_hours ?? 7) < 6 || (s.record?.sleep_quality_1to5 ?? 4) <= 2).length;
      hydrateProgressCard(card, String(aid), "/ 7 nights", (aid / 7) * 100, "This week");
    } else if (title.includes("mindful")) {
      const mins = last7.reduce((acc, s) => acc + ((s.record?.mood_1to5 ?? 3) >= 3 ? 10 : 5), 0);
      hydrateProgressCard(card, String(mins), "/ 70 min", (mins / 70) * 100, "This week");
    } else if (title.includes("calls home")) {
      const calls = Math.max(1, Math.min(3, Math.round(last7.filter((s) => (s.record?.mood_1to5 ?? 3) >= 3).length / 2)));
      hydrateProgressCard(card, String(calls), "/ 3", (calls / 3) * 100, "This week");
    } else if (title.includes("calories")) {
      const kcal = calcCalories(record, state.astronautId, state.missionDay);
      const pct = Math.round((kcal / 2800) * 100);
      hydrateProgressCard(card, kcal.toLocaleString("en-US"), "/ 2,800 kcal", pct, `${pct}% of daily target`);
    } else if (title.includes("protein")) {
      const prot = calcProtein(record, state.astronautId, state.missionDay);
      const pct = Math.round((prot / 110) * 100);
      hydrateProgressCard(card, String(prot), "/ 110 g", pct, `${pct}% of daily target`);
    } else if (title.includes("water")) {
      const w = calcWaterL(record, state.astronautId, state.missionDay);
      const pct = Math.round((w / 2.5) * 100);
      hydrateProgressCard(card, w.toFixed(1), "/ 2.5 L", pct, `${pct}% of daily target`);
    } else if (title.includes("vitamin d")) {
      const iu = calcVitD(state.astronautId, state.missionDay);
      const pct = Math.round((iu / 800) * 100);
      hydrateProgressCard(card, String(iu), "/ 800 IU", pct, `${pct}% of daily target`);
    }
  });

  // Update ALL Chart card plots & X-axes on both Health* subpages and all 27 Detail* screens
  artboard.querySelectorAll('[data-name="Chart card"]').forEach((chartCard) => {
    const chartTitle = (chartCard.querySelector('[data-name="Header"] [data-name="Text"] p')?.textContent ?? "").toLowerCase();
    const subLabel = `Day ${winStart}–${state.missionDay} · simulated · dashed line = your baseline`;

    if (detailSpec) {
      hydrateChartCard(
        chartCard,
        subLabel,
        detailSpec.statusLabel,
        detailSpec.statusLevel,
        detailSpec.series,
        winStart,
        state.missionDay,
      );
      return;
    }

    if (chartTitle.includes("resting heart rate")) {
      const isGlitch = engine.data_quality.status === "check_device" && record.rhr_bpm > 150;
      const lvl = isGlitch ? "watch" : Math.abs(engine.z.rhr_bpm ?? 0) >= 2 ? "watch" : "normal";
      hydrateChartCard(
        chartCard,
        subLabel,
        isGlitch ? "Check device" : formatRiskLevel(lvl),
        lvl,
        series.map((s) => Math.min(115, s.record?.rhr_bpm ?? 60)),
        winStart,
        state.missionDay,
      );
    } else if (chartTitle.includes("hrv") || chartTitle.includes("stress trend")) {
      const lvl = engine.stress_score >= 70 ? "act" : engine.stress_score >= 45 ? "watch" : "normal";
      hydrateChartCard(
        chartCard,
        subLabel,
        formatRiskLevel(lvl),
        lvl,
        series.map((s) => s.record?.hrv_rmssd_ms ?? 50),
        winStart,
        state.missionDay,
      );
    } else if (chartTitle.includes("blood pressure")) {
      const lvl = record.sbp_mmhg >= 135 || record.dbp_mmhg >= 88 ? "watch" : "normal";
      hydrateChartCard(
        chartCard,
        subLabel,
        formatRiskLevel(lvl),
        lvl,
        series.map((s) => s.record?.sbp_mmhg ?? 112),
        winStart,
        state.missionDay,
      );
    } else if (chartTitle.includes("sleep duration")) {
      const lvl = engine.sleep_score < 45 ? "watch" : "normal";
      hydrateChartCard(
        chartCard,
        subLabel,
        formatRiskLevel(lvl),
        lvl,
        series.map((s) => s.record?.sleep_hours ?? 6.5),
        winStart,
        state.missionDay,
      );
    } else if (chartTitle.includes("radiation dose")) {
      const lvl = record.radiation_msv >= 1.5 ? "act" : record.radiation_msv >= 0.8 ? "watch" : "normal";
      hydrateChartCard(
        chartCard,
        subLabel,
        formatRiskLevel(lvl),
        lvl,
        series.map((s) => s.record?.radiation_msv ?? 0.5),
        winStart,
        state.missionDay,
      );
    } else if (chartTitle.includes("exercise load")) {
      const lvl = record.resistance_min < 25 ? "watch" : "normal";
      hydrateChartCard(
        chartCard,
        subLabel,
        formatRiskLevel(lvl),
        lvl,
        series.map((s) => s.record?.resistance_min ?? 50),
        winStart,
        state.missionDay,
      );
    } else if (chartTitle.includes("calories")) {
      hydrateChartCard(
        chartCard,
        subLabel,
        "Normal",
        "normal",
        series.map((s) => (s.record ? calcCalories(s.record, state.astronautId, s.engine.mission_day) : 2450)),
        winStart,
        state.missionDay,
      );
    } else {
      updateChartXAxis(chartCard, winStart, state.missionDay);
    }
  });

  if (screenId === "HealthMindfulness") {
    renderMindfulnessCameraCard(artboard, state);
  }
}

/** Appends a dedicated on-device camera pulse & baseline check card inside Health / Mindfulness. */
function renderMindfulnessCameraCard(artboard: HTMLElement, state: AppContextState): void {
  const content = artboard.querySelector<HTMLElement>('[data-name="Content"]');
  if (!content) return;
  content.querySelector("[data-boops-mind-camera]")?.remove();

  const camEntries = loadManualLogs().filter(
    (e) => e.screen.includes("Camera") && e.astronaut_id === state.astronautId,
  );
  const latest = camEntries[0];
  const statusText = latest
    ? `Last check: Day ${latest.mission_day} · ${latest.fields["Resting HR"] ?? "Saved"} (${latest.fields["Source"] ?? "camera"})`
    : "No camera check saved yet · Ready for 30s baseline";

  const liveBtn = h(
    "button",
    {
      type: "button",
      className: "boops-btn boops-btn-dark",
      "data-boops-mind-camera-live": "1",
    },
    h("img", {
      src: "./assets/figma/imgIconCamera.svg",
      alt: "",
      width: 15,
      height: 15,
      className: "boops-btn-icon boops-btn-icon-invert",
    }),
    h("span", null, "Open Camera Check"),
  );
  liveBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    state.openCameraCheck(false);
  });

  const simBtn = h(
    "button",
    {
      type: "button",
      className: "boops-btn",
      "data-boops-mind-camera-sim": "1",
    },
    "Simulated Signal Demo",
  );
  simBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    state.openCameraCheck(true);
  });

  const card = h(
    "section",
    {
      className: "boops-mind-camera-card",
      "data-boops-mind-camera": "1",
    },
    h(
      "div",
      { className: "boops-mind-camera-left" },
      h(
        "div",
        { className: "boops-mind-camera-icon" },
        h("img", {
          src: "./assets/figma/imgIconCamera.svg",
          alt: "Camera rPPG check",
          width: 22,
          height: 22,
          className: "boops-mind-camera-svg",
        }),
      ),
      h(
        "div",
        { className: "boops-mind-camera-copy" },
        h(
          "div",
          { className: "boops-mind-camera-title-row" },
          h("span", { className: "boops-mind-camera-title" }, "Camera Pulse & Facial Baseline Check"),
          h("span", { className: "boops-mind-camera-pill" }, "Offline · On-device"),
          h("span", { className: "boops-mind-camera-status" }, statusText),
        ),
        h(
          "p",
          { className: "boops-mind-camera-desc" },
          "30-second POS camera heart-rate check with optional Day 1–14 facial change comparison (HRV saved with low confidence; no video stored and no emotion labels).",
        ),
      ),
    ),
    h("div", { className: "boops-mind-camera-actions" }, liveBtn, simBtn),
  );

  content.append(card);
}

/** Builds a Figma-matching Log entry DOM node with working edit callback for manual entries. */
function makeDynamicLogEntryNode(
  entry: ManualLogEntry,
  onEdit?: (target: ManualLogEntry) => void,
): HTMLElement {
  const parts = Object.entries(entry.fields)
    .filter(([, val]) => String(val).trim().length > 0)
    .map(([key, val]) => `${key}: ${val}`);
  const headline = parts.slice(0, 2).join(" · ") || `${entry.screen} entry`;
  const detail = parts.slice(2).join(" · ") || `Logged for ${entry.astronaut_id} Day ${entry.mission_day}`;
  const isCamera = entry.screen.includes("Camera");

  const editBtn = onEdit
    ? h(
        "button",
        {
          type: "button",
          className: "relative shrink-0 size-[18px] cursor-pointer",
          style: "border:none;background:transparent;padding:0;",
          title: "Edit this log entry",
          "data-name": "icon/edit",
          onClick: (ev: MouseEvent) => {
            ev.stopPropagation();
            onEdit(entry);
          },
        },
        h("img", {
          alt: "Edit",
          className: "absolute block inset-0 max-w-none size-full",
          src: "./assets/figma/imgIconEdit.svg",
        }),
      )
    : null;

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
        `Day ${entry.mission_day}`,
      ),
      h(
        "p",
        {
          className:
            "font-['Inter:Regular'] font-normal relative shrink-0 text-[12px] text-[color:var(--color-text-muted,#6b7280)]",
        },
        entry.saved_at || "Offline",
      ),
    ),
    h(
      "div",
      {
        className:
          "[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[var(--spacing-xs,4px)] items-start leading-[1.4] min-w-px not-italic overflow-clip relative",
        "data-name": "Entry",
      },
      h(
        "p",
        {
          className:
            "font-['Inter:Medium'] font-medium relative shrink-0 text-[14px] text-[color:var(--color-text-secondary,#374151)]",
        },
        headline,
      ),
      h(
        "p",
        {
          className:
            "font-['Inter:Regular'] font-normal relative shrink-0 text-[12px] text-[color:var(--color-text-muted,#6b7280)]",
        },
        detail,
      ),
    ),
    h(
      "div",
      {
        className:
          "bg-[var(--color-bg-surface,#f4f5f7)] content-stretch flex items-start overflow-clip px-[var(--spacing-sm,8px)] py-[var(--spacing-xs,4px)] relative rounded-[var(--radius-full,999px)] shrink-0",
        "data-name": "Source",
      },
      h(
        "p",
        {
          className:
            "[word-break:break-word] font-['Inter:Medium'] font-medium leading-[1.3] not-italic relative shrink-0 text-[11px] text-[color:var(--color-text-secondary,#374151)] whitespace-nowrap",
        },
        isCamera ? "Camera rPPG" : "Manual",
      ),
    ),
    editBtn ?? "",
  );
}

/** Wires Form header day, "How to measure" links, offline persistence, See all, and History edit controls. */
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

  // Replace hardcoded Figma "Day 43" in Form header with active missionDay + crew
  const profile = getCrewProfile(state.astronautId);
  const formHeader = artboard.querySelector('[data-name="Form header"]');
  if (formHeader) {
    const headerPs = formHeader.querySelectorAll("p");
    for (const p of headerPs) {
      if ((p.textContent ?? "").includes("Day 43")) {
        p.textContent = `Day ${state.missionDay} · ${profile.id} ${profile.name} · Offline entry`;
      }
    }
  }

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

  // Add aligned header action pills without overlapping Content below Page header
  if (!artboard.querySelector("[data-boops-log-actions]")) {
    const defaultGuide =
      screenId === "LogEnvironmentRadiation"
        ? "personal_dosimeter"
        : screenId === "LogEnvironmentGravity"
          ? "exercise_device_log"
          : screenId === "LogSleep" || screenId === "LogMindfulness"
            ? "wearable_hrv_fit"
            : "blood_pressure_cuff";

    const actionsBar = h("div", {
      className: "boops-artboard-header-actions",
      "data-boops-log-actions": "1",
    });

    if (screenId === "LogMindfulness") {
      const camBtn = h(
        "button",
        {
          type: "button",
          "data-boops-camera-btn": "1",
          className: "boops-btn boops-btn-dark",
        },
        h("img", {
          src: "./assets/figma/imgIconCamera.svg",
          alt: "",
          width: 15,
          height: 15,
          className: "boops-btn-icon boops-btn-icon-invert",
        }),
        h("span", null, "Camera Pulse Check"),
      );
      camBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.openCameraCheck(false);
      });
      actionsBar.append(camBtn);
    }

    const guideBtn = h(
      "button",
      {
        type: "button",
        "data-boops-guide-btn": "1",
        className: "boops-inline-btn",
      },
      "ⓘ Open Instrument Guide",
    );
    guideBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      state.openToolGuide(defaultGuide);
    });
    actionsBar.append(guideBtn);
    artboard.append(actionsBar);
  }

  let editingEntry: ManualLogEntry | null = null;
  let showAllHistory = false;

  const populateFormFromEntry = (entry: ManualLogEntry) => {
    editingEntry = entry;
    const inputs = Array.from(artboard.querySelectorAll<HTMLInputElement>(".figma-field-input"));
    inputs.forEach((inp, idx) => {
      const key = inp.dataset.fieldLabel ?? inp.placeholder ?? `field_${idx}`;
      if (entry.fields[key] != null) {
        inp.value = entry.fields[key];
      }
    });

    const tags = (entry.fields["Tags"] ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    artboard.querySelectorAll<HTMLElement>('[data-name="Chip"]').forEach((chip) => {
      const label = (chip.textContent ?? "").trim().toLowerCase();
      const shouldSelect = tags.includes(label);
      const p = chip.querySelector("p");
      if (shouldSelect) {
        chip.className =
          "bg-[var(--color-bg-strong,#111827)] content-stretch flex items-center px-[var(--spacing-md,12px)] py-[6px] relative rounded-[var(--radius-full,999px)] shrink-0";
        if (p) {
          p.className =
            "[word-break:break-word] font-['Inter:Regular'] font-normal leading-[1.4] not-italic relative shrink-0 text-[14px] text-[color:var(--color-text-inverse,white)] whitespace-nowrap";
        }
      } else {
        chip.className =
          "bg-[var(--color-bg-card,white)] border border-[var(--color-border-default,#e5e7eb)] border-solid content-stretch flex items-center px-[var(--spacing-md,12px)] py-[6px] relative rounded-[var(--radius-full,999px)] shrink-0";
        if (p) {
          p.className =
            "[word-break:break-word] font-['Inter:Regular'] font-normal leading-[1.4] not-italic relative shrink-0 text-[14px] text-[color:var(--color-text-secondary,#374151)] whitespace-nowrap";
        }
      }
    });

    const ratingMatch = /([1-5])\s*\/\s*5/.exec(entry.fields["Rating"] ?? "");
    if (ratingMatch) {
      const targetNum = ratingMatch[1];
      artboard.querySelectorAll<HTMLElement>('[data-name="Options"] > div').forEach((opt) => {
        const isMatch = (opt.textContent ?? "").trim() === targetNum;
        opt.className = isMatch
          ? "bg-[var(--color-bg-strong,#111827)] content-stretch flex items-center justify-center overflow-clip relative rounded-[var(--radius-full,999px)] shrink-0 size-[40px]"
          : "bg-[var(--color-bg-card,white)] border border-[var(--color-border-default,#e5e7eb)] border-solid content-stretch flex items-center justify-center overflow-clip relative rounded-[var(--radius-full,999px)] shrink-0 size-[40px]";
        const op = opt.querySelector("p");
        if (op) {
          op.className = isMatch
            ? "[word-break:break-word] font-['Inter:Medium'] font-medium leading-[1.4] not-italic relative shrink-0 text-[14px] text-[color:var(--color-text-inverse,white)] whitespace-nowrap"
            : "[word-break:break-word] font-['Inter:Medium'] font-medium leading-[1.4] not-italic relative shrink-0 text-[14px] text-[color:var(--color-text-secondary,#374151)] whitespace-nowrap";
        }
      });
    }

    const saveP = artboard.querySelector<HTMLElement>('[data-boops-save-btn] p');
    if (saveP) saveP.textContent = "Update entry";
    state.showToast(`Editing Day ${entry.mission_day} entry — save to update`);
  };

  const renderHistoryList = () => {
    const historyWrap = artboard.querySelector<HTMLElement>('[data-name="History"]');
    if (!historyWrap) return;
    const sectionHeader = historyWrap.querySelector<HTMLElement>('[data-name="Section header"]');
    if (!sectionHeader) return;

    const crewLogs = loadManualLogs().filter((l) => l.astronaut_id === state.astronautId);
    const matching = crewLogs.filter((l) => l.screen === screenId);
    const ordered = showAllHistory
      ? crewLogs
      : matching.length > 0
        ? matching
        : crewLogs;

    if (ordered.length > 0) {
      const staticEntries = Array.from(historyWrap.querySelectorAll('[data-name="Log entry"]'));
      staticEntries.forEach((node) => node.remove());

      const limit = showAllHistory ? ordered.length : 4;
      const frag = document.createDocumentFragment();
      for (const entry of ordered.slice(0, limit)) {
        const isEditable = !entry.screen.includes("Camera");
        frag.appendChild(makeDynamicLogEntryNode(entry, isEditable ? populateFormFromEntry : undefined));
      }
      sectionHeader.after(frag);
    }

    const subP = sectionHeader.querySelector('[data-name="Text"] p:nth-of-type(2)');
    if (subP) {
      subP.textContent = showAllHistory
        ? `Showing all ${ordered.length} offline entries · newest first`
        : "Last 7 days · newest first (Simulated + manual)";
    }

    const rawSeeAll = sectionHeader.querySelector<HTMLElement>('[data-name="Action"]');
    if (rawSeeAll) {
      const seeAllBtn = rawSeeAll.cloneNode(true) as HTMLElement;
      const p = seeAllBtn.querySelector("p");
      if (p) p.textContent = showAllHistory ? "Show recent" : "See all";
      seeAllBtn.style.cursor = "pointer";
      seeAllBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        showAllHistory = !showAllHistory;
        renderHistoryList();
        if (ordered.length === 0) {
          state.showToast("No saved manual entries yet — fill form and tap Save entry");
        }
      });
      rawSeeAll.replaceWith(seeAllBtn);
    }
  };

  renderHistoryList();

  // Replace Save entry button to handle localStorage persistence, chips, ratings & edits cleanly
  artboard.querySelectorAll<HTMLElement>('[data-name="Button"], [data-name="Primary button"]').forEach((rawBtn) => {
    const label = (rawBtn.textContent ?? "").trim().toLowerCase();
    if (label === "save entry" || label === "save log" || label === "save") {
      const saveBtn = rawBtn.cloneNode(true) as HTMLElement;
      saveBtn.setAttribute("data-boops-save-btn", "1");
      saveBtn.style.cursor = "pointer";
      saveBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const fields: Record<string, string> = {};
        const inputs = Array.from(
          artboard.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
            ".figma-field-input, input, select, textarea",
          ),
        );
        inputs.forEach((inp, idx) => {
          const val = inp.value.trim();
          if (!val) return;
          const labelKey =
            (inp instanceof HTMLInputElement ? inp.dataset.fieldLabel : "") ||
            inp.name ||
            (inp instanceof HTMLSelectElement ? "" : inp.placeholder) ||
            `Field ${idx + 1}`;
          fields[labelKey] = val;
        });

        const activeChips = Array.from(artboard.querySelectorAll<HTMLElement>('[data-name="Chip"]'))
          .filter((c) => c.className.includes("var(--color-bg-strong"))
          .map((c) => (c.textContent ?? "").trim())
          .filter(Boolean);
        if (activeChips.length > 0) {
          fields["Tags"] = activeChips.join(", ");
        }

        const activeRating = Array.from(artboard.querySelectorAll<HTMLElement>('[data-name="Options"] > div')).find(
          (o) => o.className.includes("var(--color-bg-strong"),
        );
        if (activeRating) {
          fields["Rating"] = `${(activeRating.textContent ?? "").trim()}/5`;
        }

        if (Object.keys(fields).length === 0) {
          fields["Status"] = `Quick check-in (${screenId})`;
        }

        const nowUtc = new Date().toISOString().slice(11, 19) + " UTC";
        if (editingEntry) {
          updateManualLog({
            ...editingEntry,
            fields,
            saved_at: `${nowUtc} (edited)`,
          });
          editingEntry = null;
          state.showToast(`Updated offline log for ${state.astronautId} Day ${state.missionDay}`);
        } else {
          appendManualLog({
            astronaut_id: state.astronautId,
            mission_day: state.missionDay,
            screen: screenId,
            fields,
            saved_at: nowUtc,
          });
          state.showToast(`Offline log saved for ${state.astronautId} Day ${state.missionDay}`);
        }

        inputs.forEach((inp) => {
          if (inp instanceof HTMLInputElement || inp instanceof HTMLTextAreaElement) inp.value = "";
        });
        state.reRenderScreen();
      });
      rawBtn.replaceWith(saveBtn);
    }
  });
}

/** Hydrates SettingsProfile with live baseline, persisted alert/display toggles, and device guides. */
function hydrateSettingsScreen(
  artboard: HTMLElement,
  engine: EngineDayOutput | null,
  state: AppContextState,
): void {
  const profile = getCrewProfile(state.astronautId);
  let settings = loadUserSettings();
  const contentLeft = artboard.querySelector('[data-name="Left"]');

  if (contentLeft) {
    const profBox = contentLeft.querySelector('[data-name="Profile"] [data-name="Info"]');
    const savedNote = settings.profile_notes[profile.id];
    if (profBox) {
      setParagraphs(profBox, [
        [0, `${profile.id} · ${profile.name}`],
        [1, savedNote ? `${profile.role} · ${savedNote}` : profile.role],
        [2, `Mission LEO-180 · 3-person crew · Day ${state.missionDay} · Simulated`],
      ]);
    }
  }

  const updateRowValue = (titleText: string, valueText: string) => {
    artboard.querySelectorAll('[data-name="Settings row"]').forEach((row) => {
      const t = row.querySelector('[data-name="Text"] p')?.textContent?.trim();
      if (t !== titleText) return;
      const ps = Array.from(row.querySelectorAll("p"));
      const valP = ps[ps.length - 1];
      if (valP) valP.textContent = valueText;
    });
  };

  artboard.querySelectorAll<HTMLElement>('[data-name="Settings row"]').forEach((row) => {
    const title = row.querySelector('[data-name="Text"] p')?.textContent?.trim() ?? "";
    const valPs = row.querySelectorAll("p");
    const valP = valPs[valPs.length - 1];

    if (title === "Status" && valP && engine) {
      const rhrBase = engine.baseline.rhr_bpm;
      const hrvBase = engine.baseline.hrv_rmssd_ms;
      valP.textContent =
        state.missionDay <= 14
          ? `Learning: ${state.missionDay} of 14 days`
          : `Active · RHR ${rhrBase?.mean.toFixed(0) ?? 60}±${rhrBase?.sd.toFixed(1) ?? 2} bpm, HRV ${hrvBase?.mean.toFixed(0) ?? 50} ms`;
    } else if (title === "Baseline set from" && valP) {
      valP.textContent = `In-flight days 1–${settings.baseline_calibrated_day}`;
    } else if (title === "Share daily summary with mission control") {
      const rawTgl = row.querySelector<HTMLElement>('[data-name="Toggle"]');
      if (rawTgl) {
        const toggle = rawTgl.cloneNode(true) as HTMLElement;
        toggle.querySelector("img")?.setAttribute(
          "src",
          state.sharing.daily_summary ? "./assets/figma/imgToggleOn.svg" : "./assets/figma/imgToggleOff.svg",
        );
        toggle.style.cursor = "pointer";
        toggle.addEventListener("click", (ev) => {
          ev.stopPropagation();
          state.onToggleSharing("daily_summary", !state.sharing.daily_summary);
        });
        rawTgl.replaceWith(toggle);
      }
    } else if (title === "Share raw data") {
      const rawTgl = row.querySelector<HTMLElement>('[data-name="Toggle"]');
      if (rawTgl) {
        const toggle = rawTgl.cloneNode(true) as HTMLElement;
        toggle.querySelector("img")?.setAttribute(
          "src",
          state.sharing.raw_data ? "./assets/figma/imgToggleOn.svg" : "./assets/figma/imgToggleOff.svg",
        );
        toggle.style.cursor = "pointer";
        toggle.addEventListener("click", (ev) => {
          ev.stopPropagation();
          state.onToggleSharing("raw_data", !state.sharing.raw_data);
        });
        rawTgl.replaceWith(toggle);
      }
    } else if (title === "Share emergency events" && valP) {
      valP.textContent = "Always on (locked for crew safety)";
    } else if (title === "Watch alerts") {
      const rawTgl = row.querySelector<HTMLElement>('[data-name="Toggle"]');
      if (rawTgl) {
        const toggle = rawTgl.cloneNode(true) as HTMLElement;
        toggle.querySelector("img")?.setAttribute(
          "src",
          settings.watch_alerts ? "./assets/figma/imgToggleOn.svg" : "./assets/figma/imgToggleOff.svg",
        );
        toggle.style.cursor = "pointer";
        toggle.addEventListener("click", (ev) => {
          ev.stopPropagation();
          settings = saveUserSettings({ ...settings, watch_alerts: !settings.watch_alerts });
          toggle.querySelector("img")?.setAttribute(
            "src",
            settings.watch_alerts ? "./assets/figma/imgToggleOn.svg" : "./assets/figma/imgToggleOff.svg",
          );
          state.showToast(settings.watch_alerts ? "Watch alerts enabled" : "Watch alerts muted");
        });
        rawTgl.replaceWith(toggle);
      }
    } else if (title === "Act now alerts") {
      const rawTgl = row.querySelector<HTMLElement>('[data-name="Toggle"]');
      if (rawTgl) {
        const toggle = rawTgl.cloneNode(true) as HTMLElement;
        toggle.querySelector("img")?.setAttribute(
          "src",
          settings.act_now_alerts ? "./assets/figma/imgToggleOn.svg" : "./assets/figma/imgToggleOff.svg",
        );
        toggle.style.cursor = "pointer";
        toggle.addEventListener("click", (ev) => {
          ev.stopPropagation();
          settings = saveUserSettings({ ...settings, act_now_alerts: !settings.act_now_alerts });
          toggle.querySelector("img")?.setAttribute(
            "src",
            settings.act_now_alerts ? "./assets/figma/imgToggleOn.svg" : "./assets/figma/imgToggleOff.svg",
          );
          state.showToast(settings.act_now_alerts ? "Act-now alerts enabled (overrides quiet hours)" : "Act-now chime muted");
        });
        rawTgl.replaceWith(toggle);
      }
    } else if (title === "Quiet hours") {
      if (valP) valP.textContent = settings.quiet_hours;
      const cloneRow = row.cloneNode(true) as HTMLElement;
      cloneRow.style.cursor = "pointer";
      cloneRow.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const opts = ["22:00–06:00", "23:00–07:00", "Off"];
        const nextIdx = (opts.indexOf(settings.quiet_hours) + 1) % opts.length;
        settings = saveUserSettings({ ...settings, quiet_hours: opts[nextIdx] });
        const ps = cloneRow.querySelectorAll("p");
        if (ps[ps.length - 1]) ps[ps.length - 1].textContent = settings.quiet_hours;
        state.showToast(`Quiet hours: ${settings.quiet_hours}`);
      });
      row.replaceWith(cloneRow);
    } else if (title === "Wearable (HRV, sleep)") {
      const cloneRow = row.cloneNode(true) as HTMLElement;
      cloneRow.style.cursor = "pointer";
      cloneRow.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.openToolGuide("wearable_hrv_fit");
      });
      row.replaceWith(cloneRow);
    } else if (title === "Personal dosimeter") {
      const cloneRow = row.cloneNode(true) as HTMLElement;
      cloneRow.style.cursor = "pointer";
      cloneRow.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.openToolGuide("personal_dosimeter");
      });
      row.replaceWith(cloneRow);
    } else if (title === "Blood pressure cuff") {
      const cloneRow = row.cloneNode(true) as HTMLElement;
      cloneRow.style.cursor = "pointer";
      cloneRow.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.openToolGuide("blood_pressure_cuff");
      });
      row.replaceWith(cloneRow);
    } else if (title === "Units") {
      const fmt = (u: "metric" | "imperial") =>
        u === "imperial" ? "Imperial (rem, °F, lb)" : "Metric (mSv, °C, kg)";
      if (valP) valP.textContent = fmt(settings.units);
      const cloneRow = row.cloneNode(true) as HTMLElement;
      cloneRow.style.cursor = "pointer";
      cloneRow.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const nextUnits = settings.units === "metric" ? "imperial" : "metric";
        settings = saveUserSettings({ ...settings, units: nextUnits });
        const ps = cloneRow.querySelectorAll("p");
        if (ps[ps.length - 1]) ps[ps.length - 1].textContent = fmt(nextUnits);
        state.showToast(`Display units: ${fmt(nextUnits)}`);
      });
      row.replaceWith(cloneRow);
    } else if (title === "Language") {
      if (valP) valP.textContent = settings.language;
      const cloneRow = row.cloneNode(true) as HTMLElement;
      cloneRow.style.cursor = "pointer";
      cloneRow.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const nextLang = settings.language === "English" ? "English (Flight Deck)" : "English";
        settings = saveUserSettings({ ...settings, language: nextLang });
        const ps = cloneRow.querySelectorAll("p");
        if (ps[ps.length - 1]) ps[ps.length - 1].textContent = nextLang;
        state.showToast(`Offline pack language: ${nextLang}`);
      });
      row.replaceWith(cloneRow);
    }
  });

  // Wire "Edit profile" & "Recalibrate baseline" buttons
  artboard.querySelectorAll<HTMLElement>('[data-name="Button"]').forEach((rawBtn) => {
    const label = (rawBtn.textContent ?? "").trim();
    if (label === "Edit profile") {
      const editBtn = rawBtn.cloneNode(true) as HTMLElement;
      editBtn.style.cursor = "pointer";
      editBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const existingPanel = artboard.querySelector("[data-boops-profile-editor]");
        if (existingPanel) {
          existingPanel.remove();
          return;
        }
        const profileCard = editBtn.closest('[data-name="Profile"]');
        const noteInput = h("input", {
          type: "text",
          className: "boops-inline-input",
          value: settings.profile_notes[profile.id] ?? "",
          placeholder: "Optional crew note (e.g. EVA specialist · allergy none)",
        }) as HTMLInputElement;
        const editor = h(
          "div",
          { className: "boops-inline-panel", "data-boops-profile-editor": "1" },
          h("strong", { style: "font-size:13px;color:#111827;" }, `Crew note for ${profile.id} · ${profile.name}`),
          noteInput,
          h(
            "div",
            { className: "boops-inline-actions" },
            h(
              "button",
              {
                type: "button",
                className: "boops-inline-btn",
                onClick: (e: MouseEvent) => {
                  e.stopPropagation();
                  editor.remove();
                },
              },
              "Cancel",
            ),
            h(
              "button",
              {
                type: "button",
                className: "boops-inline-btn boops-inline-btn-dark",
                onClick: (e: MouseEvent) => {
                  e.stopPropagation();
                  settings = saveUserSettings({
                    ...settings,
                    profile_notes: { ...settings.profile_notes, [profile.id]: noteInput.value.trim() },
                  });
                  editor.remove();
                  state.reRenderScreen();
                  state.showToast(`Updated profile note for ${profile.id}`);
                },
              },
              "Save profile",
            ),
          ),
        );
        profileCard?.after(editor);
      });
      rawBtn.replaceWith(editBtn);
    } else if (label === "Recalibrate baseline") {
      const recalBtn = rawBtn.cloneNode(true) as HTMLElement;
      recalBtn.style.cursor = "pointer";
      recalBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const targetDay = Math.max(14, state.missionDay);
        settings = saveUserSettings({ ...settings, baseline_calibrated_day: targetDay });
        updateRowValue("Baseline set from", `In-flight days 1–${targetDay}`);
        const rhrBase = engine?.baseline.rhr_bpm;
        const hrvBase = engine?.baseline.hrv_rmssd_ms;
        state.showToast(
          `Personal baseline checked through Day ${targetDay} (RHR ${rhrBase?.mean.toFixed(0) ?? 60} bpm, HRV ${hrvBase?.mean.toFixed(0) ?? 50} ms)`,
        );
      });
      rawBtn.replaceWith(recalBtn);
    }
  });
}

/** Renders high-contrast red/white Emergency screens with real crew profiles and clean non-overlapping 2-column layout. */
function hydrateEmergencyScreens(
  artboard: HTMLElement,
  screenId: ScreenId,
  bundle: BoopsBundle,
  record: DailyRecordRow | null,
  state: AppContextState,
): void {
  artboard.classList.add("boops-emergency-surface");

  const patient = getCrewProfile(state.emergencyPatientId);
  const medicalOfficerId = "A3";
  const nextLeader =
    state.emergencyPatientId === medicalOfficerId
      ? getCrewProfile("A1")
      : getCrewProfile(medicalOfficerId);

  const patientRoleNote =
    state.emergencyPatientId === medicalOfficerId
      ? `Medical officer (${patient.name}) is patient → Next crew leads: ${nextLeader.name} (${nextLeader.role})`
      : `Responder lead: ${nextLeader.name} (Medical Officer) · Patient: ${patient.name} (${patient.role})`;

  const header = artboard.querySelector<HTMLElement>('[data-name="Page header"]');

  // EmergencyHub: replace static Figma dummy names with real CREW_PROFILES + bind Lead note + protocol tiles
  if (screenId === "EmergencyHub") {
    const crewRow = artboard.querySelector<HTMLElement>('[data-name="Crew"]');
    if (crewRow) {
      const crewCards = CREW_PROFILES.map((crew) => {
        const isSelected = crew.id === state.emergencyPatientId;
        const card = h(
          "button",
          {
            type: "button",
            "data-name": "Crew member",
            className: isSelected
              ? "bg-[var(--color-bg-active,#c6f432)] border-2 border-[var(--color-accent,#c6f432)] border-solid content-stretch flex flex-col gap-[var(--spacing-xs,4px)] items-center p-[var(--spacing-md,12px)] relative rounded-[var(--radius-lg,24px)] shrink-0 w-[160px] cursor-pointer"
              : "bg-[var(--color-bg-card,white)] border border-[var(--color-border-default,#e5e7eb)] border-solid content-stretch flex flex-col gap-[var(--spacing-xs,4px)] items-center p-[var(--spacing-md,12px)] relative rounded-[var(--radius-lg,24px)] shrink-0 w-[160px] cursor-pointer",
            onClick: (ev: MouseEvent) => {
              ev.stopPropagation();
              state.onChangeEmergencyPatient(crew.id);
            },
          },
          h(
            "div",
            { className: "relative shrink-0 size-[56px]", "data-name": "Avatar" },
            h("img", {
              alt: crew.name,
              src: "./assets/figma/imgAvatarCrew.svg",
              style: "width:56px;height:56px;border-radius:999px;display:block;",
            }),
            h(
              "span",
              {
                "aria-hidden": "true",
                style:
                  "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:#111827;pointer-events:none;",
              },
              crew.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase() ?? "")
                .join(""),
            ),
          ),
          h(
            "p",
            {
              className:
                "[word-break:break-word] font-['Inter:Medium'] font-medium leading-[1.4] not-italic relative shrink-0 text-[14px] text-[color:var(--color-text-primary,#111827)] whitespace-nowrap",
            },
            `${crew.id} · ${crew.name}`,
          ),
          h(
            "p",
            {
              className:
                "[word-break:break-word] font-['Inter:Regular'] font-normal leading-[1.4] not-italic relative shrink-0 text-[12px] text-[color:var(--color-text-muted,#6b7280)] whitespace-nowrap",
            },
            crew.id === "A3" ? `${crew.role} (Med)` : crew.role,
          ),
        );
        return card;
      });
      crewRow.replaceChildren(...crewCards);
    }

    const leadNoteP = artboard.querySelector('[data-name="Lead note"] p');
    if (leadNoteP) {
      leadNoteP.textContent = patientRoleNote;
    }

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
      if (el.parentElement) {
        el.parentElement.style.alignItems = "stretch";
        el.parentElement.style.overflow = "visible";
      }
      el.style.cursor = "pointer";
      el.style.border = "2px solid #dc2626";
      el.style.backgroundColor = "#ffffff";
      el.style.minWidth = "0";
      el.style.boxSizing = "border-box";
      if (proto) {
        const ps = el.querySelectorAll("p");
        if (ps[0]) {
          ps[0].classList.remove("whitespace-nowrap");
          ps[0].textContent = proto.title;
          (ps[0] as HTMLElement).style.color = "#991b1b";
          (ps[0] as HTMLElement).style.whiteSpace = "normal";
          (ps[0] as HTMLElement).style.width = "100%";
        }
        if (ps[1]) {
          ps[1].classList.remove("whitespace-nowrap");
          ps[1].textContent = `${proto.severity.toUpperCase()} · ${proto.first_screen_message}`;
          (ps[1] as HTMLElement).style.color = "#374151";
          (ps[1] as HTMLElement).style.whiteSpace = "normal";
          (ps[1] as HTMLElement).style.width = "100%";
        }
      }
      const clone = el.cloneNode(true) as HTMLElement;
      clone.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.openEmergencyProtocol(pid);
      });
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

  // Replace Content body inside [data-name="Content"] with clean explicit CSS layout (zero overlap)
  const content = artboard.querySelector<HTMLElement>('[data-name="Content"]');
  if (content) {
    const timestamps = loadChecklistTimestamps(protocol.id);
    const cumDose = getCumulativeRadiation(bundle, state.emergencyPatientId, state.missionDay);
    const patientRecord = getDailyRecord(bundle, state.emergencyPatientId, state.missionDay) ?? record;

    const crewBar = h(
      "div",
      { className: "boops-em-crew-bar", "data-boops-crew-role": "1" },
      h(
        "div",
        { className: "boops-em-crew-pills" },
        h("span", { className: "boops-em-crew-meta" }, "Patient:"),
        ...CREW_PROFILES.map((crew) => {
          const active = crew.id === state.emergencyPatientId;
          return h(
            "button",
            {
              type: "button",
              className: "boops-em-crew-pill",
              "data-active": active ? "true" : "false",
              onClick: (ev: MouseEvent) => {
                ev.stopPropagation();
                state.onChangeEmergencyPatient(crew.id);
              },
            },
            `${crew.id} ${crew.name.split(" ")[0]}`,
          );
        }),
      ),
      h("span", { className: "boops-em-crew-meta" }, patientRoleNote),
    );

    const heroCard = h(
      "div",
      { className: "boops-em-hero" },
      h(
        "div",
        { className: "boops-dyn-step-body" },
        h("p", { className: "boops-em-hero-kicker" }, `IMMEDIATE ACTION · ${protocol.severity.toUpperCase()}`),
        h("p", { className: "boops-em-hero-title" }, protocol.first_screen_message),
        h("p", { className: "boops-em-hero-sub" }, protocol.disclaimer),
      ),
      h(
        "button",
        {
          type: "button",
          className: "boops-em-hero-badge",
          style: "cursor:pointer;border:none;",
          onClick: (ev: MouseEvent) => {
            ev.stopPropagation();
            const evList = appendEmergencyEvent({
              astronaut_id: state.emergencyPatientId,
              mission_day: state.missionDay,
              protocol_id: protocol.id,
              severity: protocol.severity,
              summary: `${protocol.title} activated (${patientRoleNote})`,
            });
            state.showToast(
              `Emergency logged for ${state.emergencyPatientId} at ${evList[0]?.created_utc ?? "UTC"} (always shared)`,
            );
          },
        },
        "Log Emergency Event",
      ),
    );

    const stepCards = protocol.steps.map((stepText, idx) => {
      const stepKey = `${protocol.id}_${idx}`;
      const ts = timestamps[stepKey];
      return h(
        "div",
        {
          className: "boops-em-step",
          "data-checked": ts ? "true" : "false",
          role: "button",
          tabIndex: 0,
          onClick: (ev: MouseEvent) => {
            ev.stopPropagation();
            const nextTs = toggleChecklistTimestamp(protocol.id, stepKey, !ts);
            const nowDone = Boolean(nextTs[stepKey]);
            state.showToast(nowDone ? `Step ${idx + 1} recorded (${nextTs[stepKey]})` : `Step ${idx + 1} cleared`);
            hydrateEmergencyScreens(artboard, screenId, bundle, record, state);
          },
        },
        h("span", { className: "boops-em-check" }, ts ? "✓" : String(idx + 1)),
        h(
          "div",
          { className: "boops-dyn-step-body" },
          h("p", { className: "boops-em-step-text" }, stepText),
          h("p", { className: "boops-em-step-ts" }, ts ? `Completed ${ts}` : "Tap to confirm offline"),
        ),
      );
    });

    const vitalsSnapshot = patientRecord
      ? [
          `Patient: ${patient.id} ${patient.name}`,
          `RHR: ${patientRecord.rhr_bpm.toFixed(0)} bpm`,
          `BP: ${patientRecord.sbp_mmhg.toFixed(0)}/${patientRecord.dbp_mmhg.toFixed(0)} mmHg`,
          `SpO₂: ${patientRecord.spo2_pct.toFixed(1)}%`,
          `Temp: ${patientRecord.temp_c.toFixed(1)} °C`,
          `Today Dose: ${patientRecord.radiation_msv.toFixed(2)} mSv (Cum: ${cumDose.toFixed(1)} / 600 mSv)`,
        ]
      : ["Simulated patient vitals loaded offline."];

    const guideButtons = protocol.related_tool_guides.map((gid) => {
      const g = bundle.toolGuides.find((item) => item.id === gid);
      return h(
        "button",
        {
          type: "button",
          className: "boops-em-guide-btn",
          onClick: (ev: MouseEvent) => {
            ev.stopPropagation();
            state.openToolGuide(gid);
          },
        },
        `ⓘ ${g?.title ?? gid}`,
      );
    });

    const columns = h(
      "div",
      { className: "boops-em-cols" },
      h(
        "div",
        { className: "boops-em-main" },
        h("h3", { className: "boops-em-section-h" }, "Checklist Steps (timestamped offline)"),
        h("p", { className: "boops-em-section-sub" }, "Tap each step as completed — saved offline"),
        ...stepCards,
      ),
      h(
        "div",
        { className: "boops-em-aside" },
        h(
          "div",
          { className: "boops-em-card" },
          h("p", { className: "boops-em-card-kicker" }, "Why this happens"),
          h("p", { className: "boops-em-card-body" }, protocol.why_this_happens),
          h("p", { className: "boops-em-card-kicker", style: "margin-top:6px;" }, "When to escalate"),
          h("p", { className: "boops-em-card-title", style: "color:#991b1b;font-size:13px;" }, protocol.when_to_escalate),
        ),
        h(
          "div",
          { className: "boops-em-card" },
          h("p", { className: "boops-em-card-kicker", style: "color:#4b5563;" }, "Patient live snapshot (Simulated)"),
          ...vitalsSnapshot.map((line) => h("p", { className: "boops-em-card-body" }, line)),
          h("div", { className: "boops-em-guide-links", style: "margin-top:6px;" }, ...guideButtons),
        ),
      ),
    );

    const footerBar = h(
      "div",
      { className: "boops-em-footer" },
      h(
        "button",
        {
          type: "button",
          className: "boops-em-footer-btn",
          onClick: (ev: MouseEvent) => {
            ev.stopPropagation();
            appendEmergencyEvent({
              astronaut_id: state.emergencyPatientId,
              mission_day: state.missionDay,
              protocol_id: protocol.id,
              severity: protocol.severity,
              summary: `Flight Surgeon report queued · ${protocol.title} · ${patient.id} ${patient.name}`,
            });
            state.showToast(`Emergency packet queued for Flight Surgeon (${patient.id} · always-on channel)`);
          },
        },
        "Send Emergency Report to Flight Surgeon",
      ),
      h(
        "p",
        { className: "boops-em-disclaimer", style: "color:#fca5a5;" },
        `${protocol.disclaimer} · Works 100% offline`,
      ),
    );

    content.replaceChildren(crewBar, heroCard, columns, footerBar);
    content.style.top = "116px";
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
