// Slovotoč – main game flow.

import { loadState, saveState, resetState } from './state.js';
import { Wheel, UC } from './wheel.js';
import { Grid } from './grid.js';
import { confettiBurst } from './confetti.js';
import {
  unlock, setSoundEnabled, sndWord, sndBonus, sndDupe, sndBad,
  sndReveal, sndCoin, sndFanfare, vib,
} from './audio.js';

const BULB_COST = 25;
const HAMMER_COST = 60;
const LEVEL_REWARD_BASE = 10;
const LEVEL_REWARD_PER_WORD = 2;
const BONUS_MILESTONE = 10;      // every N bonus words…
const BONUS_MILESTONE_COINS = 15; // …pay this many coins

// one gradient theme per pack (cycled if there are more packs)
const THEMES = [
  ['#1b2547', '#3c2a63'], ['#0f3057', '#00587a'], ['#2d1e50', '#7a3b69'],
  ['#123c3c', '#1d5c4d'], ['#33234f', '#0f5d7a'], ['#472a54', '#1f3a70'],
  ['#14303f', '#3e5641'], ['#3a1f43', '#8c3b5d'], ['#1e2a5a', '#0e7490'],
  ['#402218', '#7a4419'], ['#252d5c', '#5b2a86'], ['#0b3d40', '#345995'],
  ['#511f3f', '#1f4068'], ['#173b45', '#6a2c70'], ['#243b55', '#141e30'],
  ['#3d1e6d', '#0e4b8a'],
];

const $ = sel => document.querySelector(sel);

const els = {
  packName: $('#pack-name'),
  levelLabel: $('#level-label'),
  coinCount: $('#coin-count'),
  coins: $('#coins'),
  progressFill: $('#pack-progress-fill'),
  board: $('#board'),
  grid: $('#grid'),
  pill: $('#word-pill'),
  wheel: $('#wheel'),
  rope: $('#rope-svg'),
  shuffle: $('#btn-shuffle'),
  bulb: $('#btn-bulb'),
  hammer: $('#btn-hammer'),
  jar: $('#btn-jar'),
  bonusCount: $('#bonus-count'),
  sound: $('#btn-sound'),
  overlay: $('#overlay'),
  overlayCard: $('#overlay-card'),
  confetti: $('#confetti'),
  toast: $('#toast'),
  tip: $('#hint-tip'),
};

let DATA = null;      // levels.json
let LEVELS = [];      // flattened
let state = loadState();
let grid = null;
let level = null;     // current level data
let found = new Set();      // found target words
let foundBonus = new Set(); // found bonus words (this level)
let hinted = new Set();     // hint-revealed cell keys
let busy = false;           // block input during transitions
let hammerArmed = false;
let toastTimer = null;

// ---------- helpers ----------

function toast(msg, ms = 1800) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
}

function setCoins(n, bump = false) {
  state.coins = n;
  els.coinCount.textContent = n;
  if (bump) {
    els.coins.classList.remove('bump');
    void els.coins.offsetWidth;
    els.coins.classList.add('bump');
    sndCoin();
  }
  updateToolButtons();
}

function updateToolButtons() {
  els.bulb.classList.toggle('disabled', state.coins < BULB_COST);
  els.hammer.classList.toggle('disabled', state.coins < HAMMER_COST && !hammerArmed);
}

function packOf(levelIdx) {
  let i = levelIdx;
  for (let p = 0; p < DATA.packs.length; p++) {
    const n = DATA.packs[p].levels.length;
    if (i < n) return { pack: DATA.packs[p], packIdx: p, inPack: i };
    i -= n;
  }
  const last = DATA.packs.length - 1;
  return { pack: DATA.packs[last], packIdx: last, inPack: DATA.packs[last].levels.length - 1 };
}

function applyTheme(packIdx) {
  const [c1, c2] = THEMES[packIdx % THEMES.length];
  document.body.style.setProperty('--c1', c1);
  document.body.style.setProperty('--c2', c2);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', c1);
}

function persist() {
  state.cur = {
    idx: state.levelIndex,
    found: [...found],
    hinted: [...hinted],
    bonus: [...foundBonus],
  };
  saveState(state);
}

// ---------- word pill ----------

