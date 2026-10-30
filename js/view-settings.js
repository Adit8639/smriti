// Settings: exam profile, editable dates, weekday budget, theme, device, storage, about,
// and the hidden test clock (tap the version row seven times).

import { h, toast } from './ui.js';
import { app, activeProfile, activeProfileId, appendEvent, setSetting, emit } from './store.js';
import { pwa, promptInstall, storageInfo, requestPersist, swVersion } from './pwa.js';
import { examCountdown, resolvePhases, phaseOn, secondsPerQuestion } from './profiles.js';
import { APP_VERSION, SCHEMA_VERSION } from './version.js';
import * as clock from './clock.js';
import { formatDate, formatBytes, localDate, isIsoDate, formatDateTime, daysBetween } from './util.js';
import { limits, minutesToday } from './study.js';
import { reviewCapFor } from './queue.js';
import { leechThreshold } from './rebuild.js';

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const DEFAULT_MINUTES = 180;
let devTaps = 0;
let devOpen = false;

export const budget = () => {
  const b = app.state.settings.budget || {};
  return Object.fromEntries(DAYS.map(([k]) => [k, Number.isInteger(b[k]) ? b[k] : DEFAULT_MINUTES]));
};

const fmtMinutes = (m) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;

// Redraws Settings and puts focus back on the control that triggered it.
function rerender(focusLabel) {
  emit('rerender');
  if (focusLabel) {
    setTimeout(() => {
      const el = document.querySelector(`#view [aria-label="${CSS.escape(focusLabel)}"]`);
      if (el) el.focus();
    }, 0);
  }
}

// Typing a date fires "change" per segment; save once the typing pauses.
function onDateChange(input, save) {
  let t = null;
  input.addEventListener('change', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!isIsoDate(input.value)) { toast('Pick a valid date.', { kind: 'warn' }); return; }
      save(input.value);
    }, 600);
  });
}

