// Ten maps. Each has its own bunker style, symmetric layout and look (ground, sky, light).
// A layout lists generic bunker "kinds" (sizes used for collision); each style decides
// what that kind looks like: an inflatable can, a tree stump, a snowman, a stack of tires...
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const PI = Math.PI;

// footprint (w along local x, d along local z) or radius, and height: these define collision
export const KINDS = {
  block:     { t: 'b', w: 1.0, d: 2.6, h: 1.25 },
  wall:      { t: 'b', w: 2.4, d: 0.9, h: 1.05 },
  longwall:  { t: 'b', w: 4.5, d: 0.8, h: 1.6 },
  tall:      { t: 'b', w: 1.45, d: 1.45, h: 2.5 },
  temple:    { t: 'b', w: 1.3, d: 2.6, h: 1.85 },
  container: { t: 'b', w: 6.0, d: 2.4, h: 2.6 },
  snake:     { t: 'b', w: 10.9, d: 0.88, h: 0.9 },
  can:       { t: 'c', r: 0.6, h: 1.9 },
  bigcan:    { t: 'c', r: 0.8, h: 2.4 },
  minican:   { t: 'c', r: 0.5, h: 1.15 },
  cake:      { t: 'c', r: 1.7, h: 1.1 },
  tri:       { t: 't', R: 1.05, r: 0.75, h: 1.3 },
};

// ---------- textures ----------
const texCache = {};
function ctex(key, size, draw, srgb = true) {
  if (texCache[key]) return texCache[key];
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return (texCache[key] = t);
}
function speckle(g, S, n, cols, w = 2, h = 2) {
  for (let i = 0; i < n; i++) { g.fillStyle = pick(cols); g.fillRect(Math.random() * S, Math.random() * S, w, h); }
}
function blotch(g, S, n, col, r0, r1) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = rnd(r0, r1);
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
const TEX = {
  planks: () => ctex('planks', 256, (g, S) => {
    const rows = 4, h = S / rows;
    for (let r = 0; r < rows; r++) {
      g.fillStyle = ['#8a5a32', '#7b4f2b', '#946238', '#82552f'][r]; g.fillRect(0, r * h, S, h);
      g.strokeStyle = 'rgba(40,20,5,.25)'; g.lineWidth = 1.5;
      for (let k = 0; k < 9; k++) { const y = r * h + rnd(4, h - 4); g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + rnd(-3, 3), S * 0.6, y + rnd(-3, 3), S, y); g.stroke(); }
      g.fillStyle = 'rgba(30,15,5,.65)'; g.fillRect(0, r * h, S, 3);
      g.fillStyle = 'rgba(25,12,2,.75)';
      for (const nx of [rnd(10, 60), rnd(140, 200)]) { g.beginPath(); g.arc(nx, r * h + h * 0.5, 2.5, 0, 7); g.fill(); }
    }
  }),
  bark: () => ctex('bark', 256, (g, S) => {
    g.fillStyle = '#4a3424'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 160; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(20,12,6,.55)' : 'rgba(120,90,60,.25)'; g.fillRect(Math.random() * S, 0, rnd(1, 4), S); }
    speckle(g, S, 900, ['rgba(0,0,0,.3)', 'rgba(140,110,80,.2)'], 2, 5);
  }),
  rings: () => ctex('rings', 128, (g, S) => {
    g.fillStyle = '#c99a62'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(110,70,30,.5)';
    for (let r = 4; r < S; r += rnd(4, 8)) { g.lineWidth = rnd(0.8, 2); g.beginPath(); g.arc(S / 2, S / 2, r, 0, 7); g.stroke(); }
  }),
  concrete: () => ctex('concrete', 256, (g, S) => {
    g.fillStyle = '#9d9c97'; g.fillRect(0, 0, S, S);
    speckle(g, S, 3500, ['rgba(60,60,60,.25)', 'rgba(220,220,215,.25)', 'rgba(110,105,95,.3)']);
    blotch(g, S, 8, 'rgba(70,65,55,.18)', 20, 60);
  }),
  corrugated: () => ctex('corrugated', 128, (g, S) => {
    const n = 8, w = S / n;
    for (let i = 0; i < n; i++) {
      const gr = g.createLinearGradient(i * w, 0, i * w + w, 0);
      gr.addColorStop(0, '#9a9a9a'); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, '#8a8a8a');
      g.fillStyle = gr; g.fillRect(i * w, 0, w, S);
    }
    speckle(g, S, 300, ['rgba(80,40,20,.25)', 'rgba(0,0,0,.15)'], 2, 3);
  }),
  hay: () => ctex('hay', 256, (g, S) => {
    g.fillStyle = '#d2b05a'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      g.strokeStyle = pick(['#e8cc78', '#b8923e', '#f2dc94', '#a7843a', '#c9a24c']); g.lineWidth = rnd(0.6, 1.6);
      const x = Math.random() * S, y = Math.random() * S, a = rnd(-0.5, 0.5), l = rnd(6, 22);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  }),
  hayEnd: () => ctex('hayEnd', 128, (g, S) => {
    g.fillStyle = '#c4a050'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(120,90,30,.55)'; g.lineWidth = 2;
    g.beginPath(); for (let a = 0; a < 40; a += 0.2) { const r = a * 1.5; g.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r); } g.stroke();
  }),
  stone: () => ctex('stone', 256, (g, S) => {
    g.fillStyle = '#cfae7a'; g.fillRect(0, 0, S, S);
    speckle(g, S, 3000, ['rgba(120,90,50,.25)', 'rgba(250,235,200,.25)']);
    g.strokeStyle = 'rgba(120,92,58,.6)'; g.lineWidth = 3;
    const rows = 4, h = S / rows;
    for (let r = 0; r < rows; r++) {
      g.beginPath(); g.moveTo(0, r * h); g.lineTo(S, r * h); g.stroke();
      const off = r % 2 ? S / 4 : 0;
      for (let x = off; x < S; x += S / 2) { g.beginPath(); g.moveTo(x, r * h); g.lineTo(x, r * h + h); g.stroke(); }
    }
  }),
  adobe: () => ctex('adobe', 256, (g, S) => {
    g.fillStyle = '#c38c5a'; g.fillRect(0, 0, S, S);
    blotch(g, S, 30, 'rgba(230,190,140,.25)', 10, 50); blotch(g, S, 20, 'rgba(120,70,40,.18)', 10, 40);
    speckle(g, S, 2000, ['rgba(90,50,25,.25)', 'rgba(240,210,170,.2)']);
  }),
  snow: () => ctex('snow', 128, (g, S) => {
    g.fillStyle = '#f3f7fb'; g.fillRect(0, 0, S, S);
    speckle(g, S, 900, ['rgba(170,200,230,.35)', 'rgba(255,255,255,.9)']);
  }),
  canvas: () => ctex('canvas', 128, (g, S) => {
    g.fillStyle = '#a8946a'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(80,65,40,.25)'; g.lineWidth = 1;
    for (let i = 0; i < S; i += 3) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
    blotch(g, S, 6, 'rgba(70,55,30,.25)', 8, 30);
  }),
  rust: () => ctex('rust', 256, (g, S) => {
    g.fillStyle = '#7d4528'; g.fillRect(0, 0, S, S);
    blotch(g, S, 40, 'rgba(190,100,40,.35)', 8, 40); blotch(g, S, 30, 'rgba(40,20,10,.35)', 6, 30);
    speckle(g, S, 2500, ['rgba(220,140,70,.3)', 'rgba(30,15,5,.35)']);
  }),
  crate: () => ctex('crate', 128, (g, S) => {
    g.fillStyle = '#9a6a3a'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(50,25,8,.35)'; for (let y = 0; y < S; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
    g.fillStyle = '#6e4622'; const b = 14; g.fillRect(0, 0, S, b); g.fillRect(0, S - b, S, b); g.fillRect(0, 0, b, S); g.fillRect(S - b, 0, b, S);
    g.save(); g.translate(S / 2, S / 2); g.rotate(PI / 4); g.fillRect(-S * 0.7, -b / 2, S * 1.4, b); g.restore();
  }),
};

