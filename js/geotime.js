// Geologic time scale (ICS 2023, Ma). Colors are the standard ICS chart colors.
(function () {

const PERIODS = [
  { name: 'Quaternary', start: 2.58, end: 0, era: 'Cenozoic', color: '#F9F97F' },
  { name: 'Neogene', start: 23.03, end: 2.58, era: 'Cenozoic', color: '#FFE619' },
  { name: 'Paleogene', start: 66, end: 23.03, era: 'Cenozoic', color: '#FD9A52' },
  { name: 'Cretaceous', start: 145, end: 66, era: 'Mesozoic', color: '#7FC64E' },
  { name: 'Jurassic', start: 201.4, end: 145, era: 'Mesozoic', color: '#34B2C9' },
  { name: 'Triassic', start: 251.9, end: 201.4, era: 'Mesozoic', color: '#812B92' },
  { name: 'Permian', start: 298.9, end: 251.9, era: 'Paleozoic', color: '#F04028' },
  { name: 'Carboniferous', start: 358.9, end: 298.9, era: 'Paleozoic', color: '#67A599' },
  { name: 'Devonian', start: 419.2, end: 358.9, era: 'Paleozoic', color: '#CB8C37' },
  { name: 'Silurian', start: 443.8, end: 419.2, era: 'Paleozoic', color: '#B3E1B6' },
  { name: 'Ordovician', start: 486.9, end: 443.8, era: 'Paleozoic', color: '#009270' },
  { name: 'Cambrian', start: 538.8, end: 486.9, era: 'Paleozoic', color: '#7FA056' },
  { name: 'Ediacaran', start: 635, end: 538.8, era: 'Neoproterozoic', color: '#FED96A' },
  { name: 'Cryogenian', start: 720, end: 635, era: 'Neoproterozoic', color: '#FECC5C' },
  { name: 'Tonian', start: 1000, end: 720, era: 'Neoproterozoic', color: '#FEBF4E' },
  { name: 'Mesoproterozoic', start: 1600, end: 1000, era: 'Proterozoic', color: '#FDB462' },
  { name: 'Paleoproterozoic', start: 2500, end: 1600, era: 'Proterozoic', color: '#F74370' },
  { name: 'Archean', start: 4000, end: 2500, era: 'Precambrian', color: '#F0047F' },
  { name: 'Hadean', start: 4567, end: 4000, era: 'Precambrian', color: '#AE027E' },
];

// Finer labels: epochs for the Cenozoic, early/middle/late for older periods.
const SUBDIVISIONS = [
  ['Holocene', 0.0117, 0], ['Pleistocene', 2.58, 0.0117], ['Pliocene', 5.333, 2.58], ['Miocene', 23.03, 5.333],
  ['Oligocene', 33.9, 23.03], ['Eocene', 56, 33.9], ['Paleocene', 66, 56],
  ['Late Cretaceous', 100.5, 66], ['Early Cretaceous', 145, 100.5],
  ['Late Jurassic', 161.5, 145], ['Middle Jurassic', 174.7, 161.5], ['Early Jurassic', 201.4, 174.7],
  ['Late Triassic', 237, 201.4], ['Middle Triassic', 247.2, 237], ['Early Triassic', 251.9, 247.2],
  ['Late Permian', 259.5, 251.9], ['Middle Permian', 273, 259.5], ['Early Permian', 298.9, 273],
  ['Pennsylvanian (Late Carboniferous)', 323.2, 298.9], ['Mississippian (Early Carboniferous)', 358.9, 323.2],
  ['Late Devonian', 382.7, 358.9], ['Middle Devonian', 393.3, 382.7], ['Early Devonian', 419.2, 393.3],
  ['Late Ordovician', 458.2, 443.8], ['Middle Ordovician', 471.3, 458.2], ['Early Ordovician', 486.9, 471.3],
  ['Late Cambrian', 497, 486.9], ['Middle Cambrian', 509, 497], ['Early Cambrian', 538.8, 509],
];

function periodAt(mya) {
  return PERIODS.find((p) => mya <= p.start && mya >= p.end) || PERIODS[PERIODS.length - 1];
}

function describeTime(mya) {
  const sub = SUBDIVISIONS.find(([, start, end]) => mya <= start && mya > end);
  const p = periodAt(mya);
  return sub ? `${sub[0]}, ${p.era}` : `${p.name}, ${p.era}`;
}

function formatMya(mya) {
  if (mya >= 1000) return `${(mya / 1000).toFixed(mya >= 2000 ? 1 : 2)} billion years`;
  if (mya >= 100) return `${Math.round(mya)} million years`;
  if (mya >= 10) return `${mya.toFixed(0)} million years`;
  if (mya >= 1) return `${mya.toFixed(1)} million years`;
  return `${Math.round(mya * 1000).toLocaleString()} thousand years`;
}

globalThis.Cladistics = { ...globalThis.Cladistics, PERIODS, periodAt, describeTime, formatMya };
})();
