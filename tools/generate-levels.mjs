// Level generator for Slovotoč (Czech Words of Wonders clone).
//
// Inputs (paths overridable via env):
//   WORDLIST  – expanded Czech word forms, one per line (hunspell-derived)
//   FREQLIST  – "word count" per line, subtitle frequency corpus
//   HUNSPELL  – original cs_CZ.dic (capitalized entries mark proper nouns)
//
// Output: web/data/levels.json + a QA report on stdout.
//
// Pipeline: filter word lists (charset, 3–8 letters, kid-safe, no proper
// nouns for targets) → pick base words per difficulty tier → compute all
// subwords → select common target words → lay them out as a compact
// connected crossword (greedy + randomized restarts) → remaining valid
// subwords become the level's bonus words.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isClean, CZECH_RE } from './wordfilter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORDLIST = process.env.WORDLIST ?? '/workspace/czech-wordlist/CZ-wordlist';
const FREQLIST = process.env.FREQLIST ?? '/workspace/freqwords/content/2018/cs/cs_50k.txt';
const HUNSPELL = process.env.HUNSPELL ?? '/workspace/cs_CZ.dic';
const LEMMAS = process.env.LEMMAS ?? '/workspace/wikt-cs-lemmas.txt';
const OUT = join(__dirname, '..', 'web', 'data', 'levels.json');

const MIN_LEN = 3;
const MAX_GRID = 11;           // max bounding-box dimension (mobile rendering)
const MIN_FREQ_COUNT = 400;    // min subtitle-corpus count for target words

// Frequent oblique forms of names/places (nominatives are caught via the
// hunspell capitalization check) and subtitle noise that slips through.
const TARGET_BLOCKLIST = new Set([
  'praze', 'prahy', 'prahou', 'brně', 'plzni', 'ostravě',
  'honzo', 'honzy', 'honzou', 'pepo', 'pepy', 'tondo', 'jirko', 'jirky',
  'tome', 'tomovi', 'tomem', 'jacku', 'johne', 'jime', 'jime',
  'hmm', 'ehm', 'ehh', 'ooh', 'uhm', 'mmm', 'ummm', 'umm', 'hmmm',
  'ehmm', 'ach', 'och', 'oj', 'aj', 'ó', 'ech', 'jem', 'jme', 'mamá',
  // English/subtitle leakage & name vocatives that pass the other filters
  'cape', 'con', 'cool', 'done', 'end', 'email', 'ido', 'kit', 'like',
  'live', 'rito', 'sale', 'som', 'son', 'tao', 'vito', 'boy', 'boye',
  'jane', 'dane', 'kate', 'katy', 'petře', 'anno', 'inch', 'copy',
  'lady', 'lord', 'lorda', 'miss', 'sir', 'okay', 'baby', 'core',
  'look', 'hot', 'stone', 'salt', 'net', 'star', 'jam', 'bat', 'pako', 'trip',
  'dne', // mistagged as a headword in the Wiktionary extraction
  'mne', 'mně', 'tebe', 'tobě', 'sebe', 'sobě', // pronoun case forms
  'love', 'péro', 'osle', 'prso',
]);

// Hand-picked friendly base words tried first in each tier, so early levels
// are built from concrete everyday words rather than frequent grammar forms.
const SEED_BASES = {
  4: ['kolo', 'okno', 'ryba', 'ruka', 'noha', 'voda', 'hora', 'mrak',
      'jaro', 'léto', 'zima', 'pole', 'moře', 'drak', 'vlak', 'kost',
      'most', 'list', 'park', 'dort', 'mapa', 'koza', 'sova', 'káva',
      'růže', 'pusa', 'lampa', 'tráva', 'mísa', 'váza', 'lest', 'cesta'],
  5: ['škola', 'hlava', 'kniha', 'město', 'mléko', 'tráva', 'banán',
      'mrkev', 'písek', 'zámek', 'hrnec', 'talíř', 'jelen', 'kotel',
      'metro', 'salát', 'deska', 'maska', 'vesta', 'lopata', 'sokol',
      'motýl', 'kabát', 'plot', 'stan', 'komín', 'koláč', 'malina'],
  6: ['jablko', 'kytara', 'rodina', 'koruna', 'postel', 'okurka',
      'hvězda', 'zelená', 'stolek', 'obloha', 'koleno', 'jeskyně',
      'vlaštovka', 'lopata', 'strom', 'kominík', 'nálada', 'stanice',
      'sekera', 'takový', 'ostrov', 'nemoce', 'stavba', 'sobota'],
  7: ['zahrada', 'letadlo', 'pohádka', 'kamarád', 'nákladní', 'stavení',
      'kolotoč', 'návštěva', 'lednice', 'nedělat', 'stodola', 'saláma',
      'dovolená', 'polévka', 'nástroj', 'stránka', 'kapesní', 'plavání'],
};

