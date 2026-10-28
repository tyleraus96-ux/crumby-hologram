// Shared drawing helpers: offscreen canvases, cheap cross-browser bloom, colours, noise.
export function makeCanvas(w = 2, h = w) {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h));
  return c;
}

export function resize(c, w, h = w) {
  w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
}

// Bloom via a downsample chain (1/4, 1/8, 1/16) upscaled additively. Works on iOS Safari,
// which has no ctx.filter, and costs a few drawImage calls per frame.
export class Bloom {
  constructor() { this.levels = [makeCanvas(), makeCanvas(), makeCanvas()]; }
  apply(src, dctx, strength = 1, weights = [0.55, 0.65, 0.8]) {
    const N = src.width;
    let prev = src;
    const div = [4, 8, 16];
    for (let i = 0; i < 3; i++) {
      const c = this.levels[i];
      resize(c, N / div[i]);
      const x = c.getContext('2d');
      x.globalCompositeOperation = 'copy';
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(prev, 0, 0, c.width, c.height);
      prev = c;
    }
    dctx.save();
    dctx.globalCompositeOperation = 'lighter';
    dctx.imageSmoothingEnabled = true; dctx.imageSmoothingQuality = 'high';
    for (let i = 0; i < 3; i++) {
      dctx.globalAlpha = Math.min(1, weights[i] * strength);
      dctx.drawImage(this.levels[i], 0, 0, N, N);
    }
    dctx.restore();
  }
}

export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const TAU = Math.PI * 2;

// Smooth 1-D pseudo noise in roughly [-1, 1].
export function noise(x, seed = 0) {
  return (Math.sin(x * 1.0 + seed) * 0.5 + Math.sin(x * 2.17 + seed * 1.7) * 0.3 + Math.sin(x * 4.31 + seed * 2.3) * 0.2);
}

export function rand(seed) { // deterministic PRNG so previews are repeatable
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Expanding ripple rings (listening). Caller owns the list.
export function drawRipples(ctx, ripples, t, r0, r1, color, weight, life = 1.1, lw = 3) {
  for (const t0 of ripples) {
    const age = (t - t0) / life;
    if (age < 0 || age > 1) continue;
    const r = r0 + (r1 - r0) * (1 - Math.pow(1 - age, 2));
    ctx.strokeStyle = rgba(color, (1 - age) * 0.75 * weight);
    ctx.lineWidth = lw * (1 - age * 0.6);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  }
}