// ---------- materials ----------
const matCache = {};
function mat(key, make) { return matCache[key] || (matCache[key] = make()); }
function std(key, o, uvScale) {
  return mat(key, () => { const m = new THREE.MeshStandardMaterial(o); if (uvScale) m.userData.uvScale = uvScale; return m; });
}
const MT = {
  planks: () => std('planks', { map: TEX.planks(), roughness: 0.85 }, 1.2),
  darkwood: () => std('darkwood', { color: 0x5a3b22, roughness: 0.9 }),
  bark: () => std('bark', { map: TEX.bark(), roughness: 0.95 }, 1.0),
  rings: () => std('rings', { map: TEX.rings(), roughness: 0.8 }, 1.1),
  concrete: () => std('concrete', { map: TEX.concrete(), roughness: 0.92 }, 1.5),
  rubber: () => std('rubber', { color: 0x1b1c1e, roughness: 0.92 }),
  paintTire: (c) => std('tire' + c, { color: c, roughness: 0.7 }),
  hay: () => std('hay', { map: TEX.hay(), roughness: 1 }, 1.0),
  hayEnd: () => std('hayEnd', { map: TEX.hayEnd(), roughness: 1 }, 1.2),
  twine: () => std('twine', { color: 0x3a2f20, roughness: 0.9 }),
  canvasBag: () => std('canvasBag', { map: TEX.canvas(), roughness: 0.95 }, 0.5),
  odGreen: () => std('odGreen', { color: 0x4b5320, roughness: 0.6, metalness: 0.2 }),
  crate: () => std('crate', { map: TEX.crate(), roughness: 0.85 }, 0.9),
  stone: () => std('stone', { map: TEX.stone(), roughness: 0.95 }, 1.6),
  adobe: () => std('adobe', { map: TEX.adobe(), roughness: 0.97 }, 2.0),
  terracotta: () => std('terracotta', { color: 0xb5603a, roughness: 0.8 }),
  snow: () => std('snow', { map: TEX.snow(), roughness: 0.75 }, 1.0),
  ice: () => mat('ice', () => new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.82 })),
  coal: () => std('coal', { color: 0x111111, roughness: 0.6 }),
  carrot: () => std('carrot', { color: 0xff7a1a, roughness: 0.6 }),
  rust: () => std('rust', { map: TEX.rust(), roughness: 0.9, metalness: 0.3 }, 1.5),
  metalDark: () => std('metalDark', { color: 0x2b2e33, roughness: 0.5, metalness: 0.6 }),
  corr: (c) => std('corr' + c, { color: c, map: TEX.corrugated(), roughness: 0.6, metalness: 0.35 }, 1.2),
  paint: (c, r = 0.5, m = 0.1) => std(`paint${c}_${r}_${m}`, { color: c, roughness: r, metalness: m }),
  bore: () => std('bore', { color: 0x0b0b0b, roughness: 1 }),
  soil: () => std('soil', { color: 0x3b2a1c, roughness: 1 }),
  leaf: () => std('leaf', { color: 0x3f7a35, roughness: 0.9, flatShading: true }),
};

// ---------- geometry ----------
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 22),
  cylLo: new THREE.CylinderGeometry(1, 1, 1, 12),
  tri: new THREE.CylinderGeometry(1, 1, 1, 3).rotateY(PI / 2), // triangular prism, a corner points +x
  sph: new THREE.SphereGeometry(1, 18, 12),
  hemi: new THREE.SphereGeometry(1, 24, 10, 0, PI * 2, 0, PI / 2),
  tire: new THREE.TorusGeometry(0.7, 0.3, 8, 22).rotateX(PI / 2), // outer radius 1, height 0.6
  ring: new THREE.TorusGeometry(1, 0.05, 6, 32).rotateX(PI / 2),
  cone: new THREE.ConeGeometry(1, 1, 7),
  rock: new THREE.DodecahedronGeometry(1, 0),
  halfCyl: new THREE.CylinderGeometry(1, 1, 1, 14, 1, false, 0, PI),
};
const rbCache = {};
const rbox = (w, h, d, r) => rbCache[`${w}_${h}_${d}_${r}`] || (rbCache[`${w}_${h}_${d}_${r}`] = new RoundedBoxGeometry(w, h, d, 1, r));
let jerseyGeo = null;
function jersey() { // concrete road barrier: 0.6 wide, 0.8 tall, 1 long (along x)
  if (jerseyGeo) return jerseyGeo;
  const s = new THREE.Shape();
  [[-0.3, 0], [0.3, 0], [0.3, 0.08], [0.13, 0.25], [0.1, 0.8], [-0.1, 0.8], [-0.13, 0.25], [-0.3, 0.08]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5); g.rotateY(PI / 2);
  return (jerseyGeo = g);
}
let urnGeo = null;
function urn() {
  if (urnGeo) return urnGeo;
  const pts = [[0, 0], [0.32, 0], [0.42, 0.15], [0.5, 0.45], [0.46, 0.75], [0.3, 0.95], [0.26, 1.05], [0.33, 1.12], [0.3, 1.15], [0.22, 1.1]];
  return (urnGeo = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 20));
}

// Collects many small parts and merges them into one mesh per material (far fewer draw calls).
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
class Kit {
  constructor() { this.parts = new Map(); }
  add(material, geo, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.clearGroups();
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(g);
  }
  build(group) {
    for (const [material, geos] of this.parts) {
      const g = mergeGeometries(geos, false);
      geos.forEach((q) => q.dispose());
      if (material.userData.uvScale) projectUV(g, material.userData.uvScale);
      group.add(new THREE.Mesh(g, material));
    }
  }
}
// box-style UVs in metres so textures keep the same scale on every size of bunker
function projectUV(g, s) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, u / s, v / s);
  }
  uv.needsUpdate = true;
}
// lay out items along the longer side of a box footprint
function alongLong(K, fn) {
  const long = K.w >= K.d, L = long ? K.w : K.d, D = long ? K.d : K.w;
  fn({ L, D, long, at: (a, b) => (long ? [a, b] : [b, a]), ry: long ? 0 : PI / 2 });
}

