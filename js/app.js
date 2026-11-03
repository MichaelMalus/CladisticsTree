// UI: pickers with autocomplete, comparison rendering, URL hash state.
(function () {
const {
  Taxonomy, MAIN_RANKS, rankedClassification, PERIODS, periodAt, describeTime, formatMya,
} = globalThis.Cladistics;

const EXAMPLES = [
  ['human', 'chimpanzee'],
  ['dog', 'cat'],
  ['human', 'chimpanzee', 'gorilla', 'orangutan'],
  ['human', 'mouse', 'chicken', 'zebrafish', 'shark'],
  ['dog', 'cat', 'horse', 'cow', 'blue whale'],
  ['honey bee', 'fire ant', 'fruit fly', 'monarch butterfly'],
  ['oak', 'pine', 'rice', 'rose'],
  ['human', 'yeast', 'oak', 'e. coli'],
];
const MAX_PICKERS = 12;
const UNRANKED = new Set(['clade', 'no rank']);
const ITALIC_RANKS = new Set(['genus', 'subgenus', 'species', 'subspecies', 'species group', 'species subgroup', 'varietas', 'forma']);

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let taxonomy;
let showAllClades = false;
let lastView = null; // { kind: 'pair', r, letters } | { kind: 'many', m, letters }
const pickers = [];

// ---------- formatting helpers ----------

function sciName(node) {
  return ITALIC_RANKS.has(node.rank) ? `<i>${esc(node.name)}</i>` : esc(node.name);
}

function displayName(node) {
  const common = node.commonNames[0];
  return common ? `${esc(common)} <span class="sci">(${sciName(node)})</span>` : sciName(node);
}

function plainName(node) {
  return node.commonNames[0] || node.name;
}

// "Common name (Scientific name)", or just the scientific name when there is no common name.
function fullName(node) {
  const common = node.commonNames[0];
  return common ? `${common} (${node.name})` : node.name;
}

function ncbiLink(node) {
  return `https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=${node.id}`;
}

function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function letter(i) { return String.fromCharCode(65 + i); }

// Compact age label: "≈ 90 Ma", "120–280 Ma", "< 50 Ma".
function shortAge(g) {
  const n = (v) => (v < 10 ? v.toFixed(1) : Math.round(v));
  if (g.kind === 'range') return `${n(g.low)}–${n(g.high)} Ma`;
  if (g.kind === 'below') return `< ${n(g.high)} Ma`;
  if (g.kind === 'above') return `> ${n(g.low)} Ma`;
  return g.mya >= 1000 ? `≈ ${(g.mya / 1000).toFixed(1)} Ga` : `≈ ${n(g.mya)} Ma`;
}

function agePhrase(g) {
  switch (g.kind) {
    case 'exact':
    case 'pair':
      return `about <strong>${formatMya(g.mya)} ago</strong>, in the ${esc(describeTime(g.mya))}`;
    case 'range':
      return `<strong>between ${formatMya(g.low)} and ${formatMya(g.high)} ago</strong> (${esc(describeTime(g.high))} to ${esc(describeTime(g.low))})`;
    case 'below':
      return `<strong>less than ${formatMya(g.high)} ago</strong>`;
    case 'above':
      return `<strong>more than ${formatMya(g.low)} ago</strong>`;
    default:
      return '';
  }
}

function ageBasis(g, mrca) {
  if (!g) return '';
  if (g.kind === 'exact') return `Crown age of ${esc(g.basis)} from the clade-age table.`;
  if (g.kind === 'pair') return `NCBI leaves ${sciName(mrca)} unresolved here, so this uses the dated ${esc(g.basis)}.`;
  const parts = [];
  if (g.highClade) parts.push(`older bound: ${sciName(g.highClade)} (${formatMya(g.high)})`);
  if (g.lowClade) parts.push(`younger bound: ${sciName(g.lowClade)} (${formatMya(g.low)})`);
  return `${sciName(mrca)} has no age in the table, so it is bracketed by dated relatives: ${parts.join('; ')}.`;
}

// ---------- pickers ----------

let pickerSeq = 0;

class Picker {
  constructor(onPick, onRemove) {
    const n = ++pickerSeq;
    this.root = document.createElement('div');
    this.root.className = 'picker';
    this.root.innerHTML = `
      <label for="input-${n}"></label>
      <div class="picker-row">
        <input id="input-${n}" type="text" spellcheck="false" role="combobox"
               aria-expanded="false" aria-controls="suggest-${n}" aria-autocomplete="list">
        <button type="button" class="remove" title="Remove">×</button>
      </div>
      <ul id="suggest-${n}" class="suggestions" role="listbox" hidden></ul>`;
    this.label = $('label', this.root);
    this.input = $('input', this.root);
    this.list = $('.suggestions', this.root);
    this.removeBtn = $('.remove', this.root);
    this.node = null;
    this.hits = [];
    this.active = -1;
    this.onPick = onPick;

    this.input.addEventListener('input', () => { this.node = null; this.update(); });
    this.input.addEventListener('focus', () => { if (this.input.value && !this.node) this.update(); });
    this.input.addEventListener('blur', () => setTimeout(() => this.close(), 120));
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li) { e.preventDefault(); this.choose(Number(li.dataset.i)); }
    });
    this.removeBtn.addEventListener('click', () => onRemove(this));
  }

  setIndex(i, removable) {
    this.label.textContent = `Organism ${letter(i)}`;
    this.input.placeholder = ['e.g. human or Homo sapiens', 'e.g. dog or Canis lupus', 'e.g. chicken'][i] || 'another organism';
    this.removeBtn.hidden = !removable;
    this.removeBtn.setAttribute('aria-label', `Remove organism ${letter(i)}`);
  }

  update() {
    this.hits = taxonomy.search(this.input.value, 8);
    this.active = this.hits.length ? 0 : -1;
    this.render();
  }

  render() {
    if (!this.hits.length) { this.close(); return; }
    this.list.innerHTML = this.hits.map(({ node, matched }, i) => {
      const common = matched || node.commonNames[0];
      // When an alternate name matched, also show the preferred one.
      const preferred = node.commonNames[0] && node.commonNames[0].toLowerCase() !== common?.toLowerCase()
        ? `${esc(node.commonNames[0])} · ` : '';
      return `<li role="option" data-i="${i}" id="${this.list.id}-${i}" class="${i === this.active ? 'active' : ''}" aria-selected="${i === this.active}">
        <span class="s-main">${common ? esc(common) : sciName(node)}</span>
        ${common ? `<span class="s-sci">${preferred}${sciName(node)}</span>` : ''}
        <span class="s-rank">${esc(node.rank)}</span>
      </li>`;
    }).join('');
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.input.setAttribute('aria-activedescendant', this.active >= 0 ? `${this.list.id}-${this.active}` : '');
  }

  close() {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }

  onKey(e) {
    const open = !this.list.hidden && this.hits.length;
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); this.active = (this.active + 1) % this.hits.length; this.render(); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); this.active = (this.active - 1 + this.hits.length) % this.hits.length; this.render(); }
    else if (e.key === 'Enter' && open && this.active >= 0) { e.preventDefault(); this.choose(this.active); }
    else if (e.key === 'Escape') this.close();
  }

  choose(i) {
    this.set(this.hits[i].node);
    this.close();
    this.onPick(this);
  }

  set(node) {
    this.node = node;
    this.input.value = node ? fullName(node) : '';
  }

  setText(text) {
    this.node = null;
    this.input.value = text;
  }

  get filled() { return this.input.value.trim() !== ''; }

  // The picked node, or the best match for whatever was typed.
  resolve() {
    if (this.node) return this.node;
    const node = taxonomy.resolve(this.input.value);
    if (node) this.set(node);
    return node;
  }
}

