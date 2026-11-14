import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MissionSnapshot } from "../types";
import { simulateSnapshot } from "./simulator";

/**
 * Get the latest crew health snapshot.
 * Inside the Tauri app this calls the Rust core; in a plain browser
 * (npm run dev) it falls back to the TypeScript simulator.
 */
export async function fetchSnapshot(): Promise<MissionSnapshot> {
  if (isTauri()) {
    try {
      return await invoke<MissionSnapshot>("get_mission_snapshot");
    } catch (error) {
      console.warn("Rust core unavailable, using browser simulator", error);
    }
  }
  return simulateSnapshot(Date.now() / 1000);
}
