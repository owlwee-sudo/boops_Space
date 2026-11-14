# Agent guide: boops_Space

Team boops boops, NASA Space Apps Challenge 2026: **health monitoring software for astronauts on space missions**.

## Where the knowledge is

All research lives in [`knowledge/`](knowledge/README.md). Start there.

- Need a fact or a link between two factors? Search `knowledge/data/edges.json` (`from`, `to`, `type`, `note`, `sources`).
- Need what a concept means? `knowledge/data/nodes.json` (`description`).
- Need a citation? `knowledge/data/sources.json` by `id`.
- Narrative and context: `knowledge/relationship-map.md`, `knowledge/nervous-system.md`.

## Rules when you use or change the knowledge

1. **Cite everything.** Space Apps rule: every resource used must be cited, including open-source tools and datasets (e.g. rPPG-Toolbox). Teams can lose awards otherwise. Any claim you add needs a source id in `sources.json`.
2. **The JSON is the source of truth.** Edit `knowledge/data/*.json`, then run `node tools/build-docs.mjs`. Do not hand-edit `relationships.md` or `sources.md`. The script fails if an id doesn't resolve or a source is unused.
3. **Keep evidence honest.** Record evidence type (`H` humans, `A` animals, `C` cells) and strength (`stars` 1–3). Don't upgrade animal evidence to human.
4. **Don't invent numbers.** Use figures from sources only, and quote them as they appear.

## Product rules the team decided

- Outputs are a **"risk indicator" / "early warning"**, never a **diagnosis**.
- Label sample or demo data as **simulated**.
- **Crew first:** the astronaut sees alerts first and chooses what goes to mission control.
- App structure (lo-fi wireframes in Figma): a **Health** tab (processed insights) and a **Log** tab (raw daily data such as sleep).
- Judges want: tracking of health data; what to do in an emergency; how to use each tool, why it matters and how to fix problems.
- Monitoring principle: compare each astronaut to their **own in-flight baseline**, not a population norm. Treat fluid shift and motion sickness as normal adaptation, not illness.
- Don't label emotions from faces; use facial change only as one input in fusion, framed as medical/safety (EU AI Act).
