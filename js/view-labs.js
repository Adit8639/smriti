// Labs: the practice hub. Each lab is a card with its key numbers and a direct way in.

import { h } from './ui.js';
import { app, activeProfile } from './store.js';
import { countedAnswers } from './labdata.js';
import { bandStats, marksFor, ruleText } from './calib.js';
import { gsPaper } from './view-lab.js';
import { plural } from './util.js';

function labCard({ title, text, href, primary, links = [], stat = null }) {
  return h('section', { class: 'card lab-card' },
    h('div', { class: 'row-between' }, h('h2', { text: title }), stat ? h('span', { class: 'badge', text: stat }) : null),
    h('p', { class: 'small muted', text }),
    h('div', { class: 'button-row' }, h('a', { class: 'btn primary', href }, primary), links.map(([href2, label]) => h('a', { class: 'btn', href: href2 }, label))));
}

export async function render() {
  const s = app.state;
  const mocks = Object.values(s.mocks);
  const pendingAutopsy = mocks.filter((m) => m.status === 'submitted' && !m.unlocked).length;
  const inProgress = mocks.filter((m) => m.status === 'started').length;
  const answers = countedAnswers(s, 300);
  const paper = gsPaper(activeProfile());
  const rule = answers.length >= 15 ? ruleText(bandStats(answers, marksFor(paper)), marksFor(paper)) : null;
  const csatN = s.csat.recent.length;
  return h('div', { class: 'labs' },
    labCard({
      title: 'Prelims Lab',
      text: `PYQs by year, subject and format with statement marking; full mocks with a palette, timer and negative marking; the autopsy gate; calibration and a projected score.${rule ? ` ${rule}` : ''}`,
      href: '#/lab?tab=pyqs', primary: 'PYQs',
      links: [['#/lab?tab=mocks', inProgress ? `Mocks (${inProgress} in progress)` : pendingAutopsy ? `Mocks (${pendingAutopsy} in autopsy)` : 'Mocks'], ['#/lab?tab=calib', 'Calibration'], ['#/lab?tab=traps', 'Trap Log']],
      stat: mocks.length ? plural(mocks.filter((m) => m.status !== 'discarded').length, 'mock') : null,
    }),
    labCard({
      title: 'Mains Studio',
      text: 'Skeleton sprints (90 s per question), timed answers on paper with a photo and a six-line rubric, compare with topper answers, Shadow Writing, the directive decoder, value-add bank, GS-IV cases and essays.',
      href: '#/mains', primary: 'Write', links: [['#/mains/sprint?n=5', 'Quick sprint'], ['#/mains?tab=toolkit', 'Directives'], ['#/mains?tab=history', 'History']],
      stat: Object.keys(s.mains.attempts).length ? plural(Object.keys(s.mains.attempts).length, 'attempt') : null,
    }),
    labCard({
      title: 'CA–Static Bridge',
      text: 'Each current-affairs item anchored to a static topic: why in news, anchors, Prelims facts, Mains angle and probable questions. Months close only when every item is anchored; CA facts archive after their shelf life.',
      href: '#/ca', primary: 'Months', links: [],
    }),
    labCard({
      title: 'PDF intake',
      text: 'Fact-dense sentences from any PDF in Sources, found by rules with no AI: duplicates of your atoms dropped, a topic suggested, then a swipe deck to keep or discard each in about two seconds.',
      href: '#/intake', primary: 'Start an intake', links: [],
      stat: Object.keys(s.intake).length ? plural(Object.values(s.intake).reduce((a, b) => a + b.kept, 0), 'fact') + ' kept' : null,
    }),
    labCard({
      title: 'CSAT Gym',
      text: 'Generated quant and reasoning in eleven types and three levels (no fixed bank, nothing repeats), comprehension from your packs, and a warning when your projected CSAT nears the qualifying line.',
      href: '#/csat/mixed?level=mixed', primary: 'Mixed set of 20', links: [['#/lab?tab=csat', 'All drills']],
      stat: csatN ? `${csatN} answered` : null,
    }));
}
