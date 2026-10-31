# SMRITI (स्मृति)

An offline-first active-recall system for UPSC CSE (default profile: CSE 2028, optional Anthropology) and CAPF AC. It is a plain HTML/CSS/JavaScript web app, so there is no build step. Install it once from a static host; after that it runs fully offline on the laptop and the Android phone.

The engine holds no study content. Everything you study arrives as validated **content packs** (JSON files made with the Forge prompts in the build kit). Your packs, notes and progress stay in each device's browser storage. The hosted site holds only the code.

Build status: **Phases 1–6** (Foundation; Recall Engine; Learn Loop, Reader and Notes; Prelims Lab, Mocks and CSAT; Mains Studio, CA–Static Bridge and offline intake; Mission Planner, dashboard, Commute, Map and Timeline Labs). Phase 7 (optional laptop AI drafting) is not built. What each phase contains: [`docs/phase-1.md`](docs/phase-1.md) to [`docs/phase-6.md`](docs/phase-6.md). One test script for all six: [`docs/TESTING.md`](docs/TESTING.md).

## Run it

**Hosted (needed for the phone):** GitHub repository → Settings → Pages → *Deploy from a branch* → choose the branch and `/ (root)` → Save. After a minute or two the app is at `https://<user>.github.io/smriti/`. Open it in Chrome and install it (⋮ → *Add to Home screen* on Android; the install icon in the address bar on a laptop). Any static HTTPS host works, for example Cloudflare Pages or Netlify (upload the folder).

**Locally on a laptop:** browsers block JavaScript modules on `file://`, so double-clicking `index.html` does not work. Serve the folder instead:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. `localhost` counts as secure, so offline mode and install work there too. The data lives under that address, separate from the hosted copy.

**Self-tests:** open `tests/` (More → Settings → About → *Run the self-tests*; 98 tests). The page runs the validator, merge, rebuild, ULID, profile, integrity, FSRS, queue, calibration, CSAT, mock-builder, Mains, intake and planner tests, and end-to-end storage round trips on throwaway databases. Your real data is not touched.

## Layout

| Path | What it is |
| --- | --- |
| `index.html`, `app.css` | App shell and styles (system fonts, light/dark, mobile-first) |
| `sw.js` | Service worker: versioned, cache-first shell. Bump `VERSION` (and `js/version.js`) on every release |
| `manifest.webmanifest`, `icons/` | Install metadata |
| `js/` | One ES module per concern (see below) |
| `vendor/` | MiniSearch 7.2.0 (search, MIT), ts-fsrs 5.4.2 (FSRS scheduling, MIT), pdf.js 6.4.299 (PDF text and pages, Apache-2.0), ONNX Runtime Web 1.22.0 and all-MiniLM-L6-v2 (offline topic matching, MIT and Apache-2.0, loaded only on request), Natural Earth outline maps (public domain); see `vendor/README.md` |
| `profiles/` | Exam profiles as data: dates, phases, papers, starter syllabus |
| `packs/demo/` | Demo packs: 12 Polity topics; 30 atoms, 15 probes (every format), 5 PYQs, 3 CA items, 1 model answer, 1 note; `demo-source.pdf`, the 40-page Demo Source the atoms cite; and `demo-places-dates.json`, 15 places with map pins and 10 dated history facts for the Map and Timeline Labs |
| `tests/` | In-browser self-tests |
| `docs/` | Phase notes and test scripts |

`js/` modules:

- **Storage and events:** `db` (IndexedDB wrapper) · `ulid` · `clock` (app time and test clock) · `events` · `rebuild` (pure state rebuild) · `derived` (caches) · `store` (page state, event append) · `worker` (data worker) · `data` (worker client)
- **Content:** `schema` (pack validator) · `packs` · `backup` · `integrity` · `profiles` · `tree` · `search`
- **Recall engine:** `fsrs` (ts-fsrs wrapper) · `probes` (chooser, answer checking, rating rule) · `cloze` · `confusion` · `queue` · `study` · `session` (review player) · `probe-ui` (renderers) · `sheets` (cause, pickers, quick add) · `anki`
- **Learning:** `pdf` · `sources` · `links` · `dictate`
- **Prelims Lab:** `pyq` (statements in stems, truths from the key) · `calib` (marks, bands, EV, projection) · `csat` (generators) · `mockgen` (mock builder) · `weights` (recency-weighted PYQ counts) · `labdata` (worker side) · `rng` (seeded randomness)
- **Mains and current affairs:** `mains` (directives, dimensions, rubric, diffs) · `mains-ui` · `mains-flows` · `intake` (rule-based candidates) · `embed` and `embed-worker` (offline sentence model)
- **Planner and labs:** `mission` (priority, phases, missions, streak) · `dash` (dashboard data) · `charts` (SVG charts with table views) · `maps` (outline maps and pins)
- **Shell:** `pwa` · `ui` · `app` (boot, routes)
- **Screens:** `view-today`, `view-mission`, `view-review`, `view-leech`, `view-library`, `view-learn`, `view-notes`, `view-booklet`, `view-labs`, `view-lab`, `view-mock`, `view-csat`, `view-mains`, `view-ca`, `view-intake`, `view-commute`, `view-map`, `view-timeline`, `view-progress`, `view-weekly`, `view-more`, `view-sources`, `view-reader`, `view-quarantine`, `view-data`, `view-health`, `view-settings`