function relabelPickers() {
  pickers.forEach((p, i) => p.setIndex(i, pickers.length > 2));
  $('#add-picker').hidden = pickers.length >= MAX_PICKERS;
}

function addPicker() {
  const p = new Picker(onPicked, removePicker);
  pickers.push(p);
  $('#pickers').append(p.root);
  relabelPickers();
  return p;
}

function removePicker(p) {
  if (pickers.length <= 2) return;
  pickers.splice(pickers.indexOf(p), 1);
  p.root.remove();
  relabelPickers();
  if (lastView) compare();
}

// Make the picker list hold exactly `count` entries (at least two).
function setPickerCount(count) {
  while (pickers.length < Math.max(2, count)) addPicker();
  while (pickers.length > Math.max(2, count)) pickers.pop().root.remove();
  relabelPickers();
}

// After a pick: compare once every filled box is resolved, else move to the next empty box.
function onPicked(p) {
  const next = pickers.slice(pickers.indexOf(p) + 1).find((q) => !q.filled) || pickers.find((q) => !q.filled);
  if (next) next.input.focus();
  else if (pickers.every((q) => q.node)) compare();
}

// ---------- rendering: shared pieces ----------

function renderResult(view) {
  const results = $('#results');
  results.hidden = false;
  if (view.kind === 'pair') {
    const { r } = view;
    results.innerHTML = `
      ${renderPairSummary(r, view.letters)}
      ${r.age ? renderTimeline([{ g: r.age }]) : ''}
      ${renderPairTree(r, view.letters)}
      ${renderClassification([r.a, r.b], new Map([[r.a.id, r.pathA], [r.b.id, r.pathB]]), view.letters)}`;
  } else {
    const { m } = view;
    const markers = [];
    (function walk(t) {
      if (t.age) markers.push({ g: t.age, name: t.node.name });
      t.children.forEach(walk);
    })(m.tree);
    results.innerHTML = `
      ${renderManySummary(m, view.letters)}
      ${markers.length ? renderTimeline(markers) : ''}
      ${renderCladogram(m, view.letters)}
      ${renderMatrix(m, view.letters)}
      ${renderClassification(m.taxa, m.paths, view.letters)}`;
  }
  // Wide cladograms scroll; start at the taxa end.
  const sc = $('.svg-scroll');
  if (sc) sc.scrollLeft = sc.scrollWidth;
  $('#toggle-clades')?.addEventListener('click', () => {
    showAllClades = !showAllClades;
    renderResult(lastView);
  });
}

