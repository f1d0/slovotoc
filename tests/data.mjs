// Structural checks on web/data/levels.json. Fast, no browser needed —
// run this before shipping regenerated levels.
//
//   node tests/data.mjs
//
// Catches the classes of fault that have actually shipped here before: a word
// that cannot be built from the wheel, two words running along the same line
// (which once hid JEN inside JENŽ), and vulgar words reaching a game meant
// for kids.

import fs from 'fs';
import { isClean } from '../tools/wordfilter.mjs';

const data = JSON.parse(fs.readFileSync(new URL('../web/data/levels.json', import.meta.url), 'utf8'));
const levels = data.packs.flatMap(p => p.levels);

const FOLD = { 'á':'a','č':'c','ď':'d','é':'e','ě':'e','í':'i','ň':'n','ó':'o','ř':'r','š':'s','ť':'t','ú':'u','ů':'u','ý':'y','ž':'z' };
const fold = w => [...w].map(c => FOLD[c] ?? c).join('');
const counts = s => { const m = new Map(); for (const c of s) m.set(c, (m.get(c) ?? 0) + 1); return m; };
const fits = (word, pool) => {
  const need = counts(fold(word));
  for (const [c, n] of need) if ((pool.get(c) ?? 0) < n) return false;
  return true;
};
const cellsOf = w => Array.from({ length: w.w.length }, (_, i) =>
  `${w.x + (w.d === 'h' ? i : 0)},${w.y + (w.d === 'v' ? i : 0)}`);

const fail = [];
const note = (kind, detail) => fail.push(`${kind}: ${detail}`);

levels.forEach((l, i) => {
  const n = i + 1;
  const pool = counts(l.letters);

  if (l.letters.length < 4 || l.letters.length > 8) note('odd letter count', `L${n} has ${l.letters.length}`);
  if (!l.words.length) note('no answers', `L${n}`);

  for (const w of [...l.words.map(x => x.w), ...(l.bonus ?? [])]) {
    if (!fits(w, pool)) note('unbuildable word', `L${n} "${w}" from ${l.letters}`);
    if (!isClean(w)) note('word fails the kid-safe filter', `L${n} "${w}"`);
  }

  const answers = l.words.map(w => w.w);
  if (new Set(answers).size !== answers.length) note('duplicate answer', `L${n}`);
  const both = answers.filter(w => (l.bonus ?? []).includes(w));
  if (both.length) note('word is both answer and bonus', `L${n} ${both}`);

  // the whole letter set must spell at least one answer, or the level has no
  // "aha" word and the wheel is a puzzle with no headline
  const full = [...l.letters].sort().join('');
  if (!answers.some(w => [...fold(w)].sort().join('') === full)) note('no full-length answer', `L${n}`);

  // geometry: letters agree where words cross, nothing leaves the grid, and
  // no two words run along the same line through a cell
  const chars = new Map(), dirs = new Map();
  for (const w of l.words) {
    cellsOf(w).forEach((k, idx) => {
      const ch = w.w[idx];
      if (chars.has(k) && chars.get(k) !== ch) note('letters conflict', `L${n} at ${k}`);
      chars.set(k, ch);
      const [x, y] = k.split(',').map(Number);
      if (x < 0 || y < 0 || x >= l.gw || y >= l.gh) note('outside the grid', `L${n} "${w.w}"`);
      if (!dirs.has(k)) dirs.set(k, new Set());
      if (dirs.get(k).has(w.d)) note('collinear overlap', `L${n} "${w.w}"`);
      dirs.get(k).add(w.d);
    });
  }

  // every answer must touch the rest of the crossword
  const nodes = l.words.map(w => ({ w: w.w, cells: new Set(cellsOf(w)) }));
  const seen = new Set([nodes[0].w]);
  const stack = [nodes[0]];
  while (stack.length) {
    const cur = stack.pop();
    for (const other of nodes) {
      if (seen.has(other.w)) continue;
      if ([...cur.cells].some(k => other.cells.has(k))) { seen.add(other.w); stack.push(other); }
    }
  }
  if (seen.size !== nodes.length) note('disconnected grid', `L${n}`);
});

const answers = new Set(levels.flatMap(l => l.words.map(w => w.w)));
const vocab = new Set(levels.flatMap(l => [...l.words.map(w => w.w), ...(l.bonus ?? [])]));
const letterSets = levels.map(l => l.letters);

console.log(`levels        ${levels.length} in ${data.packs.length} packs`);
console.log(`answers       ${answers.size} distinct, ${levels.reduce((a, l) => a + l.words.length, 0)} placed`);
console.log(`vocabulary    ${vocab.size} accepted words`);
console.log(`letter sets   ${new Set(letterSets).size} distinct of ${letterSets.length}`);

if (new Set(letterSets).size !== letterSets.length) note('repeated letter set', 'two levels share a wheel');

console.log();
if (fail.length) {
  console.log(`${fail.length} PROBLEM(S):`);
  for (const f of fail.slice(0, 40)) console.log('  ' + f);
  process.exit(1);
}
console.log('all structural checks passed');
