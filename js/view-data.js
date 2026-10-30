// Data: event log summary, pack import (dry run → commit), installed packs and uninstall,
// backup export/import with merge, and the node index for Forge prompts.

import { h, toast, sheet, confirmSheet, download, shareFile, canShareFiles, readFiles, issueList } from './ui.js';
import { app, allNodes, activeProfile, applyDerived, workerCtx, setSetting, getSetting } from './store.js';
import { call } from './data.js';
import { nodeIndex, inProfileScope } from './tree.js';
import { ankiTsv } from './anki.js';
import { quarantineStatus } from './rebuild.js';
import { sourceLabel } from './view-library.js';
import * as clock from './clock.js';
import { formatDate, formatDateTime, localDate, daysBetween, plural, slug } from './util.js';
import { CONTENT_STORES } from './db.js';

const STORE_LABEL = { nodes: 'Topics (nodes)', atoms: 'Atoms', probes: 'Probes', pyqs: 'PYQs', ca: 'CA items', answers: 'Model answers', notes: 'Notes', packs: 'Packs', profiles: 'Profiles', sources: 'Sources' };
const ACTION = {
  install: ['New pack', 'ok'],
  update: ['Update', 'ok'],
  repair: ['Adds missing items', 'ok'],
  unchanged: ['Already installed — nothing to import', 'muted'],
  reject: ['Rejected — nothing will be imported', 'error'],
};

const deviceLabel = (id) => {
  if (id === app.device.deviceId) return `${app.device.name} (this device)`;
  const d = app.state.devices[id];
  return d && d.name ? d.name : `device …${id.slice(-4)}`;
};

// ---------------------------------------------------------------- pack import

function countsTable(counts, cols) {
  const rows = Object.entries(counts).filter(([, c]) => cols.some((k) => c[k]));
  if (!rows.length) return null;
  return h('table', { class: 'counts-table' },
    h('thead', null, h('tr', null, h('th', { text: '' }), cols.map((k) => h('th', { text: k })))),
    h('tbody', null, rows.map(([s, c]) => h('tr', null, h('th', { text: STORE_LABEL[s] || s }), cols.map((k) => h('td', { class: c[k] ? '' : 'zero', text: String(c[k] || 0) }))))));
}

function entryView(e) {
  const [label, kind] = ACTION[e.action];
  const ver = e.action === 'update' ? ` v${e.installedVersion} → v${e.version}` : e.version ? ` v${e.version}` : '';
  const t = e.totals;
  return h('section', { class: `card entry ${kind}` },
    h('div', { class: 'item-head' }, h('span', { class: `badge ${kind}`, text: `${label}${e.action === 'update' ? ver : ''}` })),
    h('h3', { class: 'item-title', text: e.title || e.fileName }),
    h('p', { class: 'small muted' }, h('code', { text: e.packId || '?' }), `${e.action === 'update' ? '' : ver} · ${e.fileName}`),
    e.action !== 'reject' ? h('p', { class: 'totals' }, `${t.new} new · ${t.updated} updated · ${t.unchanged} unchanged · ${t.removed} removed`) : null,
    e.action !== 'reject' ? countsTable(e.counts, ['new', 'updated', 'unchanged', 'removed']) : null,
    e.errors.length ? h('div', null, h('h4', { text: `Errors (${e.errors.length})` }), issueList(e.errors, 'error')) : null,
    e.orphans ? h('p', { class: 'small warn-text', text: `${plural(e.orphans, 'item')} will be marked orphaned (references not installed).` }) : null,
    e.warnings.length ? h('details', { open: e.warnings.length <= 5 && !e.errors.length ? true : null },
      h('summary', { text: `Warnings (${e.warnings.length})` }), issueList(e.warnings, 'warn')) : null);
}

async function previewPacks(files) {
  let plan;
  try {
    plan = await call('packs.plan', { files });
  } catch (e) {
    toast(`Could not read the files: ${e.message}`, { kind: 'error' });
    return;
  }
  showPlan(plan);
}

