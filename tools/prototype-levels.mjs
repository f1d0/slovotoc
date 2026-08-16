// Builds sample levels for the diacritics prototype (docs/navrh-diakritika.md).
//
// The wheel holds BARE letters; a word counts if its de-accented form fits
// the wheel, so KRIDLO yields KŘÍDLO, DÍLO, LOĎ, KÓD… That roughly doubles
// the word pool, which is why the prototype uses smaller wheels.
//
// Output: web/lab/levels-dia.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isClean, CZECH_RE } from './wordfilter.mjs';
import { tryLayout, bestLayout, setRandom } from './layout.mjs';
import { TARGET_BLOCKLIST } from './blocklist.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORDLIST = process.env.WORDLIST ?? '/workspace/czech-wordlist/CZ-wordlist';
const FREQLIST = process.env.FREQLIST ?? '/workspace/freqwords/content/2018/cs/cs_full.txt';
const HUNSPELL = process.env.HUNSPELL ?? '/workspace/cs_CZ.dic';
const LEMMAS = process.env.LEMMAS ?? '/workspace/cs-lemmas.txt';
const OUT = join(__dirname, '..', 'web', 'lab', 'levels-dia.json');

export const FOLD = {
  'á': 'a', 'č': 'c', 'ď': 'd', 'é': 'e', 'ě': 'e', 'í': 'i', 'ň': 'n',
  'ó': 'o', 'ř': 'r', 'š': 's', 'ť': 't', 'ú': 'u', 'ů': 'u', 'ý': 'y', 'ž': 'z',
};
const fold = w => [...w].map(c => FOLD[c] ?? c).join('');

let seed = 424242;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
setRandom(rnd);

// wheels to demo: bare letters, six tiles, chosen to show off accents
const BASES = ['kridlo', 'zamek', 'kotel', 'praset'];
const WANTED = 8;

const properNouns = new Set();
for (const line of readFileSync(HUNSPELL, 'utf8').split('\n')) {
  const e = line.split('/')[0].trim();
  if (e && /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(e)) properNouns.add(e.toLowerCase());
}
const lemmas = new Set(readFileSync(LEMMAS, 'utf8').split('\n').map(w => w.trim()).filter(Boolean));

const valid = new Set();
for (const line of readFileSync(WORDLIST, 'utf8').split('\n')) {
  const w = line.trim();
  if (w.length >= 3 && w.length <= 8 && CZECH_RE.test(w) && isClean(w)) valid.add(w);
}
const freq = new Map();
for (const line of readFileSync(FREQLIST, 'utf8').split('\n')) {
  const [w, c] = line.trim().split(' ');
  if (w && valid.has(w)) freq.set(w, Number(c));
}

const counts = w => {
  const m = new Map();
  for (const ch of w) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
};
const fits = (word, baseCounts) => {
  for (const [ch, n] of counts(fold(word))) if ((baseCounts.get(ch) ?? 0) < n) return false;
  return true;
};

const levels = [];
for (const base of BASES) {
  const bc = counts(base);
  const formable = [...valid].filter(w => fits(w, bc));
  const targets = formable
    .filter(w => lemmas.has(w) && !properNouns.has(w) && !TARGET_BLOCKLIST.has(w) && (freq.get(w) ?? 0) >= 60)
    .sort((a, b) => b.length - a.length || (freq.get(b) ?? 0) - (freq.get(a) ?? 0));

  // longest first, then a spread of lengths, so the grid has a backbone
  const byLen = new Map();
  for (const w of targets) {
    if (!byLen.has(w.length)) byLen.set(w.length, []);
    byLen.get(w.length).push(w);
  }
  const mixed = [];
  let added = true;
  while (added) {
    added = false;
    for (const len of [...byLen.keys()].sort((a, b) => b - a)) {
      const bucket = byLen.get(len);
      if (bucket.length) { mixed.push(bucket.shift()); added = true; }
    }
  }

  // the full-length word (KŘÍDLO for the KRIDLO wheel) is the backbone
  const backbone = formable.find(w => fold(w) === base && w.length === base.length)
    ?? mixed[0];
  const rest = mixed.filter(w => w !== backbone);
  const lay = bestLayout([backbone, ...rest.slice(0, WANTED + 2)], rest.slice(WANTED + 2, WANTED + 12), WANTED, 80, 10);
  const placed = new Set(lay.placed.map(p => p.w));
  const accented = lay.placed.filter(p => p.w !== fold(p.w)).length;

  levels.push({
    letters: base,                       // bare tiles on the wheel
    needsRing: base.includes('u'),       // kroužek tile only when there is a u
    words: lay.placed,
    bonus: formable.filter(w => !placed.has(w)).sort(),
    gw: lay.w, gh: lay.h,
  });
  console.error(`${base}: ${lay.placed.length} slov (${accented} s diakritikou), ` +
                `${formable.length} složitelných celkem → ${lay.placed.map(p => p.w).join(', ')}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ v: 1, levels }));
console.error(`\nWrote ${OUT}`);
