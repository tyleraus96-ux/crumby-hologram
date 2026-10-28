// Video Crumby: pre-rendered loops on pure black (assets/video), drawn as WebGL video textures so the
// same frame can be placed once (single sheet) or four times, rotated, for the pyramid.
// Two video "slots" are blended in the shader, so every state change is a short crossfade.
// Every clip starts and ends on the same keyframe pose, so cutting at a clip boundary is seamless.
import * as THREE from 'three';

const CLIPS = ['idle', 'wave', 'listen', 'think', 'talk1', 'talk2', 'talk3'];
const TALK = ['talk1', 'talk2', 'talk3'];
const GROUP = { listening: 'listen', thinking: 'think', talking: 'talk', wave: 'wave' };
const groupOf = (k) => (k.startsWith('talk') ? 'talk' : k);
const LOOPS = new Set(['idle', 'listen', 'think']);

export class VideoCrumby {
  constructor() {
    this.name = 'crumby'; this.video = true;
    this.els = {}; this.tex = {};
    // off-screen holder: iOS decodes more reliably when the elements are in the document
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.appendChild(box);
    for (const k of CLIPS) {
      const v = document.createElement('video');
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = false; v.preload = 'auto';
      for (const a of ['muted', 'playsinline', 'webkit-playsinline']) v.setAttribute(a, '');
      v.src = `assets/video/crumby-${k}.mp4`;
      v.width = v.height = 2; box.appendChild(v); v.load();
      const t = new THREE.VideoTexture(v);
      t.colorSpace = THREE.NoColorSpace; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
      this.els[k] = v; this.tex[k] = t;
    }
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: this.tex.idle }, uB: { value: this.tex.idle }, uMix: { value: 1 }, uGain: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D uA, uB; uniform float uMix, uGain; varying vec2 vUv;
        void main(){ vec3 c = mix(texture2D(uA, vUv).rgb, texture2D(uB, vUv).rgb, uMix) * uGain;
          c *= smoothstep(0.035, 0.05, max(c.r, max(c.g, c.b)) + 0.03);   // keep true black black
          gl_FragColor = vec4(c, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this.cur = 'idle'; this.prev = 'idle'; this.mix = 1; this.fade = 0.3; this.pendingWave = false; this.lastTalk = 'talk3';
    this.frozen = null;
    const idle = this.els.idle;
    this.ready = new Promise((res) => { idle.addEventListener('loadeddata', res, { once: true }); setTimeout(res, 5000); });
    this.play(idle);
  }
  play(v) { const p = v.play(); p?.catch?.(() => {}); }
  // call from a user tap: iOS (Low Power Mode) may refuse autoplay until then
  unlock() {
    if (this.unlocked) return; this.unlocked = true;
    for (const k of CLIPS) { const v = this.els[k]; if (k === this.cur || k === this.prev) this.play(v); else { const p = v.play(); p?.then?.(() => { if (k !== this.cur && k !== this.prev) v.pause(); }).catch(() => {}); } }
  }
  pick(g) {
    if (g !== 'talk') return g;
    const opts = TALK.filter((k) => k !== this.lastTalk), k = opts[Math.floor(Math.random() * opts.length)];
    this.lastTalk = k; return k;
  }
  switchTo(k, fade) {
    if (k === this.cur && this.mix >= 1) { const v = this.els[k]; v.currentTime = 0; this.play(v); return; }
    if (this.prev !== this.cur && this.prev !== k) this.els[this.prev].pause();
    this.prev = this.cur; this.cur = k; this.mix = 0; this.fade = fade;
    const v = this.els[k]; v.loop = false; v.currentTime = 0; this.play(v);
  }
  // deterministic still for previews (?t=)
  freeze(want, t) {
    const k = want === 'talk' ? 'talk1' : want, v = this.els[k];
    if (this.frozen !== k) { this.frozen = k; this.cur = this.prev = k; this.mix = 1; for (const e of Object.values(this.els)) e.pause(); }
    const target = t % (v.duration || 4);
    if (v.readyState >= 1 && !v.seeking && Math.abs(v.currentTime - target) > 0.02) v.currentTime = target;
    this.tex[k].needsUpdate = v.readyState >= 2;
  }
  settled() { const v = this.els[this.cur]; return v.readyState >= 2 && !v.seeking && (this.frozen === null || v.currentTime > 0); }
  update(dt, t, S, _px, frozen) {
    const want = GROUP[S.state] || 'idle';
    if (frozen) return this.freeze(want, t);
    if (S.waveReq) { S.waveReq = false; if (want === 'idle' || want === 'listen') this.pendingWave = true; }
    if (want !== 'idle' && want !== 'listen') this.pendingWave = false;
    const v = this.els[this.cur], g = groupOf(this.cur);
    const remain = v.duration ? v.duration - v.currentTime : 9;
    const atEnd = v.ended || remain < 0.06;
    v.loop = LOOPS.has(this.cur) && g === want && !this.pendingWave;
    if (v.paused && !v.ended && this.mix >= 1) this.play(v);
    if (this.pendingWave && g !== 'wave') { this.pendingWave = false; this.switchTo('wave', 0.25); }
    else if (g !== want) {
      if (g === 'wave' && (want === 'idle' || want === 'listen')) { if (atEnd) this.switchTo(this.pick(want), 0.12); }   // finish the wave
      else if (g === 'talk' && want === 'idle' && remain < 1.0) { if (atEnd) this.switchTo('idle', 0.12); }               // finish the sentence gesture
      else this.switchTo(this.pick(want), g === 'talk' ? 0.4 : 0.3);
    } else if (atEnd) this.switchTo(this.pick(want), 0.1);   // next talk variant, or replay the wave
    // crossfade (only once the incoming clip has a frame)
    if (this.mix < 1 && this.els[this.cur].readyState >= 2) {
      this.mix = Math.min(1, this.mix + dt / this.fade);
      if (this.mix >= 1 && this.prev !== this.cur) this.els[this.prev].pause();
    }
  }
  // cells: [{x, y, side, rot}] in CSS px from the top-left of the canvas
  draw(r, w, h, cells, gain) {
    const c = this.cam; c.left = 0; c.right = w; c.top = 0; c.bottom = -h; c.updateProjectionMatrix();
    const u = this.mat.uniforms;
    u.uA.value = this.tex[this.prev]; u.uB.value = this.tex[this.cur];
    const m = this.mix; u.uMix.value = m * m * (3 - 2 * m); u.uGain.value = gain;
    for (const q of cells) {
      this.quad.position.set(q.x, -q.y, 0); this.quad.scale.set(q.side, q.side, 1); this.quad.rotation.z = q.rot;
      r.render(this.scene, c);
    }
  }
}