function organismCard(node, label) {
  const others = node.commonNames.slice(1, 4);
  return `<div class="organism">
    <div class="organism-label">${label}</div>
    <div class="organism-name">${node.commonNames[0] ? esc(capitalise(node.commonNames[0])) : sciName(node)}</div>
    <div class="organism-sci">${sciName(node)} · ${esc(node.rank)}</div>
    ${others.length ? `<div class="organism-aka">also: ${others.map(esc).join(', ')}</div>` : ''}
    <a class="organism-link" href="${ncbiLink(node)}" target="_blank" rel="noopener">NCBI taxid ${node.id}</a>
  </div>`;
}

function mrcaBox(mrca, label, sharedCount) {
  return `<div class="mrca">
    <div class="mrca-label">${label}</div>
    <div class="mrca-name">${sciName(mrca)}${mrca.commonNames[0] ? ` <span class="mrca-common">${esc(mrca.commonNames[0])}</span>` : ''}</div>
    <div class="mrca-rank">${esc(mrca.rank)} · ${sharedCount} shared levels of classification</div>
  </div>`;
}

// Log-scaled geologic time axis, present on the right. Each marker is { g: age, name? }.
function renderTimeline(markers) {
  // Draw at the card's real width so labels stay legible on small screens.
  const W = Math.max(300, Math.round(($('#results').clientWidth || 1000) - 42));
  const maxT = 4567;
  const x = (mya) => W * (1 - Math.log10(1 + mya) / Math.log10(1 + maxT));
  const single = markers.length === 1;

  // Lay labels out in rows so they don't overlap.
  const rowEnds = [];
  const placed = markers
    .map((mk) => {
      const g = mk.g;
      const text = single
        ? `${shortAge(g)}${g.kind === 'exact' || g.kind === 'pair' ? ` · ${periodAt(g.mya).name}` : ''}`
        : `${mk.name} ${shortAge(g).replace('≈ ', '')}`;
      return { ...mk, px: x(g.mya), text, w: text.length * 7.2 };
    })
    .sort((a, b) => a.px - b.px)
    .map((mk) => {
      const start = Math.min(Math.max(mk.px - mk.w / 2, 0), W - mk.w);
      let row = rowEnds.findIndex((end) => end + 8 < start);
      if (row < 0) { row = rowEnds.length; rowEnds.push(0); }
      rowEnds[row] = start + mk.w;
      return { ...mk, row, tx: start + mk.w / 2 };
    });
  const rowH = 18;
  const top = rowEnds.length * rowH + 14;
  const band = 30;
  const H = top + band + 26;

  const bands = PERIODS.map((p) => {
    const x1 = x(p.start);
    const x2 = x(p.end);
    const w = x2 - x1;
    const label = w > p.name.length * 7 + 8 ? p.name : w > 28 ? p.name.slice(0, 3) : '';
    return `<g><title>${p.name} (${p.start}–${p.end} Ma)</title>
      <rect x="${x1}" y="${top}" width="${w}" height="${band}" fill="${p.color}"></rect>
      ${label ? `<text x="${x1 + w / 2}" y="${top + band / 2 + 4}" class="band-label">${label}</text>` : ''}</g>`;
  }).join('');

  const ticks = [1, 10, 100, 1000, 4000].filter((t) => W - x(t) > 44).map((t) => `
    <line x1="${x(t)}" x2="${x(t)}" y1="${top + band}" y2="${top + band + 6}" class="tick"></line>
    <text x="${x(t)}" y="${top + band + 20}" class="tick-label">${t >= 1000 ? `${t / 1000} Ga` : `${t} Ma`}</text>`).join('')
    + `<text x="${W - 2}" y="${top + band + 20}" class="tick-label end">now</text>`;

  const lines = placed.map((mk) => {
    const g = mk.g;
    const ly = top - 10 - mk.row * rowH;
    const range = g.low !== g.high
      ? `<rect x="${x(g.high ?? maxT)}" y="${top - 4}" width="${x(g.low || 0) - x(g.high ?? maxT)}" height="${band + 8}" class="range"></rect>`
      : '';
    return `<g class="mark"><title>${esc(mk.name ? `${mk.name}: ` : '')}${esc(shortAge(g))}</title>${range}
      <line x1="${mk.px}" x2="${mk.px}" y1="${ly + 4}" y2="${top + band + 2}" class="marker"></line>
      <circle cx="${mk.px}" cy="${ly + 4}" r="3.5" class="marker-dot"></circle></g>`;
  }).join('');
  const labels = placed.map((mk) => `<text x="${mk.tx}" y="${top - 10 - mk.row * rowH}" class="marker-label${single ? '' : ' small'}" text-anchor="middle">${esc(mk.text)}</text>`).join('');

  return `<section class="card timeline">
    <h2>When they split</h2>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Geologic timeline marking ${single ? 'the split' : `${markers.length} splits`}">
      ${bands}${ticks}${lines}${labels}
    </svg>
    <p class="hint">Log scale: recent time is stretched so short and long splits both fit. Hover a band for its dates.</p>
  </section>`;
}

