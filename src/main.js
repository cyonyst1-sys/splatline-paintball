// Game loop, players, bots, shooting, menus and HUD.
import * as THREE from 'three';
import { createWorld, TEAMS, NETB, resolveCircle, segBlocked2D, segCircle } from './world.js';
import { save, persist, resetSave, UPGRADES, stat, costOf, buy, addCoins } from './economy.js';
import { sfx, initAudio, setListener, setVolume } from './audio.js';
import { makeMarker, disposeMarker } from './marker.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  net, onNet, available as netAvailable, host as netHost, join as netJoin, send as netSend,
  broadcast, sendTo, kick, leave as netLeave, cleanCode,
} from './net.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

const high = save.settings.quality !== 'low';
const canvas = $('c');
const world = createWorld(canvas, high);
const { renderer, scene, camera } = world;
setVolume(save.settings.volume);

const PR = 0.38, H_STAND = 1.8, H_CROUCH = 1.2, GRAV = 3.5, WIN_ROUNDS = 3;
const BOT = { ball: 46, mag: 20, reload: 1.6 };
const DIFF = {
  easy:   { err: 0.085, react: 0.9,  rate: 0.55, lead: 0.3,  speed: 3.6, sight: 28, reward: 0.75 },
  normal: { err: 0.055, react: 0.6,  rate: 0.36, lead: 0.6,  speed: 4.2, sight: 34, reward: 1 },
  hard:   { err: 0.03,  react: 0.35, rate: 0.25, lead: 0.9,  speed: 4.6, sight: 42, reward: 1.5 },
};
const REWARD = { tag: 25, round: 40, win: 150, play: 30 };

// ---------- models ----------
const G = {
  leg: new THREE.CapsuleGeometry(0.1, 0.6, 4, 8),
  torso: new THREE.CapsuleGeometry(0.23, 0.42, 6, 12),
  head: new THREE.SphereGeometry(0.15, 16, 12),
  mask: new THREE.BoxGeometry(0.12, 0.17, 0.27),
  lens: new THREE.BoxGeometry(0.04, 0.07, 0.24),
  arm: new THREE.CapsuleGeometry(0.06, 0.36, 4, 8),
  gunBody: new THREE.BoxGeometry(0.42, 0.09, 0.06),
  barrel: new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8),
  hopper: new THREE.SphereGeometry(0.085, 12, 10),
  tank: new THREE.CylinderGeometry(0.045, 0.045, 0.26, 10),
};
const M = {
  skin: new THREE.MeshStandardMaterial({ color: 0xd9a37f, roughness: 0.7 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.85 }),
  mask: new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.1, metalness: 0.6, emissive: 0x16304a }),
  gun: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.35, metalness: 0.6 }),
  tank: new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.35, metalness: 0.3 }),
  jersey: TEAMS.map((t) => new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.75 })),
  out: TEAMS.map((t) => new THREE.MeshStandardMaterial({ color: new THREE.Color(t.color).lerp(new THREE.Color(0x777777), 0.7), roughness: 0.9 })),
  paint: TEAMS.map((t) => new THREE.MeshStandardMaterial({ color: t.paint, roughness: 0.2, transparent: true, opacity: 0.9 })),
};
function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; }
function makeModel(team) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const legs = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(0, 0.82, s * 0.12);
    pivot.add(mesh(G.leg, M.pants, 0, -0.4, 0)); body.add(pivot); legs.push(pivot);
  }
  // upper body turns with where the player looks; legs follow the body heading
  const upper = new THREE.Group(); upper.rotation.order = 'YXZ'; body.add(upper);
  const torso = mesh(G.torso, M.jersey[team], 0, 1.15, 0); torso.scale.z = 1.12; upper.add(torso);
  upper.add(mesh(G.head, M.skin, 0, 1.58, 0));
  upper.add(mesh(G.mask, M.mask, 0.1, 1.56, 0));
  upper.add(mesh(G.lens, M.lens, 0.165, 1.6, 0));
  const gun = makeMarker(team, { detail: 'low' }); gun.position.set(0.24, 1.2, 0.13); upper.add(gun);
  const armR = mesh(G.arm, M.jersey[team], 0.18, 1.22, 0.18); armR.rotation.z = -1.35; upper.add(armR);
  const armL = mesh(G.arm, M.jersey[team], 0.28, 1.24, -0.06); armL.rotation.set(0.5, 0, -1.4); upper.add(armL);
  const armUp = mesh(G.arm, M.jersey[team], 0, 1.82, -0.26); armUp.visible = false; upper.add(armUp);
  root.traverse((m) => { if (m.isMesh) m.castShadow = high; });
  return { root, body, upper, legs, torso, arms: [armR, armL, armUp], armUp, gun };
}

// first-person marker
const vm = new THREE.Group();
vm.rotation.y = Math.PI / 2 + 0.06; // marker's +x forward → camera's -z, angled in a touch
vm.position.set(0.17, -0.19, -0.36);
vm.scale.setScalar(0.85);
camera.add(vm);
const VM_BASE = vm.position.clone();
let vmMuzzle = null;
const upgradeLook = () => ({ barrel: save.up.barrel, hopper: save.up.hopper, tank: save.up.velocity });
function buildViewmodel() {
  for (const c of [...vm.children]) { vm.remove(c); disposeMarker(c); }
  const me = players.find((p) => p.human);
  const m = makeMarker(me ? me.team : 0, upgradeLook());
  vm.add(m); vmMuzzle = m.userData.muzzle;
}

// ---------- state ----------
let players = [], balls = [], feed = [];
let state = 'home', prevState = 'playing', timer = 0, round = 1, score = [0, 0], lastWinner = 0;
// multiplayer: matchDiff is the host's difficulty; localPaused opens the menu without stopping a shared match
let matchDiff = save.settings.diff, myTeam = 0, localPaused = false, snapT = 0, poseT = 0;
let roundTime = 0; const HUNT_AFTER = 40; // seconds into a round before bots go looking for hiding players
let lobby = { code: '', mode: 'teams', players: [] };
let earned = null, specIdx = 0, locked = false, fallbackLook = false, hitMarker = 0, clock = 0, shopBack = 'home';
const keys = {}, mouse = { down: false };
const ray = new THREE.Raycaster();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const human = () => players.find((p) => p.human);
const inGame = () => state === 'countdown' || state === 'playing' || state === 'roundEnd';

