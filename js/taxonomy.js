// Taxonomy model: parses data/taxonomy.js, searches names, builds lineages,
// finds the last common ancestor and estimates divergence ages from data/clade-ages.js.
(function () {

const RANK_PRIORITY = { species: 0, subspecies: 1, genus: 2 };

// Search key kinds, strongest first.
const ALIAS = 0;
const PRIMARY = 1; // scientific name or NCBI's preferred common name
const SECONDARY = 2; // other NCBI common names
const EXTRA = 3; // common names from iNaturalist

class Taxonomy {
  constructor(data, ages, aliases = {}) {
    this.nodes = new Map();
    this.searchKeys = []; // { key, node, kind, label }
    for (const line of data.rows.split('\n')) {
      const [id, parent, rank, name, common, ncbiCount] = line.split('\t');
      const node = {
        id: Number(id),
        parentId: Number(parent),
        rank: data.ranks[Number(rank)],
        name,
        commonNames: common ? common.split('|') : [],
      };
      this.nodes.set(node.id, node);
      this.addKey(name, node, PRIMARY, null);
      // Names past the first `ncbiCount` come from iNaturalist and rank below NCBI's.
      const fromNcbi = ncbiCount === undefined ? Infinity : Number(ncbiCount);
      node.commonNames.forEach((c, i) => this.addKey(c, node, i >= fromNcbi ? EXTRA : i === 0 ? PRIMARY : SECONDARY, c));
    }
    const byName = new Map();
    for (const node of this.nodes.values()) if (!byName.has(node.name)) byName.set(node.name, node);
    for (const [alias, target] of Object.entries(aliases)) {
      const node = byName.get(target) || this.get(target);
      if (!node) continue;
      this.addKey(alias, node, ALIAS, alias);
      if (!node.commonNames.length) node.commonNames.push(alias);
    }
    this.cladeAges = ages?.clades || {};
    this.agePairs = ages?.pairs || [];
  }

  addKey(text, node, kind, label) {
    this.searchKeys.push({ key: text.toLowerCase(), node, kind, label });
  }

  get size() { return this.nodes.size; }

  get(id) { return this.nodes.get(Number(id)); }

  // Ranked autocomplete. Tiers: exact (alias, primary, secondary, iNaturalist name), plural,
  // prefix, word prefix, substring. Ties prefer species, then lower NCBI ids,
  // which loosely tracks how long and how well a taxon has been studied.
  search(query, limit = 10) {
    // Ignore a trailing "(Scientific name)" left over from a picked "Common (Scientific)" label.
    const q = (query.replace(/\s*\([^()]*\)?\s*$/, '').trim() || query.trim()).toLowerCase();
    if (q.length < 2) return [];
    const best = new Map(); // node id -> hit
    for (const entry of this.searchKeys) {
      const i = entry.key.indexOf(q);
      if (i < 0) continue;
      const k = entry.key;
      let tier;
      if (k === q) tier = entry.kind;
      else if (k === `${q}s` || k === `${q}es`) tier = 4;
      else if (i === 0) tier = 5;
      else if (/[\s-]/.test(k[i - 1])) tier = 6;
      else tier = 7;
      const hit = {
        node: entry.node,
        matched: entry.label,
        tier,
        rank: RANK_PRIORITY[entry.node.rank] ?? 3,
        len: tier >= 5 ? k.length : 0,
      };
      const prev = best.get(entry.node.id);
      if (!prev || compareHits(hit, prev) < 0) best.set(entry.node.id, hit);
    }
    return [...best.values()]
      .sort(compareHits)
      .slice(0, limit)
      .map((h) => ({ node: h.node, matched: h.matched }));
  }

  // Free text -> node: tax id, exact scientific/common name, else best search hit.
  resolve(text) {
    const q = String(text).trim();
    if (!q) return null;
    if (/^\d+$/.test(q)) return this.get(q) || null;
    return this.search(q, 1)[0]?.node || null;
  }

  // Nodes from the top of the tree down to (and including) the node; omits the "root" node.
  lineage(node) {
    const out = [];
    for (let n = node; n && n.id !== 1; n = this.get(n.parentId)) out.push(n);
    return out.reverse();
  }

  compare(a, b) {
    const pathA = this.lineage(a);
    const pathB = this.lineage(b);
    let m = -1;
    while (m + 1 < pathA.length && m + 1 < pathB.length && pathA[m + 1] === pathB[m + 1]) m++;

    const mrca = m >= 0 ? pathA[m] : null;
    const relation = a === b ? 'same'
      : mrca === a ? 'a-contains-b'
        : mrca === b ? 'b-contains-a'
          : mrca ? 'diverged' : 'unrelated';

    return {
      a, b, pathA, pathB, mrca, relation,
      shared: pathA.slice(0, m + 1),
      branchA: pathA.slice(m + 1),
      branchB: pathB.slice(m + 1),
      age: relation === 'diverged' ? this.estimateAge(pathA, pathB, m) : null,
    };
  }

  // Compare any number of taxa. Builds the tree of their lineages, collapsed to
  // the branching points, with an age estimate at each branching point.
  compareMany(nodes) {
    const taxa = [...new Map(nodes.map((n) => [n.id, n])).values()];
    const paths = taxa.map((n) => this.lineage(n));

    let m = -1;
    while (paths.every((p) => m + 1 < p.length && p[m + 1] === paths[0][m + 1])) m++;
    const shared = paths[0].slice(0, m + 1);
    const mrca = m >= 0 ? shared[m] : null;

    // Child sets below the common ancestor, in input order.
    const kids = new Map();
    const tops = new Set();
    for (const p of paths) {
      if (m < 0) tops.add(p[0]);
      for (let i = Math.max(m, 0); i < p.length - 1; i++) {
        if (!kids.has(p[i])) kids.set(p[i], new Set());
        kids.get(p[i]).add(p[i + 1]);
      }
    }
    const selected = new Set(taxa);
    const build = (n) => {
      const t = { node: n, selected: selected.has(n), children: [...(kids.get(n) || [])].map(descend) };
      t.rep = t.selected ? n : t.children[0].rep; // a selected taxon in this subtree
      t.height = t.children.length ? 1 + Math.max(...t.children.map((c) => c.height)) : 0;
      t.age = t.children.length >= 2 ? this.branchAge(t) : null;
      return t;
    };
    // Skip lineage nodes that neither branch nor were selected.
    const descend = (n) => {
      while (!selected.has(n) && kids.get(n)?.size === 1) n = [...kids.get(n)][0];
      return build(n);
    };
    const tree = mrca ? build(mrca) : {
      node: null, selected: false, age: null, children: [...tops].map(descend),
    };
    if (!mrca) tree.height = 1 + Math.max(...tree.children.map((c) => c.height));

    // Taxa in tree order, so related taxa sit next to each other in tables.
    const order = [];
    (function walk(t) { if (t.selected) order.push(t.node); t.children.forEach(walk); })(tree);

    const pairs = new Map();
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const r = this.compare(order[i], order[j]);
        pairs.set(`${order[i].id}:${order[j].id}`, r);
        pairs.set(`${order[j].id}:${order[i].id}`, r);
      }
    }

    return { taxa: order, paths: new Map(order.map((n) => [n.id, this.lineage(n)])), shared, mrca, tree, pairs };
  }

  // A branching point's age is its oldest split between any two of its child subtrees.
  branchAge(t) {
    let best = null;
    for (let i = 0; i < t.children.length; i++) {
      for (let j = i + 1; j < t.children.length; j++) {
        const age = this.compare(t.children[i].rep, t.children[j].rep).age;
        if (age && (!best || age.mya > best.mya)) best = age;
      }
    }
    return best;
  }

  ageOf(node) {
    const v = this.cladeAges[node.name];
    return typeof v === 'number' ? v : null;
  }

  estimateAge(pathA, pathB, m) {
    const belowA = pathA.slice(m + 1);
    const belowB = pathB.slice(m + 1);
    const namesA = new Set(belowA.map((n) => n.name));
    const namesB = new Set(belowB.map((n) => n.name));

    for (const [x, y, mya] of this.agePairs) {
      if ((namesA.has(x) && namesB.has(y)) || (namesA.has(y) && namesB.has(x))) {
        return { kind: 'pair', mya, low: mya, high: mya, basis: `${x} – ${y} split` };
      }
    }

    const mrca = pathA[m];
    const exact = this.ageOf(mrca);
    if (exact != null) return { kind: 'exact', mya: exact, low: exact, high: exact, basis: mrca.name };

    // Not in the table: bracket between the nearest dated ancestor (older bound)
    // and the oldest dated clade on either branch (younger bound).
    let high = null;
    for (let i = m - 1; i >= 0 && !high; i--) {
      const v = this.ageOf(pathA[i]);
      if (v != null) high = { mya: v, clade: pathA[i] };
    }
    let low = null;
    for (const n of [...belowA, ...belowB]) {
      const v = this.ageOf(n);
      if (v != null && (!low || v > low.mya) && (!high || v < high.mya)) low = { mya: v, clade: n };
    }
    if (!high && !low) return null;
    if (high && low) {
      return {
        kind: 'range',
        mya: Math.sqrt(low.mya * high.mya),
        low: low.mya, high: high.mya,
        lowClade: low.clade, highClade: high.clade,
      };
    }
    if (high) return { kind: 'below', mya: high.mya / 2, low: 0, high: high.mya, highClade: high.clade };
    return { kind: 'above', mya: low.mya, low: low.mya, high: null, lowClade: low.clade };
  }
}

function compareHits(a, b) {
  return a.tier - b.tier || a.rank - b.rank || a.len - b.len || a.node.id - b.node.id;
}

// Standard Linnaean ranks shown in the side-by-side classification table.
const MAIN_RANKS = ['domain', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species', 'subspecies'];

function rankedClassification(path) {
  const out = {};
  for (const n of path) if (MAIN_RANKS.includes(n.rank)) out[n.rank] = n;
  return out;
}

globalThis.Cladistics = { ...globalThis.Cladistics, Taxonomy, MAIN_RANKS, rankedClassification };
})();
