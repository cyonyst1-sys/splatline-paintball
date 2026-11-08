// Procedural tournament-style paintball marker (real-world scale, metres).
// Local axes: +x toward the muzzle, +y up, z across. Origin sits at the trigger.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const ANO = [0x2a6cff, 0xff2b4a];   // anodised body colour per team
const PAINT = [0x1ec8ff, 0xff2d8a];  // paint colour per team
const V2 = (x, y) => new THREE.Vector2(x, y);

// ---------- textures (shared) ----------
function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let assets = null;
function getAssets() {
  if (assets) return assets;
  const carbon = canvasTex(128, (g, S) => {
    const n = 8, s = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const horiz = (i + j) % 2 === 0;
      const gr = horiz ? g.createLinearGradient(i * s, 0, i * s + s, 0) : g.createLinearGradient(0, j * s, 0, j * s + s);
      gr.addColorStop(0, '#15171b'); gr.addColorStop(0.5, '#454a53'); gr.addColorStop(1, '#15171b');
      g.fillStyle = gr; g.fillRect(i * s, j * s, s, s);
    }
  });
  carbon.wrapS = carbon.wrapT = THREE.RepeatWrapping; carbon.repeat.set(10, 4);
  const grip = canvasTex(64, (g, S) => {
    g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#ffffff'; g.lineWidth = 5;
    for (let k = -S; k <= S * 2; k += 16) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + S, S); g.stroke();
      g.beginPath(); g.moveTo(k, S); g.lineTo(k + S, 0); g.stroke();
    }
  }, false);
  grip.wrapS = grip.wrapT = THREE.RepeatWrapping; grip.repeat.set(70, 70);
  const gauge = canvasTex(128, (g, S) => {
    const c = S / 2;
    g.fillStyle = '#f4f4f0'; g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 3;
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + i / 10 * Math.PI * 1.5;
      g.beginPath(); g.moveTo(c + Math.cos(a) * c * 0.62, c + Math.sin(a) * c * 0.62); g.lineTo(c + Math.cos(a) * c * 0.82, c + Math.sin(a) * c * 0.82); g.stroke();
    }
    g.strokeStyle = '#2bb24c'; g.lineWidth = 8; g.beginPath(); g.arc(c, c, c * 0.72, Math.PI * 1.55, Math.PI * 2.1); g.stroke();
    g.strokeStyle = '#d62828'; g.lineWidth = 5; g.beginPath(); g.moveTo(c, c);
    const n = Math.PI * 1.85; g.lineTo(c + Math.cos(n) * c * 0.7, c + Math.sin(n) * c * 0.7); g.stroke();
    g.fillStyle = '#222'; g.beginPath(); g.arc(c, c, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 8; g.beginPath(); g.arc(c, c, c - 4, 0, Math.PI * 2); g.stroke();
  });
  assets = { carbon, grip, gauge, mats: {} };
  return assets;
}
function mats(team) {
  const A = getAssets();
  if (A.mats[team]) return A.mats[team];
  const M = {
    ano: new THREE.MeshPhysicalMaterial({ color: ANO[team], metalness: 0.85, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.25 }),
    dark: new THREE.MeshPhysicalMaterial({ color: 0x1d2026, metalness: 0.8, roughness: 0.35, clearcoat: 0.2 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 1, roughness: 0.2 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.9, bumpMap: A.grip, bumpScale: 0.6 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.45 }),
    shell: new THREE.MeshPhysicalMaterial({ color: 0x46525e, roughness: 0.06, clearcoat: 1, transparent: true, opacity: 0.42, depthWrite: false }),
    lid: new THREE.MeshPhysicalMaterial({ color: ANO[team], roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    carbon: new THREE.MeshPhysicalMaterial({ map: A.carbon, roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }),
    paint: new THREE.MeshPhysicalMaterial({ color: PAINT[team], roughness: 0.15, clearcoat: 1 }),
    gauge: new THREE.MeshStandardMaterial({ map: A.gauge, roughness: 0.15 }),
    led: new THREE.MeshBasicMaterial({ color: 0x39ff88 }),
    bore: new THREE.MeshBasicMaterial({ color: 0x050506 }),
  };
  A.mats[team] = M;
  return M;
}

// ---------- geometry helpers ----------
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
const toV = (pts) => pts.map(([x, y]) => V2(x, y));
function smooth(geo, keepUV) {
  if (!keepUV) geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-6);
  geo.computeVertexNormals();
  return geo;
}
// Extrude a 2D side profile (x, y) across z, centred, with rounded machined edges.
function slab(shape, depth, bevel, keepUV = false) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8, steps: 1 });
  g.translate(0, 0, -depth / 2);
  return smooth(g, keepUV);
}
const lathe = (pts, seg) => new THREE.LatheGeometry(toV(pts), seg);
function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m;
}

