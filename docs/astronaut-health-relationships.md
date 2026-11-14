# Astronaut Health — Relationship Map & Research Notes
*NASA Space Apps Challenge 2026 · "Create Health Monitoring software for astronauts on space missions"*
*Compiled 13 Nov 2026*

---

## 0. Quick summary

- Six spaceflight stressors were explored: **stress, radiation, isolation, microgravity**, and the effects **muscle/bone loss**, plus later **cardiovascular** and **glucose/metabolism**.
- Most arrows pass through two **hubs**: **inflammation** and **oxidative stress**. Shared signalling molecules (IL-6, RANKL, TNF-α, cortisol) link the immune system, bone, muscle and blood vessels.
- **Stress** and **microgravity** are the most connected factors (3+ outgoing arrows each).
- Microgravity and isolation are "always on" (context). **Stress, radiation dose, exercise/loading and sleep** are the factors that *vary* and can be tracked.
- Best monitoring principle found: **compare each astronaut to their own in-flight baseline**, not to a population norm.

---

## 1. Master relationship map

```
 Stress ──────cortisol──────┐
 Isolation ─────────────────┤ (also: fewer germs → "immune amnesia")
 Radiation ──ROS────────────┼──► INFLAMMATION / OXIDATIVE STRESS ──► T/NK cells ↓ → latent virus reactivation
 Microgravity ──────────────┤            │       (IL-6, RANKL, TNF-α)     └──► blood vessels (deep-space risk)
   ├─ direct on T cells ────┘            ▼
   ├─ fluid shift ──► HR↑  BP↓  HRV↓  puffy face, headache
   └─ unloading ──► MUSCLE ↔ BONE ↔ HEART shrink   ◄── exercise protects all three
                       ▲
 Stress + inactivity ──┴──► insulin resistance (glucose) ──► stiffer arteries
```

**Evidence key:** 🧑 humans (astronauts / bed rest / analogs) · 🐭 animals · 🧫 cells · ⭐ strength (⭐⭐⭐ strongest)

---

## 2. The big picture: immune dysregulation in space 🧑 ⭐⭐⭐

- About **50% of astronauts** experience immune troubles; common changes are viral reactivation and lower T-cell and NK-cell responses.
- Pattern (NASA): leukocyte counts relatively **normal**, but **T/NK cell function ↓** and **plasma cytokines ↑**, which leads to herpesvirus reactivation. It resembles shingles patients, but milder.
- **53%** of short shuttle-flight astronauts and **61%** of longer ISS astronauts shed herpes viruses (EBV, VZV, CMV, HSV-1) in saliva or urine.
- Dysregulation persists for the whole 6-month mission. Reactivation frequency and viral load **increase with mission length**.
- The NASA framing: it is still unclear whether these changes cause more disease. Most reactivation is **asymptomatic**.

---

## 3. Relationships, link by link

### 3.1 Isolation → Stress 🧑 ⭐⭐⭐
- In Mars-500 (a 520-day simulated Mars mission with no microgravity or radiation), the crew had **long-lasting high cortisol**, i.e. chronic stress caused by isolation and confinement.
- Isolation mostly acts **upstream, through stress**.

### 3.2 Isolation → Immune (directly) 🧑 ⭐⭐
- Fewer new microbes means less immune "training", which can lead to **"immune amnesia"** (immune memory deteriorates).
- In Mars-500 the immune system was **dysregulated, not just weak**: more lymphocytes, heightened antiviral responses, and up-regulated anti-inflammatory signalling.
- A systematic review of 140 studies found immune dysregulation across all ICE (isolated, confined, extreme) environments. Most measures **return to baseline after isolation**.
- An Antarctic station study found lower salivary immunoglobulins, i.e. effects on mucosal immunity.