function showPlan(plan) {
  const writable = plan.entries.filter((e) => ['install', 'update', 'repair'].includes(e.action));
  const rejected = plan.entries.filter((e) => e.action === 'reject').length;
  const body = h('div', null,
    h('p', { class: 'intro', text: writable.length
      ? `Dry run: nothing is saved until you press Import.${rejected ? ` ${plural(rejected, 'file')} rejected and will be skipped.` : ''}`
      : rejected ? 'Nothing can be imported. Fix the errors below and choose the file again.' : 'Nothing to import: these packs are already installed with identical content (0 new, 0 updated).' }),
    plan.entries.map(entryView));
  let committed = false;
  const s = sheet({
    title: 'Import packs',
    body,
    wide: true,
    onClose: () => { if (!committed) call('pending.drop', { token: plan.token }); },
    actions: writable.length
      ? [
        { label: 'Cancel', onClick: () => s.close() },
        {
          label: `Import ${plural(writable.length, 'pack')}`, kind: 'primary',
          onClick: async () => {
            s.setActions([{ label: 'Importing…', disabled: true }]);
            try {
              const r = await call('packs.commit', { token: plan.token, ctx: workerCtx() });
              committed = true;
              if (r.stale) { s.close(); toast('Your data changed since the preview; please review again.', { kind: 'warn' }); showPlan(r); return; }
              s.close();
              await applyDerived(r.derived);
              const t = r.done.reduce((a, d) => ({ new: a.new + d.totals.new, updated: a.updated + d.totals.updated }), { new: 0, updated: 0 });
              toast(`Imported ${plural(r.done.length, 'pack')}: ${t.new} new, ${t.updated} updated.`, { kind: 'ok' });
            } catch (e) {
              s.close();
              toast(`Import failed, nothing was saved: ${e.message}`, { kind: 'error', ms: 8000 });
            }
          },
        },
      ]
      : [{ label: 'OK', kind: 'primary', onClick: () => s.close() }],
  });
}

async function tryDemo() {
  try {
    const base = new URL('packs/demo/', document.baseURI);
    const list = await (await fetch(new URL('index.json', base))).json();
    const files = await Promise.all(list.map(async (f) => {
      const r = await fetch(new URL(f, base));
      if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
      return { name: f, text: await r.text() };
    }));
    await previewPacks(files);
  } catch (e) {
    toast(`Demo pack unavailable: ${e.message}`, { kind: 'error' });
  }
}

async function uninstall(p) {
  const pre = await call('packs.uninstallPreview', { packId: p.id });
  const what = Object.entries(pre.counts).map(([s, n]) => `${n} ${(STORE_LABEL[s] || s).toLowerCase()}`).join(', ') || 'no items';
  const ok = await confirmSheet({
    title: `Uninstall ${p.title}?`,
    message: h('div', null,
      h('p', { text: `Removes ${what}.` }),
      h('p', { text: `Your event log is kept${pre.history ? `, including review history for ${plural(pre.history, 'atom')} that becomes orphaned` : ''}. Reinstalling the pack later reconnects it.` }),
      h('p', { class: 'small muted', text: 'Importing a backup from a device that still has this pack will not bring it back.' })),
    confirmLabel: 'Uninstall',
    danger: true,
  });
  if (!ok) return;
  try {
    const r = await call('packs.uninstall', { packId: p.id, ctx: workerCtx() });
    await applyDerived(r.derived);
    toast(`Uninstalled ${p.title}.${r.derived.summary.orphans ? ` ${plural(r.derived.summary.orphans, 'item')} elsewhere now orphaned.` : ''}`, { kind: 'ok' });
  } catch (e) {
    toast(`Uninstall failed: ${e.message}`, { kind: 'error' });
  }
}

function packCard(p) {
  const life = app.state.packs[p.id];
  const stale = app.derived.integrity && app.derived.integrity.stale[p.id];
  const counts = CONTENT_STORES.filter((s) => p.counts[s]).map((s) => `${p.counts[s]} ${(STORE_LABEL[s] || s).toLowerCase()}`).join(' · ');
  return h('article', { class: 'card item', tabindex: '0', 'data-nav': '' },
    h('div', { class: 'item-head' }, h('span', { class: 'badge', text: p.kind }), h('span', { class: 'badge muted', text: `v${p.version}` }), h('code', { class: 'item-id', text: p.id })),
    h('h3', { class: 'item-title', text: p.title }),
    h('p', { class: 'small', text: counts || 'empty' }),
    h('p', { class: 'small muted', text: `Source: ${p.source ? p.source.title : '—'} · exams: ${(p.exam || []).join(', ')} · installed ${formatDate(localDate(p._installedAt))}${p._updatedAt !== p._installedAt ? `, updated ${formatDate(localDate(p._updatedAt))}` : ''}` }),
    life && life.installed === false ? h('p', { class: 'small warn-text', text: `Uninstalled on ${deviceLabel(life.deviceId)} on ${formatDate(localDate(life.ts))}; still installed here.` }) : null,
    stale ? h('p', { class: 'small warn-text' }, `${plural(stale, 'item')} left from an older version of this pack. `,
      h('button', { class: 'btn small', onclick: async () => { const r = await call('packs.cleanStale', { packId: p.id }); await applyDerived(r.derived); toast(`Removed ${plural(r.removed, 'old item')}.`, { kind: 'ok' }); } }, 'Clean up')) : null,
    h('div', { class: 'card-actions' }, h('button', { class: 'btn danger', onclick: () => uninstall(p) }, 'Uninstall')));
}

