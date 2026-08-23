// Widens the pool of words the game will ACCEPT, without touching a single
// crossword.
//
// Bonus words are meant to be generous: any real Czech word you can build from
// the wheel should count, inflected forms included. In practice the pool came
// from one word list with gaps in it — the whole paradigm of "osa" was missing
// bar the nominative, so OSE was rejected in all twelve levels it fits.
//
// This merges inflected forms out of Wiktionary's declension tables into that
// pool and recomputes every level's bonus list. Crossword answers, letters and
// grids are deliberately left exactly as they are: a bigger bonus list cannot
// change anyone's puzzle or invalidate a save, it can only stop the game
// saying no to a word that is plainly Czech.

import { readFileSync, writeFileSync } from 'node:fs';
import { isPlayable } from './wordfilter.mjs';

const LEVELS = new URL('../web/data/levels.json', import.meta.url).pathname;
const WORDLIST = process.env.WORDLIST ?? '/workspace/cwl/CZ-wordlist';
const KAIKKI = process.env.KAIKKI ?? '/workspace/kaikki-cs.jsonl';

const FOLD = { 'á':'a','č':'c','ď':'d','é':'e','ě':'e','í':'i','ň':'n','ó':'o','ř':'r','š':'s','ť':'t','ú':'u','ů':'u','ý':'y','ž':'z' };
const fold = w => [...w].map(c => FOLD[c] ?? c).join('');

// ---- pool 1: the existing word list
const pool = new Set();
let fromList = 0;
for (const line of readFileSync(WORDLIST, 'utf8').split('\n')) {
  const w = line.trim().toLowerCase();
  if (isPlayable(w)) { pool.add(w); fromList++; }
}

// ---- pool 2: every surface form Wiktionary lists for a Czech entry
let added = 0;
for (const line of readFileSync(KAIKKI, 'utf8').split('\n')) {
  if (!line) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  if (e.lang_code !== 'cs') continue;
  const words = [e.word, ...(e.forms ?? []).map(f => f.form)];
  for (const raw of words) {
    if (typeof raw !== 'string') continue;
    const w = raw.trim().toLowerCase();
    // Wiktionary tables carry table furniture ("singular", "-") as well as forms
    if (!isPlayable(w) || pool.has(w)) continue;
    pool.add(w);
    added++;
  }
}
console.error(`pool: ${fromList} from the word list + ${added} new from Wiktionary = ${pool.size}`);

// index by folded form so a level's letters can be matched quickly
const byBare = new Map();
for (const w of pool) {
  const b = fold(w);
  if (!byBare.has(b)) byBare.set(b, []);
  byBare.get(b).push(w);
}
const counts = s => { const m = new Map(); for (const c of s) m.set(c, (m.get(c) ?? 0) + 1); return m; };
const fits = (bare, have) => {
  const need = counts(bare);
  for (const [c, n] of need) if ((have.get(c) ?? 0) < n) return false;
  return true;
};

const data = JSON.parse(readFileSync(LEVELS, 'utf8'));
let before = 0, after = 0, n = 0;
const grew = [];
for (const pack of data.packs) {
  for (const level of pack.levels) {
    n++;
    const have = counts(level.letters);
    const placed = new Set(level.words.map(w => w.w));
    const bonus = [];
    for (const [bare, words] of byBare) {
      if (!fits(bare, have)) continue;
      for (const w of words) if (!placed.has(w)) bonus.push(w);
    }
    before += level.bonus.length;
    const old = new Set(level.bonus);
    level.bonus = [...new Set(bonus)].sort();
    after += level.bonus.length;
    const fresh = level.bonus.filter(w => !old.has(w));
    if (fresh.length) grew.push({ n, add: fresh.length, sample: fresh.slice(0, 6) });
    // nothing else about the level may change
  }
}

writeFileSync(LEVELS, JSON.stringify(data));
console.error(`levels ${n}: bonus words ${before} -> ${after} (+${after - before})`);
console.error(`levels that gained words: ${grew.length}`);
for (const g of grew.slice(0, 5)) console.error(`  L${g.n} +${g.add}: ${g.sample.join(', ')}…`);
