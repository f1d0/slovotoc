// Prototype of the diacritics mechanic — see docs/navrh-diakritika.md.
// Deliberately separate from the live game: it only borrows the wheel, the
// grid and the sounds, so friends' progress can't be affected.

import { Wheel, UC } from '../js/wheel.js';
import { Grid } from '../js/grid.js';
import { confettiBurst } from '../js/confetti.js';
import {
  unlock, setSoundEnabled, sndWord, sndBonus, sndDupe, sndBad, sndReveal, sndFanfare,
} from '../js/audio.js';

const FOLD = {
  'á': 'a', 'č': 'c', 'ď': 'd', 'é': 'e', 'ě': 'e', 'í': 'i', 'ň': 'n',
  'ó': 'o', 'ř': 'r', 'š': 's', 'ť': 't', 'ú': 'u', 'ů': 'u', 'ý': 'y', 'ž': 'z',
};
const fold = w => [...w].map(c => FOLD[c] ?? c).join('');

const $ = s => document.querySelector(s);
const els = {
  packName: $('#pack-name'), levelLabel: $('#level-label'), wordsLeft: $('#words-left'),
  board: $('#board'), grid: $('#grid'), pill: $('#word-pill'),
  wheel: $('#wheel'), rope: $('#rope-svg'), shuffle: $('#btn-shuffle'),
  prev: $('#btn-prev'), next: $('#btn-next'), jar: $('#btn-jar'), bonusCount: $('#bonus-count'),
  progressFill: $('#pack-progress-fill'), overlay: $('#overlay'), overlayCard: $('#overlay-card'),
  confetti: $('#confetti'), toast: $('#toast'),
};

let LEVELS = [];
let idx = 0;
let level = null, grid = null;
let found = new Set(), foundBonus = new Set();
let busy = false, toastTimer = null;
let mode = localStorage.getItem('slovotoc-lab-mode') ?? 'satellites';

function toast(msg, ms = 2000) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
}

function showPill(word) {
  if (!word) { els.pill.classList.add('hidden'); return; }
  els.pill.className = '';
  els.pill.innerHTML = [...word].map(ch => `<span>${UC(ch)}</span>`).join('');
  els.pill.classList.remove('hidden');
}
function pillResult(cls, keep = 550) {
  els.pill.classList.add(cls);
  setTimeout(() => {
    els.pill.classList.add('fade');
    setTimeout(() => els.pill.classList.add('hidden'), 300);
  }, keep);
}

function updateWordsLeft() {
  if (!level || !grid) return;
  const left = level.words.length - grid.completedWords(new Set()).length;
  els.wordsLeft.textContent = left > 0
    ? `zbývá ${left} ${left === 1 ? 'slovo' : left < 5 ? 'slova' : 'slov'}`
    : 'hotovo!';
  els.progressFill.style.width = `${100 * (1 - left / level.words.length)}%`;
}

function flyLetters(word, targets, { gold = false, onDone } = {}) {
  const spans = [...els.pill.children];
  const cell = parseFloat(getComputedStyle(els.grid).getPropertyValue('--cell')) || 44;
  const done = [];
  [...word].forEach((ch, i) => {
    const src = (spans[i] || els.pill).getBoundingClientRect();
    const dst = targets[i];
    if (!dst) return;
    const f = document.createElement('div');
    f.className = 'fly-letter' + (gold ? ' gold' : '');
    f.textContent = UC(ch);
    f.style.width = f.style.height = cell + 'px';
    f.style.left = src.left + src.width / 2 - cell / 2 + 'px';
    f.style.top = src.top + src.height / 2 - cell / 2 + 'px';
    document.body.appendChild(f);
    const dx = dst.left + dst.width / 2 - (src.left + src.width / 2);
    const dy = dst.top + dst.height / 2 - (src.top + src.height / 2);
    const a = f.animate(
      [{ transform: 'translate(0,0) scale(1)', opacity: 1 },
       { transform: `translate(${dx}px,${dy}px) scale(${gold ? 0.25 : dst.width / cell})`, opacity: gold ? 0.4 : 1 }],
      { duration: 380, delay: i * 45, easing: 'cubic-bezier(0.5,0,0.4,1)', fill: 'forwards' });
    done.push(new Promise(r => { a.onfinish = () => { f.remove(); r(); }; }));
  });
  Promise.all(done).then(() => onDone && onDone());
}

// ---------- Klasik mode ----------
// Accents are optional: a bare spelling that matches exactly one word is
// accepted and the accents are snapped on. When it matches several
// (může/muže), the player picks which one they meant.
function candidatesFor(word) {
  const f = fold(word);
  const all = [...level.words.map(p => p.w), ...level.bonus];
  return all.filter(w => fold(w) === f);
}

function acceptWord(word) {
  if (grid.wordCells.has(word)) {
    if (found.has(word)) { sndDupe(); pillResult('dupe', 300); grid.pulseWord(word); return; }
    gridWordFound(word);
  } else {
    if (foundBonus.has(word)) { sndDupe(); pillResult('dupe', 300); return; }
    bonusFound(word);
  }
}

function gridWordFound(word) {
  found.add(word);
  sndWord();
  pillResult('ok', 100);
  const targets = (grid.wordCells.get(word) || []).map(k => grid.cellRect(k));
  wheel.setEnabled(false);
  flyLetters(word, targets, {
    onDone: () => {
      (grid.wordCells.get(word) || []).forEach(k => grid.reveal(k));
      sndReveal();
      for (const w of grid.completedWords(found)) { found.add(w); grid.pulseWord(w); }
      updateWordsLeft();
      if (grid.allRevealed()) return levelDone();
      wheel.setEnabled(true);
    },
  });
}

