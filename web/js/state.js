// Persistent game state (localStorage), multi-player: several people can
// play on the same device, each under their own name, with a local
// leaderboard. Progress lives on the player's device.

const KEY = 'slovotoc-v2';
const LEGACY_KEY = 'slovotoc-save-v1';

export const AVATARS = ['🦊', '🐸', '🦉', '🐼', '🦄', '🐙', '🦁', '🐝', '🐢', '🐬', '🦜', '🐨'];

export function newPlayer(name, avatar) {
  return {
    name,
    avatar: avatar ?? AVATARS[Math.floor(Math.random() * AVATARS.length)],
    coins: 80,
    levelIndex: 0,
    bonusTotal: 0,
    sawTip: false,
    cur: null,          // mid-level progress: { idx, found: [], hinted: [], bonus: [] }
    createdAt: Date.now(),
  };
}

const ROOT_DEFAULTS = {
  v: 2,
  sound: true,
  active: null,       // name of the active player
  players: {},        // name -> player object
};

export function loadRoot() {
  let root;
  try {
    const raw = localStorage.getItem(KEY);
    root = raw ? { ...ROOT_DEFAULTS, ...JSON.parse(raw) } : { ...ROOT_DEFAULTS };
  } catch {
    root = { ...ROOT_DEFAULTS };
  }
  // migrate a pre-multiplayer save: its progress is claimed by the first
  // player created on this device (see main.js), kept aside until then
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy && !root.legacy) {
      root.legacy = JSON.parse(legacy);
      root.sound = root.legacy.sound ?? root.sound;
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch { /* ignore */ }
  return root;
}

export function saveRoot(root) {
  try {
    localStorage.setItem(KEY, JSON.stringify(root));
  } catch {
    // storage full/blocked – play on without persistence
  }
}

export function claimLegacy(root, player) {
  if (!root.legacy) return;
  const l = root.legacy;
  player.coins = l.coins ?? player.coins;
  player.levelIndex = l.levelIndex ?? player.levelIndex;
  player.bonusTotal = l.bonusTotal ?? player.bonusTotal;
  player.sawTip = l.sawTip ?? player.sawTip;
  player.cur = l.cur ?? null;
  delete root.legacy;
}