// One column per taxon; neighbouring cells with the same taxon merge.
function renderClassification(taxa, paths, letters) {
  const ranked = taxa.map((t) => rankedClassification(paths.get(t.id)));
  let diverged = false;
  const cell = (n) => (n ? `${sciName(n)}${n.commonNames[0] ? `<span class="c-common">${esc(n.commonNames[0])}</span>` : ''}` : '<span class="none">—</span>');
  const rows = MAIN_RANKS.filter((rank) => ranked.some((c) => c[rank])).map((rank) => {
    const cells = [];
    for (const c of ranked) {
      const n = c[rank] || null;
      const prev = cells[cells.length - 1];
      if (prev && n && prev.n === n) prev.span++;
      else cells.push({ n, span: 1 });
    }
    const allSame = cells.length === 1;
    const first = !allSame && !diverged;
    if (!allSame) diverged = true;
    return `<tr class="${allSame ? 'same' : 'differ'}${first ? ' first-differ' : ''}">
      <th scope="row">${capitalise(rank)}</th>
      ${cells.map((c) => `<td${c.span > 1 ? ` colspan="${c.span}" class="shared-cell"` : ''}>${cell(c.n)}</td>`).join('')}
    </tr>`;
  }).join('');
  return `<section class="card classification">
    <h2>Classification</h2>
    <div class="table-scroll">
      <table class="${taxa.length > 2 ? 'many' : ''}">
        <thead><tr><th></th>${taxa.map((t) => `<th><span class="tag">${letters.get(t.id)}</span> ${esc(capitalise(plainName(t)))}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="hint">Cells that span several columns are shared. Ranks NCBI doesn't assign for a lineage show as —.</p>
  </section>`;
}

// ---------- rendering: two taxa ----------

function pairSentence(r) {
  if (r.relation === 'same') return `These are the same taxon.`;
  if (r.relation === 'a-contains-b') return `${displayName(r.b)} is itself a member of ${displayName(r.a)}, so there is no split between them to date.`;
  if (r.relation === 'b-contains-a') return `${displayName(r.a)} is itself a member of ${displayName(r.b)}, so there is no split between them to date.`;
  if (r.relation === 'unrelated') return `These two have no common node in this taxonomy (viruses sit outside the tree of cellular life).`;
  if (!r.age) return `No age estimate is available for this split in <code>data/clade-ages.js</code>.`;
  return `The lineages of ${esc(plainName(r.a))} and ${esc(plainName(r.b))} split ${agePhrase(r.age)}.`;
}

function renderPairSummary(r, letters) {
  return `<section class="card summary">
    <div class="organisms">
      ${organismCard(r.a, letters.get(r.a.id))}
      <div class="meets" aria-hidden="true"><span></span></div>
      ${organismCard(r.b, letters.get(r.b.id))}
    </div>
    ${r.mrca ? mrcaBox(r.mrca, 'Last common ancestor belongs to', r.shared.length) : ''}
    <p class="verdict">${pairSentence(r)}</p>
    ${r.age ? `<p class="basis">${ageBasis(r.age, r.mrca)}</p>` : ''}
  </section>`;
}

function lineageItems(nodes, { mrca } = {}) {
  let hidden = 0;
  const items = [];
  for (const n of nodes) {
    const age = taxonomy.ageOf(n);
    const keep = showAllClades || !UNRANKED.has(n.rank) || n === mrca || n === nodes[nodes.length - 1];
    if (!keep) { hidden++; continue; }
    if (hidden) { items.push(`<li class="node skipped">${hidden} unranked clade${hidden > 1 ? 's' : ''}</li>`); hidden = 0; }
    items.push(`<li class="node${n === mrca ? ' is-mrca' : ''}${UNRANKED.has(n.rank) ? ' unranked' : ''}">
      <span class="n-name">${sciName(n)}</span>
      <span class="n-rank">${esc(n.rank)}</span>
      ${n.commonNames[0] ? `<span class="n-common">${esc(n.commonNames[0])}</span>` : ''}
      ${age != null ? `<span class="n-age">${age >= 1000 ? `${(age / 1000).toFixed(1)} Ga` : `${age} Ma`}</span>` : ''}
    </li>`);
  }
  if (hidden) items.push(`<li class="node skipped">${hidden} unranked clade${hidden > 1 ? 's' : ''}</li>`);
  return items.join('');
}

function renderPairTree(r, letters) {
  const unrankedCount = [...r.pathA, ...r.branchB].filter((n) => UNRANKED.has(n.rank)).length;
  const forked = r.relation === 'diverged';
  return `<section class="card tree">
    <div class="tree-head">
      <h2>Lineage</h2>
      ${unrankedCount ? `<button type="button" id="toggle-clades" class="link-button">${showAllClades ? 'Hide' : 'Show'} ${unrankedCount} unranked clades</button>` : ''}
    </div>
    <div class="cladogram ${forked ? 'forked' : ''}">
      <ol class="lineage trunk">${lineageItems(r.shared, { mrca: r.mrca })}</ol>
      ${forked ? `
        <div class="fork" aria-hidden="true"></div>
        <div class="branches">
          <div class="branch"><div class="branch-label">${letters.get(r.a.id)} · ${esc(plainName(r.a))}</div><ol class="lineage">${lineageItems(r.branchA)}</ol></div>
          <div class="branch"><div class="branch-label">${letters.get(r.b.id)} · ${esc(plainName(r.b))}</div><ol class="lineage">${lineageItems(r.branchB)}</ol></div>
        </div>` : r.relation !== 'same' ? `
        <ol class="lineage">${lineageItems(r.branchA.length ? r.branchA : r.branchB)}</ol>` : ''}
    </div>
  </section>`;
}

// ---------- rendering: three or more taxa ----------

function renderManySummary(m, letters) {
  const n = m.taxa.length;
  const root = m.tree;
  let sentence;
  if (!m.mrca) {
    sentence = `These ${n} have no common node in this taxonomy (viruses sit outside the tree of cellular life).`;
  } else if (root.selected) {
    sentence = `All the others are members of ${displayName(m.mrca)}.`;
  } else if (root.age) {
    sentence = `All ${n} last shared a common ancestor ${agePhrase(root.age)}.`;
  } else {
    sentence = `No age estimate is available for ${sciName(m.mrca)} in <code>data/clade-ages.js</code>.`;
  }

  // Closest dated pair, as a pointer into the matrix.
  let closest = null;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = m.pairs.get(`${m.taxa[i].id}:${m.taxa[j].id}`);
      if (r.age && (!closest || r.age.mya < closest.r.age.mya)) closest = { r };
    }
  }

  return `<section class="card summary">
    <div class="organisms many">
      ${[...m.taxa].sort((a, b) => letters.get(a.id).localeCompare(letters.get(b.id))).map((t) => organismCard(t, letters.get(t.id))).join('')}
    </div>
    ${m.mrca ? mrcaBox(m.mrca, `Last common ancestor of all ${n} belongs to`, m.shared.length) : ''}
    <p class="verdict">${sentence}</p>
    ${root.age && !root.selected ? `<p class="basis">${ageBasis(root.age, m.mrca)}</p>` : ''}
    ${closest ? `<p class="basis">Closest relatives here: ${esc(plainName(closest.r.a))} and ${esc(plainName(closest.r.b))}, ${esc(shortAge(closest.r.age))} (${sciName(closest.r.mrca)}).</p>` : ''}
  </section>`;
}

// Rectangular cladogram: root on the left, taxa on the right, one column per branching level.
function renderCladogram(m, letters) {
  const tree = m.tree;
  const leafCount = (function count(t) { return (t.children.length ? 0 : 1) + t.children.reduce((s, c) => s + count(c), 0); })(tree);
  const available = Math.max(280, ($('#results').clientWidth || 1000) - (window.innerWidth <= 680 ? 30 : 42));
  const narrow = available < 520;
  const labelW = narrow ? 128 : Math.min(250, Math.max(150, available * 0.32));
  const padL = 16;
  const levels = Math.max(1, tree.height);
  let longest = 0;
  (function scan(t) { if (t.children.length && t.node) longest = Math.max(longest, t.node.name.length + (t.selected ? 4 : 0)); t.children.forEach(scan); })(tree);
  const minLevel = narrow ? 66 : Math.max(104, Math.min(180, longest * 6.8 + 22));
  const levelW = Math.max(minLevel, (available - labelW - padL) / levels);
  const W = Math.round(padL + levels * levelW + labelW);
  const rowH = 44;
  const padT = 22;
  const H = padT + leafCount * rowH;

  let leafIndex = 0;
  const xOf = (t) => padL + (levels - t.height) * levelW;
  (function layout(t) {
    t.children.forEach(layout);
    t.x = xOf(t);
    if (t.children.length) t.y = (t.children[0].y + t.children[t.children.length - 1].y) / 2;
    else t.y = padT + rowH * (leafIndex++ + 0.5);
  })(tree);
  // Taxa that are ancestors of other picks sit at their own level, not the leaf column.

  const fit = (text, px) => {
    const max = Math.floor(px / 6.6);
    return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
  };

  const parts = [];
  (function draw(t, parent) {
    const edgeStart = parent ? parent.x : t.x - 12;
    parts.push(`<line x1="${edgeStart}" x2="${t.x}" y1="${t.y}" y2="${t.y}" class="edge"></line>`);
    if (t.children.length) {
      const ys = t.children.map((c) => c.y);
      parts.push(`<line x1="${t.x}" x2="${t.x}" y1="${Math.min(...ys)}" y2="${Math.max(...ys)}" class="edge"></line>`);
      t.children.forEach((c) => draw(c, t));
      if (t.node) {
        const room = levelW - 12;
        const tag = t.selected ? `${letters.get(t.node.id)} · ` : '';
        parts.push(`<g class="clade${t.selected ? ' picked' : ''}"><title>${esc(t.node.name)} (${esc(t.node.rank)})${t.age ? `: ${esc(shortAge(t.age))}` : ''}</title>
          <circle cx="${t.x}" cy="${t.y}" r="${t.selected ? 6 : 4.5}" class="clade-dot${t.age ? ' dated' : ''}"></circle>
          <text x="${t.x + 8}" y="${t.y - 7}" class="clade-name">${esc(fit(tag + t.node.name, room))}</text>
          ${t.age ? `<text x="${t.x + 8}" y="${t.y + 16}" class="clade-age">${esc(shortAge(t.age))}</text>` : ''}
        </g>`);
      }
    } else {
      const n = t.node;
      const common = n.commonNames[0];
      parts.push(`<g class="leaf"><title>${esc(n.name)}${common ? ` (${esc(common)})` : ''}</title>
        <circle cx="${t.x}" cy="${t.y}" r="4" class="leaf-dot"></circle>
        <text x="${t.x + 10}" y="${t.y - 3}" class="leaf-name"><tspan class="leaf-tag">${letters.get(n.id)}</tspan> ${esc(fit(capitalise(common || n.name), labelW - 30))}</text>
        <text x="${t.x + 10}" y="${t.y + 13}" class="leaf-sci${ITALIC_RANKS.has(n.rank) ? ' italic' : ''}">${esc(fit(n.name, labelW - 14))}</text>
      </g>`);
    }
  })(tree, null);

  const sharedRanked = m.shared.filter((n) => !UNRANKED.has(n.rank) || n === m.mrca);
  return `<section class="card tree">
    <h2>Cladogram</h2>
    ${m.mrca ? `<p class="shared-lineage"><span class="shared-label">Shared lineage</span> ${sharedRanked.map((n) => `<span class="crumb${n === m.mrca ? ' is-mrca' : ''}">${sciName(n)}</span>`).join(' <span class="sep">›</span> ')}</p>` : ''}
    <div class="svg-scroll">
       <svg class="cladogram-svg${W <= available * 1.1 ? ' fit' : ''}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cladogram of ${m.taxa.length} taxa">
        ${parts.join('')}
      </svg>
    </div>
    <p class="hint">Branching points show the clade where lineages meet and its estimated age. Branch lengths are not to scale. Several branches from one point mean NCBI doesn't resolve their order.</p>
  </section>`;
}

function renderMatrix(m, letters) {
  const taxa = m.taxa;
  const logs = [...m.pairs.values()].filter((r) => r.age).map((r) => Math.log10(1 + r.age.mya));
  const lo = Math.min(...logs);
  const span = Math.max(...logs) - lo || 1;
  const head = taxa.map((t) => `<th scope="col"><span class="tag">${letters.get(t.id)}</span><span class="m-name">${esc(plainName(t))}</span></th>`).join('');
  const rows = taxa.map((a) => `<tr>
    <th scope="row"><span class="tag">${letters.get(a.id)}</span> ${esc(capitalise(plainName(a)))}</th>
    ${taxa.map((b) => {
      if (a === b) return '<td class="diag"></td>';
      const r = m.pairs.get(`${a.id}:${b.id}`);
      if (!r.age) {
        const note = r.relation === 'diverged' ? '?' : r.relation === 'unrelated' ? '—' : 'within';
        return `<td class="m-none" title="${esc(r.mrca ? r.mrca.name : '')}">${note}</td>`;
      }
      const shade = (0.12 + 0.88 * ((Math.log10(1 + r.age.mya) - lo) / span)).toFixed(2);
      return `<td style="--shade:${shade}"${shade > 0.55 ? ' class="deep"' : ''} title="${esc(`${plainName(a)} / ${plainName(b)}: ${r.mrca.name}, ${shortAge(r.age)}`)}">
        <span class="m-age">${esc(shortAge(r.age).replace('≈ ', ''))}</span><span class="m-clade">${esc(r.mrca.name)}</span></td>`;
    }).join('')}
  </tr>`).join('');
  return `<section class="card matrix">
    <h2>Pairwise splits</h2>
    <div class="table-scroll">
      <table>
        <thead><tr><th></th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="hint">Each cell is when that pair's lineages split, and the clade where they meet. Darker means older. “within” means one taxon contains the other.</p>
  </section>`;
}

// ---------- wiring ----------

function compare(pushHash = true) {
  const status = $('#status');
  const fail = (msg) => {
    status.textContent = msg;
    status.hidden = false;
    $('#results').hidden = true;
    lastView = null;
  };

  const filled = pickers.filter((p) => p.filled);
  const missing = filled.filter((p) => !p.resolve()).map((p) => `“${p.input.value.trim()}”`);
  if (missing.length) {
    fail(`No match for ${missing.join(', ')}. Try a scientific name or a different common name.`);
    return;
  }

  const letters = new Map();
  const nodes = [];
  pickers.forEach((p, i) => {
    if (p.node && !letters.has(p.node.id)) { letters.set(p.node.id, letter(i)); nodes.push(p.node); }
  });
  if (nodes.length < 2) {
    fail(filled.length >= 2 ? 'Pick at least two different organisms.' : 'Enter at least two organisms to compare.');
    return;
  }

  status.hidden = true;
  lastView = nodes.length === 2
    ? { kind: 'pair', r: taxonomy.compare(nodes[0], nodes[1]), letters }
    : { kind: 'many', m: taxonomy.compareMany(nodes), letters };
  renderResult(lastView);

  const names = nodes.map((n) => plainName(n));
  document.title = `${capitalise(names.slice(0, 3).join(' vs '))}${names.length > 3 ? ` +${names.length - 3}` : ''} · Cladistics Tree`;
  if (pushHash) {
    const hash = `#t=${nodes.map((n) => n.id).join(',')}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
  }
}

