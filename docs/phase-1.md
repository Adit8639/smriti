# Phase 1: Foundation

Status: built and tested in headless Chromium (desktop, plus a Pixel 7 phone profile). Not yet tested on a real Android phone.

## What was built

1. **App shell and PWA.** Installable (manifest and icons), with an install banner and an install button in Settings. A versioned cache-first service worker makes the app work offline. When `sw.js` changes version, a "Reload to update" banner appears.
2. **IndexedDB.** All 13 stores: settings, profiles, nodes, packs, atoms, probes, pyqs, ca, answers, notes, sources, events and cache. Persistent storage is requested on first run, and the result is shown.
3. **Event log.** A device id, a monotonic ULID generator and an append API. A pure `rebuild()` replays the log into atom (Quarantine), pack, settings and device state. Appends are written with strict durability.
4. **Settings.**
   - Exam profile switcher: CSE 2028 with Anthropology, or CAPF AC 2027.
   - Editable exam and phase dates. Edits are events, so they sync between devices.
   - Weekday time budget.
   - Theme.
   - Device name.
   - Storage used and persistence status.
   - A hidden test clock: tap the version line seven times.
5. **Pack importer.**
   - Multi-file picker, plus a "Try the demo pack" button.
   - Schema validation with exact error paths, such as `atoms[3].answer`.
   - A dry run showing new, updated, unchanged and removed items per type.
   - Atomic commits.
   - Uninstall removes the pack's content, keeps the events and marks orphans.
6. **Library.** A syllabus tree for the active exam, showing atom, PYQ and CA counts per topic, with each item counted once per subtree. Search uses MiniSearch in a worker. Topic pages list the atoms (with source and page), probes, PYQs, CA items, notes and model answers.
7. **Backup.** Export writes all stores to `smriti-backup-<device>-<date>.json`. On Android, a share option sends it to Google Drive. Import shows a merge preview and follows the merge rules. A banner appears when this device's last export is more than 7 days old.
8. **Node index export.** A compact JSON of id, title and keywords, to attach to Forge prompts. It can be downloaded or copied.
9. **Demo packs** in `packs/demo/`:
   - A syllabus pack with 12 Polity topics.
   - A content pack with 30 atoms, 15 probes covering all 10 formats, 5 PYQs, 3 CA items, 1 model answer and 1 note.
10. **`/tests` page.** 47 in-browser self-tests:
    - validator
    - ULID and events
    - rebuild
    - merge
    - profiles
    - integrity
    - IndexedDB end-to-end runs on scratch databases
    - app shell checks

**Required by the Contract, though not listed in Phase 1:** the Quarantine deck (rule 6). It lets you approve or discard atoms with `origin: "model"` or `verify: true`.

## Manual test script

> Since Phases 2 and 3 were built, Today is the start screen and Quarantine sits under Today. Use [TESTING.md](TESTING.md), which covers all three phases in one pass. The script below is kept as the Phase 1 record.

### A. Put it online (once, about 5 minutes, on the laptop)

1. Open https://github.com/Adit8639/smriti → **Settings** → **Pages**.
2. Under *Build and deployment*, set Source to **Deploy from a branch**. Set Branch to **`claude/confident-pasteur-w6nw94`** and the folder to **`/ (root)`**, then **Save**.
3. Wait 1–3 minutes and refresh the Pages page until it says the site is live at **https://adit8639.github.io/smriti/**.

### B. Laptop (Chrome)

