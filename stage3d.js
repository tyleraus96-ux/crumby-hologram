// Real-time 3D stage (three.js r186, vendored). Pure black background; only the character is lit.
// Characters: VideoCrumby (default, pre-rendered loops) and Orb3D. One view or a 4-sided pyramid layout.
import * as THREE from 'three';
import { clamp, noise, TAU } from './fx.js';
import { VideoCrumby } from './videocrumby.js';


// ---------- small helpers ----------
function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const GLOW_TEX = () => radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [0.55, 'rgba(255,255,255,0.14)'], [1, 'rgba(255,255,255,0)']]);
const SPARK_TEX = () => {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.moveTo(s / 2, 2); g.quadraticCurveTo(s / 2, s / 2, s - 2, s / 2); g.quadraticCurveTo(s / 2, s / 2, s / 2, s - 2);
  g.quadraticCurveTo(s / 2, s / 2, 2, s / 2); g.quadraticCurveTo(s / 2, s / 2, s / 2, 2); g.fill();
  return new THREE.CanvasTexture(c);
};
const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false };
const lerpColor = (out, a, b, t) => out.copy(a).lerp(b, clamp(t));

// Fresnel rim shell: the "hologram" edge glow.
function fresnelMaterial(color, power = 2.6) {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 1 }, uPower: { value: power } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uIntensity; uniform float uPower; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))),0.0,1.0), uPower); gl_FragColor = vec4(uColor*f*uIntensity, 1.0); }`,
  });
}

// Twinkling sparkle points.
function sparkles(count, rMin, rMax, flat, seed, tex) {
  const pos = new Float32Array(count * 3), ph = new Float32Array(count), sz = new Float32Array(count);
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    const a = rnd() * TAU, r = rMin + (rMax - rMin) * Math.sqrt(rnd()), z = (rnd() - 0.5) * flat;
    pos.set([Math.cos(a) * r, Math.sin(a) * r * 0.95, z], i * 3); ph[i] = rnd() * TAU; sz[i] = 0.5 + rnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  g.setAttribute('aSz', new THREE.BufferAttribute(sz, 1));
  const m = new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uTime: { value: 0 }, uSize: { value: 60 }, uOpacity: { value: 1 }, uColor: { value: new THREE.Color(1, 0.9, 0.7) }, uMap: { value: tex }, uPx: { value: 1 } },
    vertexShader: `attribute float aPh; attribute float aSz; uniform float uTime; uniform float uSize; uniform float uPx; varying float vTw;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); float tw = 0.5+0.5*sin(uTime*(1.2+aSz*1.7)+aPh); vTw = tw*tw;
        gl_PointSize = uSize*uPx*aSz*(0.45+0.75*vTw)/(-mv.z); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity; varying float vTw;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(uColor*t.rgb*t.a*(0.25+0.75*vTw)*uOpacity, 1.0); }`,
  });
  return new THREE.Points(g, m);
}

// ---------- Crumby ----------
// Built from the official watch-app art: face_base (dough + chips, plain forehead) is projected
// straight onto a thick rounded cookie, and the original eyes_*/mouth_* layers sit on the front
// as decals that share the same projection, so his face and proportions match the brand art.

function arcMaterial(color, count, duty, opacity = 1) {
  return new THREE.ShaderMaterial({
    ...additive, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uCount: { value: count }, uDuty: { value: duty }, uCover: { value: 1 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uCount; uniform float uDuty; uniform float uCover; varying vec2 vP;
      void main(){ float a = atan(vP.y, vP.x)/6.2831853 + 0.5; if (a > uCover) discard;
        float f = fract(a*uCount); float on = smoothstep(0.0,0.02,f)*(1.0-smoothstep(uDuty-0.02,uDuty,f));
        gl_FragColor = vec4(uColor*on*uOpacity, 1.0); }`,
  });
}