// ---------- deterministic RNG ----------
let seed = 20260805;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- load data ----------
console.error('Loading word data…');
// Crossword target words are restricted to real dictionary headwords
// (lemmas) extracted from Wiktionary via tools/extract-wikt-lemmas.mjs —
// nouns in nominative, verbs in infinitive; never inflected forms like
// "kol" or "jsme". Capitalized hunspell entries mark proper nouns.
const properNouns = new Set();
for (const line of readFileSync(HUNSPELL, 'utf8').split('\n')) {
  const entry = line.split('/')[0].trim();
  if (entry && /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(entry)) properNouns.add(entry.toLowerCase());
}
const lemmas = new Set(
  readFileSync(LEMMAS, 'utf8').split('\n').map(w => w.trim()).filter(Boolean)
);

const valid = new Set(); // all accepted words (bonus validation pool)
for (const line of readFileSync(WORDLIST, 'utf8').split('\n')) {
  const w = line.trim();
  if (w.length >= MIN_LEN && w.length <= 8 && CZECH_RE.test(w) && isClean(w)) valid.add(w);
}

const freq = new Map(); // word -> corpus count (only words we accept)
for (const line of readFileSync(FREQLIST, 'utf8').split('\n')) {
  const [w, c] = line.trim().split(' ');
  if (w && valid.has(w)) freq.set(w, Number(c));
}

// Target pool: dictionary headwords only + common + not a proper noun +
// not blocklisted. (Bonus words stay open to all valid inflected forms.)
const targets = new Set();
for (const [w, c] of freq) {
  if (c >= MIN_FREQ_COUNT && lemmas.has(w) && !properNouns.has(w) && !TARGET_BLOCKLIST.has(w)) {
    targets.add(w);
  }
}
console.error(`valid=${valid.size} lemmas=${lemmas.size} freq-matched=${freq.size} targets=${targets.size}`);

// ---------- letter multiset helpers ----------
const ALPHA = 'aábcčdďeéěfghiíjklmnňoópqrřsštťuúůvwxyýzž';
const IDX = new Map([...ALPHA].map((ch, i) => [ch, i]));
function mask(word) {
  // two 32-bit set masks for a quick subset pre-test
  let lo = 0, hi = 0;
  for (const ch of word) {
    const i = IDX.get(ch);
    if (i < 32) lo |= (1 << i) >>> 0; else hi |= (1 << (i - 32)) >>> 0;
  }
  return [lo >>> 0, hi >>> 0];
}
function counts(word) {
  const c = new Map();
  for (const ch of word) c.set(ch, (c.get(ch) ?? 0) + 1);
  return c;
}
function fitsIn(wordCounts, baseCounts) {
  for (const [ch, n] of wordCounts) {
    if ((baseCounts.get(ch) ?? 0) < n) return false;
  }
  return true;
}

// Precompute masks+counts for the whole valid pool, bucketed by length.
const pool = [];
for (const w of valid) {
  const [lo, hi] = mask(w);
  pool.push({ w, lo, hi, c: counts(w) });
}

