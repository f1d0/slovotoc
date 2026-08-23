// Adds the hand-curated words in extra-words.txt to every level whose wheel
// can spell them.
//
// This is the small tool, meant to be run the moment somebody reports a word
// the game should have taken. It needs nothing but this repository — no
// dictionary downloads, no regeneration — and it only ever adds to the bonus
// lists. Crossword answers, letters and grids are left byte for byte alone,
// so no one's saved progress can be disturbed by it.
//
//   node tools/add-words.mjs            # add them
//   node tools/add-words.mjs --check    # say what would change, write nothing

import { readFileSync, writeFileSync } from 'node:fs';
import { isPlayable } from './wordfilter.mjs';

const LEVELS = new URL('../web/data/levels.json', import.meta.url).pathname;
const EXTRA = new URL('./extra-words.txt', import.meta.url).pathname;
const check = process.argv.includes('--check');

const FOLD = { 'á':'a','č':'c','ď':'d','é':'e','ě':'e','í':'i','ň':'n','ó':'o','ř':'r','š':'s','ť':'t','ú':'u','ů':'u','ý':'y','ž':'z' };
const fold = w => [...w].map(c => FOLD[c] ?? c).join('');
const counts = s => { const m = new Map(); for (const c of s) m.set(c, (m.get(c) ?? 0) + 1); return m; };
const fits = (bare, have) => {
  const need = counts(bare);
  for (const [c, n] of need) if ((have.get(c) ?? 0) < n) return false;
  return true;
};

const words = [];
const rejected = [];
for (const line of readFileSync(EXTRA, 'utf8').split('\n')) {
  const w = line.split('#')[0].trim().toLowerCase();
  if (!w) continue;
  // The kid-safe filter applies here as much as anywhere: a hand-written list
  // is the easiest place to let something through by accident.
  if (isPlayable(w)) words.push(w); else rejected.push(w);
}
if (rejected.length) console.error(`skipped (unplayable or filtered): ${rejected.join(', ')}`);

const data = JSON.parse(readFileSync(LEVELS, 'utf8'));
const placed = new Map();   // word -> how many levels took it
let n = 0;
for (const pack of data.packs) {
  for (const level of pack.levels) {
    n++;
    const have = counts(level.letters);
    const answers = new Set(level.words.map(w => w.w));
    const bonus = new Set(level.bonus);
    for (const w of words) {
      if (!fits(fold(w), have) || answers.has(w) || bonus.has(w)) continue;
      bonus.add(w);
      placed.set(w, (placed.get(w) ?? 0) + 1);
    }
    if (bonus.size !== level.bonus.length) level.bonus = [...bonus].sort();
  }
}

const added = [...placed.entries()].sort((a, b) => b[1] - a[1]);
console.error(`${words.length} words from extra-words.txt, ${n} levels checked`);
for (const w of words) {
  const got = placed.get(w) ?? 0;
  console.error(`  ${w.padEnd(10)} ${got ? `added to ${got} level(s)` : 'already there, or no wheel can spell it'}`);
}
if (check) { console.error('\n--check: nothing written'); process.exit(added.length ? 0 : 0); }
if (!added.length) { console.error('nothing to do'); process.exit(0); }
writeFileSync(LEVELS, JSON.stringify(data));
console.error(`\nwritten: ${added.reduce((a, [, c]) => a + c, 0)} new bonus entries`);