// ---------- inflatable (classic + neon) ----------
function roundedPoly(pts, r) {
  const s = new THREE.Shape(), n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], c = pts[(i + 1) % n];
    const v1 = a.clone().sub(p).normalize().multiplyScalar(r).add(p);
    const v2 = c.clone().sub(p).normalize().multiplyScalar(r).add(p);
    if (i === 0) s.moveTo(v1.x, v1.y); else s.lineTo(v1.x, v1.y);
    s.quadraticCurveTo(p.x, p.y, v2.x, v2.y);
  }
  s.closePath();
  return s;
}
function smooth(geo) {
  geo.deleteAttribute('uv'); geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-4); geo.computeVertexNormals();
  return geo;
}
function puffy(shape, h, b) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, h - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 6, curveSegments: 10, steps: 1 });
  g.rotateX(-PI / 2); g.translate(0, b, 0);
  return smooth(g);
}
const rectPts = (w, d) => [new THREE.Vector2(-w / 2, -d / 2), new THREE.Vector2(w / 2, -d / 2), new THREE.Vector2(w / 2, d / 2), new THREE.Vector2(-w / 2, d / 2)];
const pBox = (w, d, h, b) => puffy(roundedPoly(rectPts(w - 2 * b, d - 2 * b), Math.min(0.12, (Math.min(w, d) - 2 * b) / 2.2)), h, b);
const pTri = (R, h, b) => puffy(roundedPoly([0, 1, 2].map((i) => new THREE.Vector2(Math.cos(i * PI * 2 / 3) * R, Math.sin(i * PI * 2 / 3) * R)), 0.18), h, b);
function pCan(r, h, b) {
  const pts = [new THREE.Vector2(0, 0)];
  for (let i = 0; i <= 8; i++) { const a = -PI / 2 + i / 8 * PI / 2; pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, b + Math.sin(a) * b)); }
  for (let i = 0; i <= 8; i++) { const a = i / 8 * PI / 2; pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, h - b + Math.sin(a) * b)); }
  pts.push(new THREE.Vector2(0, h));
  return new THREE.LatheGeometry(pts, 40);
}
function inflatable(palette, neon) {
  return (kind, K, kit, group, o) => {
    const [mainHex, accHex] = palette[kind];
    const main = neon
      ? mat('neonBody' + mainHex, () => new THREE.MeshPhysicalMaterial({ color: mainHex, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, emissive: accHex, emissiveIntensity: 0.06 }))
      : mat('nylon' + mainHex + o.high, () => (o.high
        ? new THREE.MeshPhysicalMaterial({ color: mainHex, roughness: 0.4, clearcoat: 0.45, clearcoatRoughness: 0.35 })
        : new THREE.MeshStandardMaterial({ color: mainHex, roughness: 0.45 })));
    const acc = neon
      ? mat('neonBand' + accHex, () => new THREE.MeshStandardMaterial({ color: accHex, emissive: accHex, emissiveIntensity: 2.4, roughness: 0.3 }))
      : mat('nylon' + accHex + o.high, () => (o.high
        ? new THREE.MeshPhysicalMaterial({ color: accHex, roughness: 0.4, clearcoat: 0.45, clearcoatRoughness: 0.35 })
        : new THREE.MeshStandardMaterial({ color: accHex, roughness: 0.45 })));
    const bodies = [];
    const add = (geo, m, y = 0) => { const mesh = new THREE.Mesh(geo, m); mesh.position.y = y; group.add(mesh); return mesh; };
    if (kind === 'snake') {
      const r = 0.44, len = K.w - 2 * r, n = Math.round(len / 1.5), step = len / n;
      for (let i = 0; i < n; i++) {
        const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, step - 0.3, 8, 20), main);
        seg.rotation.z = PI / 2; seg.position.set(-len / 2 + step * (i + 0.5), r, 0); seg.scale.set(1.04, 1, 1);
        group.add(seg); bodies.push(seg);
        if (i) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.93, neon ? 0.04 : 0.06, 10, 28), acc); ring.rotation.y = PI / 2; ring.position.set(-len / 2 + step * i, r, 0); group.add(ring); }
      }
    } else if (K.t === 'b') {
      const b = Math.min(0.2, Math.min(K.w, K.d) * 0.22);
      bodies.push(add(pBox(K.w, K.d, K.h, b), main));
      for (const f of (K.h > 1.5 ? [0.32, 0.68] : [0.5])) add(pBox(K.w + 0.04, K.d + 0.04, neon ? 0.1 : 0.2, 0.05), acc, K.h * f - (neon ? 0.05 : 0.1));
    } else if (K.t === 'c') {
      bodies.push(add(pCan(K.r, K.h, Math.min(0.2, K.r * 0.35)), main));
      for (const f of (K.h > 1.5 ? [0.33, 0.66] : [0.5])) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(K.r + 0.005, neon ? 0.035 : 0.05, 10, 40), acc);
        t.rotation.x = PI / 2; t.position.y = K.h * f; group.add(t);
      }
      if (neon) { const t = new THREE.Mesh(new THREE.TorusGeometry(K.r - 0.06, 0.03, 8, 40), acc); t.rotation.x = PI / 2; t.position.y = K.h - 0.01; group.add(t); }
    } else {
      bodies.push(add(pTri(K.R, K.h, 0.18), main));
      add(pTri(K.R + 0.03, neon ? 0.1 : 0.2, 0.05), acc, K.h * 0.55);
    }
    return bodies; // the inflatable bodies are accurate enough to use as colliders themselves
  };
}
const CLASSIC = {
  block: [0xf3f3f3, 0xff3b30], wall: [0xf3f3f3, 0xff3b30], longwall: [0x00c2a8, 0x0d3b66], tall: [0x00c2a8, 0x0d3b66],
  temple: [0x00c2a8, 0x0d3b66], container: [0xffcc00, 0x1b1b1b], snake: [0xffcc00, 0x1b1b1b], can: [0x1fb5ff, 0xffffff],
  bigcan: [0x7b2ff7, 0xffcc00], minican: [0x1fb5ff, 0xffffff], cake: [0xff2d6f, 0xffffff], tri: [0xff7a00, 0xffffff],
};
const NEON = {
  block: [0x14141c, 0x00f0ff], wall: [0x14141c, 0x00f0ff], longwall: [0x1a1030, 0xff2bd6], tall: [0x1a1030, 0xff2bd6],
  temple: [0x1a1030, 0xb04dff], container: [0x101820, 0x9dff00], snake: [0x101820, 0x9dff00], can: [0x14141c, 0xffe100],
  bigcan: [0x1a1030, 0xff2bd6], minican: [0x14141c, 0x00f0ff], cake: [0x101820, 0xff6a00], tri: [0x14141c, 0xff2bd6],
};