// #t=9606,9598,human  (older links use #a=...&b=...)
function loadFromHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const values = params.has('t')
    ? params.get('t').split(',').map((s) => s.trim()).filter(Boolean)
    : ['a', 'b'].map((k) => params.get(k)).filter(Boolean);
  if (!values.length) return;
  setPickerCount(values.length);
  values.forEach((v, i) => {
    const node = /^\d+$/.test(v) ? taxonomy.get(v) : null;
    if (node) pickers[i].set(node);
    else pickers[i].setText(v);
  });
  compare(false);
}

function loadExample(names) {
  setPickerCount(names.length);
  names.forEach((name, i) => pickers[i].set(taxonomy.resolve(name)));
  compare();
}

function init() {
  if (!globalThis.TAXONOMY_DATA) {
    $('#status').innerHTML = 'Missing <code>data/taxonomy.js</code>. Build it with <code>node tools/build-data.mjs &lt;dump-dir&gt;</code> (see README).';
    return;
  }
  taxonomy = new Taxonomy(globalThis.TAXONOMY_DATA, globalThis.CLADE_AGES, globalThis.TAXON_ALIASES);

  setPickerCount(2);
  $('#add-picker').addEventListener('click', () => addPicker().input.focus());
  $('#compare-form').addEventListener('submit', (e) => { e.preventDefault(); compare(); });

  const ex = $('#examples');
  for (const names of EXAMPLES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = names.join(' · ');
    btn.addEventListener('click', () => loadExample(names));
    ex.append(btn);
  }

  const built = globalThis.TAXONOMY_DATA.built?.slice(0, 10);
  $('#footer').innerHTML = `${taxonomy.size.toLocaleString()} taxa from the NCBI Taxonomy${built ? ` (built ${built})` : ''}.
    Divergence ages are approximate crown-group estimates from <code>data/clade-ages.js</code>, compiled from published molecular-clock studies.`;

  window.addEventListener('hashchange', loadFromHash);
  let resizeTimer;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (lastView && window.innerWidth !== lastWidth) renderResult(lastView);
      lastWidth = window.innerWidth;
    }, 150);
  });
  $('#status').hidden = true;
  loadFromHash();
  if (!lastView) pickers[0].input.focus();
}

init();
})();
