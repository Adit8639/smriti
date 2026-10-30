// DOM helpers: element builder, toasts, bottom sheets, file download/share.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

const ICONS = {
  library: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.6l3.8 1 -3.9 14.6 -3.8-1z"/>',
  shield: '<path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z"/><path d="M8.5 12l2.5 2.5 4.5-5" fill="none"/>',
  data: '<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" fill="none"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" fill="none"/>',
  chevron: '<path d="M9 6l6 6-6 6" fill="none"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5" fill="none"/><path d="M15.5 15.5L21 21" fill="none"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" fill="none"/>',
};

export function icon(name, cls = 'icon') {
  const span = document.createElement('span');
  span.className = cls;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="currentColor" fill-opacity="0.12">${ICONS[name] || ''}</svg>`;
  return span;
}

let toastTimer = null;
export function toast(message, { kind = 'info', ms = 4000 } = {}) {
  const el = document.getElementById('toast');
  el.className = `toast ${kind}`;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// Bottom sheet. Returns {el, body, close}. actions: [{label, kind, onClick, disabled}]
let openSheet = null;
export function sheet({ title, body, actions = [], onClose, wide = false }) {
  if (openSheet) openSheet.close();
  const root = document.getElementById('sheet-root');
  const prevFocus = document.activeElement;
  const bodyEl = h('div', { class: 'sheet-body' }, body);
  const bar = h('div', { class: 'sheet-actions' });
  const panel = h('div', { class: `sheet${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('h2', { text: title }),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => api.close() }, icon('close'))),
    bodyEl, bar);
  const backdrop = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === backdrop) api.close(); } }, panel);
  const api = {
    el: panel,
    body: bodyEl,
    setActions(list) {
      clear(bar);
      for (const a of list) {
        bar.append(h('button', { class: `btn ${a.kind || ''}`, disabled: a.disabled, onclick: a.onClick }, a.label));
      }
      bar.hidden = !list.length;
    },
    close() {
      if (openSheet !== api) return;
      openSheet = null;
      backdrop.remove();
      document.body.classList.remove('sheet-open');
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      if (onClose) onClose();
    },
  };
  api.setActions(actions);
  root.append(backdrop);
  document.body.classList.add('sheet-open');
  openSheet = api;
  const first = panel.querySelector('.sheet-actions .btn:not([disabled])') || panel.querySelector('button');
  if (first) first.focus();
  return api;
}

export const closeSheet = () => { if (openSheet) { openSheet.close(); return true; } return false; };

export function confirmSheet({ title, message, confirmLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const s = sheet({
      title,
      body: typeof message === 'string' ? h('p', { text: message }) : message,
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        { label: 'Cancel', onClick: () => s.close() },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => { answered = true; s.close(); resolve(true); } },
      ],
    });
  });
}

export function download(fileName, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Android: hands the file to the share sheet (e.g. Google Drive). Returns false when the
// browser cannot share files or the sheet was dismissed, so the caller saves a download
// instead and a backup file always exists.
export async function shareFile(fileName, text, mime = 'application/json') {
  if (!navigator.canShare) return false;
  const file = new File([text], fileName, { type: mime });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: fileName });
    return true;
  } catch (e) {
    return false;
  }
}

export const canShareFiles = () => {
  try {
    return !!navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] });
  } catch (_) {
    return false;
  }
};

export function readFiles(input) {
  return Promise.all([...input.files].map(async (f) => ({ name: f.name, text: await f.text() })));
}

// A list of {path, msg} as readable lines, capped.
export function issueList(items, kind, cap = 60) {
  if (!items || !items.length) return null;
  const shown = items.slice(0, cap);
  return h('ul', { class: `issues ${kind}` },
    shown.map((x) => h('li', null, x.path ? h('code', { text: x.path }) : null, x.path ? ' ' : null, x.msg)),
    items.length > cap ? h('li', { text: `…and ${items.length - cap} more` }) : null);
}
