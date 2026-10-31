// Data health (#/health): storage per store, persistence, the last export from each device,
// and an integrity check (orphans, broken references, leftovers) with one-tap repair.

import { h, add, clear, toast, confirmSheet } from './ui.js';
import { app, appendEvents, applyDerived, setSetting, emit } from './store.js';
import { call } from './data.js';
import { storageInfo, requestPersist } from './pwa.js';
import { exportNow } from './view-data.js';
import { canShareFiles } from './ui.js';
import { formatBytes, formatDateTime, plural, localDate, daysBetween } from './util.js';
import * as clock from './clock.js';

const STORE_LABEL = { settings: 'Settings (this device)', profiles: 'Exam profiles', nodes: 'Topics', packs: 'Packs', atoms: 'Atoms', probes: 'Probes', pyqs: 'PYQs and mock questions', ca: 'Current affairs', answers: 'Model answers', notes: 'Notes', sources: 'Sources and photos (this device)', events: 'Event log', cache: 'Caches (rebuilt as needed)' };

export async function render() {
  const root = h('div', { class: 'health' }, h('p', { class: 'muted small', text: 'Checking…' }));
  draw(root).catch((e) => { clear(root).append(h('div', { class: 'card error' }, h('p', { text: `Could not check: ${e.message}` }))); });
  return root;
}

async function draw(root) {
  const [scan, info] = await Promise.all([call('health.scan'), storageInfo()]);
  const integ = scan.integrity;
  const staleOlder = Object.values(integ.stale || {}).reduce((a, b) => a + b, 0);
  const problems = integ.orphans.length + scan.stale + staleOlder;
  const devices = Object.entries(app.state.devices).map(([id, d]) => ({ id, ...d })).sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  const local = (await app.db.getAll('settings')).filter((r) => r.key.startsWith('intake.') || r.key.startsWith('mockp.'));
  const doneLocal = local.filter((r) => {
    if (r.key.startsWith('mockp.')) { const m = app.state.mocks[r.key.slice(6)]; return !r.value || !m || m.status !== 'started'; }
    const b = r.value;
    return b && b.candidates && Object.keys(b.decisions || {}).length >= b.candidates.length && daysBetween(localDate(b.createdAt), localDate(clock.now())) > 30;
  });
  const repairBtn = h('button', { class: `btn ${problems ? 'primary' : ''}`, type: 'button' }, 'Repair now');
  repairBtn.onclick = async () => {
    const ok = await confirmSheet({ title: 'Repair data?', message: 'Removes content left by uninstalled packs and by older pack versions, rebuilds every cache from the event log and refreshes search. Your events (all learning history) are never touched.', confirmLabel: 'Repair' });
    if (!ok) return;
    repairBtn.disabled = true;
    repairBtn.textContent = 'Repairing…';
    try {
      const r = await call('health.repair');
      await applyDerived(r.derived);
      for (const x of doneLocal) await setSetting(x.key, null);
      await appendEvents([['data.repaired', { actions: ['stale-packs', 'older-versions', 'rebuild', 'search'], counts: { removed: r.removed, older: r.older, local: doneLocal.length } }]]);
      toast(`Repaired: ${r.removed + r.older} leftover items removed, ${plural(r.events, 'event')} replayed.`, { kind: 'ok', ms: 6000 });
      emit('rerender');
    } catch (e) {
      toast(`Repair failed: ${e.message}`, { kind: 'error', ms: 8000 });
      repairBtn.disabled = false;
      repairBtn.textContent = 'Repair now';
    }
  };
  add(clear(root),
    h('section', { class: `card ${problems ? 'warn' : 'ok'}` },
      h('h2', { text: 'Data health' }),
      h('p', { text: problems ? `${plural(problems, 'issue')} found.` : 'No problems found.' }),
      h('ul', { class: 'plain small' },
        h('li', { text: `${plural(integ.orphans.length, 'item')} with references to content that is not installed (orphans).` }),
        h('li', { text: `${plural(scan.stale, 'item')} left by packs that are no longer installed.` }),
        h('li', { text: `${plural(staleOlder, 'item')} left from older versions of installed packs.` }),
        h('li', { text: `${plural(integ.orphanStates.length, 'learning record')} for atoms not installed (kept on purpose: reinstalling the pack reconnects them).` }),
        doneLocal.length ? h('li', { text: `${plural(doneLocal.length, 'finished item')} of device-only clutter (old intakes, finished mock progress).` }) : null),
      repairBtn,
      app.state.repairs.length ? h('p', { class: 'small muted', text: `Last repair: ${formatDateTime(app.state.repairs[app.state.repairs.length - 1].ts)}.` }) : null),
    integ.orphans.length ? h('details', { class: 'card' }, h('summary', null, h('strong', { text: `Orphans (${integ.orphans.length})` })),
      h('p', { class: 'small muted', text: 'Usually fixed by installing the pack they refer to (for example the syllabus pack for topic ids). Repair does not delete them: they may still be useful.' }),
      h('ul', { class: 'plain small' }, integ.orphans.slice(0, 50).map((o) => h('li', null, h('code', { text: o.id }), ` (${o.store}, ${o.pack}): missing ${o.missing.slice(0, 3).join(', ')}${o.missing.length > 3 ? '…' : ''}`)))) : null,
    h('section', { class: 'card' },
      h('h3', { text: 'Storage' }),
      h('p', { class: 'small', text: `${info.usage !== null ? `${formatBytes(info.usage)} used` : 'Usage unknown'}${info.quota ? ` of about ${formatBytes(info.quota)} available` : ''}. Persistent: ${info.persisted === true ? 'granted' : info.persisted === false ? 'not yet' : 'unknown'}.` }),
      info.persisted !== true ? h('button', { class: 'btn small', type: 'button', onclick: async () => { const g = await requestPersist(); toast(g ? 'Storage is now persistent.' : 'The browser did not grant persistence yet; installing the app usually helps.', { kind: g ? 'ok' : 'warn' }); emit('rerender'); } }, 'Request persistent storage') : null,
      h('div', { class: 'table-wrap' }, h('table', { class: 'counts-table compact' },
        h('thead', null, h('tr', null, ['Store', 'Records', 'Size'].map((x) => h('th', { text: x })))),
        h('tbody', null, scan.stores.map((s) => h('tr', null, h('th', { text: STORE_LABEL[s.store] || s.store }), h('td', { text: String(s.records) }), h('td', { text: formatBytes(s.bytes) }))))))),
    h('section', { class: 'card' },
      h('h3', { text: 'Backups by device' }),
      h('table', { class: 'counts-table compact' }, h('thead', null, h('tr', null, ['Device', 'Events', 'Last export'].map((x) => h('th', { text: x })))),
        h('tbody', null, devices.map((d) => h('tr', null, h('th', { text: `${d.id === app.device.deviceId ? `${app.device.name} (this device)` : d.name || `device …${d.id.slice(-4)}`}` }), h('td', { text: String(d.events) }), h('td', { text: d.lastExportTs ? formatDateTime(d.lastExportTs) : 'never' }))))),
      h('button', { class: 'btn small', type: 'button', onclick: () => exportNow(canShareFiles()) }, 'Back up now')));
}
