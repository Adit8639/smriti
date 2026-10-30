// App clock. Everything that stamps or compares time goes through now(), so the hidden
// test clock in Settings can move the whole app forward or back for time-travel testing.

let offsetMs = 0;

export const now = () => Date.now() + offsetMs;
export const getOffset = () => offsetMs;
export function setOffset(ms) {
  offsetMs = Number.isFinite(ms) ? Math.round(ms) : 0;
}
