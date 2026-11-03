#!/usr/bin/env node
// Builds data/taxonomy.js from an NCBI taxonomy dump (nodes.dmp + names.dmp).
//
// Get the dump from https://ftp.ncbi.nlm.nih.gov/pub/taxonomy/taxdmp.zip and unzip it, then:
//   node tools/build-data.mjs <dump-dir> [--inat=<inat-dir>] [--all-species-under=Mammalia,Aves,...] [--include=Name1,Name2] [--out=data/taxonomy.js]
//
// The full NCBI taxonomy has ~3 million nodes, which is too much for a browser page.
// By default we keep every taxon that has an English common name, plus all of its
// ancestors. --all-species-under additionally keeps every species (and named
// subspecies) below the listed clades, so you can search them by scientific name.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const dumpDir = args.find((a) => !a.startsWith('--'));
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
if (!dumpDir) {
  console.error('Usage: node tools/build-data.mjs <dump-dir> [--all-species-under=Clade1,Clade2] [--out=data/taxonomy.js]');
  process.exit(1);
}
const outFile = path.resolve(opt('out', path.join(import.meta.dirname, '..', 'data', 'taxonomy.js')));
const allSpeciesUnder = opt('all-species-under', 'Mammalia,Aves').split(',').map((s) => s.trim()).filter(Boolean);
// Well-known model organisms that have no common name in NCBI.
const DEFAULT_EXTRAS = [
  'Caenorhabditis elegans', 'Schizosaccharomyces pombe', 'Neurospora crassa', 'Aspergillus nidulans',
  'Dictyostelium discoideum', 'Plasmodium falciparum', 'Tetrahymena thermophila', 'Chlamydomonas reinhardtii',
  'Physcomitrium patens', 'Marchantia polymorpha', 'Selaginella moellendorffii', 'Amborella trichopoda',
  'Trichoplax adhaerens', 'Amphimedon queenslandica', 'Mnemiopsis leidyi', 'Nematostella vectensis',
  'Hydra vulgaris', 'Schmidtea mediterranea', 'Platynereis dumerilii', 'Daphnia pulex', 'Tribolium castaneum',
  'Strongylocentrotus purpuratus', 'Ciona intestinalis', 'Branchiostoma floridae', 'Petromyzon marinus',
  'Callorhinchus milii', 'Latimeria chalumnae', 'Oryzias latipes', 'Takifugu rubripes', 'Anolis carolinensis',
  'Bacillus subtilis', 'Methanocaldococcus jannaschii', 'Sulfolobus acidocaldarius', 'Escherichia coli',
];
const extras = opt('include', DEFAULT_EXTRAS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
// Every alias target in data/aliases.js must be in the subset, even if NCBI gives it no common name.
const aliasFile = path.join(import.meta.dirname, '..', 'data', 'aliases.js');
if (fs.existsSync(aliasFile)) {
  const sandbox = { window: {} };
  new Function('window', fs.readFileSync(aliasFile, 'utf8'))(sandbox.window);
  for (const target of Object.values(sandbox.window.TAXON_ALIASES || {})) if (!extras.includes(target)) extras.push(target);
}

async function* dmpRows(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(dumpDir, file)), crlfDelay: Infinity });
  for await (const line of rl) yield line.split('\t|\t').map((f) => f.replace(/\t\|$/, ''));
}

console.log('Reading nodes.dmp ...');
const parent = new Map();
const rank = new Map();
for await (const f of dmpRows('nodes.dmp')) {
  const id = Number(f[0]);
  parent.set(id, Number(f[1]));
  rank.set(id, f[2]);
}

console.log('Reading names.dmp ...');
const sciName = new Map();
const common = new Map(); // id -> [preferred common name first, ...others]
const ncbiNameCount = new Map(); // id -> how many leading names in `common` came from NCBI
for await (const f of dmpRows('names.dmp')) {
  const id = Number(f[0]);
  const name = f[1];
  const cls = f[3];
  if (cls === 'scientific name') sciName.set(id, name);
  else if (cls === 'genbank common name') common.set(id, [name, ...(common.get(id) || []).filter((n) => n !== name)]);
  else if (cls === 'common name') {
    const list = common.get(id) || [];
    if (!list.includes(name)) list.push(name);
    common.set(id, list);
  }
}

