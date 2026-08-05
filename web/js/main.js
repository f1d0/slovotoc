// Slovotoč – main game flow.

import { loadRoot, saveRoot, newPlayer, claimLegacy, AVATARS } from './state.js';
import { pushScore, fetchTop, fetchPlayer } from './leaderboard.js';
import { Wheel, UC } from './wheel.js';
import { Grid } from './grid.js';
import { confettiBurst } from './confetti.js';
import {
  unlock, setSoundEnabled, sndWord, sndBonus, sndDupe, sndBad,
  sndReveal, sndCoin, sndFanfare,
} from './audio.js';

const BULB_COST = 25;
const HAMMER_COST = 60;
const LEVEL_REWARD_BASE = 10;
const LEVEL_REWARD_PER_WORD = 2;
const BONUS_MILESTONE = 10;      // every N bonus words…
const BONUS_MILESTONE_COINS = 15; // …pay this many coins
const STAR3_BONUS_WORDS = 3;     // bonus words needed for the third star
const DAILY_REWARD = 40;         // coins for finishing the daily challenge
const REPO_URL = 'https://github.com/f1d0/wowczechversion';

// one gradient theme per pack (cycled if there are more packs)
const THEMES = [
  ['#1b2547', '#3c2a63'], ['#0f3057', '#00587a'], ['#2d1e50', '#7a3b69'],
  ['#123c3c', '#1d5c4d'], ['#33234f', '#0f5d7a'], ['#472a54', '#1f3a70'],
  ['#14303f', '#3e5641'], ['#3a1f43', '#78324f'], ['#1e2a5a', '#0e6480'],
  ['#3a2216', '#6b3c12'], ['#252d5c', '#5b2a86'], ['#0b3d40', '#345995'],
  ['#511f3f', '#1f4068'], ['#173b45', '#6a2c70'], ['#243b55', '#141e30'],
  ['#3d1e6d', '#0e4b8a'],
];

const $ = sel => document.querySelector(sel);

const els = {
  packName: $('#pack-name'),
  levelLabel: $('#level-label'),
  wordsLeft: $('#words-left'),
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
  player: $('#btn-player'),
  playerAvatar: $('#player-avatar'),
  exitDaily: $('#btn-exit-daily'),
  report: $('#btn-report'),
  overlay: $('#overlay'),
  overlayCard: $('#overlay-card'),
  confetti: $('#confetti'),
  toast: $('#toast'),
  tip: $('#hint-tip'),
  bgPhoto: $('#bg-photo'),
};

let DATA = null;      // levels.json
let LEVELS = [];      // flattened
let root = loadRoot();
let player = null;    // active player object
let grid = null;
let level = null;     // current level data
let found = new Set();      // found target words
let foundBonus = new Set(); // found bonus words (this level)
let hinted = new Set();     // hint-revealed cell keys
let busy = false;           // block input during transitions
let hammerArmed = false;
let toastTimer = null;
let curPack = null;         // pack the current level belongs to
let levelIdx = 0;           // index of the level on screen (differs in daily mode)
let dailyMode = false;      // playing the daily challenge, not the campaign
let usedHint = false;       // any hint used on the current level (star rule)
let lastWord = '';          // last submitted word (for reporting)
let lastWordAccepted = false;
let reportTimer = null;

// ---------- helpers ----------

function toast(msg, ms = 1800) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
}

function setCoins(n, bump = false) {
  player.coins = n;
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
  els.bulb.classList.toggle('disabled', player.coins < BULB_COST);
  els.hammer.classList.toggle('disabled', player.coins < HAMMER_COST && !hammerArmed);
}

