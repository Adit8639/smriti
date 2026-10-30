// Small pure helpers shared by the page, the worker and the tests.

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// JSON with sorted keys, so equal objects always produce equal strings.
export function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',') + ']';
  if (isObj(v)) {
    return '{' + Object.keys(v).sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k]))
      .join(',') + '}';
  }
  const s = JSON.stringify(v);
  return s === undefined ? 'null' : s;
}

// Stored records carry app metadata in "_"-prefixed fields; content comparisons ignore them.
export function stripMeta(o) {
  const r = {};
  for (const k of Object.keys(o)) if (k[0] !== '_') r[k] = o[k];
  return r;
}

export const sameContent = (a, b) => stableStringify(stripMeta(a)) === stableStringify(stripMeta(b));

// FNV-1a, 32 bit. Used to detect whether an approved atom has since changed.
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const contentHash = (o) => fnv1a(stableStringify(stripMeta(o)));

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s) {
  if (typeof s !== 'string') return false;
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const pad = (n) => String(n).padStart(2, '0');

// Local calendar date (YYYY-MM-DD) of a millisecond timestamp.
export function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const utcOf = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export const daysBetween = (fromIso, toIso) => Math.round((utcOf(toIso) - utcOf(fromIso)) / 86400000);

export function addDays(iso, n) {
  const d = new Date(utcOf(iso) + n * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso) {
  if (!isIsoDate(iso)) return String(iso);
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatDateTime(ms) {
  const d = new Date(ms);
  return `${formatDate(localDate(ms))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export const wordCount = (s) => (typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0);

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// Turns a JSON.parse error into "line L, column C" when the engine reports a position.
export function describeJsonError(err, text) {
  const msg = String(err && err.message || err);
  const m = /position (\d+)/.exec(msg);
  if (!m) return msg;
  const pos = Number(m[1]);
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  const clean = msg.replace(/\s*\(line \d+ column \d+\)/, '').replace(/ in JSON at position \d+/, '');
  return `line ${line}, column ${col}: ${clean}`;
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'device';
