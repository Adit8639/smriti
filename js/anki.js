// Tab-separated export that Anki and AnkiDroid import directly: Front, Back, Tags, Source.
// The header lines tell Anki the separator, that fields hold HTML and which column has tags.

import { hasGap } from './probes.js';

const html = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');

const tag = (s) => String(s).replace(/\s+/g, '_').replace(/"/g, '');

export function ankiTsv(atoms, { sourceLabel, deck = 'SMRITI' } = {}) {
  const lines = ['#separator:tab', '#html:true', '#tags column:3', `#deck:${deck}`, '#columns:Front\tBack\tTags\tSource'];
  for (const a of atoms) {
    const front = hasGap(a.text) ? html(a.text).replace(/_{3,}/g, '[…]') : html(a.text);
    const sentence = hasGap(a.text) ? html(a.text).replace(/_{3,}/, `<b>${html(a.answer)}</b>`) : '';
    const back = [`<b>${html(a.answer)}</b>`, sentence, a.note ? `<i>${html(a.note)}</i>` : '', a.mnemonic ? `Mnemonic: ${html(a.mnemonic)}` : '']
      .filter(Boolean).join('<br>');
    const tags = ['smriti', ...(a.nodes || []).map((n) => `smriti::${tag(n).replace(/\./g, '::')}`), a._pack && a._pack !== '@self' ? `pack::${tag(a._pack)}` : 'smriti::self', `type::${tag(a.type || 'fact')}`];
    lines.push([front, back, tags.join(' '), html(sourceLabel ? sourceLabel(a) : '')].join('\t'));
  }
  return `${lines.join('\n')}\n`;
}
