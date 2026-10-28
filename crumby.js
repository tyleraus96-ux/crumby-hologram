// Crumby, drawn from the real Island Crumbs face art (assets/crumby/*.png, copied unchanged from
// the watch app). The 432x528 face is shown through a soft round window (a crop, never a redraw);
// eyes and mouth are the original expression layers swapped by state and voice level.
import { Bloom, makeCanvas, resize, mix, rgba, clamp, TAU, rand, drawRipples } from './fx.js';

const LAYERS = ['face_base', 'eyes_open', 'eyes_blink', 'eyes_listen', 'eyes_think',
  'mouth_closed', 'mouth_half', 'mouth_open', 'mouth_wide', 'mouth_ooh', 'mouth_think'];
// Round window on the 432x528 source: centred between eyes and mouth.
const SRC_CX = 216, SRC_CY = 276, SRC_R = 214;
const WARM = [255, 186, 92], CREAM = [255, 236, 200], LISTEN = [70, 235, 255], SKY = [150, 210, 255];

export class Crumby {
  constructor() {
    this.name = 'crumby';
    this.imgs = {};
    this.ready = Promise.all(LAYERS.map((n) => new Promise((res) => {
      const im = new Image(); im.decoding = 'async';
      im.onload = () => res(); im.onerror = () => res();
      im.src = `assets/crumby/${n}.png`; this.imgs[n] = im;
    })));
    this.face = makeCanvas(); this.glow = makeCanvas(); this.bloom = new Bloom();
    const r = rand(11);
    this.sparks = Array.from({ length: 70 }, () => ({
      r: 0.5 + r() * 0.45, a: r() * TAU, sp: (0.05 + r() * 0.2) * (r() < 0.75 ? 1 : -1),
      s: 0.006 + r() * 0.014, ph: r() * TAU, tw: 0.8 + r() * 2.5, hue: r(),
    }));
    this.ripples = []; this.nextRipple = 0;
    this.blinkAt = 3.6; this.blinkUntil = 0; this.mouth = 'mouth_closed'; this.mouthHold = 0; this.spin = 0;
  }

  update(dt, t, S) {
    const w = S.w;
    this.spin += dt * (1 + 5 * w.think + 0.8 * w.talk * S.lvl);
    for (const p of this.sparks) p.a += p.sp * dt * (1 + 6 * w.think);
    if (w.listen > 0.3 && t > this.nextRipple) { this.ripples.push(t); this.nextRipple = t + 0.55 - 0.25 * S.mic; }
    this.ripples = this.ripples.filter((t0) => t - t0 < 1.2);
    if (t > this.blinkAt) { this.blinkUntil = t + 0.13; this.blinkAt = t + 2.2 + Math.random() * 3.6; }

    // mouth: pick an original mouth layer from the voice level, held briefly to avoid flicker
    let target;
    if (S.state === 'thinking') target = 'mouth_think';
    else if (S.state === 'talking') {
      const l = S.lvl;
      target = l < 0.07 ? 'mouth_closed' : l < 0.22 ? 'mouth_half' : l < 0.42 ? (S.oo > 0.62 ? 'mouth_ooh' : 'mouth_open') : 'mouth_wide';
    } else target = 'mouth_closed';
    if (target !== this.mouth && t > this.mouthHold) { this.mouth = target; this.mouthHold = t + 0.075; }
  }

  eyes(t, S) {
    if (S.state === 'thinking') return 'eyes_think';
    if (t < this.blinkUntil) return 'eyes_blink';
    if (S.state === 'listening') return 'eyes_listen';
    return 'eyes_open';
  }

  draw(out, N, t, S) {
    const w = S.w, lv = S.lvl * w.talk, mic = S.mic * w.listen;
    const breath = 0.5 + 0.5 * Math.sin(t * 1.6);
    const D = N * 0.6 * (1 + 0.012 * breath + 0.02 * lv);           // uniform scale only
    const R = D / 2;
    const bob = N * (0.012 * Math.sin(t * 1.6) + 0.006 * lv * Math.sin(t * 13));
    const tilt = 0.035 * Math.sin(t * 0.9) * (1 - w.think) + 0.05 * w.think * Math.sin(t * 0.7) + 0.02 * lv * Math.sin(t * 5);
    const cx = N / 2, cy = N / 2 + bob;

    // ---- glow layer (behind) ----
    resize(this.glow, N);
    const g = this.glow.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, N, N);
    g.globalCompositeOperation = 'lighter';
    g.translate(cx, cy);
    const halo = 0.55 + 0.15 * breath + 0.55 * lv + 0.2 * w.think;
    let col = mix(WARM, LISTEN, w.listen * 0.8);
    let gr = g.createRadialGradient(0, 0, R * 0.85, 0, 0, R * 1.62);
    gr.addColorStop(0, rgba(col, 0.75 * halo)); gr.addColorStop(0.35, rgba(col, 0.28 * halo)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 1.62, 0, TAU); g.fill();
    // rim ring behind the cookie edge
    g.strokeStyle = rgba(mix(CREAM, LISTEN, w.listen), 0.32 * halo); g.lineWidth = R * 0.05;
    g.beginPath(); g.arc(0, 0, R * 1.01, 0, TAU); g.stroke();

