# Cladistics Tree

Pick two or more organisms (up to 12) and see:

- the scientific classification of each (domain → species, plus the full NCBI lineage),
- the clade where their lineages meet (the last common ancestor),
- roughly when they split, placed on the geologic time scale.

With two organisms you get both full lineages side by side. With three or more you get:

- a cladogram, with each branching point labelled by its clade and age,
- a pairwise table of split times,
- a classification table where shared ranks merge across columns.

Comparisons are linkable: the URL hash holds the NCBI tax ids, e.g. `index.html#t=9606,9598,9615`.

Everything runs in the browser on local data files. There's no server, no build step and no network access.

## Run it

Open `index.html` in a browser (double-click it). That's it.

All files load as classic `<script>` tags, so they work from `file://`.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `css/`, `js/` | The app |
| `js/taxonomy.js` | Parsing, search, lineage, last common ancestor and age estimation |
| `js/geotime.js` | Geologic time scale (ICS 2023) |
| `data/taxonomy.js` | Generated subset of the NCBI Taxonomy with iNaturalist common names (~190k taxa, 13 MB) |
| `data/clade-ages.js` | Hand-curated crown-group ages (Mya) for ~150 clades, plus pair overrides. Edit freely |
| `data/aliases.js` | ~380 everyday names mapped to the taxon people usually mean ("oak" → *Quercus*, "zebra" → *Equus quagga*) |
| `tools/build-data.mjs` | Regenerates `data/taxonomy.js` from an NCBI dump |

## How ages are estimated

NCBI Taxonomy has no dates, so ages come from `data/clade-ages.js`:

1. If a pair override matches (e.g. *Homo*–*Pan*, where NCBI lumps human, chimp and gorilla into one unresolved Homininae node), that age is used.
2. If the last common ancestor's clade has an age, that's the answer.
3. Otherwise the split is bracketed: it is younger than the nearest dated ancestor and older than the oldest dated clade on either branch.

The ages are rounded figures from molecular-clock studies (TimeTree, dos Reis et al. 2015, Misof et al. 2014, Morris et al. 2018, and others). Published estimates often differ by 10–20%.

## Rebuilding the taxonomy data

You'll need Node 18+.

1. Download https://ftp.ncbi.nlm.nih.gov/pub/taxonomy/taxdmp.zip (~80 MB) and unzip `nodes.dmp` and `names.dmp`.
2. Optional but recommended: download https://www.inaturalist.org/taxa/inaturalist-taxonomy.dwca.zip (~80 MB) and unzip `taxa.csv` and `VernacularNames-english.csv`.
3. Run:

```bash
node tools/build-data.mjs path/to/ncbi-dump --inat=path/to/inat-dir
```

NCBI only records common names for ~50k taxa. iNaturalist's curated English names add ~120k more (birds, plants, insects, fungi, fish). They're matched to NCBI by exact scientific name, and homonyms are skipped. In search, iNaturalist names rank just below NCBI's own names, so NCBI still decides ties.

By default the build keeps:

- every taxon with an English common name (from NCBI, plus iNaturalist with `--inat`),
- every species of mammal and bird,
- a list of model organisms that have no common name,
- every target in `data/aliases.js`,
- all of their ancestors.

You can change this with:

- `--all-species-under=Mammalia,Aves,Testudines` to keep every species under the listed clades,
- `--include="Name 1,Name 2"` to add specific taxa,
- `--out=path` to write somewhere else.

Larger subsets make bigger files. Keeping every species under Insecta adds hundreds of MB.

Taxonomy data: NCBI Taxonomy (public domain). Additional common names: iNaturalist taxonomy export (its metadata states taxonomic information is not treated as creative work).