// ---------------------------------------------------------------- backup

export async function exportNow(share = false) {
  try {
    const r = await call('backup.export', { ctx: workerCtx() });
    let shared = false;
    if (share) shared = await shareFile(r.fileName, r.text);
    if (!shared) download(r.fileName, r.text);
    await applyDerived(r.derived);
    toast(`Backup ${shared ? 'shared' : 'saved'}: ${r.fileName} (${plural(r.counts.events, 'event')}).`, { kind: 'ok', ms: 6000 });
  } catch (e) {
    toast(`Export failed: ${e.message}`, { kind: 'error' });
  }
}

async function previewBackup(file) {
  let plan;
  try {
    plan = await call('backup.plan', { name: file.name, text: file.text });
  } catch (e) {
    toast(`Could not read the backup: ${e.message}`, { kind: 'error' });
    return;
  }
  if (plan.errors && plan.errors.length) {
    const s = sheet({ title: 'Backup rejected', body: h('div', null, h('p', { text: `${file.name} cannot be merged; nothing was changed.` }), issueList(plan.errors, 'error')), actions: [{ label: 'OK', kind: 'primary', onClick: () => s.close() }] });
    return;
  }
  const from = plan.from;
  const ev = plan.events;
  const byDev = Object.entries(ev.byDevice);
  const body = h('div', null,
    h('p', { class: 'intro', text: `From ${from.deviceName || 'unknown device'}${from.deviceId === app.device.deviceId ? ' (this device)' : ''}, exported ${from.exportedAt ? formatDateTime(Date.parse(from.exportedAt)) : '?'}. Merge never deletes anything here.` }),
    h('section', { class: 'card' },
      h('h3', { class: 'item-title', text: 'Event log' }),
      h('p', { class: 'totals', text: `${ev.new} new · ${ev.existing} already here · ${ev.totalAfter} after merge` }),
      byDev.length ? h('ul', { class: 'plain small' }, byDev.map(([id, n]) => h('li', { text: `${n} new from ${deviceLabel(id)}` }))) : null),
    h('section', { class: 'card' }, h('h3', { class: 'item-title', text: 'Content' }),
      countsTable(plan.counts, ['new', 'updated', 'unchanged', 'skipped']) || h('p', { class: 'muted', text: 'No content in this backup.' })),
    plan.reasons.length ? h('section', { class: 'card warn' }, h('h3', { class: 'item-title', text: 'Skipped' }), h('ul', { class: 'small' }, plan.reasons.map((r) => h('li', { text: r })))) : null,
    plan.ignored.length ? h('p', { class: 'small muted', text: `Not merged: ${plan.ignored.join(' and ')} (device-local settings and caches; caches are rebuilt).` }) : null,
    plan.warnings.length ? issueList(plan.warnings, 'warn') : null);
  let committed = false;
  const s = sheet({
    title: 'Import backup',
    body,
    wide: true,
    onClose: () => { if (!committed) call('pending.drop', { token: plan.token }); },
    actions: plan.changes
      ? [
        { label: 'Cancel', onClick: () => s.close() },
        {
          label: 'Merge', kind: 'primary',
          onClick: async () => {
            s.setActions([{ label: 'Merging…', disabled: true }]);
            try {
              const r = await call('backup.commit', { token: plan.token });
              committed = true;
              s.close();
              await setSetting('lastImport', { at: clock.now(), fileName: file.name, newEvents: r.newEvents });
              await applyDerived(r.derived);
              toast(`Merged: ${plural(r.newEvents, 'new event')}. Event log now has ${r.derived.summary.counts.events}.`, { kind: 'ok', ms: 6000 });
            } catch (e) {
              s.close();
              toast(`Merge failed, nothing was changed: ${e.message}`, { kind: 'error', ms: 8000 });
            }
          },
        },
      ]
      : [{ label: 'OK', kind: 'primary', onClick: () => s.close() }],
  });
  if (!plan.changes) body.prepend(h('p', { class: 'card ok', text: 'Nothing new: everything in this backup is already here. Importing it changes nothing.' }));
}