function makePlayers() {
  for (let team = 0; team < 2; team++) for (let i = 0; i < 4; i++) {
    const model = makeModel(team); scene.add(model.root);
    players.push({
      team, i, human: false, ctrl: 'bot', peer: null, name: TEAMS[team].names[i], model,
      x: 0, z: 0, ang: 0, bodyAng: 0, pitch: 0, h: H_STAND, crouch: false, alive: true,
      diveT: 0, diveCd: 0, diveDir: 0, queued: 0, crouchOn: false, cWas: false, spaceWas: false, lean: 0,
      ammo: 20, mag: 20, reload: 0, reloadT: 1.6, cd: 0, cool: 0.3, spread: 1, ballSpeed: 46, kills: 0,
      vx: 0, vz: 0, mvx: 0, mvz: 0, phase: 0, moving: false, sprint: false,
      goal: null, goalT: 0, seen: 0, tgt: null, td: 0, scanT: 0, strafe: 1, strafeT: 0, stuckT: 0, lx: 0, lz: 0, avoid: 1, hold: false,
    });
  }
}
function resetPlayers() {
  world.clearSplats();
  for (const b of balls) freeBall(b);
  balls = [];
  for (const p of players) {
    p.x = p.team ? 22.5 : -22.5; p.z = -4.5 + p.i * 3;
    p.ang = p.bodyAng = p.team ? Math.PI : 0; p.pitch = 0;
    p.diveT = 0; p.diveCd = 0; p.queued = 0; p.crouchOn = false; p.lean = 0;
    p.alive = true; p.crouch = false; p.h = H_STAND; p.ammo = p.mag; p.reload = 0; p.cd = 0;
    p.vx = p.vz = p.mvx = p.mvz = 0;
    p.tx = undefined; // drop stale network targets from the last round
    p.goal = null; p.tgt = null; p.seen = 0; p.scanT = Math.random() * 0.2; p.stuckT = 0; p.lx = p.x; p.lz = p.z;
    p.hold = Math.random() < 0.5; p.avoid = Math.random() < 0.5 ? 1 : -1;
    p.model.torso.material = M.jersey[p.team];
    for (const a of p.model.arms) a.material = M.jersey[p.team];
    p.model.armUp.visible = false; p.model.gun.visible = true;
  }
}
const slotIdx = (p) => players.indexOf(p);
// Who controls each of the 8 slots. ctrl: 'local' (this browser's player), 'bot' (AI run here),
// 'remote' (another human, on the host), 'net' (anyone else, as seen by a joining client).
// assign: [{ slot, id, name }]; id 'local' means this browser in single player.
function assignSlots(assign) {
  for (const p of players) {
    p.human = false; p.ctrl = net.mode === 'client' ? 'net' : 'bot'; p.peer = null;
    p.name = TEAMS[p.team].names[p.i]; setNameTag(p, null);
  }
  const me = net.mode ? net.myId : 'local';
  for (const a of assign) {
    const p = players[a.slot]; if (!p) continue;
    p.peer = a.id; p.name = a.name;
    if (a.id === me) { p.human = true; p.ctrl = 'local'; }
    else { p.ctrl = net.mode === 'host' ? 'remote' : 'net'; setNameTag(p, a.name); }
  }
  const h = human(); myTeam = h ? h.team : 0;
}
function setNameTag(p, name) {
  const m = p.model;
  if (m.tag) { m.root.remove(m.tag); m.tag.material.map.dispose(); m.tag.material.dispose(); m.tag = null; }
  if (!name) return;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 32px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(250, g.measureText(name).width + 28);
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(128 - w / 2, 10, w, 44);
  g.fillStyle = TEAMS[p.team].css; g.fillText(name, 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(1.2, 0.3, 1); s.position.y = 2.15;
  m.root.add(s); m.tag = s;
}
function applyLoadout() {
  for (const p of players) {
    if (p.human) {
      p.mag = stat('hopper'); p.cool = stat('rate'); p.reloadT = stat('reload'); p.spread = stat('barrel'); p.ballSpeed = stat('velocity');
    } else { p.mag = BOT.mag; p.reloadT = BOT.reload; p.ballSpeed = BOT.ball; }
  }
}

// ---------- line of sight / movement ----------
function losClear(ax, ay, az, bx, by, bz) {
  v1.set(ax, ay, az); v2.set(bx - ax, by - ay, bz - az);
  const len = v2.length(); if (len < 1e-6) return true;
  ray.set(v1, v2.divideScalar(len)); ray.near = 0; ray.far = len;
  return ray.intersectObjects(world.bunkerMeshes, false).length === 0;
}
const eyeY = (p) => p.h * 0.9 - Math.abs(p.lean) * 0.05;
const chestY = (p) => p.h * 0.72;
const LEAN_DIST = 0.42; // metres the head moves sideways at full lean
// sideways shift of a player's upper body (k scales it: 1 at the eyes, ~0.8 at the chest)
function leanOffset(p, k = 1) {
  const d = p.lean * LEAN_DIST * k;
  return { x: -Math.sin(p.ang) * d, z: Math.cos(p.ang) * d };
}
function move(p, dx, dz) { p.x += dx; p.z += dz; resolveCircle(p, PR); }

// ---------- balls ----------
const ballGeo = new THREE.SphereGeometry(0.05, 10, 8);
const ballMats = TEAMS.map((t) => new THREE.MeshStandardMaterial({ color: t.paint, emissive: t.paint, emissiveIntensity: 0.4, roughness: 0.2 }));
const ballPool = [];
function freeBall(b) { b.mesh.removeFromParent(); ballPool.push(b.mesh); }
const vec = (v) => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
const fromVec = (a) => new THREE.Vector3(a[0], a[1], a[2]);
function spawnBall(owner, pos, vel) {
  const m = ballPool.pop() || new THREE.Mesh(ballGeo, ballMats[0]);
  m.material = ballMats[owner.team]; m.position.copy(pos); scene.add(m);
  balls.push({ pos: pos.clone(), vel: vel.clone(), team: owner.team, owner, life: 1.8, mesh: m });
  sfx.shot(owner.human ? null : pos);
}
function fire(p, pos, vel) {
  if (p.ammo <= 0 || p.reload > 0) return;
  p.ammo--;
  spawnBall(p, pos, vel);
  // host tells everyone about every shot; a client tells the host about its own
  if (net.mode === 'host') broadcast({ t: 'ball', o: slotIdx(p), p: vec(pos), v: vec(vel) });
  else if (net.mode === 'client' && p.human) netSend({ t: 'fire', p: vec(pos), v: vec(vel) });
  if (p.ammo === 0) startReload(p);
}
function startReload(p) {
  if (p.reload <= 0 && p.ammo < p.mag) { p.reload = p.reloadT; if (p.human) sfx.reload(); }
}
const UP = new THREE.Vector3(0, 1, 0);
function updateBalls(dt) {
  for (let k = balls.length - 1; k >= 0; k--) {
    const b = balls[k];
    const p0 = v1.copy(b.pos);
    b.vel.y -= GRAV * dt;
    const seg = v2.copy(b.vel).multiplyScalar(dt), len = seg.length();
    let tBest = Infinity, kind = null, hitP = null, point = null, normal = null;
    ray.set(p0, v3.copy(seg).divideScalar(len)); ray.near = 0; ray.far = len;
    const hits = ray.intersectObjects(world.bunkerMeshes, false);
    if (hits.length) {
      tBest = hits[0].distance / len; kind = 'wall'; point = hits[0].point.clone();
      normal = hits[0].face ? hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld) : v3.clone().negate();
    }
    if (p0.y + seg.y <= 0) {
      const t = p0.y <= 0 ? 0 : p0.y / -seg.y; // ball already at/under the turf splats right away
      if (t < tBest) { tBest = t; kind = 'ground'; point = p0.clone().addScaledVector(seg, t); point.y = 0; normal = UP; }
    }
    if (state === 'playing') {
      for (const p of players) {
        if (!p.alive || p.team === b.team) continue;
        // two hit zones: legs/hips stay put, the upper body shifts out when leaning
        const lo = leanOffset(p, 0.8), split = p.h * 0.55;
        for (const [cx, cz, y0, y1, r] of [[p.x, p.z, 0, split, PR + 0.04], [p.x + lo.x, p.z + lo.z, split, p.h + 0.05, PR * 0.85 + 0.04]]) {
          const t = segCircle(p0.x, p0.z, p0.x + seg.x, p0.z + seg.z, cx, cz, r);
          if (t >= 0 && t < tBest) {
            const y = p0.y + seg.y * t;
            if (y >= y0 && y <= y1) { tBest = t; kind = 'player'; hitP = p; point = p0.clone().addScaledVector(seg, t); }
          }
        }
      }
    }
    if (kind) {
      if (kind === 'player') {
        if (net.mode === 'client') world.puff(point, b.team); // the host decides who is out
        else eliminate(hitP, b.owner, point);
      }
      else { world.addSplat(point, normal, b.team, rand(0.32, 0.5)); world.puff(point, b.team); sfx.splat(point); }
      freeBall(b); balls.splice(k, 1); continue;
    }
    b.pos.add(seg); b.mesh.position.copy(b.pos); b.life -= dt;
    if (b.life <= 0 || Math.abs(b.pos.x) > NETB.hw || Math.abs(b.pos.z) > NETB.hd) { freeBall(b); balls.splice(k, 1); }
  }
}
function eliminate(p, by, point) {
  if (!p.alive) return;
  if (net.mode === 'host') broadcast({ t: 'tag', v: slotIdx(p), b: slotIdx(by), pt: vec(point) });
  p.alive = false; p.reload = 0; p.crouch = false; p.lean = 0; p.diveT = 0;
  const n = new THREE.Vector3(point.x - p.x, 0, point.z - p.z).normalize();
  world.addSplat(point, n, by.team, 0.42, p.model.root);
  world.puff(point, by.team);
  sfx.tag(point);
  p.model.torso.material = M.out[p.team];
  p.model.armUp.visible = true;
  by.kills++;
  feed.unshift({ a: by.name, at: by.team, b: p.name, bt: p.team, t: 5 }); if (feed.length > 5) feed.pop();
  renderFeed();
  if (by.human) {
    hitMarker = 0.3; sfx.hit();
    const c = reward(REWARD.tag); earned.tags += c; save.stats.tags++; addCoins(c); popCoins(c, 'TAG');
  }
  if (p.human) { sfx.out(); specIdx = 0; }
}
const reward = (n) => Math.round(n * DIFF[matchDiff].reward);

