// Crumby's limbs, in the official Island Crumbs mascot style (see brand art site-07 / site-08 /
// site-09 in island-crumbs-crumby-and-logos.zip): smooth dough-coloured "noodle" arms and legs,
// cartoon hands with a thumb and three fingers, and rounded bean-shaped feet. No gloves or shoes.
// Arms and legs are bendy tubes rebuilt every frame from Bezier curves (rubber-hose style), so
// they flow smoothly out of the cookie body and follow its motion.
import * as THREE from 'three';
import { clamp, TAU } from './fx.js';

// ---- a smooth tube that follows a cubic Bezier, rebuilt in place each frame ----
class Noodle {
  constructor(mat, r0, r1, seg = 26, radial = 14) {
    this.seg = seg; this.radial = radial; this.r0 = r0; this.r1 = r1;
    const n = (seg + 1) * (radial + 1);
    this.pos = new Float32Array(n * 3); this.nor = new Float32Array(n * 3);
    const idx = [];
    for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false;
  }
  // p0..p3: THREE.Vector3 control points
  update(p0, p1, p2, p3, bulge = 0) {
    const { seg, radial, pos, nor } = this;
    let nx = 0, ny = 0, nz = 1, first = true;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, u = 1 - t;
      const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
      const px = b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x;
      const py = b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y;
      const pz = b0 * p0.z + b1 * p1.z + b2 * p2.z + b3 * p3.z;
      const d0 = 3 * u * u, d1 = 6 * u * t, d2 = 3 * t * t;
      let tx = d0 * (p1.x - p0.x) + d1 * (p2.x - p1.x) + d2 * (p3.x - p2.x);
      let ty = d0 * (p1.y - p0.y) + d1 * (p2.y - p1.y) + d2 * (p3.y - p2.y);
      let tz = d0 * (p1.z - p0.z) + d1 * (p2.z - p1.z) + d2 * (p3.z - p2.z);
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      if (first) { // any vector not parallel to the tangent
        if (Math.abs(tz) > 0.9) { nx = 1; ny = 0; nz = 0; } else { nx = 0; ny = 0; nz = 1; }
        first = false;
      }
      // parallel transport the normal
      const dp = nx * tx + ny * ty + nz * tz; nx -= dp * tx; ny -= dp * ty; nz -= dp * tz;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      // taper with a slightly fuller middle; rounded at both ends
      const r = (this.r0 + (this.r1 - this.r0) * t) * (1 + bulge * Math.sin(Math.PI * t));
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * TAU, c = Math.cos(a), s = Math.sin(a);
        const ox = nx * c + bx * s, oy = ny * c + by * s, oz = nz * c + bz * s;
        const k = (i * (radial + 1) + j) * 3;
        pos[k] = px + ox * r; pos[k + 1] = py + oy * r; pos[k + 2] = pz + oz * r;
        nor[k] = ox; nor[k + 1] = oy; nor[k + 2] = oz;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
  }
}

// ---- hand: rounded palm, three fingers and a thumb; local +Y = fingers, +Z = palm normal ----
function makeHand(mat) {
  const hand = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), mat);
  palm.scale.set(1.0, 1.0, 0.62); palm.position.y = 0.07; hand.add(palm);
  const fingers = [];
  const fg = new THREE.CapsuleGeometry(0.03, 0.075, 6, 12);
  [[-0.052, 0.0, 0.92], [0, 0.0, 1], [0.052, 0, 0.9]].forEach(([x, z, len]) => {
    const pivot = new THREE.Group(); pivot.position.set(x * 1.05, 0.14, z);
    pivot.rotation.z = -x * 2.2;                         // fan the fingers a little
    const f = new THREE.Mesh(fg, mat); f.scale.set(1, len, 0.92); f.position.y = 0.05 * len; pivot.add(f);
    hand.add(pivot); fingers.push(pivot);
  });
  const tp = new THREE.Group(); tp.position.set(0.075, 0.06, 0.02); tp.rotation.set(0.25, 0, -0.95);
  const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.031, 0.06, 6, 12), mat); th.position.y = 0.045; tp.add(th); hand.add(tp);
  hand.userData = { fingers, thumb: tp };
  return hand;
}
function curlHand(hand, curl, spread = 0) {
  const { fingers, thumb } = hand.userData;
  fingers.forEach((f, i) => { f.rotation.x = curl * (1 + 0.12 * i); f.rotation.z = -[-0.052, 0, 0.052][i] * (2.2 + spread * 4); });
  thumb.rotation.x = 0.25 + curl * 0.7;
}

