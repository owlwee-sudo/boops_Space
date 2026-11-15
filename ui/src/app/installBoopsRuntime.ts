/**
 * Connects BOOPS offline data loading, overlays, and DOM binding hooks into App.ts
 * without requiring edits to generated Figma screen files.
 */

import type { ScreenId } from "../screens";
import { createBoopsOverlays } from "../components/BoopsOverlays";
import { showWelcome } from "../components/Welcome";
import {
  type DataMode,
  getDataMode,
  getRequestedDataMode,
  getStoredDataMode,
  hasCompletedWelcome,
  loadPersonalProfile,
  setDataMode,
} from "../services/dataMode";
import {
  type BoopsBundle,
  type SharingSettings,
  loadBoopsBundle,
  loadSelectedContext,
  loadManualLogs,
  loadSharingSettings,
  saveSelectedContext,
  saveSharingSettings,
} from "../services/boopsData";
import { type AppContextState, applyBoopsBindings } from "./bindEngineData";

export interface BoopsHostBridge {
  stage: HTMLElement;
  getScreen: () => ScreenId;
  setScreen: (id: ScreenId) => void;
  renderActiveScreen: () => void;
  showToast: (msg: string) => void;
}

export interface BoopsRuntimeInstance {
  enhanceArtboard: (artboard: HTMLElement, screenId: ScreenId) => void;
  closeTopOverlay: () => boolean;
}

