// Tiny synthesized sound effects (WebAudio, no assets) + haptics.

let ctx = null;
let enabled = true;

export function setSoundEnabled(on) { enabled = on; }
export function soundEnabled() { return enabled; }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// call once from a user gesture so iOS unlocks audio
export function unlock() { ac(); }

function tone(freq, t0, dur, { type = 'sine', gain = 0.16, slide = 0 } = {}) {
  const c = ac();
  if (!c || !enabled) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), c.currentTime + t0 + dur);
  g.gain.setValueAtTime(0, c.currentTime + t0);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + t0);
  o.stop(c.currentTime + t0 + dur + 0.05);
}

export function vib(pattern) {
  try { if (enabled && navigator.vibrate) navigator.vibrate(pattern); } catch { /* ignore */ }
}

// rising blip per selected letter, like the original game
export function sndTick(i) {
  tone(392 * Math.pow(2, Math.min(i, 12) / 12), 0, 0.09, { type: 'triangle', gain: 0.12 });
  vib(8);
}
export function sndWord() {
  [523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * 0.055, 0.16, { type: 'triangle', gain: 0.15 }));
  vib(25);
}
export function sndBonus() {
  [880, 1174.66, 1567.98].forEach((f, i) => tone(f, i * 0.05, 0.14, { type: 'sine', gain: 0.11 }));
  vib([12, 30, 12]);
}
export function sndDupe() {
  tone(587, 0, 0.07, { type: 'sine', gain: 0.09 });
  tone(587, 0.09, 0.07, { type: 'sine', gain: 0.09 });
}
export function sndBad() {
  tone(160, 0, 0.18, { type: 'sawtooth', gain: 0.06, slide: -60 });
  vib([18, 24, 18]);
}
export function sndReveal() {
  tone(740, 0, 0.1, { type: 'triangle', gain: 0.12, slide: 240 });
}
export function sndCoin() {
  tone(1318.5, 0, 0.06, { type: 'square', gain: 0.045 });
  tone(1760, 0.06, 0.1, { type: 'square', gain: 0.045 });
}
export function sndFanfare() {
  const seq = [
    [523.25, 0.0], [659.25, 0.09], [783.99, 0.18], [1046.5, 0.27],
    [783.99, 0.42], [1046.5, 0.52],
  ];
  for (const [f, t] of seq) tone(f, t, 0.22, { type: 'triangle', gain: 0.15 });
  vib([30, 40, 30, 40, 60]);
}
export function sndShuffle() {
  tone(300, 0, 0.08, { type: 'triangle', gain: 0.07, slide: 150 });
  tone(450, 0.07, 0.08, { type: 'triangle', gain: 0.07, slide: -150 });
}