// ---------- human ----------
const NECK = 1.75;                 // how far (rad, ~100°) you can look away from where your legs face
const DIVE_T = 0.95, H_PRONE = 0.55;
function clampNeck(p) {
  const d = angDiff(p.ang, p.bodyAng);
  if (Math.abs(d) > NECK) p.bodyAng = p.ang - Math.sign(d) * NECK;
}
function updateHuman(p, dt) {
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const wantsMove = f !== 0 || s !== 0;

  // Legs keep their heading while you move; standing still, the body turns to face your view.
  if (!wantsMove && p.diveT <= 0) p.bodyAng += angDiff(p.ang, p.bodyAng) * Math.min(1, dt * 6);
  clampNeck(p);

  // crouch (hold or toggle)
  const cKey = !!keys.KeyC;
  if (save.settings.crouchToggle) { if (cKey && !p.cWas) p.crouchOn = !p.crouchOn; p.crouch = p.crouchOn; }
  else p.crouch = cKey;
  p.cWas = cKey;

  // movement direction in the world, relative to where the legs face
  const ca = Math.cos(p.bodyAng), sa = Math.sin(p.bodyAng);
  let mx = ca * f - sa * s, mz = sa * f + ca * s;
  const len = Math.hypot(mx, mz);

  // dive
  p.diveCd -= dt;
  if (keys.Space && !p.spaceWas && p.diveT <= 0 && p.diveCd <= 0) {
    p.diveDir = len > 0 ? Math.atan2(mz, mx) : p.ang;
    p.diveT = DIVE_T; p.crouchOn = false; sfx.dive();
  }
  p.spaceWas = !!keys.Space;

  if (p.diveT > 0) {
    const t = DIVE_T - p.diveT;
    p.diveT -= dt;
    const sp = t < 0.35 ? 8.6 - t * 12 : Math.max(0, 4.4 - (t - 0.35) * 11); // lunge, then slide to a stop
    move(p, Math.cos(p.diveDir) * sp * dt, Math.sin(p.diveDir) * sp * dt);
    p.mvx = p.mvz = 0; p.moving = sp > 0.5; p.sprint = false;
    if (p.diveT <= 0) { p.diveT = 0; p.diveCd = 0.5; }
  } else {
    p.sprint = !!(keys.ShiftLeft || keys.ShiftRight) && f > 0 && !p.crouch && Math.abs(p.lean) < 0.2;
    // forward is fastest, strafing a bit slower, backpedalling slowest
    const base = p.crouch ? 2.4 : p.sprint ? 7.2 : 4.8;
    const sp = f < 0 ? base * 0.75 : f === 0 ? base * 0.9 : base;
    if (len > 0) { mx = mx / len * sp; mz = mz / len * sp; }
    const k = Math.min(1, dt * 12);
    p.mvx += (mx - p.mvx) * k; p.mvz += (mz - p.mvz) * k;
    move(p, p.mvx * dt, p.mvz * dt);
    p.moving = len > 0;
  }

  // lean: Q left, E right. Stops short if a wall is in the way so the camera never clips in.
  let want = p.diveT > 0 ? 0 : (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
  if (want) {
    const rx = -Math.sin(p.ang) * want * LEAN_DIST, rz = Math.cos(p.ang) * want * LEAN_DIST;
    let f = 1;
    while (f > 0 && segBlocked2D(p.x, p.z, p.x + rx * f, p.z + rz * f, 0.14)) f -= 0.1;
    want *= Math.max(0, f);
  }
  p.lean += (want - p.lean) * Math.min(1, dt * 10);
  if (Math.abs(p.lean) > 0.2) p.sprint = false;

  if (keys.KeyR) startReload(p);
  // semi-auto: each click queues one shot; it fires as soon as the trigger resets
  if (p.queued > 0) {
    p.queued -= dt;
    if (p.cd <= 0 && p.reload <= 0 && p.ammo > 0) { humanFire(p); p.queued = 0; }
  }
}
function currentSpread(p) {
  let s = 0.012;
  if (p.moving) s += 0.015;
  if (p.sprint) s += 0.04;
  if (p.diveT > 0) s += 0.03;
  if (p.crouch && !p.moving) s *= 0.6;
  return s * p.spread;
}
function humanFire(p) {
  camera.updateMatrixWorld();
  const dir = camera.getWorldDirection(new THREE.Vector3());
  ray.set(camera.position, dir); ray.near = 0; ray.far = 90;
  const hits = ray.intersectObjects(world.bunkerMeshes, false);
  let dist = hits.length ? hits[0].distance : 90;
  if (dir.y < 0) dist = Math.min(dist, -camera.position.y / dir.y);
  const aim = camera.position.clone().addScaledVector(dir, Math.max(dist, 2));
  const muzzle = vmMuzzle.getWorldPosition(new THREE.Vector3());
  const d = aim.sub(muzzle).normalize();
  const sp = currentSpread(p);
  d.x += gauss() * sp; d.y += gauss() * sp; d.z += gauss() * sp; d.normalize();
  fire(p, muzzle, d.multiplyScalar(p.ballSpeed));
  p.cd = p.cool;
  vm.position.z = VM_BASE.z + 0.06; vm.rotation.x = 0.08;
}

// ---------- bots ----------
function pickGoal(b, foes) {
  let near = null, nd = 1e9;
  for (const f of foes) { const d = Math.hypot(f.x - b.x, f.z - b.z); if (d < nd) { nd = d; near = f; } }
  const taken = players.filter((o) => o !== b && o.alive && o.goal).map((o) => o.goal);
  const cands = [];
  for (const c of world.cover) {
    if (taken.some((g) => Math.hypot(g.x - c.x, g.z - c.z) < 1.2)) continue;
    let s = Math.random() * 5 - Math.hypot(c.x - b.x, c.z - b.z) * 0.25;
    if (near) s -= Math.abs(Math.hypot(near.x - c.x, near.z - c.z) - 15);
    cands.push({ c, s });
  }
  cands.sort((a, b2) => b2.s - a.s);
  let best = null, bestS = -1e9;
  for (const { c, s } of cands.slice(0, 12)) {
    let sc = s;
    if (near && !losClear(near.x, eyeY(near), near.z, c.x, 1.3, c.z)) sc += 8; // hidden from the nearest enemy
    if (sc > bestS) { bestS = sc; best = c; }
  }
  b.goal = best ? { x: best.x, z: best.z } : { x: rand(-5, 5), z: rand(-10, 10) };
  b.goalT = rand(4, 8);
}
function steer(b, tx, tz, speed, dt) {
  let a = Math.atan2(tz - b.z, tx - b.x);
  for (const o of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
    const aa = a + o * b.avoid;
    if (!segBlocked2D(b.x, b.z, b.x + Math.cos(aa) * 1.2, b.z + Math.sin(aa) * 1.2, PR - 0.05)) { a = aa; break; }
  }
  move(b, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt);
  return a;
}
function updateBot(b, dt) {
  const D = DIFF[matchDiff];
  const foes = players.filter((p) => p.alive && p.team !== b.team);
  if (!foes.length) return;
  b.scanT -= dt;
  if (b.tgt && !b.tgt.alive) b.tgt = null;
  if (b.scanT <= 0) {
    b.scanT = rand(0.12, 0.22);
    let best = null, bd = 1e9;
    for (const f of foes) {
      const d = Math.hypot(f.x - b.x, f.z - b.z);
      const lo = leanOffset(f, 0.8);
      if (d < D.sight && d < bd && losClear(b.x, eyeY(b), b.z, f.x + lo.x, chestY(f), f.z + lo.z)) { best = f; bd = d; }
    }
    if (best !== b.tgt) b.seen = 0;
    b.tgt = best; b.td = bd;
  }
  if (b.ammo < b.mag && b.reload <= 0 && (b.ammo === 0 || (!b.tgt && b.ammo < 8))) startReload(b);
  b.crouch = b.reload > 0;

  if (b.tgt) {
    const t = b.tgt, td = Math.hypot(t.x - b.x, t.z - b.z);
    b.seen += dt;
    const ft = td / b.ballSpeed;
    const tl = leanOffset(t, 0.8); // aim at whatever part of them is sticking out
    const px = t.x + tl.x + t.vx * ft * D.lead, pz = t.z + tl.z + t.vz * ft * D.lead;
    const want = Math.atan2(pz - b.z, px - b.x);
    const da = angDiff(want, b.ang);
    b.ang += da * Math.min(1, dt * 9);
    const muzzleY = eyeY(b) - 0.25;
    b.pitch = Math.atan2(chestY(t) + 0.5 * GRAV * ft * ft - muzzleY, td);
    if (b.seen > D.react && b.cd <= 0 && b.reload <= 0 && Math.abs(da) < 0.2) {
      const yaw = b.ang + gauss() * D.err, pitch = b.pitch + gauss() * D.err * 0.6;
      const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
      const pos = new THREE.Vector3(b.x + Math.cos(b.ang) * 0.55, muzzleY, b.z + Math.sin(b.ang) * 0.55);
      fire(b, pos, dir.multiplyScalar(b.ballSpeed));
      b.cd = D.rate * rand(0.8, 1.4);
    }
    b.strafeT -= dt;
    if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = rand(0.5, 1.4); }
    const perp = want + Math.PI / 2 * b.strafe;
    let sx = Math.cos(perp), sz = Math.sin(perp);
    if (td < 7) { sx -= Math.cos(want) * 0.8; sz -= Math.sin(want) * 0.8; }
    if (b.reload > 0 && b.goal) steer(b, b.goal.x, b.goal.z, D.speed * 0.6, dt); // duck back to cover
    else { const sp = b.hold ? D.speed * 0.4 : D.speed * 0.75; move(b, sx * sp * dt, sz * sp * dt); }
  } else {
    b.seen = 0; b.pitch *= 0.9;
    b.goalT -= dt;
    if (roundTime > HUNT_AFTER) {
      // late in a round, stop camping: head straight for the nearest enemy so rounds can't stall
      if (!b.goal || b.goalT <= 0 || !b.hunting) {
        let near = foes[0], nd = 1e9;
        for (const f of foes) { const dd = Math.hypot(f.x - b.x, f.z - b.z); if (dd < nd) { nd = dd; near = f; } }
        b.goal = { x: near.x, z: near.z }; b.goalT = 1.5; b.hunting = true;
      }
    } else if (!b.goal || b.goalT <= 0) { b.hunting = false; pickGoal(b, foes); }
    const d = Math.hypot(b.goal.x - b.x, b.goal.z - b.z);
    if (d > 0.3) {
      const a = steer(b, b.goal.x, b.goal.z, b.crouch ? D.speed * 0.6 : D.speed, dt);
      b.ang += angDiff(a, b.ang) * Math.min(1, dt * 6);
    } else {
      let near = foes[0], nd = 1e9;
      for (const f of foes) { const dd = Math.hypot(f.x - b.x, f.z - b.z); if (dd < nd) { nd = dd; near = f; } }
      b.ang += angDiff(Math.atan2(near.z - b.z, near.x - b.x), b.ang) * Math.min(1, dt * 4);
      if (Math.random() < dt * 0.25 && roundTime <= HUNT_AFTER) pickGoal(b, foes); // move up now and then
    }
    b.stuckT += dt;
    if (b.stuckT > 0.8) {
      if (d > 0.8 && Math.hypot(b.x - b.lx, b.z - b.lz) < 0.4) { b.avoid = -b.avoid; pickGoal(b, foes); }
      b.stuckT = 0; b.lx = b.x; b.lz = b.z;
    }
  }
}