    if (w.listen > 0.01) {
      g.strokeStyle = rgba(LISTEN, 0.95 * w.listen); g.lineWidth = R * (0.025 + 0.06 * mic);
      g.beginPath(); g.arc(0, 0, R * 1.12, 0, TAU); g.stroke();
      drawRipples(g, this.ripples, t, R * 1.12, N * 0.49, LISTEN, w.listen, 1.1, R * 0.02);
    }
    if (w.think > 0.01) { // swirling sprinkle arcs
      for (let k = 0; k < 3; k++) {
        const s = this.spin * 1.4 + k * TAU / 3;
        g.strokeStyle = rgba(k === 1 ? SKY : CREAM, 0.7 * w.think); g.lineWidth = R * 0.03; g.lineCap = 'round';
        g.beginPath(); g.arc(0, 0, R * (1.2 + 0.08 * k), s, s + 1.1); g.stroke();
      }
    }
    // talking: soft sound rings
    if (lv > 0.02) {
      for (let k = 0; k < 3; k++) {
        const f = ((t * 0.9 + k / 3) % 1);
        g.strokeStyle = rgba(WARM, (1 - f) * 0.45 * lv); g.lineWidth = R * 0.02;
        g.beginPath(); g.arc(0, 0, R * (1.08 + f * 0.55), 0, TAU); g.stroke();
      }
    }
    this.drawSparks(g, N, t, w, lv, 'back');
    g.setTransform(1, 0, 0, 1, 0, 0);

    // ---- face layer: original art through a round, feathered window ----
    resize(this.face, N);
    const f = this.face.getContext('2d');
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over'; f.clearRect(0, 0, N, N);
    f.imageSmoothingEnabled = true; f.imageSmoothingQuality = 'high';
    const k = R / SRC_R;
    f.translate(cx, cy); f.rotate(tilt); f.scale(k, k); f.translate(-SRC_CX, -SRC_CY);
    const im = this.imgs;
    if (im.face_base?.complete) f.drawImage(im.face_base, 0, 0);
    const e = im[this.eyes(t, S)]; if (e?.complete) f.drawImage(e, 0, 0);
    const m = im[this.mouth]; if (m?.complete) f.drawImage(m, 0, 0);
    f.setTransform(1, 0, 0, 1, 0, 0);
    // feathered round mask
    f.globalCompositeOperation = 'destination-in';
    gr = f.createRadialGradient(cx, cy, 0, cx, cy, R);
    gr.addColorStop(0, '#000'); gr.addColorStop(0.95, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = gr; f.fillRect(0, 0, N, N);
    // gentle roundness: darker rim, warm top-left light (lighting only, art untouched)
    f.globalCompositeOperation = 'source-atop';
    gr = f.createRadialGradient(cx - R * 0.18, cy - R * 0.22, R * 0.55, cx, cy, R);
    gr.addColorStop(0, 'rgba(40,18,0,0)'); gr.addColorStop(1, 'rgba(40,18,0,0.38)');
    f.fillStyle = gr; f.fillRect(0, 0, N, N);
    f.globalCompositeOperation = 'source-over';

    // ---- composite ----
    const o = out.getContext('2d');
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'copy'; o.drawImage(this.glow, 0, 0);
    this.bloom.apply(this.glow, o, 0.8 + 0.5 * lv);
    o.globalCompositeOperation = 'source-over'; o.drawImage(this.face, 0, 0);
    // Pepper's ghost eats brightness: lift the face a little with an additive pass
    o.globalCompositeOperation = 'lighter'; o.globalAlpha = 0.18 + 0.1 * lv; o.drawImage(this.face, 0, 0); o.globalAlpha = 1;
    // thin glowing rim on top
    o.strokeStyle = rgba(mix(CREAM, LISTEN, w.listen), 0.16 + 0.12 * halo); o.lineWidth = Math.max(1, R * 0.012);
    o.beginPath(); o.arc(cx, cy, R * 0.985, 0, TAU); o.stroke();
    o.translate(cx, cy); this.drawSparks(o, N, t, w, lv, 'front'); o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'source-over';
  }

  drawSparks(ctx, N, t, w, lv, layer) {
    const H = N / 2;
    for (let i = 0; i < this.sparks.length; i++) {
      const p = this.sparks[i];
      const front = i % 3 === 0;
      if ((layer === 'front') !== front) continue;
      const rr = H * (p.r + 0.03 * Math.sin(t + p.ph) + 0.06 * w.think * Math.sin(t * 2 + p.ph) + 0.05 * lv * Math.sin(t * 8 + p.ph));
      if (rr < H * 0.64) continue;
      const x = Math.cos(p.a) * rr, y = Math.sin(p.a) * rr * 0.92;
      const tw = Math.pow(0.5 + 0.5 * Math.sin(t * p.tw + p.ph), 2);
      const s = H * p.s * (0.6 + 0.8 * tw) * (1 + lv);
      const c = p.hue < 0.55 ? CREAM : p.hue < 0.8 ? WARM : SKY;
      ctx.globalAlpha = clamp(0.25 + 0.75 * tw);
      ctx.fillStyle = rgba(c, 1);
      // four-point sparkle
      ctx.beginPath();
      ctx.moveTo(x, y - s * 2); ctx.quadraticCurveTo(x, y, x + s * 2, y); ctx.quadraticCurveTo(x, y, x, y + s * 2);
      ctx.quadraticCurveTo(x, y, x - s * 2, y); ctx.quadraticCurveTo(x, y, x, y - s * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
