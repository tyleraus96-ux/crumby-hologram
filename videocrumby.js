// Video Crumby: one "sprite" video (assets/video/crumby-sprite.mp4) holding every pre-rendered loop
// back to back: idle, wave, listen, think, talk1-3. All loops start and end on the same pose with the
// same camera, so cutting from the end of one to the start of another is seamless.
//
// iOS-friendly playback:
//  * the whole sprite is fetched once into a blob URL (progress bar), so nothing streams mid-switch;
//  * exactly two <video> elements: the active one plays, the spare sits paused and already seeked
//    to the start of the clip that comes next, so a switch is just "play the spare and show it";
//  * clips change at the loop end (checked every frame with requestVideoFrameCallback times), or
//    crossfade in the shader when the state changes mid-clip;
//  * drawn as WebGL textures, so the pyramid gets four rotated copies of the same frame.
import * as THREE from 'three';

const FPS = 24;
const SEGS = { idle: [0, 96], wave: [96, 96], listen: [192, 120], think: [312, 120], talk1: [432, 96], talk2: [528, 96], talk3: [624, 96] };
const TALK = ['talk1', 'talk2', 'talk3'];
const GROUP = { listening: 'listen', thinking: 'think', talking: 'talk', wave: 'wave' };
const groupOf = (k) => (k.startsWith('talk') ? 'talk' : k);
const LOOPS = new Set(['idle', 'listen', 'think']);
const start = (k) => SEGS[k][0] / FPS, end = (k) => (SEGS[k][0] + SEGS[k][1]) / FPS;
export const SPRITE_URL = 'assets/video/crumby-sprite.mp4';

