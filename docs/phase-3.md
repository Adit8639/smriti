# Phase 3: Learn Loop, Reader, Shrink-Wrap Notes

Status: built and tested in headless Chromium at phone and laptop sizes. A real phone test is still to come (see [TESTING.md](TESTING.md)).

## What was built

1. **Sources** (the Sources tab):
   - **Adding a PDF.** On a laptop the whole file is kept. A phone defaults to **text only**: the page text plus small page images, to save space.
   - **Extraction.** Text is extracted page by page with the vendored pdf.js 6.4 (parsing runs in pdf.js's worker). Nothing is uploaded.
   - **Same file, same id.** A source's id comes from the file's SHA-256, so the same PDF added on two devices links up.
   - **Pack link.** You can link a PDF to the pack it is the source of, with a page offset; atom source links then open its pages.
   - **Topic mapping.** Map sources to topics with page ranges. Suggestions come from the linked pack's cited pages, or else from topic keywords.
2. **Reader:**
   - **Views.** Page view (the rendered PDF with selectable text) or text view; text-only sources show the text with the page image behind a toggle.
   - **Make atom.** Select text and tap **Make atom**. It is pre-filled with the text, the source page, a suggested topic (the mapped topic for that page) and one-tap cloze targets: numbers, years, Article, Schedule and Amendment numbers, and names.
   - **Source links.** Every atom's source link opens the Reader at its page, offline too.
3. **Learn Loop** per topic: five steps that cannot be skipped forward. Progress is saved after each step; leave any time and resume from Today or the topic page.
   1. **Pre-test:** up to 5 of the topic's PYQs or probes. Misses are expected and do not touch the schedule.
   2. **Read:** the topic's mapped source pages, with a timer. Capture atoms as you read. With no source mapped, you read the topic's atoms and notes instead.
   3. **Blank-page recall:** only the title is shown. Type or dictate, then tick what you recalled. Below 70% the topic stays Learning and the missed atoms are due today.
   4. **Probe set:** up to 10 interleaved probes, at least 3 from older topics once you have them. These are real reviews.
   5. **Output:** a 90-second Mains skeleton (intro line, 4 headings, way forward) for a PYQ, a probable question, or the topic itself.
4. **Shrink-Wrap Notes** per topic:
   - **Levels and caps.** R1 300 words, R2 150, R3 60, R4 12 keywords. A live counter blocks saving over the cap.
   - **Writing.** Each level is written from memory with the previous one hidden.
   - **After saving.** Your previous level appears side by side with the new one, plus any pack note at that level. Then the atom checklist: mark what you dropped, and optionally review those atoms today.
   - **Counts.** Revision counts are kept per topic and per source.
5. **Source budget:** a warning when a topic gets a third source ("Limited sources, more revisions").
6. **Micro-booklet** (a topic's Notes → Booklets): the latest level of each topic under a subject, compiled into one clean printable page (Print, or Save as PDF). Untick topics to leave them out.

The demo now includes **Demo Source** (`packs/demo/demo-source.pdf`, 40 pages). Each demo atom's fact sits on the page it cites, so the source links can be tested ("Try the demo source" on the Sources tab).

## Decisions I made

| Question | Decision |
| --- | --- |
| PDF storage on the phone | Text and page images by default (about 10–40 KB per page); the laptop keeps the PDF. You can choose either on any device. |
| Topics with few atoms | The probe set uses each atom's probes and its plain card; any probe comes back at most once, later in the set, rather than padding with near-duplicates. A first loop has no older topics to mix in. |
| Read step without a source | Shows the topic's atoms, notes and current affairs, so the loop still works before you add your books. |
| Source budget | A warning, not a block: you decide. |

## Known limitations

- **Scanned PDFs** have no text layer. Their pages show, but there is no text to select; OCR is not available offline, as the build kit notes.
- **Page offsets.** When a book's printed page numbers differ from the PDF's page numbers, set the offset once under Sources → Pack link.
- **Keyword suggestions** for topic mapping are approximate. Suggestions from a linked pack's pages are precise.
- **Large PDFs.** Page view of very large or complex PDFs can be slow on an older phone; text-only mode avoids that.