function profileSection() {
  const p = activeProfile();
  const today = localDate(clock.now());
  const sel = h('select', { id: 'profile-select', 'aria-label': 'Exam profile' },
    app.profiles.map((x) => h('option', { value: x.id, selected: x.id === activeProfileId() ? true : null }, x.name)));
  sel.addEventListener('change', async () => {
    await appendEvent('settings.set', { key: 'activeProfile', value: sel.value });
    rerender('Exam profile');
  });
  if (!p) return h('section', { class: 'card' }, h('h2', { text: 'Exam profile' }), h('p', { text: 'No profiles loaded yet.' }));

  const dateRow = (d) => {
    const input = h('input', { type: 'date', value: d.date, 'aria-label': `${d.label} date` });
    const tent = h('input', { type: 'checkbox', checked: d.tentative ? true : null, 'aria-label': `${d.label} is tentative` });
    const edited = p._edited.some((x) => x.startsWith(`dates.${d.key}.`));
    onDateChange(input, async (value) => {
      await appendEvent('profile.set', { profileId: p.id, path: `dates.${d.key}.date`, value });
      rerender(`${d.label} date`);
    });
    tent.addEventListener('change', async () => {
      await appendEvent('profile.set', { profileId: p.id, path: `dates.${d.key}.tentative`, value: tent.checked });
      rerender(`${d.label} is tentative`);
    });
    return h('div', { class: 'date-row' },
      h('div', { class: 'date-label' }, h('strong', { text: d.label }),
        h('span', { class: 'small muted', text: ` ${d.days >= 0 ? `${d.days} days to go` : `${-d.days} days ago`}` }),
        d.tentative ? h('span', { class: 'badge warn', text: 'tentative' }) : h('span', { class: 'badge ok', text: 'confirmed' }),
        edited ? h('button', {
          class: 'link-btn',
          onclick: async () => {
            await appendEvent('profile.set', { profileId: p.id, path: `dates.${d.key}.date`, value: null });
            await appendEvent('profile.set', { profileId: p.id, path: `dates.${d.key}.tentative`, value: null });
            rerender(`${d.label} date`);
          },
        }, 'reset') : null),
      h('div', { class: 'date-inputs' }, input, h('label', { class: 'check' }, tent, ' Tentative')));
  };

  const phases = resolvePhases(p);
  const now = phaseOn(p, today);
  const phaseRow = (ph, i) => {
    const def = p.phases[i];
    const literal = def.until[0] !== '@';
    const edited = p._edited.includes(`phases.${ph.id}.until`);
    const input = literal ? h('input', { type: 'date', value: ph.end, 'aria-label': `${ph.name} ends` }) : null;
    if (input) {
      onDateChange(input, async (value) => {
        await appendEvent('profile.set', { profileId: p.id, path: `phases.${ph.id}.until`, value });
        rerender(`${ph.name} ends`);
      });
    }
    return h('li', { class: now && now.id === ph.id ? 'current' : null },
      h('strong', { text: ph.name }), ' ',
      h('span', { class: 'small', text: `${ph.start ? formatDate(ph.start) : 'now'} → ${formatDate(ph.end)}` }),
      now && now.id === ph.id ? h('span', { class: 'badge ok', text: 'today' }) : null,
      literal ? h('div', { class: 'date-inputs' }, h('span', { class: 'small muted', text: 'Ends ' }), input,
        edited ? h('button', { class: 'link-btn', onclick: async () => { await appendEvent('profile.set', { profileId: p.id, path: `phases.${ph.id}.until`, value: null }); rerender(`${ph.name} ends`); } }, 'reset') : null)
        : h('span', { class: 'small muted', text: ` (ends with ${p.dates[def.until.slice(1)].label})` }));
  };

  return h('section', { class: 'card' },
    h('h2', { text: 'Exam profile' }),
    h('label', { class: 'field' }, h('span', { text: 'Active profile' }), sel),
    p.subtitle ? h('p', { class: 'small', text: p.subtitle }) : null,
    (p.notes || []).map((n) => h('p', { class: 'small muted', text: n })),
    h('h3', { text: 'Exam dates' }),
    examCountdown(p, today).map(dateRow),
    h('h3', { text: 'Phases' }),
    h('ol', { class: 'phases' }, phases.map(phaseRow)),
    h('details', null, h('summary', { text: `Papers (${p.papers.length})` }), papersTable(p)));
}

function papersTable(p) {
  const neg = (f) => (f ? (Math.abs(f - 1 / 3) < 1e-6 ? '1/3' : String(f)) : '—');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'counts-table papers' },
    h('thead', null, h('tr', null, ['Paper', 'Type', 'Q', 'Marks', 'Min', 'Negative', 'Qualifying', 's/Q'].map((x) => h('th', { text: x })))),
    h('tbody', null, p.papers.map((x) => h('tr', null,
      h('th', { text: x.name }),
      h('td', { text: x.type }),
      h('td', { text: x.questions ?? '—' }),
      h('td', { text: x.marks ?? '—' }),
      h('td', { text: x.durationMin ?? '—' }),
      h('td', { text: neg(x.negativeFraction) }),
      h('td', { text: x.qualifyingPct ? `${x.qualifyingPct}%` : '—' }),
      h('td', { text: secondsPerQuestion(x) ?? '—' }))))));
}

function budgetSection() {
  const b = budget();
  const total = () => Object.values(budget()).reduce((a, x) => a + x, 0);
  const totalEl = h('p', { class: 'small', text: `Week: ${fmtMinutes(total())}` });
  const inputs = DAYS.map(([k, label]) => {
    const input = h('input', { type: 'number', min: '0', max: '960', step: '15', inputmode: 'numeric', value: String(b[k]), 'aria-label': `${label} minutes` });
    input.addEventListener('change', async () => {
      const v = Math.round(Number(input.value));
      if (!Number.isFinite(v) || v < 0 || v > 960) { toast('Minutes must be between 0 and 960.', { kind: 'warn' }); input.value = String(budget()[k]); return; }
      input.value = String(v);
      await appendEvent('settings.set', { key: 'budget', value: { ...budget(), [k]: v } });
      totalEl.textContent = `Week: ${fmtMinutes(total())}`;
    });
    return h('label', { class: 'budget-day' }, h('span', { text: label }), input);
  });
  return h('section', { class: 'card' },
    h('h2', { text: 'Daily time budget' }),
    h('p', { class: 'small muted', text: 'Minutes you can study each weekday. The daily review cap follows it, and the daily mission (Phase 6) is built from it. Synced across devices.' }),
    h('div', { class: 'budget-grid' }, inputs),
    totalEl);
}