// ---------- composite helpers ----------
function tireStack(kit, x, z, r, h) {
  const n = Math.max(1, Math.round(h / 0.25)), th = h / n;
  for (let k = 0; k < n; k++) {
    const m = Math.random() < 0.14 ? MT.paintTire(pick([0xf2f2f2, 0xffcc00, 0xe0412f, 0x2f7dff])) : MT.rubber();
    kit.add(m, G.tire, x + rnd(-0.03, 0.03), th * (k + 0.5), z + rnd(-0.03, 0.03), r, th / 0.6, r, rnd(0, 6));
  }
}
function drum(kit, x, z, y0, r, h, m) {
  kit.add(m, G.cyl, x, y0 + h / 2, z, r, h, r);
  for (const f of [0.03, 0.33, 0.66, 0.97]) kit.add(MT.metalDark(), G.cylLo, x, y0 + h * f, z, r * 1.03, 0.025, r * 1.03);
}
function circlePack(R, rItem) { // centres for items of radius rItem inside a circle of radius R
  if (R < rItem * 1.6) return [[0, 0]];
  if (R < rItem * 2.6) return [0, 1, 2].map((i) => [Math.cos(i * 2.09) * (R - rItem), Math.sin(i * 2.09) * (R - rItem)]);
  const out = [[0, 0]], n = Math.max(6, Math.floor((2 * PI * (R - rItem)) / (rItem * 2.05)));
  for (let i = 0; i < n; i++) out.push([Math.cos(i * 2 * PI / n) * (R - rItem), Math.sin(i * 2 * PI / n) * (R - rItem)]);
  return out;
}
function brickWall(kit, K, m, unitL, unitH, unitD, geoFn, jitter = 0.04) {
  alongLong(K, ({ L, D, at, ry }) => {
    const layers = Math.max(1, Math.round(K.h / unitH)), lh = K.h / layers;
    const rows = Math.max(1, Math.round(D / unitD)), rd = D / rows;
    for (let k = 0; k < layers; k++) {
      const n = Math.max(1, Math.round(L / unitL)), ul = L / n, off = (k % 2) * ul * 0.5;
      for (let r = 0; r < rows; r++) for (let i = 0; i <= n; i++) {
        let a0 = -L / 2 + i * ul - off, a1 = a0 + ul;
        a0 = Math.max(a0, -L / 2); a1 = Math.min(a1, L / 2);
        if (a1 - a0 < 0.12) continue;
        const [x, z] = at((a0 + a1) / 2 + rnd(-jitter, jitter), -D / 2 + rd * (r + 0.5) + rnd(-jitter, jitter));
        kit.add(m, geoFn(a1 - a0 - 0.02, lh * 0.98, rd * 0.96), x, lh * (k + 0.5), z, 1, 1, 1, ry + rnd(-jitter, jitter));
      }
    }
  });
}
function crateStack(kit, K, mats) {
  const s = 0.9, nx = Math.max(1, Math.round(K.w / s)), nz = Math.max(1, Math.round(K.d / s)), ny = Math.max(1, Math.round(K.h / s));
  const cw = K.w / nx, cd = K.d / nz, ch = K.h / ny;
  for (let y = 0; y < ny; y++) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    kit.add(pick(mats), G.box, -K.w / 2 + cw * (i + 0.5) + rnd(-0.03, 0.03), ch * (y + 0.5), -K.d / 2 + cd * (j + 0.5) + rnd(-0.03, 0.03), cw * 0.97, ch * 0.98, cd * 0.97, rnd(-0.05, 0.05));
  }
}
function containerBox(kit, K, color) {
  kit.add(MT.corr(color), G.box, 0, K.h / 2, 0, K.w, K.h, K.d);
  const fr = MT.metalDark();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.add(fr, G.box, sx * (K.w / 2 - 0.05), K.h / 2, sz * (K.d / 2 - 0.05), 0.12, K.h + 0.02, 0.12);
  kit.add(fr, G.box, 0, K.h, 0, K.w, 0.08, K.d + 0.02); kit.add(fr, G.box, 0, 0.05, 0, K.w, 0.1, K.d + 0.02);
  for (const s of [-1, 1]) for (const f of [-0.25, 0.25]) kit.add(fr, G.box, K.w / 2 + 0.01, K.h / 2, f * K.d, 0.04, K.h * 0.9, 0.05); // door bars
}
function pallet(kit, x, y, z, w, d, ry) {
  const m = MT.planks(), dk = MT.darkwood();
  for (let i = 0; i < 5; i++) kit.add(m, G.box, x, y + 0.13, z + (i - 2) * d / 5, w, 0.025, d / 5 * 0.7, 0);
  for (const s of [-1, 0, 1]) kit.add(dk, G.box, x + s * (w / 2 - 0.06), y + 0.065, z, 0.1, 0.1, d, 0);
  for (const s of [-1, 1]) kit.add(m, G.box, x, y + 0.01, z + s * (d / 2 - 0.06), w, 0.02, 0.1, 0);
  void ry;
}