// ---- foot: a rounded bean, flat underneath, toe slightly bulbous ----
function makeFoot(mat) {
  const g = new THREE.SphereGeometry(1, 28, 18), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < -0.35) y = -0.35 - (y + 0.35) * 0.25;   // flatten the sole
    const toe = clamp(z), heel = clamp(-z);
    x *= 1 + 0.18 * toe - 0.05 * heel; y *= 1 + 0.12 * toe;
    p.setXYZ(i, x * 0.12, y * 0.1, z * 0.2);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.position.set(0, -0.06, 0.07);
  const foot = new THREE.Group(); foot.add(m);
  return foot;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const tmpM = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();

// Pose library. Hand positions are relative to the body centre, s = side (+1 screen right).
function pose(name, s, t, S, g) {
  switch (name) {
    case 'wave': return { hand: V(1.28 * s, 0.92, 0.3), dir: V(0.18 * s, 1, 0.12), palm: V(0, 0.1, 1), curl: 0.05, spread: 0.25, out: 0.5, up: 0.25 };
    case 'ear': return { hand: V(1.14 * s, 0.2, 0.34), dir: V(0.12 * s, 1, 0.12), palm: V(-0.35 * s, 0, 1), curl: 0.75, spread: 0, out: 0.45, up: 0.15 };
    case 'chin': return { hand: V(0.3 * s, -0.8, 0.46), dir: V(-0.4 * s, 1, 0.1), palm: V(0, -0.1, -1), curl: 1.45, spread: 0, out: 0.4, up: -0.2 };
    case 'hip': return { hand: V(1.1 * s, -0.42, 0.12), dir: V(-0.7 * s, -0.55, 0.15), palm: V(-s, 0, 0), curl: 0.95, spread: 0, out: 0.55, up: 0.2 };
    case 'talk': {
      const lift = g.lift + 0.22 * S.lvl;
      return { hand: V((1.26 + 0.08 * g.open) * s, -0.22 + lift, 0.38 + 0.12 * g.open), dir: V(0.55 * s, 0.75, 0.35), palm: V(-0.35 * s, 0.75, 0.55), curl: 0.12, spread: 0.2 + 0.2 * g.open, out: 0.4, up: 0.05 };
    }
    default: return { hand: V(1.22 * s, -0.66, 0.14), dir: V(0.14 * s, -1, 0.14), palm: V(-s, 0, 0.55), curl: 0.28, spread: 0, out: 0.32, up: -0.05 };
  }
}

export class CrumbyRig {
  constructor(parent, body, mat) {
    this.parent = parent; this.body = body;
    this.arms = [-1, 1].map((s) => {
      const tube = new Noodle(mat, 0.08, 0.068); parent.add(tube.mesh);
      const hand = makeHand(mat); hand.scale.setScalar(1.3); if (s > 0) hand.scale.x = -1.3; parent.add(hand);
      const st = pose('idle', s, 0, { lvl: 0 }, { lift: 0, open: 0 });
      return { s, tube, hand, st };
    });
    this.legs = [-1, 1].map((s) => {
      const tube = new Noodle(mat, 0.095, 0.085); parent.add(tube.mesh);
      const foot = makeFoot(mat); foot.scale.setScalar(1.4); if (s > 0) foot.scale.x = -1.4; parent.add(foot);
      return { s, tube, foot };
    });
    this.gest = [{ lift: 0, open: 0, tl: 0, to: 0 }, { lift: 0, open: 0, tl: 0, to: 0 }];
    this.nextGest = 0; this.waveUntil = -1;
  }
  wave(t, dur = 2.2) { this.waveUntil = t + dur; }