// Optional: merge English common names from iNaturalist's taxonomy export
// (https://www.inaturalist.org/taxa/inaturalist-taxonomy.dwca.zip, unzipped).
// Taxa are matched to NCBI by exact scientific name; names shared by several
// NCBI taxa (homonyms) are skipped. NCBI's own names stay first.
const inatDir = opt('inat', '');
if (inatDir) {
  const parseCsv = (line) => {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c !== '"') cur += c;
        else if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  async function* csvRows(file) {
    let header = true;
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(inatDir, file)), crlfDelay: Infinity });
    for await (const line of rl) { if (header) { header = false; continue; } yield parseCsv(line); }
  }
  console.log('Reading iNaturalist names ...');
  const byName = new Map(); // scientific name -> NCBI id, or 0 if ambiguous
  for (const [id, name] of sciName) byName.set(name, byName.has(name) ? 0 : id);
  for (const [id, list] of common) ncbiNameCount.set(id, list.length);
  const vernacular = new Map(); // iNat id -> [names]
  for await (const f of csvRows('VernacularNames-english.csv')) {
    const name = f[1]?.trim();
    if (!name || name === name.toUpperCase()) continue; // skips banding codes like "CROW"
    const list = vernacular.get(f[0]) || [];
    if (!list.includes(name)) list.push(name);
    vernacular.set(f[0], list);
  }
  let matched = 0;
  for await (const f of csvRows('taxa.csv')) {
    const names = vernacular.get(f[0]);
    const id = names && byName.get(f[13]);
    if (!id) continue;
    if (!ncbiNameCount.has(id)) ncbiNameCount.set(id, 0);
    const list = common.get(id) || [];
    const lower = new Set(list.map((n) => n.toLowerCase()));
    for (const n of names) if (!lower.has(n.toLowerCase())) { list.push(n); lower.add(n.toLowerCase()); }
    common.set(id, list);
    matched++;
  }
  console.log(`iNaturalist: common names for ${matched} NCBI taxa`);
}

const isJunk = (id) => /\b(environmental samples|unclassified|incertae sedis|uncultured|metagenome)\b/i.test(sciName.get(id) || '');

const keep = new Set();
function keepWithAncestors(id) {
  while (id && !keep.has(id)) {
    keep.add(id);
    const p = parent.get(id);
    if (p === id) break;
    id = p;
  }
}

for (const id of common.keys()) if (!isJunk(id)) keepWithAncestors(id);
console.log(`Taxa with common names (+ ancestors): ${keep.size}`);

const extraSet = new Set(extras);
for (const [id, name] of sciName) if (extraSet.has(name)) { keepWithAncestors(id); extraSet.delete(name); }
if (extraSet.size) console.warn(`Not found in dump: ${[...extraSet].join(', ')}`);

if (allSpeciesUnder.length) {
  const roots = new Set();
  for (const [id, name] of sciName) if (allSpeciesUnder.includes(name)) roots.add(id);
  const under = (id) => {
    for (let i = 0; i < 80 && id !== 1; i++, id = parent.get(id)) if (roots.has(id)) return true;
    return false;
  };
  let added = 0;
  for (const [id, r] of rank) {
    if ((r === 'species' || r === 'subspecies') && !keep.has(id) && !isJunk(id)
      && !/ sp\.| cf\.| aff\.|\d/.test(sciName.get(id)) && under(id)) {
      keepWithAncestors(id);
      added++;
    }
  }
  console.log(`Added ${added} species under ${allSpeciesUnder.join(', ')}; total ${keep.size}`);
}

// Ancestors are emitted before descendants so the browser can build lineages in one pass.
const depth = new Map([[1, 0]]);
const depthOf = (id) => {
  const stack = [];
  while (!depth.has(id)) { stack.push(id); id = parent.get(id); }
  let d = depth.get(id);
  while (stack.length) depth.set(stack.pop(), ++d);
  return d;
};
const ids = [...keep].sort((a, b) => depthOf(a) - depthOf(b) || a - b);

const ranks = [...new Set(ids.map((id) => rank.get(id)))];
const rankIndex = new Map(ranks.map((r, i) => [r, i]));
const clean = (s) => s.replace(/[\t\n|]/g, ' ');
const lines = ids.map((id) => [
  id,
  id === 1 ? 0 : parent.get(id),
  rankIndex.get(rank.get(id)),
  clean(sciName.get(id) || String(id)),
  (common.get(id) || []).map(clean).join('|'),
  ...((ncbiNameCount.get(id) ?? (common.get(id) || []).length) !== (common.get(id) || []).length ? [ncbiNameCount.get(id)] : []),
].join('\t'));

const banner = `// Generated by tools/build-data.mjs from the NCBI Taxonomy dump on ${new Date().toISOString().slice(0, 10)}.
// Source: https://ftp.ncbi.nlm.nih.gov/pub/taxonomy/ (public domain, NCBI).
// Rows: taxId \\t parentId \\t rankIndex \\t scientificName \\t commonNames (|-separated)
//       [\\t ncbiNameCount, only when some common names come from iNaturalist]
`;
const body = `window.TAXONOMY_DATA = ${JSON.stringify({
  built: new Date().toISOString(),
  source: 'NCBI Taxonomy',
  ranks,
  rows: lines.join('\n'),
})};\n`;
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, banner + body);
console.log(`Wrote ${ids.length} taxa to ${outFile} (${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB)`);