// ---------- the ten styles ----------
const STYLES = {
  inflatable: inflatable(CLASSIC, false),
  neon: inflatable(NEON, true),

  wood(kind, K, kit) {
    const P = MT.planks(), D = MT.darkwood(), B = MT.bark(), E = MT.rings();
    if (kind === 'snake') { // fallen log
      const L = K.w - 0.3;
      kit.add(B, G.cyl, 0, 0.45, 0, 0.45, L, 0.45, 0, 0, PI / 2);
      for (const s of [-1, 1]) kit.add(E, G.cyl, s * L / 2, 0.45, 0, 0.44, 0.02, 0.44, 0, 0, PI / 2);
      for (let i = 0; i < 4; i++) kit.add(B, G.cylLo, rnd(-L / 2.5, L / 2.5), 0.75, rnd(-0.1, 0.1), 0.07, 0.5, 0.07, rnd(0, 6), rnd(-0.6, 0.6), rnd(-0.6, 0.6));
    } else if (K.t === 'b') { // plank walls with posts and a top rail
      kit.add(P, G.box, 0, K.h / 2, 0, K.w, K.h, K.d);
      alongLong(K, ({ L, D: dd, at }) => {
        const n = Math.max(1, Math.round(L / 1.3));
        for (let i = 0; i <= n; i++) for (const s of [-1, 1]) {
          const [x, z] = at(-L / 2 + L * i / n, s * (dd / 2 + 0.05));
          kit.add(D, G.box, x, (K.h + 0.15) / 2, z, 0.14, K.h + 0.15, 0.14);
        }
      });
      kit.add(D, G.box, 0, K.h + 0.05, 0, K.w + 0.1, 0.1, K.d + 0.1);
    } else if (kind === 'cake') { // cable spool
      kit.add(P, G.cyl, 0, 0.05, 0, K.r, 0.1, K.r); kit.add(P, G.cyl, 0, K.h - 0.05, 0, K.r, 0.1, K.r);
      kit.add(D, G.cyl, 0, K.h / 2, 0, K.r * 0.55, K.h - 0.2, K.r * 0.55);
      for (let i = 0; i < 8; i++) kit.add(MT.metalDark(), G.cylLo, Math.cos(i * PI / 4) * K.r * 0.8, K.h + 0.01, Math.sin(i * PI / 4) * K.r * 0.8, 0.04, 0.03, 0.04);
    } else if (K.t === 'c') { // standing log / stump
      kit.add(B, G.cyl, 0, K.h / 2, 0, K.r, K.h, K.r);
      kit.add(E, G.cyl, 0, K.h + 0.01, 0, K.r * 0.96, 0.02, K.r * 0.96);
      kit.add(B, G.cyl, 0, 0.12, 0, K.r * 1.18, 0.24, K.r * 1.18);
    } else { // A-frame of planks
      kit.add(P, G.tri, 0, K.h / 2, 0, K.R, K.h, K.R);
      for (let i = 0; i < 3; i++) kit.add(D, G.box, Math.cos(i * 2.094) * K.R * 0.92, K.h / 2 + 0.05, -Math.sin(i * 2.094) * K.R * 0.92, 0.14, K.h + 0.1, 0.14);
    }
  },

  urban(kind, K, kit) {
    const C = MT.concrete();
    if (kind === 'container') containerBox(kit, K, pick([0xb83a2e, 0x1f5fa8, 0xd9822b, 0x2e7d4f, 0x6b6f76]));
    else if (kind === 'temple') { // dumpster
      kit.add(MT.paint(0x2f5d3a, 0.55, 0.3), G.box, 0, K.h * 0.47, 0, K.w, K.h * 0.9, K.d);
      kit.add(MT.paint(0x1e3d26, 0.5, 0.2), G.box, 0, K.h * 0.95, -0.05, K.w + 0.06, 0.06, K.d + 0.06, 0, 0.06);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.add(MT.rubber(), G.cylLo, sx * K.w * 0.35, 0.08, sz * K.d * 0.4, 0.08, 0.06, 0.08, 0, 0, PI / 2);
    } else if (kind === 'longwall') {
      kit.add(C, G.box, 0, K.h / 2, 0, K.w, K.h, K.d);
      kit.add(C, G.box, 0, K.h + 0.04, 0, K.w + 0.1, 0.08, K.d + 0.1);
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) kit.add(MT.paint(pick([0xff3d7f, 0x2bd4ff, 0xffd23f, 0x7dff4a, 0xa66bff]), 0.6), G.box,
        rnd(-K.w / 2.6, K.w / 2.6), rnd(0.4, K.h - 0.3), s * (K.d / 2 + 0.005), rnd(0.4, 1.4), rnd(0.12, 0.35), 0.01);
    } else if (kind === 'tall') { // stacked concrete blocks
      const n = 3, hh = K.h / n;
      for (let i = 0; i < n; i++) kit.add(C, G.box, rnd(-0.05, 0.05), hh * (i + 0.5), rnd(-0.05, 0.05), K.w * (1 - i * 0.05), hh * 0.97, K.d * (1 - i * 0.05), rnd(-0.12, 0.12));
    } else if (K.t === 'b') { // jersey barriers
      alongLong(K, ({ L, D, at, ry }) => {
        const segs = Math.max(1, Math.round(L / 2.2)), sl = L / segs, rows = Math.max(1, Math.round(D / 0.62)), rd = D / rows;
        for (let r = 0; r < rows; r++) for (let i = 0; i < segs; i++) {
          const [x, z] = at(-L / 2 + sl * (i + 0.5), -D / 2 + rd * (r + 0.5));
          kit.add(C, jersey(), x, 0, z, sl - 0.06, K.h / 0.8, rd / 0.6, ry + rnd(-0.03, 0.03));
        }
      });
    } else if (kind === 'minican') { // traffic drum
      kit.add(MT.paint(0xff6a13, 0.5), G.cyl, 0, K.h / 2, 0, K.r, K.h, K.r);
      for (const f of [0.3, 0.6, 0.85]) kit.add(MT.paint(0xf5f5f5, 0.4), G.cyl, 0, K.h * f, 0, K.r * 1.01, 0.1, K.r * 1.01);
      kit.add(MT.rubber(), G.cyl, 0, 0.04, 0, K.r * 1.2, 0.08, K.r * 1.2);
    } else if (kind === 'cake') { // planter
      kit.add(C, G.cyl, 0, K.h * 0.4, 0, K.r, K.h * 0.8, K.r);
      kit.add(MT.soil(), G.cyl, 0, K.h * 0.8 + 0.005, 0, K.r * 0.9, 0.01, K.r * 0.9);
      for (let i = 0; i < 7; i++) kit.add(MT.leaf(), G.sph, rnd(-0.9, 0.9), K.h * 0.85 + 0.1, rnd(-0.9, 0.9), rnd(0.3, 0.5), rnd(0.25, 0.4), rnd(0.3, 0.5));
    } else if (K.t === 'c') { // concrete pipes standing on end
      const n = kind === 'bigcan' ? 2 : 1, hh = K.h / n;
      for (let i = 0; i < n; i++) kit.add(C, G.cyl, 0, hh * (i + 0.5), 0, K.r * (1 - i * 0.06), hh * 0.98, K.r * (1 - i * 0.06));
      kit.add(MT.bore(), G.cyl, 0, K.h + 0.005, 0, K.r * 0.78, 0.01, K.r * 0.78);
    } else kit.add(C, G.tri, 0, K.h / 2, 0, K.R, K.h, K.R);
  },

  tires(kind, K, kit) {
    if (K.t === 'b') {
      const nx = Math.max(1, Math.round(K.w / 0.95)), nz = Math.max(1, Math.round(K.d / 0.95));
      const r = Math.min(K.w / nx, K.d / nz) / 2;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) tireStack(kit, -K.w / 2 + (K.w / nx) * (i + 0.5), -K.d / 2 + (K.d / nz) * (j + 0.5), r, K.h);
    } else if (kind === 'cake') { // tractor tire with a stack inside
      kit.add(MT.rubber(), G.tire, 0, 0.36, 0, K.r, 1.2, K.r);
      tireStack(kit, 0, 0, 0.6, K.h);
    } else if (K.t === 'c') tireStack(kit, 0, 0, K.r, K.h);
    else for (let i = 0; i < 3; i++) tireStack(kit, Math.cos(i * 2.094) * K.R * 0.5, -Math.sin(i * 2.094) * K.R * 0.5, 0.46, K.h * (i ? 0.85 : 1));
  },

  hay(kind, K, kit) {
    const H = MT.hay(), E = MT.hayEnd(), T = MT.twine();
    if (K.t === 'b') {
      brickWall(kit, K, H, 1.0, 0.48, 0.45, (l, h, d) => rbox(+l.toFixed(2), +h.toFixed(2), +d.toFixed(2), 0.05), 0.05);
    } else if (kind === 'cake') {
      kit.add(H, G.cyl, 0, K.h / 2, 0, K.r, K.h, K.r); kit.add(E, G.cyl, 0, K.h + 0.005, 0, K.r * 0.98, 0.01, K.r * 0.98);
      for (const f of [0.3, 0.7]) kit.add(T, G.ring, 0, K.h * f, 0, K.r * 1.01, 1, K.r * 1.01);
    } else if (K.t === 'c') { // round bales stacked on end
      const n = Math.max(1, Math.round(K.h / 0.95)), hh = K.h / n;
      for (let i = 0; i < n; i++) {
        kit.add(H, G.cyl, rnd(-0.03, 0.03), hh * (i + 0.5), rnd(-0.03, 0.03), K.r, hh * 0.98, K.r, rnd(0, 6));
        kit.add(E, G.cyl, 0, hh * (i + 1) - 0.005, 0, K.r * 0.97, 0.012, K.r * 0.97);
        kit.add(T, G.ring, 0, hh * (i + 0.5), 0, K.r * 1.01, 1, K.r * 1.01);
      }
    } else { // bale pyramid
      for (let i = 0; i < 3; i++) {
        const a = i * 2.094;
        kit.add(H, rbox(1.0, 0.5, 0.45, 0.05), Math.cos(a) * 0.45, 0.25, -Math.sin(a) * 0.45, 1, 1, 1, a + PI / 2);
      }
      kit.add(H, rbox(1.0, 0.5, 0.45, 0.05), 0, 0.75, 0, 1, 1, 1, rnd(0, 3));
      kit.add(H, rbox(0.8, 0.45, 0.45, 0.05), 0, 1.1, 0, 1, 0.9, 1, rnd(0, 3));
    }
  },

  military(kind, K, kit) {
    const bag = MT.canvasBag();
    if (['tall', 'temple', 'container'].includes(kind)) crateStack(kit, K, [MT.crate(), MT.odGreen()]);
    else if (K.t === 'b') brickWall(kit, K, bag, 0.5, 0.17, 0.32, (l, h, d) => rbox(+l.toFixed(2), +h.toFixed(2), +d.toFixed(2), 0.06), 0.03);
    else if (kind === 'cake') { // sandbag ring
      const layers = Math.round(K.h / 0.17), lh = K.h / layers, R = K.r - 0.18, n = Math.floor((2 * PI * R) / 0.48);
      for (let k = 0; k < layers; k++) for (let i = 0; i < n; i++) {
        const a = (i + (k % 2) * 0.5) * 2 * PI / n;
        kit.add(bag, rbox(0.5, 0.17, 0.32, 0.06), Math.cos(a) * R, lh * (k + 0.5), Math.sin(a) * R, 1, lh / 0.17, 1, -a + PI / 2 + rnd(-0.05, 0.05));
      }
      kit.add(MT.soil(), G.cyl, 0, K.h * 0.6, 0, R - 0.1, 0.02, R - 0.1);
    } else if (K.t === 'c') { // oil drums
      const r = K.r < 0.7 ? K.r * 0.92 : K.r < 1 ? K.r * 0.47 : 0.42;
      const levels = Math.max(1, Math.round(K.h / 0.95)), lh = K.h / levels;
      for (const [x, z] of circlePack(K.r, r)) for (let l = 0; l < levels; l++) drum(kit, x, z, lh * l, r, lh * 0.98, pick([MT.odGreen(), MT.rust(), MT.paint(0x2b4c7e, 0.5, 0.4)]));
    } else { // crate pyramid
      for (let i = 0; i < 3; i++) { const a = i * 2.094; kit.add(MT.crate(), G.box, Math.cos(a) * 0.45, 0.35, -Math.sin(a) * 0.45, 0.7, 0.7, 0.7, rnd(0, 3)); }
      kit.add(MT.odGreen(), G.box, 0, 1.0, 0, 0.6, 0.6, 0.6, rnd(0, 3));
    }
  },

  desert(kind, K, kit) {
    const A = MT.adobe(), S = MT.stone();
    if (K.t === 'b' && kind !== 'tall') { // adobe wall with a broken, uneven top
      kit.add(A, G.box, 0, K.h / 2, 0, K.w, K.h, K.d);
      alongLong(K, ({ L, D, at, ry }) => {
        for (let a = -L / 2 + 0.25; a < L / 2 - 0.1; a += 0.5) {
          if (Math.random() < 0.3) continue;
          const [x, z] = at(a, 0), hh = rnd(0.08, 0.3);
          kit.add(A, G.box, x, K.h + hh / 2, z, 0.42, hh, D * 0.96, ry);
        }
        for (let i = 0; i < 3; i++) { const [x, z] = at(rnd(-L / 2, L / 2), (Math.random() < 0.5 ? -1 : 1) * (D / 2 + 0.15)); kit.add(A, G.box, x, 0.08, z, rnd(0.15, 0.3), rnd(0.1, 0.2), rnd(0.15, 0.3), rnd(0, 3)); }
      });
    } else if (kind === 'tall') { // stacked sandstone blocks
      for (let i = 0; i < 3; i++) kit.add(S, G.box, rnd(-0.06, 0.06), K.h / 3 * (i + 0.5), rnd(-0.06, 0.06), K.w * (1 - i * 0.04), K.h / 3 * 0.97, K.d * (1 - i * 0.04), rnd(-0.15, 0.15));
    } else if (kind === 'minican') { // clay urn
      kit.add(MT.terracotta(), urn(), 0, 0, 0, K.r / 0.5, K.h / 1.15, K.r / 0.5);
    } else if (kind === 'cake') { // ruined round tower
      kit.add(A, G.cyl, 0, K.h / 2, 0, K.r, K.h, K.r);
      for (let i = 0; i < 10; i++) { if (Math.random() < 0.3) continue; const a = i * PI / 5; kit.add(A, G.box, Math.cos(a) * (K.r - 0.2), K.h + 0.15, Math.sin(a) * (K.r - 0.2), 0.45, 0.3, 0.35, -a); }
    } else if (K.t === 'c') { // stone column
      kit.add(S, G.cyl, 0, 0.12, 0, K.r * 1.15, 0.24, K.r * 1.15);
      kit.add(S, G.cyl, 0, K.h / 2, 0, K.r * 0.88, K.h - 0.4, K.r * 0.88);
      kit.add(S, G.cyl, 0, K.h - 0.12, 0, K.r * 1.1, 0.24, K.r * 1.1);
    } else { // boulder
      kit.add(S, G.rock, 0, K.h * 0.5, 0, K.R * 0.85, K.h * 0.62, K.R * 0.85, rnd(0, 6), rnd(-0.3, 0.3));
      for (let i = 0; i < 3; i++) kit.add(S, G.rock, rnd(-1, 1), 0.12, rnd(-1, 1), rnd(0.15, 0.3), rnd(0.12, 0.2), rnd(0.15, 0.3), rnd(0, 6));
    }
  },

  snow(kind, K, kit) {
    const SN = MT.snow(), IC = MT.ice();
    if (kind === 'snake') kit.add(SN, G.sph, 0, 0.3, 0, K.w / 2, 0.6, K.d / 2 + 0.12); // snowbank
    else if (['tall', 'container', 'temple'].includes(kind)) { // ice blocks
      const s = 0.9, nx = Math.max(1, Math.round(K.w / s)), nz = Math.max(1, Math.round(K.d / s)), ny = Math.max(1, Math.round(K.h / s));
      for (let y = 0; y < ny; y++) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++)
        kit.add(IC, rbox(+(K.w / nx * 0.97).toFixed(2), +(K.h / ny * 0.97).toFixed(2), +(K.d / nz * 0.97).toFixed(2), 0.06), -K.w / 2 + (K.w / nx) * (i + 0.5), (K.h / ny) * (y + 0.5), -K.d / 2 + (K.d / nz) * (j + 0.5));
      kit.add(SN, G.box, 0, K.h + 0.04, 0, K.w * 0.98, 0.08, K.d * 0.98);
    } else if (K.t === 'b') brickWall(kit, K, SN, 0.6, 0.3, 0.35, (l, h, d) => rbox(+l.toFixed(2), +h.toFixed(2), +d.toFixed(2), 0.07), 0.03);
    else if (kind === 'cake') { // igloo
      kit.add(SN, G.hemi, 0, 0, 0, K.r, K.h, K.r);
      kit.add(SN, G.halfCyl, K.r + 0.15, 0, 0, 0.45, 0.8, 0.45, 0, 0, PI / 2);
      kit.add(MT.bore(), G.cylLo, K.r + 0.56, 0.2, 0, 0.32, 0.01, 0.32, 0, 0, PI / 2);
    } else if (kind === 'minican') kit.add(SN, G.hemi, 0, 0, 0, K.r, K.h, K.r); // snow mound
    else if (K.t === 'c') { // snowman
      const s = K.h / 1.9;
      kit.add(SN, G.sph, 0, 0.55 * s, 0, K.r, 0.6 * s, K.r);
      kit.add(SN, G.sph, 0, 1.25 * s, 0, K.r * 0.72, 0.42 * s, K.r * 0.72);
      kit.add(SN, G.sph, 0, 1.75 * s, 0, K.r * 0.48, 0.28 * s, K.r * 0.48);
      kit.add(MT.carrot(), G.cone, K.r * 0.62, 1.75 * s, 0, 0.05, 0.3, 0.05, 0, 0, -PI / 2);
      for (const z of [-0.1, 0.1]) kit.add(MT.coal(), G.sph, K.r * 0.42, 1.85 * s, z * s, 0.035, 0.035, 0.035);
      for (const y of [1.1, 1.3]) kit.add(MT.coal(), G.sph, K.r * 0.7, y * s, 0, 0.04, 0.04, 0.04);
      for (const z of [-1, 1]) kit.add(MT.darkwood(), G.cylLo, 0, 1.35 * s, z * K.r * 0.95, 0.025, 0.7, 0.025, 0, z * 0.9, 0);
    } else { // ice shards
      for (let i = 0; i < 4; i++) {
        const a = i * 1.57 + rnd(-0.3, 0.3), d = i ? K.R * 0.45 : 0;
        kit.add(IC, G.cone, Math.cos(a) * d, (i ? K.h * 0.7 : K.h) / 2, Math.sin(a) * d, rnd(0.25, 0.4), i ? K.h * 0.7 : K.h, rnd(0.25, 0.4), rnd(0, 6), rnd(-0.12, 0.12), rnd(-0.12, 0.12));
      }
    }
  },

  junk(kind, K, kit) {
    if (kind === 'container') containerBox(kit, K, 0x8a4b2a);
    else if (kind === 'snake') { // culvert pipe
      kit.add(MT.rust(), G.cyl, 0, 0.44, 0, 0.44, K.w - 0.2, 0.44, 0, 0, PI / 2);
      for (const s of [-1, 1]) kit.add(MT.bore(), G.cyl, s * (K.w / 2 - 0.09), 0.44, 0, 0.36, 0.01, 0.36, 0, 0, PI / 2);
      for (let i = 1; i < 6; i++) kit.add(MT.metalDark(), G.cylLo, -K.w / 2 + 0.1 + (K.w - 0.2) * i / 6, 0.44, 0, 0.455, 0.06, 0.455, 0, 0, PI / 2);
    } else if (['tall', 'temple'].includes(kind)) crateStack(kit, K, [MT.crate()]);
    else if (K.t === 'b') { // pallet stacks
      alongLong(K, ({ L, D, at, ry }) => {
        const n = Math.max(1, Math.round(L / 1.2)), layers = Math.max(1, Math.round(K.h / 0.15)), lh = K.h / layers;
        for (let i = 0; i < n; i++) for (let k = 0; k < layers; k++) {
          const [x, z] = at(-L / 2 + (L / n) * (i + 0.5) + rnd(-0.04, 0.04), rnd(-0.04, 0.04));
          const [w, d] = ry ? [D, L / n - 0.05] : [L / n - 0.05, D];
          pallet(kit, x, lh * k, z, w, d);
        }
      });
    } else if (kind === 'cake') { // cable spool lying flat
      kit.add(MT.planks(), G.cyl, 0, 0.06, 0, K.r, 0.12, K.r); kit.add(MT.planks(), G.cyl, 0, K.h - 0.06, 0, K.r, 0.12, K.r);
      kit.add(MT.paint(0x222222, 0.6), G.cyl, 0, K.h / 2, 0, K.r * 0.62, K.h - 0.24, K.r * 0.62);
    } else if (kind === 'bigcan') { // rusty tank
      kit.add(MT.rust(), G.cyl, 0, K.h / 2, 0, K.r, K.h, K.r);
      for (const f of [0.25, 0.5, 0.75]) kit.add(MT.metalDark(), G.cylLo, 0, K.h * f, 0, K.r * 1.02, 0.05, K.r * 1.02);
      kit.add(MT.rust(), G.hemi, 0, K.h, 0, K.r, 0.25, K.r);
    } else if (K.t === 'c') { // barrel stack
      const levels = Math.max(1, Math.round(K.h / 0.95)), lh = K.h / levels;
      for (let l = 0; l < levels; l++) drum(kit, rnd(-0.03, 0.03), rnd(-0.03, 0.03), lh * l, K.r * 0.95, lh * 0.98, pick([MT.rust(), MT.paint(0x2b4c7e, 0.5, 0.4), MT.paint(0xc7a12a, 0.5, 0.3)]));
    } else { // scrap heap
      for (let i = 0; i < 9; i++) {
        const a = rnd(0, 6.28), d = rnd(0, K.R * 0.6), s = rnd(0.25, 0.6);
        kit.add(pick([MT.rust(), MT.metalDark(), MT.paint(0x9a2d22, 0.6, 0.4)]), pick([G.box, G.cylLo]), Math.cos(a) * d, rnd(0.2, K.h * 0.75), Math.sin(a) * d, s, s * rnd(0.5, 1.3), s, rnd(0, 6), rnd(-0.6, 0.6), rnd(-0.6, 0.6));
      }
      kit.add(MT.rust(), G.cone, 0, K.h * 0.45, 0, K.R * 0.75, K.h * 0.9, K.R * 0.75, rnd(0, 6));
    }
  },
};