### 3.3 Stress → Immune 🧑 ⭐⭐⭐
- Stress activates the HPA axis, which raises cortisol (and DHEA), which weakens cellular immunity, which lets latent viruses reactivate.
- On the ISS, crew who **shed a latent virus had higher salivary cortisol**. Reactivation was distinct to crew who did **spacewalks (EVA)**.
- Long-duration flight changed the **daily cortisol rhythm** (salivary).

### 3.4 Stress → Muscle 🧑 ⭐⭐⭐
- Spaceflight raises cortisol production, so the hormonal balance favours **muscle protein loss**.
- **Inactivity amplifies it**: after 14 days of bed rest, high cortisol increased amino-acid loss from muscle **3-fold**. Inactivity sensitises muscle to cortisol.
- So stress and microgravity **amplify each other**; they are not just additive.

### 3.5 Stress → Bone 🧑 (clinical)
- Glucocorticoid therapy is a known cause of excess osteoclast (bone-resorbing cell) activity. Cortisol is a glucocorticoid.

### 3.6 Radiation → Immune 🐭🧫 (+ some 🧑) ⭐⭐
- **Lymphocytes are the most radiation-sensitive blood cells.**
- There is a dose-dependent drop in lymphocyte counts after proton radiation (animals).
- Human lymphocytes show increased chromosomal aberrations after long missions.
- A strong solar particle event + simulated microgravity impaired bacterial-infection clearance in mice, i.e. a risk of severe infection.

### 3.7 Radiation → Bone 🐭 ⭐⭐
- Two phases: a quick rise in bone resorption (osteoclasts), then **suppressed bone formation**.
- Mouse tibia osteoclast numbers: radiation **+46%**, hindlimb unloading **+47%**, both combined **+64%**.
- Shared mechanism: both radiation and unloading **increase oxidative stress**.

### 3.8 Microgravity → Immune (directly) 🧫🐭 ⭐⭐
- Cells flown in space show that microgravity **directly disrupts T-cell activation**, independent of stress hormones.
- This is a second route to the same outcome: weak T cells, then viral reactivation.

### 3.9 Microgravity → Muscle & Bone 🧑 ⭐⭐⭐ (strongest link)
- Unloading increases bone resorption and decreases bone formation.
- Microgravity impairs osteocytes and osteoblasts, so osteoclasts dominate.
- Muscle atrophy happens despite exercise programmes.

### 3.10 Bone ↔ Immune (osteoimmunology) 🐭🧫 ⭐⭐
- Bone and immune cells share the signal **RANKL**. RANKL binding RANK is required for osteoclasts, and RANKL is also made by T and B cells.
- Inflammation from the space environment (microgravity + radiation) can **trigger bone loss**. It's a two-way street.

### 3.11 Muscle → Immune (myokines) 🐭 ⭐ (partly hypothesis)
- Muscle releases **IL-6** and other myokines, which help regulate bone, muscle and immunity.
- Post-exercise IL-6 scales with body weight (gravity). In space, less IL-6 may partly explain why exercise doesn't fully stop bone and muscle loss.
- Mice prone to muscle loss had lower levels of chemokines that also coordinate immune-cell migration.
- ⚠️ **Landing caveat:** inflammatory markers that spike at landing may reflect **muscle regeneration** (Twins Study re-analysis), not illness. High cytokines ≠ always "sick".

### 3.12 Microgravity → Cardiovascular 🧑 ⭐⭐⭐
- **Fluid shift:** blood moves headward, causing a puffy face, headache, a "stuffy head" and flu-like feelings.
- **Heart rate ↑** (meta-analysis), **blood pressure ↓ about 10 mmHg** on long missions, **HRV ↓**.
- **The heart shrinks** because it has less work to do: left-ventricle mass fell **about 12%** after a short flight. Scott Kelly's heart shrank about **0.74 g/week** but still worked well.
- **Exercise on the ISS offsets cardiac atrophy** (13-astronaut study). The same countermeasure protects muscle, bone and heart.
- Post-flight **orthostatic intolerance** (fainting when standing up).

