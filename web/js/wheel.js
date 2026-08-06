// The letter wheel: drag (pointer) across letters to build a word, with a
// rope drawn through the selected letters. Backtracking onto the previous
// letter deselects the last one, like the original game.

import { sndTick, sndShuffle } from './audio.js';

const UC = s => s.toLocaleUpperCase('cs-CZ');

// Accent tiles (prototype, see docs/navrh-diakritika.md). A modifier applies
// to the NEXT letter dragged; on a letter that cannot take it, it silently
// falls away instead of counting as a mistake.
export const ACCENTS = {
  '´': { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý' },
  'ˇ': { c: 'č', d: 'ď', e: 'ě', n: 'ň', r: 'ř', s: 'š', t: 'ť', z: 'ž' },
  '°': { u: 'ů' },
};

export class Wheel {
  constructor(wheelEl, ropeSvg, { onChange, onSubmit } = {}) {
    this.el = wheelEl;
    this.svg = ropeSvg;
    this.onChange = onChange || (() => {});
    this.onSubmit = onSubmit || (() => {});
    this.letters = [];
    this.buttons = [];
    this.slots = [];        // slots[i] = angular slot of letter i
    this.selected = [];     // indices into letters, in pick order
    this.dragging = false;
    this.enabled = true;
    this.pointer = null;

    this.el.addEventListener('pointerdown', e => this.onDown(e));
    this.el.addEventListener('pointermove', e => this.onMove(e));
    this.el.addEventListener('pointerup', e => this.onUp(e));
    this.el.addEventListener('pointercancel', () => this.cancel());
    window.addEventListener('resize', () => this.layout());
  }

  // `mods` (optional) adds accent tiles to the ring: ['´', 'ˇ', '°']
  setLetters(letters, { mods = [] } = {}) {
    this.letters = [...letters];
    this.mods = mods;
    this.items = [
      ...this.letters.map(ch => ({ kind: 'letter', ch })),
      ...mods.map(mark => ({ kind: 'mod', mark })),
    ];
    this.selected = [];
    this.dragging = false;
    for (const b of this.buttons) b.remove();
    this.buttons = this.items.map((it, i) => {
      const b = document.createElement('button');
      b.className = 'wheel-letter' + (it.kind === 'mod' ? ' mod' : '');
      b.textContent = it.kind === 'mod' ? it.mark : UC(it.ch);
      b.dataset.i = i;
      this.el.appendChild(b);
      return b;
    });
    this.slots = this.items.map((_, i) => i);
    this.scramble();
    this.layout(false);
    this.drawRope();
  }

  // The wheel is built from the base word, so leaving the letters in their
  // natural order puts the longest answer around the rim in one sweep — the
  // hardest word becomes the easiest. Start from a scrambled arrangement.
  isSequential() {
    const n = this.slots.length;
    if (n < 3) return false;
    for (const dir of [1, -1]) {
      const start = this.slots[0];
      let ok = true;
      for (let i = 1; i < n; i++) {
        if (this.slots[i] !== (((start + dir * i) % n) + n) % n) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  scramble() {
    const n = this.slots.length;
    for (let attempt = 0; attempt < 12; attempt++) {
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.slots[i], this.slots[j]] = [this.slots[j], this.slots[i]];
      }
      if (!this.isSequential()) return;
    }
  }

  layout(animate = true) {
    const S = this.el.clientWidth;
    if (!S) return;
    const n = this.items.length;
    const R = S * 0.36;
    this.centers = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (this.slots[i] / n) * Math.PI * 2;
      const x = S / 2 + R * Math.cos(a);
      const y = S / 2 + R * Math.sin(a);
      this.centers[i] = { x, y };
      const b = this.buttons[i];
      if (!animate) b.style.transition = 'none';
      b.style.left = '0px';
      b.style.top = '0px';
      b.style.transform = `translate(${x}px, ${y}px)`;
      if (!animate) {
        // force reflow, then restore the transition for future shuffles
        void b.offsetWidth;
        b.style.transition = '';
      }
    }
    this.drawRope();
  }

  shuffle() {
    if (this.selected.length || !this.enabled) return false;
    this.scramble();
    this.layout(true);
    sndShuffle();
    return true;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.cancel();
  }

  word() {
    let pending = null;
    let out = '';
    for (const i of this.selected) {
      const it = this.items[i];
      if (it.kind === 'mod') { pending = it.mark; continue; }
      const mapped = pending ? ACCENTS[pending]?.[it.ch] : null;
      out += mapped ?? it.ch;   // an accent that doesn't fit just falls away
      pending = null;
    }
    return out;
  }

  clear() {
    this.selected = [];
    this.dragging = false;
    for (const b of this.buttons) b.classList.remove('sel');
    this.drawRope();
    this.onChange('');
  }

  // ---- pointer handling ----
  hitTest(e) {
    const r = this.el.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    this.pointer = { x: px, y: py };
    const S = this.el.clientWidth;
    const hitR = S * 0.115;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.centers.length; i++) {
      const dx = px - this.centers[i].x;
      const dy = py - this.centers[i].y;
      const d = Math.hypot(dx, dy);
      if (d < hitR && d < bestD) { best = i; bestD = d; }
    }
    return best;
  }

  onDown(e) {
    if (!this.enabled || !e.isPrimary) return;
    this.el.setPointerCapture(e.pointerId);
    const i = this.hitTest(e);
    if (i >= 0) {
      this.dragging = true;
      this.select(i);
    }
    this.drawRope();
  }

  onMove(e) {
    if (!this.dragging || !e.isPrimary) return;
    const i = this.hitTest(e);
    if (i >= 0) {
      const sel = this.selected;
      if (sel.length >= 2 && i === sel[sel.length - 2]) {
        // moved back onto the previous letter → undo last selection
        const popped = sel.pop();
        if (!sel.includes(popped)) this.buttons[popped].classList.remove('sel');
        this.onChange(this.word());
      } else if (this.canSelect(i)) {
        this.select(i);
      }
    }
    this.drawRope();
  }

  onUp(e) {
    if (!e.isPrimary) return;
    if (this.dragging) {
      const w = this.word();
      this.dragging = false;
      this.pointer = null;
      this.drawRope();
      this.onSubmit(w);
    }
  }

  cancel() {
    if (this.dragging || this.selected.length) this.clear();
    this.pointer = null;
  }

  canSelect(i) {
    const it = this.items[i];
    if (it.kind === 'mod') return this.selected[this.selected.length - 1] !== i;
    return !this.selected.includes(i);
  }

  select(i) {
    this.selected.push(i);
    this.buttons[i].classList.add('sel');
    sndTick(this.selected.length - 1);
    this.onChange(this.word());
  }

  drawRope() {
    const pts = this.selected.map(i => this.centers[i]);
    if (this.dragging && this.pointer && pts.length) pts.push(this.pointer);
    this.svg.innerHTML = pts.length >= 2
      ? `<polyline points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" />`
      : '';
  }
}

export { UC };
