/**
 * Demo vs personal ("My data") mode, the personal profile, and the first-launch welcome flag.
 *
 * - "demo": the simulated 3-person, 180-day mission (labelled "Simulated").
 * - "mine": no simulated readings at all. Screens stay empty until the user logs
 *   readings or connects a sensor. Protocols, tool guides and logging still work.
 *
 * The landing page can preselect a mode with `?data=demo` or `?data=mine`.
 * This module has no imports so any other module can use it without cycles.
 */

export type DataMode = "demo" | "mine";

export interface PersonalProfile {
  name: string;
  role: string;
  /** ISO date (YYYY-MM-DD) of mission day 1, so "Today" can be worked out on later visits. */
  missionStartDate: string;
}

const MODE_KEY = "boops.data_mode";
const WELCOME_KEY = "boops.welcome_done";
const PROFILE_KEY = "boops.personal_profile";
const MAX_MISSION_DAY = 180;

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows or locked-down WebViews: the choice simply lasts for this visit.
  }
}

let sessionMode: DataMode | null = null;

/** Mode requested by the landing page link (`?data=demo|mine`), if any. */
export function getRequestedDataMode(): DataMode | null {
  try {
    const raw = new URL(window.location.href).searchParams.get("data")?.toLowerCase();
    if (raw === "demo") return "demo";
    if (raw === "mine" || raw === "real" || raw === "personal") return "mine";
  } catch {
    // Ignore malformed URLs.
  }
  return null;
}

/** The chosen mode, or null when the user has not chosen yet (first launch). */
export function getStoredDataMode(): DataMode | null {
  if (sessionMode) return sessionMode;
  const raw = storageGet(MODE_KEY);
  return raw === "demo" || raw === "mine" ? raw : null;
}

/** Effective mode used for rendering. Before a choice is made the app shows the demo behind the welcome screen. */
export function getDataMode(): DataMode {
  return getStoredDataMode() ?? "demo";
}

export function setDataMode(mode: DataMode): void {
  sessionMode = mode;
  storageSet(MODE_KEY, mode);
  document.documentElement.dataset.boopsData = mode;
}

export function hasCompletedWelcome(): boolean {
  return storageGet(WELCOME_KEY) === "1";
}

export function markWelcomeComplete(): void {
  storageSet(WELCOME_KEY, "1");
}

/** Clears the welcome flag so the welcome screen shows again on next load (used by "Restart setup"). */
export function resetWelcome(): void {
  try {
    window.localStorage.removeItem(WELCOME_KEY);
    window.localStorage.removeItem(MODE_KEY);
  } catch {
    // Ignore storage errors.
  }
  sessionMode = null;
}

export function loadPersonalProfile(): PersonalProfile | null {
  const raw = storageGet(PROFILE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersonalProfile>;
    if (typeof parsed.name !== "string" || typeof parsed.missionStartDate !== "string") return null;
    return {
      name: parsed.name,
      role: typeof parsed.role === "string" ? parsed.role : "",
      missionStartDate: parsed.missionStartDate,
    };
  } catch {
    return null;
  }
}

export function savePersonalProfile(profile: PersonalProfile): void {
  storageSet(PROFILE_KEY, JSON.stringify(profile));
}

/** ISO date of mission day 1 given today's mission day. */
export function startDateForMissionDay(missionDay: number, now = new Date()): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (Math.max(1, missionDay) - 1));
  const mm = String(start.getMonth() + 1).padStart(2, "0");
  const dd = String(start.getDate()).padStart(2, "0");
  return `${start.getFullYear()}-${mm}-${dd}`;
}

/** Today's mission day for the personal profile (1–180), or 1 when there is no profile yet. */
export function personalMissionDayToday(now = new Date()): number {
  const profile = loadPersonalProfile();
  if (!profile) return 1;
  const [y, m, d] = profile.missionStartDate.split("-").map(Number);
  if (!y || !m || !d) return 1;
  const start = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - start.getTime()) / 86_400_000);
  return Math.max(1, Math.min(MAX_MISSION_DAY, diffDays + 1));
}
