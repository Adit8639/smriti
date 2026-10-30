// Lazy loader for the vendored pdf.js. Parsing and text extraction run in pdf.js's own
// worker; standard fonts and image decoders come from /vendor/pdfjs, so everything works
// offline once cached. The CJK character maps are not shipped: English and Hindi PDFs
// carry their own text maps, and a page that cannot be read just has no text.

let lib = null;
const BASE = new URL('../vendor/pdfjs/', import.meta.url).href;

export async function pdfjs() {
  if (!lib) {
    lib = await import('../vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.min.mjs`;
  }
  return lib;
}

// data: ArrayBuffer or Uint8Array. pdf.js takes ownership, so pass a copy you can spare.
export async function openPdf(data) {
  const p = await pdfjs();
  return p.getDocument({
    data,
    standardFontDataUrl: `${BASE}standard_fonts/`,
    wasmUrl: `${BASE}wasm/`,
    iccUrl: `${BASE}iccs/`,
    isEvalSupported: false,
    enableXfa: false,
  }).promise;
}

// Frees a document and its worker-side resources (pdf.js 6 destroys through the task).
export async function closePdf(doc) {
  if (!doc) return;
  if (typeof doc.destroy === 'function') await doc.destroy();
  else if (doc.loadingTask && typeof doc.loadingTask.destroy === 'function') await doc.loadingTask.destroy();
}

// Plain text of a page, with line breaks where pdf.js reports them.
export async function pageText(page) {
  const tc = await page.getTextContent();
  let out = '';
  for (const it of tc.items) {
    if (typeof it.str !== 'string') continue;
    out += it.str;
    out += it.hasEOL ? '\n' : (it.str && !/\s$/.test(it.str) ? ' ' : '');
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}