// ---------- match flow ----------
// shared by single player, host and joining players
function beginMatch(diff) {
  initAudio();
  matchDiff = DIFF[diff] ? diff : 'normal'; localPaused = false;
  score = [0, 0]; round = 1; feed = []; renderFeed();
  earned = { tags: 0, rounds: 0, win: 0, play: 0 };
  for (const p of players) p.kills = 0;
  applyLoadout();
  buildViewmodel();
  startRound();
  showScreen(null);
  $('hud').classList.remove('hidden');
  $('hint').classList.remove('hidden');
  setTimeout(() => $('hint').classList.add('hidden'), 9000);
}
function startMatch() { // single player
  assignSlots([{ slot: 1, id: 'local', name: 'You' }]);
  beginMatch(save.settings.diff); sfx.click(); lock();
}
function startRound() {
  resetPlayers();
  state = 'countdown'; timer = 3; roundTime = 0;
  sfx.beep();
  if (net.mode === 'host') broadcast({ t: 'round', r: round, s: score });
}
function roundWon(w) {
  lastWinner = w;
  if (w === myTeam && earned) { const c = reward(REWARD.round); earned.rounds += c; addCoins(c); popCoins(c, 'ROUND'); }
  state = 'roundEnd'; timer = 3;
}
function endRoundCheck() {
  const left = [0, 1].map((t) => players.filter((p) => p.alive && p.team === t).length);
  if (left[0] && left[1]) return;
  const w = left[0] ? 0 : 1;
  score[w]++;
  if (net.mode === 'host') broadcast({ t: 'roundEnd', w, s: score });
  roundWon(w);
}
function endMatch() {
  if (net.mode === 'host') broadcast({ t: 'end', s: score });
  localPaused = false;
  const won = score[myTeam] > score[1 - myTeam];
  earned.play = reward(REWARD.play); earned.win = won ? reward(REWARD.win) : 0;
  addCoins(earned.play + earned.win);
  save.stats.matches++; if (won) save.stats.wins++;
  persist();
  state = 'results';
  releaseLock();
  $('hud').classList.add('hidden');
  const h = human();
  $('resTitle').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('resTitle').className = won ? 'win' : 'lose';
  $('resScore').innerHTML = `<b class="blue">${score[0]}</b> – <b class="red">${score[1]}</b>`;
  const total = earned.tags + earned.rounds + earned.play + earned.win;
  $('resLines').innerHTML = [
    [`Tags (${h.kills})`, earned.tags], ['Rounds won', earned.rounds], ['Match played', earned.play], ['Victory bonus', earned.win],
  ].map(([l, v]) => `<div><span>${l}</span><span>+${v}</span></div>`).join('') + `<div class="total"><span>Total</span><span><i class="coin"></i>${total}</span></div>`;
  updateCoins();
  $('resAgain').textContent = net.mode ? 'BACK TO LOBBY' : 'PLAY AGAIN';
  $('resHome').textContent = net.mode ? 'Leave room' : 'Home';
  showScreen('results');
  sfx.coin();
}
function quitToHome(msg) {
  if (net.mode === 'host') broadcast({ t: 'bye' });
  netLeave();
  state = 'home'; localPaused = false; releaseLock();
  assignSlots([{ slot: 1, id: 'local', name: 'You' }]);
  resetPlayers(); feed = []; renderFeed();
  $('hud').classList.add('hidden');
  showScreen('home');
  if (typeof msg === 'string') toast(msg);
}

