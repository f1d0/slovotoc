// Minimal canvas confetti burst.

const COLORS = ['#ffc93c', '#5ad17d', '#7cc4ff', '#ff8fa3', '#c9a2ff', '#ffe28a', '#ffffff'];

export function confettiBurst(canvas, { count = 140, duration = 2400 } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);

  const W = rect.width, H = rect.height;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0;
    parts.push({
      x: fromLeft ? -8 : W + 8,
      y: H * (0.25 + Math.random() * 0.25),
      vx: (fromLeft ? 1 : -1) * (2.4 + Math.random() * 4.6),
      vy: -(4.5 + Math.random() * 4),
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.32,
      color: COLORS[i % COLORS.length],
      shape: Math.random() < 0.3 ? 'circle' : 'rect',
    });
  }

  const t0 = performance.now();
  let raf;
  function frame(t) {
    const el = t - t0;
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.16;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.992;
      p.rot += p.vr;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.globalAlpha = Math.max(0, 1 - el / duration);
      g.fillStyle = p.color;
      if (p.shape === 'circle') {
        g.beginPath();
        g.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      g.restore();
    }
    if (el < duration) raf = requestAnimationFrame(frame);
    else g.clearRect(0, 0, W, H);
  }
  cancelAnimationFrame(raf);
  requestAnimationFrame(frame);
}
