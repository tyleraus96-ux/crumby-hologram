// JARVIS-style orb: plasma core, circular waveform, HUD rings, orbiting particles.
// Drawn in a 1000x1000 design space (radius 500) into an additive glow layer, then bloomed.
import { Bloom, makeCanvas, resize, mix, rgba, clamp, TAU, noise, rand, drawRipples } from './fx.js';

const CYAN = [70, 205, 255], LISTEN = [40, 245, 255], GOLD = [255, 176, 64], WHITE = [200, 245, 255];

export class Orb {
  constructor() {
    this.name = 'orb';
    this.glow = makeCanvas();
    this.bloom = new Bloom();
    const r = rand(7);
    this.particles = Array.from({ length: 380 }, () => ({
      r: 205 + Math.pow(r(), 0.8) * 285, a: r() * TAU,
      sp: (0.04 + r() * 0.22) * (r() < 0.82 ? 1 : -1), s: 1.6 + r() * 3.2, ph: r() * TAU, tw: 0.6 + r() * 2.4,
    }));
    this.ripples = []; this.nextRipple = 0;
    this.rot = new Float64Array(10);
  }

  update(dt, t, S) {
    const w = S.w;
    const boost = 1 + 4.5 * w.think + 0.8 * w.listen + 0.6 * w.talk * S.lvl;
    for (let i = 0; i < this.rot.length; i++) this.rot[i] += dt * boost;
    for (const p of this.particles) p.a += p.sp * dt * (1 + 5 * w.think + 0.5 * w.talk);
    if (w.listen > 0.3 && t > this.nextRipple) { this.ripples.push(t); this.nextRipple = t + 0.5 - 0.25 * S.mic; }
    this.ripples = this.ripples.filter((t0) => t - t0 < 1.2);
  }

  draw(out, N, t, S) {
    resize(this.glow, N);
    const g = this.glow.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, N, N);
    g.globalCompositeOperation = 'lighter';
    g.setTransform(N / 1000, 0, 0, N / 1000, N / 2, N / 2);
    g.lineCap = 'round';

    const w = S.w, lv = S.lvl * w.talk, mic = S.mic * w.listen;
    let col = mix(CYAN, LISTEN, w.listen);
    col = mix(col, WHITE, w.talk * (0.35 + 0.4 * S.lvl));
    col = mix(col, GOLD, w.think * 0.85);
    const accent = mix(GOLD, CYAN, w.think);              // counter colour for a few details
    const breath = 0.5 + 0.5 * Math.sin(t * 1.35);
    const energy = 0.55 + 0.25 * breath + 0.6 * lv + 0.5 * mic + 0.3 * w.think;

    // soft outer atmosphere
    let gr = g.createRadialGradient(0, 0, 60, 0, 0, 500);
    gr.addColorStop(0, rgba(col, 0.18 * energy)); gr.addColorStop(0.5, rgba(col, 0.05 * energy)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 500, 0, TAU); g.fill();