// ---------- multiplayer ----------
const SLOT_ORDER = [[1, 0, 2, 3], [5, 4, 6, 7]]; // blue slots, red slots (host takes the first blue one)
const MAX_PLAYERS = { teams: 8, coop: 4 };
// Humans in join order → slots. Teams: alternate blue/red. Co-op: everyone on blue vs bots.
function lobbyAssign() {
  return lobby.players.map((pl, k) => {
    const team = lobby.mode === 'coop' ? 0 : k % 2;
    const n = lobby.mode === 'coop' ? k : k >> 1;
    return { slot: SLOT_ORDER[team][n], id: pl.id, name: pl.name };
  });
}
function broadcastLobby() {
  broadcast({ t: 'lobby', code: lobby.code, mode: lobby.mode, players: lobby.players });
  renderLobby();
}
function hostStartMatch() {
  const assign = lobbyAssign();
  broadcast({ t: 'start', assign, diff: save.settings.diff });
  assignSlots(assign);
  beginMatch(save.settings.diff); lock();
}
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const okVec = (a) => Array.isArray(a) && a.length === 3 && a.every(isNum);
const okPose = (a) => Array.isArray(a) && a.length === 10 && a.every(isNum);
const okSlot = (i) => Number.isInteger(i) && i >= 0 && i < players.length;
const okScore = (s) => Array.isArray(s) && s.length === 2 && s.every((x) => Number.isInteger(x) && x >= 0 && x <= 99);
const cleanName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14) || 'Player';
const r3 = (x) => Math.round(x * 1000) / 1000;
const packPose = (p) => [p.x, p.z, p.ang, p.bodyAng, p.pitch, p.h, p.lean, p.alive ? 1 : 0, p.vx, p.vz].map(r3);
function markOut(p) { // out without a known shooter (e.g. a missed message)
  p.alive = false; p.model.torso.material = M.out[p.team]; p.model.armUp.visible = true;
  if (p.human) { sfx.out(); specIdx = 0; }
}

function hostMessage(from, m) {
  const p = players.find((q) => q.peer === from && q.ctrl === 'remote');
  switch (m.t) {
    case 'hello': {
      if (lobby.players.some((l) => l.id === from)) return;
      if (inGame() || state === 'paused') { sendTo(from, { t: 'busy' }); kick(from); return; }
      if (lobby.players.length >= MAX_PLAYERS[lobby.mode]) { sendTo(from, { t: 'full' }); kick(from); return; }
      lobby.players.push({ id: from, name: cleanName(m.name) });
      broadcastLobby(); sfx.beep();
      return;
    }
    case 'fire': {
      if (!p || !p.alive || state !== 'playing' || !okVec(m.p) || !okVec(m.v)) return;
      const pos = fromVec(m.p), vel = fromVec(m.v);
      if (vel.length() > 80 || Math.hypot(pos.x - p.x, pos.z - p.z) > 2.5) return; // ignore impossible shots
      spawnBall(p, pos, vel);
      broadcast({ t: 'ball', o: slotIdx(p), p: m.p, v: m.v }, from);
      return;
    }
    case 'pose': {
      if (!p || !p.alive || !okPose(m.d) || !(state === 'playing' || state === 'countdown')) return;
      const d = m.d;
      p.x = d[0]; p.z = d[1]; resolveCircle(p, PR);
      p.ang = d[2]; p.bodyAng = d[3]; p.pitch = clamp(d[4], -1.3, 1.3);
      p.h = clamp(d[5], H_PRONE, H_STAND); p.lean = clamp(d[6], -1, 1);
      p.vx = clamp(d[8], -10, 10); p.vz = clamp(d[9], -10, 10);
      return;
    }
  }
}
function hostPeerLeft(id) {
  lobby.players = lobby.players.filter((l) => l.id !== id);
  const p = players.find((q) => q.peer === id);
  if (p) { // a bot takes over their slot
    p.ctrl = 'bot'; p.peer = null; p.name = TEAMS[p.team].names[p.i]; setNameTag(p, null);
    p.mag = BOT.mag; p.reloadT = BOT.reload; p.ballSpeed = BOT.ball; p.goal = null; p.tgt = null;
    broadcast({ t: 'ctrl', slot: slotIdx(p), name: p.name });
    feed.unshift({ a: '', at: p.team, b: `${p.name} (bot) joins`, bt: p.team, t: 4, note: true }); renderFeed();
  }
  if (state !== 'home') broadcastLobby();
}

function clientMessage(m) {
  switch (m.t) {
    case 'lobby': {
      if (!Array.isArray(m.players)) return;
      lobby = { code: cleanCode(m.code), mode: m.mode === 'coop' ? 'coop' : 'teams',
        players: m.players.slice(0, 8).map((l) => ({ id: String(l.id), name: cleanName(l.name) })) };
      renderLobby();
      if (!inGame() && state !== 'results') { state = 'lobby'; showScreen('lobby'); }
      return;
    }
    case 'busy': case 'full':
      quitToHome(m.t === 'busy' ? 'That room is in the middle of a match. Try again when it ends.' : 'That room is full.');
      return;
    case 'start': {
      if (!Array.isArray(m.assign)) return;
      const assign = m.assign.filter((a) => a && okSlot(a.slot)).map((a) => ({ slot: a.slot, id: String(a.id), name: cleanName(a.name) }));
      assignSlots(assign);
      if (!human()) return;
      beginMatch(m.diff);
      return;
    }
    case 'round':
      if (!isNum(m.r) || !okScore(m.s)) return;
      round = m.r; score = m.s.slice();
      if (earned) { resetPlayers(); state = 'countdown'; timer = 3; sfx.beep(); }
      return;
    case 's': { // snapshot from the host
      if (!inGameOrPaused() || !Array.isArray(m.p) || m.p.length !== players.length) return;
      if (['countdown', 'playing', 'roundEnd'].includes(m.st) && state !== m.st && !(state === 'roundEnd' && m.st === 'playing')) state = m.st;
      if (isNum(m.tm)) timer = m.tm;
      if (okScore(m.sc)) score = m.sc.slice();
      m.p.forEach((d, i) => {
        const p = players[i];
        if (!okPose(d)) return;
        if (!d[7] && p.alive) markOut(p);
        if (p.ctrl !== 'net') return;
        p.tx = d[0]; p.tz = d[1]; p.tang = d[2]; p.tbody = d[3]; p.tpitch = d[4]; p.th = d[5]; p.tlean = d[6];
        p.vx = d[8]; p.vz = d[9];
      });
      return;
    }
    case 'ball':
      if (!okSlot(m.o) || !okVec(m.p) || !okVec(m.v) || players[m.o].human) return;
      spawnBall(players[m.o], fromVec(m.p), fromVec(m.v));
      return;
    case 'tag':
      if (!okSlot(m.v) || !okSlot(m.b) || !okVec(m.pt)) return;
      eliminate(players[m.v], players[m.b], fromVec(m.pt));
      return;
    case 'roundEnd':
      if (state === 'roundEnd' || !okScore(m.s) || !(m.w === 0 || m.w === 1)) return;
      score = m.s.slice(); roundWon(m.w);
      return;
    case 'end':
      if (okScore(m.s)) score = m.s.slice();
      if (inGameOrPaused()) endMatch();
      return;
    case 'ctrl':
      if (!okSlot(m.slot)) return;
      players[m.slot].name = cleanName(m.name); setNameTag(players[m.slot], null);
      return;
  }
}
onNet({
  message(from, m) {
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    if (net.mode === 'host') hostMessage(from, m); else if (net.mode === 'client') clientMessage(m);
  },
  leave: hostPeerLeft,
  closed() { quitToHome('The host left the game.'); },
});
// smooth other players toward the latest snapshot (clients only)
function smoothNetPlayers(dt) {
  const k = Math.min(1, dt * 14);
  for (const p of players) {
    if (p.ctrl !== 'net' || p.tx === undefined) continue;
    if (Math.hypot(p.tx - p.x, p.tz - p.z) > 3) { p.x = p.tx; p.z = p.tz; }
    p.x += (p.tx - p.x) * k; p.z += (p.tz - p.z) * k;
    p.ang += angDiff(p.tang, p.ang) * k; p.bodyAng += angDiff(p.tbody, p.bodyAng) * k;
    p.pitch += (p.tpitch - p.pitch) * k; p.h += (p.th - p.h) * k; p.lean += (p.tlean - p.lean) * k;
  }
}
function netTick(dt) {
  if (net.mode === 'host' && inGame()) {
    snapT -= dt;
    if (snapT <= 0) { snapT = 0.05; broadcast({ t: 's', st: state, tm: r3(timer), r: round, sc: score, p: players.map(packPose) }); }
  } else if (net.mode === 'client' && inGame()) {
    poseT -= dt;
    if (poseT <= 0) { poseT = 1 / 30; const h = human(); if (h) netSend({ t: 'pose', d: packPose(h) }); }
  }
}

