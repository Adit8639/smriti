# Testing SMRITI (Phases 1–3)

One pass covers all three phases: about 60–90 minutes in total. Steps marked **(acceptance)** are the build kit's acceptance tests. Please note anything that fails, with a screenshot if you can.

## 0. Put it online (once)

Use one of these:

- **A. GitHub Pages from this branch.** This needs Claude's GitHub access fixed first (see the chat), so the branch can be pushed.
  1. Open https://github.com/Adit8639/smriti → **Settings → Pages**.
  2. Set Source to **Deploy from a branch**, Branch to `claude/confident-pasteur-w6nw94`, folder `/ (root)`, then **Save**.
- **B. Upload the zip.** GitHub's uploader takes at most 100 files per upload, so this takes two.
  1. Unzip `smriti.zip`.
  2. On github.com/Adit8639/smriti, click **Add file → Upload files**, drag in the **`vendor`** folder from inside the unzipped folder, and **Commit**.
  3. Click **Add file → Upload files** again, drag in **everything else** inside the unzipped folder (all files and folders except `vendor`), and **Commit**.
  4. Set Pages to `main` and `/ (root)`.

After 1–3 minutes the app is at **https://adit8639.github.io/smriti/**. If you already installed the Phase 1 version, a **Reload to update** banner appears. Tap it.

## 1. Laptop (Chrome)

**Basics (Phase 1)**

1. Open the link and install it (the install icon in the address bar).
2. Go to **Settings → Run the self-tests**. Expect **"71 passed, 0 failed"**.
3. Go to **Data → Try the demo pack → Import 2 packs**. Then tap **Try the demo pack** again and expect **0 new, 0 updated** (acceptance).
4. **Library → GS-II** should show 30 atoms · 5 PYQs · 3 CA.
5. **Rejected pack (acceptance):**
   1. Open `…/smriti/packs/demo/demo-polity.json` and save it.
   2. Delete the first `"answer": "42nd",` line in Notepad and save.
   3. Go to **Data → Import packs…** and choose that file.
   4. Expect **Rejected**, with `atoms[0].answer` named.

**Reviews (Phase 2)**

6. Go to **Settings → Study** and tick **Show the FSRS debug panel**. Then **Today → Start review**.
   - Answer about 20 cards with the keyboard: **a–d** options, **t/f** statements, **S / 5 / G** confidence (this reveals), **Y/N** for cloze, **1–4** to rate, **Space** to accept the suggestion.
   - The debug panel shows state, stability, due date and the four intervals, plus the session log (acceptance).
   - On a miss, pick a cause with keys **1–7**.
7. **Confusion → contrast (acceptance):**
   1. Open **Library → … → Directive Principles and Fundamental Duties**.
   2. On the **Match each Amendment Act** probe, tap **Try it**.
   3. Pair them wrongly (42nd with "Right to property", 44th with "Fundamental Duties"), answer, and pick a cause.
   4. Do it a second time.
   5. **Today** should now say "1 contrast card … in today's queue", and **Start review** shows it.
8. **Leech flow (acceptance).** Lapses only count once an atom has reached Review, so the test clock speeds this up.
   1. In Settings, tap **SMRITI 1.3.0** seven times. In the developer box, set the **leech threshold to 2**.
   2. **Today → Quick add** an atom you will recognise: front `Leech test: ___`, back `ok`, any topic. Start a review: it comes first. Answer it right and press **4** (Easy). Tap **End**.
   3. Settings: **+30 d**. Start a review and answer until the leech-test card appears. Tap **Missed it**, accept **Again** and pick a cause. When it returns in the same session, answer it right and accept **Good**. Tap **End**.
   4. Settings: **+7 d**. Start a review and miss the leech-test card again. The **Leech** sheet appears.
   5. Tap **Rebuild now → write a mnemonic → Save mnemonic**. It is back in today's queue.
   6. Set the threshold back to **6** and press **Reset** on the test clock.
9. Go to **Today → Quick add**. Enter a front with `___`, a back, and a topic, then save. Start a review: the new atom comes first.
10. Go to **Data → Export to Anki** and save the `.txt` file for step 18.

**Learning (Phase 3)**

11. Go to **Sources → Try the demo source**. Keep **The whole PDF**, leave the pack link on **Demo: Indian Polity essentials**, then **Add → Save topics**.
12. **Offline source link (acceptance):**
    1. Turn Wi-Fi off.
    2. Open **Library → … → Parliamentary devices**.
    3. On the starred-question atom, tap **Open page 21**. The PDF page opens on the fact.
    4. Turn Wi-Fi back on.
13. In the Reader, go to page 24, select the Money Bill sentence, then **Make atom → tap "Lok Sabha" → Add atom**.
14. **Learn Loop (acceptance on the phone, step 17):** on **Parliamentary devices**, tap **Start Learn Loop** and go through all five steps:
    1. Pre-test.
    2. Read (page 21).
    3. Blank-page recall: type, then tick what you recalled.
    4. Probes.
    5. 90-second skeleton.

    The done screen shows your **recall %**.
15. **Notes (acceptance):**
    1. Tap **Write R1 notes**, save, and tick a dropped atom.
    2. Tap **Write R2**. Over 150 words, **Save is blocked**.
    3. Trim and save. **R1 and R2 appear side by side.**
    4. Open **Booklets**, pick the subject, then **Print / Save as PDF**.

## 2. Android phone (Chrome)

16. Open the link → ⋮ → **Install app**, and open SMRITI from the home screen.
    - Then **Data → Try the demo pack → Import**.
    - Then **Sources → Try the demo source**, and leave **Text and small page images** selected.
17. **Learn Loop on the phone (acceptance):** run the full loop on **Parliamentary devices** again and time it. It should take under 25 minutes, with recall % recorded on the done screen.
18. **AnkiDroid (acceptance):** copy the laptop's `smriti-anki-….txt` to the phone. In AnkiDroid: ⋮ → **Import** → choose the file → note type **Basic** → Import. The cards appear in the deck **SMRITI**.
19. **Airplane mode (acceptance):**
    1. Swipe SMRITI away from recent apps and turn on airplane mode.
    2. Open SMRITI: Today and the Library load.
    3. Start a review, open a source page (text view), and search.

## 3. Sync both ways (acceptance)

20. **Phone:** go to **Data → Back up now** and save to Google Drive.
21. **Laptop:** go to **Data → Import backup… → Merge**. Then **Export backup** and upload it to Drive.
22. **Phone:** go to **Data → Import backup…** and choose the laptop file → **Merge**.
23. **Check:** both devices show the same event count. Your reviews, notes and Learn Loops appear on both, and so do self-made atoms. Importing a file again says "Nothing new".

## What to send back

- The self-test line from each device.
- Pass or fail for each numbered step.
- Both event counts after step 23.
- The phone's Learn Loop time.
- The **Settings → Storage** "Persistent" status on each device.
- Screenshots of anything odd.