### 3.13 Radiation → Blood vessels 🐭 + weak 🧑 ⭐ (deep space only)
- Apollo lunar astronauts: **43%** cardiovascular deaths vs **9–11%** for non-flight and LEO astronauts. ⚠️ Very small sample (3 of 7 people).
- In mice, deep-space-type radiation caused **lasting endothelial dysfunction** (damage to the blood-vessel lining), a path to atherosclerosis.

### 3.14 Stress + Inflammation → Blood vessels 🧑
- Sources of oxidative and inflammatory damage: radiation, psychological stress, low activity, poor nutrition, and high oxygen during EVA.
- **But in low Earth orbit, arteries held up:** biomarkers rose in flight but returned to baseline within 1 week, and there was **no carotid thickening or stiffening over 5 years**.
- So it's a real deep-space risk, but mostly theoretical for ISS-length missions.

### 3.15 Stress / Inactivity → Insulin resistance (glucose) → Stiffer arteries 🧑 ⭐⭐
- CSA "Vascular" experiment: **carotid stiffness ↑ and insulin resistance ↑**, with fasting insulin elevated in flight in all astronauts.
- Bed rest + high cortisol: leg insulin sensitivity **9.1 → 5.2 mg/kg/min**.
- CGMs (continuous glucose monitors) are already used in space health research.

---

## 4. Connection counts (who matters most)

| Factor | Arrows out to | Varies day to day? | Easy to track? |
|---|---|---|---|
| **Stress** | immune, muscle, bone, vessels, glucose | ✅ yes (EVA, sleep, conflict) | ✅ HRV, sleep, saliva cortisol |
| **Microgravity** | muscle, bone, heart, immune (direct), amplifies stress | ❌ always ~100% | via **exercise/loading logs** (its "variable version") |
| **Radiation** | immune, bone, vessels | ✅ spikes (solar events) | ✅ dosimeters already exist |
| **Isolation** | stress, immune | slowly (grows with mission days) | mission day count |
| Muscle/bone loss | immune (myokines, RANKL) | slowly | scans and strength tests only |
| Immune function | (outcome) | ✅ | ❌ needs blood/saliva |

**Key insight:** "most connected" ≠ "most useful to monitor". Microgravity is the biggest *cause*; stress is the more useful *signal*.

**Proxy idea:** measure the easy, varying signals (stress, radiation dose, exercise, mission day) to **estimate a hard-to-measure risk** (immune risk), shown as a **trend or risk level**, not a fake exact number.

---

## 5. Measurable stress signals (how they behave in space)

| Signal | Tracks stress? | Space problem | Verdict |
|---|---|---|---|
| Heart rate | Yes (+~7 bpm under mental stress on ISS) | Microgravity raises it too | ⚠️ Confounded |
| Blood pressure | Yes (+~7 mmHg) | Spaceflight lowers it ~10 mmHg | ❌ Weak |
| **HRV (from ECG/PPG)** | Better; stress shifts it toward sympathetic, and the response is unchanged in space | Baseline lowered by microgravity; low specificity | ✅ Good vs **own in-flight baseline** |
| **Sleep** | Strong (cause and symptom) | Astronauts average ~6 h vs 8.5 h scheduled; ~75% used sleep meds | ✅ Very good (actigraphy) |
| Sweat cortisol | Direct hormone | Prototypes; some need visible sweat; not tested in space | 🔬 Early |
| Skin conductance (EDA) | Arousal spikes | Not a chronic marker | ⚠️ Medium |
| Pupil | Arousal | Camera + fixed light; astronaut eye changes (SANS) | ❌ Hard |
| Blood O₂ | Not a stress marker | Better for air/lung issues | ❌ Not for stress |
| EEG | Possible | Electrode cap, not daily | ❌ Not daily |
| Saliva cortisol + viral DNA | Direct (stress → virus chain) | Needs a lab, but saliva is easy to collect | ✅ Used on ISS & Artemis II |