function subwordsOf(base) {
  const bc = counts(base);
  const [blo, bhi] = mask(base);
  const res = [];
  for (const e of pool) {
    if (e.w.length > base.length) continue;
    if ((e.lo & blo) !== e.lo || (e.hi & bhi) !== e.hi) continue;
    if (fitsIn(e.c, bc)) res.push(e.w);
  }
  return res;
}

// ---------- crossword layout ----------
// Standard rules: new words must cross an existing word on a matching
// letter, may not run adjacent to parallel words, and cells before/after a
// word must be empty.
function tryLayout(words) {
  // words: array, first one is placed at origin horizontally.
  const cells = new Map(); // "x,y" -> char
  const placed = [];
  const key = (x, y) => x + ',' + y;
  const get = (x, y) => cells.get(key(x, y));

  function canPlace(word, x, y, dh) {
    const dx = dh ? 1 : 0, dy = dh ? 0 : 1;
    // cell before start / after end must be empty
    if (get(x - dx, y - dy) !== undefined) return false;
    if (get(x + dx * word.length, y + dy * word.length) !== undefined) return false;
    let crossings = 0;
    for (let i = 0; i < word.length; i++) {
      const cx = x + dx * i, cy = y + dy * i;
      const existing = get(cx, cy);
      if (existing !== undefined) {
        if (existing !== word[i]) return false;
        crossings++;
      } else {
        // side neighbours (perpendicular) must be empty
        if (dh) {
          if (get(cx, cy - 1) !== undefined || get(cx, cy + 1) !== undefined) return false;
        } else {
          if (get(cx - 1, cy) !== undefined || get(cx + 1, cy) !== undefined) return false;
        }
      }
    }
    return crossings > 0 ? crossings : false;
  }

  function bbox(extra) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const k of cells.keys()) {
      const [x, y] = k.split(',').map(Number);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (extra) {
      for (const [x, y] of extra) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    return { w: maxX - minX + 1, h: maxY - minY + 1, minX, minY };
  }

  function place(word, x, y, dh) {
    const dx = dh ? 1 : 0, dy = dh ? 0 : 1;
    for (let i = 0; i < word.length; i++) cells.set(key(x + dx * i, y + dy * i), word[i]);
    placed.push({ w: word, x, y, d: dh ? 'h' : 'v' });
  }

  const [first, ...rest] = words;
  place(first, 0, 0, true);
  const skipped = [];

  for (const word of rest) {
    // gather all legal placements crossing existing cells
    let best = null;
    for (const p of placed) {
      const pdx = p.d === 'h' ? 1 : 0, pdy = p.d === 'h' ? 0 : 1;
      for (let i = 0; i < p.w.length; i++) {
        const ax = p.x + pdx * i, ay = p.y + pdy * i; // anchor cell
        const anchorCh = p.w[i];
        for (let j = 0; j < word.length; j++) {
          if (word[j] !== anchorCh) continue;
          const dh = p.d !== 'h'; // perpendicular
          const x = dh ? ax - j : ax;
          const y = dh ? ay : ay - j;
          const crossings = canPlace(word, x, y, dh);
          if (crossings === false) continue;
          // compute resulting bbox
          const extra = [];
          const dx = dh ? 1 : 0, dy = dh ? 0 : 1;
          for (let k2 = 0; k2 < word.length; k2++) extra.push([x + dx * k2, y + dy * k2]);
          const b = bbox(extra);
          if (b.w > MAX_GRID || b.h > MAX_GRID) continue;
          const squareness = Math.abs(b.w - b.h);
          const score = crossings * 100 - (b.w * b.h) - squareness * 3 + rnd() * 8;
          if (!best || score > best.score) best = { x, y, dh, score };
        }
      }
    }
    if (best) place(word, best.x, best.y, best.dh);
    else skipped.push(word);
  }

  const b = bbox();
  return {
    placed: placed.map(p => ({ w: p.w, x: p.x - b.minX, y: p.y - b.minY, d: p.d })),
    skipped,
    w: b.w, h: b.h,
  };
}

