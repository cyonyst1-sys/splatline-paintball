// Scene, scenery, map loading (bunkers, castle, theme), collision with multiple levels,
// bot pathfinding, paint decals.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { KINDS, buildBunker, mapById, castlePlan, buildCastlePart } from './maps.js';

// Field sizes change per map, so these objects are updated in place by loadMap.
export const FIELD = { hw: 25, hd: 15 };     // playing field half-size (metres)
export const BOUND = { hw: 26.3, hd: 16.3 }; // where players can walk
export const NETB = { hw: 27.5, hd: 17.5 };  // netting
export const TEAMS = [
  { name: 'BLUE', css: '#2f7dff', paintCss: '#1ec8ff', color: 0x2f7dff, paint: 0x1ec8ff, names: ['Ace', 'Jet', 'Moss', 'Dash', 'Nova', 'Bolt'] },
  { name: 'RED', css: '#ff4058', paintCss: '#ff2d8a', color: 0xff4058, paint: 0xff2d8a, names: ['Viper', 'Rook', 'Blaze', 'Fang', 'Hex', 'Grit'] },
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- collision (x/z plane, with height ranges) ----------
// shape: { t:'c'|'b'|'r', x, z, rot, r | hw,hd, y0, y1 } ; ramps ('r') also have h0,h1 (height along local x)
// surfaces: walkable floors { t:'f', top } and ramps (the same objects as their shapes)
export const shapes = [];
export const surfaces = [];
export const STEP = 0.55;  // how high you can step up
const KNEE = 0.4;          // walls only block above this height from your feet

export function segCircle(x1, z1, x2, z2, cx, cz, R) {
  const dx = x2 - x1, dz = z2 - z1, fx = x1 - cx, fz = z1 - cz;
  const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - R * R;
  if (c < 0) return 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a === 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}
function toLocal(s, x, z) {
  const dx = x - s.x, dz = z - s.z, c = Math.cos(s.rot), n = Math.sin(s.rot);
  return [dx * c - dz * n, dx * n + dz * c];
}
function toWorld(s, lx, lz) {
  const c = Math.cos(s.rot), n = Math.sin(s.rot);
  return [s.x + lx * c + lz * n, s.z - lx * n + lz * c];
}
const rampHeight = (s, lx) => s.h0 + (s.h1 - s.h0) * clamp((lx + s.hw) / (2 * s.hw), 0, 1);
// does a shape block a body standing at height y (feet) with height h?
function blocksBody(s, y, h, lx) {
  if (s.t === 'r') return s.y0 < y + h && y + STEP < rampHeight(s, lx);
  return s.y0 < y + h && s.y1 > y + KNEE;
}
function segBox(ax, az, bx, bz, hw, hd) {
  let t0 = 0, t1 = 1;
  const p = [ax, az], d = [bx - ax, bz - az], lo = [-hw, -hd], hi = [hw, hd];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (p[i] < lo[i] || p[i] > hi[i]) return -1; continue; }
    let a = (lo[i] - p[i]) / d[i], b = (hi[i] - p[i]) / d[i];
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  return t0;
}
// for bots and nav: shapes that are in the way of someone standing at height y (ramps always count)
// quick reject: a circle around each shape (cached on the shape)
const brOf = (s) => s.br ?? (s.br = s.t === 'c' ? s.r : Math.hypot(s.hw, s.hd));
function inWay(s, y, h) { return s.t === 'r' ? s.y0 < y + h && s.y0 > y - 1 : s.y0 < y + h && s.y1 > y + KNEE; }
export function segBlocked2D(ax, az, bx, bz, pad, y = 0, h = 1.8) {
  for (const s of shapes) {
    const rr = brOf(s) + pad;
    if (Math.min(ax, bx) > s.x + rr || Math.max(ax, bx) < s.x - rr || Math.min(az, bz) > s.z + rr || Math.max(az, bz) < s.z - rr) continue;
    if (!inWay(s, y, h)) continue;
    if (s.t === 'c') { if (segCircle(ax, az, bx, bz, s.x, s.z, s.r + pad) >= 0) return true; }
    else {
      const [lax, laz] = toLocal(s, ax, az), [lbx, lbz] = toLocal(s, bx, bz);
      if (segBox(lax, laz, lbx, lbz, s.hw + pad, s.hd + pad) >= 0) return true;
    }
  }
  return false;
}
export function insideAny(x, z, pad, y = 0, h = 1.8) {
  for (const s of shapes) {
    const rr = brOf(s) + pad;
    if (Math.abs(x - s.x) > rr || Math.abs(z - s.z) > rr) continue;
    if (!inWay(s, y, h)) continue;
    if (s.t === 'c') { if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return true; }
    else { const [lx, lz] = toLocal(s, x, z); if (Math.abs(lx) < s.hw + pad && Math.abs(lz) < s.hd + pad) return true; }
  }
  return false;
}
/** Push a player (x, z, y = feet, h = height) out of anything solid at their level. */
export function resolveCircle(p, R) {
  const y = p.y || 0, h = p.h || 1.8;
  for (const s of shapes) {
    const rr = brOf(s) + R;
    if (Math.abs(p.x - s.x) > rr || Math.abs(p.z - s.z) > rr) continue;
    if (s.y0 >= y + h) continue;
    if (s.t === 'c') {
      if (!(s.y1 > y + KNEE)) continue;
      const dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz), m = s.r + R;
      if (d < m) { if (d < 1e-6) { p.x += m; } else { p.x = s.x + dx / d * m; p.z = s.z + dz / d * m; } }
    } else {
      let [lx, lz] = toLocal(s, p.x, p.z);
      const cx = clamp(lx, -s.hw, s.hw), cz = clamp(lz, -s.hd, s.hd);
      if (!blocksBody(s, y, h, cx)) continue;
      const dx = lx - cx, dz = lz - cz, d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); lx = cx + dx / d * R; lz = cz + dz / d * R; }
      else {
        const l = lx + s.hw, r = s.hw - lx, b = lz + s.hd, t = s.hd - lz, m = Math.min(l, r, b, t);
        if (m === l) lx = -s.hw - R; else if (m === r) lx = s.hw + R; else if (m === b) lz = -s.hd - R; else lz = s.hd + R;
      }
      [p.x, p.z] = toWorld(s, lx, lz);
    }
  }
  p.x = clamp(p.x, -BOUND.hw + R, BOUND.hw - R);
  p.z = clamp(p.z, -BOUND.hd + R, BOUND.hd - R);
}
/** Height of the highest floor/ramp under (x, z) that someone at height y can stand on (0 = ground). */
export function supportHeight(x, z, y) {
  let best = 0;
  for (const s of surfaces) {
    const [lx, lz] = toLocal(s, x, z);
    if (Math.abs(lx) > s.hw || Math.abs(lz) > s.hd) continue;
    const top = s.t === 'f' ? s.top : rampHeight(s, lx);
    if (top <= y + STEP && top > best) best = top;
  }
  return best;
}