---

## 6. Visible symptoms (the "effect" side)

- ISS medical records: **skin rashes** most common (1.12 per flight-year), then **upper respiratory symptoms** (0.97 per flight-year). 46% of crew reported a "notable" event.
- An HSV-1 rash lasting about 200 days, cold sores, and a case of **shingles**, where the astronaut's **vital signs stayed normal while they were sick**, so symptom logging matters.
- ⚠️ Confounder: fluid-shift symptoms (puffy face, headache, stuffy head) can look like illness.

---

## 7. Early infection warning from resting heart rate 🧑 ⭐⭐⭐

- Stanford smartwatch study: **81%** of COVID cases showed changes in HR, steps or sleep; **63% could have been flagged before symptoms** using resting-HR jumps vs the person's own baseline.
- Confounders: stress, intense exercise, alcohol, vaccination, **medications** (in space also the fluid shift), so the baseline must be set in flight.
- Deep-learning version: **LAAD** (LSTM autoencoder) flagged abnormal resting HR in 92% of cases.
- Limit for space: catches *symptomatic* infections, not silent viral shedding.

---

## 8. Wearables in space

**Already flown:**
- **Astroskin / Bio-Monitor (CSA, ISS since Dec 2018):** a smart shirt plus headband measuring 3-lead ECG, BP, SpO₂, breathing, skin temperature and activity, 48 h continuous; batteries every 48 h.
- **Garmin Fenix 7** on Polaris Dawn.
- **ARCHeR wristbands** on **Artemis II (April 2026):** sleep, stress, cognition, teamwork. Saliva samples were used for immune biomarkers and viral reactivation.
- ECG/heart-rate monitoring is the most consistently used wearable in NASA history.

**Remaining problems:** reliability under microgravity, radiation and temperature; **algorithms to fuse many signals**; wrist PPG is noisier than chest ECG; battery upkeep.

**Takeaway:** the hardware is mostly solved. **The software layer is the gap**, which is exactly this challenge.

---

## 9. Camera-based monitoring: remote PPG (rPPG) with near-infrared

- A camera detects tiny facial colour changes with each heartbeat, giving **HR, HRV and breathing** contact-free.
- **NIR:** less affected by lighting and dark skin tones, but a weaker signal and more motion-sensitive. **RGB + NIR fusion** is most robust.
- **In space:** only early tests. A Mayo Clinic/Oxehealth camera flew suborbital (pointed at a watch, not a human); NASA funded Intelomed for video-based iPPG. **Not yet validated on astronauts in orbit, which is an opportunity.**
- **Limits:** reads the **pulse, not vessel walls** (stiffness needs ultrasound; pulse transit time between two body sites is a partial proxy); floating astronauts move; the puffy face may shift the baseline (untested).
- **Hackathon-friendly:** laptop webcam + the open-source **rPPG-Toolbox**.

---

## 10. Facial expressions & micro-expressions

- ⚠️ A major review (Barrett 2019, 1,000+ findings): facial movements are **not reliable diagnostic signs of specific emotions** (people scowl when angry only about 25% of the time).
- ❌ **Micro-expressions:** weak evidence; the main training tool did no better than guessing. **Recommend dropping them.**
- ✅ **As one input in fusion it helps:** in video-meeting stress detection, rPPG alone 78.75%, facial features alone 73.75%, **combined 82.50%**.
- Safer approach: track **change in facial behaviour vs the person's own baseline**; don't label emotions.
- Space issues: the puffy face changes geometry (set the baseline in flight); astronauts are trained to stay composed (expressions can be masked).
- ⚖️ **Ethics:** the EU AI Act bans workplace emotion inference from biometrics **except for medical/safety purposes**. Frame the project as medical/safety and let the **crew own their data**.

---

## 11. Reusable pieces from earlier projects