function bestLayout(mustHave, extras, wanted, tries = 40) {
  // mustHave: words that should all appear (base word first).
  // extras: ordered fallback candidates to reach `wanted` words.
  let best = null;
  for (let t = 0; t < tries; t++) {
    const order = [mustHave[0], ...shuffled(mustHave.slice(1))];
    const lay = tryLayout([...order, ...shuffled(extras)].slice(0, wanted + 4));
    const n = lay.placed.length;
    const area = lay.w * lay.h;
    const score = Math.min(n, wanted) * 1000 - area - Math.abs(lay.w - lay.h) * 5;
    if (!best || score > best.score) best = { ...lay, score };
    if (best.placed.length >= wanted && t > 10) break;
  }
  return best;
}

// ---------- base word selection & level construction ----------
const TIERS = [
  { count: 20, baseLen: 4, words: [3, 4] },   // levels 1–20
  { count: 30, baseLen: 5, words: [4, 5] },   // 21–50
  { count: 50, baseLen: 6, words: [5, 7] },   // 51–100
  { count: 60, baseLen: 7, words: [6, 9] },   // 101–160
];

// Cesta po českých památkách a zajímavých místech. Menší města jsou
// proložená známými cíli, ať má každý balíček svůj charakter.
const PACKS = [
  { slug: 'lazne-bohdanec', name: 'Lázně Bohdaneč', fact: 'Lázeňské město u Pardubic, které léčí slatinnými zábaly.' },
  { slug: 'kuneticka-hora', name: 'Kunětická hora', fact: 'Hrad na kopci sopečného původu, vidět je z celého Polabí.' },
  { slug: 'lanskroun', name: 'Lanškroun', fact: 'Východočeské město se zámkem a soustavou rybníků.' },
  { slug: 'karlstejn', name: 'Karlštejn', fact: 'Hrad Karla IV. z roku 1348, kde se ukrývaly korunovační klenoty.' },
  { slug: 'uvaly', name: 'Úvaly', fact: 'Město na východním okraji Prahy v údolí potoka Výmola.' },
  { slug: 'kutna-hora', name: 'Kutná Hora', fact: 'Stříbro odsud platilo půl Evropy; chrám svaté Barbory je v UNESCO.' },
  { slug: 'celakovice', name: 'Čelákovice', fact: 'Polabské město s dávnou minulostí a tvrzí, v níž dnes sídlí muzeum.' },
  { slug: 'cesky-krumlov', name: 'Český Krumlov', fact: 'Zámek nad meandrem Vltavy a historické jádro na seznamu UNESCO.' },
  { slug: 'hradek-oplatil', name: 'Hrádek u Pardubic', fact: 'Kousek odsud leží písník Oplatil — jezero s průzračnou vodou vzniklé těžbou písku.' },
  { slug: 'adrspach', name: 'Adršpašské skály', fact: 'Pískovcové skalní město s věžemi vysokými desítky metrů.' },
  { slug: 'komorany', name: 'Komořany', fact: 'Pražská čtvrť u Vltavy zmíněná už roku 1088; dnes sídlo Českého hydrometeorologického ústavu.' },
  { slug: 'telc', name: 'Telč', fact: 'Náměstí s renesančními domy a podloubím, památka UNESCO.' },
  { slug: 'macocha', name: 'Macocha', fact: 'Nejhlubší propast svého druhu ve střední Evropě, hluboká 138 metrů.' },
  { slug: 'hluboka', name: 'Hluboká nad Vltavou', fact: 'Bílý zámek v novogotickém stylu podle anglického vzoru.' },
  { slug: 'lednice', name: 'Lednice', fact: 'Zámek s parkem a minaretem, součást Lednicko-valtického areálu.' },
  { slug: 'snezka', name: 'Sněžka', fact: 'Nejvyšší hora Česka, 1603 metrů nad mořem.' },
];
const PACK_SIZE = 10;