function showPill(word) {
  els.tip.classList.toggle('hidden', !!word || state.sawTip || state.levelIndex > 0);
  if (!word) { els.pill.classList.add('hidden'); return; }
  els.pill.className = '';
  els.pill.innerHTML = [...word].map(ch => `<span>${UC(ch)}</span>`).join('');
  els.pill.classList.remove('hidden');
}

function pillResult(cls, keep = 650) {
  els.pill.classList.add(cls);
  setTimeout(() => {
    els.pill.classList.add('fade');
    setTimeout(() => els.pill.classList.add('hidden'), 300);
  }, keep);
}

// ---------- fly animations ----------

function flyLetters(word, targets, { gold = false, onDone } = {}) {
  // animate letters from the pill to target rects
  const spans = [...els.pill.children];
  const cellPx = parseFloat(getComputedStyle(els.grid).getPropertyValue('--cell')) || 44;
  const finished = [];
  [...word].forEach((ch, i) => {
    const src = (spans[i] || els.pill).getBoundingClientRect();
    const dst = targets[i];
    if (!dst) return;
    const f = document.createElement('div');
    f.className = 'fly-letter' + (gold ? ' gold' : '');
    f.textContent = UC(ch);
    f.style.width = f.style.height = cellPx + 'px';
    f.style.left = src.left + src.width / 2 - cellPx / 2 + 'px';
    f.style.top = src.top + src.height / 2 - cellPx / 2 + 'px';
    document.body.appendChild(f);
    const dx = dst.left + dst.width / 2 - (src.left + src.width / 2);
    const dy = dst.top + dst.height / 2 - (src.top + src.height / 2);
    const scale = gold ? 0.25 : dst.width / cellPx;
    const anim = f.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: gold ? 0.4 : 1 },
    ], { duration: 380, delay: i * 45, easing: 'cubic-bezier(0.5, 0, 0.4, 1)', fill: 'forwards' });
    finished.push(new Promise(res => { anim.onfinish = () => { f.remove(); res(); }; }));
  });
  Promise.all(finished).then(() => onDone && onDone());
}

// ---------- level lifecycle ----------

function loadLevel(restore = false) {
  const { pack, packIdx, inPack } = packOf(state.levelIndex);
  level = LEVELS[state.levelIndex];
  applyTheme(packIdx);

  els.packName.textContent = pack.name;
  els.levelLabel.textContent = `Úroveň ${state.levelIndex + 1}`;
  els.progressFill.style.width = `${(inPack / pack.levels.length) * 100}%`;

  found = new Set();
  foundBonus = new Set();
  hinted = new Set();
  busy = false;
  hammerArmed = false;
  els.hammer.classList.remove('armed');

  grid = new Grid(els.grid, level);
  grid.fit(els.board);
  wheel.setLetters([...level.letters]);
  wheel.setEnabled(true);

  if (restore && state.cur && state.cur.idx === state.levelIndex) {
    for (const w of state.cur.found) {
      found.add(w);
      for (const k of grid.wordCells.get(w) || []) grid.reveal(k, { silent: true });
    }
    for (const k of state.cur.hinted) {
      hinted.add(k);
      grid.reveal(k, { hinted: true, silent: true });
    }
    for (const b of state.cur.bonus) foundBonus.add(b);
  }

  els.bonusCount.textContent = foundBonus.size;
  els.tip.classList.toggle('hidden', state.sawTip || state.levelIndex > 0);
  updateToolButtons();
  persist();
}

function wordFound(word) {
  found.add(word);
  state.sawTip = true;
  els.tip.classList.add('hidden');
  sndWord();
  pillResult('ok', 120);
  const targets = (grid.wordCells.get(word) || []).map(k => grid.cellRect(k));
  wheel.setEnabled(false);
  flyLetters(word, targets, {
    onDone: () => {
      (grid.wordCells.get(word) || []).forEach(k => grid.reveal(k));
      sndReveal();
      // a word placed by drag can complete crossing words revealed by hints
      for (const w of grid.completedWords(found)) { found.add(w); grid.pulseWord(w); }
      persist();
      if (grid.allRevealed()) return levelComplete();
      wheel.setEnabled(true);
    },
  });
}