export class Orb3D {
  constructor() {
    this.name = 'orb';
    this.scene = new THREE.Scene(); this.root = new THREE.Group(); this.scene.add(this.root);
    this.fitRadius = 1.05; this.fitRadiusPyramid = 1.5;
    this.ready = Promise.resolve();
    this.color = new THREE.Color(0x46cdff);
    const glow = GLOW_TEX();
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x46cdff, ...additive, opacity: 0.35 })); this.halo.scale.setScalar(3.2); this.root.add(this.halo);
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffffff, ...additive, opacity: 1 })); this.core.scale.setScalar(0.9); this.root.add(this.core);
    this.coreTint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x46cdff, ...additive, opacity: 0.9 })); this.coreTint.scale.setScalar(1.5); this.root.add(this.coreTint);
    // plasma shell
    this.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 3), fresnelMaterial(0x7fe6ff, 1.6)); this.root.add(this.shell);
    this.wire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshBasicMaterial({ color: 0x46cdff, wireframe: true, ...additive, opacity: 0.08 })); this.root.add(this.wire);
    // gyroscope rings
    const defs = [[0.62, 0.012, 1, 1.0, 0.9], [0.7, 0.03, 3, 0.62, 0.8], [0.78, 0.008, 120, 0.35, 0.8], [0.86, 0.026, 48, 0.55, 0.45], [0.95, 0.02, 2, 0.3, 0.95], [1.02, 0.006, 1, 1, 0.35]];
    this.rings = defs.map(([r, w, n, duty, op], i) => {
      const pivot = new THREE.Group();
      const m = new THREE.Mesh(new THREE.RingGeometry(r - w, r + w, 160, 1), arcMaterial(0x46cdff, n, duty, op));
      if (i === 3) m.material.uniforms.uCover.value = 0.75;
      pivot.add(m); pivot.rotation.set((i % 3 - 1) * 0.55, (i % 2 ? 1 : -1) * 0.35 * (i / 3), 0);
      this.root.add(pivot); return { pivot, m, sp: (i % 2 ? 1 : -1) * (0.25 + i * 0.08) };
    });
    // waveform loop
    this.waveN = 128;
    this.wave = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.waveN * 3), 3)),
      new THREE.LineBasicMaterial({ color: 0x9feeff, ...additive, opacity: 0.9 }));
    this.root.add(this.wave);
    this.ripples = Array.from({ length: 3 }, () => { const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.515, 128), new THREE.MeshBasicMaterial({ color: 0x46f5ff, ...additive, opacity: 0, side: THREE.DoubleSide })); this.root.add(m); return m; });
    this.sparks = sparkles(320, 0.55, 1.4, 1.4, 7, SPARK_TEX()); this.sparks.material.uniforms.uColor.value.set(0x9fe8ff); this.root.add(this.sparks);
  }
  update(dt, t, S, px) {
    const w = S.w, lv = S.lvl * w.talk, mic = S.mic * w.listen;
    const c = this.color;
    c.set(0x46cdff).lerp(new THREE.Color(0x40f5ff), w.listen).lerp(new THREE.Color(0xbff3ff), w.talk * 0.4).lerp(new THREE.Color(0xffb040), w.think * 0.85);
    const boost = 1 + 4 * w.think + 0.8 * w.listen + 0.6 * lv;
    this.root.rotation.y = 0.25 * Math.sin(t * 0.3); this.root.rotation.x = 0.12 * Math.sin(t * 0.23);
    this.rings.forEach((r, i) => { r.m.rotation.z += dt * r.sp * boost; r.pivot.rotation.y += dt * 0.05 * (i % 2 ? 1 : -1) * boost; r.m.material.uniforms.uColor.value.copy(c); });
    const breath = 0.5 + 0.5 * Math.sin(t * 1.35);
    this.core.scale.setScalar(0.7 + 0.08 * breath + 0.6 * lv + 0.25 * mic);
    this.coreTint.scale.setScalar(1.3 + 0.12 * breath + 0.8 * lv + 0.3 * mic); this.coreTint.material.color.copy(c);
    this.halo.material.color.copy(c); this.halo.material.opacity = 0.28 + 0.1 * breath + 0.3 * lv + 0.25 * mic;
    this.shell.rotation.y += dt * 0.4 * boost; this.shell.rotation.x += dt * 0.25 * boost;
    this.shell.scale.setScalar(1 + 0.35 * lv + 0.1 * mic); this.shell.material.uniforms.uColor.value.copy(c).lerp(new THREE.Color(1, 1, 1), 0.3);
    this.wire.rotation.y -= dt * 0.3 * boost; this.wire.rotation.z += dt * 0.2; this.wire.material.color.copy(c); this.wire.scale.setScalar(1 + 0.25 * lv);
    // waveform
    const p = this.wave.geometry.attributes.position.array, spec = S.spectrum, n = this.waveN, wv = Math.max(w.talk, w.listen * 0.8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, bi = i < n / 2 ? i : n - 1 - i;
      const m = spec[Math.floor((bi / (n / 2)) * spec.length * 0.9)] || 0;
      const r = 0.5 + m * 0.22 * wv + 0.006 * Math.sin(a * 8 + t * 2);
      p[i * 3] = Math.cos(a) * r; p[i * 3 + 1] = Math.sin(a) * r; p[i * 3 + 2] = 0;
    }
    this.wave.geometry.attributes.position.needsUpdate = true; this.wave.material.color.copy(c).lerp(new THREE.Color(1, 1, 1), 0.4);
    this.wave.lookAt(0, 0, 10);
    this.ripples.forEach((m, i) => { const f = (t * 0.9 + i / 3) % 1; m.scale.setScalar(1 + f * 1.9); m.material.opacity = (1 - f) * 0.7 * w.listen; });
    this.sparks.rotation.z += dt * (0.08 + 1.2 * w.think + 0.2 * lv); this.sparks.rotation.y += dt * 0.05 * boost;
    const u = this.sparks.material.uniforms; u.uTime.value = t; u.uPx.value = px; u.uSize.value = 34 * (1 + 0.5 * lv); u.uColor.value.copy(c).lerp(new THREE.Color(1, 1, 1), 0.3);
    u.uOpacity.value = 0.7 + 0.3 * w.think + 0.4 * lv;
  }
}

