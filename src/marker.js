// Procedural paintball markers and hoppers (real-world scale, metres).
// Local axes: +x toward the muzzle, +y up, z across. Origin sits at the trigger.
// Types: tourney (electro), cocker (Autococker: back block, bolt and pump arm cycle every shot),
// pump (stock-class, pump handle cycles), milsim (carbine with stock and red-dot sight).
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const ANO = [0x2a6cff, 0xff2b4a];   // anodised body colour per team
const PAINT = [0x1ec8ff, 0xff2d8a];  // paint colour per team
const V2 = (x, y) => new THREE.Vector2(x, y);
const PI = Math.PI;

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
    g.fillStyle = '#f4f4f0'; g.beginPath(); g.arc(c, c, c, 0, PI * 2); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 3;
    for (let i = 0; i <= 10; i++) {
      const a = PI * 0.75 + i / 10 * PI * 1.5;
      g.beginPath(); g.moveTo(c + Math.cos(a) * c * 0.62, c + Math.sin(a) * c * 0.62); g.lineTo(c + Math.cos(a) * c * 0.82, c + Math.sin(a) * c * 0.82); g.stroke();
    }
    g.strokeStyle = '#2bb24c'; g.lineWidth = 8; g.beginPath(); g.arc(c, c, c * 0.72, PI * 1.55, PI * 2.1); g.stroke();
    g.strokeStyle = '#d62828'; g.lineWidth = 5; g.beginPath(); g.moveTo(c, c);
    const n = PI * 1.85; g.lineTo(c + Math.cos(n) * c * 0.7, c + Math.sin(n) * c * 0.7); g.stroke();
    g.fillStyle = '#222'; g.beginPath(); g.arc(c, c, 7, 0, PI * 2); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 8; g.beginPath(); g.arc(c, c, c - 4, 0, PI * 2); g.stroke();
  });
  const wood = canvasTex(128, (g, S) => {
    g.fillStyle = '#6b4226'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(${30 + Math.random() * 40},${15 + Math.random() * 20},5,.35)`; g.lineWidth = Math.random() * 2 + 0.5; const y = Math.random() * S; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + 4, S * 0.6, y - 4, S, y); g.stroke(); }
  });
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.repeat.set(6, 2);
  assets = { carbon, grip, gauge, wood, mats: {} };
  return assets;
}
const SHELLS = { smoke: 0x46525e, clear: 0xc8dbe6, black: 0x15171a };
function mats(team) {
  const A = getAssets();
  if (A.mats[team]) return A.mats[team];
  const M = {
    ano: new THREE.MeshPhysicalMaterial({ color: ANO[team], metalness: 0.85, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.25 }),
    dark: new THREE.MeshPhysicalMaterial({ color: 0x1d2026, metalness: 0.8, roughness: 0.35, clearcoat: 0.2 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 1, roughness: 0.2 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a44a, metalness: 1, roughness: 0.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.9, bumpMap: A.grip, bumpScale: 0.6 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.45 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x3d4426, roughness: 0.6, metalness: 0.2 }),
    wood: new THREE.MeshStandardMaterial({ map: A.wood, roughness: 0.6 }),
    shell: Object.fromEntries(Object.entries(SHELLS).map(([k, c]) => [k, new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.06, clearcoat: 1, transparent: true, opacity: k === 'black' ? 0.92 : 0.42, depthWrite: false })])),
    lid: new THREE.MeshPhysicalMaterial({ color: ANO[team], roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    carbon: new THREE.MeshPhysicalMaterial({ map: A.carbon, roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }),
    paint: new THREE.MeshPhysicalMaterial({ color: PAINT[team], roughness: 0.15, clearcoat: 1 }),
    gauge: new THREE.MeshStandardMaterial({ map: A.gauge, roughness: 0.15 }),
    led: new THREE.MeshBasicMaterial({ color: 0x39ff88 }),
    red: new THREE.MeshBasicMaterial({ color: 0xff2020 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x5fa8ff, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.5 }),
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
const rectPts = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function smooth(geo, keepUV) {
  if (!keepUV) geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-6);
  geo.computeVertexNormals();
  return geo;
}
function slab(shape, depth, bevel, keepUV = false) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8, steps: 1 });
  g.translate(0, 0, -depth / 2);
  return smooth(g, keepUV);
}
const lathe = (pts, seg) => new THREE.LatheGeometry(toV(pts), seg);
function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m;
}
const cylX = (r, len, seg) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(PI / 2);

// ---------- shared parts ----------
function barrel(root, M, hi, seg, bx, by, T, mat = M.dark) {
  add(root, lathe([[0, 0], [0.017, 0], [0.017, 0.004], [0.016, 0.007], [0.016, 0.108], [0.0178, 0.111], [0.0178, 0.124], [0.0134, 0.128],
    [0.0125, 0.132], [0.0125, T - 0.012], [0.0143, T - 0.009], [0.0143, T], [0.0092, T], [0.0088, T - 0.02]], seg).rotateZ(-PI / 2), mat, bx, by, 0);
  add(root, new THREE.CircleGeometry(0.0088, 16).rotateY(PI / 2), M.bore, bx + T - 0.018, by, 0);
  if (hi) {
    const start = bx + 0.16, end = bx + T - 0.03, step = 0.018, rings = Math.floor((end - start) / step);
    for (let i = 0; i <= rings; i++) add(root, new THREE.TorusGeometry(0.0126, 0.0011, 6, 24).rotateY(PI / 2), M.bore, start + i * step, by, 0);
  }
  return { x: bx + T + 0.01, y: by };
}
function triggerGroup(root, M, x0 = 0) {
  const guard = roundedPoly(toV(rectPts(x0 - 0.03, -0.068, x0 + 0.092, 0.004)), 0.012);
  guard.holes.push(roundedPoly(toV(rectPts(x0 - 0.016, -0.056, x0 + 0.08, -0.004)), 0.01));
  add(root, slab(guard, 0.01, 0.002), M.ano);
  const blade = new THREE.Shape();
  blade.moveTo(x0 + 0.028, -0.002); blade.quadraticCurveTo(x0 + 0.046, -0.024, x0 + 0.037, -0.048); blade.lineTo(x0 + 0.029, -0.048);
  blade.quadraticCurveTo(x0 + 0.035, -0.026, x0 + 0.018, -0.002); blade.closePath();
  add(root, slab(blade, 0.006, 0.0015), M.silver);
}
function rearGrip(root, M, x0 = 0, mat = M.rubber) {
  add(root, slab(roundedPoly(toV([[x0 - 0.042, 0.006], [x0 - 0.004, 0.006], [x0 - 0.026, -0.118], [x0 - 0.07, -0.112]]), 0.012), 0.028, 0.005, true), mat);
}
function frontGrip(root, M, x0 = 0.088) {
  add(root, slab(roundedPoly(toV([[x0, 0.004], [x0 + 0.04, 0.004], [x0 + 0.036, -0.105], [x0 + 0.006, -0.108]]), 0.01), 0.022, 0.005, true), M.rubber);
}
// ASA + regulator + tank screwed in under the rear grip, pointing back
function airSystem(root, M, hi, seg, o, ax = -0.06, ay = -0.127, carbon = true) {
  add(root, slab(roundedPoly(toV(rectPts(ax - 0.04, ay + 0.017, ax + 0.04, ay - 0.015)), 0.006), 0.03, 0.004), M.ano);
  add(root, cylX(0.021, 0.05, seg), M.silver, ax - 0.065, ay, 0);
  const tr = 0.048 * (1 + (o.tank || 0) * 0.08), tl = 0.24 + (o.tank || 0) * 0.03, tx = ax - 0.09;
  add(root, lathe([[0, 0], [0.016, 0], [0.016, 0.02], [0.02, 0.024], [tr * 0.6, 0.035], [tr * 0.9, 0.05], [tr, 0.07],
    [tr, tl - 0.04], [tr * 0.9, tl - 0.015], [tr * 0.6, tl - 0.003], [0, tl]], hi ? 40 : 14).rotateZ(PI / 2), hi && carbon ? M.carbon : M.dark, tx, ay, 0);
  if (hi) {
    add(root, new THREE.CylinderGeometry(0.011, 0.011, 0.008, 24).rotateX(PI / 2), M.dark, ax - 0.06, ay, 0.025);
    add(root, new THREE.CircleGeometry(0.0095, 24), M.gauge, ax - 0.06, ay, 0.0292);
    add(root, new THREE.CylinderGeometry(tr + 0.0012, tr + 0.0012, 0.05, 40, 1, true).rotateZ(PI / 2), M.ano, tx - 0.12, ay, 0);
  }
}
function feedNeck(root, M, seg, x, y) {
  add(root, new THREE.CylinderGeometry(0.017, 0.017, 0.032, seg), M.ano, x, y + 0.016, 0);
  add(root, new THREE.TorusGeometry(0.0188, 0.0035, 8, seg).rotateX(PI / 2), M.dark, x, y + 0.026, 0);
  return { x, y: y + 0.032 };
}

// ---------- marker types ----------
const BUILDERS = {
  // electronic tournament marker
  tourney(root, M, hi, seg, o) {
    add(root, slab(roundedPoly(toV([[-0.10, 0.006], [0.15, 0.006], [0.172, 0.022], [0.172, 0.054], [0.145, 0.066], [-0.055, 0.066], [-0.10, 0.05]]), 0.008), 0.026, 0.004), M.ano);
    add(root, new THREE.BoxGeometry(0.15, 0.004, 0.016), M.dark, 0.03, 0.071, 0);
    add(root, cylX(0.012, 0.012, seg), M.silver, -0.106, 0.032, 0);
    for (const s of [-1, 1]) {
      add(root, new THREE.BoxGeometry(0.032, 0.02, 0.004), M.dark, 0.045, 0.032, s * 0.0185);
      if (hi) add(root, new THREE.SphereGeometry(0.0022, 8, 6), M.led, -0.085, 0.045, s * 0.0172);
    }
    const feed = feedNeck(root, M, seg, 0.06, 0.068);
    const muzzle = barrel(root, M, hi, seg, 0.176, 0.036, 0.33 + (o.barrel || 0) * 0.025);
    add(root, cylX(0.0182, 0.012, seg), M.ano, 0.293, 0.036, 0);
    triggerGroup(root, M); frontGrip(root, M); rearGrip(root, M);
    airSystem(root, M, hi, seg, o);
    return { feed, muzzle, cyclers: [] };
  },

  // Autococker: slim body, front block with ram and LPR, pump arm, back block and bolt that cycle every shot
  cocker(root, M, hi, seg, o) {
    add(root, slab(roundedPoly(toV(rectPts(-0.13, 0.018, 0.16, 0.064)), 0.012), 0.024, 0.004), M.ano);          // body
    add(root, slab(roundedPoly(toV(rectPts(0.085, -0.03, 0.168, 0.018)), 0.006), 0.026, 0.003), M.dark);        // front block
    add(root, cylX(0.011, 0.085, seg), M.silver, 0.12, -0.012, 0);                                                // ram
    add(root, new THREE.CylinderGeometry(0.012, 0.012, 0.05, seg), M.silver, 0.152, -0.058, 0);                   // low-pressure regulator
    add(root, new THREE.BoxGeometry(0.03, 0.016, 0.02), M.dark, 0.02, 0.006, 0);                                   // 3-way
    // the moving parts
    const back = new THREE.Group(); back.position.set(-0.095, 0.078, 0); root.add(back);
    add(back, slab(roundedPoly(toV(rectPts(-0.03, -0.014, 0.03, 0.014)), 0.006), 0.026, 0.003), M.dark);         // back block
    add(back, cylX(0.009, 0.018, seg), M.silver, -0.041, 0, 0);                                                   // cocking knob
    add(back, new THREE.CylinderGeometry(0.0035, 0.0035, 0.02, 10), M.brass, 0.012, -0.018, 0);                  // bolt pin
    const bolt = add(root, cylX(0.0085, 0.05, seg), M.silver, -0.148, 0.042, 0);                                  // bolt out the back
    const rod = add(root, cylX(0.0036, 0.24, 10), M.silver, 0.03, 0.073, 0.016);                                  // pump arm
    add(root, new THREE.BoxGeometry(0.06, 0.01, 0.012), M.dark, -0.06, 0.07, 0.016);                               // rod guide
    if (hi) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.02, -0.002, 0.012), new THREE.Vector3(0.07, -0.05, 0.02), new THREE.Vector3(0.14, -0.07, 0.014)]);
      add(root, new THREE.TubeGeometry(curve, 16, 0.003, 6), M.plastic);
      for (let i = 0; i < 4; i++) add(root, new THREE.BoxGeometry(0.004, 0.03, 0.025), M.dark, -0.1 + i * 0.012, 0.042, 0); // milled lines
    }
    const feed = feedNeck(root, M, seg, 0.035, 0.064);
    const muzzle = barrel(root, M, hi, seg, 0.168, 0.042, 0.36 + (o.barrel || 0) * 0.025);
    triggerGroup(root, M, -0.01); rearGrip(root, M, -0.01); frontGrip(root, M, 0.1);
    airSystem(root, M, hi, seg, o, -0.07);
    return { feed, muzzle, cyclers: [back, bolt, rod], cycleDur: 0.11, cycleDist: 0.032 };
  },

  // stock-class pump: round tube body, pump handle under the barrel, wooden stock
  pump(root, M, hi, seg, o) {
    add(root, cylX(0.02, 0.27, seg), M.dark, 0.02, 0.04, 0);                                                      // body tube
    add(root, cylX(0.021, 0.02, seg), M.ano, -0.11, 0.04, 0);
    add(root, cylX(0.0055, 0.24, 10), M.silver, 0.13, 0.004, 0);                                                  // pump rod
    const handle = new THREE.Group(); handle.position.set(0.18, 0.004, 0); root.add(handle);
    add(handle, slab(roundedPoly(toV(rectPts(-0.045, -0.022, 0.045, 0.014)), 0.01), 0.028, 0.004, true), M.rubber);
    for (let i = -2; i <= 2; i++) add(handle, new THREE.BoxGeometry(0.004, 0.038, 0.036), M.plastic, i * 0.016, -0.004, 0);
    const feed = feedNeck(root, M, seg, 0.05, 0.06);
    const muzzle = barrel(root, M, hi, seg, 0.155, 0.04, 0.38 + (o.barrel || 0) * 0.025);
    triggerGroup(root, M, 0); rearGrip(root, M, 0, M.wood);
    // wooden stock with a 12-gram/air bottle inside
    add(root, slab(roundedPoly(toV([[-0.12, 0.055], [-0.12, 0.0], [-0.33, -0.06], [-0.35, -0.06], [-0.35, 0.05], [-0.33, 0.06]]), 0.012), 0.032, 0.006, true), M.wood);
    add(root, new THREE.BoxGeometry(0.012, 0.13, 0.036), M.rubber, -0.356, -0.005, 0);
    return { feed, muzzle, cyclers: [handle], cycleDur: 0.28, cycleDist: 0.06 };
  },

  // milsim carbine: boxy upper with rail and red dot, shrouded barrel, collapsible stock, magazine-style ASA
  milsim(root, M, hi, seg, o) {
    add(root, slab(roundedPoly(toV(rectPts(-0.12, 0.004, 0.17, 0.07)), 0.006), 0.034, 0.003), M.olive);          // receiver
    add(root, new THREE.BoxGeometry(0.22, 0.008, 0.022), M.dark, 0.03, 0.078, 0);                                  // top rail
    for (let i = 0; i < 12; i++) add(root, new THREE.BoxGeometry(0.008, 0.006, 0.024), M.dark, -0.07 + i * 0.019, 0.084, 0);
    add(root, slab(roundedPoly(toV(rectPts(0.17, -0.02, 0.36, 0.068)), 0.01), 0.04, 0.004), M.olive);            // handguard
    for (let i = 0; i < 6 && hi; i++) add(root, new THREE.BoxGeometry(0.018, 0.012, 0.046), M.dark, 0.2 + i * 0.028, 0.025, 0);
    // red-dot sight at the back of the rail
    add(root, new THREE.BoxGeometry(0.05, 0.022, 0.03), M.dark, -0.065, 0.098, 0);
    add(root, cylX(0.016, 0.05, seg), M.dark, -0.065, 0.122, 0);
    add(root, new THREE.CircleGeometry(0.013, 16).rotateY(PI / 2), M.glass, -0.039, 0.122, 0);
    if (hi) add(root, new THREE.SphereGeometry(0.0018, 6, 4), M.red, -0.045, 0.122, 0);
    const feed = feedNeck(root, M, seg, 0.06, 0.074);
    const muzzle = barrel(root, M, hi, seg, 0.36, 0.04, 0.2 + (o.barrel || 0) * 0.025);
    add(root, slab(roundedPoly(toV(rectPts(0.06, -0.09, 0.105, 0.004)), 0.01), 0.03, 0.004), M.dark);           // magazine-style ASA
    triggerGroup(root, M, -0.02); rearGrip(root, M, -0.02, M.plastic);
    // collapsible stock with a buffer tube
    add(root, cylX(0.016, 0.16, seg), M.dark, -0.2, 0.04, 0);
    add(root, slab(roundedPoly(toV([[-0.24, 0.062], [-0.24, -0.01], [-0.32, -0.07], [-0.34, -0.07], [-0.34, 0.07], [-0.3, 0.07]]), 0.01), 0.03, 0.005), M.olive);
    add(root, new THREE.BoxGeometry(0.012, 0.14, 0.034), M.rubber, -0.346, 0, 0);
    // remote air line to a tank in the stock area
    if (hi) add(root, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.08, -0.09, 0.012), new THREE.Vector3(-0.05, -0.12, 0.02), new THREE.Vector3(-0.22, -0.06, 0.018)]), 20, 0.004, 6), M.plastic);
    return { feed, muzzle, cyclers: [] };
  },
};

// ---------- hoppers ----------
function hopper(root, M, hi, type, feed, s, shellKey) {
  const hx = feed.x, base = feed.y;
  const shell = M.shell[shellKey] || M.shell.smoke;
  const balls = (n, inside) => {
    if (!hi) return;
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0086, 10, 8), M.paint, n), m4 = new THREE.Matrix4();
    for (let i = 0, k = 0; i < n && k < 3000; k++) { const p = inside(); if (p) { m4.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(i++, m4); } }
    root.add(im);
  };
  if (type === 'gravity') { // tall clear bottle
    const r = 0.05 * s, h = 0.2 * s, cy = base + h / 2;
    add(root, new THREE.CylinderGeometry(r, r * 0.9, h, 28, 1, true), shell, hx, cy, 0).renderOrder = 3;
    add(root, new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.03, 28), M.lid, hx, base + h + 0.012, 0);
    add(root, new THREE.CylinderGeometry(r * 0.9, r * 0.6, 0.03, 28), M.dark, hx, base + 0.012, 0);
    balls(hi ? 60 : 0, () => [hx + (Math.random() * 2 - 1) * (r - 0.01), base + 0.03 + Math.random() * (h * 0.7), (Math.random() * 2 - 1) * (r - 0.01)]);
    return;
  }
  if (type === 'speed') { // low-profile force-fed loader
    const rx = 0.12 * s, ry = 0.052 * s, rz = 0.06 * s, hy = base + ry * 0.9;
    const body = add(root, new THREE.SphereGeometry(1, 36, 20), M.shell.black, hx - 0.02, hy, 0); body.scale.set(rx, ry, rz);
    const lid = add(root, new THREE.SphereGeometry(1, 36, 10, 0, PI * 2, 0, 0.9), M.lid, hx - 0.02, hy + 0.003, 0); lid.scale.set(rx * 0.85, ry * 1.02, rz * 0.85);
    if (hi) {
      add(root, new THREE.BoxGeometry(rx * 1.2, 0.004, 0.004), M.led, hx - 0.02, hy, rz * 0.97);
      add(root, new THREE.BoxGeometry(rx * 1.2, 0.004, 0.004), M.led, hx - 0.02, hy, -rz * 0.97);
    }
    return;
  }
  // agitated (default): round smoky shell with paintballs visible inside
  const rx = 0.11 * s, ry = 0.07 * s, rz = 0.058 * s, hy = base + ry;
  if (hi) {
    const sh = add(root, new THREE.SphereGeometry(1, 40, 28), shell, hx, hy, 0); sh.scale.set(rx, ry, rz); sh.renderOrder = 3;
    const lid = add(root, new THREE.SphereGeometry(1, 40, 14, 0, PI * 2, 0, 1.05), M.lid, hx, hy, 0); lid.scale.set(rx * 1.006, ry * 1.006, rz * 1.006);
    const band = add(root, new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), M.dark, hx, hy, 0); band.scale.set(rx * 1.012, 0.008, rz * 1.012);
    balls(46, () => { const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, z = Math.random() * 2 - 1; return x * x + y * y + z * z > 1 || y > 0.25 ? null : [hx + x * (rx - 0.012), hy + y * (ry - 0.012), z * (rz - 0.012)]; });
  } else {
    const sh = add(root, new THREE.SphereGeometry(1, 16, 12), M.lid, hx, hy, 0); sh.scale.set(rx, ry, rz);
  }
}

/**
 * Build a marker.
 * @param {number} team 0 blue, 1 red
 * @param {{type?: string, hopperType?: string, shell?: string, detail?: 'high'|'low', barrel?: number, hopperLvl?: number, tank?: number}} o
 */
export function makeMarker(team, o = {}) {
  const hi = o.detail !== 'low';
  const M = mats(team);
  const root = new THREE.Group();
  const seg = hi ? 32 : 12;
  const info = (BUILDERS[o.type] || BUILDERS.tourney)(root, M, hi, seg, o);
  hopper(root, M, hi, o.hopperType || (o.type === 'pump' ? 'gravity' : 'agitated'), info.feed, 1 + (o.hopperLvl || 0) * 0.09, o.shell);
  const muzzle = new THREE.Object3D(); muzzle.position.set(info.muzzle.x, info.muzzle.y, 0); root.add(muzzle);
  // where the hands go: trigger grip, and the front grip / pump handle / handguard
  const FORE = { tourney: [0.108, -0.035], cocker: [0.12, -0.035], pump: [0.18, -0.004], milsim: [0.26, 0.02] }[o.type] || [0.108, -0.035];
  Object.assign(root.userData, { muzzle, cyclers: info.cyclers, cycleDur: info.cycleDur || 0.1, cycleDist: info.cycleDist || 0.03, cycleT: 0,
    grip: { x: -0.03, y: -0.05 }, fore: { x: FORE[0], y: FORE[1] } });
  for (const c of info.cyclers) c.userData.baseX = c.position.x;
  return root;
}
/** Start the action cycle (Autococker back block + bolt, pump handle) after a shot. */
export function cycleMarker(m) { if (m && m.userData.cyclers && m.userData.cyclers.length) m.userData.cycleT = m.userData.cycleDur; }
export function animateMarker(m, dt) {
  const u = m && m.userData; if (!u || !u.cycleT) return;
  u.cycleT = Math.max(0, u.cycleT - dt);
  const t = 1 - u.cycleT / u.cycleDur, off = Math.sin(t * PI) * u.cycleDist;
  for (const c of u.cyclers) c.position.x = c.userData.baseX - off;
}
export function disposeMarker(root) {
  root.traverse((m) => { if (m.geometry) m.geometry.dispose(); });
}
