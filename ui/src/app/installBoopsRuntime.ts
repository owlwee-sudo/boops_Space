/**
 * Connects B.O.O.P.S. offline data loading, overlays, and DOM binding hooks into App.ts
 * without requiring edits to generated Figma screen files.
 */

import type { ScreenId } from "../screens";
import { createBoopsOverlays } from "../components/BoopsOverlays";
import {
  type BoopsBundle,
  type SharingSettings,
  loadBoopsBundle,
  loadSelectedContext,
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
}

/** Installs B.O.O.P.S. controls onto the Figma app host and returns per-screen binding hooks. */
export function installBoopsRuntime(host: BoopsHostBridge): BoopsRuntimeInstance {
  const win = window as unknown as { BOOPS_DATA?: BoopsBundle };
  let bundle: BoopsBundle | null =
    win.BOOPS_DATA && Array.isArray(win.BOOPS_DATA.engineOutput) ? win.BOOPS_DATA : null;

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
      sharing = saveSharingSettings({
        ...sharing,
        [key]: val,
        emergency_events: true,
      });
      host.renderActiveScreen();
    },
    onOpenEmergency: () => {
      host.setScreen("EmergencyHub");
    },
    onToast: (msg) => host.showToast(msg),
  });

  // Mount topbar and footer outside .app-stage so Figma scaling math stays untouched.
  const parent = host.stage.parentElement;
  if (parent) {
    parent.insertBefore(overlays.topbar, host.stage);
    host.stage.after(overlays.footer);
  } else {
    host.stage.prepend(overlays.topbar);
    host.stage.append(overlays.footer);
  }
  document.body.append(overlays.drawerBackdrop, overlays.exportBackdrop);
  overlays.updateBar();

  void loadBoopsBundle().then((loaded) => {
    if (!loaded) return;
    bundle = loaded;
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
        sharing = saveSharingSettings({
          ...sharing,
          [key]: nextVal,
          emergency_events: true,
        });
      } else {
        sharing = saveSharingSettings({
          ...sharing,
          risk_detail_share: {
            ...sharing.risk_detail_share,
            [key.risk]: nextVal,
          },
          emergency_events: true,
        });
      }
      host.showToast(nextVal ? "Sharing enabled for selected item" : "Sharing disabled (crew-first default)");
      host.renderActiveScreen();
    },
    openToolGuide: (guideId) => overlays.openDrawer(guideId),
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
    showToast: (msg) => host.showToast(msg),
  });

  return {
    enhanceArtboard(artboard: HTMLElement, screenId: ScreenId) {
      applyBoopsBindings(artboard, screenId, bundle, getStateObj());
      overlays.updateBar();
    },
  };
}

// Register globally at module load time before main.ts calls createApp(root).
(globalThis as unknown as { __boopsInstall?: typeof installBoopsRuntime }).__boopsInstall =
  installBoopsRuntime;
