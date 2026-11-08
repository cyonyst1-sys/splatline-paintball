// Scene, field, inflatable bunkers, scenery, paint decals and 2D collision helpers.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const FIELD = { hw: 25, hd: 15 };     // playing field half-size (metres)
export const BOUND = { hw: 26.3, hd: 16.3 }; // where players can walk
export const NETB = { hw: 27.5, hd: 17.5 };  // netting
export const TEAMS = [
  { name: 'BLUE', css: '#2f7dff', paintCss: '#1ec8ff', color: 0x2f7dff, paint: 0x1ec8ff, names: ['Ace', 'You', 'Moss', 'Dash'] },
  { name: 'RED', css: '#ff4058', paintCss: '#ff2d8a', color: 0xff4058, paint: 0xff2d8a, names: ['Viper', 'Rook', 'Blaze', 'Fang'] },
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- 2D collision (x/z plane) ----------
// shape: { t:'c', x, z, r } or { t:'b', x, z, hw, hd, rot }
export const shapes = [];

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
export function segBlocked2D(ax, az, bx, bz, pad) {
  for (const s of shapes) {
    if (s.t === 'c') { if (segCircle(ax, az, bx, bz, s.x, s.z, s.r + pad) >= 0) return true; }
    else {
      const [lax, laz] = toLocal(s, ax, az), [lbx, lbz] = toLocal(s, bx, bz);
      if (segBox(lax, laz, lbx, lbz, s.hw + pad, s.hd + pad) >= 0) return true;
    }
  }
  return false;
}
export function insideAny(x, z, pad) {
  for (const s of shapes) {
    if (s.t === 'c') { if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return true; }
    else { const [lx, lz] = toLocal(s, x, z); if (Math.abs(lx) < s.hw + pad && Math.abs(lz) < s.hd + pad) return true; }
  }
  return false;
}
export function resolveCircle(p, R) {
  for (const s of shapes) {
    if (s.t === 'c') {
      const dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz), m = s.r + R;
      if (d < m) { if (d < 1e-6) { p.x += m; } else { p.x = s.x + dx / d * m; p.z = s.z + dz / d * m; } }
    } else {
      let [lx, lz] = toLocal(s, p.x, p.z);
      const cx = clamp(lx, -s.hw, s.hw), cz = clamp(lz, -s.hd, s.hd);
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

// ---------- textures ----------
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function fieldTexture() {
  return canvasTex(2048, 1229, (g, W, H) => {
    const sx = W / 50;
    g.fillStyle = '#3d8a3a'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.07)'; g.fillRect(i * 5 * sx, 0, 5 * sx, H); }
    for (let i = 0; i < 60000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(18,48,18,.28)' : 'rgba(170,220,130,.13)';
      g.fillRect(Math.random() * W, Math.random() * H, 2, 3);
    }
    g.fillStyle = 'rgba(47,125,255,.25)'; g.fillRect(0, 0, 4 * sx, H);
    g.fillStyle = 'rgba(255,64,88,.25)'; g.fillRect(W - 4 * sx, 0, 4 * sx, H);
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 10; g.strokeRect(5, 5, W - 10, H - 10);
    g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, 3.2 * sx, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 6; g.setLineDash([34, 26]);
    for (const x of [4, 14, 36, 46]) { g.beginPath(); g.moveTo(x * sx, 0); g.lineTo(x * sx, H); g.stroke(); }
    g.setLineDash([]);
  });
}
function grassTexture(base) {
  const t = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(15,40,15,.3)' : 'rgba(180,220,140,.12)';
      g.fillRect(Math.random() * W, Math.random() * H, 1.5, 3);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function netTexture() {
  const t = canvasTex(64, 64, (g, W) => {
    g.strokeStyle = 'rgba(20,20,20,.9)'; g.lineWidth = 3;
    g.strokeRect(0, 0, W, W);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function bannerTexture(text, bg, fg) {
  return canvasTex(1024, 192, (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(255,255,255,${rnd(0.04, 0.12)})`;
      g.beginPath(); g.arc(Math.random() * W, Math.random() * H, rnd(10, 45), 0, 7); g.fill();
    }
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
    for (let i = 0; i < 14; i++) {
      const a = dir + rnd(-0.9, 0.9), d = r * rnd(1.1, 2.4);
      blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r * rnd(0.06, 0.22));
    }
  });
}

// ---------- inflatable geometry ----------
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
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-4);
  geo.computeVertexNormals();
  return geo;
}
// Extrude a 2D footprint upward with a fat bevel so it looks blown-up.
function puffy(shape, h, b) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, h - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b,
    bevelSegments: 6, curveSegments: 10, steps: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0);
  return smooth(g);
}
function rectPts(w, d) { return [new THREE.Vector2(-w / 2, -d / 2), new THREE.Vector2(w / 2, -d / 2), new THREE.Vector2(w / 2, d / 2), new THREE.Vector2(-w / 2, d / 2)]; }
function boxGeo(w, d, h, b) { return puffy(roundedPoly(rectPts(w - 2 * b, d - 2 * b), Math.min(0.12, (Math.min(w, d) - 2 * b) / 2.2)), h, b); }
function triGeo(R, h, b) {
  const pts = [0, 1, 2].map((i) => { const a = i * Math.PI * 2 / 3; return new THREE.Vector2(Math.cos(a) * R, Math.sin(a) * R); });
  return puffy(roundedPoly(pts, 0.18), h, b);
}
function canGeo(r, h, b) {
  const pts = [new THREE.Vector2(0, 0)];
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + i / 8 * Math.PI / 2; pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, b + Math.sin(a) * b)); }
  for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, h - b + Math.sin(a) * b)); }
  pts.push(new THREE.Vector2(0, h));
  return new THREE.LatheGeometry(pts, 40);
}

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
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 600);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const bunkerMeshes = [];
  const shadowy = (o) => o.traverse((m) => { if (m.isMesh) { m.castShadow = high; m.receiveShadow = high; } });

  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x2f73d0) }, bottom: { value: new THREE.Color(0xdcecf7) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 1.8, 0., 1.); gl_FragColor = vec4(mix(bottom, top, pow(h, .6)), 1.); \n#include <colorspace_fragment>\n }',
  }));
  scene.add(sky);

  // lights
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x4f6b3a, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.7);
  sun.position.set(-35, 50, 25);
  if (high) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 30, bottom: -30, near: 5, far: 150 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  }
  scene.add(sun);

  // ground: field, apron, countryside
  const field = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.hw * 2, FIELD.hd * 2),
    new THREE.MeshStandardMaterial({ map: fieldTexture(), roughness: 0.95 }));
  field.rotation.x = -Math.PI / 2; field.receiveShadow = true; scene.add(field);
  field.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const apronTex = grassTexture('#336f31'); apronTex.repeat.set(14, 9);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(NETB.hw * 2 + 0.4, NETB.hd * 2 + 0.4), new THREE.MeshStandardMaterial({ map: apronTex, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.01; apron.receiveShadow = true; scene.add(apron);

  const outTex = grassTexture('#4a7a37'); outTex.repeat.set(90, 90);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: outTex, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.03; outer.receiveShadow = true; scene.add(outer);

  // gravel path round the net
  const path = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 4, 1), new THREE.MeshStandardMaterial({ color: 0x9a8f7a, roughness: 1 }));
  path.rotation.x = -Math.PI / 2; path.rotation.z = Math.PI / 4; path.scale.set(NETB.hw * 1.43, NETB.hd * 1.43, 1); path.position.y = -0.02; scene.add(path);

  // ---- netting, poles, kickboards, banners ----
  const netH = 6, nt = netTexture();
  const netMat = (len) => { const t = nt.clone(); t.needsUpdate = true; t.repeat.set(len / 0.5, netH / 0.5); return new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }); };
  const nets = [
    [NETB.hw * 2, 0, NETB.hd, 0], [NETB.hw * 2, 0, -NETB.hd, 0],
    [NETB.hd * 2, NETB.hw, 0, Math.PI / 2], [NETB.hd * 2, -NETB.hw, 0, Math.PI / 2],
  ];
  for (const [len, x, z, ry] of nets) {
    const n = new THREE.Mesh(new THREE.PlaneGeometry(len, netH), netMat(len));
    n.position.set(x, 0.5 + netH / 2, z); n.rotation.y = ry; scene.add(n);
  }
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.5, metalness: 0.6 });
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, netH + 0.8, 8);
  const addPole = (x, z) => { const p = new THREE.Mesh(poleGeo, poleMat); p.position.set(x, (netH + 0.8) / 2, z); p.castShadow = high; scene.add(p); };
  for (let x = -NETB.hw; x <= NETB.hw + 0.01; x += NETB.hw / 5) { addPole(x, NETB.hd); addPole(x, -NETB.hd); }
  for (let z = -NETB.hd + NETB.hd / 3; z < NETB.hd - 0.01; z += NETB.hd / 3) { addPole(NETB.hw, z); addPole(-NETB.hw, z); }
  const kickMat = new THREE.MeshStandardMaterial({ color: 0x1d3527, roughness: 0.8 });
  for (const [w, d, x, z] of [[NETB.hw * 2, 0.08, 0, NETB.hd], [NETB.hw * 2, 0.08, 0, -NETB.hd], [0.08, NETB.hd * 2, NETB.hw, 0], [0.08, NETB.hd * 2, -NETB.hw, 0]]) {
    const k = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), kickMat); k.position.set(x, 0.25, z); k.receiveShadow = high; scene.add(k);
  }
  const banner = (text, bg, fg, x, z, ry, w = 6.5) => {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.1875), new THREE.MeshStandardMaterial({ map: bannerTexture(text, bg, fg), roughness: 0.8, side: THREE.DoubleSide }));
    b.position.set(x, 1.25, z); b.rotation.y = ry; scene.add(b);
  };
  banner('BLUE BASE', '#1f5fd6', '#ffffff', -NETB.hw + 0.06, 0, Math.PI / 2, 8);
  banner('RED BASE', '#d42a43', '#ffffff', NETB.hw - 0.06, 0, -Math.PI / 2, 8);
  for (const x of [-16, 0, 16]) {
    banner(x ? 'SPLATLINE' : 'PAINTBALL PARK', '#141414', x ? '#ffd23f' : '#ffffff', x, -NETB.hd + 0.06, 0);
    banner(x ? 'SPLATLINE' : 'ONE HIT · YOU\'RE OUT', '#141414', x ? '#ffd23f' : '#ffffff', x, NETB.hd - 0.06, Math.PI);
  }

  // ---- scenery ----
  // trees
  const treeCount = high ? 140 : 70;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 6), new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 1 }), treeCount);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2.4, 7, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), treeCount);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  for (let i = 0; i < treeCount; i++) {
    const a = Math.random() * Math.PI * 2, k = rnd(1.05, 3.6), s = rnd(0.8, 1.6);
    const x = Math.cos(a) * (NETB.hw + 14) * k, z = Math.sin(a) * (NETB.hd + 14) * k;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6);
    mtx.compose(new THREE.Vector3(x, 1.5 * s, z), q, new THREE.Vector3(s, s, s)); trunks.setMatrixAt(i, mtx);
    mtx.compose(new THREE.Vector3(x, (3 + 3.2) * s, z), q, new THREE.Vector3(s, s * rnd(0.85, 1.2), s)); crowns.setMatrixAt(i, mtx);
    crowns.setColorAt(i, col.setHSL(rnd(0.26, 0.36), rnd(0.35, 0.55), rnd(0.18, 0.3)));
  }
  trunks.castShadow = crowns.castShadow = high;
  scene.add(trunks, crowns);
  // hills
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x47703a, roughness: 1, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2 + rnd(-0.2, 0.2), r = rnd(170, 230);
    const h = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), hillMat);
    h.position.set(Math.cos(a) * r, -8, Math.sin(a) * r); h.scale.set(rnd(50, 80), rnd(18, 32), rnd(50, 80)); scene.add(h);
  }
  // bleachers + crowd
  const bleachMat = new THREE.MeshStandardMaterial({ color: 0xa7adb5, roughness: 0.4, metalness: 0.6 });
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(24, 0.45, 1), bleachMat);
    s.position.set(0, 0.225 + i * 0.45, NETB.hd + 4.5 + i); shadowy(s); scene.add(s);
    const back = new THREE.Mesh(new THREE.BoxGeometry(24, (i + 1) * 0.45, 0.05), bleachMat);
    back.position.set(0, (i + 1) * 0.225, NETB.hd + 5 + i); scene.add(back);
  }
  const crowdN = high ? 46 : 24;
  const crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.4, 4, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), crowdN);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd9a37f, roughness: 0.8 }), crowdN);
  for (let i = 0; i < crowdN; i++) {
    const row = i % 4, x = rnd(-11.5, 11.5), y = (row + 1) * 0.45, z = NETB.hd + 4.6 + row;
    mtx.makeTranslation(x, y + 0.42, z); crowd.setMatrixAt(i, mtx);
    mtx.makeTranslation(x, y + 0.88, z); heads.setMatrixAt(i, mtx);
    crowd.setColorAt(i, col.setHSL(Math.random(), 0.65, 0.5));
  }
  scene.add(crowd, heads);
  // team tents, tables, barrels
  const flags = [];
  for (const side of [-1, 1]) {
    const team = side < 0 ? 0 : 1, tc = TEAMS[team].color;
    const tx = side * (NETB.hw + 5.5), tz = -7;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.3, 4), new THREE.MeshStandardMaterial({ color: tc, roughness: 0.7, side: THREE.DoubleSide }));
    roof.position.set(tx, 3.05, tz); roof.rotation.y = Math.PI / 4; shadowy(roof); scene.add(roof);
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), poleMat); leg.position.set(tx + dx * 1.08, 1.2, tz + dz * 1.08); scene.add(leg);
    }
    const table = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.9), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 }));
    table.position.set(tx, 0.8, tz); shadowy(table); scene.add(table);
    for (let i = 0; i < 3; i++) {
      const hop = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: TEAMS[team].paint, roughness: 0.3 }));
      hop.position.set(tx - 0.8 + i * 0.8, 0.97, tz); hop.scale.y = 1.25; scene.add(hop);
    }
    for (let i = 0; i < 4; i++) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 14), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x2b5c8a : 0x9a3b2b, roughness: 0.6, metalness: 0.3 }));
      barrel.position.set(tx + side * rnd(2.8, 4), 0.45, tz + 4 + i * 0.75); shadowy(barrel); scene.add(barrel);
    }
    // flag
    const fx = side * (NETB.hw + 3), fz = -13;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7, 8), poleMat); pole.position.set(fx, 3.5, fz); shadowy(pole); scene.add(pole);
    const fg = new THREE.PlaneGeometry(2, 1.2, 16, 6); fg.translate(1, 0, 0);
    const flag = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: tc, roughness: 0.8, side: THREE.DoubleSide }));
    flag.position.set(fx, 6.3, fz); flag.castShadow = high; scene.add(flag);
    flags.push({ mesh: flag, base: fg.attributes.position.array.slice(), phase: side });
  }

  // ---- inflatable bunkers ----
  const matCache = {};
  const nylon = (hex) => matCache[hex] || (matCache[hex] = high
    ? new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.4, clearcoat: 0.45, clearcoatRoughness: 0.35 })
    : new THREE.MeshStandardMaterial({ color: hex, roughness: 0.45 }));
  function bunker(group, collide, x, z, rot, shape) {
    group.position.set(x, 0, z); group.rotation.y = rot;
    shadowy(group); scene.add(group);
    bunkerMeshes.push(...collide);
    shapes.push({ ...shape, x, z, rot });
  }
  function box(w, d, h, main, acc) {
    return (x, z, rot) => {
      const g = new THREE.Group(), b = Math.min(0.2, Math.min(w, d) * 0.22);
      const body = new THREE.Mesh(boxGeo(w, d, h, b), nylon(main)); g.add(body);
      const bands = h > 1.5 ? [0.32, 0.68] : [0.5];
      for (const f of bands) { const band = new THREE.Mesh(boxGeo(w + 0.04, d + 0.04, 0.2, 0.07), nylon(acc)); band.position.y = h * f - 0.1; g.add(band); }
      bunker(g, [body], x, z, rot, { t: 'b', hw: w / 2, hd: d / 2 });
    };
  }
  function can(r, h, main, acc) {
    return (x, z) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(canGeo(r, h, Math.min(0.2, r * 0.35)), nylon(main)); g.add(body);
      const bands = h > 1.5 ? [0.33, 0.66] : [0.5];
      for (const f of bands) { const t = new THREE.Mesh(new THREE.TorusGeometry(r + 0.005, 0.05, 10, 40), nylon(acc)); t.rotation.x = Math.PI / 2; t.position.y = h * f; g.add(t); }
      bunker(g, [body], x, z, 0, { t: 'c', r });
    };
  }
  function dorito(R, h, main, acc) {
    return (x, z, rot) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(triGeo(R, h, 0.18), nylon(main)); g.add(body);
      const band = new THREE.Mesh(triGeo(R + 0.03, 0.2, 0.07), nylon(acc)); band.position.y = h * 0.55; g.add(band);
      bunker(g, [body], x, z, rot, { t: 'c', r: R * 0.72 });
    };
  }
  function snake(len, main, acc) {
    return (x, z, rot) => {
      const g = new THREE.Group(), r = 0.44, n = Math.round(len / 1.5), step = len / n, bodies = [];
      for (let i = 0; i < n; i++) {
        const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, step - 0.3, 8, 20), nylon(main));
        seg.rotation.z = Math.PI / 2; seg.position.set(-len / 2 + step * (i + 0.5), r, 0); seg.scale.set(1.04, 1, 1);
        g.add(seg); bodies.push(seg);
        if (i) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.93, 0.06, 10, 28), nylon(acc)); ring.rotation.y = Math.PI / 2; ring.position.set(-len / 2 + step * i, r, 0); g.add(ring); }
      }
      bunker(g, bodies, x, z, rot, { t: 'b', hw: len / 2 + r, hd: r });
    };
  }

  const B = {
    brick: box(1.0, 2.6, 1.25, 0xf3f3f3, 0xff3b30),
    lowbrick: box(2.3, 0.9, 1.05, 0xf3f3f3, 0xff3b30),
    temple: box(1.3, 2.6, 1.85, 0x00c2a8, 0x0d3b66),
    maya: box(1.45, 1.45, 2.5, 0x00c2a8, 0x0d3b66),
    can: can(0.6, 1.9, 0x1fb5ff, 0xffffff),
    tallcan: can(0.66, 2.45, 0x7b2ff7, 0xffcc00),
    minican: can(0.5, 1.15, 0x1fb5ff, 0xffffff),
    cake: can(1.7, 1.1, 0xff2d6f, 0xffffff),
    dorito: dorito(1.05, 1.3, 0xff7a00, 0xffffff),
    snake: snake(10, 0xffcc00, 0x1b1b1b),
  };
  // mirrored layout: every piece on the blue half gets a twin on the red half
  const place = (fn, x, z, rot = 0) => { fn(x, z, rot); fn(-x, z, Math.PI - rot); };
  place(B.brick, -21, 0);
  place(B.can, -17.5, -5); place(B.can, -17.5, 5);
  place(B.temple, -13.5, 2.6);
  place(B.maya, -10, -5.5, 0.35);
  place(B.minican, -8, 3);
  place(B.lowbrick, -6, -2, 0.3);
  place(B.tallcan, -4.5, 6.5);
  place(B.dorito, -12.5, 10.5, 0.4); place(B.dorito, -7, 12.6, -0.3); place(B.dorito, -19, 10.5, 1);
  place(B.lowbrick, -18.5, -11, 0);
  place(B.snake, -9, -13, 0);
  B.cake(0, 0, 0);
  B.dorito(0, 11.3, Math.PI / 2);
  B.temple(0, -8.5, Math.PI / 2);
  scene.updateMatrixWorld(true);

  // cover spots around every bunker
  const cover = [];
  const off = 0.38 + 0.4;
  for (const s of shapes) {
    const local = s.t === 'c'
      ? [...Array(8)].map((_, i) => [Math.cos(i * Math.PI / 4) * (s.r + off), Math.sin(i * Math.PI / 4) * (s.r + off)])
      : [[s.hw + off, 0], [-s.hw - off, 0], [0, s.hd + off], [0, -s.hd - off],
         ...(s.hw > 1.2 ? [[s.hw * 0.6, s.hd + off], [-s.hw * 0.6, s.hd + off], [s.hw * 0.6, -s.hd - off], [-s.hw * 0.6, -s.hd - off]] : []),
         ...(s.hd > 1.2 ? [[s.hw + off, s.hd * 0.6], [s.hw + off, -s.hd * 0.6], [-s.hw - off, s.hd * 0.6], [-s.hw - off, -s.hd * 0.6]] : [])];
    for (const [lx, lz] of local) {
      const [x, z] = s.t === 'c' ? [s.x + lx, s.z + lz] : toWorld(s, lx, lz);
      if (Math.abs(x) < BOUND.hw - 0.6 && Math.abs(z) < BOUND.hd - 0.6 && !insideAny(x, z, 0.36)) cover.push({ x, z });
    }
  }

  // ---- paint decals ----
  const splatTex = [...Array(6)].map(splatTexture);
  const decalMats = TEAMS.map((t) => splatTex.map((map) => new THREE.MeshStandardMaterial({
    map, color: t.paint, transparent: true, depthWrite: false, roughness: 0.3,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  })));
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  const pool = [], POOL = high ? 700 : 300;
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
  }
  function clearSplats() { for (const m of pool) if (m) m.removeFromParent(); }

  // paint mist puffs
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

  return { renderer, scene, camera, bunkerMeshes, cover, addSplat, clearSplats, puff, update };
}
