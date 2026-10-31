# Vendored third-party code

| Library | Version | Files | Licence | Source |
| --- | --- | --- | --- | --- |
| MiniSearch | 7.2.0 | `minisearch/minisearch.js` (npm `dist/es/index.js`, source-map comment removed) | MIT, see `minisearch/LICENSE.txt` | https://www.npmjs.com/package/minisearch |
| ts-fsrs | 5.4.2 | `ts-fsrs/ts-fsrs.umd.js` (npm `dist/index.umd.js`, source-map comment removed); loaded as a side-effect module that sets `globalThis.FSRS` | MIT, see `ts-fsrs/LICENSE` | https://www.npmjs.com/package/ts-fsrs |
| pdf.js | 6.4.299 | `pdfjs/pdf.min.mjs`, `pdfjs/pdf.worker.min.mjs` (npm `pdfjs-dist` modern build), `standard_fonts/`, `wasm/` (OpenJPEG, JBIG2, QCMS decoders), `iccs/`. The CJK character maps (`cmaps/`) are left out: they are only needed for Chinese, Japanese and Korean PDFs | Apache-2.0, see `pdfjs/LICENSE`; font and decoder licences beside them | https://www.npmjs.com/package/pdfjs-dist |
| ONNX Runtime Web | 1.22.0 | `ort/ort.wasm.bundle.min.mjs`, `ort/ort-wasm-simd-threaded.mjs`, `ort/ort-wasm-simd-threaded.wasm` (npm `onnxruntime-web` WASM build, source-map comment removed) | MIT, see `ort/LICENSE` | https://www.npmjs.com/package/onnxruntime-web |
| Natural Earth outlines | `natural-earth-vector` GeoJSON, master branch (October 2026) | `maps/india.json` (about 157 KB), `maps/world.json` (about 123 KB): simplified, pre-projected outlines built from Natural Earth admin-0 (India point of view), admin-1 and 1:50m rivers; see `maps/README.md` | Public domain | https://github.com/nvkelso/natural-earth-vector |
| all-MiniLM-L6-v2 (int8 ONNX) | sha256 `afdb6f1a…bdb1` | `minilm/all-MiniLM-L6-v2-q8.onnx`, `minilm/vocab.txt`, redistributed unmodified from npm `@clay-design-system/embeddings` 0.22.0 | Apache-2.0, see `minilm/LICENSE` and `minilm/NOTICE` (sentence-transformers, Microsoft MiniLM) | https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 |

The topic-matching model and its runtime (about 34 MB) are **not** in the install cache: they load the first time you sharpen intake suggestions, then stay in a separate cache (`smriti-lazy-v1`) that survives app updates, so they work offline afterwards.

Nothing is loaded from a CDN at runtime; everything is in the service worker's offline cache. To update a library, replace its files here, list them in `sw.js` ASSETS and bump the app version.