function bonusFound(word) {
  foundBonus.add(word);
  state.bonusTotal += 1;
  sndBonus();
  pillResult('bonus', 150);
  const jarRect = els.jar.getBoundingClientRect();
  flyLetters(word, [...word].map(() => jarRect), {
    gold: true,
    onDone: () => {
      els.bonusCount.textContent = foundBonus.size;
      els.jar.classList.remove('wiggle');
      void els.jar.offsetWidth;
      els.jar.classList.add('wiggle');
      if (state.bonusTotal % BONUS_MILESTONE === 0) {
        setCoins(state.coins + BONUS_MILESTONE_COINS, true);
        toast(`⭐ +${BONUS_MILESTONE_COINS} mincí za ${state.bonusTotal} bonusových slov!`);
      }
      persist();
    },
  });
}

function submitWord(raw) {
  const word = raw.toLowerCase();
  wheel.clear();
  if (busy) { showPill(''); return; }
  if (word.length < 3) {
    if (word.length > 0) showPill('');
    return;
  }
  if (grid.wordCells.has(word)) {
    if (found.has(word)) {
      sndDupe();
      pillResult('dupe', 350);
      grid.pulseWord(word);
    } else {
      wordFound(word);
    }
  } else if (level.bonus.includes(word)) {
    if (foundBonus.has(word)) {
      sndDupe();
      pillResult('dupe', 350);
      els.jar.classList.remove('wiggle');
      void els.jar.offsetWidth;
      els.jar.classList.add('wiggle');
    } else {
      bonusFound(word);
    }
  } else {
    sndBad();
    pillResult('bad', 450);
  }
}

// ---------- hints ----------

function hintReveal(k) {
  hinted.add(k);
  grid.reveal(k, { hinted: true });
  sndReveal();
  for (const w of grid.completedWords(found)) {
    found.add(w);
    grid.pulseWord(w);
  }
  persist();
  if (grid.allRevealed()) levelComplete();
}

function useBulb() {
  if (busy || hammerArmed) return;
  if (state.coins < BULB_COST) { toast('Nedostatek mincí 🙁'); return; }
  const keys = grid.unrevealedKeys();
  if (!keys.length) return;
  setCoins(state.coins - BULB_COST);
  const k = keys[Math.floor(Math.random() * keys.length)];
  hintReveal(k);
}

function toggleHammer() {
  if (busy) return;
  if (!hammerArmed && state.coins < HAMMER_COST) { toast('Nedostatek mincí 🙁'); return; }
  hammerArmed = !hammerArmed;
  els.hammer.classList.toggle('armed', hammerArmed);
  grid.setPickMode(hammerArmed);
  if (hammerArmed) toast('Vyber políčko, které chceš odkrýt 🔨');
}

els.grid.addEventListener('click', e => {
  if (!hammerArmed) return;
  const cell = e.target.closest('.cell.pickable');
  if (!cell) return;
  hammerArmed = false;
  els.hammer.classList.remove('armed');
  grid.setPickMode(false);
  setCoins(state.coins - HAMMER_COST);
  hintReveal(cell.dataset.k);
});

// ---------- overlays ----------

function coinSvg() {
  return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#ffc93c" stroke="#e6a817" stroke-width="1.6"/><text x="12" y="16" text-anchor="middle" font-size="11" font-weight="900" fill="#8a5a00">S</text></svg>';
}

function showOverlay(html) {
  els.overlayCard.innerHTML = html;
  els.overlay.classList.remove('hidden');
  els.overlay.style.pointerEvents = 'auto';
}
function hideOverlay() {
  els.overlay.classList.add('hidden');
  els.overlay.style.pointerEvents = 'none';
}