    // core
    const rc = 62 + 10 * breath + 70 * lv + 26 * mic + 8 * w.think * Math.sin(t * 6);
    gr = g.createRadialGradient(0, 0, 0, 0, 0, rc * 2.5);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.16, rgba(mix(col, [255, 255, 255], 0.6), 0.85));
    gr.addColorStop(0.42, rgba(col, 0.32));
    gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rc * 2.5, 0, TAU); g.fill();

    // plasma filaments inside the core
    for (let k = 0; k < 6; k++) {
      const base = 92 + k * 11 + 40 * lv;
      g.strokeStyle = rgba(k % 2 ? col : mix(col, [255, 255, 255], 0.5), 0.22 + 0.25 * energy / (1 + k * 0.3));
      g.lineWidth = 1.6;
      g.beginPath();
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * TAU;
        const d = noise(a * (2 + k) + t * (0.9 + k * 0.23) * (1 + 2 * w.think), k * 3.1) * (10 + 26 * lv + 12 * mic + 10 * w.think);
        const rr = base + d;
        const x = Math.cos(a + t * 0.2 * (k % 2 ? 1 : -1)) * rr, y = Math.sin(a + t * 0.2 * (k % 2 ? 1 : -1)) * rr;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }

    // circular waveform (talk = TTS spectrum, listen = mic spectrum)
    const spec = S.spectrum, n = 128, wv = Math.max(w.talk, w.listen * 0.8);
    const R0 = 188;
    for (const [sign, alpha] of [[1, 0.85], [-0.35, 0.5]]) {
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * TAU - Math.PI / 2;
        const bi = i % n, b = bi < n / 2 ? bi : n - 1 - bi;
        const m = spec[Math.floor((b / (n / 2)) * spec.length * 0.9)] || 0;
        const idle = 2.5 * Math.sin(a * 8 + t * 2) + 1.5 * Math.sin(a * 13 - t * 3);
        const rr = R0 + sign * (m * 95 * wv) + idle;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      if (sign > 0) { g.fillStyle = rgba(col, 0.05 + 0.08 * wv); g.fill(); }
      g.strokeStyle = rgba(col, alpha * (0.45 + 0.55 * energy)); g.lineWidth = sign > 0 ? 2.4 : 1.4; g.stroke();
    }

    // listening: bright locked ring + ripples
    if (w.listen > 0.01) {
      g.strokeStyle = rgba(LISTEN, 0.9 * w.listen); g.lineWidth = 4 + 16 * mic;
      g.beginPath(); g.arc(0, 0, 218, 0, TAU); g.stroke();
      drawRipples(g, this.ripples, t, 220, 480, LISTEN, w.listen);
    }

    // HUD rings
    const ro = this.rot, A = 0.5 + 0.5 * energy;
    const ring = (r, a, lw, c = col) => { g.strokeStyle = rgba(c, a * A); g.lineWidth = lw; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); };
    const arcs = (r, count, span, rot, lw, a, c = col) => {
      g.strokeStyle = rgba(c, a * A); g.lineWidth = lw;
      for (let i = 0; i < count; i++) { const s = rot + (i / count) * TAU; g.beginPath(); g.arc(0, 0, r, s, s + span); g.stroke(); }
    };
    ring(242, 0.32, 1.2);
    arcs(264, 3, 1.15, ro[0] * 0.35, 3.2, 0.75);
    // ticks
    g.save(); g.rotate(-ro[1] * 0.08);
    g.strokeStyle = rgba(col, 0.55 * A); g.lineWidth = 1.6; g.beginPath();
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU, L = i % 10 === 0 ? 20 : i % 5 === 0 ? 13 : 7;
      g.moveTo(Math.cos(a) * 288, Math.sin(a) * 288); g.lineTo(Math.cos(a) * (288 + L), Math.sin(a) * (288 + L));
    }
    g.stroke(); g.restore();
    // segmented band
    g.save(); g.rotate(ro[2] * 0.16);
    g.lineWidth = 9; g.strokeStyle = rgba(col, 0.42 * A);
    for (let i = 0; i < 60; i++) {
      if (i > 44) break;
      const s = (i / 60) * TAU; g.beginPath(); g.arc(0, 0, 334, s, s + TAU / 60 * 0.62); g.stroke();
    }
    g.restore();
    arcs(372, 2, 0.55, -ro[3] * 0.5, 6, 0.85, mix(col, [255, 255, 255], 0.3));
    arcs(372, 2, 0.12, -ro[3] * 0.5 + 0.7, 6, 0.7, accent);
    ring(410, 0.22, 1);
    // satellites on the 410 ring
    for (let i = 0; i < 3; i++) {
      const a = ro[4] * (0.3 + i * 0.12) + i * 2.1;
      const x = Math.cos(a) * 410, y = Math.sin(a) * 410;
      gr = g.createRadialGradient(x, y, 0, x, y, 16);
      gr.addColorStop(0, rgba([255, 255, 255], 0.9 * A)); gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, 16, 0, TAU); g.fill();
    }
    arcs(452, 4, 0.36, ro[5] * 0.06, 2.4, 0.6);
    g.save(); g.rotate(-ro[6] * 0.03); g.setLineDash([2, 14]); ring(482, 0.4, 2); g.setLineDash([]); g.restore();

    // thinking swirl arms
    if (w.think > 0.01) {
      for (let arm = 0; arm < 3; arm++) {
        g.beginPath();
        for (let i = 0; i <= 40; i++) {
          const f = i / 40, r = 120 + f * 330, a = t * 2.6 + arm * TAU / 3 + f * 2.4;
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.strokeStyle = rgba(GOLD, 0.55 * w.think); g.lineWidth = 3.5; g.stroke();
      }
    }

    // particles
    for (const p of this.particles) {
      const rr = p.r + Math.sin(t * 0.7 + p.ph) * 12 + w.think * Math.sin(t * 2.2 + p.ph) * 55
        - mic * 90 * (p.r / 490) + lv * 45 * Math.sin(t * 9 + p.ph);
      const x = Math.cos(p.a) * rr, y = Math.sin(p.a) * rr;
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * p.tw + p.ph));
      g.fillStyle = rgba(p.s > 4 ? [255, 255, 255] : col, tw * (0.55 + 0.4 * energy));
      g.fillRect(x - p.s / 2, y - p.s / 2, p.s, p.s);
    }
    if (w.think > 0.05) {
      g.lineWidth = 2; g.strokeStyle = rgba(GOLD, 0.45 * w.think);
      g.beginPath();
      for (let i = 0; i < this.particles.length; i += 3) {
        const p = this.particles[i], rr = p.r + w.think * Math.sin(t * 2.2 + p.ph) * 55;
        const a0 = p.a - 0.28 * Math.sign(p.sp);
        g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr); g.arc(0, 0, rr, a0, p.a, p.sp < 0);
      }
      g.stroke();
    }

    // composite glow + bloom into the character canvas
    const o = out.getContext('2d');
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'copy'; o.drawImage(this.glow, 0, 0);
    this.bloom.apply(this.glow, o, 0.9 + 0.5 * lv + 0.3 * mic);
  }
}