| Earlier project | What carries over |
|---|---|
| Predictive health monitoring concept | Core architecture: wearable + lifestyle data fusion, optical sensing track (rPPG = that track) |
| Move for Health (14–21 days of smartwatch data + Excel tracker) | A real demo dataset for a "deviation from personal baseline" check |
| Mahidol melioidosis early-warning tool | Early warning → triage → human action; อสม. ↔ crew medical officer / flight surgeon; alert tiers |
| Medicine dispensing system | Medication log as context (sleep meds are common in space; meds make HR variable) |
| Diabetes project (glucose prediction with DL, monitoring requirements, optical/mid-IR) | Time-series prediction pipeline; "what to measure / thresholds" framework; glucose as a real space node (insulin resistance) |
| Deep learning study (PyTorch) | LAAD-style LSTM autoencoder as a stretch goal |
| Parkinsound | Haptic/vibration cue as a quiet, non-disruptive alert |

---

## 12. Open design questions (to answer before building)

1. Which **one or two signals** warn *before* an astronaut gets sick: causes (stress, radiation) or effects (viral shedding, resting-HR jump)?
2. What can a crew **log daily with no extra equipment**?
3. When the risk level rises, **what should the astronaut actually do differently?**
4. How do you tell **normal adaptation to space** (e.g. a smaller but healthy heart) from **something going wrong**?
5. How do you collect symptoms (rash, sore throat, fatigue) **without annoying a busy crew**?
6. Astronauts look at screens many times a day; how do you get a reading **with zero extra effort**?
7. If stress rises, **who sees it first: the astronaut or mission control?** Why?
8. Does adding glucose make the project **stronger, or spread it too thin** for 2 days?
9. If you could demo **only one working feature**, which shows the whole idea best?

---

## 13. Reading list