// Tells the player how much of the crossword is actually left, so a streak
// of bonus words doesn't read as "the game isn't reacting".
function updateWordsLeft() {
  if (!level || !grid) return;
  const left = level.words.length - grid.completedWords(new Set()).length;
  els.wordsLeft.textContent = left > 0
    ? `zbývá ${left} ${left === 1 ? 'slovo' : left < 5 ? 'slova' : 'slov'}`
    : '';
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

function applyTheme(packIdx, pack) {
  const [c1, c2] = THEMES[packIdx % THEMES.length];
  document.body.style.setProperty('--c1', c1);
  document.body.style.setProperty('--c2', c2);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', c1);

  // fade in the pack's photo once it has actually loaded, so the player
  // never sees a half-drawn image
  if (!pack?.slug) { els.bgPhoto.classList.remove('on'); return; }
  const url = `assets/bg/${pack.slug}.jpg`;
  if (els.bgPhoto.dataset.slug === pack.slug) return;
  els.bgPhoto.dataset.slug = pack.slug;
  els.bgPhoto.classList.remove('on');
  const img = new Image();
  img.onload = () => {
    if (els.bgPhoto.dataset.slug !== pack.slug) return;
    els.bgPhoto.style.backgroundImage = `url("${url}")`;
    els.bgPhoto.classList.add('on');
  };
  img.src = url;
}

function persist() {
  if (!player) return;
  if (dailyMode) { saveRoot(root); return; } // daily progress isn't campaign progress
  player.cur = {
    idx: player.levelIndex,
    found: [...found],
    hinted: [...hinted],
    bonus: [...foundBonus],
  };
  saveRoot(root);
}

function esc(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- word pill ----------

function showPill(word) {
  els.tip.classList.toggle('hidden', !!word || !player || player.sawTip || player.levelIndex > 0);
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

function loadLevel(restore = false, opts = {}) {
  dailyMode = !!opts.daily;
  levelIdx = dailyMode ? opts.index : player.levelIndex;
  const { pack, packIdx, inPack } = packOf(levelIdx);
  level = LEVELS[levelIdx];
  curPack = pack;
  usedHint = false;
  applyTheme(packIdx, pack);

  els.packName.textContent = dailyMode ? '📅 Denní výzva' : pack.name;
  els.levelLabel.textContent = dailyMode ? todayLabel() : `Úroveň ${levelIdx + 1}`;
  els.progressFill.style.width = dailyMode ? '100%' : `${(inPack / pack.levels.length) * 100}%`;
  // the way out of the daily takes the trophy's slot, so the bar keeps its size
  els.exitDaily.classList.toggle('hidden', !dailyMode);
  els.player.classList.toggle('hidden', dailyMode);

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

  if (restore && !dailyMode && player.cur && player.cur.idx === player.levelIndex) {
    for (const w of player.cur.found) {
      found.add(w);
      for (const k of grid.wordCells.get(w) || []) grid.reveal(k, { silent: true });
    }
    for (const k of player.cur.hinted) {
      hinted.add(k);
      grid.reveal(k, { hinted: true, silent: true });
    }
    for (const b of player.cur.bonus) foundBonus.add(b);
  }

  els.bonusCount.textContent = foundBonus.size;
  updateWordsLeft();
  els.tip.classList.toggle('hidden', player.sawTip || player.levelIndex > 0);
  els.playerAvatar.textContent = player.avatar;
  updateToolButtons();
  setCoins(player.coins);
  persist();
}

function wordFound(word) {
  found.add(word);
  player.sawTip = true;
  els.tip.classList.add('hidden');
  sndWord();
  pillResult('ok', 120);
  const targets = (grid.wordCells.get(word) || []).map(k => grid.cellRect(k));
  wheel.setEnabled(false);
  flyLetters(word, targets, {
    onDone: () => {
      (grid.wordCells.get(word) || []).forEach(k => grid.reveal(k));
      sndReveal();
      for (const w of grid.completedWords(found)) { found.add(w); grid.pulseWord(w); }
      updateWordsLeft();
      persist();
      if (grid.allRevealed()) return levelComplete();
      wheel.setEnabled(true);
    },
  });
}

function bonusFound(word) {
  foundBonus.add(word);
  player.bonusTotal += 1;
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
      // Without this the only feedback is a small icon in the corner, and a
      // run of valid-but-not-in-grid words looks like the game ignoring you.
      toast(`⭐ ${UC(word)} — bonusové slovo, v křížovce není`, 2000);
      if (player.bonusTotal % BONUS_MILESTONE === 0) {
        setCoins(player.coins + BONUS_MILESTONE_COINS, true);
        toast(`⭐ +${BONUS_MILESTONE_COINS} mincí za ${player.bonusTotal} bonusových slov!`);
      }
      persist();
      syncScore();
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
  lastWord = word;
  if (grid.wordCells.has(word)) {
    lastWordAccepted = true;
    if (found.has(word)) {
      sndDupe();
      pillResult('dupe', 350);
      grid.pulseWord(word);
    } else {
      wordFound(word);
    }
  } else if (level.bonus.includes(word)) {
    lastWordAccepted = true;
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
    lastWordAccepted = false;
    sndBad();
    pillResult('bad', 450);
  }
  offerReport();
}

// ---------- word reporting ----------

function offerReport() {
  els.report.classList.remove('hidden');
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => els.report.classList.add('hidden'), 6000);
}

function reportText(word, accepted) {
  const lvl = player ? player.levelIndex + 1 : '?';
  return accepted
    ? `Slovo „${UC(word)}" (úroveň ${lvl}) do hry nepatří / není správné.`
    : `Slovo „${UC(word)}" (úroveň ${lvl}) mělo být uznáno, ale hra ho odmítla.`;
}

function showReport() {
  if (!lastWord) return;
  const w = UC(lastWord);
  const issueTitle = encodeURIComponent(`Hlášení slova: ${w}`);
  const bodyAccepted = encodeURIComponent(reportText(lastWord, true));
  const bodyRejected = encodeURIComponent(reportText(lastWord, false));
  const wrongUrl = `${REPO_URL}/issues/new?title=${issueTitle}&body=${bodyAccepted}`;
  const missingUrl = `${REPO_URL}/issues/new?title=${issueTitle}&body=${bodyRejected}`;
  showOverlay(`
    <h2>⚑ Nahlásit slovo</h2>
    <p style="font-size:24px;font-weight:900;letter-spacing:0.05em">${esc(w)}</p>
    <p>Co je s ním špatně?</p>
    <button class="big-btn" id="rep-wrong">${lastWordAccepted ? 'Tohle není správné slovo' : 'Slovo mělo být uznáno'}</button>
    <button class="ghost-btn" id="rep-copy">📋 Zkopírovat hlášení</button>
    <button class="ghost-btn" id="ov-close">Zpět ke hře</button>
    <p style="font-size:12px;opacity:0.7">Hlášení se otevře jako GitHub issue – stačí potvrdit. Bez GitHub účtu použij kopírování a pošli text autorovi.</p>
  `);
  $('#rep-wrong').onclick = () => {
    window.open(lastWordAccepted ? wrongUrl : missingUrl, '_blank', 'noopener');
    hideOverlay();
    toast('Díky za hlášení! 🙏');
  };
  $('#rep-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(reportText(lastWord, lastWordAccepted));
      toast('Zkopírováno 📋');
    } catch {
      toast('Kopírování se nepovedlo 🙁');
    }
    hideOverlay();
  };
  $('#ov-close').onclick = hideOverlay;
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
  updateWordsLeft();
  persist();
  if (grid.allRevealed()) levelComplete();
}

function useBulb() {
  if (busy || hammerArmed) return;
  if (player.coins < BULB_COST) { toast('Nedostatek mincí 🙁'); return; }
  const keys = grid.unrevealedKeys();
  if (!keys.length) return;
  usedHint = true;
  setCoins(player.coins - BULB_COST);
  const k = keys[Math.floor(Math.random() * keys.length)];
  hintReveal(k);
}

function toggleHammer() {
  if (busy) return;
  if (!hammerArmed && player.coins < HAMMER_COST) { toast('Nedostatek mincí 🙁'); return; }
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
  usedHint = true;
  setCoins(player.coins - HAMMER_COST);
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

// ---------- daily challenge ----------

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayLabel(d = new Date()) {
  return `${d.getDate()}. ${d.getMonth() + 1}.`;
}
function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}
// Same puzzle for everybody on a given day, without needing a server.
function dailyIndex(key = todayKey()) {
  let h = 2166136261;
  for (const ch of key) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return Math.abs(h) % LEVELS.length;
}
function dailyDone() {
  return player?.daily?.day === todayKey();
}

function startDaily() {
  hideOverlay();
  loadLevel(false, { daily: true, index: dailyIndex() });
  toast('📅 Denní výzva — zpět do hry tlačítkem ✕ nahoře', 3200);
}

// Leaving the daily unfinished is allowed; it stays open until midnight.
function exitDaily() {
  if (!dailyMode) return;
  loadLevel(true);
  updateDailyBadge();
  toast('Denní výzva na tebe počká do půlnoci ⏳', 2200);
}

function finishDaily() {
  const d = player.daily ?? { day: null, streak: 0 };
  const continued = d.day === yesterdayKey();
  player.daily = {
    day: todayKey(),
    streak: continued ? (d.streak ?? 0) + 1 : 1,
  };
  setCoins(player.coins + DAILY_REWARD, true);
  saveRoot(root);
  syncScore(true);
  const s = player.daily.streak;
  showOverlay(`
    <h1>📅 Denní výzva hotová!</h1>
    <p>Dnešní hádanku máš za sebou.</p>
    <div class="reward">+${DAILY_REWARD} ${coinSvg()}</div>
    <p class="fact">🔥 Série: <b>${s} ${s === 1 ? 'den' : s < 5 ? 'dny' : 'dní'}</b> v řadě${
      !continued && d.day ? ' — předchozí série se přerušila' : ''}</p>
    <button class="big-btn" id="ov-back">Zpět do hry</button>
  `);
  $('#ov-back').onclick = () => {
    hideOverlay();
    updateDailyBadge();
    loadLevel(true);
  };
}

function updateDailyBadge() {
  els.player.classList.toggle('has-badge', !dailyDone());
}

// ---------- stars ----------

// Small levels can offer fewer than three bonus words, so the third star
// asks for all of them rather than an impossible number.
function star3Need() {
  return Math.min(STAR3_BONUS_WORDS, level.bonus.length);
}

function starsEarned() {
  if (usedHint) return 1;
  return foundBonus.size >= star3Need() ? 3 : 2;
}

function starRow(n) {
  return `<div class="stars">${[1, 2, 3].map(i =>
    `<span class="${i <= n ? 'on' : ''}" style="animation-delay:${i * 0.18}s">★</span>`).join('')}</div>`;
}

function starHint(n) {
  if (n >= 3) return 'Bez nápovědy a s bonusovými slovy — perfektní!';
  const need = star3Need();
  if (n === 2) return `Bez nápovědy! Na třetí hvězdu chybí ${need - foundBonus.size} z ${need} bonusových slov.`;
  return 'Použil jsi nápovědu. Bez ní jsou hvězdy dvě, s bonusovými slovy tři.';
}

function totalStars(p) {
  return Object.values(p.stars ?? {}).reduce((a, b) => a + b, 0);
}

function levelComplete() {
  busy = true;
  wheel.setEnabled(false);
  if (dailyMode) return setTimeout(() => { sndFanfare(); confettiBurst(els.confetti); finishDaily(); }, 700);

  const wordsN = level.words.length;
  const stars = starsEarned();
  const prevStars = player.stars?.[levelIdx] ?? 0;
  if (stars > prevStars) {
    player.stars = player.stars ?? {};
    player.stars[levelIdx] = stars;
  }
  const reward = LEVEL_REWARD_BASE + LEVEL_REWARD_PER_WORD * wordsN + (stars - 1) * 5;
  const { pack, inPack } = packOf(player.levelIndex);
  const lastInPack = inPack === pack.levels.length - 1;
  const lastLevel = player.levelIndex === LEVELS.length - 1;

  els.progressFill.style.width = `${((inPack + 1) / pack.levels.length) * 100}%`;
  sndFanfare();
  confettiBurst(els.confetti);

  setTimeout(() => {
    setCoins(player.coins + reward, true);
    player.levelIndex = Math.min(player.levelIndex + 1, LEVELS.length - 1);
    player.cur = null;
    syncScore(true);

    if (lastLevel) {
      player.levelIndex = LEVELS.length; // marks everything done
      saveRoot(root);
      showOverlay(`
        <h1>🏆 Fantastické!</h1>
        <p>${esc(player.name)}, dokončil jsi všech ${LEVELS.length} úrovní Slovotoče!</p>
        <div class="reward">${coinSvg()} ${player.coins}</div>
        <p>Celkem bonusových slov: <b>${player.bonusTotal}</b></p>
        <button class="big-btn" id="ov-board">🏆 Žebříček</button>
        <button class="ghost-btn" id="ov-restart">Hrát znovu od začátku</button>
      `);
      $('#ov-board').onclick = showLeaderboard;
      $('#ov-restart').onclick = () => {
        const fresh = newPlayer(player.name, player.avatar);
        fresh.best = bestOf(player);
        fresh.bonusTotal = player.bonusTotal;
        root.players[player.name] = fresh;
        player = fresh;
        saveRoot(root);
        hideOverlay();
        loadLevel();
      };
      return;
    }

    saveRoot(root);
    const nextPack = lastInPack ? packOf(player.levelIndex).pack : null;
    const nextPackName = nextPack?.name ?? null;
    const nextPackFact = nextPack?.fact ?? null;
    showOverlay(`
      ${lastInPack
        ? `<h1>🎉 Balíček dokončen!</h1>
           <p><b>${esc(pack.name)}</b> máš celý za sebou.</p>
           <p>Čeká tě: <b>${esc(nextPackName)}</b></p>
           ${nextPackFact ? `<p class="fact">📍 ${esc(nextPackFact)}</p>` : ''}`
        : `<h1>Výborně!</h1><p>Úroveň ${player.levelIndex} je hotová.</p>`}
      ${starRow(stars)}
      <p style="font-size:12.5px;opacity:0.8">${starHint(stars)}</p>
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
    <p>V této úrovni: <b>${words.length}</b> · celkem: <b>${player.bonusTotal}</b></p>
    ${words.length
      ? `<div class="words">${words.map(w => `<b>${esc(UC(w))}</b>`).join('')}</div>`
      : '<p>Zatím žádná – zkus najít slova, která nejsou v křížovce!</p>'}
    <p style="font-size:13px">Každých ${BONUS_MILESTONE} bonusových slov = +${BONUS_MILESTONE_COINS} mincí.</p>
    <button class="big-btn" id="ov-close">Zpět ke hře</button>
  `);
  $('#ov-close').onclick = hideOverlay;
}

// ---------- players & global leaderboard ----------

let syncTimer = null;

function bestOf(p) {
  return Math.max(p.best ?? 0, Math.min(p.levelIndex, LEVELS.length));
}

function syncScore(immediate = false) {
  if (!player) return Promise.resolve();
  player.best = bestOf(player); // starting over must not erase the achievement
  clearTimeout(syncTimer);
  const doPush = () => pushScore({
    deviceId: root.deviceId,
    name: player.name,
    avatar: player.avatar,
    levels: player.best,
    bonus: player.bonusTotal,
    coins: player.coins,
    stars: totalStars(player),
    streak: player.daily?.streak ?? 0,
  }).catch(() => { /* offline – next sync will catch up */ });
  if (immediate) return doPush();
  syncTimer = setTimeout(doPush, 2500);
  return Promise.resolve();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') syncScore(true);
});

function localRows() {
  return Object.values(root.players).map(p => ({
    name: p.name,
    avatar: p.avatar,
    levels: bestOf(p),
    bonus: p.bonusTotal,
    coins: p.coins,
    stars: totalStars(p),
    streak: p.daily?.streak ?? 0,
    device_id: root.deviceId,
  }));
}

// The server copy can lag behind (a push may still be in flight, or have
// failed offline), so this device's own players always win over server rows.
function mergeLocal(rows) {
  const local = localRows();
  const isLocal = r => r.device_id === root.deviceId;
  return [...rows.filter(r => !isLocal(r) || !local.some(l => l.name === r.name)), ...local];
}

function renderBoard(rows, note) {
  const medals = ['🥇', '🥈', '🥉'];
  const sorted = rows.sort((a, b) =>
    b.levels - a.levels || (b.stars ?? 0) - (a.stars ?? 0) || b.bonus - a.bonus || b.coins - a.coins);
  const box = $('#board-box');
  if (!box) return;
  box.innerHTML = `
    <div class="board">
      <div class="board-row board-head"><i></i><b>Hráč</b><span>Úrovně</span><span>★</span><span>⭐</span><span>🔥</span></div>
      ${sorted.map((r, i) => `
        <div class="board-row ${r.device_id === root.deviceId && r.name === player?.name ? 'me' : ''}">
          <i>${medals[i] ?? i + 1 + '.'}</i>
          <b>${r.avatar ?? ''} ${esc(r.name)}</b>
          <span>${r.levels}</span><span>${r.stars ?? 0}</span><span>${r.bonus}</span><span>${r.streak ?? 0}</span>
        </div>`).join('')}
    </div>
    <p style="font-size:12px;opacity:0.7">${note}<br>
      <b>Úrovně</b> · <b>★</b> hvězdy · <b>⭐</b> bonusová slova · <b>🔥</b> denní série</p>`;
}

async function showLeaderboard() {
  const done = dailyDone();
  showOverlay(`
    <h2>🏆 Žebříček</h2>
    <button class="daily-btn ${done ? 'done' : ''}" id="ov-daily">
      <em>📅</em>
      <div><b>Denní výzva</b><span>${done
        ? `Dnes hotovo ✓ · série 🔥 ${player.daily?.streak ?? 0}`
        : 'Stejná hádanka pro všechny · +' + DAILY_REWARD + ' mincí'}</span></div>
    </button>
    <div id="board-box"><p style="opacity:0.7">Načítám žebříček…</p></div>
    <button class="big-btn" id="ov-switch">Vyměnit hráče</button>
    <button class="ghost-btn" id="ov-close">Zpět ke hře</button>
    <button class="ghost-btn" id="ov-about">ℹ️ O hře a fotkách</button>
  `);
  $('#ov-switch').onclick = () => showPlayerPicker();
  $('#ov-close').onclick = hideOverlay;
  $('#ov-about').onclick = showAbout;
  $('#ov-daily').onclick = () => {
    if (dailyDone()) { toast('Dnešní výzvu už máš hotovou 🎉 Vrať se zítra!'); return; }
    startDaily();
  };
  syncScore(true); // fire in parallel; local rows are merged in below anyway
  try {
    const rows = await fetchTop();
    renderBoard(mergeLocal(rows), 'Společný žebříček všech hráčů. 🌍');
  } catch {
    renderBoard(localRows(), 'Jsi offline – zobrazuji jen hráče z tohoto zařízení.');
  }
}

let creditsCache = null;

async function showAbout() {
  showOverlay(`
    <h2>ℹ️ O hře</h2>
    <p><b>Slovotoč</b> je nekomerční hra pro kamarády — bez reklam, bez účtů
       a bez sledování. Inspirováno hrou Words of Wonders.</p>
    <p style="font-size:13px">Slova pocházejí z českých slovníků
       (Wikislovník, hunspell cs_CZ). Našel jsi chybné slovo? Použij
       tlačítko ⚑ vedle slova.</p>
    <button class="ghost-btn" id="ov-rules">❓ Jak se hraje</button>
    <h2 style="margin-top:16px;font-size:17px">📷 Fotografie míst</h2>
    <div id="credits-box"><p style="opacity:0.7">Načítám…</p></div>
    <button class="big-btn" id="ov-close">Zpět</button>
  `);
  $('#ov-close').onclick = hideOverlay;
  $('#ov-rules').onclick = () => showRules(showAbout);
  try {
    creditsCache ??= await (await fetch('data/photo-credits.json')).json();
    const byName = new Map(DATA.packs.map(p => [p.slug, p.name]));
    const box = $('#credits-box');
    if (!box) return;
    box.innerHTML = `<ul class="credits">${Object.entries(creditsCache).map(([slug, c]) => `
      <li><b>${esc(byName.get(slug) ?? slug)}</b>
        ${esc(c.author)} · ${esc(c.license)} ·
        <a href="${esc(c.page)}" target="_blank" rel="noopener">Wikimedia Commons</a>
      </li>`).join('')}</ul>
      <p style="font-size:11px;opacity:0.65">Fotky jsou použity podle svých
      licencí; autoři jsou uvedeni výše.</p>`;
  } catch {
    const box = $('#credits-box');
    if (box) box.innerHTML = '<p style="opacity:0.7">Seznam se nepodařilo načíst.</p>';
  }
}

function startAs(name) {
  root.active = name;
  player = root.players[name];
  setSoundEnabled(root.sound);
  saveRoot(root);
  hideOverlay();
  syncScore();
  if (player.levelIndex >= LEVELS.length) {
    player.levelIndex = LEVELS.length - 1;
    loadLevel();
    levelComplete();
  } else {
    loadLevel(true);
  }
  updateDailyBadge();
}

const LOGO = `
  <svg class="welcome-logo" viewBox="0 0 512 512" aria-hidden="true">
    <circle cx="256" cy="256" r="168" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.28)" stroke-width="6"/>
    <polyline points="256,120 138,324 374,324" fill="none" stroke="#ffc93c" stroke-width="26"
              stroke-linecap="round" stroke-linejoin="round"/>
    <g font-family="Nunito, Arial, sans-serif" font-weight="900" text-anchor="middle">
      <circle cx="256" cy="120" r="62" fill="#fff"/><text x="256" y="146" font-size="76" fill="#2b3050">S</text>
      <circle cx="138" cy="324" r="62" fill="#ffc93c"/><text x="138" y="350" font-size="76" fill="#5c3d00">L</text>
      <circle cx="374" cy="324" r="62" fill="#fff"/><text x="374" y="350" font-size="76" fill="#2b3050">O</text>
    </g>
  </svg>`;

const RULES = [
  ['👆', 'Spoj písmena', 'Ve spodním kruhu táhni prstem (nebo myší) přes písmena a slož z nich slovo. Puštěním ho odešleš.'],
  ['🧩', 'Vyplň křížovku', 'Když slovo v křížovce je, jeho písmena vlétnou do mřížky. Úroveň končí, jakmile je mřížka celá plná.'],
  ['⭐', 'Bonusová slova', 'Najdeš-li platné české slovo, které v křížovce není, počítá se jako bonus. Za každých 10 bonusů dostaneš mince.'],
  ['💡', 'Nápovědy', 'Žárovka (25 mincí) odkryje náhodné písmeno, kladivo (60 mincí) políčko, které si vybereš. Mince získáváš za dokončené úrovně.'],
  ['★', 'Tři hvězdy', 'Za dokončení máš hvězdu, bez použití nápovědy dvě, a když k tomu najdeš tři bonusová slova (u malých úrovní všechna), máš všechny tři.'],
  ['📅', 'Denní výzva', 'Každý den jedna hádanka — stejná pro všechny. Za dokončení jsou mince a roste ti série 🔥.'],
  ['🏆', 'Žebříček', 'Hraješ o nejvyšší úroveň, pak o hvězdy. Žebříček je společný pro všechny kamarády.'],
  ['⚑', 'Nesedí ti slovo?', 'Tlačítkem vedle slova ho můžeš nahlásit — hra se díky tomu zlepšuje.'],
];

function showRules(back) {
  showOverlay(`
    <h2>Jak se hraje</h2>
    <ul class="rules-list">
      ${RULES.map(([icon, title, text]) => `
        <li><em>${icon}</em><div><b>${title}</b><span>${text}</span></div></li>`).join('')}
    </ul>
    <button class="big-btn" id="ov-back">Rozumím</button>
  `);
  $('#ov-back').onclick = back;
}

// Copies a player's progress from the shared board onto this device, so the
// same person can carry on from a different phone or browser.
function adoptPlayer(row) {
  const p = newPlayer(row.name, row.avatar || undefined);
  p.levelIndex = Math.min(row.levels ?? 0, LEVELS.length - 1);
  p.best = row.levels ?? 0;
  p.coins = row.coins ?? p.coins;
  p.bonusTotal = row.bonus ?? 0;
  if (row.streak) p.daily = { day: null, streak: row.streak };
  p.lastPlayed = Date.now();
  root.players[row.name] = p;
  saveRoot(root);
  startAs(row.name);
  toast(`Vítej zpátky, ${row.name}! Pokračuješ na úrovni ${p.levelIndex + 1}.`, 3000);
}

async function fillRemotePlayers() {
  const box = $('#remote-box');
  if (!box) return;
  try {
    const rows = await fetchTop();
    const mine = new Set(Object.keys(root.players));
    const others = rows.filter(r => !mine.has(r.name) && (r.levels ?? 0) > 0);
    if (!others.length) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <p class="picker-sub">Hraješ už na jiném telefonu? Vyber se a pokračuj:</p>
      <div class="player-list">
        ${others.map(r => `<button class="player-chip remote" data-name="${esc(r.name)}">
            <em>${r.avatar ?? '🙂'}</em><b>${esc(r.name)}</b><span>úroveň ${(r.levels ?? 0) + 1}</span>
          </button>`).join('')}
      </div>`;
    for (const chip of box.querySelectorAll('.player-chip')) {
      chip.onclick = () => {
        const row = others.find(r => r.name === chip.dataset.name);
        if (row) adoptPlayer(row);
      };
    }
  } catch {
    box.innerHTML = '';
  }
}

function showPlayerPicker(intro = false) {
  const names = Object.keys(root.players)
    .sort((a, b) => (root.players[b].lastPlayed ?? 0) - (root.players[a].lastPlayed ?? 0));
  showOverlay(`
    ${intro ? `<div class="welcome">
        ${LOGO}
        <h1>Slovotoč</h1>
        <p class="tagline">Česká slovní hra — spojuj písmena,<br>hledej slova a vyplň křížovku.</p>
      </div>` : '<h2>Kdo hraje?</h2>'}
    ${names.length ? `<div class="player-list">
      ${names.map(n => {
        const p = root.players[n];
        return `<button class="player-chip" data-name="${esc(n)}">
          <em>${p.avatar}</em><b>${esc(n)}</b><span>úroveň ${Math.min(p.levelIndex + 1, LEVELS.length)}</span>
        </button>`;
      }).join('')}
    </div>` : `<p>${intro ? 'Zadej jméno a pojď hrát — žádná registrace, žádné reklamy.' : 'Zadej své jméno a pojď hrát!'}</p>`}
    <div id="remote-box"></div>
    <div class="new-player">
      <input id="np-name" type="text" maxlength="14" placeholder="${names.length ? 'Nový hráč – jméno' : 'Tvoje jméno'}" autocomplete="off" />
      <button class="big-btn" id="np-go">Hrát</button>
    </div>
    <button class="ghost-btn" id="ov-rules">❓ Jak se hraje</button>
  `);
  fillRemotePlayers();
  $('#ov-rules').onclick = () => showRules(() => showPlayerPicker(intro));
  for (const chip of els.overlayCard.querySelectorAll('.player-chip')) {
    chip.onclick = () => {
      const p = root.players[chip.dataset.name];
      p.lastPlayed = Date.now();
      startAs(chip.dataset.name);
    };
  }
  const input = $('#np-name');
  const go = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    // Typing a name that already exists on the shared board continues that
    // player rather than starting a second, empty profile with the same name.
    if (!root.players[name]) {
      const btn = $('#np-go');
      const label = btn.textContent;
      btn.textContent = 'Hledám…';
      btn.disabled = true;
      try {
        const row = await fetchPlayer(name);
        if (row && (row.levels ?? 0) > 0) return adoptPlayer(row);
      } catch { /* offline – start a fresh profile below */ }
      btn.textContent = label;
      btn.disabled = false;
    }
    if (!root.players[name]) {
      const used = new Set(Object.values(root.players).map(p => p.avatar));
      const free = AVATARS.filter(a => !used.has(a));
      const avatar = (free.length ? free : AVATARS)[Math.floor(Math.random() * (free.length ? free.length : AVATARS.length))];
      root.players[name] = newPlayer(name, avatar);
      claimLegacy(root, root.players[name]);
    }
    root.players[name].lastPlayed = Date.now();
    startAs(name);
  };
  $('#np-go').onclick = go;
  input.onkeydown = e => { if (e.key === 'Enter') go(); };
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
els.player.addEventListener('click', () => { unlock(); showLeaderboard(); });
els.exitDaily.addEventListener('click', () => { unlock(); exitDaily(); });
els.packName.addEventListener('click', () => {
  if (curPack?.fact) toast(`📍 ${curPack.name} — ${curPack.fact}`, 5000);
});
els.report.addEventListener('click', () => { unlock(); showReport(); });
document.addEventListener('pointerdown', unlock, { once: true });

els.sound.addEventListener('click', () => {
  root.sound = !root.sound;
  setSoundEnabled(root.sound);
  els.sound.querySelector('.ic-sound-on').style.display = root.sound ? '' : 'none';
  els.sound.querySelector('.ic-sound-off').style.display = root.sound ? 'none' : '';
  saveRoot(root);
});

window.addEventListener('resize', () => grid && grid.fit(els.board));

async function boot() {
  const res = await fetch('data/levels.json');
  DATA = await res.json();
  LEVELS = DATA.packs.flatMap(p => p.levels);

  setSoundEnabled(root.sound);
  els.sound.querySelector('.ic-sound-on').style.display = root.sound ? '' : 'none';
  els.sound.querySelector('.ic-sound-off').style.display = root.sound ? 'none' : '';

  if (root.active && root.players[root.active]) {
    startAs(root.active);
  } else {
    showPlayerPicker(true); // first visit → full intro screen
  }

  // tiny test hook (harmless in production, used by automated smoke tests)
  window.__slovotoc = {
    submit: w => submitWord(w),
    state: () => ({
      found: [...found], bonus: [...foundBonus],
      coins: player?.coins, level: player?.levelIndex, player: player?.name,
      players: Object.keys(root.players),
    }),
    level: () => level,
  };
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot();