// ---------- stage ----------
export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    this.chars = { crumby: new VideoCrumby(), orb: new Orb3D() };
    this.ready = Promise.all(Object.values(this.chars).map((c) => c.ready));
    this.maxDpr = 2; this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.slow = 0;
  }
  unlock() { this.chars.crumby.unlock(); }
  settled() { return this.chars.crumby.settled(); }
  resize(w, h) { this.w = w; this.h = h; this.renderer.setPixelRatio(this.dpr); this.renderer.setSize(w, h, false); }
  // keep 60 fps on phones: step the pixel ratio down if frames run long
  adapt(dt) {
    this.slow = dt > 0.021 ? this.slow + 1 : Math.max(0, this.slow - 0.5);
    if (this.slow > 45 && this.dpr > 1.25) { this.dpr = Math.max(1.25, this.dpr - 0.25); this.slow = 0; this.resize(this.w, this.h); }
  }
  // pyramid cells: top, right, bottom, left; the top of each image points outward
  cells(o, side) {
    const L = Math.min(this.w, this.h), cell = (L / 3) * o.size, off = (L / 3) * (1 + o.gap);
    return [0, 1, 2, 3].map((i) => { const ang = (i * Math.PI) / 2; return { i, ang, cell, x: this.w / 2 + Math.sin(ang) * off, y: this.h / 2 - Math.cos(ang) * off }; });
  }
  render(name, o, dt, t, S, frozen = false) {
    const ch = this.chars[name] || this.chars.crumby, r = this.renderer, cam = this.camera;
    ch.update(dt, t, S, this.dpr * this.h / 900, frozen);
    r.toneMappingExposure = o.gain;
    r.setViewport(0, 0, this.w, this.h); r.setScissorTest(false); r.clear();
    if (ch.video) {
      // the clips are square with Crumby filling ~95% of the width
      const cells = o.mode === 'pyramid'
        ? this.cells(o).map((c) => ({ x: c.x, y: c.y, side: c.cell * 1.05, rot: -c.ang }))
        : [{ x: this.w / 2, y: this.h / 2, side: Math.min(this.w, this.h * 0.8) * o.size, rot: 0 }];
      ch.draw(r, this.w, this.h, cells, o.gain);
      return;
    }
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const target = ch.center || new THREE.Vector3(0, 0, 0), elev = ch.elev || 0;
    if (o.mode !== 'pyramid') {
      const aspect = this.w / this.h; cam.aspect = aspect;
      const d = (ch.fitW ? Math.max(ch.fitH / tanH, ch.fitW / (tanH * aspect)) : ch.fitRadius / (tanH * Math.min(1, aspect))) / (0.9 * o.size);
      cam.position.set(target.x, target.y + elev * d, target.z + d); cam.up.set(0, 1, 0); cam.lookAt(target); cam.updateProjectionMatrix();
      r.render(ch.scene, cam);
      return;
    }
    cam.aspect = 1; cam.updateProjectionMatrix();
    const d = ch.fitRadiusPyramid / tanH;
    for (const c of this.cells(o)) {
      const view = o.views === 'front' ? 0 : [Math.PI, Math.PI / 2, 0, -Math.PI / 2][c.i];
      cam.position.set(target.x + Math.sin(view) * d, target.y + elev * d, target.z + Math.cos(view) * d); cam.up.set(0, 1, 0); cam.lookAt(target);
      cam.rotateZ(c.ang);
      r.setViewport(c.x - c.cell / 2, this.h - c.y - c.cell / 2, c.cell, c.cell);
      r.render(ch.scene, cam);
    }
  }
}
