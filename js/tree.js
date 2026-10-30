// Syllabus tree helpers: exam scope, parent/child links, ancestors and the node index.

// Nodes that belong to the profile's exam: its id namespace or an explicit sharedWith.
export function inProfileScope(node, profile) {
  if (!profile) return true;
  const pre = profile.nodePrefix;
  return node.id === pre || node.id.startsWith(`${pre}.`) || (Array.isArray(node.sharedWith) && node.sharedWith.includes(profile.exam));
}

// nodes: Map id -> node. Returns {roots, children, unplaced, visible}
export function buildTree(nodes, profile, showAll) {
  const children = new Map();
  const roots = [];
  const unplaced = [];
  for (const n of nodes.values()) {
    if (n.parent === null || n.parent === undefined) roots.push(n.id);
    else if (nodes.has(n.parent)) {
      if (!children.has(n.parent)) children.set(n.parent, []);
      children.get(n.parent).push(n.id);
    } else unplaced.push(n.id);
  }
  let visible = null;
  if (!showAll && profile) {
    visible = new Set();
    for (const n of nodes.values()) {
      if (!inProfileScope(n, profile)) continue;
      let cur = n.id;
      const guard = new Set();
      while (cur && nodes.has(cur) && !visible.has(cur) && !guard.has(cur)) {
        guard.add(cur);
        visible.add(cur);
        cur = nodes.get(cur).parent;
      }
    }
  }
  const show = (id) => !visible || visible.has(id);
  return {
    roots: roots.filter(show),
    children: (id) => (children.get(id) || []).filter(show),
    unplaced: unplaced.filter(show),
    visible,
  };
}

export function ancestors(nodes, id) {
  const out = [];
  const seen = new Set([id]);
  let cur = nodes.get(id) && nodes.get(id).parent;
  while (cur && nodes.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    out.unshift(nodes.get(cur));
    cur = nodes.get(cur).parent;
  }
  return out;
}

// Compact index for Forge prompts: id, title and keywords of every in-scope node.
export function nodeIndex(nodes, profile) {
  const list = [...nodes.values()].filter((n) => inProfileScope(n, profile));
  return list.map((n) => ({ id: n.id, title: n.title, keywords: n.keywords || [] }));
}