// ---------- update ----------
function update(dt) {
  if (!(dt > 0)) { netTick(0); return; } // zero-length frame: nothing to simulate (and avoids dividing by zero)
  clock += dt;
  for (const f of feed) f.t -= dt;
  if (feed.length && feed[feed.length - 1].t <= 0) { feed = feed.filter((f) => f.t > 0); renderFeed(); }
  hitMarker = Math.max(0, hitMarker - dt);

  if (state === 'countdown') {
    const before = Math.ceil(timer); timer -= dt;
    if (Math.ceil(timer) !== before && timer > 0) sfx.beep();
    if (timer <= 0) { state = 'playing'; sfx.go(); }
  } else if (state === 'roundEnd') {
    timer -= dt;
    // the host (or single player) moves the match on; joiners wait for the host's message
    if (timer <= 0 && net.mode !== 'client') { if (score[0] >= WIN_ROUNDS || score[1] >= WIN_ROUNDS) endMatch(); else { round++; startRound(); } }
  }
  if (state === 'playing') {
    roundTime += dt;
    for (const p of players) {
      if (!p.alive || p.ctrl === 'remote' || p.ctrl === 'net') continue; // those are moved by network messages
      const px = p.x, pz = p.z;
      p.cd -= dt;
      if (p.reload > 0) { p.reload -= dt; if (p.reload <= 0) { p.reload = 0; p.ammo = p.mag; } }
      if (p.human) { if (!localPaused) updateHuman(p, dt); else p.moving = false; }
      else updateBot(p, dt);
      p.vx = (p.x - px) / dt; p.vz = (p.z - pz) / dt;
      if (!p.human) {
        // bots' legs face the way they run (or backpedal); upper body keeps aiming
        const spd = Math.hypot(p.vx, p.vz);
        let target = p.ang;
        if (spd > 0.5) {
          const md = Math.atan2(p.vz, p.vx);
          target = Math.abs(angDiff(md, p.ang)) <= Math.PI / 2 ? md : md + Math.PI;
        }
        p.bodyAng += angDiff(target, p.bodyAng) * Math.min(1, dt * 8);
        clampNeck(p);
      }
    }
    // keep players from overlapping (only nudge the ones this browser controls)
    const alive = players.filter((p) => p.alive);
    const mine = (p) => p.ctrl === 'bot' || p.ctrl === 'local';
    for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j], dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d > 0 && d < PR * 2) {
        const o = (PR * 2 - d) / (mine(a) && mine(b) ? 2 : 1);
        if (mine(a)) move(a, -dx / d * o, -dz / d * o);
        if (mine(b)) move(b, dx / d * o, dz / d * o);
      }
    }
  }
  if (net.mode === 'client') smoothNetPlayers(dt);
  if (state === 'playing' || state === 'roundEnd') updateBalls(dt);
  if (state === 'playing' && net.mode !== 'client') endRoundCheck();
  for (const p of players) {
    if (p.ctrl === 'remote' || p.ctrl === 'net') continue; // height comes from the network
    const target = p.diveT > 0 ? H_PRONE : p.crouch ? H_CROUCH : H_STAND;
    p.h += (target - p.h) * Math.min(1, dt * (p.diveT > 0 ? 16 : 10));
  }
  netTick(dt);
  syncModels(dt);
  updateCamera(dt);
  world.update(dt, clock);
}
function syncModels(dt) {
  for (const p of players) {
    const m = p.model;
    m.root.visible = !(p.human && p.alive && inGameOrPaused());
    m.root.position.set(p.x, 0, p.z);
    m.root.rotation.y = -p.bodyAng;
    m.upper.rotation.y = -angDiff(p.ang, p.bodyAng);
    m.upper.rotation.x = p.lean * 0.26; // tilt the upper body sideways when leaning
    m.body.scale.y = p.h / H_STAND;
    const speed = p.alive ? Math.hypot(p.vx, p.vz) : 0;
    if (speed > 0.4) p.phase += dt * speed * 2.2;
    const swing = speed > 0.4 ? Math.sin(p.phase) * 0.55 : 0;
    m.legs[0].rotation.z += (swing - m.legs[0].rotation.z) * 0.3;
    m.legs[1].rotation.z += (-swing - m.legs[1].rotation.z) * 0.3;
    m.gun.rotation.z = p.alive ? p.pitch * 0.8 : -0.6;
  }
}
const inGameOrPaused = () => inGame() || state === 'paused';
const homeCam = new THREE.Vector3();
function updateCamera(dt) {
  const h = human();
  if (!inGameOrPaused()) {
    const t = clock * 0.05;
    homeCam.set(Math.cos(t) * 30, 11 + Math.sin(clock * 0.1) * 2, Math.sin(t) * 22);
    camera.position.copy(homeCam); camera.lookAt(0, 0.5, 0);
    vm.visible = false; setFov(60, 1);
    setListener(camera.position.x, camera.position.y, camera.position.z);
    return;
  }
  if (h.alive) {
    const bob = h.moving && state === 'playing' ? Math.sin(clock * (h.sprint ? 14 : 10)) * 0.035 : 0;
    const lo = leanOffset(h);
    camera.position.set(h.x + lo.x, eyeY(h) + bob, h.z + lo.z);
    const roll = (h.diveT > 0 ? Math.sin((1 - h.diveT / DIVE_T) * Math.PI) * 0.09 * Math.sign(angDiff(h.diveDir, h.ang) || 1) : 0) - h.lean * 0.16;
    camera.rotation.set(h.pitch, -h.ang - Math.PI / 2, roll);
    vm.visible = true;
    vm.position.x += (VM_BASE.x + (h.moving ? Math.sin(clock * 5) * 0.012 : 0) - vm.position.x) * Math.min(1, dt * 10);
    vm.position.y += (VM_BASE.y + bob * 0.4 - (h.reload > 0 ? 0.12 : 0) - vm.position.y) * Math.min(1, dt * 10);
    vm.position.z += (VM_BASE.z - vm.position.z) * Math.min(1, dt * 14);
    vm.rotation.x += ((h.reload > 0 ? -0.5 : 0) - vm.rotation.x) * Math.min(1, dt * 12);
    setFov(h.sprint ? 82 : 75, dt);
  } else {
    vm.visible = false; setFov(70, dt);
    const allies = players.filter((p) => p.alive && p.team === myTeam);
    const pool = allies.length ? allies : players.filter((p) => p.alive);
    if (pool.length) {
      const t = pool[specIdx % pool.length];
      v1.set(t.x - Math.cos(t.ang) * 3.8, 2.6, t.z - Math.sin(t.ang) * 3.8);
      camera.position.lerp(v1, Math.min(1, dt * 4));
      camera.lookAt(t.x + Math.cos(t.ang) * 2, 1.2, t.z + Math.sin(t.ang) * 2);
      $('status').textContent = `You're out! Spectating ${t.name} · click to switch`;
    }
  }
  setListener(camera.position.x, camera.position.y, camera.position.z);
}
function setFov(f, dt) {
  const nf = camera.fov + (f - camera.fov) * Math.min(1, dt * 8);
  if (Math.abs(nf - camera.fov) > 0.01) { camera.fov = nf; camera.updateProjectionMatrix(); }
}

