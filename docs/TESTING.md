# Testing SMRITI (Phases 1–6)

You can do this in four sittings: **A** (Phases 1–3, about 75 minutes), **B** (Phase 4, about 60 minutes), **C** (Phase 5, about 45 minutes) and **D** (Phase 6, about 30 minutes). Steps marked **(acceptance)** are the build kit's acceptance tests. Write pass or fail next to each step number, and take a screenshot of anything odd.

Test with the demo packs before you start real study. Some steps move the app's test clock, which leaves practice reviews dated in the future (see "After testing" at the end).

**Where things are:** the bar at the bottom has five tabs: **Today · Library · Labs · Progress · More**. Sources, Data (packs, backup, Anki export), Data health, Weekly review and Settings are under **More**.

## 0. Get the latest version (2 minutes, on each device)

1. Open SMRITI (your installed app, or https://adit8639.github.io/smriti/).
2. Within a minute a bar says **Reload to update**. Tap it. (If it does not appear, close the app completely and open it again.)
3. **More → Settings → About** should say **SMRITI 1.6.3**.
4. Tap **Run the self-tests**. Expect **"98 passed, 0 failed"**.

## Part A: Phases 1–3

### Laptop (Chrome)

**Basics (Phase 1)**

1. Go to **More → Data → Try the demo pack → Import 2 packs**. Then tap **Try the demo pack** again and expect **0 new, 0 updated** (acceptance). If you imported the demo before, both say 0 new, which is also a pass.
2. **Library → GS-II** shows 30 atoms · 5 PYQs · 3 CA.
3. **Rejected pack (acceptance):**
   1. Open `https://adit8639.github.io/smriti/packs/demo/demo-polity.json` and save it (Ctrl+S).
   2. Open the saved file in Notepad, delete the first `"answer": "42nd",` line, and save.
   3. Go to **More → Data → Import packs…** and choose that file.
   4. Expect **Rejected**, with `atoms[0].answer` named.
4. In the **Library**, press **/** and type `habeas`: the habeas corpus atom appears.
5. **Today → Quarantine** (under "Needs you"): approve one atom.

**Reviews (Phase 2)**

6. Go to **More → Settings → Study** and tick **Show the FSRS debug panel**. Then **Today → Start review**.
   - Answer about 20 cards with the keyboard: **a–d** options, **t/f** statements, **S / 5 / G** confidence (this reveals), **Y/N** for cloze, **1–4** to rate, **Space** to accept the suggestion.
   - The debug panel shows state, stability, due date and the four intervals, plus the session log (acceptance).
   - On a miss, pick a cause with keys **1–7**.
7. **Confusion → contrast (acceptance):**
   1. Open **Library → … → Directive Principles and Fundamental Duties**.
   2. On the **Match each Amendment Act** probe, tap **Try it**.
   3. Pair them wrongly (42nd with "Right to property", 44th with "Fundamental Duties"), answer, and pick a cause.
   4. Do it a second time.
   5. **Today** now says "1 contrast card … in today's queue", and **Start review** shows it.
8. **Leech flow (acceptance).** Lapses only count once an atom has reached Review, so the test clock speeds this up.
   1. In **More → Settings**, tap the **SMRITI 1.6.3** line seven times. In the developer box, set the **leech threshold to 2**.
   2. **Today → Quick add** an atom you will recognise: front `Leech test: ___`, back `ok`, any topic. Start a review: it comes first. Answer it right and press **4** (Easy). Tap **End**.
   3. In the developer box, tap **+30 d**. Start a review and answer until the leech-test card appears. Tap **Missed it**, accept **Again** and pick a cause. When it comes back in the same session, answer it right and accept **Good**. Tap **End**.
   4. Tap **+7 d**. Start a review and miss the leech-test card again. The **Leech** sheet appears.
   5. Tap **Rebuild now**, write a mnemonic, and tap **Save mnemonic**. It is back in today's queue.
   6. Set the threshold back to **6** and tap **Reset** on the test clock.
9. **Today → Quick add**: a front with `___`, a back and a topic, then save. Start a review: the new atom comes first.
10. Go to **More → Data → Export for Anki** and keep the `.txt` file for step 18.

**Learning (Phase 3)**

11. Go to **More → Sources → Try the demo source**. Keep **The whole PDF**, leave the pack link on **Demo: Indian Polity essentials**, then **Add → Save topics**.
12. **Offline source link (acceptance):**
    1. Turn Wi-Fi off.
    2. Open **Library → … → Parliamentary devices**.
    3. On the starred-question atom, tap **Open page 21**. The PDF page opens on the fact.
    4. Turn Wi-Fi back on.
13. In the Reader, go to page 24, select the Money Bill sentence, then **Make atom → tap "Lok Sabha" → Add atom**.
14. **Learn Loop:** on **Parliamentary devices**, tap **Start Learn Loop** and go through all five steps (pre-test, read page 21, blank-page recall, probes, 90-second skeleton). The done screen shows your **recall %**.
15. **Notes (acceptance):**
    1. Tap **Write R1 notes**, save, and tick a dropped atom.
    2. Tap **Write R2**. Over 150 words, **Save is blocked**.
    3. Trim and save. **R1 and R2 appear side by side.**
    4. Open **Booklets**, pick the subject, then **Print or save as PDF**.

### Android phone (Chrome)

16. Open SMRITI from the home screen.
    - **More → Data → Try the demo pack → Import.**
    - **More → Sources → Try the demo source**, and leave **Text and small page images** selected.
17. **Learn Loop on the phone (acceptance):** run the full loop on **Parliamentary devices** and time it. It should take under 25 minutes, with recall % on the done screen.
18. **AnkiDroid (acceptance):** copy the laptop's `smriti-anki-….txt` to the phone. In AnkiDroid: ⋮ → **Import** → choose the file → note type **Basic** → Import. The cards appear in the deck **SMRITI**.
19. **Airplane mode (acceptance):**
    1. Swipe SMRITI away from recent apps and turn on airplane mode.
    2. Open SMRITI: Today and the Library load.
    3. Start a review, open a source page (text view), and search.

### Sync both ways (acceptance)

20. **Phone:** **More → Data → Back up now**, save to Google Drive.
21. **Laptop:** **More → Data → Import backup… → Merge**. Then **Export backup** and upload it to Drive.
22. **Phone:** **More → Data → Import backup…**, choose the laptop file → **Merge**.
23. **Check:** both devices show the same event count (top of **More → Data**). Reviews, notes, Learn Loops and self-made atoms appear on both. Importing a file again says "Nothing new".

## Part B: Phase 4, Prelims Lab (laptop)

24. **PYQ solve:** **Labs → Prelims Lab → PYQs**, open the **2018 Governor** question.
    - The options stay locked until you mark both statements: press **t** for statement 1 and **f** for statement 2.
    - Press **c**, then **S** (Sure). The answer shows; statement 2 is marked as misjudged; **Linked atoms** are listed.
    - Tap **Review this atom next**: the linked atom comes up as a real review.
25. **Calibration by hand (acceptance):**
    1. **Prelims Lab → Mocks → Generated from your packs**, choose **Quick check: 10**, and start.
    2. Answer all 10, choosing a confidence each time (**S**, **5** or **G**). On paper, note for each: your confidence, and after submitting, right or wrong.
    3. Tap **Questions → Submit paper**. Give a cause for each wrong answer and each right Guess (the autopsy). The score unlocks.
    4. Check by hand: score = 2 × right − ⅔ × wrong; accuracy per band = right ÷ answered in that band. Both must match the results screen.
26. **Full mock (acceptance):**
    1. **Mocks → Generated from your packs → Full paper: 100 questions → Start.** The clock shows 2:00:00.
    2. Answer quickly (any letter, then **S**, **5** or **G**); press **n** to skip a few. Open **Questions**: answered, blank and not-visited squares are shown in different styles.
    3. **Submit paper.** The score stays hidden and the Mocks list says **Autopsy: N left**.
    4. Tag every cause. The score unlocks, with **Confidence in this mock** (the bands) and **Had you skipped a band** (the skip simulator).
27. **Calibration tab:** accuracy per confidence band, the plain rule ("Attempt 50-50s: …"), and the projected GS-I band.
28. **Traps tab:** the trap you tagged in the autopsy is listed with an example. Tap **Drill my top trap** (or **Drill this trap**): wrong answers here take their cause automatically.
29. **CSAT (acceptance):** **CSAT tab → Mixed set: 20 questions** (also under **Labs → CSAT Gym**). Answer 20 in a row: no question repeats, each shows a worked solution, and the projected CSAT shows with its safety line.

## Part C: Phase 5, Mains Studio and current affairs

30. **Skeleton sprint:** **Labs → Mains Studio → Skeleton Sprint → Start a sprint.** For two questions, write an intro line, 4 headings and a way forward within 90 seconds each. The directive (e.g. "Critically examine") shows with each question. At the end, tap **Compare with the model answer** (shown for questions that have one).
31. **Timed answer** (do this one on the phone): **Mains Studio → Timed answer → Choose a question**, a 10-marker (7 minutes, 150 words). Write on paper, tap **Take or choose a photo**, then self-score the six rubric rows (out of 12). Then tap **Compare with the model answer**.
32. Try **Shadow Writing (Shadow)**, **GS-IV case (Start a case)**, **Essay (Start an essay)** and, in the **Toolkit** tab, the directive drill (**Drill: which directive is this answer obeying?**) once each. Every attempt appears under **History**.
33. **CA–Static Bridge:** **Labs → CA–Static Bridge →** June 2025.
    - Open the item: why in news, its static anchors (topic chips), Prelims atoms, Mains angle and probable questions.
    - Tap **Mark month done**. (The demo items are all anchored. With your own CA packs, an item without an anchor blocks this until you tap **Add an anchor** on it.)
    - Open **Library → … → Parliament**: it shows an **In the news** chip.
34. **Shelf life (acceptance):**
    1. In the developer box (step 8), set the app date to **1 April 2027**.
    2. Open a demo CA item: it says **archived** (event date + 540 days has passed), and its facts no longer come up in reviews.
    3. Search for the fact in the Library: it is still found.
    4. Tap **Reset** on the test clock.
35. **PDF intake speed (acceptance):** add a 40-page current-affairs PDF under **More → Sources** (any monthly compilation you have; the demo source also works). Then **Labs → PDF intake**: choose it, pages 1–40, tick **Current affairs**, set the date of the current affairs, and tap **Find candidates**.
    - Laptop: under **2 minutes**. Phone: under **6 minutes**. The batch page shows the time taken.
36. **Triage 50 (acceptance):** tap **Triage**. Time yourself on 50 cards: swipe right to keep, left to discard (on the laptop: → and ←, ↑ to edit). Under **5 minutes**. Kept facts become atoms with their source page, and a strip suggests related PYQs and atoms.
37. *Optional, once, online:* on the batch page tap **Sharpen topic suggestions**. A 34 MB model downloads once, then works offline.

## Part D: Phase 6, planner, dashboard and labs

38. **Missions (acceptance):**
    1. **More → Settings → Daily time budget**: set today's weekday to **180**. **Today** shows six blocks (warm-up, Learn Loop on the top topic, Elimination Lab, writing, CA bridge, close) adding up to about 3 hours.
    2. Set it to **15**. **Today → Re-plan today**: the **Minimum mission** is warm-up reviews + PYQ statements.
39. **Skip a block:** tap **Skip** and pick **Tired**. The block is marked skipped.
40. **Streak:** do a few reviews and **Labs → Commute mode → 60-second statement sprint**. **Today** then says **1 day streak · today counts for the streak**.
41. **Heatmap and forecast (acceptance):**
    1. In the developer box, set the app date to **18 May 2028** (10 days before Prelims).
    2. Open **Progress**: note the forecast % and the heatmap colours.
    3. **Today → Start review**: answer 20 cards right and press **4** (Easy) each time.
    4. Open **Progress** again: the forecast % and some heatmap squares have changed.
    5. Tap **Reset** on the test clock.
42. **Weekly review:** **More → Weekly review**: read "what moved" and the five weakest topics, write a note, tap **Done**.
43. **Swipe reviews:** **Labs → Commute mode → Swipe reviews**: tap a card to see the answer, swipe right if you had it, left if you missed.
44. **Listen mode in airplane mode (acceptance):** on the phone, turn on airplane mode, then **Labs → Commute mode → Listen mode**. It either reads the cards aloud or clearly says the phone has no offline voice and where to get one.
45. **Map Lab:** **More → Data → Demo places and dates → Import**. Then **Labs → Map Lab**: 12 pins on India. Try the **Locate drill** (tap where a place is), the **Identify drill** (name the pin) and the **Cluster drill** (four pins, tap each as named).
46. **Timeline Lab:** **Labs → Timeline Lab**: try **Order the events**, **Missing middle**, **Date → event** and **Event → date**.
47. **Data health:** **More → Data health** says **No problems found**. Tap **Repair now → Repair**: it reports what it did, and your event count is unchanged except for one repair record.

## What to send back

- The self-test line from each device.
- Pass or fail for each numbered step.
- Both event counts after step 23.
- The phone's Learn Loop time (step 17), the intake times (step 35) and the triage time (step 36).
- The **More → Settings → Storage** "Persistent" status on each device.
- Screenshots of anything odd.

## After testing: start clean (optional)

Testing leaves demo packs and practice reviews (some dated in the future by the test clock). To start real study from zero, clear SMRITI's data on each device, then open SMRITI again:

- **Laptop (Chrome):** ⋮ → **Settings → Privacy and security → Site settings → View permissions and data stored across sites**, search `adit8639.github.io`, then **Delete data**.
- **Android (Chrome):** ⋮ → **Settings → Site settings → All sites**, tap `adit8639.github.io`, then **Delete data** (or **Clear & reset**).

Do not import the old test backups afterwards. Your packs are re-imported from their files, and the app itself stays installed.
