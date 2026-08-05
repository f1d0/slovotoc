// Persistent game state (localStorage). Progress lives on the player's device.

const KEY = 'slovotoc-save-v1';

const DEFAULTS = {
  v: 1,
  coins: 80,
  levelIndex: 0,      // first unfinished level (global index)
  bonusTotal: 0,      // all bonus words ever found (drives coin milestones)
  sound: true,
  sawTip: false,
  cur: null,          // mid-level progress: { idx, found: [], hinted: [], bonus: [] }
};

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw);
    return { ...DEFAULTS, ...s };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage full/blocked – play on without persistence
  }
}

export function resetState() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return { ...DEFAULTS };
}
