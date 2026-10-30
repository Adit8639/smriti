# Vendored third-party code

| Library | Version | Files | Licence | Source |
| --- | --- | --- | --- | --- |
| MiniSearch | 7.2.0 | `minisearch/minisearch.js` (npm `dist/es/index.js`, source-map comment removed) | MIT, see `minisearch/LICENSE.txt` | https://www.npmjs.com/package/minisearch |
| ts-fsrs | 5.4.2 | `ts-fsrs/ts-fsrs.umd.js` (npm `dist/index.umd.js`, source-map comment removed); loaded as a side-effect module that sets `globalThis.FSRS` | MIT, see `ts-fsrs/LICENSE` | https://www.npmjs.com/package/ts-fsrs |
| pdf.js | 6.4.299 | `pdfjs/pdf.min.mjs`, `pdfjs/pdf.worker.min.mjs` (npm `pdfjs-dist` modern build), `standard_fonts/`, `wasm/` (OpenJPEG, JBIG2, QCMS decoders), `iccs/`. The CJK character maps (`cmaps/`) are left out: they are only needed for Chinese, Japanese and Korean PDFs | Apache-2.0, see `pdfjs/LICENSE`; font and decoder licences beside them | https://www.npmjs.com/package/pdfjs-dist |

Nothing is loaded from a CDN at runtime; everything is in the service worker's offline cache. To update a library, replace its files here, list them in `sw.js` ASSETS and bump the app version.