## How data works

- **Event log is the truth.** Every action appends `{id (ULID), deviceId, ts, type, payload}`. Atom, pack, settings and device states are caches rebuilt from the log by a pure function (`js/rebuild.js`).
- **Backup** writes all 13 stores to `smriti-backup-<device>-<date>.json`. **Import merges:** events are unioned by id, and content is upserted only when the incoming pack version is higher. Import never deletes, and caches are rebuilt afterwards. Importing the same file twice changes nothing. The `settings` and `cache` stores are exported but not merged, because they are device-local or derived.
- **Sync two devices:** export on one and import on the other, then the reverse. Both then hold the same events and the same state.
- **Quarantine:** atoms with `origin: "model"` or `verify: true` wait until you approve them. An approval holds only for the exact content approved: if a pack update changes the atom, it returns to Quarantine.
- **Reviews:** every answer is a `review.done` event. Its time, confidence, suggested and final rating and error cause go in follow-up `review.cause` events. FSRS card state is replayed from these, so both devices compute the same schedule.
- **Your own atoms** (quick add, Reader, splits) are `atom.created` events. The worker materialises them into the atoms store as pack `@self`, and a backup carries them as events.
- **Sources:** a PDF or its page text stays on the device that added it. Titles, page counts, topic mappings and pack links travel as events. The same file added on another device gets the same id (from its SHA-256) and links up. Photos of handwritten Mains answers also stay on the device that took them; the attempt and its scores sync.
- **Mocks, Mains attempts, missions, CA anchors, intake swipes** are all events too, so both devices compute the same calibration, dashboard and streak. A mock's answers count toward calibration only after its autopsy.
- **Device clocks:** events replay in time order. If one device's clock runs ahead, the other device simply replays the log in order; nothing is lost or double-counted.

## Schema notes (SMRITI SCHEMA v1 as implemented)

The schema in the build kit is the fixed contract. Where it leaves a detail open, the validator does this:

- **Atoms:** `source` is `{pack, page}` or `{pyq}`. `page` is required unless `origin` is `"model"`, and may be a number or a label such as `"xii"`. `answer` may be text or a number. More than 35 words gives a warning, not an error.
- **Probes by format:**
  - `cloze`: the stem contains `___`, plus a text `answer`.
  - `tf`: `statements` (one or more) or a stem with a boolean `answer`.
  - `statement`: 2–4 statements, 4 options and an option index.
  - `assertionReason`: exactly 2 statements (Statement-I and Statement-II), 4 options and an index.
  - `notCorrect`, `odd`, `identify`: 4 options and an index.
  - `match`: 3–4 `pairs`. Options are optional; if present, 4 plus an index.
  - `order`: 3 or more `items` in the correct order.
  - `explain`: `keyPoints`.
- **Trap tags:** a false statement should carry one of the nine trap tags (a missing tag is a warning; an unknown tag is an error).
- **PYQs:** whether a PYQ is objective or Mains comes from its paper's `type` in the exam profile. Paper ids must exist in an installed profile, because papers are data.
- **Notes** have no id in the schema. The app uses `<packId>.note.<node>.<level>`, so there is one note per node and level per pack.
- **`pack.report`** is required; its sub-fields are optional. `report.counts` is compared with the file to catch truncated Forge output.
- **Unknown fields** give warnings. Fields starting with `_` are reserved for the app.
- **Ids** must be unique across installed packs. For example, uninstall the demo before importing a real F0 syllabus pack that reuses its topic ids.
- **Versions:** a higher pack version updates the pack and removes items the new version dropped (the dry run shows them). The same version with different content is rejected; bump the version.
- **`sharedWith`** holds exam ids (e.g. `"capf-ac"`), so a node appears in that exam's Library too.
- **Model answers** have no topic links in the schema, so the Library shows them on their paper's top-level topic.
