// More: everything that is not daily study. Sources, backups and data, settings.

import { h, icon } from './ui.js';
import { app } from './store.js';
import { plural } from './util.js';

const row = (href, ic, title, text) => h('a', { class: 'more-row', href, 'data-nav': '' }, icon(ic), h('span', null, h('strong', { text: title }), h('span', { class: 'small muted block', text })), icon('chevron'));

export async function render() {
  const sources = Object.keys(app.state.sources).length;
  const mine = app.state.devices[app.device.deviceId];
  const last = mine && mine.lastExportTs;
  return h('div', { class: 'more' },
    h('nav', { class: 'card more-list', 'aria-label': 'More' },
      row('#/sources', 'book', 'Sources', sources ? `${plural(sources, 'PDF')} for reading and source links` : 'Add your books as PDFs'),
      row('#/data', 'data', 'Data', last ? `Packs, backup and sync · last backup ${new Date(last).toLocaleDateString()}` : 'Packs, backup and sync · no backup from this device yet'),
      row('#/health', 'shield', 'Data health', 'Storage per store, backups by device, integrity check and one-tap repair'),
      row('#/weekly', 'today', 'Weekly review', 'What moved, weakest topics, plan changes'),
      row('#/settings', 'settings', 'Settings', 'Exam, dates, daily budget, study limits, theme')));
}
