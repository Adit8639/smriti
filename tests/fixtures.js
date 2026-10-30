// Test fixtures: the demo packs, the bundled profiles and the schema example from the build kit.

export const clone = (x) => structuredClone(x);

async function getJson(path) {
  const r = await fetch(new URL(path, import.meta.url));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

export async function demoFiles() {
  const names = await getJson('../packs/demo/index.json');
  return Promise.all(names.map(async (name) => {
    const r = await fetch(new URL(`../packs/demo/${name}`, import.meta.url));
    return { name, text: await r.text() };
  }));
}

export async function demoPacks() {
  const files = await demoFiles();
  return Object.fromEntries(files.map((f) => [f.name, JSON.parse(f.text)]));
}

export async function profiles() {
  const names = await getJson('../profiles/index.json');
  return Promise.all(names.map((n) => getJson(`../profiles/${n}`)));
}

// "Example (valid)" from SMRITI SCHEMA v1, verbatim.
export const schemaExample = {
  pack: {
    id: 'demo-polity-qhour', version: 1, kind: 'book', exam: ['cse', 'capf-ac'],
    title: 'Demo: Questions in Parliament', createdAt: '2026-10-28',
    source: { title: 'Demo Source', edition: '1' },
    report: { counts: { atoms: 2, probes: 1 }, doubts: [], unmapped: [], skipped: [], nodeCounts: {} },
  },
  atoms: [
    {
      id: 'demo-polity-qhour.0001', type: 'compare',
      text: 'A starred question in Parliament is answered ___, and supplementary questions may follow.',
      answer: 'orally', nodes: ['cse.gs2.polity.parliament.devices'],
      source: { pack: 'demo-polity-qhour', page: 4 }, origin: 'source', verify: false,
      confusables: ['demo-polity-qhour.0002'], stage: ['prelims'],
    },
    {
      id: 'demo-polity-qhour.0002', type: 'compare',
      text: 'An unstarred question is answered ___, so no supplementary questions follow.',
      answer: 'in writing', nodes: ['cse.gs2.polity.parliament.devices'],
      source: { pack: 'demo-polity-qhour', page: 4 }, origin: 'source', verify: false,
      confusables: ['demo-polity-qhour.0001'], stage: ['prelims'],
    },
  ],
  probes: [
    {
      id: 'demo-polity-qhour.p001',
      atoms: ['demo-polity-qhour.0001', 'demo-polity-qhour.0002'],
      format: 'statement', difficulty: 1,
      stem: 'Consider the following statements about questions in Parliament:',
      statements: [
        { text: 'Starred questions are answered orally and supplementary questions may follow.', true: true, trap: null, reason: 'This is what makes a question starred.' },
        { text: 'Unstarred questions allow supplementary questions because they are answered in writing.', true: false, trap: 'cause-effect', reason: 'A written answer is exactly why no supplementaries follow.' },
      ],
      options: ['1 only', '2 only', 'Both 1 and 2', 'Neither 1 nor 2'], answer: 0,
      explanation: 'Only statement 1 is correct.',
    },
  ],
};
