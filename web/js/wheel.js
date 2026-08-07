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

  // `mods` puts accent tiles in the ring ('tiles' input style).
  // `accentMode`: 'none' (bare letters only) | 'tiles' | 'satellites'
  setLetters(letters, { mods = [], accentMode = 'none' } = {}) {
    this.accentMode = accentMode;
    this.sats = [];
    this.satEls = [];
    this.lastSat = null;
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
    for (const sel of this.selected) {
      const it = this.items[sel.i];
      if (it.kind === 'mod') { pending = it.mark; continue; }
      const mark = sel.accent ?? pending;
      const mapped = mark ? ACCENTS[mark]?.[it.ch] : null;
      out += mapped ?? it.ch;   // an accent that doesn't fit just falls away
      pending = null;
    }
    return out;
  }

  clear() {
    this.selected = [];
    this.hideSatellites();
    this.dragging = false;
    for (const b of this.buttons) b.classList.remove('sel');
    this.drawRope();
    this.onChange('');
  }

  // ---- accent satellites ----
  // Travelling across the wheel to a separate accent tile is what made the
  // gesture error-prone, so the accents appear right next to the letter you
  // are standing on: a ~30px nudge outwards instead of a trip through the hub.
  hideSatellites() {
    for (const el of this.satEls ?? []) el.remove();
    this.satEls = [];
    this.sats = [];
  }

  showSatellites(i) {
    this.hideSatellites();
    if (this.accentMode !== 'satellites' || i < 0) return;
    const it = this.items[i];
    if (!it || it.kind !== 'letter') return;
    const marks = Object.keys(ACCENTS).filter(m => ACCENTS[m][it.ch]);
    if (!marks.length) return;

    const S = this.el.clientWidth;
    const c = this.centers[i];
    const base = Math.atan2(c.y - S / 2, c.x - S / 2);
    const R = S * 0.36 + S * 0.145;
    const spread = marks.length === 1 ? [0] : marks.length === 2 ? [-0.30, 0.30] : [-0.42, 0, 0.42];
    marks.forEach((mark, k) => {
      const a = base + spread[k];
      const x = S / 2 + R * Math.cos(a);
      const y = S / 2 + R * Math.sin(a);
      const b = document.createElement('button');
      b.className = 'wheel-sat';
      b.textContent = UC(ACCENTS[mark][it.ch]);
      b.style.transform = `translate(${x}px, ${y}px)`;
      this.el.appendChild(b);
      this.satEls.push(b);
      this.sats.push({ x, y, mark, el: b });
    });
  }

  hitSatellite(px, py) {
    const S = this.el.clientWidth;
    const r = S * 0.105;
    for (const s of this.sats ?? []) {
      if (Math.hypot(px - s.x, py - s.y) < r) return s;
    }
    return null;
  }

  applyAccent(sat) {
    const last = this.selected[this.selected.length - 1];
    if (!last || this.items[last.i]?.kind !== 'letter') return;
    last.accent = last.accent === sat.mark ? null : sat.mark;   // tap again to undo
    for (const s of this.sats) s.el.classList.toggle('on', s.mark === last.accent);
    sndTick(this.selected.length);
    this.onChange(this.word());
  }

  // ---- pointer handling ----
  hitTest(e) {
    const r = this.el.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    this.pointer = { x: px, y: py };
    const S = this.el.clientWidth;
    const hitR = S * (this.dragging ? 0.098 : 0.115);
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
    const sat = this.hitSatellite(this.pointer.x, this.pointer.y);
    if (sat) {
      if (this.lastSat !== sat) { this.lastSat = sat; this.applyAccent(sat); }
      this.drawRope();
      return;
    }
    this.lastSat = null;
    if (i >= 0) {
      const sel = this.selected;
      // Undo only on a deliberate return: the finger has to land near the
      // middle of the previous tile, not merely clip it on the way past.
      const S = this.el.clientWidth;
      const backOK = i >= 0 &&
        Math.hypot(this.pointer.x - this.centers[i].x, this.pointer.y - this.centers[i].y) < S * 0.07;
      if (sel.length >= 2 && i === sel[sel.length - 2].i && backOK) {
        // moved back onto the previous letter → undo last selection
        const popped = sel.pop();
        if (!sel.some(s => s.i === popped.i)) this.buttons[popped.i].classList.remove('sel');
        this.showSatellites(sel[sel.length - 1]?.i ?? -1);
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
    const last = this.selected[this.selected.length - 1];
    if (it.kind === 'mod') return last?.i !== i;
    return !this.selected.some(s => s.i === i);
  }

  select(i) {
    this.selected.push({ i, accent: null });
    this.buttons[i].classList.add('sel');
    sndTick(this.selected.length - 1);
    this.showSatellites(i);
    this.onChange(this.word());
  }

  drawRope() {
    const pts = this.selected.map(s => this.centers[s.i]);
    if (this.dragging && this.pointer && pts.length) pts.push(this.pointer);
    this.svg.innerHTML = pts.length >= 2
      ? `<polyline points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" />`
      : '';
  }
}

export { UC };