// ---------- HUD ----------
function renderHud() {
  if (!inGameOrPaused()) return;
  const h = human();
  $('s0').textContent = score[0]; $('s1').textContent = score[1];
  $('roundLbl').textContent = `ROUND ${round}`;
  for (let t = 0; t < 2; t++) {
    $('pips' + t).innerHTML = players.filter((p) => p.team === t).map((p) => `<i class="${p.alive ? 'on' : ''}"></i>`).join('');
  }
  $('ammoNum').textContent = h.reload > 0 ? '··' : h.ammo;
  $('ammoMag').textContent = '/ ' + h.mag;
  $('ammoBox').classList.toggle('low', h.ammo <= Math.ceil(h.mag * 0.2));
  $('reloadBar').style.setProperty('--p', h.reload > 0 ? 1 - h.reload / h.reloadT : 0);
  $('reloadBar').classList.toggle('hidden', !(h.reload > 0));
  const leanTxt = h.lean < -0.3 ? 'LEAN ◀' : h.lean > 0.3 ? 'LEAN ▶' : '';
  $('stance').textContent = h.diveT > 0 ? 'DIVE' : [h.crouch ? 'CROUCHED' : h.sprint ? 'SPRINT' : '', leanTxt].filter(Boolean).join(' · ');
  $('legs').style.setProperty('--r', (angDiff(h.bodyAng, h.ang) * 180 / Math.PI).toFixed(1) + 'deg');
  $('legs').classList.toggle('hidden', !h.alive);
  const gap = 5 + currentSpread(h) * 500;
  $('cross').style.setProperty('--g', gap.toFixed(1) + 'px');
  $('cross').classList.toggle('hidden', !h.alive);
  $('hitmark').classList.toggle('on', hitMarker > 0);
  $('status').classList.toggle('hidden', h.alive || state !== 'playing');
  $('clickPlay').classList.toggle('hidden', !(inGame() && !locked && !fallbackLook && !localPaused));
  let banner = '';
  if (state === 'countdown') banner = `ROUND ${round}<small>${Math.ceil(timer)}</small>`;
  else if (state === 'roundEnd') banner = `<span style="color:${TEAMS[lastWinner].css}">${TEAMS[lastWinner].name} WINS THE ROUND</span>`;
  $('banner').innerHTML = banner;
  $('banner').classList.toggle('hidden', !banner);
}
function renderFeed() {
  $('feed').innerHTML = feed.map((f) => f.note
    ? `<div><b style="color:${TEAMS[f.bt].css}">${esc(f.b)}</b></div>`
    : `<div><b style="color:${TEAMS[f.at].css}">${esc(f.a)}</b><i class="splat-ico" style="background:${TEAMS[f.at].paintCss}"></i><b style="color:${TEAMS[f.bt].css}">${esc(f.b)}</b></div>`).join('');
}
let toastT = null;
function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 5000);
}
function popCoins(n, label) {
  sfx.coin(); updateCoins();
  const el = document.createElement('div'); el.className = 'pop';
  el.innerHTML = `<i class="coin"></i>+${n} <small>${label}</small>`;
  $('pops').appendChild(el); setTimeout(() => el.remove(), 1400);
}
function updateCoins() { for (const el of document.querySelectorAll('.coin-count')) el.textContent = save.coins.toLocaleString(); }

// ---------- menus ----------
const SCREENS = ['home', 'shop', 'settings', 'help', 'pause', 'results', 'mp', 'lobby'];
function showScreen(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  document.body.classList.toggle('menu', !!id);
  if (id === 'home') renderHome();
  if (id === 'shop') { renderShop(); refreshPreview(); }
  if (id === 'lobby') renderLobby();
  if (id === 'pause') $('pauseTitle').textContent = net.mode ? 'Menu' : 'Paused';
  $('pauseNote').classList.toggle('hidden', !net.mode);
  updateCoins();
}
function renderLobby() {
  const isHost = net.mode === 'host';
  $('lobbyCode').textContent = lobby.code || '-----';
  const assign = lobby.players.length ? (net.mode === 'host' ? lobbyAssign() : lobbyAssign()) : [];
  $('lobbyList').innerHTML = assign.map((a, k) => {
    const team = a.slot >= 4 ? 1 : 0, you = a.id === net.myId;
    return `<li><i style="background:${TEAMS[team].css}"></i><b>${esc(a.name)}</b>${k === 0 ? '<small>HOST</small>' : ''}${you ? '<small>YOU</small>' : ''}<span style="color:${TEAMS[team].css}">${TEAMS[team].name}</span></li>`;
  }).join('');
  const bots = 8 - lobby.players.length;
  $('lobbyBots').textContent = lobby.mode === 'coop'
    ? `Co-op: all players on Blue against 4 Red bots${lobby.players.length < 4 ? `, with ${4 - lobby.players.length} Blue bot${4 - lobby.players.length === 1 ? '' : 's'} helping` : ''}.`
    : `Teams: players split between Blue and Red. ${bots} bot${bots === 1 ? '' : 's'} fill the empty slots.`;
  for (const b of document.querySelectorAll('#lobbyMode button')) {
    b.classList.toggle('on', b.dataset.m === lobby.mode); b.disabled = !isHost;
  }
  $('btnStart').classList.toggle('hidden', !isHost);
  $('lobbyWait').classList.toggle('hidden', isHost);
}
function renderHome() {
  $('stats').textContent = `${save.stats.matches} matches · ${save.stats.wins} wins · ${save.stats.tags} tags`;
  for (const b of document.querySelectorAll('#diff button')) b.classList.toggle('on', b.dataset.d === save.settings.diff);
}
function renderShop() {
  $('shopGrid').innerHTML = Object.entries(UPGRADES).map(([k, u]) => {
    const lvl = save.up[k], cost = costOf(k), now = u.fmt(u.value(lvl));
    const next = cost == null ? '' : `<span class="arrow">→</span><b>${u.fmt(u.value(lvl + 1))}</b>`;
    const pips = [...Array(u.max)].map((_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
    const btn = cost == null ? '<button class="buy" disabled>MAXED</button>'
      : `<button class="buy" data-k="${k}" ${save.coins < cost ? 'data-poor="1"' : ''}><i class="coin"></i>${cost}</button>`;
    return `<div class="card"><div class="ico">${u.icon}</div><h3>${u.name}</h3><p>${u.desc}</p>
      <div class="pips">${pips}</div><div class="vals">${now}${next}</div>${btn}</div>`;
  }).join('');
}
// rotating 3D preview of the player's marker in the shop (its own small renderer)
let preview = null;
function refreshPreview() {
  if (!preview) {
    const c = $('markerPreview');
    const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
    const s = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    s.environment = pm.fromScene(new RoomEnvironment(r), 0.04).texture; pm.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(1, 2, 2); s.add(key);
    const rim = new THREE.DirectionalLight(0x9fc3ff, 1.4); rim.position.set(-2, 1, -2); s.add(rim);
    const cam = new THREE.PerspectiveCamera(28, 2, 0.01, 10);
    cam.position.set(0, 0.1, 1.05); cam.lookAt(0, 0, 0);
    const pivot = new THREE.Group(); s.add(pivot);
    preview = { r, s, cam, pivot, m: null, spin: 0.6, drag: null, yaw: 0.6 };
    c.addEventListener('pointerdown', (e) => { preview.drag = e.clientX; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => { if (preview.drag != null) { preview.yaw += (e.clientX - preview.drag) * 0.01; preview.drag = e.clientX; } });
    c.addEventListener('pointerup', () => { preview.drag = null; });
  }
  if (preview.m) { preview.pivot.remove(preview.m); disposeMarker(preview.m); }
  preview.m = makeMarker(0, upgradeLook());
  preview.m.position.set(-0.07, -0.03, 0); // centre the marker on the pivot
  preview.pivot.add(preview.m);
}
function renderPreview(dt) {
  if (!preview || $('shop').classList.contains('hidden')) return;
  const c = preview.r.domElement, w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * preview.r.getPixelRatio()) || c.height !== Math.round(h * preview.r.getPixelRatio())) {
    preview.r.setSize(w, h, false); preview.cam.aspect = w / h; preview.cam.updateProjectionMatrix();
  }
  if (preview.drag == null) preview.yaw += dt * 0.5;
  preview.pivot.rotation.y = preview.yaw;
  preview.r.render(preview.s, preview.cam);
}

$('shopGrid').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-k]'); if (!b) return;
  initAudio();
  if (buy(b.dataset.k)) { sfx.buy(); renderShop(); updateCoins(); refreshPreview(); }
  else { sfx.deny(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }
});
$('diff').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  save.settings.diff = b.dataset.d; persist(); renderHome(); initAudio(); sfx.click();
});
const nav = (id, fn) => $(id).addEventListener('click', () => { initAudio(); sfx.click(); fn(); });
nav('btnPlay', startMatch);
nav('btnShop', () => { shopBack = 'home'; showScreen('shop'); });
nav('btnSettings', () => showScreen('settings'));
nav('btnHelp', () => showScreen('help'));
nav('shopBack', () => showScreen(shopBack));
nav('settingsBack', () => showScreen('home'));
nav('helpBack', () => showScreen('home'));
nav('btnResume', resume);
nav('btnQuit', () => quitToHome());
nav('resAgain', () => { if (net.mode) { state = 'lobby'; showScreen('lobby'); } else startMatch(); });
nav('resShop', () => { shopBack = 'results'; showScreen('shop'); });
nav('resHome', () => quitToHome());