export class VideoCrumby {
  constructor() {
    this.name = 'crumby'; this.video = true;
    // Kept in the page (behind the opaque canvas) so iOS treats them as visible and keeps decoding.
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:50%;top:50%;width:120px;height:240px;margin:-120px 0 0 -60px;z-index:-1;pointer-events:none';
    document.body.appendChild(box);
    this.v = [0, 1].map(() => {
      const v = document.createElement('video');
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = false; v.preload = 'auto';
      for (const a of ['muted', 'playsinline', 'webkit-playsinline']) v.setAttribute(a, '');
      v.style.cssText = 'width:120px;height:120px;display:block';
      v.seg = 'idle'; v.ready = false; v.mediaTime = 0;
      box.appendChild(v);
      const onFrame = (_n, meta) => { v.mediaTime = meta.mediaTime; v.requestVideoFrameCallback(onFrame); };
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onFrame);
      v.addEventListener('seeked', () => { v.ready = true; v.mediaTime = v.currentTime; tex(v).needsUpdate = true; });
      return v;
    });
    const texs = this.v.map((v) => { const t = new THREE.VideoTexture(v); t.colorSpace = THREE.NoColorSpace; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; });
    const tex = (v) => texs[this.v.indexOf(v)];
    this.texs = texs;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: texs[0] }, uB: { value: texs[1] }, uMix: { value: 0 }, uGain: { value: 1 } },
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
    this.a = 0;            // index of the active (shown) element
    this.w = 0;            // shown weight of element 1 (0 = element 0 fully shown)
    this.fade = 0; this.pendingWave = false; this.lastTalk = 'talk3'; this.nextTalk = 'talk1';
    this.frozen = null; this.stats = { switches: 0, stalls: 0 };
    this.progress = 0; this.onProgress = null;
    this.ready = this.load();
  }
  async load() {
    let blob = null;
    try {
      const r = await fetch(SPRITE_URL);
      if (!r.ok) throw new Error(`video ${r.status}`);
      const total = +r.headers.get('content-length') || 0, reader = r.body.getReader(), parts = []; let got = 0;
      for (;;) { const { value, done } = await reader.read(); if (done) break; parts.push(value); got += value.length; if (total) this.setProgress(got / total); }
      blob = new Blob(parts, { type: 'video/mp4' });
    } catch (e) { console.warn('sprite fetch failed, streaming instead', e); }
    this.setProgress(1);
    // each element gets its own blob URL; if a browser refuses blob video, fall back to the
    // (now cached) file URL
    await Promise.all(this.v.map((v) => new Promise((res) => {
      v.addEventListener('loadeddata', res, { once: true }); setTimeout(res, 10000);
      v.addEventListener('error', () => {
        if (v.src.startsWith('blob:')) { console.warn('blob video failed, using the file URL'); this.blobFailed = true; v.src = SPRITE_URL; } else res();
      });
      v.src = blob ? URL.createObjectURL(blob) : SPRITE_URL;
    })));
    this.loaded = true;
    const A = this.v[0]; A.seg = 'idle'; A.currentTime = 0.001; this.play(A);
    this.prepare(this.v[1], 'idle');
  }
  setProgress(p) { this.progress = p; this.onProgress?.(p); }
  play(v) { const p = v.play(); p?.catch?.(() => {}); }
  // call inside a user tap: blesses both elements for later play() calls on iOS
  unlock() {
    if (this.unlocked || !this.loaded) return; this.unlocked = true;
    const A = this.v[this.a], B = this.v[1 - this.a];
    this.play(A);
    const p = B.play(); p?.then?.(() => { if (this.v[1 - this.a] === B && !B.keep) this.prepare(B, B.seg, true); }).catch(() => {});
  }
  // park the spare on the first frame of clip k
  prepare(v, k, force = false) {
    if (!force && v.seg === k && (v.ready || v.seeking)) return;
    v.keep = false; v.pause(); v.seg = k; v.ready = false; v.mediaTime = 0; v.currentTime = start(k) + 0.001;
  }
  pick(g) {
    if (g !== 'talk') return g;
    return this.nextTalk;
  }
  advanceTalk() { this.lastTalk = this.nextTalk; const o = TALK.filter((k) => k !== this.lastTalk); this.nextTalk = o[Math.floor(Math.random() * o.length)]; }
  // what plays after the current clip, given the wanted group
  following(cur, want) {
    if (this.pendingWave && (want === 'idle' || want === 'listen')) return 'wave';
    if (want === 'talk') return groupOf(cur) === 'talk' && cur === this.nextTalk ? TALK.find((k) => k !== cur) : this.nextTalk;
    return want;
  }
  // switch to the parked spare: fade 0 = hard cut at a loop boundary
  swap(fade) {
    const B = this.v[1 - this.a], A = this.v[this.a];
    A.ready = false; A.keep = fade > 0;   // the outgoing clip keeps playing while it fades out
    B.keep = false; B.ready = false; this.play(B);
    if (B.seg.startsWith('talk')) { if (B.seg === this.nextTalk) this.advanceTalk(); }
    if (B.seg === 'wave') this.pendingWave = false;
    this.a = 1 - this.a; this.fade = fade; this.stats.switches++;
    if (fade <= 0) this.w = this.a;
  }
  freeze(want, t) {
    const k = want === 'talk' ? 'talk1' : want, A = this.v[0];
    this.a = 0; this.w = 0;
    if (!this.loaded) return;
    if (this.frozen !== k) { this.frozen = k; A.pause(); this.v[1].pause(); A.seg = k; }
    const target = start(k) + (t % (SEGS[k][1] / FPS));
    if (A.readyState >= 1 && !A.seeking && Math.abs(A.currentTime - target) > 0.02) A.currentTime = target;
    this.texs[0].needsUpdate = A.readyState >= 2;
  }
  settled() { const A = this.v[this.a]; return !!this.loaded && A.readyState >= 2 && !A.seeking && (this.frozen === null || A.currentTime > 0.01); }
  update(dt, t, S, _px, frozen) {
    const want = GROUP[S.state] || 'idle';
    if (frozen) return this.freeze(want, t);
    if (S.waveReq) { S.waveReq = false; if (want === 'idle' || want === 'listen') this.pendingWave = true; }
    if (want !== 'idle' && want !== 'listen') this.pendingWave = false;
    if (!this.loaded) return;
    const A = this.v[this.a], B = this.v[1 - this.a], cur = A.seg, g = groupOf(cur);
    // where the active clip is: prefer the presented-frame time, fall back to currentTime
    const now = Math.max(A.currentTime, A.mediaTime || 0), remain = end(cur) - now;
    const next = this.following(cur, want);
    const fading = this.w !== this.a;
    if (!fading && (B.seg !== next || (!B.ready && !B.seeking))) this.prepare(B, next);
    // decide: immediate crossfade on a real state change, otherwise cut at the loop end
    const finishFirst = (g === 'wave' && (want === 'idle' || (want === 'listen' && now - start('wave') < 2.0))) || (g === 'talk' && want === 'idle' && remain < 1.0) || (g === want && !(this.pendingWave && g !== 'wave'));
    if (fading) { /* let the crossfade finish */ }
    else if (!finishFirst && B.ready) this.swap(0.3);
    else if (remain <= 0.5 / FPS) {
      // cut once the spare is really moving (play() can take a few frames to start on phones);
      // A runs on into the next clip meanwhile, which also begins on the same pose
      const moving = !B.paused && (B.mediaTime || B.currentTime) > start(B.seg) + 0.02;
      if (B.seg === next && (B.ready || !B.paused) && (moving || remain < -0.25)) this.swap(0);
      else if (B.seg !== next || (!B.ready && B.paused)) { if (!A.seeking && remain < -0.25) { A.currentTime = start(cur) + 0.001; this.stats.stalls++; } }   // spare not ready: loop in place
    } else if (remain <= 0.3 && B.ready && B.seg === next && B.paused) this.play(B);   // pre-start the spare
    else if (A.paused && !A.seeking && A.readyState >= 2 && t - (this.kick || 0) > 1) { this.kick = t; this.play(A); }
    // shader weight toward the active element
    const target = this.a;
    if (this.fade > 0 && this.w !== target) { const s = dt / this.fade; this.w = target > this.w ? Math.min(1, this.w + s) : Math.max(0, this.w - s); }
    else this.w = target;
    if (this.w === target) { const old = this.v[1 - this.a]; if (old.keep) { old.keep = false; old.pause(); } }
  }
  // cells: [{x, y, side, rot}] in CSS px from the top-left of the canvas
  draw(r, w, h, cells, gain) {
    const c = this.cam; c.left = 0; c.right = w; c.top = 0; c.bottom = -h; c.updateProjectionMatrix();
    const u = this.mat.uniforms, m = this.w;
    u.uMix.value = m * m * (3 - 2 * m); u.uGain.value = gain;
    for (const q of cells) {
      this.quad.position.set(q.x, -q.y, 0); this.quad.scale.set(q.side, q.side, 1); this.quad.rotation.z = q.rot;
      r.render(this.scene, c);
    }
  }
}
