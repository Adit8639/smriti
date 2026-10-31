# Phase 4: Prelims Lab, Mocks, CSAT

Status: built and tested in headless Chromium at phone (412 px and 360 px) and laptop sizes. A real-device test is still to come (see [TESTING.md](TESTING.md)).

Everything here lives under **Labs → Prelims Lab** (`#/lab`), with five tabs: PYQs, Mocks, Calibration, Traps and CSAT.

## What was built

1. **PYQ Spine** (PYQs tab):
   - **Browse** by year, topic and format, with what you got right so far shown on each row.
   - **Solve mode.** Statements written inside a PYQ's stem are split out so you mark each one true or false first; the options unlock after that. Then pick an option and a confidence (Sure, 50-50, Guess), which reveals the answer.
   - **The explanation** shows the official (or stated) key, which statements you misjudged (the truth of each statement is worked out from the key when the pack does not give it), the trap tags, the elimination path and the **linked atoms**, with one tap to review them straight after.
   - **Solve a set**: any filtered list can be solved as a session.
2. **Mock engine** (Mocks tab), driven by the exam profile (GS-I: 100 questions, 120 minutes, +2 / −⅔):
   - **Three sources:** a mock generated from your packs, a PYQ year paper, or an imported mock pack (F6).
   - **Generated mocks** use PYQs and pack probes first, then template questions built from your atoms (single answer, statement sets, "NOT correct", "how many"), following the profile's format mix and the recency-weighted subject weights. Generated questions are marked as such.
   - **Exam conditions:** a question palette (answered, seen but blank, not visited, marked for review), a timer, keyboard keys (a–d to answer, S / 5 / G for confidence, N and P for next and previous, M to mark, Q for the palette). Progress is saved as you go, so a closed tab resumes.
3. **Autopsy gate:** after you submit, every wrong answer and every right-but-Guess answer needs a cause (the same causes as reviews, plus a trap tag) before the score, the history and the analytics unlock. Mock answers count toward calibration only once the autopsy is done.
4. **Calibration report** (Calibration tab):
   - **Accuracy per confidence band** over your last 300 objective answers, and per mock.
   - **Expected value per band:** EV = 2a − ⅔(1 − a) per question (the marks come from the profile). Break-even is 25%.
   - **A plain rule**, for example "Attempt 50-50s: 61%. Skip pure guesses: 22%."
   - **Skip simulator:** each mock's score had you skipped a band.
   - **Projected GS-I band:** expected questions per subject (recency-weighted PYQ counts) × your accuracy on that subject's PYQ-style questions, adjusted by your attempt rule, shown as a 10th–90th percentile range (bootstrap over your recent answers).
5. **Trap Log** (Traps tab): every trap tag with counts and real examples from your misses; a drill serves statements built on your top two traps (or any trap you pick). Drill misses take their cause automatically.
6. **CSAT Gym** (CSAT tab): question generators instead of a fixed bank, for 11 types (percentages, ratio and proportion, averages, time-speed-distance, time and work, number system, simple and compound interest, permutations and combinations, data sufficiency, seating arrangement, directions), each at three levels, with a timer and a worked solution. A mixed set of 20 covers every type. Reading comprehension and other CSAT items come from packs. Seconds per question are tracked, and you are warned when projected CSAT falls below 1.25 × the qualifying mark.

## Decisions I made

| Question | Decision |
| --- | --- |
| Statements in PYQs | The schema keeps a PYQ's statements inside its stem, so they are parsed from the numbered lines. When a pack does not say which statements are true, the app works it out from the answer key where it can; when it cannot, that statement is shown as "not known" rather than guessed. |
| Generated mock questions | Used only after real PYQs and pack probes run out, built from your own atoms, and labelled "generated" in the paper and the results. |
| When mock answers count | Only after the autopsy, so calibration never learns from an unexamined paper. |
| Marks and break-even | Taken from the exam profile, so CAPF and CSAT use their own marking. |
| No repeats in CSAT | Each generated question has a signature; a set never repeats one, and recent ones are avoided across sets. |

## Known limitations

- The demo has only 5 PYQs, so the projected band is very wide until your PYQ packs (F2) are installed.
- Reading-comprehension passages cannot be generated; they come from CSAT packs.
- The elimination path is as good as the pack's explanation; generated questions explain which atom they test.