  update(dt, t, S, gaze) {
    const body = this.body; body.updateMatrix();
    const M = body.matrix, k = 1 - Math.exp(-dt * 9);
    const center = V(0, 0, 0).applyMatrix4(M);
    const waving = t < this.waveUntil || S.state === 'wave';
    // talking: pick new gesture targets every so often
    if (t > this.nextGest) {
      this.nextGest = t + 0.9 + Math.random() * 1.1;
      for (const g of this.gest) { g.tl = Math.random() * 0.55 - 0.05; g.to = Math.random(); }
    }
    for (const g of this.gest) { g.lift += (g.tl - g.lift) * (1 - Math.exp(-dt * 4)); g.open += (g.to - g.open) * (1 - Math.exp(-dt * 4)); }

    for (const arm of this.arms) {
      const s = arm.s;
      let name = 'idle';
      if (S.state === 'talking') name = 'talk';
      else if (S.state === 'listening') name = s < 0 ? 'ear' : 'idle';
      else if (S.state === 'thinking') name = s < 0 ? 'chin' : 'hip';
      if (waving && s > 0) name = 'wave';
      const p = pose(name, s, t, S, this.gest[s < 0 ? 0 : 1]);
      const st = arm.st;
      st.hand.lerp(p.hand, k); st.dir.lerp(p.dir, k).normalize(); st.palm.lerp(p.palm, k).normalize();
      st.curl += (p.curl - st.curl) * k; st.spread += (p.spread - st.spread) * k; st.out += (p.out - st.out) * k; st.up += (p.up - st.up) * k;

      // idle sway / wave wiggle
      const hand = st.hand.clone();
      const dir = st.dir.clone();
      hand.y += 0.025 * Math.sin(t * 1.6 + s);
      if (name === 'wave') { const w = Math.sin(t * 11); hand.x += 0.06 * w * s; dir.applyAxisAngle(V(0, 0, 1), -0.42 * w * s).normalize(); }
      if (name === 'talk') hand.y += 0.04 * S.lvl * Math.sin(t * 9 + s);

      // shoulder on the cookie's rim, slightly behind the face
      const sh = V(0.93 * s, -0.12, -0.02).applyMatrix4(M);
      const wrist = hand.add(V(center.x, center.y, center.z));
      const p1 = sh.clone().add(V(st.out * s, st.up, 0.05));
      const p2 = wrist.clone().addScaledVector(dir, -0.26);
      arm.tube.update(sh, p1, p2, wrist, 0.06);

      // orient the hand: Y along the fingers, Z out of the palm
      Y.copy(dir); Z.copy(st.palm).addScaledVector(Y, -st.palm.dot(Y)).normalize(); X.crossVectors(Y, Z);
      tmpM.makeBasis(X, Y, Z);
      arm.hand.position.copy(wrist).addScaledVector(dir, -0.02);
      arm.hand.quaternion.setFromRotationMatrix(tmpM);
      curlHand(arm.hand, st.curl, st.spread);
    }

    // legs: feet planted on the base, knees soft; body weight shifts over them
    for (const leg of this.legs) {
      const s = leg.s;
      const hip = V(0.36 * s, -0.86, -0.02).applyMatrix4(M);
      const ankle = V(0.4 * s, 0.2, 0.04);
      const drop = clamp((1.62 - center.y) * 3, -0.5, 1);       // body lower -> knees bend more
      const p1 = hip.clone().add(V(0.04 * s, -0.22, 0.06 + 0.06 * drop));
      const p2 = ankle.clone().add(V(-0.02 * s, 0.24, 0.08 + 0.1 * drop));
      leg.tube.update(hip, p1, p2, ankle, 0.05);
      leg.foot.position.copy(ankle);
      leg.foot.rotation.set(0, 0.22 * s, 0);
    }
  }
}