function bonusFound(word) {
  foundBonus.add(word);
  sndBonus();
  pillResult('bonus', 120);
  const jar = els.jar.getBoundingClientRect();
  flyLetters(word, [...word].map(() => jar), {
    gold: true,
    onDone: () => {
      els.bonusCount.textContent = foundBonus.size;
      els.jar.classList.remove('wiggle'); void els.jar.offsetWidth; els.jar.classList.add('wiggle');
      toast(`⭐ ${UC(word)} — bonusové slovo`, 1600);
    },
  });
}

function chooseWord(options, typed) {
  busy = true;
  wheel.setEnabled(false);
  els.overlayCard.innerHTML = `
    <h2>Které slovo myslíš?</h2>
    <p>Napsal jsi <b>${UC(typed)}</b> bez háčků a čárek — sedí na víc slov.</p>
    <div class="choice-list">
      ${options.map(w => `<button class="big-btn choice" data-w="${w}">${UC(w)}</button>`).join('')}
    </div>
    <button class="ghost-btn" id="ch-cancel">Zpět</button>`;
  els.overlay.classList.remove('hidden');
  els.overlay.style.pointerEvents = 'auto';
  const close = () => {
    els.overlay.classList.add('hidden');
    els.overlay.style.pointerEvents = 'none';
    busy = false;
    wheel.setEnabled(true);
  };
  for (const b of els.overlayCard.querySelectorAll('.choice')) {
    b.onclick = () => { close(); showPill(b.dataset.w); acceptWord(b.dataset.w); };
  }
  $('#ch-cancel').onclick = close;
}

function submit(raw) {
  const word = raw.toLowerCase();
  wheel.clear();
  if (busy || word.length < 3) { showPill(''); return; }

  const cands = candidatesFor(word);
  if (!cands.length) { sndBad(); pillResult('bad', 420); return; }

  // exactly as typed? take it
  if (cands.includes(word)) return acceptWord(word);
  // bare spelling, single match → snap the accents on
  const unseen = cands.filter(w => !found.has(w) && !foundBonus.has(w));
  const pool = unseen.length ? unseen : cands;
  if (pool.length === 1) {
    showPill(pool[0]);
    toast(`✍️ ${UC(word)} → ${UC(pool[0])}`, 1600);
    return acceptWord(pool[0]);
  }
  chooseWord(pool, word);
}

// ---------- level flow ----------
function levelDone() {
  busy = true;
  wheel.setEnabled(false);
  sndFanfare();
  confettiBurst(els.confetti);
  setTimeout(() => {
    els.overlayCard.innerHTML = `
      <h1>🎉 Hotovo!</h1>
      <p>Kolečko <b>${UC(level.letters)}</b> je vyluštěné.</p>
      <p class="fact">Bonusových slov: <b>${foundBonus.size}</b> z ${level.bonus.length} možných</p>
      <button class="big-btn" id="ov-next">Další kolečko</button>`;
    els.overlay.classList.remove('hidden');
    els.overlay.style.pointerEvents = 'auto';
    $('#ov-next').onclick = () => { go(idx + 1); };
  }, 800);
}

function go(n) {
  idx = (n + LEVELS.length) % LEVELS.length;
  level = LEVELS[idx];
  found = new Set(); foundBonus = new Set(); busy = false;
  els.overlay.classList.add('hidden');
  els.overlay.style.pointerEvents = 'none';
  els.levelLabel.textContent = `Kolečko ${idx + 1} z ${LEVELS.length}`;
  els.bonusCount.textContent = '0';
  grid = new Grid(els.grid, level);
  grid.fit(els.board);
  const mods = mode === 'tiles' ? ['´', 'ˇ', ...(level.needsRing ? ['°'] : [])] : [];
  wheel.setLetters([...level.letters], { mods, accentMode: mode });
  document.getElementById('hint-tip').innerHTML = {
    none: 'Piš <b>bez háčků</b> — hra je doplní sama',
    satellites: 'Podrž písmeno a nakloň prst na <b>bublinu</b> vedle něj',
    tiles: 'Háček a čárku táhni <b>před</b> písmenem',
  }[mode];
  for (const b of document.querySelectorAll('#mode-bar button')) {
    b.classList.toggle('on', b.dataset.mode === mode);
  }
  wheel.setEnabled(true);
  updateWordsLeft();
}

const wheel = new Wheel(els.wheel, els.rope, { onChange: showPill, onSubmit: submit });
els.shuffle.addEventListener('click', () => { unlock(); wheel.shuffle(); });
els.prev.addEventListener('click', () => go(idx - 1));
for (const b of document.querySelectorAll('#mode-bar button')) {
  b.addEventListener('click', () => {
    mode = b.dataset.mode;
    localStorage.setItem('slovotoc-lab-mode', mode);
    go(idx);
  });
}
els.next.addEventListener('click', () => go(idx + 1));
els.jar.addEventListener('click', () => {
  const list = [...foundBonus].sort((a, b) => a.localeCompare(b, 'cs'));
  toast(list.length ? `⭐ ${list.map(w => UC(w)).join(', ')}` : 'Zatím žádné bonusové slovo', 3000);
});
document.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('resize', () => grid && grid.fit(els.board));

setSoundEnabled(true);
const res = await fetch('levels-dia.json');
LEVELS = (await res.json()).levels;
go(0);

window.__lab = {
  wheel,
  submit: w => submit(w),
  state: () => ({ letters: level.letters, found: [...found], bonus: [...foundBonus], idx }),
  level: () => level,
};
