# SMRITI: UPSC Active-Recall OS — Build Kit

Oct 28, 2026 · @Adit

## Read this first: what the app can and cannot do by itself

Yes, partly. Offline, the app can read your PDFs, tag every page to the syllabus, link current affairs to static topics and PYQs, and turn fact-dense sentences into cards you approve with a swipe. What it cannot do offline is *understand* a PDF well enough to write UPSC-grade statement questions, mains dimensions or read handwritten topper copies. That needs one AI pass per PDF, done when you are online; after that, everything runs offline.

| What you want from a PDF | Offline in the app (phone + laptop) | Needs one AI pass |
| --- | --- | --- |
| Searchable text, page by page | Yes, for text PDFs. Scanned PDFs need OCR, which is slow and laptop-only | No |
| Tag each page to a syllabus micro-topic | Yes: keyword taxonomy plus a small embedding model downloaded once | Sharper with AI |
| Link a CA item to static chapters and PYQs | Yes: similarity search over your own library | No |
| Cloze cards from facts (Articles, years, schemes, places, numbers) | Yes: pattern rules; you keep or discard each in about 2 seconds | No |
| Statement-based MCQs with realistic traps and explanations | Weak: template questions only | Yes |
| Mains dimensions, value-adds, answer skeletons, probable questions | No | Yes |
| Topper handwritten answer copies | No: handwriting OCR is unreliable | Yes |

**The loop I recommend: forge once, study offline forever.**

1. Upload a PDF to Claude with the matching Forge prompt (section 6). You get back a content pack, a single `.json` file.
2. Import it into the app on laptop and phone. Cards stay in a Quarantine deck until you approve them in Triage, and triage itself counts as a recall rep.
3. Study offline. Every card links to its source page, so any fact is one tap from verification.

**What "improves by itself" really means.** The app cannot learn new facts on its own, but it learns *you*. Every review, wrong option, confidence tag and response time re-ranks what you see next. Weak nodes with high PYQ weight rise, confused pairs become contrast cards, and slow-but-correct recalls come back sooner.

**On-device AI is a laptop-only extra, not the content source.** In-browser models now work: a 4-bit Llama 3.2 1B is a 695 MB download needing about 880 MB of GPU memory, while Chrome's built-in model is desktop-only and wants more than 4 GB of VRAM and 22 GB of free disk ([Pinggy, Sept 2026](https://pinggy.io/blog/run_llm_in_browser_webgpu/)). Models that small invent facts, and a wrong fact in Prelims costs you 0.66 marks. So any on-device draft stays quarantined until you approve it.

**Why the German prompt landed average:**

- One prompt asked for the engine, the full curriculum and all content at once. Output limits forced silent cuts, so "no placeholders" was impossible and the content got thin.
- `localStorage` caps at around 5 MB. It cannot hold PDFs or a year of review history.
- SM-2 is a 1987-era algorithm. FSRS, the open scheduler built into Anki since 2023, models forgetting per card and needs fewer reviews for the same retention.
- A single HTML file opened from a phone's file manager has no install, no guaranteed offline cache and fragile storage.
- It listed features but no acceptance tests, so the builder had nothing to check its work against.
- "Active" meant flashcards and quizzes only. There was no writing, no confidence calibration, no interleaving and no error analysis.

## Product decisions, and what I rejected

Build the engine once and feed it content forever. SMRITI (स्मृति, memory) is a content-agnostic, installable offline web app; every piece of UPSC knowledge enters as a validated content pack. That one split fixes most of what went wrong with the German tool.

| Area | Chosen | Rejected, and why |
| --- | --- | --- |
| Build method | Six phases, each with acceptance tests; engine and content built separately | One mega-prompt: it truncates and cannot be tested |
| Platform | Installable web app (PWA): a folder of plain HTML, CSS and JS uploaded once to a free static host, then "Add to Home screen". Fully offline after first load | Single HTML from the file manager (no install on Android); native app (needs coding); Anki + Obsidian (no PYQ formats, calibration, mains studio or CA–static graph) |
| Storage | IndexedDB with a persistent-storage request; PDFs stay as local files in the browser, never uploaded | `localStorage`: about 5 MB |
| Scheduler | FSRS via the open-source ts-fsrs library (MIT licence), anchored to your exam date | SM-2 |
| Rating | Suggested automatically from correctness, response time and confidence; you can override | Pure self-rating, which drifts towards "Good" |
| Sync | Append-only event log; import merges by event id and rebuilds card states | JSON overwrite: two devices means lost reviews |
| Content | Versioned JSON packs, a source page on every item | Curriculum hardcoded in the app |
| AI | Outside the app (Forge) or an optional laptop-only drafter; output always quarantined | AI as a live dependency |
| Anki | Tab-separated export AnkiDroid can import, as a mirror | Lock-in |

**Privacy and copyright by design.** The hosted folder contains only the engine code. Your books, topper copies, notes and progress live in each device's browser storage, so nothing copyrighted or personal is ever published.

**Where I questioned my own first idea.** My first instinct was a bigger single file with smarter content baked in. It fails the same way: no model can write 800 syllabus nodes, 14 years of PYQs and a full engine in one reply. Splitting costs you about six build sessions, but every piece becomes testable and content grows monthly without touching code.

**The one honest trade-off.** "Zero setup" becomes "five minutes, once": a free account on a static host (GitHub Pages or Cloudflare Pages, both with web upload, no code). Service workers, which make offline install possible, only run on HTTPS pages. Without hosting, the laptop still runs it from a folder, but the phone will not install it.

&#91;embedded content: SMRITI architecture · sources to packs to the study loop\]

Content comes in at the top only when you add a source; everything below the knowledge graph is a closed loop that runs offline on each device and merges across them.

## What toppers and the 2026 paper actually show, turned into features

Toppers converge on four habits: PYQs as the core, mocks analysed harder than they are taken, notes compressed for many revisions, and answer writing from day one. The 2026 GS-I paper adds a fifth: it rewards elimination and braided static-plus-current knowledge over plain recall. Each finding below becomes a feature the app enforces rather than advice you have to remember.