/** Build one bunker into `group`. Returns meshes to use as colliders, or null (caller adds simple proxies). */
export function buildBunker(style, kind, group, o) {
  const K = KINDS[kind], kit = new Kit();
  const res = STYLES[style](kind, K, kit, group, o);
  kit.build(group);
  return Array.isArray(res) ? res : null;
}

// ---------- themes ----------
const T = {
  day: { ground: 'grass', field: '#3d8a3a', line: 'rgba(255,255,255,.9)', apron: '#336f31', outer: '#4a7a37', path: 0x9a8f7a,
    sky: ['#2f73d0', '#dcecf7'], fog: ['#bcd6ea', 90, 260], hemi: [0xdcecff, 0x4f6b3a, 1.0], sun: [0xfff0d8, 2.7, [-35, 50, 25]],
    trees: 'green', hills: 0x47703a, exposure: 1.0 },
  night: { ground: 'grass', field: '#1a3322', line: 'rgba(125,249,255,.95)', apron: '#13261a', outer: '#0f1f14', path: 0x3a3a48,
    sky: ['#03040c', '#221a4a'], fog: ['#16123a', 45, 170], hemi: [0x7a84ff, 0x141420, 0.6], sun: [0xaab8ff, 1.0, [30, 60, -20]],
    trees: 'night', hills: 0x0f1d14, exposure: 1.15, glow: 0.5 },
  woods: { ground: 'forest', field: '#4a6b30', line: 'rgba(255,255,255,.75)', apron: '#3d5a2a', outer: '#2f4f24', path: 0x6b5a40,
    sky: ['#5b8fc7', '#d8e6d0'], fog: ['#a9bfa6', 50, 200], hemi: [0xd8f0d0, 0x3a4a20, 1.0], sun: [0xffe8c0, 2.3, [-20, 45, 30]],
    trees: 'dense', hills: 0x355a2a, exposure: 1.0 },
  urban: { ground: 'asphalt', field: '#45484d', line: 'rgba(242,201,76,.95)', apron: '#3a3c40', outer: '#5b5e62', path: 0x777777,
    sky: ['#7d8fa3', '#d8dde2'], fog: ['#c3cad1', 60, 200], hemi: [0xe0e6ee, 0x55585c, 1.25], sun: [0xffffff, 1.7, [-25, 50, 15]],
    trees: 'sparse', hills: 0x5f6a5c, exposure: 1.0 },
  tires: { ground: 'dirt', field: '#7a5a3a', line: 'rgba(255,255,255,.85)', apron: '#6a4e33', outer: '#5f6b3a', path: 0x8a7a60,
    sky: ['#3a7fd0', '#e3ecf2'], fog: ['#c9d3d8', 80, 240], hemi: [0xe0ecff, 0x5a4a30, 1.0], sun: [0xfff0d8, 2.6, [-35, 50, 25]],
    trees: 'green', hills: 0x56703a, exposure: 1.0 },
  harvest: { ground: 'stubble', field: '#b89a4a', line: 'rgba(255,255,255,.85)', apron: '#9c8240', outer: '#8a9a48', path: 0x9a8560,
    sky: ['#4a7fc0', '#ffd9a0'], fog: ['#f0d6a8', 70, 230], hemi: [0xffe6c0, 0x6b5a30, 1.0], sun: [0xffc27a, 2.8, [-55, 20, 12]],
    trees: 'autumn', hills: 0x8a8a40, exposure: 1.0 },
  outpost: { ground: 'dirt', field: '#6b6a45', line: 'rgba(255,255,255,.8)', apron: '#5a5a3a', outer: '#6f6a48', path: 0x8a8060,
    sky: ['#7d9cc0', '#e3dcc8'], fog: ['#d6cfb8', 60, 210], hemi: [0xf0ecd8, 0x5a5636, 1.0], sun: [0xfff2d8, 2.6, [-30, 50, 20]],
    trees: 'dry', hills: 0x6b6a45, exposure: 1.0 },
  dunes: { ground: 'sand', field: '#d8b77a', line: 'rgba(255,255,255,.9)', apron: '#cfae72', outer: '#d9bb82', path: 0xc4a46c,
    sky: ['#3a7fd6', '#f6e2bf'], fog: ['#f0dcb4', 80, 260], hemi: [0xfff0d8, 0xb08a50, 1.05], sun: [0xfff0d0, 3.0, [-30, 60, 20]],
    trees: 'none', hills: 0xd2b07a, exposure: 0.95 },
  frost: { ground: 'snow', field: '#eef3f8', line: 'rgba(47,125,255,.9)', apron: '#e6edf4', outer: '#f2f6fa', path: 0xc8d4e0,
    sky: ['#7fa6cf', '#e8eef5'], fog: ['#dfe8f0', 40, 180], hemi: [0xeaf2ff, 0xb8c4d0, 0.9], sun: [0xf4f8ff, 2.0, [-30, 40, 25]],
    trees: 'snow', hills: 0xe8eef4, exposure: 0.9 },
  dusk: { ground: 'gravel', field: '#6e6a62', line: 'rgba(255,255,255,.8)', apron: '#5f5b54', outer: '#57603f', path: 0x6a645a,
    sky: ['#3b3f6b', '#f0a46b'], fog: ['#c9937a', 50, 190], hemi: [0xffd2b0, 0x3b3a40, 0.95], sun: [0xff9a5a, 2.3, [-50, 18, -10]],
    trees: 'dead', hills: 0x4d4a3c, exposure: 1.0 },
};

