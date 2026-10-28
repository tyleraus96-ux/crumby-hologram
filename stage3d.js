// Real-time 3D stage (three.js r186, vendored). Pure black background; only the character is lit.
// Characters: Crumby3D (default) and Orb3D. Supports one view or a 4-camera pyramid layout.
import * as THREE from 'three';
import { clamp, noise, TAU } from './fx.js';
import { CrumbyRig } from './crumbyrig.js';

const BY = 1.62;   // body centre height above the hologram base (feet stand at y = 0)

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
const SRC_W = 432, SRC_H = 528, SRC_CX = 216, SRC_CY = 276, SRC_R = 214;
const EYES = ['eyes_open', 'eyes_blink', 'eyes_listen', 'eyes_think'];
const MOUTHS = ['mouth_closed', 'mouth_half', 'mouth_open', 'mouth_wide', 'mouth_ooh', 'mouth_think'];

// Profile from the front centre around the edge to the back centre: [r, z, front?]
function cookieProfile() {
  const P = [], RF = 0.8, A = 0.2, B = 0.2, TOP = 0.2, DOME = 0.12;
  for (let i = 0; i <= 14; i++) { const r = (i / 14) * RF; P.push([r, TOP + DOME * Math.pow(1 - Math.pow(r / RF, 2), 2), 1]); }
  for (let i = 1; i < 22; i++) { const p = Math.PI / 2 - (i / 22) * Math.PI; P.push([RF + A * Math.cos(p), B * Math.sin(p), p > -0.05 ? 1 : 0]); }
  for (let i = 14; i >= 0; i--) { const r = (i / 14) * RF; P.push([r, -TOP - 0.04 * Math.pow(1 - Math.pow(r / RF, 2), 2), 0]); }
  return P;
}

// Three texture zones so nothing smears: the front uses the official face art (planar, exactly as
// on the watch), the rounded side wraps a dough strip around (mirrored repeat, no seam), and the
// back is plain dough with chips. Boundary rows are duplicated so each zone keeps its own UVs.
function buildCookie(frontOnly = false, seg = 96) {
  const P = cookieProfile();
  const FRONT_END = 14 + 8, SIDE_END = 14 + 21 + 2;           // profile rows where the zones change
  const zones = frontOnly ? [[0, FRONT_END + 1, 0]] : [[0, FRONT_END, 0], [FRONT_END, SIDE_END, 1], [SIDE_END, P.length - 1, 2]];
  const pos = [], nor = [], uv = [], col = [], idx = [];
  let base = 0; const groups = [];
  for (const [r0, r1, zone] of zones) {
    const start = base, rowsN = r1 - r0 + 1;
    for (let i = r0; i <= r1; i++) {
      const [r, z] = P[i];
      // profile tangent -> outward normal
      const pa = P[Math.max(0, i - 1)], pb = P[Math.min(P.length - 1, i + 1)];
      let tr = pb[0] - pa[0], tz = pb[1] - pa[1]; const tl = Math.hypot(tr, tz) || 1; tr /= tl; tz /= tl;
      let nr = -tz, nz = tr;
      if (i === 0) { nr = 0; nz = 1; } if (i === P.length - 1) { nr = 0; nz = -1; }
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * TAU;
        const lump = 1 + 0.008 * Math.sin(a * 3 + 0.6) + 0.005 * Math.sin(a * 5 + 2.1);
        const rr = r * lump, x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        const zz = z * (1 + 0.03 * Math.sin(a * 2 + 1.3));
        pos.push(x, y, zz); nor.push(nr * Math.cos(a), nr * Math.sin(a), nz);
        if (zone === 0) { const px = SRC_CX + x * SRC_R, py = SRC_CY - y * SRC_R; uv.push(px / SRC_W, 1 - py / SRC_H); }
        else if (zone === 1) { const f = (i - FRONT_END) / (SIDE_END - FRONT_END); uv.push(((a + Math.PI / 2) / TAU) * 4, 0.42 + 0.22 * f); }
        else uv.push(0.5 + x * 0.48, 0.5 + y * 0.36);
        const edge = clamp((r - 0.62) / 0.38);
        const k = (zone === 2 ? 0.82 : 1) * (1 - 0.28 * edge * edge) * (1 - 0.1 * clamp(-zz / 0.2));
        col.push(k, k * 0.97, k * 0.93);
      }
    }
    for (let i = 0; i < rowsN - 1; i++) for (let j = 0; j < seg; j++) {
      const a = start + i * seg + j, b = start + i * seg + ((j + 1) % seg), c = start + (i + 1) * seg + j, d = start + (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, c, b, b, c, d);
    }
    groups.push([zone, (rowsN - 1) * seg * 6]);
    base += rowsN * seg;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  let off = 0; for (const [zone, n] of groups) { g.addGroup(off, n, zone === 0 ? 0 : 1); off += n; }
  return g;
}