// Candidate base words per length: hand-picked seeds first (validated like
// any other candidate), then the rest of the pool, most common first.
const baseCandidates = new Map();
for (const len of [4, 5, 6, 7]) {
  const seeds = (SEED_BASES[len] ?? []).filter(w => w.length === len && targets.has(w));
  const cands = [...targets]
    .filter(w => w.length === len && !seeds.includes(w))
    .filter(w => {
      const c = counts(w);
      let maxDup = 0;
      for (const n of c.values()) maxDup = Math.max(maxDup, n);
      return maxDup <= 2; // wheels with 3× the same letter are no fun
    })
    .sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0));
  baseCandidates.set(len, [...seeds, ...cands]);
}

const usedBases = new Set();       // letter-multiset signatures already used
const usedBaseWords = new Set();
const levels = [];
const allTargetWordsUsed = new Set();

function signature(word) {
  return [...word].sort().join('');
}

for (const tier of TIERS) {
  let made = 0;
  const cands = baseCandidates.get(tier.baseLen);
  for (const base of cands) {
    if (made >= tier.count) break;
    const sig = signature(base);
    if (usedBases.has(sig) || usedBaseWords.has(base)) continue;

    const subs = subwordsOf(base);
    const targetSubs = subs
      .filter(w => targets.has(w) && w !== base)
      .sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0));

    const wanted = tier.words[0] + Math.floor(rnd() * (tier.words[1] - tier.words[0] + 1));
    if (targetSubs.length < wanted - 1) continue;

    // Prefer a mix of lengths: take the most common per length bucket first.
    const byLen = new Map();
    for (const w of targetSubs) {
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

    const lay = bestLayout([base, ...mixed.slice(0, wanted + 2)], mixed.slice(wanted + 2, wanted + 10), wanted);
    if (!lay || lay.placed.length < Math.max(3, wanted - 1)) continue;
    if (!lay.placed.some(p => p.w === base)) continue;

    const placedSet = new Set(lay.placed.map(p => p.w));
    const bonus = subs.filter(w => !placedSet.has(w) && !TARGET_BLOCKLIST.has(w)).sort();

    levels.push({
      letters: base,
      words: lay.placed,
      bonus,
      gw: lay.w, gh: lay.h,
    });
    for (const w of placedSet) allTargetWordsUsed.add(w);
    usedBases.add(sig);
    usedBaseWords.add(base);
    made++;
  }
  console.error(`tier baseLen=${tier.baseLen}: made ${made}/${tier.count}`);
}

// ---------- pack up & write ----------
const packs = [];
for (let i = 0; i < PACKS.length && i * PACK_SIZE < levels.length; i++) {
  packs.push({
    name: PACKS[i].name,
    fact: PACKS[i].fact,
    slug: PACKS[i].slug,
    levels: levels.slice(i * PACK_SIZE, (i + 1) * PACK_SIZE),
  });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ v: 1, packs }));
const totalLevels = packs.reduce((n, p) => n + p.levels.length, 0);
console.error(`Wrote ${OUT}: ${packs.length} packs, ${totalLevels} levels`);

// ---------- QA report ----------
function renderAscii(level) {
  const grid = Array.from({ length: level.gh }, () => Array(level.gw).fill('·'));
  for (const p of level.words) {
    for (let i = 0; i < p.w.length; i++) {
      const x = p.x + (p.d === 'h' ? i : 0);
      const y = p.y + (p.d === 'v' ? i : 0);
      grid[y][x] = p.w[i].toUpperCase();
    }
  }
  return grid.map(r => r.join(' ')).join('\n');
}

console.log('=== SAMPLE LEVELS ===');
for (const idx of [0, 10, 25, 55, 105, totalLevels - 1]) {
  if (idx >= levels.length) continue;
  const L = levels[idx];
  console.log(`\n-- level ${idx + 1}: letters=${L.letters.toUpperCase()} words=${L.words.map(p => p.w).join(', ')}`);
  console.log(renderAscii(L));
  console.log(`bonus (${L.bonus.length}): ${L.bonus.slice(0, 20).join(', ')}${L.bonus.length > 20 ? '…' : ''}`);
}

console.log('\n=== ALL TARGET WORDS USED (review for proper nouns / junk) ===');
console.log([...allTargetWordsUsed].sort().join(' '));