// ---------- layouts ----------
// [kind, x, z, rotation]. Pieces with x < 0 are mirrored onto the red half; x = 0 pieces sit on the centre line.
export const MAPS = [
  { id: 'center', name: 'Center Stage', style: 'inflatable', theme: T.day, desc: 'Classic tournament inflatables in the sun.',
    layout: [['block', -21, 0], ['can', -17.5, -5], ['can', -17.5, 5], ['temple', -13.5, 2.6], ['tall', -10, -5.5, 0.35], ['minican', -8, 3],
      ['wall', -6, -2, 0.3], ['bigcan', -4.5, 6.5], ['tri', -12.5, 10.5, 0.4], ['tri', -7, 12.6, -0.3], ['tri', -19, 10.5, 1], ['wall', -18.5, -11],
      ['snake', -9, -13], ['cake', 0, 0], ['tri', 0, 11.3, PI / 2], ['temple', 0, -8.5, PI / 2]] },
  { id: 'neon', name: 'Neon Nights', style: 'neon', theme: T.night, desc: 'Glowing inflatables under the night sky.',
    layout: [['block', -21, 0], ['tall', -16, -7], ['tall', -16, 7], ['can', -13, 0], ['wall', -11, -4, 0.6], ['wall', -11, 4, -0.6],
      ['minican', -8, -9], ['minican', -8, 9], ['temple', -6, 0], ['tri', -4, -12, 0.5], ['tri', -4, 12, -0.5], ['tri', -19, -12, 0.8],
      ['bigcan', 0, -5], ['bigcan', 0, 5], ['cake', 0, 12.6], ['cake', 0, -12.6]] },
  { id: 'timber', name: 'Timberline', style: 'wood', theme: T.woods, desc: 'Woodsball: plank walls, logs and stumps.',
    layout: [['block', -21, 0], ['can', -18, -8], ['can', -18, 7], ['longwall', -15, -2, PI / 2 + 0.2], ['tall', -13, 9], ['minican', -12, -11],
      ['block', -10, 3, 1.2], ['can', -9, -6], ['wall', -6, 10, 0.4], ['tri', -5, -2], ['can', -3.5, -12], ['snake', -12, 13.6],
      ['cake', 0, 0], ['tall', 0, 8, 0.78], ['tall', 0, -8, 0.78]] },
  { id: 'downtown', name: 'Downtown', style: 'urban', theme: T.urban, desc: 'Concrete barriers, containers and dumpsters.',
    layout: [['block', -21, 0], ['container', -15, -9], ['container', -15, 9], ['wall', -17.5, 0, PI / 2], ['temple', -11, -3, 0.2], ['temple', -11, 4, -0.3],
      ['tall', -7, -10], ['tall', -7, 10], ['wall', -6, 0, PI / 2], ['minican', -4, -5], ['minican', -4, 5], ['longwall', -9, -14],
      ['container', 0, 0, PI / 2], ['wall', 0, -11], ['wall', 0, 11], ['cake', -19, -12.5]] },
  { id: 'tireyard', name: 'Tire Yard', style: 'tires', theme: T.tires, desc: 'Every bunker is a stack of old tires.',
    layout: [['block', -21, 0], ['can', -18, -4], ['can', -18, 4], ['can', -15, -10], ['can', -15, 10], ['wall', -13, 0, PI / 2],
      ['minican', -11, -6], ['minican', -11, 6], ['tall', -8, -12], ['tall', -8, 12], ['wall', -7, -2, 0.8], ['wall', -7, 3, -0.8],
      ['tri', -4, -7], ['cake', 0, 0], ['minican', 0, -9], ['minican', 0, 9]] },
  { id: 'harvest', name: 'Harvest', style: 'hay', theme: T.harvest, desc: 'Hay bales on a farm field at golden hour.',
    layout: [['block', -21, 0], ['snake', -12, 13.4], ['can', -17, -5], ['can', -17, 5], ['temple', -13, -1], ['wall', -10, -9, 0.3],
      ['wall', -10, 8, -0.3], ['bigcan', -6, 0], ['minican', -7, -4.5], ['minican', -7, 4.5], ['tri', -18, -11], ['longwall', -4, -12],
      ['cake', 0, -6], ['cake', 0, 6], ['wall', 0, 0, PI / 2]] },
  { id: 'outpost', name: 'Outpost', style: 'military', theme: T.outpost, desc: 'Sandbags, oil drums and ammo crates.',
    layout: [['block', -21, 0], ['longwall', -17, -6, PI / 2], ['longwall', -17, 6, PI / 2], ['can', -14, 0], ['tall', -12, -10], ['tall', -12, 10],
      ['wall', -9, -4], ['wall', -9, 4], ['minican', -6, -12], ['minican', -6, 12], ['cake', -5, 0], ['tri', -19, -12],
      ['temple', 0, -6, 0.78], ['temple', 0, 6, -0.78], ['snake', -10, -14]] },
  { id: 'dunes', name: 'Dune Ruins', style: 'desert', theme: T.dunes, desc: 'Crumbling adobe walls, columns and boulders.',
    layout: [['block', -21, 0], ['tri', -18, -9], ['tri', -18, 9, 1], ['longwall', -14, -4, 0.4], ['longwall', -14, 5, -0.3], ['can', -11, 0],
      ['can', -10, -11], ['can', -10, 11], ['wall', -6, -7, PI / 2], ['wall', -6, 7, PI / 2], ['tri', -4, 0, 0.3], ['minican', -15, 12.5],
      ['minican', -15, -13], ['cake', 0, -10], ['cake', 0, 10], ['tall', 0, 0, 0.78]] },
  { id: 'frost', name: 'Frostbite', style: 'snow', theme: T.frost, desc: 'Snow walls, ice blocks, snowmen and an igloo.',
    layout: [['block', -21, 0], ['snake', -10, -13.4], ['snake', -10, 13.4], ['can', -17, -4], ['can', -17, 5], ['cake', -12, 0],
      ['tall', -8, -7], ['tall', -8, 7], ['wall', -15, -9, 0.5], ['wall', -15, 9, -0.5], ['tri', -5, -3], ['tri', -5, 3, 1],
      ['tall', 0, 0, 0.78], ['minican', 0, -9], ['minican', 0, 9]] },
  { id: 'scrap', name: 'Scrapyard', style: 'junk', theme: T.dusk, desc: 'Pallets, rusty containers and pipes at dusk.',
    layout: [['block', -21, 0], ['container', -16, -10], ['can', -17, 4], ['minican', -15, 7.5], ['tall', -13, -3], ['snake', -10, 12.6],
      ['cake', -9, 4], ['wall', -8, -6, 0.5], ['minican', -6, -12], ['tall', -5, 0, 0.4], ['bigcan', -19, 11], ['tri', -11, -12.5],
      ['container', 0, -1, PI / 2], ['cake', 0, 9]] },
];
export const mapById = (id) => MAPS.find((m) => m.id === id) || MAPS[0];
