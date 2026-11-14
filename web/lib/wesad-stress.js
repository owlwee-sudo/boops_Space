// wesad-stress.js: run the WESAD stress classifier (H3) in the dashboard.
//
// The model is a small logistic regression stored as plain numbers in
// /web/models/wesad_stress_model.json, so it runs offline with no libraries.
// It was trained on REAL labelled data (WESAD, Schmidt et al. 2018), never on
// our simulated mission data.
//
// Read hard/wesad/REPORT.md first: lab stress in 15 young adults on Earth is
// not spaceflight stress. The output is a risk indicator, not a diagnosis.
//
// Usage in the dashboard (OFF unless the user or config turns it on):
//   import { loadWesadModel, wesadStressScore } from "./lib/wesad-stress.js";
//   const model = await loadWesadModel();
//   const score = wesadStressScore(model, { rhr: z.rhr_bpm, hrv: z.hrv_rmssd_ms, eda: z.eda_mean_us });

export const WESAD_CONFIG = {
  MODEL_URL: new URL("../models/wesad_stress_model.json", import.meta.url).href,
  DAILY_MODEL: "daily", // the 3-feature model that matches daily_records
};

/** Fetch and check the model file. */
export async function loadWesadModel(url = WESAD_CONFIG.MODEL_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the WESAD model (${res.status})`);
  return checkWesadModel(await res.json());
}

/** Make sure the JSON has the numbers we need (also used by the Node tests). */
export function checkWesadModel(model) {
  for (const [name, spec] of Object.entries(model.models || {})) {
    const n = spec.features.length;
    for (const key of ["coef", "scaler_mean", "scaler_scale", "impute_missing_with"]) {
      if (!Array.isArray(spec[key]) || spec[key].length !== n) throw new Error(`WESAD model "${name}": bad "${key}"`);
    }
    if (typeof spec.intercept !== "number") throw new Error(`WESAD model "${name}": bad intercept`);
  }
  if (!model.models || !model.models[WESAD_CONFIG.DAILY_MODEL]) throw new Error("WESAD model: daily model missing");
  return model;
}

/**
 * Probability of stress (0-1) for one row of values, in the order of
 * model.models[name].features. null/NaN = missing (replaced by the training median).
 */
export function predictProba(model, values, name = WESAD_CONFIG.DAILY_MODEL) {
  const spec = model.models[name];
  if (values.length !== spec.features.length) throw new Error(`${name} needs ${spec.features.length} values`);
  let total = spec.intercept;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] === null || values[i] === undefined || Number.isNaN(values[i]) ? spec.impute_missing_with[i] : values[i];
    total += (spec.coef[i] * (v - spec.scaler_mean[i])) / spec.scaler_scale[i];
  }
  return 1 / (1 + Math.exp(-total));
}

/**
 * Stress score 0-100 from the app's personal-baseline z-scores.
 * @param z {rhr, hrv, eda}: z-scores of rhr_bpm, hrv_rmssd_ms, eda_mean_us
 */
export function wesadStressScore(model, z) {
  return Math.round(100 * predictProba(model, [z.rhr, z.hrv, z.eda]));
}