| What the evidence shows | Feature it becomes |
| --- | --- |
| Divya (AIR 182, CSE 2025) practised PYQs 6–7 times between January and May and diagnosed every miss as a memory gap, an unclear concept or a missed revision ([Edukemy](https://edukemy.com/blog/upsc-topper-divya-air-182-from-6-attempts-to-success/)) | **PYQ Spine**: every node opens with its PYQs as a pre-test; every miss needs a one-tap cause |
| She took about 50 mocks and spent 1–2 hours analysing each one | **Autopsy gate**: mock scores unlock only after every wrong *and every guessed-right* answer is tagged |
| Each subject condensed to 10–15 pages of micro-notes; syllabus revised 4–5 times | **Shrink-Wrap Notes**: each revision rewrites a node from memory under a tighter word cap |
| Answer writing began by reading a topper answer, closing it and rewriting it from memory (about 100 answers), then adding 1–2 diagrams per 10-marker | **Shadow Writing** and **Skeleton Sprints** in the Mains Studio; a diagram line in the rubric |
| 2026 GS-I had 65 statement-based questions, 7 NOT-correct and 4 match-the-list (the first in four years); "how many are correct" fell from 32 in 2023 to 2 ([EaseMyPrep analysis](https://easemyprep.in/blog/upsc-prelims-2026-gs1-deep-analysis-pattern-shift)) | Probe formats weighted by an editable **format-mix table**, refreshed yearly from the PYQ pack; paired cards for matching |
| Current Affairs & GK rose from 10 to 19 questions; PIB, news, government sites and Yojana fed about half the paper | **CA–Static Bridge**: no CA item counts as done until it is anchored to a static node |
| Environment fell from 18 to 10 while Ancient History plus Art & Culture rose from 6 to 16 in one year | Subject weights are data, not code; priority uses recency-weighted PYQ counts |
| A wrong answer costs a third of the marks; analysts advise guessing only after eliminating options | **Calibration Lab**: your own accuracy at Sure, 50-50 and Guess sets your attempt rule |

One caution: topper talks are survivor stories, and one year's swing is noise as much as signal. So the app treats every strategy above as a default you can edit, and your own error data overrides it.

## Feature blueprint: twelve engines, all retrieval-first

The rule behind every screen: nothing ends on reading. Each engine below forces you to produce an answer, and the app tracks your **active ratio** (time spent producing answers vs reading), with a target of 70% or more.

### The knowledge model

- **Node**: one syllabus micro-topic (600–900 for CSE), small enough for a 60–90 minute session, carrying its PYQ weight and CA heat.
- **Atom**: one testable fact or idea with its source page, nodes, confusable atoms and, for CA, an event date and shelf life.
- **Probe**: one way of testing atoms: cloze, true/false, statement set, NOT-correct, match-the-list, chronology, odd one out, Statement I/II, identify, explain.
- **PYQ**, **CA item** and **model answer** (from topper copies) are linked to nodes and atoms.
- **Event**: every answer, with time taken, confidence, rating and error cause. This log is the only source of truth.

The key design choice: memory state lives on the **atom**, and the probe format is picked at review time. You see the same fact as a cloze today, a trap statement next week and a match pair after that, so you learn the fact, not the card.

### The engines

1. **Learn Loop** (per node): pre-test on PYQs → read with in-app highlight-to-card capture → blank-page recall (type or dictate everything, then tick a checklist; below 70% the node stays open) → 10 interleaved probes → a 90-second mains skeleton.
2. **Recall Engine**: FSRS on atoms; never more than 3 items in a row from one node; a new atom after every 5 reviews; rating suggested from correctness, speed and confidence; after 6 lapses a card is suspended until you rebuild it with a mnemonic or split it.
3. **Speed layer**: response time per atom. Correct but slower than target (8 s per card, 72 s per full Prelims question, since GS-I gives 120 minutes for 100) is graded Hard. Speed ladders tighten the clock as you improve.
4. **Elimination & Calibration Lab**: mark each statement true or false before picking an option. Wrong statements are tagged by trap type (extreme word, number swap, institution swap, chronology flip, scope creep). Your confidence bands set your attempt rule.
5. **Confusion Engine**: when your wrong choice belongs to another atom, the pair is logged. Two hits in 30 days create a contrast card ("Ramsar vs Montreux Record: which one…") scheduled the same day.
6. **CA–Static Bridge**: why in news → static anchor → Prelims facts → Mains angle → probable question. Static nodes show "in the news" chips. CA facts count for Prelims for 540 days, then archive. Unanchored items block the month from closing.
7. **Mains Studio**: directive decoder, Skeleton Sprints (5 questions × 90 s), timed answers on paper (7 min for 150 words, 11 min for 250) photographed and self-scored, Shadow Writing, dimension overlap against a topper's skeleton, a value-add bank, a GS-IV case mode and an essay outline mode.
8. **Shrink-Wrap Notes**: each revision rewrites a node from memory, previous version hidden, under caps of 300, 150 and 60 words, then 12 keywords. Exports a micro-notes booklet per subject.
9. **Prelims Lab**: PYQs by year, node or format; full mocks with a question palette and negative marking; the autopsy gate; a projected score shown as a range, never a single number.
10. **CSAT Gym**: procedurally generated quant and reasoning (unlimited fresh questions), reading comprehension from your packs, and a warning when mock scores drift towards the 33% qualifying line.
11. **Map and Timeline Labs**: offline India and world outline maps with pins from your packs (locate, identify, cluster drills, a "news" layer); chronology ordering and missing-middle-event drills.
12. **Commute mode, Planner and Dashboard**: one-thumb swipe reviews, 60-second statement sprints and a listen mode using the phone's offline voices; a daily mission built from your time budget; a dashboard with days to exam, syllabus heatmap, calibration curve, error-cause mix, recall speed and an exam-day retention forecast.

### The two formulas that drive it

Node priority decides what you learn next: PYQ weight × how much you would forget by exam day × open confusions × phase.

```latex
P(n) = W(n) \times \left(1 - \bar{R}_{exam}(n)\right) \times \left(1 + 0.2\,c(n)\right) \times \phi(n)
```

W is recency-weighted PYQ count plus CA heat, R̄ is the mean FSRS-predicted recall of the node's atoms on exam day (0 if unlearned), c is open confusion pairs (capped at 5), and φ is the phase factor (mains-only nodes pause during Prelims focus).

The attempt rule comes from negative marking: +2 for right, −2/3 for wrong. Attempting pays when your accuracy a in a confidence band clears 25%.

```latex
EV = 2a - \tfrac{2}{3}(1 - a) > 0 \iff a > 0.25
```

The app shows your own numbers ("50-50s: 61%, attempt; pure guesses: 22%, skip") and simulates each mock's score had you skipped a band.

### A three-hour day inside the app

| Block | Minutes | What you do |
| --- | --- | --- |
| Warm-up recall | 20 | Due reviews, mixed subjects and formats, capped |
| Learn Loop | 60 | One top-priority node, start to finish |
| Elimination Lab | 30 | 15 PYQs with statement marking and confidence |
| Writing | 30 | Three skeleton sprints, or one timed answer on alternate days |
| CA Bridge | 20 | Anchor today's items, then 10 CA probes |
| Close | 10 | Error triage and tomorrow's mission preview |

On a bad day, a 15-minute minimum mission keeps your streak, and one missed day a week never breaks it.

## The Master Build Prompt

Paste this in phases, in one Claude conversation that can write and run code. First message: the Contract, the Schema from section 7, then Phase 1. Test what comes back on both devices, report results, then paste the next phase.

- Each phase returns complete files, a test script and a list of what it deferred. Nothing is stubbed.
- If a reply gets cut off, send: "Continue exactly where you stopped in `<file>`. Do not rewrite finished files."
- Do not skip a failed test to keep moving. A broken merge or scheduler in Phase 1–2 corrupts everything built on it.

### Part 0: the Contract (paste once, first)

```markdown
# SMRITI — Build Contract (read fully before writing any code)

## Role
You are a senior engineer and learning-science product lead. You will build SMRITI, an offline-first active-recall system for the UPSC Civil Services Exam, extensible to CAPF AC and state PCS exams through exam profiles. We build in phases. In each phase, build only that phase, completely, then stop and wait for my test results.

## The user
- One aspirant with a laptop (Chrome) and an Android phone (Chrome); studies on commutes.
- Default profile: CSE 2028 with optional Anthropology (Papers I and II). The 2028 UPSC calendar is not out yet, so use tentative dates (Prelims late May 2028, Mains late August 2028), clearly labelled "tentative". Secondary: CAPF AC (2027 exam: 4 Jul 2027). All dates are editable data.
- Already uses Anki/AnkiDroid; keep a tab-separated export that Anki can import.

## Non-negotiables
1. Offline-first PWA in plain HTML, CSS and vanilla JavaScript ES modules. No framework, no build step, no CDN at runtime. Third-party code is vendored into /vendor with its licence (fetch from npm in your sandbox).
2. Layout: index.html, app.css, /js/*.js (one module per concern), sw.js (versioned, cache-first app shell), manifest.webmanifest, /vendor, /profiles, /packs/demo, /tests.
3. Storage: IndexedDB through a small wrapper you write. Call navigator.storage.persist() on first run and show the result. localStorage only for UI preferences.
4. Event-sourced learning data: every learning action appends an event {id (ULID), deviceId, ts, type, payload}. Atom, node and session states are caches rebuilt from events by a pure function. Export writes all stores to one JSON file. Import MERGES: union events by id, upsert content by id keeping the higher version, never delete, then rebuild. Importing the same file twice changes nothing.
5. Content-agnostic engine: no study content in code. Content arrives as packs matching the SMRITI SCHEMA. Validate on import, show a readable error list, and reject the pack, never crash the app.
6. Every atom shows its source and page. Atoms with origin "model" or verify:true sit in a Quarantine deck until I approve them.
7. Mobile-first UI: bottom navigation, primary actions in the lower third, touch targets of at least 44 px, usable one-handed. Laptop shortcuts: Space reveal, 1–4 rate, J/K next/previous, / search. System fonts, light and dark themes, no decorative animation.
8. Performance on a mid-range phone: shell opens offline in under 2 s; a 5,000-atom queue builds in under 1 s; no main-thread task over 100 ms during review (heavy work in Web Workers).
9. No placeholders, stubs, TODOs or fake data paths. If something does not fit this phase, list it under "Deferred" instead of faking it.
10. End every phase with: (a) every new or changed file in full, zipped if you can; (b) a numbered manual test script for phone and laptop; (c) known limitations; (d) the one decision you need from me before the next phase.

## Learning rules the app must enforce
- No passive endings: a reading or viewing step only counts once a retrieval step follows it.
- Retrieve before re-exposure: pre-test before reading a node; blank-page recall after it.
- Interleave: queues mix subjects and formats; never more than 3 items in a row from one node; a new atom after every 5 reviews.
- Vary the probe: FSRS memory state lives on the atom; the probe format is chosen at review time, rotating formats and favouring the active exam's format mix.
- Speed matters: log response time; correct but slower than the profile target (default 8 s per card, 72 s per full Prelims question) is graded Hard.
- Calibrate: every objective answer carries a confidence tag (Sure, 50-50, Guess) chosen before the reveal.
- Errors are data: every miss needs a one-tap cause: Didn't know, Forgot, Confused with…, Misread, Overthought, Silly, Trap word.
- Measure the active ratio (time producing answers ÷ total session time); target 70% or more; show it on the dashboard.

## Exam profiles (data, not code)
A profile JSON holds: id, name, dates, phase boundaries, papers [{id, name, type mcq|descriptive, questions, marks, durationMin, negativeFraction, qualifyingPct, formatMix, wordLimits, minutesPerAnswer}], and a starter syllabus tree (the full tree arrives later as a syllabus pack).
- CSE: Prelims GS-I 100 Q, 200 marks, 120 min, negative 1/3; CSAT 80 Q, 200 marks, 120 min, qualifying 33%. Mains: Essay 250; GS I–IV 250 each; Optional I–II 250 each; two qualifying language papers, 300 each. Mains answers: 10 marks = 150 words in 7 min; 15 marks = 250 words in 11 min.
- CAPF AC: Paper I objective, 250 marks, 120 min (negative marking per the 2027 notice, editable); Paper II descriptive, 200 marks, 180 min — Part A essay 80 (English or Hindi), Part B comprehension, précis, counter-arguments 120 (English only).
- Default CSE GS-I formatMix (from the 2026 paper): statement 65, single 9, assertionReason 8, notCorrect 7, identify 5, match 4, howMany 2.

Acknowledge this contract in five lines, then wait for the Schema and Phase 1.
```

### Phase 1: Foundation

```markdown
# Phase 1 — Foundation

Build:
1. App shell and PWA: install prompt, offline cache, "Reload to update" banner when sw.js changes version.
2. IndexedDB stores: settings, profiles, nodes, packs, atoms, probes, pyqs, ca, answers, notes, sources, events, cache.
3. Device id, ULID generator, event append API, and a pure rebuild function with in-browser unit tests.
4. Settings: exam profile switcher, editable dates, daily time budget per weekday, theme, storage used and persistence status, and a hidden test clock for time-travel testing.
5. Pack importer: multi-file picker; schema validation with precise error paths; a dry-run summary (new / updated / unchanged) before commit; uninstalling a pack removes its content, keeps events and marks orphans.
6. Library: syllabus tree browser with search (vendored MiniSearch); each node shows counts of atoms, PYQs and CA items.
7. Backup: Export (all stores → smriti-backup-<device>-<date>.json); Import with the merge rules; a banner if the last export is over 7 days old.
8. "Export node index": a compact JSON of node id, title and keywords, which I attach to every Forge prompt.
9. Demo pack in /packs/demo: 30 atoms, 15 probes covering every format, 5 PYQs, 3 CA items and 1 model answer on Indian Polity, factually correct, sourced to a fictional "Demo Source".
10. /tests page: in-browser self-tests for validator, merge and rebuild, shown as a pass/fail list.

Acceptance tests your script must include:
- Install on Android, switch on airplane mode, reopen: the library loads.
- Import the demo pack twice: the second import reports 0 new, 0 updated.
- Export on phone, import on laptop, and the reverse: identical event counts on both.
- Delete a required field from a pack: a clear error, nothing imported.
```

### Phase 2: Recall Engine

```markdown
# Phase 2 — Recall Engine

Build:
1. FSRS with vendored ts-fsrs (UMD build). Memory state per atom. Desired retention 0.90 by default. Exam anchoring: in the 45 days before the active profile's first paper, cap intervals so every Prelims atom is reviewed at least once in that window; pause mains-only atoms until the day after Prelims.
2. Probe renderers, touch and keyboard: cloze; true/false; statement set (2–4 statements — mark each true/false, then choose the option); NOT-correct; match-the-list (tap to pair, 3–4 pairs); chronology (tap to order); odd one out; Statement-I/Statement-II; identify-X; explain (free recall, typed or dictated, then self-check against key points).
3. Probe chooser: for a due atom, pick the format least recently used for that atom, weighted by the profile's formatMix; fall back to an auto-cloze of the atom text.
4. Review flow: prompt → answer → confidence (objective formats, before reveal) → reveal with explanation and source page link → suggested rating, accepted or changed in one tap.
   Rule: wrong → Again; correct + Guess → Hard; correct + (slow or 50-50) → Hard; correct + Sure + within target → Good; correct + Sure + under 40% of target + previous Good → Easy.
5. Error-cause sheet on every miss. Routing: Didn't know → atom reset to new; Forgot → normal lapse; Confused with… → search and pick the other atom → confusion pair; Misread / Trap word → Trap Log with a trap tag; Silly / Overthought → counted in calibration.
6. Confusion engine: when a chosen wrong option, wrong pair or wrong position maps to another atom, log the pair automatically. At 2 hits in 30 days, generate a contrast probe from both atoms and schedule it today.
7. Leeches: at 6 lapses, suspend and open a Rebuild card (write a mnemonic, split the atom, or attach a contrast); unsuspend after rebuilding.
8. Queue builder in a Web Worker: due atoms + learning steps + daily new atoms (default 30) under the interleaving rules; a daily cap with the overflow shown honestly.
9. Mobile quick-add: front, back, node (searchable) and optional source/page; origin "self"; enters the queue at once.
10. Anki export: tab-separated front, back, tags, source for chosen nodes or all.

Acceptance tests:
- 200 mixed-format reviews with no crash; ratings and intervals visible in a debug panel.
- A deliberately wrong match pairing creates a confusion pair, and the second one a contrast card.
- The leech flow end to end.
- The tab-separated export imports into AnkiDroid.
```

### Phase 3: Learn Loop, Reader, Shrink-Wrap Notes

```markdown
# Phase 3 — Learn Loop, Reader, Shrink-Wrap Notes

Build:
1. Sources: add a PDF, stored as a local blob on the laptop; on the phone, an optional "text only" mode keeps extracted text and page thumbnails to save space. Extract text per page with vendored pdf.js in a worker. Map each source to nodes (manual, plus suggestions from node keywords).
2. Reader: page view; select text → "Make atom", pre-filled with text, source page, suggested node and a suggested cloze target (numbers, years, Article/Schedule/Amendment numbers, proper nouns). Every atom's source link opens the reader at that page.
3. Learn Loop for a node, a guided 5-step flow that cannot be skipped forward:
   a. Pre-test: up to 5 PYQs or probes for the node; wrong answers are expected and logged as pre-test events with no FSRS penalty.
   b. Read: the node's linked source pages; capture atoms while reading; a timer runs.
   c. Blank-page recall: only the node title is shown; I type or dictate everything I remember; then the atom checklist appears and I tick what I recalled. Recall % = ticked ÷ total. Below 70% the node stays "Learning" and missed atoms are scheduled today.
   d. Probe set: 10 interleaved probes, at least 3 from older nodes.
   e. Output: a 90-second mains skeleton for a PYQ or probable question of the node (intro line, 4 headings, way forward).
4. Shrink-Wrap Notes: per node, levels R1–R4 capped at 300 / 150 / 60 words / 12 keywords, with a live word counter that blocks saving over the cap. I rewrite with the previous level hidden; after saving, show a side-by-side with the previous level and the atom checklist so I mark what I dropped. Track revision count per node and per source.
5. Source budget: warn when a node gets a third source ("Limited sources, more revisions").
6. Micro-booklet export: the latest notes level of chosen nodes compiled into a clean printable page, one subject per booklet.

Acceptance tests:
- A full Learn Loop on a demo node on the phone in under 25 minutes, with recall % recorded.
- An R1 → R2 rewrite with the side-by-side review.
- A source link on an atom opens the right PDF page offline.
```

### Phase 4: Prelims Lab, Mocks, CSAT

```markdown
# Phase 4 — Prelims Lab, Mocks, CSAT

Build:
1. PYQ Spine: browse by year, node and format; solve mode with statement-level marking and confidence; the explanation shows trap tags, an elimination path and linked atoms (one tap to review them).
2. Mock engine, profile-driven (e.g. 100 Q, 120 min): question palette (answered, marked for review, not visited), timer, negative marking from the profile. Sources: a PYQ year paper, an imported mock pack, or a generated mock drawn from probes matching the formatMix and recency-weighted subject weights.
3. Autopsy gate: after submitting, every wrong answer and every correct-but-Guess answer needs an error cause before score history and analytics unlock.
4. Calibration report: accuracy per confidence band (last 300 objective answers, and per mock); expected value per band, EV = 2a − (2/3)(1 − a); a plain-language rule ("Attempt 50-50s: 61%. Skip pure guesses: 22%."); and a simulator showing each mock's score had I skipped a band.
5. Trap Log: trap tags with counts and examples; a drill mode serving statements built on my top two traps.
6. CSAT Gym: procedural generators, no fixed bank — percentages, ratio and proportion, averages, time-speed-distance, time and work, number system, simple and compound interest, basic permutations and combinations, data sufficiency, seating and directions — each with timer, worked solution and three difficulty levels. Reading comprehension passages come from imported packs. Track seconds per question; warn when projected CSAT falls below 1.25 × the qualifying mark.
7. Projected GS-I band: per subject, expected questions (recency-weighted PYQ counts) × my accuracy on that subject's PYQ-format probes, adjusted by my attempt rule; shown as a 10th–90th percentile range by bootstrap over recent answers.

Acceptance tests:
- A full 100-question mock from demo plus generated items, submitted, gated, then unlocked.
- Calibration numbers match a hand calculation on 10 answers.
- 20 CSAT questions in a row with no repeats.
```

### Phase 5: Mains Studio, CA–Static Bridge, Offline Intake

```markdown
# Phase 5 — Mains Studio, CA–Static Bridge, Offline PDF Intake

Build:
1. Directive decoder: Discuss, Examine, Critically examine, Analyse, Evaluate, Comment, Elucidate, Explain, Justify, Illustrate, Enumerate, Describe — each with its expected structure and a one-line check of whether an answer meets it; drill mode ("which directive is this answer obeying?").
2. Skeleton Sprint: N questions × 90 s each — intro line, 4–6 dimension headings with one value-add each, way forward; typed or dictated; saved as attempts.
3. Timed answer: 10-marker 7 min / 150 words, 15-marker 11 min / 250 words (profile-editable). I write on paper and attach a photo (stored locally), then self-score a rubric: demand addressed, structure, dimensions, value-add, diagram, conclusion (0–2 each).
4. Compare: side by side with the linked model answer from topper packs; dimension overlap (which of its dimensions I missed) and value-add types used by each.
5. Shadow Writing: show a model answer for 120 s, hide it, I rebuild its skeleton from memory, then show the diff.
6. Value-add bank per node: Articles, judgments, committees, reports and indices, data points with year, schemes, examples, quotes, diagram ideas — each an atom, drillable.
7. Dimension wheel (editable): political, economic, social, technological, legal-constitutional, environmental, ethical, administrative, international, security, historical, geographical.
8. GS-IV case mode, 15 min: stakeholders → values in conflict → options with pros and cons → chosen course with justification.
9. Essay mode: theme → 15-minute brainstorm map → outline sprint → intro and conclusion drafts; quote bank from packs. CAPF profile adds précis (one-third length rule, word counter) and counter-argument drills.
10. CA–Static Bridge: CA item view = why in news → static anchors (node chips) → Prelims atoms → Mains angle → probable questions. Static node pages show "In the news" chips. Shelf life: CA atoms count for Prelims until event date + 540 days, then archive (still searchable). Reconciliation: unanchored CA items must be anchored before a month can be marked done.
11. Offline intake for a new PDF, no AI, in a worker:
    a. Candidate extraction by rules: sentences with Article/Schedule/Amendment numbers, years, %, ₹/crore/lakh, launched/established/headquartered/ratified/signed/located, rivers, national parks, tiger reserves, Ramsar sites, indices, reports, rankings, ministries.
    b. Dedupe at token Jaccard ≥ 0.8 against existing atoms.
    c. Node suggestion: keyword match, then cosine similarity to node descriptions using a vendored small sentence-embedding model (Transformers.js, WASM backend, quantized, lazy-loaded on first use, cached offline).
    d. Triage deck: the cloze is shown first, then the sentence; swipe right keep (atom with source page, origin "rule"), left discard, up edit. Swipes are logged as recall events.
    e. For each kept CA candidate, suggest the top 3 related PYQs and static atoms.

Acceptance tests:
- A 40-page CA PDF yields candidates in under 2 min on the laptop and under 6 min on the phone.
- 50 candidates triaged in under 5 minutes.
- Shelf-life archiving verified with the test clock.
```

### Phase 6: Planner, Dashboard, Commute, Map and Timeline Labs

```markdown
# Phase 6 — Mission Planner, Dashboard, Commute, Map & Timeline Labs

Build:
1. Phase calendar from the profile: Foundation (now → 31 Jan of the exam year), Prelims focus (1 Feb → Prelims), Mains (day after Prelims → Mains), editable. Each phase weights Prelims vs Mains work and pauses or resumes atom groups.
2. Daily Mission from today's time budget: reviews (capped), a Learn Loop on the top-priority node, a PYQ/elimination set, writing (sprints or one timed answer), the CA bridge, and a 5-minute close (error triage + tomorrow's preview).
   Node priority P(n) = W(n) × (1 − R̄(n)) × (1 + 0.2·c(n)) × φ(n): W = recency-weighted PYQ count (last 5 years × 1.0, older × 0.5) + CA heat; R̄ = mean FSRS-predicted recall of the node's atoms on exam day (0 if unlearned); c = open confusion pairs (cap 5); φ = phase factor.
   The mission is a suggestion: I can swap or skip a block; skipping asks for a reason (tired, no time, not useful), which is logged.
3. Minimum viable day: a 15-minute mission (reviews + 10 PYQ statements) keeps the streak; one missed day per week never resets it.
4. Dashboard: days to each exam; syllabus heatmap (nodes by W × predicted recall); exam-day forecast (% of Prelims atoms with predicted recall ≥ 0.8 on exam day); calibration curve; error-cause mix over time; active ratio; median recall latency trend; revisions per source; mock trend with projected band.
5. Weekly review (Sunday prompt, 15 min): what moved, the five weakest high-weight nodes, plan adjustments, backup reminder.
6. Commute mode: one-thumb layout, tap to reveal, swipe to rate; 60-second true/false statement sprints; Listen mode via the Web Speech API (speaks the prompt, waits 6 s, speaks the answer, I tap know / don't know). It states clearly when the device has no offline voice.
7. Map Lab: bundled simplified India and world outlines (pre-projected SVG under 1 MB); atoms with lat/lon from packs become pins; locate (tap the map), identify (name the pin) and cluster drills; CA places on a "news" layer.
8. Timeline Lab: order events, find the missing middle event, date → event and event → date drills.
9. Data health: storage per store, persistence status, last export per device, and an integrity check (orphans, broken references) with one-tap repair.

Acceptance tests:
- Missions for 3 hours and for 15 minutes.
- Heatmap and forecast change after 20 reviews.
- Listen mode works in airplane mode, or shows a clear message.
```

### Phase 7 (optional): laptop-only AI drafting

```markdown
# Phase 7 — Optional on-device drafting (laptop only)

Add a WebLLM engine in a Web Worker, shown only when WebGPU is available and the device has enough GPU memory. One action: select text in the Reader → "Draft probes". It returns statement-set probes as JSON validated against the schema, with origin "model" and verify true, straight into Quarantine. Hidden on phones. Model download happens only on explicit request, with size shown first.
```

## Content Forge: turning your PDFs into packs

One Forge run turns one source into one importable pack. Each run takes the Forge Contract, the Schema (section 7), your node index (exported from the app) and one of the eight prompts below. Keep runs small: 30–40 book pages, one PYQ paper, or one month of CA per run, so nothing gets truncated.

| Prompt | Input | How often |
| --- | --- | --- |
| F0 Syllabus Graph | Official syllabus text, your optional | Once per exam |
| F1 Book chapter | 30–40 pages of a book or NCERT | Just before you study it |
| F2 PYQ paper | One question paper + its key | Once per paper, 2013–2026 |
| F3 Current affairs | One month of a magazine or PIB compilation | Monthly, on the 1st |
| F4 Topper copy | One scanned answer booklet | When Mains practice starts |
| F5 Topper notes | A topper's notes on one subject | As needed |
| F6 Mock test | One coaching test with its key | After each test |
| F7 CAPF Paper II | Editorials or passages | Weekly in CAPF months |

### The Forge Contract (paste above every Forge prompt)

```markdown
# FORGE CONTRACT

You convert my study material into a SMRITI content pack. Output ONE downloadable .json file that validates against the SMRITI SCHEMA pasted below. Rules:

1. Fidelity: every atom comes from the attached material and carries source.page. You may add an outside fact only to correct something outdated or wrong; mark it origin "model", verify true, and explain in note.
2. Atomic: one testable fact or idea per atom, at most 35 words. A list longer than 5 items becomes one list atom plus separate atoms for items that are confusable or have been asked.
3. UPSC-shaped probes, following the current format mix: mostly statement sets (2–4 statements) with realistic traps — number or year swap, institution swap, scope creep ("all", "only", "always"), cause–effect reversal, chronology flip, near-name swap. Each statement has true/false and a one-line reason. Add NOT-correct, match-the-list (3–4 pairs) and Statement-I/II items wherever the material supports them.
4. Map every atom to 1–3 node ids from the NODE INDEX attached. If nothing fits, use the closest parent and list the atom under report.unmapped.
5. Confusables: link atoms a student would mix up (similar names, numbers, bodies, dates, places).
6. Mains layer for each major topic: dimensions, value-adds (Article, judgment, committee, report or index, data with year, example, diagram idea) and 2 probable questions with directives.
7. Size: if the output would not fit in one reply, split into parts (pack id suffix -p1, -p2…) at object boundaries. Never truncate inside an object. Tell me how many parts to expect before you start.
8. Self-check before output: valid JSON, unique ids, every reference resolves, every atom has source.page or origin "model". Record counts per object type and any doubts in pack.report.
```

### F0: Syllabus Graph (once per exam)

```markdown
# F0 — Syllabus Graph
Attached: the official syllabus for [CSE Prelims GS-I, CSAT, Mains Essay, GS I–IV, Optional: Anthropology Papers I and II] or [CAPF AC Paper I, II].
Return a pack of kind "syllabus": nodes with id (dotted path, e.g. cse.gs2.polity.parliament.devices), parent, paper, title, 8–15 keywords including common synonyms and abbreviations, and a 2–3 sentence description written for semantic matching. Target 600–900 leaf nodes for CSE; each leaf should be teachable in one 60–90 minute session. Mark nodes shared across exams in sharedWith. Leave PYQ weights empty; F2 fills them.
```

### F1: Book or NCERT chapter

```markdown
# F1 — Book chapter
Attached: pages [x–y] of [book, edition] and the node index.
Return: atoms (about 1 per 150–250 words of dense text, fewer for narrative), probes (at least 1 per atom, 2 for atoms on PYQ-tested themes), R1 notes per node (max 300 words, written as recall cues, not prose summary) and the mains layer. Flag facts likely to be outdated (data, scheme names, office holders, rankings) with verify true.
```

### F2: Previous-year paper

```markdown
# F2 — PYQ paper
Attached: [year] [paper] question paper and answer key ([official] or [coaching]), plus the node index.
For each question: stem, options, answer exactly as in the attached key (answerSource official or coaching; with no key, solve it and mark unverified), format, node ids, the atoms each statement tests (create them, sourced as source.pyq), a trap tag for every wrong statement, and a 3-line elimination path. Add report.nodeCounts (questions per node in this paper) for PYQ weights.
For a Mains paper: question, directive, marks, word limit, node ids and expected dimensions.
```

### F3: Current affairs

```markdown
# F3 — Current affairs month
Attached: [source] for [month year] and the node index.
For each item with exam value: date, headline, why in news (max 30 words), static anchors (node ids, mandatory), Prelims atoms (the event facts plus the static fact each connects to), shelf life (default 540 days; 900 for annual reports and indices), mains angle (dimensions plus one value-add), and probable questions (one statement set; one Mains question where relevant). Add connections between items that are the same story over months. List skipped headlines in report.skipped so I can disagree.
```

### F4: Topper answer copy

```markdown
# F4 — Topper answer copy
Attached: scanned booklet of [name, rank, year, paper] and the node index.
For each answer: question, marks, directive, word estimate, skeleton (intro type, body headings in order, conclusion type), dimensions covered, value-adds with type, diagrams (what and where), presentation notes (sub-headings, underlining, flowcharts) and "why it scores" in 3 bullets judged against the directive. Transcribe only what is legible; mark the rest [illegible]. Do not invent content.
Add 3 Shadow-Writing drills per answer: the question plus the hidden skeleton I must rebuild.
```

### F5: Topper notes

```markdown
# F5 — Topper notes
Attached: [topper]'s notes on [subject] and the node index.
Return: atoms for facts not already in the node index's existing packs (I will attach their ids), mnemonics the notes use (as atom.mnemonic), and target notes at levels R2 (150 words) and R3 (60 words) per node, so the app can show me the compression a topper achieved after I write mine.
```

### F6: Mock test

```markdown
# F6 — Mock test
Attached: [institute] test [number] with its answer key, and the node index.
Return a pack of kind "mock" with questions in PYQ format: answer only from the attached key (answerSource "coaching"), node ids, trap tags and elimination path. Where the key's answer looks wrong or outdated, keep it but add a doubt in report.doubts with your reason.
```

### F7: CAPF Paper II drills

```markdown
# F7 — CAPF Paper II
Attached: [editorials or passages] and the node index.
Return: précis drills (passage, target word count at one third, 3 must-keep ideas), comprehension questions with model answers, counter-argument drills (claim → strongest counter → rebuttal) and 2 essay prompts with 6-dimension outlines. English only for Part B items.
```

## The content pack schema

One file format carries everything: the app validates it on import and every Forge prompt writes it. Paste this block wherever a prompt says "SMRITI SCHEMA". A pack with the same id and a higher version updates the old one; nothing is ever silently overwritten.

```markdown
# SMRITI SCHEMA v1

A pack file is one JSON object:
{ "pack": {}, "nodes": [], "atoms": [], "probes": [], "pyqs": [], "ca": [], "answers": [], "notes": [] }
Empty arrays may be omitted.

## pack (required)
id (kebab-case, unique) · version (integer; bump on any change) · kind (syllabus | book | notes | pyq | ca | topper | mock | custom) · exam (array: cse, capf-ac, or a PCS id) · title · createdAt (YYYY-MM-DD) · source {title, edition?, author?, pages?} · report {counts {}, doubts [], unmapped [], skipped [], nodeCounts {}}

## node (syllabus packs)
id (dotted path, e.g. cse.gs2.polity.parliament.devices) · parent (id or null) · paper (cse.pre.gs1, cse.pre.csat, cse.mains.essay, cse.mains.gs1–gs4, cse.mains.opt1–opt2, capf.p1, capf.p2a, capf.p2b) · title · keywords [] · description · sharedWith []? · pyqWeight {year: count}?

## atom
id ("<packId>.<4 digits>") · type (fact | concept | list | date | compare | map | data | case | quote | valueadd) · text (prompt or statement; ___ marks a cloze gap) · answer · nodes [1–3 ids] · source ({pack, page} or {pyq: id}) · origin (source | model | rule | self) · verify (boolean)
Optional: confusables [] · stage [prelims, mains] · geo {lat, lon} · eventDate · shelfLifeDays · mnemonic · note · tags []

## probe
id · atoms [] · format (cloze | tf | statement | notCorrect | match | order | odd | assertionReason | identify | explain) · stem · explanation · difficulty (1–3)
By format: statements [{text, true, trap, reason}] · options [] (4 for MCQ formats) · answer (option index from 0) · pairs [[left, right]] (3–4) · items [] in correct order (order) · keyPoints [] (explain)
Trap tags: number-swap, year-swap, institution-swap, scope-creep, cause-effect, chronology, near-name, location-swap, partial-truth.

## pyq
id ("pre-2026-gs1-q41") · year · paper · format (statement | single | assertionReason | notCorrect | identify | match | howMany) · stem · options [] · answer · answerSource (official | coaching | unverified) · nodes [] · atoms [] · traps [{statement, tag}] · elimination
Mains: directive · marks · words · dimensions []

## ca
id · date · headline · whyInNews · anchors [node ids, at least 1] · atoms [] · shelfLifeDays
Optional: mainsAngle [] · probableQs [{stage, text}] · connections [ca ids]

## answer (model answers from topper copies)
id · question · paper · marks · directive · skeleton {intro, body [], conclusion} · dimensions [] · valueAdds [{type, text}] · source {pack, page}
Optional: diagrams [] · words · whyItScores [] · drills [{question, hiddenSkeleton}] · topper {name, rank, year}

## note (Shrink-Wrap levels)
node · level (1–4) · text · source

## Validation
- ids unique across installed packs; same id + higher pack version = update.
- References resolve inside the pack or installed packs; otherwise import with a warning and mark the item orphaned.
- Dates ISO (YYYY-MM-DD). Statement sets have 2–4 statements. Match has 3–4 pairs.
- Atom text over 35 words is a warning, not an error.

## Example (valid)
{
  "pack": {
    "id": "demo-polity-qhour", "version": 1, "kind": "book", "exam": ["cse", "capf-ac"],
    "title": "Demo: Questions in Parliament", "createdAt": "2026-10-28",
    "source": {"title": "Demo Source", "edition": "1"},
    "report": {"counts": {"atoms": 2, "probes": 1}, "doubts": [], "unmapped": [], "skipped": [], "nodeCounts": {}}
  },
  "atoms": [
    {"id": "demo-polity-qhour.0001", "type": "compare",
     "text": "A starred question in Parliament is answered ___, and supplementary questions may follow.",
     "answer": "orally", "nodes": ["cse.gs2.polity.parliament.devices"],
     "source": {"pack": "demo-polity-qhour", "page": 4}, "origin": "source", "verify": false,
     "confusables": ["demo-polity-qhour.0002"], "stage": ["prelims"]},
    {"id": "demo-polity-qhour.0002", "type": "compare",
     "text": "An unstarred question is answered ___, so no supplementary questions follow.",
     "answer": "in writing", "nodes": ["cse.gs2.polity.parliament.devices"],
     "source": {"pack": "demo-polity-qhour", "page": 4}, "origin": "source", "verify": false,
     "confusables": ["demo-polity-qhour.0001"], "stage": ["prelims"]}
  ],
  "probes": [
    {"id": "demo-polity-qhour.p001",
     "atoms": ["demo-polity-qhour.0001", "demo-polity-qhour.0002"],
     "format": "statement", "difficulty": 1,
     "stem": "Consider the following statements about questions in Parliament:",
     "statements": [
       {"text": "Starred questions are answered orally and supplementary questions may follow.", "true": true, "trap": null, "reason": "This is what makes a question starred."},
       {"text": "Unstarred questions allow supplementary questions because they are answered in writing.", "true": false, "trap": "cause-effect", "reason": "A written answer is exactly why no supplementaries follow."}
     ],
     "options": ["1 only", "2 only", "Both 1 and 2", "Neither 1 nor 2"], "answer": 0,
     "explanation": "Only statement 1 is correct."}
  ]
}
```

## How to run it

Time-box the build to about 10 hours across two weeks. Your target is CSE 2028, roughly 19 months away, but every hour spent building is an hour not studying. From the end of Phase 3 onwards you can study inside the app daily while the later phases get built.

1. **Session 1 (90 min).** Open a new Claude conversation that can write and run code. Paste the Contract, the Schema and Phase 1. Test on the laptop, upload the folder to a free static host, open the link on your phone, choose "Add to Home screen", then test in airplane mode.
2. **Forge the spine before the content.** Run F0 for the syllabus graph, then F2 for each Prelims paper from 2013 to 2026, one paper per run. These give the planner its PYQ weights.
3. **Phases 2 and 3.** After these, start daily use with the Learn Loop and reviews.
4. **Forge just in time.** F1 only for the chapters you will study this week; F3 on the 1st of every month; F4 and F5 when Mains practice begins; F6 after every coaching mock.
5. **Phases 4–6 over the following week.** Phase 7 only if you want laptop drafting.

**Gate checks before moving past Phase 2:**

- [ ] Airplane mode: the app opens and reviews work on the phone
- [ ] The same pack imported twice creates no duplicates
- [ ] 20 reviews on phone and 20 on laptop, cross-imported both ways, show 40 events and identical states on each
- [ ] Force-closing the browser mid-review loses no answered card
- [ ] Storage shows "persistent: granted" on both devices
- [ ] A backup file sits in your Google Drive (manual upload, weekly)

**Reference dates, 2027 cycle.** UPSC published the 2027 calendar in May 2026, so the 2028 one should follow around May 2027. Until then, the CSE 2028 profile uses tentative dates, and these 2027 dates show the cycle's rhythm and the next CAPF exam ([VisionIAS](https://visionias.in/blog/upsc-news/upsc-calendar-2027-out-cse-prelims-on-23-may-2027-check-exam-dates-download-pdf), [SPM IAS](https://spmiasacademy.com/upsc-capf-syllabus-2027-paper-1-paper-2-exam/)).

| Event | Date |
| --- | --- |
| CSE 2027 notification | 13 Jan 2027 |
| Last date to apply, CSE | 2 Feb 2027 |
| CAPF AC 2027 notification | 17 Feb 2027 |
| CSE Prelims | 23 May 2027 |
| CAPF AC written exam | 4 Jul 2027 |
| CSE Mains begins | 20 Aug 2027 |

**Data safety, in three habits.** Export from both devices every Sunday and cross-import, which merges rather than overwrites. Keep the latest export in Google Drive. Never clear browser data for the app's site without exporting first, because that storage is the only copy of your progress.

**Your settings:** target CSE 2028, optional Anthropology. Attach the Anthropology Paper I and II syllabus when you run F0, so the optional gets its own nodes from day one.

## Sources

- [UPSC Calendar 2027 dates and paper pattern, VisionIAS](https://visionias.in/blog/upsc-news/upsc-calendar-2027-out-cse-prelims-on-23-may-2027-check-exam-dates-download-pdf)
- [UPSC Prelims 2026 GS-I deep analysis, EaseMyPrep](https://easemyprep.in/blog/upsc-prelims-2026-gs1-deep-analysis-pattern-shift)
- [UPSC CAPF syllabus and 2027 dates, SPM IAS Academy](https://spmiasacademy.com/upsc-capf-syllabus-2027-paper-1-paper-2-exam/)
- [Divya, AIR 182 CSE 2025, strategy, Edukemy](https://edukemy.com/blog/upsc-topper-divya-air-182-from-6-attempts-to-success/)
- [Running LLMs in a browser tab in 2026, Pinggy](https://pinggy.io/blog/run_llm_in_browser_webgpu/)
- [ts-fsrs, the FSRS scheduler library](https://github.com/open-spaced-repetition/ts-fsrs)