// ---------- ground-level pathfinding for bots (A* on a grid) ----------
let nav = null;
function buildNav() {
  const cs = Math.max(0.7, (BOUND.hw * 2) / 200), W = Math.ceil((BOUND.hw * 2) / cs), H = Math.ceil((BOUND.hd * 2) / cs);
  const grid = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = -BOUND.hw + (i + 0.5) * cs, z = -BOUND.hd + (j + 0.5) * cs;
    grid[j * W + i] = (Math.abs(x) > BOUND.hw - 0.45 || Math.abs(z) > BOUND.hd - 0.45 || insideAny(x, z, 0.42)) ? 1 : 0;
  }
  nav = { cs, W, H, grid, g: new Float32Array(W * H), from: new Int32Array(W * H), seen: new Uint32Array(W * H), stamp: 0 };
}
const cellOf = (x, z) => [clamp(Math.floor((x + BOUND.hw) / nav.cs), 0, nav.W - 1), clamp(Math.floor((z + BOUND.hd) / nav.cs), 0, nav.H - 1)];
function nearestFree(i, j) {
  if (!nav.grid[j * nav.W + i]) return [i, j];
  for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const a = i + di, b = j + dj;
    if (a >= 0 && b >= 0 && a < nav.W && b < nav.H && !nav.grid[b * nav.W + a]) return [a, b];
  }
  return [i, j];
}
/** Waypoints from (ax, az) to (bx, bz) at ground level, or null if there's no way through. */
export function findPath(ax, az, bx, bz) {
  if (!nav) return null;
  const { W, H, grid, g, from, seen, cs } = nav;
  const stamp = ++nav.stamp;
  const [si, sj] = nearestFree(...cellOf(ax, az)), [ti, tj] = nearestFree(...cellOf(bx, bz));
  const start = sj * W + si, goal = tj * W + ti;
  const heap = [], hf = [];
  const push = (n, f) => { heap.push(n); hf.push(f); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; [hf[p], hf[k]] = [hf[k], hf[p]]; k = p; } };
  const pop = () => { const top = heap[0], ln = heap.pop(), lf = hf.pop(); if (heap.length) { heap[0] = ln; hf[0] = lf; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && hf[l] < hf[m]) m = l; if (r < heap.length && hf[r] < hf[m]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; [hf[m], hf[k]] = [hf[k], hf[m]]; k = m; } } return top; };
  const hgt = (n) => { const dx = Math.abs((n % W) - ti), dz = Math.abs(((n / W) | 0) - tj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  seen[start] = stamp; g[start] = 0; from[start] = -1; push(start, hgt(start));
  let found = false, iter = 0;
  while (heap.length && iter++ < 40000) {
    const n = pop();
    if (n === goal) { found = true; break; }
    const ni = n % W, nj = (n / W) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const a = ni + di, b = nj + dj;
      if (a < 0 || b < 0 || a >= W || b >= H) continue;
      const m = b * W + a;
      if (grid[m] || (di && dj && (grid[nj * W + a] || grid[b * W + ni]))) continue; // no corner cutting
      const ng = g[n] + (di && dj ? 1.414 : 1);
      if (seen[m] === stamp && ng >= g[m]) continue;
      seen[m] = stamp; g[m] = ng; from[m] = n; push(m, ng + hgt(m));
    }
  }
  if (!found) return null;
  const cells = [];
  for (let n = goal; n !== -1; n = from[n]) cells.push(n);
  cells.reverse();
  const pts = cells.map((n) => ({ x: -BOUND.hw + ((n % W) + 0.5) * cs, z: -BOUND.hd + (((n / W) | 0) + 0.5) * cs }));
  pts[pts.length - 1] = { x: bx, z: bz };
  // string-pull: skip waypoints we can walk straight past
  const out = [];
  let cur = { x: ax, z: az }, k = 0;
  while (k < pts.length) {
    let far = k;
    for (let q = Math.min(pts.length - 1, k + 40); q > k; q--) if (!segBlocked2D(cur.x, cur.z, pts[q].x, pts[q].z, 0.36)) { far = q; break; }
    out.push(pts[far]); cur = pts[far]; k = far + 1;
  }
  return out;
}

