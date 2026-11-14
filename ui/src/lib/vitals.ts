import type { IconName } from "./icons";
import type { Status, Vital, VitalKey } from "../types";

export interface VitalMeta {
  key: VitalKey;
  label: string;
  short: string;
  unit: string;
  decimals: number;
  /** CSS variable holding the metric colour. */
  color: string;
  icon: IconName;
  /** Normal range of the primary reading. */
  normal: [number, number];
  /** Normal range of the secondary reading (diastolic). */
  normalSecondary?: [number, number];
}

export const VITALS: Record<VitalKey, VitalMeta> = {
  heartRate: {
    key: "heartRate",
    label: "Heart rate",
    short: "HR",
    unit: "bpm",
    decimals: 0,
    color: "var(--metric-heart)",
    icon: "heart",
    normal: [50, 100],
  },
  spo2: {
    key: "spo2",
    label: "Blood oxygen",
    short: "SpO₂",
    unit: "%",
    decimals: 0,
    color: "var(--metric-spo2)",
    icon: "droplet",
    normal: [95, 100],
  },
  temperature: {
    key: "temperature",
    label: "Body temp",
    short: "Temp",
    unit: "°C",
    decimals: 1,
    color: "var(--metric-temp)",
    icon: "thermometer",
    normal: [36.1, 37.5],
  },
  bloodPressure: {
    key: "bloodPressure",
    label: "Blood pressure",
    short: "BP",
    unit: "mmHg",
    decimals: 0,
    color: "var(--metric-bp)",
    icon: "gauge",
    normal: [90, 130],
    normalSecondary: [60, 85],
  },
  respiration: {
    key: "respiration",
    label: "Respiration",
    short: "Resp",
    unit: "br/min",
    decimals: 0,
    color: "var(--metric-resp)",
    icon: "wind",
    normal: [12, 20],
  },
};

export const VITAL_ORDER: VitalKey[] = ["heartRate", "spo2", "temperature", "bloodPressure", "respiration"];

export const STATUS_LABEL: Record<Status, string> = {
  nominal: "Nominal",
  watch: "Watch",
  alert: "Alert",
};

export function formatVital(vital: Pick<Vital, "key" | "value" | "secondary">): string {
  const meta = VITALS[vital.key];
  const primary = vital.value.toFixed(meta.decimals);
  return vital.secondary != null ? `${primary}/${vital.secondary.toFixed(0)}` : primary;
}

export function formatRange(meta: VitalMeta): string {
  const [lo, hi] = meta.normal;
  const fmt = (n: number) => n.toFixed(meta.decimals);
  if (meta.normalSecondary) {
    const [dlo, dhi] = meta.normalSecondary;
    return `${fmt(lo)}–${fmt(hi)}/${dlo}–${dhi}`;
  }
  return `${fmt(lo)}–${fmt(hi)}`;
}