// multiplayer menu
const mpName = $('mpName'), mpCode = $('mpCode');
mpName.value = save.settings.name || '';
mpName.addEventListener('input', () => { save.settings.name = cleanName(mpName.value); persist(); });
mpCode.addEventListener('input', () => { mpCode.value = cleanCode(mpCode.value); });
const myName = () => cleanName(mpName.value || save.settings.name);
let hostMode = 'teams';
for (const b of document.querySelectorAll('#mpMode button')) {
  b.addEventListener('click', () => { hostMode = b.dataset.m; for (const x of document.querySelectorAll('#mpMode button')) x.classList.toggle('on', x === b); sfx.click(); });
}
function mpBusy(on, msg = '') {
  for (const id of ['btnHost', 'btnJoin']) $(id).disabled = on;
  $('mpStatus').textContent = msg;
}
nav('btnMP', () => {
  if (!netAvailable()) { toast("Multiplayer couldn't load. Check your internet connection and reload."); return; }
  mpBusy(false); showScreen('mp');
});
nav('mpBack', () => showScreen('home'));
nav('btnHost', async () => {
  mpBusy(true, 'Creating room…');
  try {
    const code = await netHost();
    lobby = { code, mode: hostMode, players: [{ id: 'host', name: myName() }] };
    state = 'lobby'; mpBusy(false); showScreen('lobby');
  } catch (e) { mpBusy(false, e.message || "Couldn't create a room."); }
});
nav('btnJoin', async () => {
  const code = cleanCode(mpCode.value);
  if (code.length !== 5) { mpBusy(false, 'Enter the 5-character room code.'); return; }
  mpBusy(true, `Joining ${code}…`);
  try {
    await netJoin(code);
    netSend({ t: 'hello', name: myName() });
    mpBusy(false, 'Connected. Waiting for the lobby…');
  } catch (e) { mpBusy(false, e.message || "Couldn't join that room."); }
});
for (const b of document.querySelectorAll('#lobbyMode button')) {
  b.addEventListener('click', () => {
    if (net.mode !== 'host' || b.dataset.m === lobby.mode) return;
    if (b.dataset.m === 'coop' && lobby.players.length > MAX_PLAYERS.coop) { toast('Co-op fits 4 players. Too many in the room.'); return; }
    lobby.mode = b.dataset.m; sfx.click(); broadcastLobby();
  });
}
nav('btnStart', hostStartMatch);
nav('btnLeave', () => quitToHome());
nav('btnCopy', async () => {
  const link = `${location.origin}${location.pathname}?room=${lobby.code}`;
  try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); }
  catch (e) { toast(link); }
});

// settings
const sens = $('sens'), volume = $('volume');
sens.value = save.settings.sens; volume.value = save.settings.volume;
sens.addEventListener('input', () => { save.settings.sens = +sens.value; persist(); });
volume.addEventListener('input', () => { save.settings.volume = +volume.value; setVolume(+volume.value); persist(); });
for (const b of document.querySelectorAll('#crouchMode button')) {
  b.classList.toggle('on', (b.dataset.c === 'toggle') === !!save.settings.crouchToggle);
  b.addEventListener('click', () => {
    save.settings.crouchToggle = b.dataset.c === 'toggle'; persist(); sfx.click();
    for (const x of document.querySelectorAll('#crouchMode button')) x.classList.toggle('on', x === b);
  });
}
for (const b of document.querySelectorAll('#quality button')) {
  b.classList.toggle('on', b.dataset.q === save.settings.quality);
  b.addEventListener('click', () => { if (b.dataset.q === save.settings.quality) return; save.settings.quality = b.dataset.q; persist(); location.reload(); });
}
$('btnReset').addEventListener('click', () => {
  if (confirm('Reset all coins, upgrades and stats?')) { resetSave(); location.reload(); }
});

// ---------- pointer lock & input ----------
function lock() {
  if (fallbackLook) return;
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => { fallbackLook = true; });
  } catch (e) { fallbackLook = true; }
}
function releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }
function pause() {
  if (!inGame() || localPaused) return;
  mouse.down = false;
  for (const k in keys) keys[k] = false;
  if (net.mode) localPaused = true;           // a shared match keeps running behind the menu
  else { prevState = state; state = 'paused'; }
  showScreen('pause');
}
function resume() {
  if (net.mode) { if (!localPaused) return; localPaused = false; }
  else { if (state !== 'paused') return; state = prevState; }
  showScreen(null); lock();
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) fallbackLook = false;
  if (!locked && inGame()) pause();
});
document.addEventListener('pointerlockerror', () => { fallbackLook = true; });

addEventListener('mousemove', (e) => {
  if (!(locked || fallbackLook) || !inGame()) return;
  const h = human(); if (!h || !h.alive) return;
  const k = 0.0022 * save.settings.sens;
  h.ang += e.movementX * k;
  h.pitch = clamp(h.pitch - e.movementY * k, -1.25, 1.25);
});
canvas.addEventListener('mousedown', (e) => {
  initAudio();
  if (!inGame()) return;
  if (!locked && !fallbackLook) { lock(); return; }
  const h = human();
  if (e.button === 0 || e.button === 2) {
    e.preventDefault();
    if (!h.alive) specIdx++;
    else if (state === 'playing') h.queued = h.cool + 0.08; // one shot per click, either button; waits for trigger reset
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  if (inGame() && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.target instanceof HTMLInputElement) return; // typing a name or room code
  if (e.code === 'KeyP' || (e.code === 'Escape' && !locked)) {
    if (state === 'paused' || localPaused) resume();
    else if (inGame()) { releaseLock(); pause(); }
    return;
  }
  keys[e.code] = true;
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; if (inGame()) { releaseLock(); pause(); } });

// ---------- boot ----------
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
makePlayers(); assignSlots([{ slot: 1, id: 'local', name: 'You' }]); resetPlayers(); buildViewmodel();
showScreen('home');
{ // invite links: ?room=CODE opens the join screen with the code filled in
  const code = cleanCode(new URLSearchParams(location.search).get('room'));
  if (code.length === 5) { mpCode.value = code; showScreen('mp'); $('mpStatus').textContent = 'Enter your name and press Join.'; }
}
// warn before closing the tab while hosting (everyone would be dropped)
addEventListener('beforeunload', (e) => { if (net.mode === 'host' && lobby.players.length > 1) { e.preventDefault(); e.returnValue = ''; } });

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  update(dt); renderHud();
  renderer.render(scene, camera);
  renderPreview(dt);
}
renderer.setAnimationLoop(frame);
$('loading').classList.add('hidden');

// test hook: only with ?debug in the URL
if (location.search.includes('debug')) {
  window.__splat = {
    step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { update(dt); } last = performance.now(); renderHud(); renderer.render(scene, camera); renderPreview(dt); },
    start() { fallbackLook = true; startMatch(); },
    get info() { return { state, score, round, alive: players.filter((p) => p.alive).map((p) => p.name), balls: balls.length, coins: save.coins }; },
    players: () => players,
    net: () => net,
    lobby: () => lobby,
    previewYaw(y) { if (preview) preview.yaw = y; },
  };
}