### 🔥 Read first (~1 hour)
1. **NASA – 5 Hazards of Human Spaceflight** — https://www.nasa.gov/hrp/hazards
2. **NASA Immune Risk page** (includes the **Immune Risk DAG**, NASA's own causal map) — https://www.nasa.gov/directorates/esdmd/hhp/immune-risk/
3. **Crucian et al. 2018 – Immune System Dysregulation During Spaceflight** (Frontiers in Immunology) — https://frontiersin.org/journals/immunology/articles/10.3389/fimmu.2018.01437/full

### 📚 Library by topic

**Stress → immune**
- Mehta et al. 2017 – Latent virus reactivation in astronauts on the ISS (npj Microgravity) — https://pmc.ncbi.nlm.nih.gov/articles/PMC5445581
- Salivary antimicrobial proteins & stress biomarkers on a 6-month ISS mission — https://pmc.ncbi.nlm.nih.gov/articles/PMC7864226
- NASA Evidence Report: Risk of Crew Adverse Health Event Due to Altered Immune Response (Crucian & Sams) — https://ntrs.nasa.gov/citations/20140002769

**Isolation**
- Klos et al. 2025 – Effects of ICE environments on the immune system: systematic review — https://pmc.ncbi.nlm.nih.gov/articles/PMC11975566/
- Ponomarev et al. 2021 – Immunological Aspects of Isolation and Confinement — https://pmc.ncbi.nlm.nih.gov/articles/PMC8264770
- Mars-500 CoSI study (isolation → chronic cortisol) — https://iafastro.directory/iac/paper/id/20164/abstract-pdf/IAC-13,A5,2,8,x20164.brief.pdf

**Radiation + microgravity**
- Wadhwa et al. 2024 – Synergistic interplay between radiation and microgravity (Immunity & Ageing) — https://immunityageing.biomedcentral.com/articles/10.1186/s12979-024-00449-w
- NASA poster – Immune dysregulation: spaceflight vs ground analogs ("continuum" figure) — https://ntrs.nasa.gov/api/citations/20200001675/downloads/20200001675.pdf
- Proton radiation + simulated microgravity on immune cells — https://pmc.ncbi.nlm.nih.gov/articles/PMC3743739/
- Hindlimb suspension + SPE-like radiation impairs bacterial clearance — https://www.pubmed.gov/24454913/
- Space radiation + social isolation in rats (Life 2025) — https://doaj.org/article/3ced14d5fd544cd29d2035dc98753f8c
- Zhang et al. 2017 – Microgravity + radiation on osteoclast fusion — https://pmc.ncbi.nlm.nih.gov/articles/PMC5713410
- Willey et al. – Ionizing radiation and bone loss — https://pmc.ncbi.nlm.nih.gov/articles/PMC3401480

**Microgravity → immune cells**
- Chang et al. – Spaceflight impairs T-cell tolerance; microgravity directly disrupts T-cell activation — https://pmc.ncbi.nlm.nih.gov/articles/PMC6137544

**Bone / muscle / osteoimmunology**
- Receptors implicated in microgravity-induced bone loss (MDPI) — https://mdpi.com/2813-2564/3/2/14
- Osteoclast-mediated bone disease & microgravity (Encyclopedia) — https://encyclopedia.pub/entry/2143
- IL-6 and spaceflight (npj Microgravity) — https://www.nature.com/articles/s41526-018-0057-9
- Twins Study landing re-analysis (muscle regeneration vs inflammation) — https://pmc.ncbi.nlm.nih.gov/articles/PMC9444344
- Inactivity amplifies muscle's catabolic response to cortisol (NTRS) — https://ntrs.nasa.gov/citations/20040141797
- 28-day bed rest with hypercortisolemia → insulin resistance — https://pmc.ncbi.nlm.nih.gov/articles/PMC2856785
- Muscle loss genetics in simulated microgravity (The Scientist) — https://www.the-scientist.com/zero-gravity-zero-gain-the-genetics-behind-muscle-loss-in-space-71612

**Cardiovascular**
- Effects of weightlessness on the cardiovascular system: meta-analysis (Frontiers 2024) — https://www.frontiersin.org/articles/10.3389/fphys.2024.1438089/full
- Norsk et al. 2015 – Fluid shifts & BP reduction in long spaceflight — https://www.physoc.org/?p=70744
- Perhonen et al. 2001 – Cardiac atrophy after bed rest and spaceflight — https://pubmed.ncbi.nlm.nih.gov/11457776/
- Cardiac effects of long-duration spaceflight (JACC 2023) — https://utsouthwestern.elsevierpure.com/en/publications/cardiac-effects-of-long-duration-space-flight
- Delp et al. 2016 – Apollo astronauts' CVD mortality & deep-space radiation — https://pmc.ncbi.nlm.nih.gov/articles/PMC4964660/
- Arterial structure & function during and after long spaceflight (2020) — https://pesquisa.bvsalud.org/portal/resource/e/mdl-32525433
- Arteries normal 5 years after spaceflight (APS 2025) — https://www.physiology.org/detail/news/2025/07/24/good-news-for-astronauts--arteries-remain-normal-years-after-long-duration-spaceflight
- CSA Vascular Series (stiffness + insulin resistance) — https://revibiomedica.sld.cu/index.php/ibi/article/download/250/386

**Stress signals: HRV, sleep, sweat**
- Mental stress & autonomic cardiac modulation in weightlessness — https://bvbvf1.bib-bvb.de/vufind/PrimoRecord/cdi_proquest_miscellaneous_734199460
- Autonomic function in spaceflight review — https://pmc.ncbi.nlm.nih.gov/articles/PMC4465859
- Barger et al. 2014 – Sleep deficiency & hypnotic use in astronauts (Lancet Neurology) — https://pmc.ncbi.nlm.nih.gov/articles/PMC4188436
- Wearable molecularly imprinted sweat-cortisol sensor (Biosensors 2025) — https://pmc.ncbi.nlm.nih.gov/articles/PMC11940103

**Symptoms (what happens to crews)**
- Crucian et al. 2016 – Incidence of clinical symptoms during long-duration ISS flight — https://pmc.ncbi.nlm.nih.gov/articles/PMC5098747
- HSV-1 dermatitis during long-duration spaceflight — https://pmc.ncbi.nlm.nih.gov/articles/PMC9028032
- Shingles in an ISS astronaut — https://pmc.ncbi.nlm.nih.gov/articles/PMC10992860/

**Wearables**
- Wang et al. 2025 – Flexible wearables for astronaut health: status & challenges — https://doi.org/10.1016/j.wees.2024.12.007
- CSA Bio-Monitor / Astroskin — https://www.asc-csa.gc.ca/eng/sciences/astroskin.asp
- Wearables used in space missions (TrialX) — https://trialx.com/space-health-research-wearable-devices/
- Artemis II ARCHeR wristbands — https://www.newsbytesapp.com/news/science/nasa-s-artemis-ii-astronauts-to-wear-special-wristband-monitors/story

**Camera / rPPG / NIR**
- Nowara et al. – Near-infrared imaging PPG during driving (MERL) — https://shadow.merl.com/publications/docs/TR2020-161.pdf
- RGB-NIR dual-modality heart-rate estimation (Sensors 2023) — https://pmc.ncbi.nlm.nih.gov/articles/PMC10346879
- RePSS RGB+NIR fusion challenge — https://ceur-ws.org/Vol-4095/paper1.pdf
- Full-body rPPG & pulse transit time (arXiv) — https://ar5iv.labs.arxiv.org/html/2303.09638
- Mayo Clinic hands-free camera in space — https://newsnetwork.mayoclinic.org/discussion/mayo-clinic-researchers-to-study-if-hands-free-camera-in-space-can-monitor-vital-signs
- Intelomed NASA video-based vital signs project — https://us.inspiralia.com/our-work-list/intelomed-inc/

**Facial expression & stress**
- Barrett et al. 2019 – Emotional Expressions Reconsidered — https://pmc.ncbi.nlm.nih.gov/articles/PMC6640856
- Micro-expressions training tool fails (phys.org) — https://phys.org/news/2019-09-flaws-tool.pdf
- Stress from rPPG + facial features in online meetings (JYU) — https://jyx.jyu.fi/bitstreams/804b9777-c9ad-4832-aa67-cbc789d034f4/download
- Facial videos + biosignals for stress estimation (arXiv 2026) — https://arxiv.org/html/2601.04376v2
- EU AI Act emotion-recognition prohibition explained (FPF) — https://fpf.org/blog/red-lines-under-eu-ai-act-unpacking-the-prohibition-of-emotion-recognition-in-the-workplace-and-education-institutions/

**Early infection detection**
- Mishra et al. 2020 – Pre-symptomatic COVID-19 detection from smartwatch data — https://bohrium.dp.tech/paper/arxiv/565ddbdf6dd250a4a1a24832b221d0cbf76f9e38e192400ab71d148581f79a7d
- Stanford Medicine – Smartwatch can detect early signs of illness — https://med.stanford.edu/news/all-news/2020/12/smartwatch-can-detect-early-signs-of-illness.html
- LAAD – deep learning on resting HR for early infection (medRxiv) — https://www.medrxiv.org/content/10.1101/2021.01.08.21249474.full.pdf

**Big picture**
- NASA Twins Study (Science 2019) — https://pmc.ncbi.nlm.nih.gov/articles/PMC7580864
- Astroimmunology review (Nat Rev Immunol 2025) — https://vivo.weill.cornell.edu/display/pubid41102553
- Inspiration4 crew multi-omics & immune profiles — https://pmc.ncbi.nlm.nih.gov/articles/PMC11166952

---

### 📝 How to read papers fast
Read the **abstract**, then the **figures**, then the **conclusion**. Skip the methods unless you need a specific number.

### ⚠️ Space Apps rule
**All resources used must be cited**, even open-source ones, or the team can lose nominations or awards. This file doubles as your reference list.