function numberSetting({ label, key, value, min, max, step = 1, help, onSave }) {
  const input = h('input', { type: 'number', min: String(min), max: String(max), step: String(step), value: String(value), inputmode: step < 1 ? 'decimal' : 'numeric', 'aria-label': label });
  input.addEventListener('change', async () => {
    const v = Number(input.value);
    if (!Number.isFinite(v) || v < min || v > max) { toast(`${label}: between ${min} and ${max}.`, { kind: 'warn' }); input.value = String(value); return; }
    await (onSave ? onSave(v) : appendEvent('settings.set', { key, value: step < 1 ? Math.round(v * 100) / 100 : Math.round(v) }));
    toast(`${label} saved.`, { kind: 'ok', ms: 2000 });
  });
  return h('label', { class: 'field' }, h('span', { text: label }), input, help ? h('span', { class: 'small muted', text: help }) : null);
}

function studySection() {
  const st = app.state.settings;
  const lim = limits();
  const auto = !(Number.isInteger(st.reviewCap) && st.reviewCap > 0);
  const capMode = h('select', { 'aria-label': 'Daily review cap' },
    h('option', { value: 'auto', selected: auto ? true : null }, `Automatic from the budget (today: ${reviewCapFor(minutesToday(), null)})`),
    h('option', { value: 'fixed', selected: auto ? null : true }, 'A fixed number'));
  const capNum = h('input', { type: 'number', min: '20', max: '1000', step: '10', value: String(auto ? 200 : st.reviewCap), 'aria-label': 'Fixed review cap', hidden: auto ? true : null });
  const saveCap = async () => {
    const v = capMode.value === 'auto' ? null : Math.max(20, Math.min(1000, Math.round(Number(capNum.value) || 200)));
    capNum.hidden = capMode.value === 'auto';
    await appendEvent('settings.set', { key: 'reviewCap', value: v });
    toast('Review cap saved.', { kind: 'ok', ms: 2000 });
  };
  capMode.addEventListener('change', saveCap);
  capNum.addEventListener('change', saveCap);
  const p = activeProfile();
  const card = (p && p.targets && p.targets.cardSeconds) || 8;
  const lang = h('select', { 'aria-label': 'Dictation language' },
    [['en-IN', 'English (India)'], ['hi-IN', 'Hindi'], ['en-GB', 'English (UK)'], ['en-US', 'English (US)']].map(([v, l]) => h('option', { value: v, selected: (st.dictationLang || 'en-IN') === v ? true : null }, l)));
  lang.addEventListener('change', () => appendEvent('settings.set', { key: 'dictationLang', value: lang.value }));
  let dbg = false;
  try { dbg = localStorage.getItem('smriti.debug') === '1'; } catch (_) { /* preference only */ }
  const debug = h('input', { type: 'checkbox', checked: dbg ? true : null });
  debug.addEventListener('change', () => { try { localStorage.setItem('smriti.debug', debug.checked ? '1' : '0'); } catch (_) { /* preference only */ } });
  return h('section', { class: 'card' },
    h('h2', { text: 'Study' }),
    numberSetting({ label: 'New atoms per day', key: 'newPerDay', value: lim.newPerDay, min: 0, max: 200, help: 'One new atom comes after every five reviews. New atoms pause while due reviews are over the cap.' }),
    h('div', { class: 'field' }, h('span', { text: 'Daily review cap' }), capMode, capNum,
      h('span', { class: 'small muted', text: 'Automatic: 200 reviews on a 3-hour day, scaled to each day’s budget (50 to 400). Reviews over the cap carry over, most-forgotten first.' })),
    numberSetting({ label: 'Desired retention', key: 'retention', value: st.retention || 0.9, min: 0.8, max: 0.97, step: 0.01, help: 'FSRS schedules each atom so you recall it with this probability. 0.90 is the default; higher means more reviews.' }),
    numberSetting({
      label: 'Seconds per card (speed target)', key: null, value: card, min: 3, max: 60,
      help: 'A right answer slower than this is graded Hard. Full Prelims questions use the paper’s time per question (72 s for GS-I).',
      onSave: (v) => appendEvent('profile.set', { profileId: p.id, path: 'targets.cardSeconds', value: Math.round(v) }),
    }),
    h('label', { class: 'field' }, h('span', { text: 'Dictation language' }), lang),
    h('label', { class: 'check' }, debug, ' Show the FSRS debug panel during reviews (ratings, intervals, card state)'));
}