1. Open https://adit8639.github.io/smriti/. The Library shows the starter syllabus: GS-I to GS-IV, Essay, CSAT and Anthropology Papers I and II. A note about storage appears at the bottom.
2. Install: click the install icon at the right end of the address bar (or **Install** on the banner). SMRITI opens in its own window.
3. Go to **Settings → About → Run the self-tests**. Expect **"47 passed, 0 failed"**. Click *Back to the app*.
4. Go to **Data → Try the demo pack**. The preview shows two packs, "12 new" and "55 new". Press **Import 2 packs**. Expect the message "Imported 2 packs: 67 new, 0 updated."
5. **Acceptance: import twice.** Press **Try the demo pack** again. Expect "Already installed — nothing to import" and "0 new, 0 updated". Press OK.
6. Open the **Library**. "GS-II: Polity…" shows **30 atoms · 5 PYQs · 3 CA**. Open GS-II → Indian Polity and Constitution → Parliament → Parliamentary devices. You see 3 atoms, each with a source line such as "Demo Source, p. 21", plus a probe, a PYQ and a note.
7. Press **/** and type `habeas`. The habeas corpus atom appears. Click it to jump to its topic.
8. **Quarantine** shows a badge of 2. Read one atom and press **Approve**. The badge drops to 1.
9. **Acceptance: deleted required field.**
   1. Open https://adit8639.github.io/smriti/packs/demo/demo-polity.json and save it with Ctrl+S.
   2. Open the saved file in Notepad and delete the first `"answer": "42nd",` (in the first atom). Save.
   3. In SMRITI, go to **Data → Import packs…** and choose that file.
   4. Expect **"Rejected — nothing will be imported"** and the error **`atoms[0].answer` required field is missing**. The event count on Data stays the same.
10. Write down **Data → Event log**. It should be 3 events: two pack installs and one approval.

### C. Android phone (Chrome)

1. Open https://adit8639.github.io/smriti/ in Chrome.
2. Install it: ⋮ menu → **Add to Home screen** (or **Install app**) → Install. From now on, open SMRITI from its home-screen icon.
3. Go to **Settings → Storage**. Note whether Persistent shows **granted**. If not, tap **Request persistent storage**.
4. Go to **Data → Try the demo pack → Import 2 packs**, then approve one atom in **Quarantine**.
5. **Acceptance: airplane mode.**
   1. Close SMRITI fully by swiping it away in recent apps.
   2. Turn on **airplane mode** and open SMRITI from the home screen.
   3. The Library loads, with an "Offline" label at the top.
   4. Open a topic, and search for `money bill`.
   5. Turn airplane mode off.

### D. Sync both ways (acceptance: identical event counts)

1. **Phone:** go to **Data → Back up now**, choose Google Drive (or Files), and save the backup.
2. **Laptop:** download that file from Drive. Then go to **Data → Import backup…** and choose it. The preview shows "N new · M already here · T after merge". Press **Merge**.
3. **Laptop:** go to **Data → Export backup** and upload the file to Drive.
4. **Phone:** open Drive, download the laptop file, then in SMRITI go to **Data → Import backup…** → choose it → **Merge**.
5. Check: **Data → Event log** shows the **same number on both devices**, with the same per-device lines. Importing either file again says "Nothing new". Quarantine shows the same waiting atoms on both.

### E. Optional extras

- **Test clock:** go to Settings, tap "SMRITI 1.0.0 · schema v1" seven times, then press **+7 d** and **+1 d**. Expect the banner "Last backup from this device was 8 days ago". Press **Reset**.
- **Uninstall:** go to Data → *Demo: Indian Polity essentials* → **Uninstall**. The atoms leave the Library and the event count goes up by one, because events are kept. **Try the demo pack** reinstalls it with no duplicates.

**Please report back:** the self-test line from both devices, pass or fail for each numbered step, both event counts from D5, the Persistent status on both devices, and any error text or screenshot.

## Known limitations

- **Laptop without hosting.** Opening `index.html` straight from a folder does not work: Chrome blocks JavaScript modules on `file://`. Use the hosted link, or run `python3 -m http.server` in the folder and open `http://localhost:8000/`. This corrects the build kit's note that the laptop "still runs it from a folder".
- **Persistent storage** is granted at Chrome's discretion, usually once the app is installed or used regularly. The app can ask but cannot force it. Keep weekly backups.
- **Uninstalls do not propagate.** A pack uninstalled on one device stays on the other device until you uninstall it there too. That device's Data screen says "Uninstalled on <device>". A backup never reinstalls a pack that was uninstalled later than it was installed.
- **Dropped items in pack updates.** When a new pack version drops items, a device that receives that version only through a backup keeps the old items, because backups never delete. It shows "N items left from an older version" with a **Clean up** button.
- **Demo PYQs** are reconstructed from the 2017, 2018 and 2020 Prelims papers, so their wording may differ slightly from the official paper. They are marked `answerSource: "unverified"`. Replace them with F2 packs.
- **Device names** reach other devices with that device's next backup export.
- **Events are never deleted.** This includes events stamped while the test clock was on.
- **CAPF AC Paper I** uses the past pattern of 125 questions and one-third negative marking. Confirm against the 2027 notice (due 17 Feb 2027).
- **The Anthropology starter syllabus** is section-level: 20 topics for Paper I and 10 for Paper II. F0 adds the leaf topics under them; attach the node index when you run F0.
- **Testing so far** covered headless Chromium at phone and laptop sizes, including offline start-up on a 4× slower CPU (about 0.6 s). It has not run on a real phone, and iOS is not targeted.

## Deferred to later phases

- **Phase 2:** reviews and FSRS, and with them the Space and 1–4 keyboard shortcuts.
  - Atom memory state, plus node and session state. The rebuild reducer is ready for their events.
  - The queue worker, probe renderers, error causes, confusion pairs, leeches, quick-add and the Anki export.
- **Phase 3:** PDF sources (the `sources` store exists but stays empty), the Reader, the Learn Loop and Shrink-Wrap Notes.
- **Phases 4–6:** Prelims Lab, CSAT, Mains Studio, the CA–Static Bridge with shelf-life archiving, offline PDF intake and triage, planner, dashboard, Commute mode, Map and Timeline Labs, and Data health with per-store sizes and one-tap repair.

## Decision needed before Phase 2

**Daily review cap.** Phase 2 caps each day's reviews and shows the overflow honestly, but the build kit does not set the cap. The options:

- **(a) Fixed:** for example 200 reviews a day.
- **(b) From your weekday budget (recommended):** the warm-up block's share of the day's minutes at about 10 s per card. With 180 minutes, that is about 120 reviews, rising on long days and shrinking on short ones, with a hard ceiling such as 300.