/**
 * Build a marker.
 * @param {number} team 0 blue, 1 red
 * @param {{detail?: 'high'|'low', barrel?: number, hopper?: number, tank?: number}} o
 *   barrel/hopper/tank are upgrade levels; they lengthen the barrel, grow the hopper and the tank.
 */
export function makeMarker(team, o = {}) {
  const hi = o.detail !== 'low';
  const M = mats(team);
  const root = new THREE.Group();
  const seg = hi ? 32 : 12;

  // --- body ---
  add(root, slab(roundedPoly(toV([[-0.10, 0.006], [0.15, 0.006], [0.172, 0.022], [0.172, 0.054], [0.145, 0.066], [-0.055, 0.066], [-0.10, 0.05]]), 0.008), 0.026, 0.004), M.ano);
  add(root, new THREE.BoxGeometry(0.15, 0.004, 0.016), M.dark, 0.03, 0.071, 0); // top rail
  add(root, new THREE.CylinderGeometry(0.012, 0.012, 0.012, seg).rotateZ(Math.PI / 2), M.silver, -0.106, 0.032, 0); // bolt cap
  for (const side of [-1, 1]) {
    add(root, new THREE.BoxGeometry(0.032, 0.02, 0.004), M.dark, 0.045, 0.032, side * 0.0185); // eye covers
    if (hi) {
      for (const [cx, w] of [[-0.055, 0.05], [0.125, 0.03]]) { // milled pockets
        const p = add(root, new THREE.ShapeGeometry(roundedPoly(toV([[-w / 2, -0.007], [w / 2, -0.007], [w / 2, 0.007], [-w / 2, 0.007]]), 0.006)), M.dark, cx, 0.036, side * 0.0172);
        if (side < 0) p.rotation.y = Math.PI;
      }
      add(root, new THREE.SphereGeometry(0.0022, 8, 6), M.led, -0.085, 0.045, side * 0.0172);
    }
  }

  // --- feed neck + hopper ---
  add(root, new THREE.CylinderGeometry(0.017, 0.017, 0.032, seg), M.ano, 0.06, 0.084, 0);
  add(root, new THREE.TorusGeometry(0.0188, 0.0035, 8, seg).rotateX(Math.PI / 2), M.dark, 0.06, 0.094, 0);
  add(root, new THREE.BoxGeometry(0.026, 0.006, 0.006), M.silver, 0.08, 0.094, 0.017);
  const hs = 1 + (o.hopper || 0) * 0.09;
  const rx = 0.11 * hs, ry = 0.07 * hs, rz = 0.058 * hs, hy = 0.098 + ry, hx = 0.035;
  if (hi) {
    const shell = add(root, new THREE.SphereGeometry(1, 40, 28), M.shell, hx, hy, 0); shell.scale.set(rx, ry, rz); shell.renderOrder = 3;
    const lid = add(root, new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, 1.05), M.lid, hx, hy, 0); lid.scale.set(rx * 1.006, ry * 1.006, rz * 1.006);
    const band = add(root, new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), M.dark, hx, hy, 0); band.scale.set(rx * 1.012, 0.008, rz * 1.012);
    const n = 46, balls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0086, 10, 8), M.paint, n);
    const m4 = new THREE.Matrix4();
    for (let i = 0, k = 0; i < n && k < 2000; k++) {
      const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
      if (x * x + y * y + z * z > 1 || y > 0.25) continue;
      m4.makeTranslation(hx + x * (rx - 0.012), hy + y * (ry - 0.012), z * (rz - 0.012));
      balls.setMatrixAt(i++, m4);
    }
    root.add(balls);
  } else {
    const shell = add(root, new THREE.SphereGeometry(1, 16, 12), M.lid, hx, hy, 0); shell.scale.set(rx, ry, rz);
  }

  // --- barrel ---
  const T = 0.33 + (o.barrel || 0) * 0.025, bx = 0.176, by = 0.036;
  const barrel = lathe([[0, 0], [0.017, 0], [0.017, 0.004], [0.016, 0.007], [0.016, 0.108], [0.0178, 0.111], [0.0178, 0.124], [0.0134, 0.128],
    [0.0125, 0.132], [0.0125, T - 0.012], [0.0143, T - 0.009], [0.0143, T], [0.0092, T], [0.0088, T - 0.02]], seg).rotateZ(-Math.PI / 2);
  add(root, barrel, M.dark, bx, by, 0);
  add(root, new THREE.CylinderGeometry(0.0182, 0.0182, 0.012, seg).rotateZ(Math.PI / 2), M.ano, bx + 0.117, by, 0);
  add(root, new THREE.CircleGeometry(0.0088, 16).rotateY(Math.PI / 2), M.bore, bx + T - 0.018, by, 0);
  if (hi) {
    const start = bx + 0.16, end = bx + T - 0.03, step = 0.018, rings = Math.floor((end - start) / step);
    for (let i = 0; i <= rings; i++) add(root, new THREE.TorusGeometry(0.0126, 0.0011, 6, 24).rotateY(Math.PI / 2), M.bore, start + i * step, by, 0);
    const ports = new THREE.InstancedMesh(new THREE.BoxGeometry(0.009, 0.0018, 0.0042), M.bore, rings * 4);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0), one = new THREE.Vector3(1, 1, 1);
    let k = 0;
    for (let i = 0; i < rings; i++) for (let j = 0; j < 4; j++) {
      const a = j * Math.PI / 2 + (i % 2) * Math.PI / 4;
      q.setFromAxisAngle(ax, a);
      m4.compose(new THREE.Vector3(start + (i + 0.5) * step, by + Math.cos(a) * 0.0122, Math.sin(a) * 0.0122), q, one);
      ports.setMatrixAt(k++, m4);
    }
    root.add(ports);
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(bx + T + 0.01, by, 0); root.add(muzzle);
  root.userData.muzzle = muzzle;

  // --- grip frame, trigger ---
  const guard = roundedPoly(toV([[-0.03, 0.004], [0.092, 0.004], [0.092, -0.068], [-0.03, -0.068]]), 0.012);
  guard.holes.push(roundedPoly(toV([[-0.016, -0.004], [0.08, -0.004], [0.08, -0.056], [-0.016, -0.056]]), 0.01));
  add(root, slab(guard, 0.01, 0.002), M.ano);
  const blade = new THREE.Shape();
  blade.moveTo(0.028, -0.002); blade.quadraticCurveTo(0.046, -0.024, 0.037, -0.048); blade.lineTo(0.029, -0.048);
  blade.quadraticCurveTo(0.035, -0.026, 0.018, -0.002); blade.closePath();
  add(root, slab(blade, 0.006, 0.0015), M.silver);
  add(root, slab(roundedPoly(toV([[0.088, 0.004], [0.128, 0.004], [0.124, -0.105], [0.094, -0.108]]), 0.01), 0.022, 0.005, true), M.rubber); // front grip
  add(root, slab(roundedPoly(toV([[-0.042, 0.006], [-0.004, 0.006], [-0.026, -0.118], [-0.07, -0.112]]), 0.012), 0.028, 0.005, true), M.rubber); // rear grip

  // --- air system ---
  const ay = -0.127;
  add(root, slab(roundedPoly(toV([[-0.1, -0.11], [-0.02, -0.11], [-0.02, -0.142], [-0.1, -0.142]]), 0.006), 0.03, 0.004), M.ano); // ASA
  add(root, new THREE.CylinderGeometry(0.021, 0.021, 0.05, seg).rotateZ(Math.PI / 2), M.silver, -0.125, ay, 0); // regulator
  const tr = 0.048 * (1 + (o.tank || 0) * 0.08), tl = 0.24 + (o.tank || 0) * 0.03, tx = -0.15;
  const tank = lathe([[0, 0], [0.016, 0], [0.016, 0.02], [0.02, 0.024], [tr * 0.6, 0.035], [tr * 0.9, 0.05], [tr, 0.07],
    [tr, tl - 0.04], [tr * 0.9, tl - 0.015], [tr * 0.6, tl - 0.003], [0, tl]], hi ? 40 : 14).rotateZ(Math.PI / 2);
  add(root, tank, hi ? M.carbon : M.dark, tx, ay, 0);
  if (hi) {
    add(root, new THREE.CylinderGeometry(0.011, 0.011, 0.008, 24).rotateX(Math.PI / 2), M.dark, -0.12, ay, 0.025);
    add(root, new THREE.CircleGeometry(0.0095, 24), M.gauge, -0.12, ay, 0.0292);
    add(root, new THREE.CylinderGeometry(tr + 0.0012, tr + 0.0012, 0.05, 40, 1, true).rotateZ(Math.PI / 2), M.ano, tx - 0.12, ay, 0);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.03, -0.128, 0.02), new THREE.Vector3(0.02, -0.16, 0.026),
      new THREE.Vector3(0.09, -0.142, 0.02), new THREE.Vector3(0.106, -0.11, 0.013),
    ]);
    add(root, new THREE.TubeGeometry(curve, 28, 0.0035, 8), M.plastic);
    add(root, new THREE.CylinderGeometry(0.006, 0.006, 0.012, 12).rotateZ(Math.PI / 2), M.silver, -0.034, -0.128, 0.02);
    add(root, new THREE.CylinderGeometry(0.006, 0.006, 0.012, 12), M.silver, 0.106, -0.106, 0.013);
  }

  return root;
}

export function disposeMarker(root) {
  root.traverse((m) => { if (m.geometry) m.geometry.dispose(); });
}