// ---------------------------------------------------------------- node index

function nodeIndexText() {
  const profile = activeProfile();
  const list = nodeIndex(allNodes(), profile);
  const head = { nodeIndex: 1, profile: profile ? profile.id : null, exam: profile ? profile.exam : null, exportedAt: localDate(clock.now()), count: list.length };
  // One node per line: compact, but still readable when pasted into a prompt.
  const lines = list.map((n) => JSON.stringify(n));
  return { text: `{${JSON.stringify(head).slice(1, -1)},"nodes":[\n${lines.join(',\n')}\n]}\n`, count: list.length, profile };
}

// ---------------------------------------------------------------- view

export async function render() {
  const packs = await call('packs.list');
  const st = app.state;
  const summary = app.derived.summary;
  const root = h('div', { class: 'data-view' });

  // Event log
  const devs = Object.entries(st.devices).sort((a, b) => b[1].events - a[1].events);
  root.append(h('section', { class: 'card' },
    h('h2', { text: 'Event log' }),
    h('p', { class: 'big-number' }, h('strong', { text: String(st.count) }), ' events'),
    devs.length ? h('ul', { class: 'plain small' }, devs.map(([id, d]) => h('li', { text: `${deviceLabel(id)}: ${d.events}${d.lastExportTs ? ` · last export ${formatDateTime(d.lastExportTs)}` : ''}` }))) : h('p', { class: 'muted small', text: 'No events yet.' }),
    st.unknown ? h('p', { class: 'small muted', text: `${st.unknown} events come from a newer app version; they are kept and synced.` }) : null,
    summary && summary.orphanStates ? h('p', { class: 'small muted', text: `${plural(summary.orphanStates, 'learning record')} point at atoms that are not installed (kept).` }) : null));

  // Packs
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', multiple: true, hidden: true, id: 'pack-files' });
  fileIn.addEventListener('change', async () => { const files = await readFiles(fileIn); fileIn.value = ''; if (files.length) previewPacks(files); });
  root.append(h('section', { class: 'card' },
    h('h2', { text: 'Content packs' }),
    h('p', { class: 'small muted', text: 'Packs are .json files made by the Forge prompts. Each is validated and shown as a dry run before anything is saved.' }),
    h('div', { class: 'button-row' },
      h('button', { class: 'btn primary', onclick: () => fileIn.click() }, 'Import packs…'),
      h('button', { class: 'btn', onclick: tryDemo }, 'Try the demo pack')),
    fileIn));
  if (packs.length) root.append(h('div', { class: 'stack' }, packs.sort((a, b) => (a.title < b.title ? -1 : 1)).map(packCard)));
  else root.append(h('p', { class: 'muted small center', text: 'No packs installed.' }));
  if (summary && summary.orphans) root.append(h('p', { class: 'small warn-text center' }, `${plural(summary.orphans, 'item')} reference missing content. `, h('a', { href: '#/library' }, 'See Library → Orphaned items')));

  // Backup
  const mine = st.devices[app.device.deviceId];
  const last = mine && mine.lastExportTs;
  const lastImport = await getSetting('lastImport');
  const backupIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, id: 'backup-file' });
  backupIn.addEventListener('change', async () => { const [f] = await readFiles(backupIn); backupIn.value = ''; if (f) previewBackup(f); });
  root.append(h('section', { class: 'card', id: 'backup' },
    h('h2', { text: 'Backup and sync' }),
    h('p', { class: 'small', text: last ? `Last export from this device: ${formatDateTime(last)} (${plural(daysBetween(localDate(last), localDate(clock.now())), 'day')} ago).` : 'This device has never exported a backup.' }),
    lastImport ? h('p', { class: 'small muted', text: `Last import here: ${lastImport.fileName}, ${formatDateTime(lastImport.at)} (${plural(lastImport.newEvents, 'new event')}).` }) : null,
    h('p', { class: 'small muted', text: 'To sync two devices: export on one, import on the other, then the reverse. Import merges event logs by id, so nothing is lost or duplicated.' }),
    h('div', { class: 'button-row' },
      h('button', { class: 'btn primary', onclick: () => exportNow(false) }, 'Export backup'),
      canShareFiles() ? h('button', { class: 'btn', onclick: () => exportNow(true) }, 'Share backup…') : null,
      h('button', { class: 'btn', onclick: () => backupIn.click() }, 'Import backup…')),
    backupIn));

  // Node index
  const idx = nodeIndexText();
  const fileName = `smriti-node-index-${slug(idx.profile ? idx.profile.id : 'all')}-${localDate(clock.now())}.json`;
  root.append(h('section', { class: 'card' },
    h('h2', { text: 'Node index for Forge prompts' }),
    h('p', { class: 'small', text: `${plural(idx.count, 'topic')} in ${idx.profile ? idx.profile.name : 'all exams'}: id, title and keywords. Attach this file to every Forge prompt so packs map to your topics.` }),
    h('div', { class: 'button-row' },
      h('button', { class: 'btn primary', onclick: () => { download(fileName, idx.text); toast(`Saved ${fileName}.`, { kind: 'ok' }); } }, 'Export node index'),
      h('button', {
        class: 'btn',
        onclick: async () => {
          try { await navigator.clipboard.writeText(idx.text); toast('Node index copied.', { kind: 'ok' }); } catch (e) { toast(`Copy failed: ${e.message}`, { kind: 'error' }); }
        },
      }, 'Copy'))));

  // Anki export
  const profile = activeProfile();
  const nodesAll = allNodes();
  const subjects = [...nodesAll.values()].filter((n) => inProfileScope(n, profile) && (n.parent === null || (nodesAll.get(n.parent) && nodesAll.get(n.parent).parent === null)));
  const picks = subjects.map((n) => ({ id: n.id, cb: h('input', { type: 'checkbox' }), label: `${n.parent ? '— ' : ''}${n.title}` }));
  const scopeBox = h('details', { class: 'field' }, h('summary', { text: 'Topics (none ticked = all atoms)' }),
    h('div', { class: 'checklist' }, picks.map((x) => h('label', { class: 'check-row' }, x.cb, h('span', { text: x.label })))));
  const inclQ = h('input', { type: 'checkbox' });
  root.append(h('section', { class: 'card' },
    h('h2', { text: 'Export to Anki' }),
    h('p', { class: 'small', text: 'A tab-separated file AnkiDroid and Anki import directly (File → Import): Front, Back, Tags, Source. Tags follow the syllabus, e.g. smriti::cse::gs2::polity.' }),
    scopeBox,
    h('label', { class: 'check' }, inclQ, ' Include atoms still in Quarantine'),
    h('div', { class: 'button-row' }, h('button', {
      class: 'btn primary', type: 'button',
      onclick: async () => {
        const chosen = picks.filter((x) => x.cb.checked).map((x) => x.id);
        const atoms = await call('atoms.under', { nodeIds: chosen });
        const packs = new Map((await app.db.getAll('packs')).map((p) => [p.id, p]));
        const list = atoms.filter((a) => {
          const q = quarantineStatus(a, app.state);
          const rec = app.state.atoms[a.id];
          if (rec && rec.retired) return false;
          return q === 'clear' || q === 'approved' || (inclQ.checked && q === 'quarantined');
        });
        if (!list.length) { toast('No atoms to export.', { kind: 'warn' }); return; }
        const text = ankiTsv(list, { sourceLabel: (a) => sourceLabel(a, packs, new Map()) });
        const name = `smriti-anki-${chosen.length === 1 ? slug(chosen[0]) : chosen.length ? `${chosen.length}-topics` : 'all'}-${localDate(clock.now())}.txt`;
        download(name, text, 'text/plain;charset=utf-8');
        toast(`Exported ${plural(list.length, 'atom')} to ${name}.`, { kind: 'ok', ms: 6000 });
      },
    }, 'Export for Anki'))));

  // The two main actions again, within thumb reach above the navigation bar.
  root.append(h('div', { class: 'dock', role: 'group', 'aria-label': 'Quick actions' },
    h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Import packs…'),
    h('button', { class: 'btn primary', onclick: () => exportNow(canShareFiles()) }, 'Back up now')));

  return root;
}

