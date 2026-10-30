// ULID: 48-bit millisecond time + 80 random bits, Crockford base32, 26 characters.
// Monotonic within this module: ids made in the same (or an earlier) millisecond increment
// the random part, so ids from one device always sort in creation order.

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

let lastTime = -1;
let lastRand = null;

function randomDigits() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b & 31);
}

function increment(digits) {
  const d = digits.slice();
  for (let i = d.length - 1; i >= 0; i--) {
    if (d[i] < 31) { d[i]++; return d; }
    d[i] = 0;
  }
  throw new Error('ULID random part overflowed within one millisecond');
}

export function ulid(time = Date.now()) {
  let t = Math.floor(time);
  if (!Number.isFinite(t) || t < 0 || t > 281474976710655) throw new Error(`ULID time out of range: ${time}`);
  if (t <= lastTime) {
    t = lastTime;
    lastRand = increment(lastRand);
  } else {
    lastTime = t;
    lastRand = randomDigits();
  }
  let head = '';
  for (let i = 0; i < 10; i++) {
    head = ENC[t % 32] + head;
    t = Math.floor(t / 32);
  }
  return head + lastRand.map((i) => ENC[i]).join('');
}

export function decodeTime(id) {
  let t = 0;
  for (let i = 0; i < 10; i++) t = t * 32 + ENC.indexOf(id[i]);
  return t;
}