/** Installs BOOPS controls onto the Figma app host and returns per-screen binding hooks. */
export function installBoopsRuntime(host: BoopsHostBridge): BoopsRuntimeInstance {
  // ---- Demo vs My data ----
  // The landing page may pass ?data=demo|mine. Apply it, then drop it from the URL.
  const requestedMode = getRequestedDataMode();
  const needsProfile = requestedMode === "mine" && !loadPersonalProfile();
  if (requestedMode && requestedMode !== getStoredDataMode() && !needsProfile) {
    setDataMode(requestedMode);
  }
  if (requestedMode) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("data");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {
      // Ignore history errors in restricted WebViews.
    }
  }
  const renderedMode: DataMode = getDataMode();
  document.documentElement.dataset.boopsData = renderedMode;

  /** Reloads when the data mode changed, because the bundle and context depend on it. */
  const applyModeChoice = (mode: DataMode) => {
    if (mode === renderedMode) return;
    window.location.replace(window.location.pathname + window.location.hash.replace(/screen=[^&]*/, "screen=HealthHome"));
  };
  const openDataChoice = () =>
    showWelcome({ startAtChoice: true, dismissible: true, preselected: getDataMode(), onDone: applyModeChoice });

  if (!hasCompletedWelcome()) {
    showWelcome({ preselected: requestedMode, onDone: applyModeChoice });
  } else if (needsProfile) {
    showWelcome({ startAtChoice: true, dismissible: true, preselected: "mine", onDone: applyModeChoice });
  }

  /** "My data" keeps protocols, tool guides and sources but never the simulated crew readings. */
  const forMode = (data: BoopsBundle | null): BoopsBundle | null =>
    data && renderedMode === "mine" ? { ...data, engineOutput: [], dailyRecords: [], events: [] } : data;

  const countLoggedDays = (astronautId: string) =>
    new Set(loadManualLogs().filter((e) => e.astronaut_id === astronautId).map((e) => e.mission_day)).size;

  const win = window as unknown as { BOOPS_DATA?: BoopsBundle };
  let bundle: BoopsBundle | null = forMode(
    win.BOOPS_DATA && Array.isArray(win.BOOPS_DATA.engineOutput) ? win.BOOPS_DATA : null,
  );

  let context = loadSelectedContext();
  let sharing: SharingSettings = loadSharingSettings();
  let activeEmergencyId = "solar_radiation_storm";
  let emergencyPatientId: "A1" | "A2" | "A3" = context.astronautId;

  const overlays = createBoopsOverlays({
    getBundle: () => bundle,
    getContext: () => ({
      astronautId: context.astronautId,
      missionDay: context.missionDay,
      sharing,
    }),
    setContext: (astronautId, missionDay, jumpHome) => {
      context = { astronautId, missionDay };
      emergencyPatientId = astronautId;
      saveSelectedContext(context);
      overlays.updateBar();
      if (jumpHome) {
        if (astronautId === "A2" && missionDay === 68) {
          host.setScreen("HealthRiskDetailBoneMuscle");
          return;
        }
        if (astronautId === "A1" && (missionDay === 96 || missionDay === 97)) {
          host.setScreen("HealthRiskDetailImmune");
          return;
        }
        if (host.getScreen() !== "HealthHome") {
          host.setScreen("HealthHome");
          return;
        }
      }
      host.renderActiveScreen();
    },
    onToggleSharing: (key, val) => {
      sharing = saveSharingSettings(
        {
          ...sharing,
          [key]: val,
          emergency_events: true,
        },
        context.astronautId,
      );
      host.renderActiveScreen();
    },
    onOpenSettings: () => host.setScreen("SettingsProfile"),
    onSwitchData: openDataChoice,
    onDataIngested: () => {
      overlays.updateBar();
      host.renderActiveScreen();
    },
    onUiModeChange: () => {
      overlays.updateBar();
      host.renderActiveScreen();
    },
    onToast: (msg) => host.showToast(msg),
  });

  // Mount topbar and footer outside .app-stage so Figma scaling math stays untouched.
  const parent = host.stage.parentElement;
  if (parent) {
    parent.insertBefore(overlays.topbar, host.stage);
    host.stage.after(overlays.footer);
    const frameHud = parent.querySelector<HTMLElement>(".frame-hud");
    if (frameHud) {
      overlays.footer.append(frameHud);
    }
  } else {
    host.stage.prepend(overlays.topbar);
    host.stage.append(overlays.footer);
  }
  document.body.append(overlays.drawerBackdrop, overlays.exportBackdrop, overlays.deviceHubBackdrop);
  overlays.updateBar();

  void loadBoopsBundle().then((loaded) => {
    if (!loaded) return;
    bundle = forMode(loaded);
    overlays.updateBar();
    host.renderActiveScreen();
  });

  const getStateObj = (): AppContextState => ({
    astronautId: context.astronautId,
    missionDay: context.missionDay,
    activeEmergencyId,
    emergencyPatientId,
    sharing,
    onChangeEmergencyPatient: (id) => {
      emergencyPatientId = id;
      host.renderActiveScreen();
    },
    onToggleSharing: (key, nextVal) => {
      if (typeof key === "string") {
        sharing = saveSharingSettings(
          {
            ...sharing,
            [key]: nextVal,
            emergency_events: true,
          },
          context.astronautId,
        );
      } else {
        sharing = saveSharingSettings(
          {
            ...sharing,
            risk_detail_share: {
              ...sharing.risk_detail_share,
              [key.risk]: nextVal,
            },
            emergency_events: true,
          },
          context.astronautId,
        );
      }
      host.showToast(nextVal ? "Sharing enabled for selected item" : "Sharing disabled (crew-first default)");
      host.renderActiveScreen();
    },
    openToolGuide: (guideId) => overlays.openDrawer(guideId),
    openDeviceHub: (tab) => overlays.openDeviceHub(tab),
    openCameraCheck: (simulated = false) => overlays.openCameraCheck(simulated),
    openEmergencyProtocol: (protocolId) => {
      activeEmergencyId = protocolId;
      const targetScreen: ScreenId =
        protocolId === "solar_radiation_storm" ? "EmergencySolarRadiationStorm" : "EmergencyFainting";
      host.setScreen(targetScreen);
    },
    openRiskScreen: (riskKey) => {
      const target: ScreenId =
        riskKey === "immune"
          ? "HealthRiskDetailImmune"
          : riskKey === "musculoskeletal"
            ? "HealthRiskDetailBoneMuscle"
            : "HealthRiskDetailHeart";
      host.setScreen(target);
    },
    setDay: (missionDay) => {
      const clamped = Math.max(1, Math.min(180, Math.round(missionDay)));
      context = { astronautId: context.astronautId, missionDay: clamped };
      saveSelectedContext(context);
      overlays.updateBar();
      host.renderActiveScreen();
    },
    navigateScreen: (targetScreen) => host.setScreen(targetScreen),
    reRenderScreen: () => host.renderActiveScreen(),
    showToast: (msg) => host.showToast(msg),
    dataMode: renderedMode,
    loggedDays: renderedMode === "mine" ? countLoggedDays(context.astronautId) : 0,
    onTryDemo: openDataChoice,
  });

  return {
    enhanceArtboard(artboard: HTMLElement, screenId: ScreenId) {
      applyBoopsBindings(artboard, screenId, bundle, getStateObj());
      overlays.mountScreenControls(artboard, screenId);
      overlays.updateBar();
    },
    closeTopOverlay: () => overlays.closeTopOverlay(),
  };
}

// Register globally at module load time before main.ts calls createApp(root).
(globalThis as unknown as { __boopsInstall?: typeof installBoopsRuntime }).__boopsInstall =
  installBoopsRuntime;
