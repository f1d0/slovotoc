// Crossword layout shared by the level generator and the diacritics
// prototype. Words may only cross perpendicular; two words never run along
// the same line (that bug once hid JEN inside JENŽ).

export const MAX_GRID = 11;

// The generator injects its deterministic RNG so regenerating the same
// levels twice gives byte-identical output.
let rnd = Math.random;
export function setRandom(fn) { rnd = fn; }

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- crossword layout ----------
// Standard rules: new words must cross an existing word on a matching
// letter, may not run adjacent to parallel words, and cells before/after a
// word must be empty.
export function tryLayout(words, maxGrid = MAX_GRID) {
  // words: array, first one is placed at origin horizontally.
  const cells = new Map(); // "x,y" -> char
  const dirs = new Map();  // "x,y" -> Set of directions running through it
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
        // Two words must never run along the same line: otherwise a longer
        // word simply swallows a shorter one (JEN inside JENŽ) and the grid
        // shows one slot that accepts two different answers.
        if (dirs.get(key(cx, cy))?.has(dh ? 'h' : 'v')) return false;
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
    for (let i = 0; i < word.length; i++) {
      const k = key(x + dx * i, y + dy * i);
      cells.set(k, word[i]);
      if (!dirs.has(k)) dirs.set(k, new Set());
      dirs.get(k).add(dh ? 'h' : 'v');
    }
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
          if (b.w > maxGrid || b.h > maxGrid) continue;
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

export function bestLayout(mustHave, extras, wanted, tries = 40, maxGrid = MAX_GRID) {
  // mustHave: words that should all appear (base word first).
  // extras: ordered fallback candidates to reach `wanted` words.
  let best = null;
  for (let t = 0; t < tries; t++) {
    const order = [mustHave[0], ...shuffled(mustHave.slice(1))];
    const lay = tryLayout([...order, ...shuffled(extras)].slice(0, wanted + 6), maxGrid);
    const n = lay.placed.length;
    const area = lay.w * lay.h;
    const score = Math.min(n, wanted) * 1000 - area - Math.abs(lay.w - lay.h) * 5;
    if (!best || score > best.score) best = { ...lay, score };
    if (best.placed.length >= wanted && t > 10) break;
  }
  return best;
}
