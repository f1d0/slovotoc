// Crossword grid: renders the level layout, reveals cells, and knows which
// words are completed by the revealed cells (hints can finish words too).

import { UC } from './wheel.js';

export class Grid {
  constructor(el, level) {
    this.el = el;
    this.level = level;
    this.cells = new Map();     // "x,y" -> { ch, el, revealed, words: [word] }
    this.wordCells = new Map(); // word string -> ["x,y", ...] in letter order

    for (const p of level.words) {
      const keys = [];
      for (let i = 0; i < p.w.length; i++) {
        const x = p.x + (p.d === 'h' ? i : 0);
        const y = p.y + (p.d === 'v' ? i : 0);
        const k = `${x},${y}`;
        keys.push(k);
        if (!this.cells.has(k)) this.cells.set(k, { ch: p.w[i], revealed: false, words: [] });
        this.cells.get(k).words.push(p.w);
      }
      this.wordCells.set(p.w, keys);
    }

    el.innerHTML = '';
    el.style.gridTemplateColumns = `repeat(${level.gw}, var(--cell))`;
    for (let y = 0; y < level.gh; y++) {
      for (let x = 0; x < level.gw; x++) {
        const k = `${x},${y}`;
        const d = document.createElement('div');
        if (this.cells.has(k)) {
          d.className = 'cell';
          d.dataset.k = k;
          d.appendChild(document.createElement('span'));
          this.cells.get(k).el = d;
        } else {
          d.className = 'cell empty';
        }
        el.appendChild(d);
      }
    }
  }

  fit(boardEl) {
    const pad = 30;
    const bw = boardEl.clientWidth - pad;
    const bh = boardEl.clientHeight - pad;
    const gap = 4;
    const { gw, gh } = this.level;
    const size = Math.floor(Math.min((bw - gap * (gw - 1)) / gw, (bh - gap * (gh - 1)) / gh));
    const cell = Math.max(20, Math.min(54, size));
    this.el.style.setProperty('--cell', cell + 'px');
    return cell;
  }

  isRevealed(k) { return this.cells.get(k)?.revealed; }

  reveal(k, { hinted = false, silent = false } = {}) {
    const c = this.cells.get(k);
    if (!c || c.revealed) return false;
    c.revealed = true;
    c.el.classList.add('revealed');
    if (hinted) c.el.classList.add('hinted');
    if (!silent) {
      c.el.querySelector('span').textContent = UC(c.ch);
    } else {
      const s = c.el.querySelector('span');
      s.style.animation = 'none';
      s.textContent = UC(c.ch);
    }
    return true;
  }

  unrevealedKeys() {
    return [...this.cells.entries()].filter(([, c]) => !c.revealed).map(([k]) => k);
  }

  // words fully revealed but not yet in `known` (completed via hints)
  completedWords(known) {
    const out = [];
    for (const [w, keys] of this.wordCells) {
      if (known.has(w)) continue;
      if (keys.every(k => this.cells.get(k).revealed)) out.push(w);
    }
    return out;
  }

  pulseWord(w) {
    const keys = this.wordCells.get(w) || [];
    keys.forEach((k, i) => {
      const el = this.cells.get(k).el;
      setTimeout(() => {
        el.classList.remove('pulse');
        void el.offsetWidth;
        el.classList.add('pulse');
      }, i * 45);
    });
  }

  cellRect(k) { return this.cells.get(k).el.getBoundingClientRect(); }

  allRevealed() {
    for (const c of this.cells.values()) if (!c.revealed) return false;
    return true;
  }

  setPickMode(on) {
    for (const c of this.cells.values()) {
      c.el.classList.toggle('pickable', on && !c.revealed);
    }
  }
}
