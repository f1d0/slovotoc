// Removes words that the kid-safe filter now rejects from an already-shipped
// levels.json, without regenerating the whole file.
//
// Regenerating everything would renumber and reshuffle all 240 levels, which
// would yank the puzzle out from under anyone mid-game. So bonus lists are
// simply filtered, and only the handful of levels where a banned word is an
// actual crossword answer get their grid laid out again — from that level's
// own word pool, so nothing else about the game changes.

import fs from 'fs';
import { isClean } from './wordfilter.mjs';
import { bestLayout, setRandom } from './layout.mjs';

const FILE = new URL('../web/data/levels.json', import.meta.url).pathname;
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// Deterministic RNG so a re-run produces the same repair.
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FOLD = { 'á':'a','č':'c','ď':'d','é':'e','ě':'e','í':'i','ň':'n','ó':'o','ř':'r','š':'s','ť':'t','ú':'u','ů':'u','ý':'y','ž':'z' };
const fold = w => [...w].map(c => FOLD[c] ?? c).join('');

// Every word the generator was willing to use as a crossword answer anywhere
// in the game. That set already passed the lemma and blocklist checks, so it
// is the right quality bar for a replacement answer.
const VETTED = new Set(
  data.packs.flatMap(p => p.levels).flatMap(l => l.words.map(w => w.w)).filter(isClean)
);

let bonusDropped = 0, relaid = 0, gridDropped = [];
let levelNo = 0;

for (const pack of data.packs) {
  for (const level of pack.levels) {
    levelNo++;
    const before = (level.bonus ?? []).length;
    level.bonus = (level.bonus ?? []).filter(isClean);
    bonusDropped += before - level.bonus.length;

    const dirty = level.words.filter(w => !isClean(w.w)).map(w => w.w);
    if (!dirty.length) continue;
    gridDropped.push(`L${levelNo}: ${dirty.join(', ')}`);

    // Re-lay this level only. The pool is drawn from words this level can
    // build, intersected with words the generator already trusted as answers
    // somewhere in the game. Bonus lists cannot be used directly: they are
    // deliberately permissive so ordinary Czech is accepted, and promoting
    // one into the crossword is how "kol" became an answer once before.
    const pool = [...level.words.map(w => w.w), ...level.bonus]
      .filter(w => isClean(w) && !dirty.includes(w) && VETTED.has(w));
    const full = pool.filter(w => fold(w).length === level.letters.length);
    const rest = pool.filter(w => !full.includes(w));
    const wanted = level.words.length;

    setRandom(mulberry(levelNo * 7919));
    const laid = bestLayout(full, rest, wanted, 400, Math.max(level.gw, level.gh, 11));
    if (!laid || !laid.placed?.length) { console.error(`  ! L${levelNo}: layout failed, left as is`); continue; }

    const placedSet = new Set(laid.placed.map(w => w.w));
    level.words = laid.placed;
    level.gw = laid.w;
    level.gh = laid.h;
    level.bonus = pool.filter(w => !placedSet.has(w));
    relaid++;
  }
}

fs.writeFileSync(FILE, JSON.stringify(data));
console.log(`bonusová slova odstraněna: ${bonusDropped}`);
console.log(`úrovní znovu poskládáno:  ${relaid}`);
for (const g of gridDropped) console.log('  ' + g);