const mirrored = (tx) => { tx.wrapS = tx.wrapT = THREE.MirroredRepeatWrapping; return tx; };
function bumpFrom(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const l = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
    const chip = clamp((150 - l) / 90);               // chocolate is darker than dough: raise it
    const v = 0.55 * (l / 255) + 0.45 * chip;
    p[i] = p[i + 1] = p[i + 2] = v * 255; p[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return new THREE.CanvasTexture(c);
}

// ---------- hologram base ----------
function makePlatform() {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.3, 72), new THREE.ShaderMaterial({
    ...additive, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0x46d8ff) }, uO: { value: 1 }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy/1.3; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uO; uniform float uTime; varying vec2 vP;
      void main(){ float r = length(vP); float glow = pow(1.0-r, 1.6)*0.32;
        float rings = smoothstep(0.035,0.0,abs(fract(r*5.0 - uTime*0.25)-0.5)-0.44)*0.12*(1.0-r);
        float edge = smoothstep(0.08,0.0,abs(r-0.96))*0.85;
        gl_FragColor = vec4(uColor*(glow+rings+edge)*uO, 1.0); }`,
  }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.005; g.add(disc);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.25, 0.7, 64, 1, true), new THREE.ShaderMaterial({
    ...additive, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0x46d8ff) }, uO: { value: 1 } },
    vertexShader: `varying float vY; void main(){ vY = position.y/0.7+0.5; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uO; varying float vY; void main(){ gl_FragColor = vec4(uColor*pow(1.0-vY,2.4)*0.16*uO, 1.0); }`,
  }));
  beam.position.y = 0.35; g.add(beam);
  g.userData = { disc, beam };
  return g;
}
function updatePlatform(g, t, w, lv, mic) {
  const { disc, beam } = g.userData, c = disc.material.uniforms.uColor.value;
  c.set(0x46d8ff).lerp(new THREE.Color(0x66f4ff), w.listen).lerp(new THREE.Color(0xffb84a), w.think * 0.8);
  beam.material.uniforms.uColor.value.copy(c);
  const o = 0.75 + 0.1 * Math.sin(t * 1.6) + 0.5 * mic + 0.35 * lv;
  disc.material.uniforms.uO.value = o; beam.material.uniforms.uO.value = o; disc.material.uniforms.uTime.value = t;
}

export class Crumby3D {
  constructor(renderer) {
    this.name = 'crumby';
    this.scene = new THREE.Scene();
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.body = new THREE.Group(); this.root.add(this.body); this.body.position.y = BY;
    this.fx = new THREE.Group(); this.root.add(this.fx); this.fx.position.y = BY;
    // frame the whole character, feet to a raised waving hand
    this.center = new THREE.Vector3(0, 1.45, 0); this.fitRadius = 1.72; this.fitW = 1.55; this.fitH = 1.68; this.fitRadiusPyramid = 1.78; this.elev = 0.08;
    this.platform = makePlatform(); this.root.add(this.platform);
    const loader = new THREE.TextureLoader(), aniso = renderer.capabilities.getMaxAnisotropy();
    const load = (n) => new Promise((res) => loader.load(`assets/crumby/${n}${n.endsWith('_back') ? '.jpg' : '.png'}`, (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, aniso); t.generateMipmaps = true; res(t);
    }, undefined, () => res(null)));
    this.tex = {};
    this.ready = Promise.all(['face_base', 'dough_back', ...EYES, ...MOUTHS].map(async (n) => (this.tex[n] = await load(n)))).then(() => this.build());

    // lights (only this scene)
    // key, two rim lights and a soft fill; the rig turns with each pyramid camera so every view is lit the same
    this.lightRig = new THREE.Group(); this.scene.add(this.lightRig);
    const key = new THREE.DirectionalLight(0xfff1dc, 2.6); key.position.set(-2.2, 2.6, 4); this.lightRig.add(key);
    const rimW = new THREE.DirectionalLight(0xffc98a, 1.6); rimW.position.set(1.4, 1.6, -4); this.lightRig.add(rimW);
    this.rimC = new THREE.DirectionalLight(0x7fd8ff, 1.2); this.rimC.position.set(-1.6, -1.2, -4); this.lightRig.add(this.rimC);
    this.scene.add(new THREE.HemisphereLight(0xffe7c4, 0x1a0c04, 0.75));
    const fill = new THREE.DirectionalLight(0xffe0c0, 0.7); fill.position.set(2.5, -1, 3); this.lightRig.add(fill);

    // hologram glow
    this.glowTex = GLOW_TEX();
    const haloTex = radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(255,255,255,0.75)'], [0.6, 'rgba(255,255,255,0.42)'], [0.72, 'rgba(255,255,255,0.16)'], [0.86, 'rgba(255,255,255,0.04)'], [1, 'rgba(255,255,255,0)']]);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xffb35a, ...additive, opacity: 0.55 }));
    this.halo.scale.setScalar(3.1); this.halo.position.z = 0; this.fx.add(this.halo);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.011, 8, 160), new THREE.MeshBasicMaterial({ color: 0x46ecff, ...additive, opacity: 0 }));
    this.fx.add(this.ring);
    this.ripples = Array.from({ length: 3 }, () => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1.16, 0.012, 6, 128), new THREE.MeshBasicMaterial({ color: 0x46ecff, ...additive, opacity: 0 }));
      this.fx.add(m); return m;
    });
    this.arcsTilt = new THREE.Group(); this.arcsTilt.rotation.x = -1.15; this.arcsTilt.position.y = 0.35; this.fx.add(this.arcsTilt);
    this.arcs = new THREE.Group(); this.arcsTilt.add(this.arcs);
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1.3 + k * 0.09, 0.018, 6, 64, 1.3), new THREE.MeshBasicMaterial({ color: k === 1 ? 0x9fd2ff : 0xffe6c0, ...additive, opacity: 0 }));
      m.rotation.z = k * TAU / 3; this.arcs.add(m);
    }
    this.sparkTex = SPARK_TEX();
    this.sparks = sparkles(46, 1.12, 1.6, 0.9, 11, this.sparkTex); this.fx.add(this.sparks);
    this.look = 0; this.lookTarget = 0; this.lookNext = 5; this.lookEnd = 0;
    this.blinkAt = 3.6; this.blinkUntil = 0; this.mouth = 'mouth_closed'; this.mouthHold = 0;
  }

  build() {
    const t = this.tex;
    const geo = buildCookie(false), front = buildCookie(true);
    this.bodyMat = new THREE.MeshStandardMaterial({
      map: t.face_base, bumpMap: t.face_base?.image ? bumpFrom(t.face_base.image) : null, bumpScale: 2.2,
      vertexColors: true, roughness: 0.78, metalness: 0,
    });
    // the back is plain baked dough with chips (the official face art has his face baked in)
    if (t.dough_back) t.dough_back.wrapS = t.dough_back.wrapT = THREE.MirroredRepeatWrapping;
    this.backMat = new THREE.MeshStandardMaterial({ map: t.dough_back || t.face_base, bumpMap: t.dough_back?.image ? mirrored(bumpFrom(t.dough_back.image)) : null,
      bumpScale: 2.2, vertexColors: true, roughness: 0.8, metalness: 0 });
    this.cookie = new THREE.Mesh(geo, [this.bodyMat, this.backMat]); this.body.add(this.cookie);
    const decal = (map, order) => {
      const m = new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, vertexColors: true, roughness: 0.5,
        polygonOffset: true, polygonOffsetFactor: -2 * order, polygonOffsetUnits: -4 * order });
      const mesh = new THREE.Mesh(front, m); mesh.renderOrder = order; this.body.add(mesh); return mesh;
    };
    this.addChips();
    // limbs: smooth dough, like the official mascot's arms and legs
    this.limbMat = new THREE.MeshPhysicalMaterial({ color: 0xc47228, roughness: 0.55, metalness: 0, sheen: 0.25, sheenColor: new THREE.Color(0xffb870), sheenRoughness: 0.6, clearcoat: 0.06, clearcoatRoughness: 0.6 });
    this.rig = new CrumbyRig(this.root, this.body, this.limbMat);
    this.eyes = decal(t.eyes_open, 1); this.mouthMesh = decal(t.mouth_closed, 2);
    // fresnel hologram rim, a hair larger than the body
    this.rim = new THREE.Mesh(geo, fresnelMaterial(0xffd9a0, 2.4)); this.rim.scale.setScalar(1.015); this.body.add(this.rim);
  }

  // Glossy 3D chocolate chips around the rim, side and back (none on the forehead or face).
  addChips() {
    const g = new THREE.SphereGeometry(1, 18, 12), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {           // chocolate drop: flat base, soft peak
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (z < 0) z *= 0.25; else { const k = 1 - 0.35 * z; x *= k; y *= k; }
      x *= 1 + 0.08 * Math.sin(y * 5); p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: 0x4a2410, roughness: 0.38, metalness: 0.05 });
    const deg = Math.PI / 180;
    // [angle around the cookie (deg, 0 = right, 90 = top), phi on the rounded edge (90 = front, 0 = outer side, -90 = back), size]
    const chips = [[84, 52, 1.0], [18, 40, 0.95], [196, 42, 1.05], [262, 48, 0.9], [302, 36, 1.0],
      [0, -5, 0.9], [60, 8, 0.85], [112, -6, 1.0], [235, 4, 0.9], [160, 18, 0.8],
      [40, -60, 1.0], [150, -55, 0.9], [270, -62, 1.1], [330, -50, 0.85], [100, -80, 0.9], [210, -78, 0.95]];
    this.chips = new THREE.Group(); this.body.add(this.chips);
    for (const [ad, pd, sz] of chips) {
      const a = ad * deg, ph = pd * deg;
      const r = 0.8 + 0.2 * Math.cos(ph), z = 0.2 * Math.sin(ph);
      const n = new THREE.Vector3(Math.cos(ph) * Math.cos(a), Math.cos(ph) * Math.sin(a), Math.sin(ph)).normalize();
      const c = new THREE.Mesh(g, m);
      c.position.set(Math.cos(a) * r, Math.sin(a) * r, z).addScaledVector(n, -0.012);
      c.lookAt(c.position.clone().add(n));
      c.rotateZ(ad);
      const s = 0.088 * sz; c.scale.set(s * 1.15, s, s * 0.85);
      this.chips.add(c);
    }
  }

  // keep the glow sprite behind him from whichever camera is drawing
  beforeView(cam) { this.halo.position.copy(cam.position).sub(this.center).normalize().multiplyScalar(-0.7); }

  update(dt, t, S, px) {
    const w = S.w, lv = S.lvl * w.talk, mic = S.mic * w.listen;
    // expressions from the original layers
    if (t > this.blinkAt) { this.blinkUntil = t + 0.13; this.blinkAt = t + 2.2 + Math.random() * 3.6; }
    const eyes = S.state === 'thinking' ? 'eyes_think' : t < this.blinkUntil ? 'eyes_blink' : S.state === 'listening' ? 'eyes_listen' : 'eyes_open';
    let target = 'mouth_closed';
    if (S.state === 'thinking') target = 'mouth_think';
    else if (S.state === 'talking') { const l = S.lvl; target = l < 0.07 ? 'mouth_closed' : l < 0.22 ? 'mouth_half' : l < 0.42 ? (S.oo > 0.62 ? 'mouth_ooh' : 'mouth_open') : 'mouth_wide'; }
    if (target !== this.mouth && t > this.mouthHold) { this.mouth = target; this.mouthHold = t + 0.075; }
    if (this.eyes && this.tex[eyes]) this.eyes.material.map = this.tex[eyes];
    if (this.mouthMesh && this.tex[this.mouth]) this.mouthMesh.material.map = this.tex[this.mouth];

    // motion: breathing, weight shift, occasional look-around; lean in to listen; look up to think; bounce to talk
    const b = this.body;
    if (t > this.lookNext) { this.lookTarget = (Math.random() < 0.5 ? -1 : 1) * (0.25 + 0.2 * Math.random()); this.lookEnd = t + 1.7; this.lookNext = t + 6 + Math.random() * 5; }
    if (t > this.lookEnd) this.lookTarget = 0;
    const idleW = 1 - Math.max(w.listen, w.think, w.talk);
    this.look += (this.lookTarget * idleW - this.look) * (1 - Math.exp(-dt * 3));
    const shift = Math.sin(t * 0.8);
    b.rotation.y = this.look + 0.09 * Math.sin(t * 0.42) + 0.07 * Math.sin(t * 1.3) * w.talk - 0.16 * w.listen;
    b.rotation.x = 0.035 * Math.sin(t * 0.55) - 0.13 * w.think + 0.12 * w.listen;
    b.rotation.z = 0.035 * shift + 0.1 * w.listen + 0.07 * w.think * Math.sin(t * 0.8 + 0.6);
    b.position.x = 0.05 * shift;
    b.position.y = BY + 0.03 * Math.sin(t * 1.6) + 0.06 * lv * Math.abs(Math.sin(t * 9)) - 0.05 * w.listen;
    b.position.z = 0.14 * w.listen;
    b.scale.setScalar(1 + 0.01 * Math.sin(t * 1.6) + 0.03 * lv);
    this.fx.position.copy(b.position);
    if (S.waveReq) { S.waveReq = false; this.rig?.wave(t); }
    this.rig?.update(dt, t, S);
    updatePlatform(this.platform, t, w, lv, mic);

    // glow
    const warm = new THREE.Color(0xffb35a), cyan = new THREE.Color(0x46ecff);
    lerpColor(this.halo.material.color, warm, cyan, w.listen * 0.85);
    this.halo.material.opacity = 0.85 + 0.1 * Math.sin(t * 1.6) + 0.35 * lv + 0.25 * mic + 0.12 * w.think;
    this.halo.scale.setScalar(3.3 + 0.25 * lv + 0.15 * w.listen);
    if (this.rim) {
      lerpColor(this.rim.material.uniforms.uColor.value, new THREE.Color(0xffd9a0), cyan, w.listen);
      this.rim.material.uniforms.uIntensity.value = 0.75 + 0.6 * lv + 0.8 * mic + 0.3 * w.think;
    }
    this.rimC.intensity = 1.2 + 2.2 * w.listen;
    this.ring.material.opacity = 0.45 * w.listen; this.ring.scale.setScalar(1 + 0.04 * mic);
    this.ripples.forEach((m, i) => {
      const f = (t * 0.9 + i / 3) % 1;
      m.scale.setScalar(1 + f * 0.55);
      m.material.opacity = (1 - f) * 0.38 * Math.max(w.listen, lv * 0.6);
      m.material.color.set(w.listen > lv ? 0x46ecff : 0xffc070);
    });
    this.arcs.rotation.z += dt * (0.6 + 4 * w.think);
    this.arcs.children.forEach((m) => (m.material.opacity = 0.75 * w.think));
    this.sparks.rotation.z += dt * (0.05 + 0.9 * w.think + 0.2 * lv);
    const u = this.sparks.material.uniforms; u.uTime.value = t; u.uPx.value = px; u.uSize.value = 95 * (1 + 0.6 * lv);
    u.uOpacity.value = 0.65 + 0.35 * w.think + 0.5 * lv;
  }
}

// ---------- Jarvis orb (3D) ----------
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
    this.chars = { crumby: new Crumby3D(this.renderer), orb: new Orb3D() };
    this.ready = Promise.all(Object.values(this.chars).map((c) => c.ready));
    this.maxDpr = 2; this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.slow = 0;
  }
  resize(w, h) { this.w = w; this.h = h; this.renderer.setPixelRatio(this.dpr); this.renderer.setSize(w, h, false); }
  // keep 60 fps on phones: step the pixel ratio down if frames run long
  adapt(dt) {
    this.slow = dt > 0.021 ? this.slow + 1 : Math.max(0, this.slow - 0.5);
    if (this.slow > 45 && this.dpr > 1.25) { this.dpr = Math.max(1.25, this.dpr - 0.25); this.slow = 0; this.resize(this.w, this.h); }
  }
  render(name, o, dt, t, S) {
    const ch = this.chars[name] || this.chars.crumby, r = this.renderer, cam = this.camera;
    ch.update(dt, t, S, this.dpr * this.h / 900);
    r.toneMappingExposure = o.gain;
    r.setViewport(0, 0, this.w, this.h); r.setScissorTest(false); r.clear();
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const target = ch.center || new THREE.Vector3(0, 0, 0), elev = ch.elev || 0;
    if (o.mode !== 'pyramid') {
      const aspect = this.w / this.h; cam.aspect = aspect;
      const d = (ch.fitW ? Math.max(ch.fitH / tanH, ch.fitW / (tanH * aspect)) : ch.fitRadius / (tanH * Math.min(1, aspect))) / (0.9 * o.size);
      if (ch.lightRig) ch.lightRig.rotation.y = 0;
      cam.position.set(target.x, target.y + elev * d, target.z + d); cam.up.set(0, 1, 0); cam.lookAt(target); cam.updateProjectionMatrix();
      ch.beforeView?.(cam);
      r.render(ch.scene, cam);
      return;
    }
    const L = Math.min(this.w, this.h), cell = (L / 3) * o.size, off = (L / 3) * (1 + o.gap);
    cam.aspect = 1; cam.updateProjectionMatrix();
    const d = ch.fitRadiusPyramid / tanH;
    // cells: top, right, bottom, left; tops point outward. Bottom (nearest you) shows his front.
    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2;
      const cx = this.w / 2 + Math.sin(ang) * off, cy = this.h / 2 - Math.cos(ang) * off;
      const view = o.views === 'front' ? 0 : [Math.PI, Math.PI / 2, 0, -Math.PI / 2][i];
      cam.position.set(target.x + Math.sin(view) * d, target.y + elev * d, target.z + Math.cos(view) * d); cam.up.set(0, 1, 0); cam.lookAt(target);
      cam.rotateZ(ang);
      if (ch.lightRig) ch.lightRig.rotation.y = view;
      ch.beforeView?.(cam);
      r.setViewport(cx - cell / 2, this.h - cy - cell / 2, cell, cell);
      r.render(ch.scene, cam);
    }
  }
}
