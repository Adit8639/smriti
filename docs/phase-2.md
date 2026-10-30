# Phase 2: Recall Engine

Status: built and tested in headless Chromium at phone and laptop sizes. A real phone test is still to come (see [TESTING.md](TESTING.md)).

## What was built

1. **FSRS scheduling** via the vendored ts-fsrs 5.4.2 (UMD build, MIT).
   - Memory state lives on the atom, with learning steps of 1 and 10 minutes (10 minutes when relearning).
   - Desired retention is 0.90 by default, editable from 0.80 to 0.97.
   - Interval spread is deterministic, so both devices compute identical schedules.
   - **Exam anchoring:**
     - In the 45 days before the profile's first paper, every Prelims atom not yet reviewed in that window falls due on a spread day inside it.
     - Mains-only atoms pause until the day after Prelims.
2. **Probe renderers for every format**, all working by touch and keyboard:
   - cloze (type, or recall and mark yourself)
   - true/false
   - statement set (mark each statement true or false, then the options unlock)
   - NOT-correct
   - match-the-list (tap to pair)
   - chronology (tap to order)
   - odd one out
   - Statement-I/II
   - identify
   - explain (type or dictate, then tick the key points)
   - contrast cards and PYQs, also supported
3. **Probe chooser.** For each due atom it picks the least recently used format, weighted by the profile's format mix. The atom itself, as a cloze or recall card, is always available.
4. **Review flow:** prompt → answer → confidence (Sure / 50-50 / Guess, before the reveal) → reveal with fact, explanation, mnemonic and source link → suggested rating with intervals, one tap to accept or change. The rating rule is exactly the build kit's.
5. **Error causes on every miss:** Didn't know, Forgot, Confused with…, Misread, Overthought, Silly, Trap word.
   - **Didn't know** resets the atom to new.
   - **Confused with…** searches for the other atom and logs the confusion pair.
   - **Misread** and **Trap word** go to the Trap Log with a trap tag.
   - **Silly** and **Overthought** count towards calibration.
   - Misses you skip with "Decide later" wait in Today under "Misses without a cause".
6. **Confusion engine.** A wrong option, pairing or position that belongs to another atom is logged automatically. Two hits within 30 days create a contrast card, scheduled the same day.
7. **Leeches.** After 6 lapses an atom is suspended and a Rebuild card opens with three fixes: write a mnemonic, split the atom into smaller atoms, or attach a contrast. Rebuilding unsuspends it.
8. **Queue builder in the data worker:**
   - It combines due atoms, learning steps and today's new atoms (30 by default).
   - Interleaving: never more than 3 in a row from one topic, and a new atom after every 5 reviews.
   - A daily cap, with any overflow shown honestly.
   - Speed: a 5,000-atom queue builds in about 20 ms, or about 130 ms on a 4× slowed CPU.
9. **Quick add** (Today, or a topic page): front, back, a searchable topic, and an optional source and page. The atom is yours (origin "self") and enters today's queue at once.
10. **Anki export** (Data): tab-separated Front, Back, Tags, Source, for chosen topics or all. Header lines tell Anki and AnkiDroid how to read it.

**Also added:**
- A **debug panel** (the FSRS button in a review, or Settings → Study) showing card state, stability, difficulty, recall now, due date, the four interval previews and the session log.
- **Practice**, from any topic or probe: drills that leave the schedule alone but still log causes and confusions.
- **Today**, the daily hub.

## Decisions I made

| Question | Decision |
| --- | --- |
| Daily review cap | Automatic from your weekday budget: 200 on a 3-hour day, scaled, between 50 and 400. You can set a fixed number in Settings → Study. Over the cap, the most-forgotten reviews come first, the rest carry over, and new atoms pause until the backlog clears. |
| Speed targets | 8 s per card unit (a cloze, or each statement, pair or item). Statement sets, NOT-correct, Statement-I/II and PYQs use the paper's time per question (72 s for GS-I). Free recall has no speed target. The card target is editable. |
| Confidence | Asked for every format except Explain. Tapping a confidence button is also the reveal, so it costs no extra tap. |
| "Previous Good" (for Easy) | The atom's last rating was Good or Easy. |
| Lapses | Standard FSRS lapses: a review card rated Again. The threshold of 6 can be changed in the hidden developer settings, for testing only. |
| Contrast cards | Shown once a day until answered right. A fresh mix-up outside the drill brings it back the same day. |

## Known limitations

- **Dictation** uses the device's speech service. On Android it can work offline with downloaded voices; on a laptop it usually needs a connection. The app says so when it fails.
- **Trap Log and calibration screens** are Phase 4. The data (trap tags, confidence accuracy, slips) is collected from now on.
- **AnkiDroid import** is tested only for the file format, not on a device. Choose the Basic note type when importing.
