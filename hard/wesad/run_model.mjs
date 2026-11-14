// run_model.mjs: run the dashboard's WESAD model code from the command line.
//   node hard/wesad/run_model.mjs daily 2 -2 2        -> probability of stress
// Used by tests/test_wesad_model.py to check JavaScript == Python.
import { readFileSync } from "node:fs";
import { checkWesadModel, predictProba } from "../../web/lib/wesad-stress.js";

const [name, ...values] = process.argv.slice(2);
const url = new URL("../../web/models/wesad_stress_model.json", import.meta.url);
const model = checkWesadModel(JSON.parse(readFileSync(url, "utf8")));
console.log(JSON.stringify({ p: predictProba(model, values.map((v) => (v === "null" ? null : Number(v))), name) }));