// ---------- textures ----------
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GROUND = {
  grass: [60000, ['rgba(18,48,18,.28)', 'rgba(170,220,130,.13)'], 2, 3],
  forest: [70000, ['rgba(40,30,15,.3)', 'rgba(150,190,100,.14)', 'rgba(90,70,40,.2)'], 2, 3],
  dirt: [60000, ['rgba(50,32,18,.3)', 'rgba(170,135,95,.18)', 'rgba(100,80,55,.2)'], 2, 2],
  asphalt: [80000, ['rgba(20,20,22,.35)', 'rgba(140,140,145,.18)'], 2, 2],
  sand: [50000, ['rgba(160,120,70,.22)', 'rgba(255,240,205,.25)'], 2, 2],
  snow: [30000, ['rgba(170,195,225,.25)', 'rgba(255,255,255,.6)'], 2, 2],
  stubble: [70000, ['rgba(120,90,30,.3)', 'rgba(240,215,140,.25)'], 1.5, 5],
  gravel: [90000, ['rgba(40,38,34,.35)', 'rgba(170,165,155,.3)', 'rgba(110,100,90,.3)'], 3, 3],
};
function fieldTexture(th) {
  const big = FIELD.hw > 30, W = big ? 3072 : 2048, H = Math.round(W * FIELD.hd / FIELD.hw);
  return canvasTex(W, H, (g) => {
    const sx = W / (FIELD.hw * 2), stripes = Math.round(FIELD.hw * 2 / 5);
    g.fillStyle = th.field; g.fillRect(0, 0, W, H);
    if (th.ground === 'grass' || th.ground === 'forest') for (let i = 0; i < stripes; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.07)'; g.fillRect(i * 5 * sx, 0, 5 * sx, H); }
    if (th.ground === 'stubble') for (let y = 0; y < H; y += 14) { g.fillStyle = 'rgba(120,90,30,.18)'; g.fillRect(0, y, W, 4); }
    if (th.ground === 'sand') for (let i = 0; i < 70; i++) { g.strokeStyle = 'rgba(170,130,80,.18)'; g.lineWidth = 3; const y = Math.random() * H; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= W; x += 60) g.lineTo(x, y + Math.sin(x / 90 + i) * 14); g.stroke(); }
    if (th.ground === 'asphalt') for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(15,15,15,.45)'; g.lineWidth = 2; let x = Math.random() * W, y = Math.random() * H; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += rnd(-40, 40); y += rnd(-40, 40); g.lineTo(x, y); } g.stroke(); }
    if (th.ground === 'forest' || th.ground === 'dirt') for (let i = 0; i < 40; i++) { const x = Math.random() * W, y = Math.random() * H, r = rnd(30, 120); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, th.ground === 'forest' ? 'rgba(90,65,35,.35)' : 'rgba(60,40,20,.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    const [n, cols, w, h] = GROUND[th.ground] || GROUND.grass;
    for (let i = 0; i < n * (big ? 1.6 : 1); i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(Math.random() * W, Math.random() * H, w, h); }
    g.fillStyle = 'rgba(47,125,255,.25)'; g.fillRect(0, 0, 4 * sx, H);
    g.fillStyle = 'rgba(255,64,88,.25)'; g.fillRect(W - 4 * sx, 0, 4 * sx, H);
    g.strokeStyle = th.line; g.lineWidth = 10; g.strokeRect(5, 5, W - 10, H - 10);
    g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, 3.2 * sx, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 6; g.setLineDash([34, 26]);
    for (const f of [0.08, 0.28, 0.72, 0.92]) { g.beginPath(); g.moveTo(f * W, 0); g.lineTo(f * W, H); g.stroke(); }
    g.setLineDash([]);
  });
}
function noiseTexture(base, ground) {
  const t = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    const [, cols, w, h] = GROUND[ground] || GROUND.grass;
    for (let i = 0; i < 5000; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(Math.random() * W, Math.random() * H, w * 0.75, h); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function netTexture() {
  const t = canvasTex(64, 64, (g, W) => { g.strokeStyle = 'rgba(20,20,20,.9)'; g.lineWidth = 3; g.strokeRect(0, 0, W, W); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function bannerTexture(text, bg, fg) {
  return canvasTex(1024, 192, (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.04, 0.12)})`; g.beginPath(); g.arc(Math.random() * W, Math.random() * H, rnd(10, 45), 0, 7); g.fill(); }
    g.fillStyle = fg; g.font = '900 120px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, W / 2, H / 2 + 6);
  });
}
function splatTexture() {
  return canvasTex(128, 128, (g, S) => {
    g.fillStyle = '#fff';
    const blob = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    const r = S * 0.19;
    blob(S / 2, S / 2, r);
    for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28, d = r * rnd(0.4, 0.9); blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r * rnd(0.3, 0.6)); }
    const dir = Math.random() * 6.28;
    for (let i = 0; i < 14; i++) { const a = dir + rnd(-0.9, 0.9), d = r * rnd(1.1, 2.4); blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r * rnd(0.06, 0.22)); }
  });
}

const TREE_COLORS = {
  green: [[0.26, 0.36], [0.35, 0.55], [0.18, 0.3]], dense: [[0.25, 0.34], [0.35, 0.6], [0.14, 0.26]],
  sparse: [[0.26, 0.34], [0.3, 0.45], [0.2, 0.3]], autumn: [[0.03, 0.13], [0.6, 0.8], [0.32, 0.45]],
  dry: [[0.14, 0.22], [0.25, 0.4], [0.28, 0.38]], dead: [[0.07, 0.1], [0.15, 0.25], [0.2, 0.28]],
  snow: [[0.55, 0.6], [0.1, 0.2], [0.85, 0.93]], night: [[0.3, 0.4], [0.3, 0.45], [0.06, 0.1]], none: null,
};
const TREE_COUNT = { dense: 1, green: 0.75, autumn: 0.75, snow: 0.75, night: 0.75, dry: 0.5, dead: 0.5, sparse: 0.35, none: 0 };
const SMALL = { hw: 25, hd: 15 };

// ---------- world ----------
export function createWorld(canvas, high) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 1.75 : 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa9cbe8);
  scene.fog = new THREE.Fog(0xbcd6ea, 90, 260);
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 700);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const bunkerMeshes = [];
  const shadowy = (o) => o.traverse((m) => { if (m.isMesh) { m.castShadow = high; m.receiveShadow = high; } });

  // sky
  const skyU = { top: { value: new THREE.Color(0x2f73d0) }, bottom: { value: new THREE.Color(0xdcecf7) } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: skyU,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 1.8, 0., 1.); gl_FragColor = vec4(mix(bottom, top, pow(h, .6)), 1.); \n#include <colorspace_fragment>\n }',
  }));
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();
  const hemi = new THREE.HemisphereLight(0xdcecff, 0x4f6b3a, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.7);
  sun.position.set(-35, 50, 25);
  if (high) { sun.castShadow = true; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; }
  scene.add(sun, sun.target);

  // ground
  const fieldMat = new THREE.MeshStandardMaterial({ roughness: 0.95, emissive: 0x000000 });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fieldMat);
  field.rotation.x = -Math.PI / 2; field.receiveShadow = true; scene.add(field);
  const apronMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), apronMat);
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.01; apron.receiveShadow = true; scene.add(apron);
  const outerMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), outerMat);
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.03; outer.receiveShadow = true; scene.add(outer);
  const pathMat = new THREE.MeshStandardMaterial({ color: 0x9a8f7a, roughness: 1 });
  const path = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 4, 1), pathMat);
  path.rotation.x = -Math.PI / 2; path.rotation.z = Math.PI / 4; path.position.y = -0.02; scene.add(path);

  // shared scenery pieces (placed per field size in buildVenue)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.5, metalness: 0.6 });
  const kickMat = new THREE.MeshStandardMaterial({ color: 0x1d3527, roughness: 0.8 });
  const bleachMat = new THREE.MeshStandardMaterial({ color: 0xa7adb5, roughness: 0.4, metalness: 0.6 });
  const nt = netTexture();
  const treeMax = high ? 220 : 110;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 6), new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 1 }), treeMax);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2.4, 7, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), treeMax);
  trunks.castShadow = crowns.castShadow = high;
  for (let i = 0; i < treeMax; i++) crowns.setColorAt(i, new THREE.Color(0x2f6b2a));
  scene.add(trunks, crowns);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x47703a, roughness: 1, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2 + rnd(-0.2, 0.2), r = rnd(200, 260);
    const h = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), hillMat);
    h.position.set(Math.cos(a) * r, -8, Math.sin(a) * r); h.scale.set(rnd(50, 80), rnd(18, 32), rnd(50, 80)); scene.add(h);
  }
  const venue = new THREE.Group(); scene.add(venue);
  const flags = [];
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  let venueKey = '';

  function buildVenue() {
    for (const c of [...venue.children]) { c.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); if (m.userData.own) { m.material.map?.dispose(); m.material.dispose(); } } }); venue.remove(c); }
    flags.length = 0;
    field.scale.set(FIELD.hw * 2, FIELD.hd * 2, 1);
    apron.scale.set(NETB.hw * 2 + 0.4, NETB.hd * 2 + 0.4, 1);
    path.scale.set(NETB.hw * 1.43, NETB.hd * 1.43, 1);
    const netH = 6;
    for (const [len, x, z, ry] of [[NETB.hw * 2, 0, NETB.hd, 0], [NETB.hw * 2, 0, -NETB.hd, 0], [NETB.hd * 2, NETB.hw, 0, Math.PI / 2], [NETB.hd * 2, -NETB.hw, 0, Math.PI / 2]]) {
      const t = nt.clone(); t.needsUpdate = true; t.repeat.set(len / 0.5, netH / 0.5);
      const n = new THREE.Mesh(new THREE.PlaneGeometry(len, netH), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      n.userData.own = true; n.position.set(x, 0.5 + netH / 2, z); n.rotation.y = ry; venue.add(n);
    }
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, netH + 0.8, 8);
    const addPole = (x, z) => { const p = new THREE.Mesh(poleGeo.clone(), poleMat); p.position.set(x, (netH + 0.8) / 2, z); p.castShadow = high; venue.add(p); };
    const nx = Math.round(NETB.hw / 5.5), nz = Math.round(NETB.hd / 5.8);
    for (let i = -nx; i <= nx; i++) { addPole(i * NETB.hw / nx, NETB.hd); addPole(i * NETB.hw / nx, -NETB.hd); }
    for (let i = -nz + 1; i < nz; i++) { addPole(NETB.hw, i * NETB.hd / nz); addPole(-NETB.hw, i * NETB.hd / nz); }
    for (const [w, d, x, z] of [[NETB.hw * 2, 0.08, 0, NETB.hd], [NETB.hw * 2, 0.08, 0, -NETB.hd], [0.08, NETB.hd * 2, NETB.hw, 0], [0.08, NETB.hd * 2, -NETB.hw, 0]]) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), kickMat); k.position.set(x, 0.25, z); k.receiveShadow = high; venue.add(k);
    }
    const banner = (text, bg, fg, x, z, ry, w = 6.5) => {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.1875), new THREE.MeshStandardMaterial({ map: bannerTexture(text, bg, fg), roughness: 0.8, side: THREE.DoubleSide }));
      b.userData.own = true; b.position.set(x, 1.25, z); b.rotation.y = ry; venue.add(b);
    };
    banner('BLUE BASE', '#1f5fd6', '#ffffff', -NETB.hw + 0.06, 0, Math.PI / 2, 8);
    banner('RED BASE', '#d42a43', '#ffffff', NETB.hw - 0.06, 0, -Math.PI / 2, 8);
    const bx = FIELD.hw > 30 ? [-36, -12, 12, 36] : [-16, 0, 16];
    bx.forEach((x, i) => {
      const mid = i === Math.floor(bx.length / 2) && bx.length % 2;
      banner(mid ? 'PAINTBALL PARK' : 'SPLATLINE', '#141414', mid ? '#ffffff' : '#ffd23f', x, -NETB.hd + 0.06, 0);
      banner(mid ? 'ONE HIT · YOU\'RE OUT' : 'SPLATLINE', '#141414', mid ? '#ffffff' : '#ffd23f', x, NETB.hd - 0.06, Math.PI);
    });
    // bleachers + crowd
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(24, 0.45, 1), bleachMat);
      s.position.set(0, 0.225 + i * 0.45, NETB.hd + 4.5 + i); shadowy(s); venue.add(s);
      const back = new THREE.Mesh(new THREE.BoxGeometry(24, (i + 1) * 0.45, 0.05), bleachMat);
      back.position.set(0, (i + 1) * 0.225, NETB.hd + 5 + i); venue.add(back);
    }
    const crowdN = high ? 46 : 24;
    const crowdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }); crowdMat.userData.own = true;
    const crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.4, 4, 8), crowdMat, crowdN);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd9a37f, roughness: 0.8 }), crowdN);
    for (let i = 0; i < crowdN; i++) {
      const row = i % 4, x = rnd(-11.5, 11.5), y = (row + 1) * 0.45, z = NETB.hd + 4.6 + row;
      mtx.makeTranslation(x, y + 0.42, z); crowd.setMatrixAt(i, mtx);
      mtx.makeTranslation(x, y + 0.88, z); heads.setMatrixAt(i, mtx);
      crowd.setColorAt(i, col.setHSL(Math.random(), 0.65, 0.5));
    }
    venue.add(crowd, heads);
    for (const side of [-1, 1]) {
      const team = side < 0 ? 0 : 1, tc = TEAMS[team].color;
      const tx = side * (NETB.hw + 5.5), tz = -7;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.3, 4), new THREE.MeshStandardMaterial({ color: tc, roughness: 0.7, side: THREE.DoubleSide }));
      roof.position.set(tx, 3.05, tz); roof.rotation.y = Math.PI / 4; shadowy(roof); venue.add(roof);
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), poleMat); leg.position.set(tx + dx * 1.08, 1.2, tz + dz * 1.08); venue.add(leg);
      }
      const table = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.9), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 }));
      table.position.set(tx, 0.8, tz); shadowy(table); venue.add(table);
      for (let i = 0; i < 4; i++) {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 14), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x2b5c8a : 0x9a3b2b, roughness: 0.6, metalness: 0.3 }));
        barrel.position.set(tx + side * rnd(2.8, 4), 0.45, tz + 4 + i * 0.75); shadowy(barrel); venue.add(barrel);
      }
      const fx = side * (NETB.hw + 3), fz = -13;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7, 8), poleMat); pole.position.set(fx, 3.5, fz); shadowy(pole); venue.add(pole);
      const fg = new THREE.PlaneGeometry(2, 1.2, 16, 6); fg.translate(1, 0, 0);
      const flag = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: tc, roughness: 0.8, side: THREE.DoubleSide }));
      flag.position.set(fx, 6.3, fz); flag.castShadow = high; venue.add(flag);
      flags.push({ mesh: flag, base: fg.attributes.position.array.slice(), phase: side });
    }
    // tree ring around the netting
    for (let i = 0; i < treeMax; i++) {
      const a = Math.random() * Math.PI * 2, k = rnd(1.05, 3.2), s = rnd(0.8, 1.6);
      const x = Math.cos(a) * (NETB.hw + 14) * k, z = Math.sin(a) * (NETB.hd + 14) * k;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6);
      mtx.compose(new THREE.Vector3(x, 1.5 * s, z), q, new THREE.Vector3(s, s, s)); trunks.setMatrixAt(i, mtx);
      mtx.compose(new THREE.Vector3(x, (3 + 3.2) * s, z), q, new THREE.Vector3(s, s * rnd(0.85, 1.2), s)); crowns.setMatrixAt(i, mtx);
    }
    trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;
    // sun shadows cover the whole field
    if (high) {
      const big = FIELD.hw > 30;
      sun.shadow.map?.dispose(); sun.shadow.map = null;
      sun.shadow.mapSize.set(big ? 4096 : 2048, big ? 4096 : 2048);
      Object.assign(sun.shadow.camera, { left: -(NETB.hw + 12), right: NETB.hw + 12, top: NETB.hd + 14, bottom: -(NETB.hd + 14), near: 5, far: big ? 260 : 150 });
      sun.shadow.camera.updateProjectionMatrix();
    }
    venue.traverse((o) => { if (o.material && 'envMapIntensity' in o.material) o.material.envMapIntensity = 0.12; });
  }

  // ---- map: theme + bunkers ----
  const arena = new THREE.Group(); scene.add(arena);
  const cover = [];
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const proxyGeo = {
    b: (K) => new THREE.BoxGeometry(K.w, K.h, K.d).translate(0, K.h / 2, 0),
    c: (K) => new THREE.CylinderGeometry(K.r, K.r, K.h, 16).translate(0, K.h / 2, 0),
    t: (K) => new THREE.CylinderGeometry(K.R, K.R, K.h, 3).rotateY(Math.PI / 2).translate(0, K.h / 2, 0),
  };
  let groundTex = [];
  const info = { map: null, mode: 'elim', flags: null, castle: null, large: false, snakes: [] };

  function applyTheme(th) {
    for (const t of groundTex) t.dispose();
    fieldMat.map = fieldTexture(th); fieldMat.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    fieldMat.emissiveMap = th.glow ? fieldMat.map : null;
    fieldMat.emissive.set(th.glow ? 0xffffff : 0x000000); fieldMat.emissiveIntensity = th.glow || 0;
    apronMat.map = noiseTexture(th.apron, th.ground); apronMat.map.repeat.set(NETB.hw / 2, NETB.hd / 2);
    outerMat.map = noiseTexture(th.outer, th.ground); outerMat.map.repeat.set(120, 120);
    for (const m of [fieldMat, apronMat, outerMat]) m.needsUpdate = true;
    groundTex = [fieldMat.map, apronMat.map, outerMat.map];
    pathMat.color.set(th.path);
    skyU.top.value.set(th.sky[0]); skyU.bottom.value.set(th.sky[1]);
    const fk = FIELD.hw > 30 ? 1.7 : 1;
    scene.background.set(th.fog[0]); scene.fog.color.set(th.fog[0]); scene.fog.near = th.fog[1] * fk; scene.fog.far = th.fog[2] * fk;
    hemi.color.set(th.hemi[0]); hemi.groundColor.set(th.hemi[1]); hemi.intensity = th.hemi[2];
    const sk = FIELD.hw > 30 ? 1.6 : 1;
    sun.color.set(th.sun[0]); sun.intensity = th.sun[1]; sun.position.set(th.sun[2][0] * sk, th.sun[2][1] * sk, th.sun[2][2] * sk);
    renderer.toneMappingExposure = th.exposure;
    hillMat.color.set(th.hills);
    const tc = TREE_COLORS[th.trees];
    const n = Math.round(treeMax * (TREE_COUNT[th.trees] ?? 0.75));
    trunks.count = crowns.count = tc ? n : 0;
    if (tc) { for (let i = 0; i < n; i++) crowns.setColorAt(i, col.setHSL(rnd(...tc[0]), rnd(...tc[1]), rnd(...tc[2]))); crowns.instanceColor.needsUpdate = true; }
  }

  function clearArena() {
    for (const c of [...arena.children]) { c.traverse((m) => { if (m.isMesh && m.geometry) m.geometry.dispose(); }); arena.remove(c); }
    shapes.length = 0; surfaces.length = 0; bunkerMeshes.length = 0; cover.length = 0;
  }
  function finishGroup(g) {
    shadowy(g);
    g.traverse((m) => { if (m.isMesh && m.material && 'envMapIntensity' in m.material) m.material.envMapIntensity = 0.12; });
    arena.add(g);
  }
  function placeBunker(style, kind, x, z, rot) {
    const K = KINDS[kind];
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
    let colliders = buildBunker(style, kind, g, { high });
    if (!colliders) {
      const p = new THREE.Mesh(proxyGeo[K.t](K), proxyMat);
      p.castShadow = p.receiveShadow = false;
      g.add(p); colliders = [p];
    }
    finishGroup(g);
    bunkerMeshes.push(...colliders);
    shapes.push(K.t === 'b' ? { t: 'b', x, z, rot, hw: K.w / 2, hd: K.d / 2, y0: 0, y1: K.h } : { t: 'c', x, z, rot, r: K.r, y0: 0, y1: K.h });
    if (kind === 'snake') info.snakes.push({ x, z, rot, hw: K.w / 2, hd: K.d / 2 }); // the AI's snake players crawl along these
  }
  function placeCastle(castle, cx, style) {
    const plan = castlePlan();
    for (const part of plan.parts) {
      const x = cx + part.x, z = part.z, rot = part.rot || 0;
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
      bunkerMeshes.push(...buildCastlePart(part, castle, g));
      finishGroup(g);
      const base = { x, z, rot };
      if (part.type === 'wall') shapes.push({ ...base, t: 'b', hw: part.w / 2, hd: part.d / 2, y0: part.y0, y1: part.y1 + 0.5 });
      else if (part.type === 'tower') shapes.push({ ...base, t: 'b', hw: part.w / 2, hd: part.d / 2, y0: 0, y1: part.h + 0.6 });
      else if (part.type === 'pillar') shapes.push({ ...base, t: 'c', r: part.r, y0: 0, y1: part.h });
      else if (part.type === 'floor') {
        shapes.push({ ...base, t: 'b', hw: part.w / 2, hd: part.d / 2, y0: part.top - 0.4, y1: part.top });
        surfaces.push({ ...base, t: 'f', hw: part.w / 2, hd: part.d / 2, top: part.top });
      } else if (part.type === 'ramp') {
        const r = { ...base, t: 'r', hw: part.w / 2, hd: part.d / 2, h0: part.h0, h1: part.h1, y0: part.base };
        shapes.push(r); surfaces.push(r);
      }
    }
    for (const [kind, x, z, rot = 0] of plan.yard) placeBunker(style, kind, cx + x, z, rot);
    return {
      cx, zone: { ...plan.zone, x: cx + plan.zone.x },
      defend: plan.defend.map((d) => ({ ...d, x: cx + d.x })),
      holes: { roof: { ...plan.holes.roof, x: cx + plan.holes.roof.x }, floor2: { ...plan.holes.floor2, x: cx + plan.holes.floor2.x } },
      keep: { ...plan.keep, x: cx + plan.keep.x },
    };
  }

  function computeCover() {
    const off = 0.38 + 0.4;
    for (const s of shapes) {
      if (s.y0 > 0.5 || s.t === 'r') continue;
      const local = s.t === 'c'
        ? [...Array(8)].map((_, i) => [Math.cos(i * Math.PI / 4) * (s.r + off), Math.sin(i * Math.PI / 4) * (s.r + off)])
        : [[s.hw + off, 0], [-s.hw - off, 0], [0, s.hd + off], [0, -s.hd - off],
          ...(s.hw > 1.2 ? [[s.hw * 0.6, s.hd + off], [-s.hw * 0.6, s.hd + off], [s.hw * 0.6, -s.hd - off], [-s.hw * 0.6, -s.hd - off]] : []),
          ...(s.hd > 1.2 ? [[s.hw + off, s.hd * 0.6], [s.hw + off, -s.hd * 0.6], [-s.hw - off, s.hd * 0.6], [-s.hw - off, -s.hd * 0.6]] : [])];
      for (const [lx, lz] of local) {
        const [x, z] = s.t === 'c' ? [s.x + lx, s.z + lz] : toWorld(s, lx, lz);
        if (Math.abs(x) < BOUND.hw - 0.6 && Math.abs(z) < BOUND.hd - 0.6 && !insideAny(x, z, 0.36) && supportHeight(x, z, 0) === 0) cover.push({ x, z });
      }
    }
  }

  function setSize(sz) {
    FIELD.hw = sz.hw; FIELD.hd = sz.hd;
    BOUND.hw = sz.hw + 1.3; BOUND.hd = sz.hd + 1.3;
    NETB.hw = sz.hw + 2.5; NETB.hd = sz.hd + 2.5;
    const key = `${sz.hw}x${sz.hd}`;
    if (key !== venueKey) { venueKey = key; buildVenue(); }
  }

  /** Load a map for a game mode ('elim' | 'ctf' | 'koth'): field size, theme, bunkers, castle, bot paths. */
  function loadMap(id, mode = 'elim') {
    const map = mapById(id);
    clearSplats();
    clearArena(); info.snakes = [];
    setSize(map.size || SMALL);
    applyTheme(map.theme);
    const place = (list, mirror) => {
      for (const [kind, x, z, rot = 0] of list) {
        placeBunker(map.style, kind, x, z, rot);
        if (mirror && x !== 0) placeBunker(map.style, kind, -x, z, Math.PI - rot);
      }
    };
    place(map.layout, true);
    info.map = map; info.mode = mode; info.large = !!map.large; info.flags = null; info.castle = null;
    if (mode === 'ctf' && map.ctf) {
      place(map.ctf, true);
      info.flags = [{ x: -(FIELD.hw - 7), z: 0 }, { x: FIELD.hw - 7, z: 0 }];
    }
    if (mode === 'koth' && map.castle) {
      place(map.kothBase || [], false); // cover near the attackers' end
      info.castle = placeCastle(map.castle, FIELD.hw - 17, map.style);
    }
    arena.updateMatrixWorld(true);
    computeCover();
    buildNav();
    return map;
  }

  // ---- paint decals ----
  const splatTex = [...Array(6)].map(splatTexture);
  const decalMats = TEAMS.map((t) => splatTex.map((map) => new THREE.MeshStandardMaterial({
    map, color: t.paint, transparent: true, depthWrite: false, roughness: 0.3,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  })));
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  const pool = [], POOL = high ? 800 : 300;
  let pi = 0;
  const tmp = new THREE.Vector3();
  function addSplat(point, normal, team, size, parent) {
    let m = pool[pi];
    if (!m) { m = new THREE.Mesh(decalGeo, decalMats[0][0]); m.renderOrder = 1; pool[pi] = m; }
    pi = (pi + 1) % POOL;
    m.removeFromParent();
    m.material = decalMats[team][(Math.random() * 6) | 0];
    m.position.copy(point).addScaledVector(normal, 0.006);
    m.rotation.set(0, 0, 0); m.scale.setScalar(size);
    scene.add(m);
    m.lookAt(tmp.copy(m.position).add(normal));
    m.rotateZ(Math.random() * Math.PI * 2);
    m.updateMatrixWorld();
    if (parent) parent.attach(m);
    return m;
  }
  function clearSplats() { for (const m of pool) if (m) m.removeFromParent(); }

  const puffTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  const puffs = [];
  function puff(point, team) {
    let p = puffs.find((q) => q.t <= 0);
    if (!p) { p = { s: new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false })), t: 0 }; puffs.push(p); scene.add(p.s); }
    p.s.material.color.setHex(TEAMS[team].paint);
    p.s.position.copy(point); p.t = 0.3; p.s.visible = true;
  }

  function update(dt, time) {
    for (const f of flags) {
      const pos = f.mesh.geometry.attributes.position, a = pos.array, b = f.base;
      for (let i = 0; i < a.length; i += 3) { const x = b[i]; a[i + 2] = Math.sin(x * 2.6 - time * 5 + f.phase) * 0.14 * x; }
      pos.needsUpdate = true;
    }
    for (const p of puffs) {
      if (p.t <= 0) continue;
      p.t -= dt;
      const k = 1 - p.t / 0.3;
      p.s.scale.setScalar(0.15 + k * 0.7); p.s.material.opacity = 0.7 * (1 - k);
      if (p.t <= 0) p.s.visible = false;
    }
  }

  return { renderer, scene, camera, bunkerMeshes, cover, addSplat, clearSplats, puff, update, loadMap, info, findPath };
}
