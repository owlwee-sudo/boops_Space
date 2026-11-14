# Nervous system: how it plugs into the web

*Researched 14 Nov 2026. Source ids refer to [sources.md](sources.md). Structured version: `layer: "nervous"` in [data/](data/).*

## Summary

The nervous system connects to the existing web in five places:

1. **It is upstream of the stress hub.** The brain's stress system (amygdala → hypothalamus) drives both the HPA axis (cortisol) and the sympathetic nervous system.
2. **It hosts the reactivating viruses.** HSV-1 and VZV lie latent in cranial nerve ganglia.
3. **Fluid shift reaches the brain and eyes** (brain structure changes, SANS).
4. **Microgravity disrupts balance** (vestibular system), causing motion sickness that can look like illness.
5. **Radiation and isolation may reach the brain** (deep-space cognition risk, neuroinflammation). This is mostly animal evidence.

**Key design point:** HRV is a direct read-out of the autonomic nervous system, so the project's best stress signal is already a nervous-system signal.

## 1. Brain stress system → sympathetic nerves → immune 🧑 ⭐⭐

- The stress system sits in the brain (amygdala, limbic system). Its two effectors are the HPA axis and the autonomic nervous system. `[capri25]`
- Sympathetic responses dominated after 9-day flights. After 16-day flights, cortisol-mediated changes dominated at landing. `[stowe03]`
- **Implication:** the web's "Cortisol" hub has a twin, the sympathetic/autonomic nervous system, which also modulates immunity and heart rate.

## 2. Nerves host the latent viruses 🧑

- HSV-1 and VZV can stay latent in cranial nerve ganglia and reactivate when stress disturbs immune regulation. `[thymus24]`
- This was added as a note on the existing `immune → viral` edge.

## 3. Fluid shift → brain structure and eyes 🧑 ⭐⭐⭐

**Brain**
- The brain shifts upward in the skull and the ventricles (fluid-filled spaces) enlarge, by about 11–25% across studies. `[mcgregor23]`
- Enlargement grows with mission length but tapers off after about 6 months. Crew with fewer than 3 years between missions showed little further enlargement. `[mcgregor23]`
- Recovery is only partial 6–12 months after landing. Reduced CSF resorption in microgravity is the proposed cause. `[vanombergen19]` `[hupfeld22]`
- The medical meaning is still unclear, and the changes have not been tied to functional decline. `[sans_nasa23]`

**Eyes: SANS (spaceflight-associated neuro-ocular syndrome)**
- Findings include optic disc edema, globe flattening, choroidal/retinal folds and a hyperopic (far-sighted) shift. `[eyebrain23]` `[sans_sr20]`
- Prevalence: about 81% of NASA long-duration astronauts had at least one ocular finding `[sansreview26]`. About 66% show the earliest sign, optic disc edema. `[sans_nasa23]`
- Mechanism: fluid shift toward the head, venous congestion and altered CSF flow, not simply raised intracranial pressure. `[sans_wjg]`
- So far the functional impact has been correctable with glasses, and no effective prevention has been found yet. `[sans_sr20]`
- Brain ↔ eye link: astronauts who developed SANS had larger white-matter perivascular spaces. `[pvs]` `[eyebrain23]`

## 4. Microgravity → balance (vestibular) 🧑 ⭐⭐⭐

- The inner ear's signals no longer match what the brain expects, which causes space motion sickness. Nearly 70% of astronauts have motion sickness and/or impaired motor performance, mostly easing within 1 hour to 4 days. `[vestib15]`
- After landing, unsteady walking and balance problems are common. Motion sickness after landing is worse after long missions `[neurovest17]` and does not reliably improve with repeat flights. `[reentry25]`
- ⚠️ **Confounder:** motion sickness brings malaise, appetite loss and headache, which can look like illness, the same way fluid shift can. `[reentry25]`

## 5. Radiation, isolation → brain 🐭 ⭐

- **Radiation (deep space):** rodent studies show cognitive deficits at heavy-ion doses of about 0.1 Gy or more. Missions give less than about 0.04 Gy/year of heavy ions, so the human risk is uncertain `[cucinotta]` `[gcr18]`. Some studies even report pro-cognitive effects in animals. `[gcr23]`
- **Isolation + simulated microgravity** drove brain immune changes in mice through mitochondrial oxidative stress. This links to the Inflammation hub. `[mcat]`

## 6. Outcome: cognition & performance 🧑 ⭐⭐

- 25 ISS astronauts on 6-month missions showed no systematic cognitive decline. `[cog24]`
- Early flight brought slower processing speed, visual working memory and sustained attention. Late flight brought slower emotion recognition. Processing speed recovered only after return. `[cog24]`
- In analog studies, sleep restriction worsened attention and emotion recognition. ISS data showed no clear link with sleep. `[cog24]`

## New measurable signals

| Signal | Measures | Verdict | Source |
|---|---|---|---|
| HRV | Autonomic balance (sympathetic vs parasympathetic) | 🟢 already in the project | `autonomic`, `mentalhrv` |
| Cognition test battery | 10 cognitive domains | 🟢 routine (WinSCAT is a medical requirement for US long-duration crew) | `cog24`, `winscat` |
| Eye imaging (OCT) | Optic disc, retina (SANS) | 🔵 in-flight imaging + AI improving | `sans_nasa23`, `sans_wjg` |
| Brain MRI | Ventricles, brain position | 🔴 pre/post flight only | `mcgregor23` |

## Open questions for the team

- Late-flight emotion recognition slows down. Does that make facial-behaviour stress signals less reliable late in a mission?
- Should motion sickness be a "known adaptation" filter, like fluid shift, so the app doesn't raise false illness alerts in the first days and after landing?
