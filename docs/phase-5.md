# Phase 5: Mains Studio, CA–Static Bridge, Offline Intake

Status: built and tested in headless Chromium at phone and laptop sizes, including the offline topic-matching model. A real-device test is still to come (see [TESTING.md](TESTING.md)).

## What was built

1. **Mains Studio** (**Labs → Mains Studio**, `#/mains`), with tabs Write, Toolkit, Value-adds and History:
   - **Directive decoder:** the twelve directives (Discuss, Examine, Critically examine, Analyse, Evaluate, Comment, Elucidate, Explain, Justify, Illustrate, Enumerate, Describe), each with what it asks, the structure it expects and a one-line check. Every question you practise shows its directive. A **drill** asks "which directive is this answer obeying?".
   - **Skeleton Sprint:** N questions × 90 seconds each: an intro line, 4–6 dimension headings with one value-add each, and a way forward. Type or dictate. Saved as attempts; **compare** two attempts or an attempt and the model answer.
   - **Timed answer:** 10-marker 7 minutes / 150 words, 15-marker 11 minutes / 250 words (from the profile, editable). Write on paper, attach a **photo** (kept only on this device), then self-score the rubric: demand addressed, structure, dimensions, value-add, diagram, conclusion (0–2 each, out of 12).
   - **Compare:** your answer next to the linked model answer, which of its dimensions you missed, and the value-add types each of you used.
   - **Shadow Writing:** a model answer shows for 120 seconds, then hides; you rebuild its skeleton from memory and see the diff (recalled, dropped, yours only).
   - **Value-add bank** per topic: Articles, judgments, committees, reports and indices, data with year, schemes, examples, quotes and diagram ideas, each an atom you can drill.
   - **Dimension wheel** (editable in Toolkit): political, economic, social, technological, legal-constitutional, environmental, ethical, administrative, international, security, historical, geographical.
   - **GS-IV case mode** (15 minutes): stakeholders → values in conflict → options with pros and cons → your course, justified.
   - **Essay mode:** theme → 15-minute brainstorm along the wheel → 10-minute outline sprint → intro and conclusion drafts, with the quote bank to hand. The CAPF profile adds **précis** (the one-third rule with a live word counter) and **counter-argument** drills.
2. **CA–Static Bridge** (**Labs → CA–Static Bridge**, `#/ca`):
   - **A CA item** reads: why in news → static anchors (topic chips) → Prelims atoms → Mains angle → probable questions, plus connected stories and the related PYQs and static atoms.
   - **Static topic pages** show "In the news" chips.
   - **Shelf life:** CA atoms count for Prelims until their event date + their shelf life (540 days unless the pack sets its own; intake gives reports and indices 900), then archive. Archived facts leave the review queue but stay searchable.
   - **Reconciliation:** a month can be marked done only when every item in it is anchored to a static topic.
3. **Offline PDF intake** (**Labs → Intake**, `#/intake`), no AI and no internet:
   - **Candidates by rules**, in the data worker: sentences with Article, Schedule or Amendment numbers, years, percentages, ₹ / crore / lakh, the verbs that mark exam facts (launched, established, headquartered, ratified, signed, located…), rivers, national parks, tiger reserves, Ramsar sites, indices, reports, rankings, ministries and schemes. Each gets a cloze target.
   - **Duplicates dropped:** token Jaccard ≥ 0.8 against your existing atoms.
   - **Topic suggestions** by keyword, then (optional) **sharpened by meaning** with a small offline sentence model (all-MiniLM-L6-v2). It downloads once (about 34 MB) the first time you ask, then works offline.
   - **Triage deck:** the cloze first, then the sentence. Swipe right to keep (an atom with its source page, origin "rule"), left to discard, up to edit; arrow keys on a laptop. Every swipe is logged as a recall event. Current-affairs intakes carry the CA date and shelf life onto kept atoms.
   - **Related items:** each kept CA fact suggests the top 3 related PYQs and static atoms.

## Decisions I made

| Question | Decision |
| --- | --- |
| Sentence model | The build kit names Transformers.js. I used the same kind of model (all-MiniLM-L6-v2, int8) on ONNX Runtime Web directly with a small built-in tokenizer: fewer files, no CDN, and it fits the offline cache. It is never loaded unless you tap **Sharpen**, and it lives in its own cache, so app updates do not download it again. |
| How suggestions combine | 60% meaning (cosine similarity to topic descriptions) and 40% keywords, so a topic with a clear keyword match is not lost. |
| Answer photos | Kept on the device that took them (like source PDFs); the attempt and its scores sync. |
| Shelf life | 540 days from the event date, 900 for reports and indices, which stay relevant longer. Pack atoms can set their own `shelfLifeDays`. |
| Reconciliation | Strict: a month cannot be marked done with an unanchored item. |

## Known limitations

- Intake works on PDFs with a text layer; scanned PDFs need OCR, which is not available offline.
- Rule-based candidates include some noise; triage is where you filter it (about 5 seconds a card).
- The rubric is self-scored: the app checks structure and word limits but cannot read your handwriting.
