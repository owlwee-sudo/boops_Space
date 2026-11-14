# Knowledge base: astronaut health relationships

Research behind team boops boops' NASA Space Apps 2026 entry, *"Create Health Monitoring software for astronauts on space missions"*.

| File | What it is | Edit it? |
|---|---|---|
| [relationship-map.md](relationship-map.md) | Original research notes (13 Nov 2026): stressors, hubs, evidence, signals, wearables, camera rPPG, open design questions, reading list | Yes |
| [nervous-system.md](nervous-system.md) | Nervous-system extension (14 Nov 2026): brain, eyes (SANS), balance, autonomic nerves, cognition | Yes |
| [data/nodes.json](data/nodes.json) | 40 concepts (stressors, hubs, body effects, outcomes, devices, signals) | **Source of truth** |
| [data/edges.json](data/edges.json) | 77 links with type, evidence, stars, note and source ids | **Source of truth** |
| [data/sources.json](data/sources.json) | 81 sources with id, group, title, URL | **Source of truth** |
| [relationships.md](relationships.md) | Readable list of every link, generated from the JSON | No, regenerate |
| [sources.md](sources.md) | Reference list, generated from the JSON | No, regenerate |
| [web/index.html](web/index.html) | Interactive relationship web (open in a browser; no install) | Yes, see note |

## How to read it fast

1. Open `web/index.html` in a browser. Hover to trace links, click for evidence and sources.
2. Skim [relationships.md](relationships.md) for the full list.
3. Read the "Quick summary" and "Open design questions" in [relationship-map.md](relationship-map.md).

## The model in one paragraph

Four stressors (stress, isolation, radiation, microgravity) reach the body through a few hubs: cortisol/HPA, the sympathetic nervous system, inflammation/oxidative stress, fluid shift and unloading. The effects land on immune function (leading to latent virus reactivation), bone, muscle, heart, vessels, glucose, brain, eyes and balance. Microgravity is the biggest *cause* but never varies. Stress, radiation dose, exercise/loading and sleep vary, so they are the useful *signals*, always compared to each astronaut's own in-flight baseline. Fluid shift and motion sickness are confounders that can look like illness.

## Data format

```jsonc
// nodes.json
{ "id": "stress", "label": "Psychological stress", "category": "stressor|hub|body|outcome|counter|device|signal",
  "layer": "core|nervous", "description": "...", "varies_day_to_day": "...", "signal_verdict": "good|caution|weak|early",
  "sources": ["hazards"] }
// edges.json
{ "from": "stress", "to": "cortisol", "type": "causal|amplifies|protects|confounds|measures",
  "label": "activates HPA axis", "evidence": "H|A|C (humans/animals/cells)", "stars": 1-3,
  "notes_section": "3.3", "layer": "core", "note": "...", "sources": ["mehta17"] }
// sources.json
{ "id": "mehta17", "group": "Stress → immune", "title": "...", "url": "https://...", "layer": "core" }
```

After editing the JSON, run `node tools/build-docs.mjs` (Node 18+). It checks every id and regenerates the two Markdown lists.

**Note:** `web/index.html` has its own embedded copy of the **core** layer (61 links). The nervous-system layer is in the JSON and Markdown but not drawn on the page yet.

## Known gaps

- `cortisol → bone` has no citation yet (clinical knowledge only).
- Several "measures" links (dosimeter, CGM, mission day, exercise log, scans) have no source.
- Radiation → brain and isolation → neuroinflammation are animal-only evidence.