function themeSection() {
  let cur = 'system';
  try { cur = localStorage.getItem('smriti.theme') || 'system'; } catch (_) { /* preference only */ }
  const opt = (v, label) => {
    const r = h('input', { type: 'radio', name: 'theme', value: v, checked: cur === v ? true : null });
    r.addEventListener('change', () => {
      if (v === 'system') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = v;
      try {
        if (v === 'system') localStorage.removeItem('smriti.theme'); else localStorage.setItem('smriti.theme', v);
      } catch (_) { /* applies for this session only */ }
    });
    return h('label', { class: 'seg' }, r, h('span', { text: label }));
  };
  return h('section', { class: 'card' }, h('h2', { text: 'Theme' }),
    h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Theme' }, opt('system', 'System'), opt('light', 'Light'), opt('dark', 'Dark')));
}

function deviceSection() {
  const name = h('input', { type: 'text', value: app.device.name, maxlength: '24', autocomplete: 'off', 'aria-label': 'Device name' });
  name.addEventListener('change', async () => {
    const v = name.value.trim().slice(0, 24) || app.device.name;
    app.device = { ...app.device, name: v };
    name.value = v;
    await setSetting('device', app.device);
    toast('Device name saved. Other devices learn it from your next backup.', { kind: 'ok' });
  });
  return h('section', { class: 'card' },
    h('h2', { text: 'This device' }),
    h('label', { class: 'field' }, h('span', { text: 'Name (used in backup file names)' }), name),
    h('p', { class: 'small muted' }, 'Device id ', h('code', { text: app.device.deviceId }), ` · first used ${formatDate(localDate(app.firstRunAt))}`),
    h('p', { class: 'small', text: pwa.installed ? 'Running as an installed app.' : 'Running in a browser tab.' }),
    !pwa.installed && pwa.canInstall ? h('button', { class: 'btn primary', onclick: () => promptInstall() }, 'Install SMRITI') : null,
    !pwa.installed && !pwa.canInstall ? h('p', { class: 'small muted', text: 'To install: Chrome menu ⋮ → "Add to Home screen" (Android) or the install icon in the address bar (laptop). Needs the HTTPS site, not a file.' }) : null);
}

function storageSection() {
  const box = h('div', null, h('p', { class: 'muted small', text: 'Checking…' }));
  const draw = async () => {
    const s = await storageInfo();
    box.replaceChildren(...[
      h('p', null, h('strong', { text: 'Used: ' }), s.usage === null ? 'unknown' : `${formatBytes(s.usage)} of ${formatBytes(s.quota)} available to this site`),
      h('p', null, h('strong', { text: 'Persistent: ' }),
        s.persisted === true ? h('span', { class: 'badge ok', text: 'granted' }) : s.persisted === false ? h('span', { class: 'badge warn', text: 'not granted' }) : h('span', { class: 'badge muted', text: 'unsupported' })),
      s.persisted === false ? h('p', { class: 'small muted', text: 'Without it, the browser may clear SMRITI under storage pressure. Chrome usually grants it once the app is installed or used often. Keep weekly backups either way.' }) : null,
      s.persisted !== true ? h('button', {
        class: 'btn',
        onclick: async () => {
          const r = await requestPersist();
          await setSetting('persist', { granted: r, at: Date.now() });
          toast(r ? 'Persistent storage granted.' : 'The browser did not grant persistent storage yet.', { kind: r ? 'ok' : 'warn' });
          draw();
        },
      }, 'Request persistent storage') : null].filter(Boolean));
  };
  draw();
  return h('section', { class: 'card' }, h('h2', { text: 'Storage' }), box);
}

function devSection() {
  const off = clock.getOffset();
  const status = h('p', null, h('strong', { text: 'App time: ' }), formatDateTime(clock.now()), off ? ` (${off > 0 ? '+' : ''}${Math.round(off / 86400000)} days)` : ' (real time)');
  const setOff = async (ms) => {
    clock.setOffset(ms);
    await setSetting('testClock', { offsetMs: clock.getOffset() });
    emit('rerender');
  };
  const shift = (days) => h('button', { class: 'btn small', onclick: () => setOff(clock.getOffset() + days * 86400000) }, `${days > 0 ? '+' : ''}${days} d`);
  const dateIn = h('input', { type: 'date', value: localDate(clock.now()), 'aria-label': 'Set app date' });
  dateIn.addEventListener('change', () => {
    if (!isIsoDate(dateIn.value)) return;
    const real = localDate(Date.now());
    setOff(daysBetween(real, dateIn.value) * 86400000);
  });
  return h('section', { class: 'card dev' },
    h('h2', { text: 'Developer: test clock' }),
    h('p', { class: 'small muted', text: 'Moves the app clock for time-travel tests (backup reminder, later shelf lives and schedules). Events created while it is on are stamped with the test time. This setting stays on this device.' }),
    status,
    h('div', { class: 'button-row' }, shift(-1), shift(1), shift(7), shift(30), h('button', { class: 'btn small', onclick: () => setOff(0) }, 'Reset')),
    numberSetting({ label: 'Leech threshold (lapses before an atom is suspended)', key: 'leechThreshold', value: leechThreshold(app.state), min: 1, max: 20, help: 'Default 6. Lower it only to test the leech flow, then set it back.' }),
    h('label', { class: 'field' }, h('span', { text: 'Jump to date' }), dateIn),
    h('div', { class: 'button-row' }, h('a', { class: 'btn small', href: 'tests/' }, 'Open the self-test page')));
}

function aboutSection() {
  const sw = h('span', { text: '…' });
  swVersion().then((v) => { sw.textContent = v || 'not active yet'; });
  const versionRow = h('button', {
    class: 'about-row',
    onclick: () => {
      devTaps++;
      if (devTaps >= 7 && !devOpen) { devOpen = true; toast('Developer tools shown.'); emit('rerender'); }
    },
  }, `SMRITI ${APP_VERSION} · schema v${SCHEMA_VERSION}`);
  return h('section', { class: 'card' },
    h('h2', { text: 'About' }),
    versionRow,
    h('p', { class: 'small muted' }, 'Offline cache: ', sw),
    h('p', { class: 'small muted', text: 'Your packs, notes and progress stay in this browser; the hosted site holds only the app code.' }),
    h('div', { class: 'button-row' }, h('a', { class: 'btn small', href: 'tests/' }, 'Run the self-tests')));
}

export function render() {
  return h('div', { class: 'settings' },
    profileSection(),
    studySection(),
    budgetSection(),
    themeSection(),
    deviceSection(),
    storageSection(),
    aboutSection(),
    devOpen || clock.getOffset() ? devSection() : null);
}
