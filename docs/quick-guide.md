# NASA Space Apps 2026 – Team Writing Guide (Components, Formulas, Sources)

Nov 15, 2026 · @Trin Vejakron

## How to use this guide

Each component below says what it does, how it works, the formula, why it matters, its limits and its source. Copy sentences into the submission form and keep the numbers and the (R#) tags; the tags point to the References section at the end.

**Scope.** The current draft covers stress and sleep. The earlier plan (bone, muscle, immune and heart risk, nutrition, radiation) is future work: mention it in one sentence and do not build it into the claims.

**Rules for every teammate**

- Write only what we built or designed, and say which. Use three labels: Built, Designed, Future work.
- Say “risk indicator” or “early warning”. Never “diagnose”, and never claim to detect anxiety or depression.
- Label all sample data “simulated”. Daily in-flight astronaut data is not public, so simulated data is normal as long as it is labelled.
- Every number needs a source tag such as (R1). NASA can remove entries that do not cite references properly (R21).
- Numbers we chose ourselves (weights, thresholds, windows) are “starting values, not clinically validated”. They are listed in the cheat sheet near the end.
- Write in English, in short sentences.

**Status board (fill in)**

| Component | Status (Built / Designed / Future) | Owner |
| --- | --- | --- |
| 1 Wearable sensors |  |  |
| 2 Data intake and cleaning |  |  |
| 3 Feature extraction |  |  |
| 4 Personal baseline |  |  |
| 5 Stress score |  |  |
| 6 Sleep-quality score |  |  |
| 7 Early warning, advice, emergency guide |  |  |
| 8 Facial scan (optional) |  |  |
| 9 Privacy and crew-first sharing |  |  |
| 10 Daily report and app screens |  |  |

## Big picture: how data flows from sensor to alert

The app turns raw body signals into two daily scores and a plain-language warning. Each step below is one component in this guide.

1. **Wearables record** heart rate and beat-to-beat intervals, skin conductance, blood oxygen, movement and blood pressure (Component 1).
2. **Intake** timestamps every reading and stores it on the device first, then syncs when the link allows (Component 2).
3. **Cleaning** removes bad beats, motion noise and gaps, and scores data quality (Component 2).
4. **Features** reduce each window or night to a few numbers such as RMSSD, resting heart rate, skin conductance level, total sleep time (Component 3).
5. **Baseline** compares today with the astronaut’s own last 14 days and gives z-scores (Component 4).
6. **Scores** combine the z-scores into a stress score and a sleep-quality score, each 0–100 (Components 5 and 6).
7. **Warning** turns a score into Green, Yellow or Red, with why it happened, what to do, and when to ask for help (Component 7).
8. **Crew-first sharing** shows the astronaut every alert first; the astronaut decides what goes to mission control (Component 9).
9. **Daily report** shows it all in the Health tab, with raw values kept in the Log tab (Component 10).

One line to remember: **own baseline in, explained risk indicator out.**

## Fix list: problems in the current draft text

Ten changes will make the draft more accurate and closer to what the judges asked for. Do these first.

| # | Where | Problem | Fix |
| --- | --- | --- | --- |
| 1 | Summary, Q1 | Says the wearables “continuously measure” blood pressure. Cuffless estimates need calibration and are not recommended for clinical use (R15, R16). | “Blood pressure is used as a trend against the astronaut’s own baseline, from a cuff reading or a calibrated sensor.” |
| 2 | Q1 | Says data is analysed with machine learning. Our scoring is a personal baseline plus weighted rules. | Say “statistical personal baseline and rule-based scoring; machine learning is future work”, unless ML is really in the code. |
| 3 | Q1 | Mentions “sleep stages”. Wearable light, deep and REM estimates have unclear research value; sleep-wake and total sleep time are reliable (R11). | Lead with sleep duration, efficiency and awakenings. Call stages “estimates”. |
| 4 | Summary, Q4 | Facial scans appear only in Q4. | If built, add to Summary and Q1. If not, say “planned” (Component 8). |
| 5 | Q2 | “Identify problems caused by psychology disorders, such as anxiety or depression” breaks our no-diagnosis rule. | “Spot early signs of rising stress and poor sleep, which NASA links to behavioural-health and performance risk (R3, R2).” |
| 6 | Q3 | Empty. | List only the tools we really used (see the question guide). |
| 7 | Q5 | “When doctors experience physical or mental health concerns” is a wording error. | “When astronauts have concerns and Earth-based doctors are delayed or out of reach.” |
| 8 | Whole draft | Two judge requirements are missing: what to do in an emergency, and how to use each tool, why it matters and how to fix it. | Add a paragraph to Q1 about the Emergency guide and the tool guide (Components 7 and 10). |
| 9 | Whole draft | No mention of simulated data or references. | Add “the demo uses simulated data” and cite sources with (R#). |
| 10 | Summary | “Providing astronauts and Mission control insights” conflicts with crew-first sharing. | “The astronaut sees every alert first and chooses what goes to mission control.” |

## Component 1: Wearable sensors

**What it does.** Records the body signals the app needs. Each signal answers one question about stress or rest.

| Signal | Question it answers | Sensor | Main limit |
| --- | --- | --- | --- |
| Heart rate and beat-to-beat (RR) intervals | How fast is the heart, and how variable is the rhythm? Low variability points to stress or poor recovery. | Optical (PPG) on wrist or finger, or an ECG patch | Motion noise; wrist PPG is weaker when the person moves |
| Skin conductance (EDA) | Is the sympathetic (“fight or flight”) system aroused? | Two electrodes on the skin | Heat, sweat and exercise look like stress |
| Blood oxygen (SpO2) | Does oxygen drop, for example during sleep? | Optical, red plus infrared light | Skin tone, motion and poor blood flow add error |
| Blood pressure | Is pressure drifting from this person’s normal? | Cuff (accurate) or cuffless estimate | Cuffless devices need calibration |
| Movement (accelerometer) | Is the person asleep or awake, still or restless? | Motion sensor in the watch or ring | Cannot separate quiet wake from sleep perfectly |

**How it is handled.**

- Heart rhythm, EDA and movement are the core stress-and-sleep signals.
- SpO2 is a safety flag during sleep. It is not part of the stress score.
- Blood pressure has the lowest weight and is used only as a trend, or from a periodic cuff reading.

**Why it matters.** Stress and poor sleep do not show up in one number. Heart rhythm and sweat-gland activity are two different parts of the autonomic nervous system, and both are standard stress measures (R6, R8). When both move the same way, the warning is more trustworthy.

**Accuracy evidence to quote.**

- A 2025 review found wearables track heart rate reliably, while accuracy for sleep, stress and blood pressure is uneven (R17).
- The European Society of Hypertension 2021 guidelines do not recommend cuffless blood-pressure devices for clinical use (R15).
- A meta-analysis found wearable SpO2 error above the 3% regulatory threshold in light, medium and dark skin groups, while wearable pulse rate showed no skin-tone bias (R13).
- One wrist device met the 3.5% error limit (2.4% RMS), but only with no motion and good blood flow (R14). Sleep is a no-motion condition, so night-time SpO2 is a fair use.

**Limits.** Wearables are less accurate than medical equipment and can be unstable. We state this in Question 5.

> **Write this:** “The app reads heart rhythm, skin conductance and movement as its core signals, and uses blood oxygen as a safety flag during sleep and blood pressure as a low-weight trend. We chose these because they reflect different parts of the autonomic nervous system and are standard stress measures (R6, R8).”

## Component 2: Data intake and cleaning

**What it does.** Moves readings from the wearable to the app and removes bad data before any score is computed.

**How it works**

1. **Receive.** Each reading gets a timestamp, device id, signal type and unit. It is stored on the device first (offline-first) and synced later, because space links can be delayed or cut.
2. **Window.** Heart-rhythm data is cut into 5-minute windows, the standard short-term length (R6). Sleep is kept as one record per night.
3. **Clean heart rhythm.** Drop RR intervals outside 300–2000 ms, and beats that differ by more than 20% from their neighbours (team-chosen rules).
4. **Clean EDA.** Drop flat or saturated stretches and windows with high movement.
5. **Clean SpO2.** Treat values below 70% or above 100% as sensor error (team choice).
6. **Score quality.** If too little of a window is valid, ignore it. If too few windows are valid, show “not enough data”. Never fill a gap with a made-up number.

```latex
Q = \frac{N_{\text{valid}}}{N_{\text{expected}}}, \qquad \text{ignore the window if } Q < 0.70
```

**Why it matters.** RMSSD squares every beat-to-beat difference, so one false beat can dominate the result. Cleaning protects the score. Motion artifacts are a known weakness of optical sensors (R12).

> **Write this:** “Readings are stored locally first, cut into 5-minute windows, cleaned of motion noise and false beats, and given a quality score. Windows below the quality limit are ignored and shown as ‘not enough data’.”

## Component 3: Feature extraction (the formulas)

**What it does.** Reduces each cleaned window or night to a few numbers called features. Every score later is built from them.

**Heart rhythm.** RR is the time between beats in milliseconds. N is the number of RR intervals in the window.

```latex
\text{HR} = \frac{60000}{\overline{RR}} \ \text{(bpm)}
```

```latex
\text{RMSSD} = \sqrt{\frac{1}{N-1}\sum_{i=1}^{N-1}\left(RR_{i+1}-RR_i\right)^2} \ \text{(ms)}
```

```latex
\text{SDNN} = \sqrt{\frac{1}{N-1}\sum_{i=1}^{N}\left(RR_i-\overline{RR}\right)^2} \ \text{(ms)}
```

RMSSD measures short-term variability and mainly reflects the parasympathetic (“rest and digest”) branch. Lower RMSSD means more stress or less recovery (R6, R7). Use resting, low-movement windows only, because exercise also lowers RMSSD.

**Skin conductance (EDA).** The signal has a slow tonic part and fast phasic peaks (R8, R9). Use the term “skin conductance”, not “GSR” (R8).

- **SCL** = mean skin conductance in the window, in microsiemens (µS).
- **SCR rate** = number of skin conductance response peaks per minute.

```latex
\text{SCR rate} = \frac{N_{\text{peaks}}}{T_{\text{min}}}
```

The rule for what counts as a peak varies between studies (R9), so write down the threshold we use.

**Sleep.** Definitions follow wearable-sleep research (R10, R11).

```latex
\text{TIB} = t_{\text{rise}} - t_{\text{bed}}
```

```latex
\text{TST} = \text{TIB} - \text{SOL} - \text{WASO} - T_{\text{end}}
```

```latex
\text{SE} = \frac{\text{TST}}{\text{TIB}} \times 100\%
```

```latex
\text{Midpoint} = \frac{t_{\text{onset}} + t_{\text{offset}}}{2}
```

TIB is time in bed. SOL is sleep onset latency (minutes from bedtime to sleep). WASO is wake after sleep onset (minutes awake during the night). T\_end is minutes awake in bed after the final waking. TST is total sleep time. SE is sleep efficiency. The efficiency denominator differs between tools (R10, R11), so state which one we use.

**Blood oxygen at night.** Keep the mean and the minimum SpO2 per night.

| Feature | Unit | Worse when | Source |
| --- | --- | --- | --- |
| Resting heart rate | bpm | higher | R17 |
| RMSSD | ms | lower | R6, R7 |
| SCL | µS | higher | R8 |
| SCR rate | peaks/min | higher | R8, R9 |
| Systolic blood pressure | mmHg | higher (trend only) | R15 |
| Total sleep time | min | lower | R10 |
| Sleep efficiency | % | lower | R10, R11 |
| WASO | min | higher | R10, R11 |
| Sleep midpoint shift | min | larger | R10 |

> **Write this:** “For each window the app computes heart rate, RMSSD and skin conductance level and response rate. For each night it computes total sleep time, sleep efficiency and time awake after sleep onset, using standard definitions (R6, R8, R10).”

## Component 4: Personal baseline

**What it does.** Learns what “normal” looks like for each astronaut, then measures today against it instead of against a population average.

**How it works**

1. **Baseline window.** The previous 14 days, not including today (team choice).
2. **Cold start.** Until 5 valid days exist, show raw values and “learning your baseline”, with no score (team choice).
3. **Standardise** each feature with a z-score: how many standard deviations today is from the astronaut’s own mean.
4. **Robust option.** Use the median and MAD so one odd day does not distort the baseline (R26).
5. **Direction.** Flip the sign where lower is worse, so a bigger number always means worse.
6. **Clip** to the range −3 to +3 so one outlier cannot dominate.

```latex
z = \frac{x - \mu}{\sigma}
```

```latex
z_r = 0.6745 \cdot \frac{x - \text{median}}{\text{MAD}}, \qquad \text{MAD} = \text{median}\left(|x_i - \text{median}|\right)
```

```latex
d = \begin{cases} +z & \text{if higher is worse (HR, SCL, SCR rate, WASO, BP)} \\ -z & \text{if lower is worse (RMSSD, TST, SE)} \end{cases}, \qquad d \in [-3, +3]
```

**Why it matters.** People differ a lot. NASA’s sleep evidence report notes individual differences in sleep need and in how people respond to sleep loss (R2), and healthy HRV values vary widely between people (R7). The same reading can be normal for one astronaut and a warning for another.

**Limits.** A rolling baseline can slowly absorb a gradual decline. Suggested fix (a design choice): also compare with the astronaut’s first-week baseline of the mission.

> **Write this:** “The app learns each astronaut’s own baseline from their last 14 days and measures every new reading against it, because individual differences in sleep and stress response are large (R2).”

## Component 5: Stress score

**What it does.** Produces one stress risk indicator from 0 to 100 per day. A score of 50 means the astronaut’s own normal.

**How it works.** Take the direction-adjusted z-scores d from Component 4, weight them, and scale.

```latex
S = \text{clip}\left(50 + 15 \sum_k w_k\, d_k,\ 0,\ 100\right)
```

| Feature | d meaning | Weight w | Why this weight |
| --- | --- | --- | --- |
| RMSSD | −z (lower is worse) | 0.35 | Main marker of the rest-and-digest branch (R6, R7) |
| Resting heart rate | +z | 0.20 | Measured reliably by wearables (R17) |
| SCR rate | +z | 0.20 | Sympathetic arousal (R8, R9) |
| SCL | +z | 0.15 | Slow arousal level (R8) |
| Systolic blood pressure | +z | 0.10 | Lowest weight: cuffless accuracy is weak (R15, R16) |

The weights add up to 1.00. If every feature is 2 standard deviations worse than the astronaut’s normal, S = 50 + 15 × 2 = 80.

| Level | Score | Meaning |
| --- | --- | --- |
| Green | below 60 | Within the astronaut’s usual range |
| Yellow | 60 to 74 | Watch: show tips |
| Red | 75 or more | Early warning: show advice and when to ask for help |

**Rules that prevent false alarms**

- Use only low-movement windows, because exercise and heat raise heart rate and skin conductance.
- Alert only if the level is Yellow or Red on 2 days in a row, or Red once with at least two of RMSSD, SCR rate and heart rate each at d ≥ 1.0.
- Always show the two features that pushed the score most. That is the “why”.

**Why it matters.** NASA lists adverse cognitive and behavioural conditions as a risk of long missions, and the likelihood grows with mission length (R3, R4). An early signal gives time to act before performance suffers.

**Limits.** The weights and thresholds are starting values chosen by the team, not clinically validated. The score is a risk indicator, not a diagnosis.

> **Write this:** “The stress score combines five signals, each compared with the astronaut’s own baseline and weighted by how reliable it is. Heart-rate variability and skin conductance carry the most weight because they are standard measures of autonomic stress response (R6, R8). The result is a risk indicator, not a diagnosis.”

## Component 6: Sleep-quality score

**What it does.** Produces a sleep-quality indicator from 0 to 100 for each night, using numbers a wearable measures reliably.

**How it works**

```latex
\text{Sleep score} = 100 \times \left(0.40\, f_{dur} + 0.30\, f_{eff} + 0.15\, f_{wake} + 0.15\, f_{reg}\right)
```

```latex
f_{dur} = \min\!\left(\frac{\text{TST}}{420},\, 1\right), \quad f_{eff} = \min\!\left(\frac{\text{SE}}{85},\, 1\right), \quad f_{wake} = 1 - \min\!\left(\frac{\text{WASO}}{60},\, 1\right), \quad f_{reg} = 1 - \min\!\left(\frac{|\Delta \text{midpoint}|}{120},\, 1\right)
```

TST and WASO are in minutes. SE is in percent. Δmidpoint is how many minutes tonight’s sleep midpoint differs from the astronaut’s baseline midpoint.

| Part | Weight | What it checks | Where the target comes from |
| --- | --- | --- | --- |
| f\_dur | 0.40 | Enough sleep | 420 min = 7 h, the recommended minimum for a healthy adult (R20). NASA schedules 8.5 h (R1). |
| f\_eff | 0.30 | Share of time in bed spent asleep | 85% is a team-chosen target. Check a sleep source before quoting it as a standard. |
| f\_wake | 0.15 | Broken sleep | 60-minute cap (team choice) |
| f\_reg | 0.15 | Stable timing | 120-minute cap (team choice). Circadian misalignment is documented in spaceflight (R2). |

| Level | Score |
| --- | --- |
| Good | 80 or more |
| Fair | 60 to 79 |
| Poor | below 60 |

**Baseline rule.** Warn if total sleep time is at least 1 standard deviation below the astronaut’s own mean (d\_TST ≥ 1.0) on 2 nights, or if sleep is Poor on 3 of 5 nights.

**Sleep stages.** Wearables estimate light, deep and REM sleep, but the value of those estimates for research is unclear. Sleep-wake detection and total sleep time are reliable (R11, R12). Show stages only as “estimates” and keep them out of the score.

**Extra items for the Log tab.** Sleep aid taken (yes or no), and a note on noise, light or temperature. Three quarters of ISS crew members reported taking sleep medication at some point, and the researchers worried about waking to an emergency alarm under its effect (R1). Light, noise and temperature are known sleep disruptors in space (R5).

**Why it matters.** Astronauts sleep about 6 hours a night in flight against 8.5 scheduled (R1). NASA’s evidence report links sleep loss to performance decrements and adverse health outcomes (R2).

**Limits.** Weights and caps are starting values, not validated. Wearable sleep metrics are less accurate on nights with low sleep efficiency (R12).

> **Write this:** “The sleep score combines total sleep time, sleep efficiency, time awake during the night and timing regularity. Astronauts average about 6 hours in flight against 8.5 scheduled (R1), so the app tracks each astronaut’s sleep against their own baseline and warns early.”

## Component 7: Early warning, advice and emergency guide

**What it does.** Turns each score into a message the astronaut can act on. This covers two judge requirements: what to do in an emergency, and how to fix a problem.

**Every alert has four parts**

1. What changed, in numbers against the astronaut’s own baseline.
2. Why it may matter, in one sentence.
3. What to do now, in short steps.
4. When to ask for help.

> **Example alert.** Yellow, stress. Your heart-rate variability is 29% lower and your skin-conductance peaks are 60% more frequent than your 14-day normal. Stress and short sleep can slow decisions. Try 5 minutes of slow breathing and a short break, then log how you feel. If tomorrow is also Yellow, consider talking with your crew psychologist or flight surgeon.

(Check: 30 ms against 42 ms is 28.6% lower. 3.2 against 2.0 peaks per minute is 60% more.)

**Advice library**

| Trigger | What the app says | Suggested action | Source |
| --- | --- | --- | --- |
| Stress Yellow | Variability lower and arousal higher than usual | 5 minutes of slow breathing, short break, check workload, log mood | Design choice; behavioural-health risk (R3) |
| Stress Red, or Yellow two days | Stress has stayed high | Talk with a crew member or book a private conference; choose whether to share the alert | R3 |
| Sleep Poor for 3 nights | Sleep has been short or broken | Keep sleep timing regular, reduce light, noise and temperature problems, avoid blue light before bed, note any sleep aid | R1, R5, R23 |
| After waking | Sleep-inertia reminder | Allow time before critical tasks: ground studies show 2 to 4 hours to reach best performance after waking | R2 |
| Night SpO2 low | Oxygen reading is low | Refit the sensor and measure again awake; if still low, contact the flight surgeon. Do not self-diagnose. | R13, R14 |
| Sensor lost | No data | Reseat or charge the sensor; show the time of the last good reading | None |

**Emergency guide.** Step cards that work offline and do not depend on a score. Each card is short and ends with who to contact.

- Severe distress or unsafe behaviour: stay with another crew member and contact the flight surgeon or mission control.
- Several nights of almost no sleep with signs of impaired performance: stop critical tasks and tell the commander or flight surgeon.
- Confirmed low oxygen reading: follow the vehicle’s procedures and contact the flight surgeon.

The card text is example content for the demo. Real procedures belong to NASA flight surgeons, and medical professionals should review them.

**Why it matters.** With communication delays, the astronaut may need to act before Earth can answer. Clear steps reduce the time between a warning and an action.

> **Write this:** “Every warning says what changed against the astronaut’s own baseline, why it matters, what to do now and when to ask for help. A separate emergency guide gives short offline step cards that end with who to contact. The app gives risk indicators, not diagnoses.”

## Component 8: Facial scan (optional)

Our Question 4 text mentions facial scans. Label this component Built, Designed or Future work in the status board, and say the same in the form.

**What it does.** A 30-second camera check that estimates the pulse from tiny colour changes in the skin of the face. This is called remote photoplethysmography (R19). It is a back-up when the wearable is off.

**How it works**

1. Record 30 seconds of face video in steady light.
2. For each frame, average the green-channel brightness over a patch of skin.
3. Band-pass the signal between 0.7 and 4 Hz (42 to 240 beats per minute).
4. Find the strongest frequency and convert it to beats per minute.

```latex
\text{HR}_{\text{face}} = 60 \times f_{\text{peak}} \quad (f_{\text{peak}} \text{ in Hz})
```

**How it is handled.** The face pulse can stand in for the wearable heart rate when that is missing, and it is flagged “lower confidence”. It has no weight of its own in the stress score. Video is processed on the device and not stored.

**Do not claim emotion reading.** Research reviews conclude that facial movements do not reliably reveal a person’s inner emotional state (R24). Describe the feature as “pulse from the face”, not “stress from facial expression”.

**Limits.** Lighting, movement and skin tone affect accuracy, and it is less accurate than a contact sensor.

> **Write this (only if built):** “An optional 30-second camera check estimates pulse from tiny colour changes in the face (R19) and backs up the wearable when it is off. It runs on the device and stores no video.”

## Component 9: Privacy and crew-first sharing

**What it does.** The astronaut sees every alert first and chooses what goes to mission control.

**How it works**

- All data stays on the device. The Log tab’s raw data leaves the device only if the astronaut exports it.
- Every alert has a share choice: share summary, share details, or keep private.
- Mission control sees only what was shared, with a note of when it was shared.

**Decide as a team (open question).** Should the app notify the flight surgeon automatically if a Red alert lasts several days, or if an emergency card is opened? Pick one answer and write it in the form.

**Why it matters.** With communication delays, the crew needs tools that work without Earth. A review of wearable astronaut monitoring names privacy, device stability and data integration as the main challenges (R25).

**Limits.** The demo does not implement real security such as encryption or access control. Say “designed”, not “built”, unless it exists.

> **Write this:** “The astronaut sees every alert first and decides what to share with mission control. Data is stored on the device, so the tool works during communication delays.”

## Component 10: Daily report and app screens

**What it does.** Shows the results on three screens that match the Figma wireframes.

| Screen | Shows | Judge requirement |
| --- | --- | --- |
| Health tab | Stress score, sleep score, traffic-light level, 14-day trend, “why” card, today’s advice | Track health data |
| Log tab | Raw daily values (sleep times, heart rate, EDA, SpO2, blood pressure) and manual entries (sleep aid, mood, notes) | Track health data |
| Emergency and Help tab | Offline emergency step cards and the tool guide | Emergency steps; explain each tool |

**The daily report contains**

- Date, with a “simulated data” badge when the data is simulated.
- Sleep score and level, with total sleep time, efficiency and time awake.
- Stress score and level, with the top two reasons.
- Arrows showing change against the last 7 days.
- A data-quality line, for example “82% of readings valid”.
- Today’s advice and the share choice.

**Tool guide** (this answers the judges’ third requirement: how to use it, why it matters, how to fix it)

| Tool | How to use it | Why it matters | If it fails |
| --- | --- | --- | --- |
| Wearable (watch or ring) | Wear snug on the same wrist day and night; charge at a fixed time | Gives heart rhythm, movement and SpO2 | Re-seat, clean the back sensor, charge, restart. The app shows the last good reading. |
| EDA electrodes | Place on clean, dry skin in the same spot each day | Shows sympathetic arousal | Noisy or flat signal: clean, dry and re-place. Ignore readings right after exercise. |
| Blood pressure | Take a cuff reading at the same time each day, seated and rested | Gives a trend against the astronaut’s own baseline | Odd value: rest 5 minutes and repeat |
| Log tab | Add sleep aid and notes each morning | Adds context to the scores | Missed day: add it later; it is marked as a late entry |
| Health tab | Read the colour, then the “why” card | Shows the early warning | Unclear colour: open the Log tab to see raw values |
| Emergency guide | Open from any screen | Works offline, step by step | Unsure which card: start with the contact list |

> **Write this:** “Three screens: a Health tab with scores, trends and reasons; a Log tab with raw daily data and notes; and an Emergency and Help tab with offline step cards and a guide for every tool: how to use it, why it matters and how to fix it.”

## Worked example with real numbers

One simulated astronaut-day, calculated by hand. Use it in the demo and the slides. All values are simulated.

**Step 1: RMSSD from four beats.** RR intervals: 800, 810, 790, 805 ms (a toy window; real windows have hundreds of beats).

```latex
\text{Differences: } +10,\ -20,\ +15 \qquad \text{Squares: } 100,\ 400,\ 225 \qquad \text{Sum} = 725
```

```latex
\text{RMSSD} = \sqrt{\frac{725}{3}} = \sqrt{241.67} = 15.55 \text{ ms}
```

```latex
\overline{RR} = \frac{800+810+790+805}{4} = 801.25 \text{ ms}, \qquad \text{HR} = \frac{60000}{801.25} = 74.9 \text{ bpm}
```

**Step 2: stress score.** Baseline values come from the astronaut’s last 14 days. For each feature, z = (today − mean) / SD, then d = z, or −z for RMSSD.

| Feature | Today | Baseline mean | SD | z | d | Weight | Weight × d |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RMSSD | 30 ms | 42 | 6 | −2.0 | +2.0 | 0.35 | 0.70 |
| Resting HR | 68 bpm | 62 | 3 | +2.0 | +2.0 | 0.20 | 0.40 |
| SCR rate | 3.2 /min | 2.0 | 0.8 | +1.5 | +1.5 | 0.20 | 0.30 |
| SCL | 6.0 µS | 5.0 | 1.0 | +1.0 | +1.0 | 0.15 | 0.15 |
| Systolic BP | 123 mmHg | 118 | 5 | +1.0 | +1.0 | 0.10 | 0.10 |

```latex
\sum w\,d = 0.70 + 0.40 + 0.30 + 0.15 + 0.10 = 1.65 \qquad S = 50 + 15 \times 1.65 = 74.75
```

Result: Yellow, 0.25 points below the Red line. The top two reasons are RMSSD and resting heart rate.

**Step 3: sleep score.** Bedtime 23:00, final rise 06:30, SOL 30 min, WASO 50 min, 5 min awake in bed after the last waking, and sleep midpoint 30 min later than baseline.

```latex
\text{TIB} = 450 \text{ min}, \qquad \text{TST} = 450 - 30 - 50 - 5 = 365 \text{ min (6 h 05 min)}
```

```latex
\text{SE} = \frac{365}{450} \times 100 = 81.1\%
```

```latex
f_{dur} = \frac{365}{420} = 0.869, \quad f_{eff} = \frac{81.1}{85} = 0.954, \quad f_{wake} = 1 - \frac{50}{60} = 0.167, \quad f_{reg} = 1 - \frac{30}{120} = 0.75
```

```latex
\text{Score} = 100 \times (0.3476 + 0.2863 + 0.0250 + 0.1125) = 77.1
```

Result: Fair (60 to 79). Baseline check: with a baseline TST of 408 min and SD of 30 min, z = (365 − 408) / 30 = −1.43, so d = +1.43. That is above 1.0 for one night. A second night in a row triggers the warning.

**Step 4: the message the astronaut sees.** Yellow stress (74.75) plus Fair sleep with total sleep 1.4 SD below normal: “Recovery looks low today. Heart-rate variability is down and sleep was short. Take a short break, try slow breathing, and protect tonight’s sleep.”

## Knowledge base: facts you can cite

Every row is safe to use in the form if you keep the source tag. Rows marked “check” need a second look at the original before quoting.

| Topic | Fact | Source |
| --- | --- | --- |
| Sleep in flight | NASA schedules 8.5 hours of sleep a night. Mean actual sleep was 5.96 h on shuttle missions and 6.09 h on ISS missions. | R1 |
| Long sleep episodes | Sleep episodes of 7 hours or more happened 12% of the time on shuttle missions and 24% on the ISS, against 42% and 50% after the mission. | R1 |
| Before launch | Crew averaged under 6.5 hours a night in the training period about 3 months before flight. | R1 |
| Sleep medication | 75% of ISS crew and 78% of shuttle crew reported taking sleep medication in flight; shuttle crew used it on 52% of nights. | R1 |
| Study size | 85 astronauts (64 shuttle, 21 ISS), over 4,200 nights in space and over 4,000 on Earth, with wrist actigraphs and sleep diaries. | R1 |
| NASA risk: sleep | Sleep loss is apparent in spaceflight and its cause is unknown. On the ground it is linked to performance impairment and health consequences. | R2 |
| Sleep inertia | Ground studies show 2 to 4 hours to reach best performance after waking. It is risky when an emergency wakes the crew. | R2 |
| Circadian rhythm | Circadian desynchrony has been observed in spaceflight. The ISS crew sees about 16 sunrises and sunsets a day (check). | R2, R22 |
| Sleep disruptors | Noise, temperature, vibration and light inhibit sleep in space. | R5 |
| NASA risk: behaviour | Isolation and confinement can reduce cognitive and behavioural functioning. ISS countermeasures have mainly succeeded. | R4 |
| Mission length | The likelihood of an adverse cognitive or behavioural condition grows with mission length. | R3 |
| Workload | Nominal crew workday is 6.5 hours and at most 48 hours a week. Overload is 10-hour days on 3 days a week, or over 60 hours a week (check in NASA-STD-3001 Volume 1). | R22 |
| HRV standard | The 1996 Task Force defined time- and frequency-domain HRV measures. RMSSD is a short-term variability measure. | R6, R7 |
| Skin conductance | EDA has a slow tonic level (SCL) and fast phasic responses (SCR). | R8, R9 |
| Wearable accuracy | Wearables track heart rate reliably; accuracy for sleep, stress and blood pressure is uneven. | R17 |
| Cuffless blood pressure | Not recommended for clinical use by the 2021 ESH guidelines; needs calibration. | R15, R16 |
| Wearable SpO2 | RMS error 3.96% (light), 4.71% (medium) and 4.15% (dark pigmentation) against a 3% threshold. Wearable pulse rate showed no skin-tone bias. | R13 |
| Wearable sleep | Sleep-wake and total sleep time are reliable; stage estimates have unclear research value. | R11, R12 |
| Adult sleep need | At least 7 hours for a healthy adult (check the original). | R20 |

## Cheat sheet: every number we chose ourselves

Write these as “starting values, not clinically validated”. Tune them on the simulated data so that most days come out Green. If someone changes a value, change it here and in the code, and tell the whole team.

| Parameter | Value | Component | Origin |
| --- | --- | --- | --- |
| Heart-rhythm window | 5 minutes | 2 | Standard short-term length (R6) |
| Valid RR range | 300 to 2000 ms | 2 | Team choice |
| Beat rejection | More than 20% from neighbours | 2 | Team choice |
| SpO2 error range | Below 70% or above 100% | 2 | Team choice |
| Minimum data quality Q | 0.70 | 2 | Team choice |
| Baseline window | 14 days | 4 | Team choice |
| Cold start | 5 valid days | 4 | Team choice |
| z-score clip | −3 to +3 | 4 | Team choice |
| Robust z constant | 0.6745 | 4 | Standard (R26, check) |
| Stress weights (RMSSD, HR, SCR rate, SCL, BP) | 0.35, 0.20, 0.20, 0.15, 0.10 | 5 | Team choice |
| Stress scale | 50 + 15 per standard deviation | 5 | Team choice |
| Stress levels | Yellow at 60, Red at 75 | 5 | Team choice |
| Alert persistence | 2 days, or Red with two signals at d ≥ 1.0 | 5 | Team choice |
| Sleep weights (duration, efficiency, awakenings, regularity) | 0.40, 0.30, 0.15, 0.15 | 6 | Team choice |
| Sleep duration target | 420 min (7 h) | 6 | R20 (check) |
| Sleep efficiency target | 85% | 6 | Team choice (check) |
| Awakenings cap | 60 min of WASO | 6 | Team choice |
| Regularity cap | 120 min of midpoint shift | 6 | Team choice |
| Sleep levels | Good at 80, Fair at 60 | 6 | Team choice |
| Sleep warning | d\_TST ≥ 1.0 on 2 nights, or Poor on 3 of 5 nights | 6 | Team choice |
| Face pulse band | 0.7 to 4 Hz | 8 | Method in R19 (check) |

## Limitations and honesty rules

Judges reward honest limits. Put the first five in Question 5.

- **Not a medical device.** The app gives risk indicators and early warnings, not diagnoses. It supports, and does not replace, a qualified healthcare professional.
- **Not validated.** Weights and thresholds are untested on real astronauts. The demo uses simulated data.
- **Wearable accuracy varies.** Heart rate is reliable; sleep, stress and blood pressure are less so (R17). Cuffless blood pressure needs calibration (R15). SpO2 error can exceed regulatory thresholds in every skin-tone group (R13).
- **Skin conductance has confounders.** Heat, exercise and noise can look like stress. We use low-movement windows, which helps but does not remove the problem.
- **A baseline needs days.** Until enough valid days exist, the app shows raw values and no score.
- **One simulated astronaut is not a population.** Sex differences in sleep need and circadian rhythm have not been studied systematically in spaceflight (R2).
- **Stress is not a disorder.** Anxiety and depression are clinical diagnoses. The app cannot tell them apart from ordinary stress (R3).
- **Claims to avoid.** “Detects depression”, “clinically proven”, “AI diagnoses”, “continuous blood pressure”, and “machine learning” unless the code really uses it.
- **Credit everything.** NASA can remove entries that do not cite their references (R21). Check the Space Apps submission guide for the rule on disclosing AI tools, and list any AI tools the team used.

## Writing guide and draft answers for each form question

For each field: what to include, then a draft. Text in \[brackets\] is a fact the team must confirm or fill in. Trim each draft to the form’s word limit and keep the (R#) tags or turn them into the form’s reference list.

**Habits for every answer.** One idea per sentence. A number always comes with its source. Say “we built” only for what exists, and “we designed” for the rest. Use “risk indicator” and “early warning”.

### Summary

Include: the problem, what the app does, who it helps, one NASA source, one honesty sentence.

> We are building an app that warns astronauts early when stress is rising or sleep is getting worse. Wearable sensors record heart rhythm, skin conductance, blood oxygen, movement and blood pressure. The app compares each astronaut with their own baseline and turns the data into a daily stress score and sleep-quality score, with a clear reason, advice and an emergency guide. The astronaut sees every alert first and chooses what to share with mission control. This addresses two risks NASA names for long missions: adverse cognitive and behavioural conditions, and performance decrements from sleep loss (R2, R3). The app gives risk indicators, not diagnoses, and the demo uses simulated data.

### 1. What does it do or how does it work?

Include: the signals, the flow (Big picture section), the baseline, the two scores, the warning, the emergency guide, the tool guide, crew-first sharing.

> The app reads \[heart rhythm, skin conductance, blood oxygen, movement and a blood-pressure trend\] from wearable sensors. Data is stored on the device, cleaned of motion noise and false beats, and cut into windows. For each astronaut the app learns a personal baseline from the last 14 days and measures every new reading against it. It combines the readings into a stress score and a sleep-quality score from 0 to 100, with a Green, Yellow or Red level. When a level rises, the app shows an early warning that says what changed, why it matters, what to do and when to ask for help. A separate emergency guide gives offline step cards, and every tool has a guide on how to use it, why it matters and how to fix it. The astronaut sees every alert first and decides what goes to mission control. \[The optional face pulse check is built / planned.\] The demo uses simulated data.

### 2. What benefits does it have? What is the intended impact?

Include: who benefits, what changes for them, the evidence of need.

> Astronauts get a daily view of their own stress and rest, and an early warning before performance drops. Crews average about 6 hours of sleep against 8.5 scheduled (R1), and NASA names sleep loss and behavioural-health conditions as risks that grow on long missions (R2, R3). Because the app compares each person with their own baseline and works on the device, it still helps when messages to Earth are delayed. Mission control receives only the summaries the astronaut chooses to share. The intended impact is earlier self-care, better-informed conversations with flight surgeons, and fewer surprises on long missions.

### 3. Tools, coding languages, hardware and software

This field is empty in the current draft. List only what the team really used. Fill in the table, then the template.

| Category | Fill in (true items only) |
| --- | --- |
| Front end | \[HTML, CSS, JavaScript, or the framework used\] |
| Calculations | \[JavaScript or Python, and libraries\] |
| Storage | \[localStorage, IndexedDB or SQLite\] |
| Data | \[simulated dataset and how it was generated\] |
| Sensors | \[real device used, or the sensor types the system is designed for\] |
| Design | \[Figma\] |
| Hosting and teamwork | \[GitHub, and the hosting platform\] |
| AI assistance | \[AI tools used, as the submission guide requires\] |

> We built the web app with \[X\]. Data is stored on the device with \[Y\]. Scores are calculated in \[Z\] using the formulas in our documentation. The demo data is simulated by \[method\]. We designed the screens in Figma and host the project on \[platform\]. The system is designed for \[wearable types\]; the demo \[does / does not\] use a real device.

### 4. How is your project creative?

Include: what is different, in four points or fewer, without claims we cannot back.

> Many wearable apps report raw numbers. Ours turns them into an explained early warning. Four ideas set it apart: (1) every astronaut is compared with their own baseline, not a population average; (2) stress is read from two independent signal families, heart rhythm and skin conductance, so agreement raises confidence; (3) each warning says why, what to do and when to ask for help, and an offline emergency guide backs it up; (4) the astronaut sees alerts first and chooses what to share, which suits missions with communication delays. \[An optional camera check estimates pulse from the face.\]

### 5. What factors did your team consider?

Include: accuracy limits, no diagnosis, privacy, fairness, data needs. Fix the “doctors” wording error from the fix list.

> We considered accuracy and limits. Wearables are less accurate than medical equipment: heart rate is reliable, while sleep, stress and blood pressure are less so (R17), cuffless blood pressure needs calibration (R15), and blood-oxygen error varies with skin pigmentation (R13). The app therefore gives risk indicators and early warnings, not diagnoses, and supports but does not replace a qualified healthcare professional. Skin conductance can rise with heat or exercise, so we score only low-movement periods. A baseline needs several days of data, so the app shows raw values until it has enough. The astronaut controls what is shared. The weights and thresholds are starting values that are not yet clinically validated, and the demo uses simulated data. When astronauts have concerns and Earth-based doctors are delayed or out of reach, the app helps them understand changes in their own stress and sleep.

### 7-slide outline (replaces the demo video)

1. The problem: sleep loss and behavioural-health risk on long missions (R1, R2, R3).
2. Our solution in one picture: own baseline in, explained risk indicator out.
3. How it works: the nine-step data flow.
4. The two scores: formulas and one worked example.
5. The app: Health, Log and Emergency screens.
6. Limits and ethics: what the app is not, crew-first sharing.
7. Sources and team.

## References

These were found through web search and I read only the search excerpts, not the full papers. Open each page and skim it before you cite it. Rows marked “from memory” were not found in search and must be looked up. Rows marked “secondary” point to a summary; cite the original where you can.

| Tag | Reference | Link | Status |
| --- | --- | --- | --- |
| R1 | Barger LK, Flynn-Evans EE, Kubey A, et al. Prevalence of sleep deficiency and use of hypnotic drugs in astronauts before, during, and after spaceflight. The Lancet Neurology, 2014. | [Press release](https://www.eurekalert.org/news-releases/541449) | Secondary; cite the paper |
| R2 | Flynn-Evans E, Gregory K, Arsintescu L, Whitmire A. Risk of Performance Decrements and Adverse Health Outcomes Resulting from Sleep Loss, Circadian Desynchronization, and Work Overload. NASA HRP Evidence Report, 2016. | [NTRS](https://ntrs.nasa.gov/citations/20160003864) | Found in search |
| R3 | NASA HRP. Risk of Adverse Cognitive or Behavioral Conditions and Psychiatric Disorders: Evidence Report, 2016. | [NTRS](https://ntrs.nasa.gov/citations/20160004365) | Found in search |
| R4 | NASA. Risk of Adverse Cognitive or Behavioral Changes and Psychiatric Disorders (HRP risk page). | [NASA](https://www.nasa.gov/directorates/esdmd/hhp/risk-of-adverse-cognitive-or-behavioral-conditions-and-psychiatric-disorders) | Found in search |
| R5 | NASA. Risk of Performance Decrements and Adverse Health Outcomes Resulting from Sleep Loss, Circadian Desynchronization, and Work Overload (HRP risk page). | [NASA](https://www.nasa.gov/directorates/esdmd/hhp/risk-of-performance-decrements-and-adverse-health-outcomes-resulting-from-sleep-loss-circadian-desynchronization-and-work-overload) | Found in search |
| R6 | Task Force of the ESC and NASPE. Heart rate variability: standards of measurement, physiological interpretation and clinical use. European Heart Journal 1996;17:354–381. | [Record](https://hero.epa.gov/hero/index.cfm/reference/details/reference_id/3061) | Found in search |
| R7 | Shaffer F, Ginsberg JP. An overview of heart rate variability metrics and norms. Frontiers in Public Health 2017;5:258. | [Article](https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2017.00258) | Found in search |
| R8 | Boucsein W, Fowles DC, Grimnes S, et al. Publication recommendations for electrodermal measurements. Psychophysiology 2012;49:1017–1034. | [PDF](https://typeset.io/pdf/publication-recommendations-for-electrodermal-measurements-3zrhucwdbu.pdf) | Found in search |
| R9 | Lutin E, Hashimoto R, De Raedt W, Van Hoof C. Feature extraction for stress detection in electrodermal activity. 2021. | [PDF](https://www.scitepress.org/Papers/2021/102446/102446.pdf) | Found in search |
| R10 | Grau L, Arbet J, Ostendorf DM, et al. Creating an algorithm to identify indices of sleep quantity and quality from a wearable armband in adults. Sleep Science 2022;15(3):279–287. | [PDF](https://thieme-connect.de/products/ejournals/pdf/10.5935/1984-0063.20220052.pdf) | Found in search |
| R11 | University of Michigan Depression Center. Smartwatch and activity tracker sleep parameters. | [Page](https://teamdynamix.umich.edu/TDClient/210/DepressionCenter/KB/Article/12902/Smartwatch-and-Activity-Tracker-Sleep-Parameters) | Found in search |
| R12 | Evaluations of commercial sleep technologies for objective monitoring during routine sleeping conditions. Nature and Science of Sleep, vol. 12, 2020. | [Article](https://www.dovepress.com/evaluations-of-commercial-sleep-technologies-for-objective-monitoring--peer-reviewed-article-NSS) | Found in search |
| R13 | Singh S, Bennett MR, Chen C, et al. Impact of skin pigmentation on pulse oximetry blood oxygenation and wearable pulse rate accuracy: systematic review and meta-analysis. Journal of Medical Internet Research, 2024. | [Article](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11502980/) | Found in search |
| R14 | Gerboni G, Comunale G, Chen W, et al. Prospective clinical validation of the Empatica EmbracePlus wristband as a reflective pulse oximeter. Frontiers in Digital Health 2023;5:1258915. | [Article](https://www.frontiersin.org/articles/10.3389/fdgth.2023.1258915) | Found in search |
| R15 | Evaluation of the accuracy of cuffless blood pressure measurement devices: challenges and proposals. Hypertension, 2021. | [Article](https://pmc.ncbi.nlm.nih.gov/articles/PMC8516718) | Found in search |
| R16 | Hu JR, Martin G, Iyengar S, et al. Validating cuffless continuous blood pressure monitoring devices. Cardiovascular Digital Health Journal 2023;4(1):9–20. | [Article](https://pmc.ncbi.nlm.nih.gov/articles/9971997/) | Found in search |
| R17 | npj Cardiovascular Health review (2025) on wearable accuracy, as summarised by News-Medical. | [Summary](https://www.news-medical.net/news/20250908/Wearable-health-trackers-reveal-how-accurate-your-smartwatch-really-is.aspx) | Secondary; find the original review |
| R18 | NASA OCHMO. NASA-STD-3001 Technical Brief: Sleep Accommodations (OCHMO-TB-041). Extra reading, not cited above. | [PDF](https://www.nasa.gov/wp-content/uploads/2023/03/sleep-accomodations-technical-brief-ochmo.pdf) | Found in search |
| R19 | Verkruysse W, Svaasand LO, Nelson JS. Remote plethysmographic imaging using ambient light. Optics Express 2008;16(26):21434–21445. | Search the title | From memory: verify |
| R20 | Watson NF, Badr MS, Belenky G, et al. Recommended amount of sleep for a healthy adult: a joint consensus statement of the AASM and SRS. Sleep 2015;38(6):843–844. | Search the title | From memory: verify |
| R21 | Space Apps Challenge. Participant FAQs and submission guide. | [Site](https://www.spaceappschallenge.org/resources/participant-faqs/) | Found in earlier search |
| R22 | Sleep in space (encyclopedia article that cites NASA-STD-3001 Volume 1). | [Page](https://en.wikipedia.org/wiki/Sleep_in_space) | Secondary; cite the standard |
| R23 | Live Science. Sleepless in Space: getting shut-eye is tough out there (interview with L. Barger). | [Article](https://www.livescience.com/47249-astronauts-sleep-deprivation.html) | Secondary |
| R24 | Barrett LF, Adolphs R, Marsella S, Martinez AM, Pollak SD. Emotional expressions reconsidered: challenges to inferring emotion from human facial movements. Psychological Science in the Public Interest 2019;20(1):1–68. | Search the title | From memory: verify |
| R25 | Flexible wearable devices for monitoring astronaut health. Wearable Electronics. | [DOI](https://doi.org/10.1016/j.wees.2024.12.007) | Found in earlier search |
| R26 | Iglewicz B, Hoaglin DC. How to detect and handle outliers. ASQC Quality Press, 1993 (modified z-score). | Search the title | From memory: verify |