function levelComplete() {
  busy = true;
  wheel.setEnabled(false);
  const wordsN = level.words.length;
  const reward = LEVEL_REWARD_BASE + LEVEL_REWARD_PER_WORD * wordsN;
  const { pack, inPack } = packOf(state.levelIndex);
  const lastInPack = inPack === pack.levels.length - 1;
  const lastLevel = state.levelIndex === LEVELS.length - 1;

  els.progressFill.style.width = `${((inPack + 1) / pack.levels.length) * 100}%`;
  sndFanfare();
  confettiBurst(els.confetti);

  setTimeout(() => {
    setCoins(state.coins + reward, true);
    state.levelIndex = Math.min(state.levelIndex + 1, LEVELS.length - 1);
    state.cur = null;

    if (lastLevel) {
      state.levelIndex = LEVELS.length; // marks everything done
      saveState(state);
      showOverlay(`
        <h1>🏆 Fantastické!</h1>
        <p>Dokončil jsi všech ${LEVELS.length} úrovní Slovotoče!</p>
        <div class="reward">${coinSvg()} ${state.coins}</div>
        <p>Celkem bonusových slov: <b>${state.bonusTotal}</b></p>
        <button class="big-btn" id="ov-restart">Hrát znovu od začátku</button>
      `);
      $('#ov-restart').onclick = () => {
        state = resetState();
        setCoins(state.coins);
        hideOverlay();
        loadLevel();
      };
      return;
    }

    saveState(state);
    const nextPackName = lastInPack ? packOf(state.levelIndex).pack.name : null;
    showOverlay(`
      ${lastInPack
        ? `<h1>🎉 Balíček dokončen!</h1><p><b>${pack.name}</b> máš celý za sebou.<br>Čeká tě: <b>${nextPackName}</b></p>`
        : `<h1>Výborně!</h1><p>Úroveň ${state.levelIndex} je hotová.</p>`}
      <div class="reward">+${reward} ${coinSvg()}</div>
      <button class="big-btn" id="ov-next">Další úroveň</button>
    `);
    $('#ov-next').onclick = () => {
      hideOverlay();
      loadLevel();
    };
  }, 900);
}

function showJar() {
  const words = [...foundBonus].sort((a, b) => a.localeCompare(b, 'cs'));
  showOverlay(`
    <h2>⭐ Bonusová slova</h2>
    <p>V této úrovni: <b>${words.length}</b> · celkem: <b>${state.bonusTotal}</b></p>
    ${words.length
      ? `<div class="words">${words.map(w => `<b>${UC(w)}</b>`).join('')}</div>`
      : '<p>Zatím žádná – zkus najít slova, která nejsou v křížovce!</p>'}
    <p style="font-size:13px">Každých ${BONUS_MILESTONE} bonusových slov = +${BONUS_MILESTONE_COINS} mincí.</p>
    <button class="big-btn" id="ov-close">Zpět ke hře</button>
  `);
  $('#ov-close').onclick = hideOverlay;
}

// ---------- boot ----------

const wheel = new Wheel(els.wheel, els.rope, {
  onChange: showPill,
  onSubmit: submitWord,
});

els.shuffle.addEventListener('click', () => { unlock(); wheel.shuffle(); });
els.bulb.addEventListener('click', () => { unlock(); useBulb(); });
els.hammer.addEventListener('click', () => { unlock(); toggleHammer(); });
els.jar.addEventListener('click', () => { unlock(); showJar(); });
document.addEventListener('pointerdown', unlock, { once: true });

els.sound.addEventListener('click', () => {
  state.sound = !state.sound;
  setSoundEnabled(state.sound);
  els.sound.querySelector('.ic-sound-on').style.display = state.sound ? '' : 'none';
  els.sound.querySelector('.ic-sound-off').style.display = state.sound ? 'none' : '';
  saveState(state);
});

window.addEventListener('resize', () => grid && grid.fit(els.board));

async function boot() {
  const res = await fetch('data/levels.json');
  DATA = await res.json();
  LEVELS = DATA.packs.flatMap(p => p.levels);

  setSoundEnabled(state.sound);
  els.sound.querySelector('.ic-sound-on').style.display = state.sound ? '' : 'none';
  els.sound.querySelector('.ic-sound-off').style.display = state.sound ? 'none' : '';
  setCoins(state.coins);

  if (state.levelIndex >= LEVELS.length) {
    // finished everything previously – show the final screen again
    state.levelIndex = LEVELS.length - 1;
    loadLevel();
    levelComplete();
    return;
  }
  loadLevel(true);

  // tiny test hook (harmless in production, used by automated smoke tests)
  window.__slovotoc = {
    submit: w => submitWord(w),
    state: () => ({ found: [...found], bonus: [...foundBonus], coins: state.coins, level: state.levelIndex }),
    level: () => level,
  };
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot();
