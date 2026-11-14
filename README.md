# boops_Space
NASA Space Apps Challenge 2026, team boops boops (a fish name). Health monitoring software for a space crew.

## UI

The desktop app lives in [`ui/`](ui). It's built with **Tauri**: a TypeScript + CSS frontend (Vite, no framework) and a Rust core.

```
ui/
├── index.html
├── public/boops-logo.svg
├── src/                      ← TypeScript + CSS
│   ├── main.ts               entry: loads fonts, tokens, mounts the app
│   ├── types.ts              data shapes shared with Rust
│   ├── app/                  page layout + refresh loop (App.ts, App.css)
│   ├── components/           one folder per component (.ts + .css)
│   │   ├── Sidebar/
│   │   ├── TopBar/
│   │   ├── CrewSelector/
│   │   ├── VitalCard/
│   │   ├── Sparkline/
│   │   ├── TrendChart/
│   │   ├── RadiationCard/
│   │   ├── SleepCard/
│   │   ├── AlertsPanel/
│   │   └── StatusBadge/
│   ├── lib/                  DOM helpers, icons, formatting, vital metadata
│   ├── services/             data source: Rust via Tauri, or browser simulator
│   └── styles/               tokens.css (design tokens) + base.css
└── src-tauri/                ← Rust
    ├── src/lib.rs            Tauri command `get_mission_snapshot`
    ├── src/vitals.rs         simulated crew vitals, radiation, sleep, alerts
    └── tauri.conf.json
```

Each component is a plain function that returns `{ el, update }` and imports its own stylesheet. Colours, type sizes and spacing come only from `src/styles/tokens.css`, so the same token names can be used as Figma variables.

### Run it

In a browser (no Rust needed; uses the TypeScript simulator):

```bash
cd ui && npm install && npm run dev
```

Then open http://localhost:1420.

As the desktop app (needs Rust, install it from https://rustup.rs):

```bash
cd ui && npm run app
```

Run the Rust tests (they check that Rust and the TypeScript simulator give the same numbers):

```bash
cd ui/src-tauri && cargo test
```

### Data

Readings are simulated, not real sensor data. Each value is a pure function of time (baseline + daily rhythm + small waves + noise), so the Rust core and `src/services/simulator.ts` stay in step. To use real data, replace `sample()` in `src-tauri/src/vitals.rs`.
