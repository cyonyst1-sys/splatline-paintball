// Game loop, players, bots, game modes, shooting, menus and HUD.
import * as THREE from 'three';
import { createWorld, TEAMS, NETB, FIELD, resolveCircle, segBlocked2D, segCircle, supportHeight } from './world.js';
import { save, persist, resetSave, UPGRADES, stat, costOf, buy, addCoins } from './economy.js';
import { sfx, initAudio, setListener, setVolume } from './audio.js';
import { makeMarker, disposeMarker } from './marker.js';
import { mapById, mapsFor } from './maps.js';
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
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`; };

const high = save.settings.quality !== 'low';
const canvas = $('c');
const world = createWorld(canvas, high);
const { renderer, scene, camera } = world;
setVolume(save.settings.volume);

const PR = 0.38, H_STAND = 1.8, H_CROUCH = 1.2, H_PRONE = 0.55, GRAV = 3.5, FALL_G = 22, WIN_ROUNDS = 3;
const BOT = { ball: 46, mag: 20, reload: 1.6 };
const DIFF = {
  easy:   { err: 0.085, react: 0.9,  rate: 0.55, lead: 0.3,  speed: 3.6, sight: 28, reward: 0.75 },
  normal: { err: 0.055, react: 0.6,  rate: 0.36, lead: 0.6,  speed: 4.2, sight: 34, reward: 1 },
  hard:   { err: 0.03,  react: 0.35, rate: 0.25, lead: 0.9,  speed: 4.6, sight: 42, reward: 1.5 },
};
const REWARD = { tag: 25, round: 40, win: 150, play: 30, capture: 60, ret: 15 };
export const MODES = {
  elim: { name: 'Elimination', desc: "One hit and you're out. First team to win 3 rounds.", teamSize: 4 },
  ctf: { name: 'Capture the Flag', desc: 'Infinite respawns. Bring their flag to yours. First to 3 captures, or most in 6 min.', teamSize: 6 },
  koth: { name: 'King of the Castle', desc: 'Attackers respawn forever. Defenders get 3 lives each. Hold the throne room to win.', teamSize: 6 },
};
const CTF = { caps: 3, time: 360, returnT: 20, pickR: 1.4, capR: 2.6 };
const KOTH = { time: 240, lives: 3, capSecs: 30, rounds: 2 };
const RESPAWN_T = 4, PROTECT_T = 2.5;

// ---------- models ----------
const G = {
  leg: new THREE.CapsuleGeometry(0.1, 0.6, 4, 8),
  torso: new THREE.CapsuleGeometry(0.23, 0.42, 6, 12),
  head: new THREE.SphereGeometry(0.15, 16, 12),
  mask: new THREE.BoxGeometry(0.12, 0.17, 0.27),
  lens: new THREE.BoxGeometry(0.04, 0.07, 0.24),
  arm: new THREE.CapsuleGeometry(0.06, 0.36, 4, 8),
};
const M = {
  skin: new THREE.MeshStandardMaterial({ color: 0xd9a37f, roughness: 0.7 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.85 }),
  mask: new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.1, metalness: 0.6, emissive: 0x16304a }),
  jersey: TEAMS.map((t) => new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.75 })),
  out: TEAMS.map((t) => new THREE.MeshStandardMaterial({ color: new THREE.Color(t.color).lerp(new THREE.Color(0x777777), 0.7), roughness: 0.9 })),
};
function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; }
function makeModel(team) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const legs = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(0, 0.82, s * 0.12);
    pivot.add(mesh(G.leg, M.pants, 0, -0.4, 0)); body.add(pivot); legs.push(pivot);
  }
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
vm.rotation.y = Math.PI / 2 + 0.06;
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
let matchDiff = save.settings.diff, myTeam = 0, localPaused = false, snapT = 0, poseT = 0;
let roundTime = 0, navBudget = 3; const HUNT_AFTER = 40;
let gameMode = 'elim', teamSize = 4, timeLeft = 0;
let flagsSt = null;                                   // CTF: [{ team, hx, hz, st: 0 home | 1 carried | 2 dropped, carrier, x, z, dropT }]
const koth = { progress: 0, contested: false, att: 0, capTime: [null, null] };
let lobby = { code: '', mode: 'teams', game: 'elim', map: 'center', players: [] };
let earned = null, specIdx = 0, locked = false, fallbackLook = false, hitMarker = 0, clock = 0, shopBack = 'home';
let flash = null; // { text, color, t }
const keys = {}, mouse = { down: false };
const ray = new THREE.Raycaster();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const human = () => players.find((p) => p.human);
const inGame = () => state === 'countdown' || state === 'playing' || state === 'roundEnd';
const respawnMode = () => gameMode !== 'elim';
const attackers = () => (round % 2 === 1 ? 0 : 1); // King of the Castle: blue attacks in round 1, red in round 2

// ---------- maps & modes ----------
let currentMap = null, currentMode = null;
const mapOptions = (mode) => ['random', ...mapsFor(mode).map((m) => m.id)];
const validMap = (id, mode) => mapsFor(mode).some((m) => m.id === id);
const resolveMap = (sel, mode) => { if (validMap(sel, mode)) return sel; const l = mapsFor(mode); return l[(Math.random() * l.length) | 0].id; };
const previewMap = (sel, mode) => (validMap(sel, mode) ? sel : mapsFor(mode)[0].id);
function ensureMap(id, mode) {
  if (currentMap === id && currentMode === mode) return;
  world.loadMap(id, mode); currentMap = id; currentMode = mode;
  buildObjectives();
}
function mapInfo(sel, mode) { return validMap(sel, mode) ? mapById(sel) : { name: '🎲 Random map', desc: 'A different field every match.' }; }
const cycleMap = (sel, d, mode) => { const o = mapOptions(mode), i = Math.max(0, o.indexOf(sel)); return o[(i + d + o.length) % o.length]; };
const mapSel = (mode) => save.settings['map_' + mode] || (mode === 'elim' ? (save.settings.map || 'center') : 'random');
const validMode = (m) => Object.hasOwn(MODES, m);

// ---------- players ----------
function makePlayers(n) {
  for (const p of players) { scene.remove(p.model.root); disposeMarker(p.model.gun); }
  players = []; teamSize = n;
  for (let team = 0; team < 2; team++) for (let i = 0; i < n; i++) {
    const model = makeModel(team); scene.add(model.root);
    players.push({
      team, i, human: false, ctrl: 'bot', peer: null, name: TEAMS[team].names[i], model,
      x: 0, z: 0, y: 0, vy: 0, ang: 0, bodyAng: 0, pitch: 0, h: H_STAND, crouch: false, alive: true,
      diveT: 0, diveCd: 0, diveDir: 0, queued: 0, crouchOn: false, cWas: false, spaceWas: false, lean: 0,
      ammo: 20, mag: 20, reload: 0, reloadT: 1.6, cd: 0, cool: 0.3, spread: 1, ballSpeed: 46, kills: 0,
      vx: 0, vz: 0, mvx: 0, mvz: 0, phase: 0, moving: false, sprint: false,
      lives: Infinity, respawnT: 0, protect: 0, role: i % 3 === 2 ? 'defend' : 'attack', spot: null, defSpot: null,
      goal: null, goalT: 0, seen: 0, tgt: null, td: 0, scanT: 0, strafe: 1, strafeT: 0, stuckT: 0, lx: 0, lz: 0, avoid: 1, hold: false,
      path: null, pathGoal: null, pathT: 0,
    });
  }
}
// where a player starts or respawns
function spawnFor(p, jitter) {
  const n = teamSize, side = p.team ? 1 : -1, jz = jitter ? rand(-1, 1) : 0;
  const castle = world.info.castle;
  if (gameMode === 'koth' && castle) {
    if (p.team !== attackers()) {
      const d = castle.defend[p.i % castle.defend.length];
      return { x: d.x, z: d.z, y: d.y, ang: Math.PI };
    }
    return { x: -(FIELD.hw - 3), z: (p.i - (n - 1) / 2) * 3 + jz, y: 0, ang: 0 };
  }
  // CTF: spawn in the two back corners, well away from your own flag, so a base can actually be raided
  if (gameMode === 'ctf') return { x: side * (FIELD.hw - 3 - (p.i >> 1) * 1.6), z: (p.i % 2 ? 1 : -1) * (FIELD.hd - 4) + jz, y: 0, ang: p.team ? Math.PI : 0 };
  return { x: side * (FIELD.hw - 2.5), z: (p.i - (n - 1) / 2) * 3 + jz, y: 0, ang: p.team ? Math.PI : 0 };
}
function placeAt(p, s) {
  p.x = s.x; p.z = s.z; p.y = s.y || 0; p.vy = 0; p.ang = p.bodyAng = s.ang; p.h = H_STAND;
  resolveCircle(p, PR);
}
function reviveModel(p) {
  p.model.torso.material = M.jersey[p.team];
  for (const a of p.model.arms) a.material = M.jersey[p.team];
  p.model.armUp.visible = false; p.model.gun.visible = true;
  for (const c of [...p.model.root.children]) if (c.userData.decal) c.removeFromParent();
}
function freshLife(p) {
  p.pitch = 0; p.diveT = 0; p.diveCd = 0; p.queued = 0; p.crouchOn = false; p.lean = 0;
  p.alive = true; p.crouch = false; p.ammo = p.mag; p.reload = 0; p.cd = 0;
  p.vx = p.vz = p.mvx = p.mvz = 0; p.tx = undefined;
  p.goal = null; p.tgt = null; p.seen = 0; p.scanT = Math.random() * 0.2; p.stuckT = 0; p.lx = p.x; p.lz = p.z; p.path = null; p.flankDone = false;
  p.lane = [-1, -0.45, 0, 0.45, 1][(Math.random() * 5) | 0];
  p.hold = Math.random() < 0.5; p.avoid = Math.random() < 0.5 ? 1 : -1;
  reviveModel(p);
}
function resetPlayers() {
  world.clearSplats();
  for (const b of balls) freeBall(b);
  balls = [];
  for (const p of players) {
    const s = spawnFor(p, false);
    placeAt(p, s); freshLife(p);
    p.spot = s; p.respawnT = 0; p.protect = 0;
    p.lives = gameMode === 'koth' && p.team !== attackers() ? KOTH.lives : Infinity;
  }
}
const slotIdx = (p) => players.indexOf(p);
// ctrl: 'local' (this browser's player), 'bot' (AI run here), 'remote' (a human, seen by the host), 'net' (anyone, seen by a joiner)
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
    if (p.human) { p.mag = stat('hopper'); p.cool = stat('rate'); p.reloadT = stat('reload'); p.spread = stat('barrel'); p.ballSpeed = stat('velocity'); }
    else { p.mag = BOT.mag; p.reloadT = BOT.reload; p.ballSpeed = BOT.ball; }
  }
}

// ---------- line of sight / movement ----------
function losClear(ax, ay, az, bx, by, bz) {
  v1.set(ax, ay, az); v2.set(bx - ax, by - ay, bz - az);
  const len = v2.length(); if (len < 1e-6) return true;
  ray.set(v1, v2.divideScalar(len)); ray.near = 0; ray.far = len;
  return ray.intersectObjects(world.bunkerMeshes, false).length === 0;
}
const eyeY = (p) => (p.y || 0) + p.h * 0.9 - Math.abs(p.lean) * 0.05;
const chestY = (p) => (p.y || 0) + p.h * 0.72;
const LEAN_DIST = 0.42;
function leanOffset(p, k = 1) {
  const d = p.lean * LEAN_DIST * k;
  return { x: -Math.sin(p.ang) * d, z: Math.cos(p.ang) * d };
}
// careful = don't walk off a ledge (bots on upper floors)
function move(p, dx, dz, careful) {
  const ox = p.x, oz = p.z;
  p.x += dx; p.z += dz; resolveCircle(p, PR);
  if (careful && p.y > 0.5 && supportHeight(p.x, p.z, p.y) < p.y - 0.6) { p.x = ox; p.z = oz; }
}
// walk up ramps, stand on floors, fall off edges
function physicsY(p, dt) {
  const sup = supportHeight(p.x, p.z, p.y);
  if (p.y > sup + 0.02) { p.vy -= FALL_G * dt; p.y = Math.max(sup, p.y + p.vy * dt); if (p.y === sup) p.vy = 0; }
  else { p.y = sup; p.vy = 0; }
}

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
  balls.push({ pos: pos.clone(), vel: vel.clone(), team: owner.team, owner, life: 2.2, mesh: m });
  sfx.shot(owner.human ? null : pos);
}
function fire(p, pos, vel) {
  if (p.ammo <= 0 || p.reload > 0) return;
  p.ammo--; p.protect = 0; // shooting ends spawn protection
  spawnBall(p, pos, vel);
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
      const t = p0.y <= 0 ? 0 : p0.y / -seg.y;
      if (t < tBest) { tBest = t; kind = 'ground'; point = p0.clone().addScaledVector(seg, t); point.y = 0; normal = UP; }
    }
    if (state === 'playing') {
      for (const p of players) {
        if (!p.alive || p.team === b.team || p.protect > 0) continue;
        const lo = leanOffset(p, 0.8), y0 = p.y || 0, split = y0 + p.h * 0.55;
        for (const [cx, cz, ya, yb, r] of [[p.x, p.z, y0, split, PR + 0.04], [p.x + lo.x, p.z + lo.z, split, y0 + p.h + 0.05, PR * 0.85 + 0.04]]) {
          const t = segCircle(p0.x, p0.z, p0.x + seg.x, p0.z + seg.z, cx, cz, r);
          if (t >= 0 && t < tBest) {
            const y = p0.y + seg.y * t;
            if (y >= ya && y <= yb) { tBest = t; kind = 'player'; hitP = p; point = p0.clone().addScaledVector(seg, t); }
          }
        }
      }
    }
    if (kind) {
      if (kind === 'player') {
        if (net.mode === 'client') world.puff(point, b.team);
        else eliminate(hitP, b.owner, point);
      } else { world.addSplat(point, normal, b.team, rand(0.32, 0.5)); world.puff(point, b.team); sfx.splat(point); }
      freeBall(b); balls.splice(k, 1); continue;
    }
    b.pos.add(seg); b.mesh.position.copy(b.pos); b.life -= dt;
    if (b.life <= 0 || Math.abs(b.pos.x) > NETB.hw || Math.abs(b.pos.z) > NETB.hd) { freeBall(b); balls.splice(k, 1); }
  }
}
// rs: seconds until respawn (sent by the host so joiners can show it)
function eliminate(p, by, point, rs) {
  if (!p.alive) return;
  const local = net.mode !== 'client';
  if (local && respawnMode()) {
    if (p.lives !== Infinity) p.lives--;
    p.respawnT = p.lives > 0 ? (gameMode === 'ctf' ? 6 : RESPAWN_T) : 0;
  } else if (!local) p.respawnT = rs || 0;
  if (net.mode === 'host') broadcast({ t: 'tag', v: slotIdx(p), b: slotIdx(by), pt: vec(point), rs: p.respawnT });
  if (local && flagsSt) for (const F of flagsSt) if (F.st === 1 && F.carrier === slotIdx(p)) dropFlag(F, p);
  p.alive = false; p.reload = 0; p.crouch = false; p.lean = 0; p.diveT = 0;
  const n = new THREE.Vector3(point.x - p.x, 0, point.z - p.z).normalize();
  const d = world.addSplat(point, n, by.team, 0.42, p.model.root); if (d) d.userData.decal = true;
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
function respawn(p) {
  const s = spawnFor(p, true);
  placeAt(p, s); freshLife(p);
  p.protect = PROTECT_T; p.respawnT = 0;
  if (net.mode === 'host') broadcast({ t: 'spawn', s: slotIdx(p), x: r3(p.x), z: r3(p.z), y: r3(p.y), a: r3(p.ang) });
  if (p.human) sfx.beep();
}
const reward = (n) => Math.round(n * DIFF[matchDiff].reward);

// ---------- human ----------
const DIVE_T = 0.95;
function updateHuman(p, dt) {
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  p.bodyAng = p.ang;
  const cKey = !!keys.KeyC;
  if (save.settings.crouchToggle) { if (cKey && !p.cWas) p.crouchOn = !p.crouchOn; p.crouch = p.crouchOn; }
  else p.crouch = cKey;
  p.cWas = cKey;
  const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
  let mx = ca * f - sa * s, mz = sa * f + ca * s;
  const len = Math.hypot(mx, mz);
  p.diveCd -= dt;
  if (keys.Space && !p.spaceWas && p.diveT <= 0 && p.diveCd <= 0) {
    p.diveDir = len > 0 ? Math.atan2(mz, mx) : p.ang;
    p.diveT = DIVE_T; p.crouchOn = false; sfx.dive();
  }
  p.spaceWas = !!keys.Space;
  if (p.diveT > 0) {
    const t = DIVE_T - p.diveT;
    p.diveT -= dt;
    const sp = t < 0.35 ? 8.6 - t * 12 : Math.max(0, 4.4 - (t - 0.35) * 11);
    move(p, Math.cos(p.diveDir) * sp * dt, Math.sin(p.diveDir) * sp * dt);
    p.mvx = p.mvz = 0; p.moving = sp > 0.5; p.sprint = false;
    if (p.diveT <= 0) { p.diveT = 0; p.diveCd = 0.5; }
  } else {
    p.sprint = !!(keys.ShiftLeft || keys.ShiftRight) && f > 0 && !p.crouch && Math.abs(p.lean) < 0.2;
    const sp = p.crouch ? 2.4 : p.sprint ? 7.2 : 4.8;
    if (len > 0) { mx = mx / len * sp; mz = mz / len * sp; }
    const k = Math.min(1, dt * 12);
    p.mvx += (mx - p.mvx) * k; p.mvz += (mz - p.mvz) * k;
    move(p, p.mvx * dt, p.mvz * dt);
    p.moving = len > 0;
  }
  let want = p.diveT > 0 ? 0 : (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
  if (want) {
    const rx = -Math.sin(p.ang) * want * LEAN_DIST, rz = Math.cos(p.ang) * want * LEAN_DIST;
    let q = 1;
    while (q > 0 && segBlocked2D(p.x, p.z, p.x + rx * q, p.z + rz * q, 0.14, p.y, p.h)) q -= 0.1;
    want *= Math.max(0, q);
  }
  p.lean += (want - p.lean) * Math.min(1, dt * 10);
  if (Math.abs(p.lean) > 0.2) p.sprint = false;
  if (keys.KeyR) startReload(p);
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
  ray.set(camera.position, dir); ray.near = 0; ray.far = 120;
  const hits = ray.intersectObjects(world.bunkerMeshes, false);
  let d = hits.length ? hits[0].distance : 120;
  if (dir.y < 0) d = Math.min(d, -camera.position.y / dir.y);
  const aim = camera.position.clone().addScaledVector(dir, Math.max(d, 2));
  const muzzle = vmMuzzle.getWorldPosition(new THREE.Vector3());
  const v = aim.sub(muzzle).normalize();
  const sp = currentSpread(p);
  v.x += gauss() * sp; v.y += gauss() * sp; v.z += gauss() * sp; v.normalize();
  fire(p, muzzle, v.multiplyScalar(p.ballSpeed));
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
    if (near && !losClear(near.x, eyeY(near), near.z, c.x, 1.3, c.z)) sc += 8;
    if (sc > bestS) { bestS = sc; best = c; }
  }
  b.goal = best ? { x: best.x, z: best.z } : { x: rand(-5, 5), z: rand(-10, 10) };
  b.goalT = rand(4, 8);
}
function steer(b, tx, tz, speed, dt, careful = true) {
  let a = Math.atan2(tz - b.z, tx - b.x);
  for (const o of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
    const aa = a + o * b.avoid;
    if (!segBlocked2D(b.x, b.z, b.x + Math.cos(aa) * 1.2, b.z + Math.sin(aa) * 1.2, PR - 0.05, b.y, b.h)) { a = aa; break; }
  }
  move(b, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt, careful);
  return a;
}
// walk toward a goal along a ground-level path (bots on upper floors walk straight; carefully unless told to drop down)
function followPath(b, goal, speed, dt) {
  if (b.y > 0.6) return steer(b, goal.x, goal.z, speed, dt, !goal.drop);
  b.pathT -= dt;
  if (!b.path || b.pathT <= 0 || !b.pathGoal || Math.hypot(goal.x - b.pathGoal.x, goal.z - b.pathGoal.z) > 2.5) {
    if (navBudget > 0) { navBudget--; b.path = world.findPath(b.x, b.z, goal.x, goal.z) || []; b.pathGoal = { x: goal.x, z: goal.z }; b.pathT = rand(1.5, 2.6); }
  }
  while (b.path && b.path.length > 1 && Math.hypot(b.path[0].x - b.x, b.path[0].z - b.z) < 0.8) b.path.shift();
  const wp = b.path && b.path.length ? b.path[0] : goal;
  return steer(b, wp.x, wp.z, speed, dt);
}
// what a bot should be doing in CTF / King of the Castle: { x, z, rush (keep moving while fighting), hold (stay put) }
function objectiveFor(b) {
  if (gameMode === 'ctf' && flagsSt) {
    const me = slotIdx(b), own = flagsSt[b.team], enemy = flagsSt[1 - b.team];
    if (enemy.st === 1 && enemy.carrier === me) return { x: own.hx, z: own.hz, rush: true, carry: true };
    if (own.st === 1) { const c = players[own.carrier]; if (b.role === 'defend' || dist(b, c) < 16) return { x: c.x, z: c.z, rush: true }; }
    if (own.st === 2 && (b.role === 'defend' || dist(b, own) < 14)) return { x: own.x, z: own.z, rush: true };
    if (b.role === 'attack') {
      if (enemy.st === 1) { const c = players[enemy.carrier]; return { x: c.x + (b.team ? 2 : -2), z: c.z + (b.i % 2 ? 2.5 : -2.5), rush: true }; }
      // each life, push up a random lane first (flank, inside or centre), then cut in to the flag
      if (!b.flankDone) {
        const fp = { x: enemy.hx * 0.4, z: b.lane * (FIELD.hd - 5) };
        if (dist(b, fp) < 4) b.flankDone = true; else return { x: fp.x, z: fp.z, rush: true };
      }
      return { x: enemy.x, z: enemy.z, rush: true };
    }
    if (!b.defSpot || Math.hypot(b.defSpot.x - own.hx, b.defSpot.z - own.hz) > 14) {
      const near = world.cover.filter((c) => Math.hypot(c.x - own.hx, c.z - own.hz) < 12);
      b.defSpot = near.length ? near[(Math.random() * near.length) | 0] : { x: own.hx + (b.team ? -3 : 3), z: own.hz };
    }
    return { x: b.defSpot.x, z: b.defSpot.z, hold: true };
  }
  if (gameMode === 'koth' && world.info.castle) {
    const zn = world.info.castle.zone, att = attackers();
    if (b.team === att) return { x: zn.x + ((b.i % 3) - 1) * 1.1, z: zn.z + (((b.i / 3) | 0) - 0.5) * 1.6, rush: dist(b, zn) < 24 };
    const c = world.info.castle, onGround = b.y < 0.6;
    // only half the defenders leave their posts, and only once the capture is really under way
    const alarm = (koth.att >= 2 || koth.progress > 0.12) && (onGround || b.i % 2 === 0);
    if (onGround && (alarm || (b.spot && b.spot.y > 0.6))) return { x: zn.x, z: zn.z, rush: true, hold: dist(b, zn) < zn.r - 0.8 };
    if (alarm) { // come down to defend the throne room: drop through a stairwell, or hop off the wall-walk
      const inKeep = Math.abs(b.x - c.keep.x) < c.keep.hw && Math.abs(b.z - c.keep.z) < c.keep.hd;
      if (b.y > 4.5) return { ...c.holes.roof, rush: true, drop: true };
      if (inKeep && b.y > 2.2) return { ...c.holes.floor2, rush: true, drop: true };
      return { x: zn.x, z: zn.z, rush: true, drop: true };
    }
    return { x: b.spot.x, z: b.spot.z, hold: true };
  }
  return null;
}
function updateBot(b, dt) {
  const D = DIFF[matchDiff];
  const foes = players.filter((p) => p.alive && p.team !== b.team && p.protect <= 0);
  const obj = respawnMode() ? objectiveFor(b) : null;
  b.scanT -= dt;
  if (b.tgt && (!b.tgt.alive || b.tgt.protect > 0)) b.tgt = null;
  if (b.scanT <= 0) {
    b.scanT = rand(0.12, 0.22);
    let best = null, bd = 1e9;
    const sight = respawnMode() ? D.sight * 0.75 : D.sight; // big fields: cover and flanks need to actually hide you
    for (const f of foes) {
      const d = Math.hypot(f.x - b.x, f.z - b.z);
      const lo = leanOffset(f, 0.8);
      if (d < sight && d < bd && losClear(b.x, eyeY(b), b.z, f.x + lo.x, chestY(f), f.z + lo.z)) { best = f; bd = d; }
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
    const tl = leanOffset(t, 0.8);
    const px = t.x + tl.x + t.vx * ft * D.lead, pz = t.z + tl.z + t.vz * ft * D.lead;
    const want = Math.atan2(pz - b.z, px - b.x);
    const da = angDiff(want, b.ang);
    b.ang += da * Math.min(1, dt * 9);
    const muzzleY = eyeY(b) - 0.25;
    b.pitch = Math.atan2(chestY(t) + 0.5 * GRAV * ft * ft - muzzleY, Math.max(0.5, td));
    if (b.seen > D.react + (respawnMode() ? 0.25 : 0) && b.cd <= 0 && b.reload <= 0 && Math.abs(da) < 0.2) {
      // paintballs wander more over long distances; respawn modes are a bit looser so attacks can get through
      const err = D.err * (1 + Math.max(0, td - 12) / 20) * (respawnMode() ? 1.35 : 1);
      const yaw = b.ang + gauss() * err, pitch = b.pitch + gauss() * err * 0.6;
      const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
      const pos = new THREE.Vector3(b.x + Math.cos(b.ang) * 0.55, muzzleY, b.z + Math.sin(b.ang) * 0.55);
      fire(b, pos, dir.multiplyScalar(b.ballSpeed));
      b.cd = D.rate * rand(0.8, 1.4);
    }
    if (obj && obj.rush && !obj.hold) {
      // keep pushing toward the objective, zig-zagging to be harder to hit
      // flag carriers just sprint home
      const a = followPath(b, obj, D.speed * (obj.carry ? 1.25 : 1.0), dt);
      if (!obj.carry) {
        b.strafeT -= dt;
        if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = rand(0.35, 0.8); }
        const w = D.speed * 0.55 * b.strafe;
        move(b, -Math.sin(a) * w * dt, Math.cos(a) * w * dt, true);
      }
    }
    else if (obj && obj.hold && b.y > 0.6) { /* hold the firing position */ }
    else {
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = rand(0.5, 1.4); }
      const perp = want + Math.PI / 2 * b.strafe;
      let sx = Math.cos(perp), sz = Math.sin(perp);
      if (td < 7) { sx -= Math.cos(want) * 0.8; sz -= Math.sin(want) * 0.8; }
      if (b.reload > 0 && b.goal && !obj) followPath(b, b.goal, D.speed * 0.6, dt);
      else { const sp = (b.hold || (obj && obj.hold)) ? D.speed * 0.4 : D.speed * 0.75; move(b, sx * sp * dt, sz * sp * dt, true); }
    }
    return;
  }
  b.seen = 0; b.pitch *= 0.9;
  if (obj) {
    const d = dist(b, obj);
    if (d > (obj.hold ? 0.5 : 1.2)) {
      const a = followPath(b, obj, obj.hold && d < 3 ? D.speed * 0.5 : obj.carry ? D.speed * 1.3 : obj.rush ? D.speed * 1.15 : D.speed, dt);
      b.ang += angDiff(a, b.ang) * Math.min(1, dt * 6);
      // not getting anywhere? re-plan and try the other way round
      b.stuckT += dt;
      if (b.stuckT > 1.2) {
        if (Math.hypot(b.x - b.lx, b.z - b.lz) < 0.5) { b.path = null; b.avoid = -b.avoid; b.flankDone = true; }
        b.stuckT = 0; b.lx = b.x; b.lz = b.z;
      }
    } else {
      // look toward where enemies will come from
      const lookX = gameMode === 'koth' && b.team !== attackers() ? -1 : (b.team ? -1 : 1);
      b.ang += angDiff(lookX > 0 ? 0 : Math.PI, b.ang) * Math.min(1, dt * 3);
    }
    return;
  }
  if (!foes.length) return;
  b.goalT -= dt;
  if (roundTime > HUNT_AFTER) {
    if (!b.goal || b.goalT <= 0 || !b.hunting) {
      let near = foes[0], nd = 1e9;
      for (const f of foes) { const dd = Math.hypot(f.x - b.x, f.z - b.z); if (dd < nd) { nd = dd; near = f; } }
      b.goal = { x: near.x, z: near.z }; b.goalT = 1.5; b.hunting = true;
    }
  } else if (!b.goal || b.goalT <= 0) { b.hunting = false; pickGoal(b, foes); }
  const d = Math.hypot(b.goal.x - b.x, b.goal.z - b.z);
  if (d > 0.3) {
    const a = followPath(b, b.goal, b.crouch ? D.speed * 0.6 : D.speed, dt);
    b.ang += angDiff(a, b.ang) * Math.min(1, dt * 6);
  } else {
    let near = foes[0], nd = 1e9;
    for (const f of foes) { const dd = Math.hypot(f.x - b.x, f.z - b.z); if (dd < nd) { nd = dd; near = f; } }
    b.ang += angDiff(Math.atan2(near.z - b.z, near.x - b.x), b.ang) * Math.min(1, dt * 4);
    if (Math.random() < dt * 0.25 && roundTime <= HUNT_AFTER) pickGoal(b, foes);
  }
  b.stuckT += dt;
  if (b.stuckT > 0.8) {
    if (d > 0.8 && Math.hypot(b.x - b.lx, b.z - b.lz) < 0.4) { b.avoid = -b.avoid; b.path = null; pickGoal(b, foes); }
    b.stuckT = 0; b.lx = b.x; b.lz = b.z;
  }
}

// ---------- objectives (flags, castle zone) ----------
const objGroup = new THREE.Group(); scene.add(objGroup);
let zoneMesh = null, zoneBeam = null;
function makeFlagMesh(team) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.3 }));
  pole.position.y = 1.2; g.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.65), new THREE.MeshStandardMaterial({ color: TEAMS[team].color, emissive: TEAMS[team].color, emissiveIntensity: 0.35, side: THREE.DoubleSide }));
  cloth.position.set(0.5, 2.05, 0); g.add(cloth);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 0.7, roughness: 0.3 }));
  knob.position.y = 2.42; g.add(knob);
  g.traverse((m) => { if (m.isMesh) m.castShadow = high; });
  return g;
}
function buildObjectives() {
  for (const c of [...objGroup.children]) { c.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } }); objGroup.remove(c); }
  zoneMesh = zoneBeam = null; flagsSt = null;
  if (world.info.flags) {
    flagsSt = world.info.flags.map((h, team) => {
      const stand = new THREE.Mesh(new THREE.RingGeometry(CTF.capR - 0.25, CTF.capR, 40), new THREE.MeshBasicMaterial({ color: TEAMS[team].color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      stand.rotation.x = -Math.PI / 2; stand.position.set(h.x, 0.03, h.z); objGroup.add(stand);
      const mesh = makeFlagMesh(team); objGroup.add(mesh);
      return { team, hx: h.x, hz: h.z, st: 0, carrier: -1, x: h.x, z: h.z, dropT: 0, mesh };
    });
  }
  const c = world.info.castle;
  if (c) {
    zoneMesh = new THREE.Mesh(new THREE.RingGeometry(c.zone.r - 0.3, c.zone.r, 48), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    zoneMesh.rotation.x = -Math.PI / 2; zoneMesh.position.set(c.zone.x, 0.04, c.zone.z); objGroup.add(zoneMesh);
    zoneBeam = new THREE.Mesh(new THREE.CylinderGeometry(c.zone.r, c.zone.r, 2.9, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
    zoneBeam.position.set(c.zone.x, 1.45, c.zone.z); objGroup.add(zoneBeam);
  }
}
function resetObjectives() {
  if (flagsSt) for (const F of flagsSt) { F.st = 0; F.carrier = -1; F.x = F.hx; F.z = F.hz; F.dropT = 0; }
  koth.progress = 0; koth.contested = false; koth.att = 0;
  timeLeft = gameMode === 'ctf' ? CTF.time : gameMode === 'koth' ? KOTH.time : 0;
}
function syncObjectives() {
  if (flagsSt) for (const F of flagsSt) {
    const c = F.st === 1 ? players[F.carrier] : null;
    if (c) {
      F.mesh.position.set(c.x - Math.cos(c.ang) * 0.25, (c.y || 0) + 0.2, c.z - Math.sin(c.ang) * 0.25);
      F.mesh.scale.setScalar(0.75); F.mesh.rotation.set(0, -c.ang, 0.15);
    } else {
      F.mesh.position.set(F.x, 0, F.z); F.mesh.scale.setScalar(1);
      F.mesh.rotation.set(0, clock * 0.8, F.st === 2 ? 0.35 : 0);
    }
  }
  if (zoneMesh) {
    const att = attackers(), col = new THREE.Color(TEAMS[1 - att].color).lerp(new THREE.Color(TEAMS[att].color), koth.progress);
    if (koth.contested) col.set(0xffd23f);
    zoneMesh.material.color.copy(col); zoneBeam.material.color.copy(col);
    zoneBeam.material.opacity = 0.06 + (koth.att > 0 ? 0.08 + Math.sin(clock * 6) * 0.03 : 0);
  }
}
function carrying(p) { return !!flagsSt && flagsSt.some((F) => F.st === 1 && F.carrier === slotIdx(p)); }
function dropFlag(F, c) {
  F.st = 2; F.carrier = -1; F.dropT = CTF.returnT;
  if (c) { F.x = c.x; F.z = c.z; }
  objEvent('dropped', F.team, c);
}
function returnFlag(F, by) {
  F.st = 0; F.carrier = -1; F.x = F.hx; F.z = F.hz;
  objEvent('returned', F.team, by);
}
function objEvent(k, team, p) {
  if (net.mode === 'host') broadcast({ t: 'obj', k, tm: team, by: p ? slotIdx(p) : -1 });
  onObj(k, team, p);
}
function showFlash(text, color, secs = 3) { flash = { text, color, t: secs }; }
function onObj(k, team, p) {
  const T = TEAMS[team], P = p ? TEAMS[p.team] : null;
  if (k === 'taken') { showFlash(`${p.name} took the ${T.name} flag!`, P.css); sfx.beep(); }
  else if (k === 'dropped') { showFlash(`${T.name} flag dropped`, T.css); }
  else if (k === 'returned') {
    showFlash(p ? `${p.name} returned the ${T.name} flag` : `${T.name} flag returned to base`, T.css); sfx.beep();
    if (p && p.human && earned) { const c = reward(REWARD.ret); earned.obj += c; addCoins(c); popCoins(c, 'RETURN'); }
  } else if (k === 'captured') {
    showFlash(`${p.name} captured the ${T.name} flag!`, P.css, 4); sfx.go();
    if (p && p.human && earned) { const c = reward(REWARD.capture); earned.obj += c; addCoins(c); popCoins(c, 'CAPTURE'); }
  } else if (k === 'castle') { showFlash(`${T.name} TOOK THE CASTLE!`, T.css, 4); sfx.go(); }
  else if (k === 'wiped') { showFlash(`${T.name} defenders are out of lives`, T.css, 4); }
  else if (k === 'held') { showFlash(`${T.name} HELD THE CASTLE!`, T.css, 4); sfx.go(); }
}
function ctfUpdate(dt) {
  for (const F of flagsSt) {
    if (F.st === 1) { const c = players[F.carrier]; if (!c || !c.alive) dropFlag(F, c); else { F.x = c.x; F.z = c.z; } }
    if (F.st === 2) { F.dropT -= dt; if (F.dropT <= 0) returnFlag(F, null); }
    if (F.st === 1) continue;
    for (const p of players) {
      if (!p.alive || p.y > 1.2 || Math.hypot(p.x - F.x, p.z - F.z) > CTF.pickR) continue;
      if (p.team !== F.team && !carrying(p)) { F.st = 1; F.carrier = slotIdx(p); objEvent('taken', F.team, p); break; }
      if (p.team === F.team && F.st === 2) { returnFlag(F, p); break; }
    }
  }
  for (const F of flagsSt) {
    if (F.st !== 1) continue;
    const c = players[F.carrier], own = flagsSt[c.team];
    if (own.st === 0 && Math.hypot(c.x - own.hx, c.z - own.hz) < CTF.capR) {
      score[c.team]++;
      F.st = 0; F.carrier = -1; F.x = F.hx; F.z = F.hz;
      objEvent('captured', F.team, c);
      if (score[c.team] >= CTF.caps) { endRound(c.team, false); return; }
    }
  }
  timeLeft -= dt;
  if (timeLeft <= 0) endRound(score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : -1, false);
}
function kothUpdate(dt) {
  const att = attackers(), zn = world.info.castle.zone;
  let a = 0, d = 0;
  for (const p of players) {
    if (!p.alive || p.y > 1.2 || Math.hypot(p.x - zn.x, p.z - zn.z) > zn.r) continue;
    if (p.team === att) a++; else d++;
  }
  koth.att = a; koth.contested = a > 0 && d > 0;
  // more attackers capture faster, up to 3 at once; an empty room slowly resets
  if (a > 0 && d === 0) koth.progress = Math.min(1, koth.progress + dt / KOTH.capSecs * (1 + 0.25 * (Math.min(a, 3) - 1)));
  else if (a === 0) koth.progress = Math.max(0, koth.progress - dt / (KOTH.capSecs * 1.5));
  timeLeft -= dt;
  if (koth.progress >= 1) { koth.capTime[att] = KOTH.time - timeLeft; objEvent('castle', att, null); endRound(att, true); return; }
  if (!players.some((p) => p.team !== att && (p.alive || p.lives > 0))) { objEvent('wiped', 1 - att, null); endRound(att, true); return; }
  if (timeLeft <= 0) { objEvent('held', 1 - att, null); endRound(1 - att, true); }
}

// ---------- match flow ----------
function beginMatch(diff) {
  initAudio();
  matchDiff = DIFF[diff] ? diff : 'normal'; localPaused = false;
  score = [0, 0]; round = 1; feed = []; renderFeed(); flash = null;
  koth.capTime = [null, null];
  earned = { tags: 0, rounds: 0, obj: 0, win: 0, play: 0 };
  for (const p of players) { p.kills = 0; p.role = p.i === teamSize - 1 ? 'defend' : 'attack'; } // one dedicated flag defender per team
  applyLoadout();
  buildViewmodel();
  startRound();
  showScreen(null);
  $('hud').classList.remove('hidden');
  $('hint').classList.remove('hidden');
  setTimeout(() => $('hint').classList.add('hidden'), 9000);
}
function setupMode(mode, mapId) {
  gameMode = validMode(mode) ? mode : 'elim';
  if (players.length !== MODES[gameMode].teamSize * 2) makePlayers(MODES[gameMode].teamSize);
  ensureMap(mapId, gameMode);
}
function startMatch() { // single player
  const mode = save.settings.gameMode || 'elim';
  setupMode(mode, resolveMap(mapSel(mode), mode));
  assignSlots([{ slot: 1, id: 'local', name: 'You' }]);
  beginMatch(save.settings.diff); sfx.click(); lock();
}
function startRound() {
  resetPlayers();
  resetObjectives();
  state = 'countdown'; timer = 3; roundTime = 0;
  sfx.beep();
  if (net.mode === 'host') broadcast({ t: 'round', r: round, s: score });
}
// w: winning team, or -1 for a draw. addScore: whether the round counts as a point (elim / koth)
function endRound(w, addScore) {
  if (addScore && w >= 0) score[w]++;
  if (net.mode === 'host') broadcast({ t: 'roundEnd', w, s: score });
  roundWon(w);
}
function roundWon(w) {
  lastWinner = w;
  if (w === myTeam && earned && gameMode !== 'ctf') { const c = reward(REWARD.round); earned.rounds += c; addCoins(c); popCoins(c, 'ROUND'); }
  state = 'roundEnd'; timer = gameMode === 'elim' ? 3 : 4.5;
}
function endRoundCheck() {
  const left = [0, 1].map((t) => players.filter((p) => p.alive && p.team === t).length);
  if (left[0] && left[1]) return;
  endRound(left[0] ? 0 : 1, true);
}
const matchOver = () => (gameMode === 'elim' ? score[0] >= WIN_ROUNDS || score[1] >= WIN_ROUNDS : gameMode === 'ctf' ? true : round >= KOTH.rounds);
function matchWinner() {
  if (score[0] !== score[1]) return score[0] > score[1] ? 0 : 1;
  if (gameMode === 'koth' && koth.capTime[0] != null && koth.capTime[1] != null) return koth.capTime[0] <= koth.capTime[1] ? 0 : 1;
  return -1;
}
function endMatch(winner) {
  const w = winner ?? matchWinner();
  if (net.mode === 'host') broadcast({ t: 'end', s: score, w });
  localPaused = false;
  const won = w === myTeam, draw = w === -1;
  earned.play = reward(REWARD.play); earned.win = won ? reward(REWARD.win) : 0;
  addCoins(earned.play + earned.win);
  save.stats.matches++; if (won) save.stats.wins++;
  persist();
  state = 'results';
  releaseLock();
  $('hud').classList.add('hidden');
  const h = human();
  $('resTitle').textContent = draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
  $('resTitle').className = won ? 'win' : draw ? '' : 'lose';
  const unit = gameMode === 'ctf' ? ' captures' : '';
  let sub = '';
  if (gameMode === 'koth' && score[0] === score[1] && !draw) sub = `<div class="small" style="margin-top:6px">Tie broken by the faster castle capture</div>`;
  $('resScore').innerHTML = `<b class="blue">${score[0]}</b> – <b class="red">${score[1]}</b><span class="small">${unit}</span>${sub}`;
  const total = earned.tags + earned.rounds + earned.obj + earned.play + earned.win;
  $('resLines').innerHTML = [
    [`Tags (${h.kills})`, earned.tags], [gameMode === 'ctf' ? 'Captures & returns' : 'Objectives', earned.obj], ['Rounds won', earned.rounds],
    ['Match played', earned.play], ['Victory bonus', earned.win],
  ].filter(([l, v]) => v || !/Objectives|Captures/.test(l)).map(([l, v]) => `<div><span>${l}</span><span>+${v}</span></div>`).join('')
    + `<div class="total"><span>Total</span><span><i class="coin"></i>${total}</span></div>`;
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
  gameMode = save.settings.gameMode || 'elim';
  if (players.length !== MODES[gameMode].teamSize * 2) makePlayers(MODES[gameMode].teamSize);
  ensureMap(previewMap(mapSel(gameMode), gameMode), gameMode);
  assignSlots([{ slot: 1, id: 'local', name: 'You' }]);
  resetPlayers(); feed = []; renderFeed();
  $('hud').classList.add('hidden');
  showScreen('home');
  if (typeof msg === 'string') toast(msg);
}

// ---------- multiplayer ----------
const slotOrder = (team, n) => [1, 0, ...Array.from({ length: n - 2 }, (_, k) => k + 2)].map((i) => team * n + i);
const lobbyTeamSize = () => MODES[lobby.game].teamSize;
const maxPlayers = () => (lobby.mode === 'coop' ? lobbyTeamSize() : lobbyTeamSize() * 2);
function lobbyAssign() {
  const n = lobbyTeamSize();
  return lobby.players.map((pl, k) => {
    const team = lobby.mode === 'coop' ? 0 : k % 2;
    const idx = lobby.mode === 'coop' ? k : k >> 1;
    return { slot: slotOrder(team, n)[idx], id: pl.id, name: pl.name };
  });
}
function broadcastLobby() {
  broadcast({ t: 'lobby', code: lobby.code, mode: lobby.mode, game: lobby.game, map: lobby.map, players: lobby.players });
  renderLobby();
}
function hostStartMatch() {
  if (lobby.players.length > maxPlayers()) { toast(`Too many players for this mode (max ${maxPlayers()}).`); return; }
  const map = resolveMap(lobby.map, lobby.game);
  setupMode(lobby.game, map);
  const assign = lobbyAssign();
  broadcast({ t: 'start', assign, diff: save.settings.diff, map, game: lobby.game, ts: teamSize });
  assignSlots(assign);
  beginMatch(save.settings.diff); lock();
}
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const okVec = (a) => Array.isArray(a) && a.length === 3 && a.every(isNum);
const okPose = (a) => Array.isArray(a) && a.length === 11 && a.every(isNum);
const okSlot = (i) => Number.isInteger(i) && i >= 0 && i < players.length;
const okScore = (s) => Array.isArray(s) && s.length === 2 && s.every((x) => Number.isInteger(x) && x >= 0 && x <= 99);
const cleanName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14) || 'Player';
const r3 = (x) => Math.round(x * 1000) / 1000;
const packPose = (p) => [p.x, p.z, p.ang, p.bodyAng, p.pitch, p.h, p.lean, p.alive ? 1 : 0, p.vx, p.vz, p.y || 0].map(r3);
function markOut(p) {
  p.alive = false; p.model.torso.material = M.out[p.team]; p.model.armUp.visible = true;
  if (p.human) { sfx.out(); specIdx = 0; }
}
function packObjectives() {
  const g = { tl: r3(timeLeft), lv: players.map((p) => (p.lives === Infinity ? -1 : p.lives)) };
  if (flagsSt) g.f = flagsSt.map((F) => [F.st, F.carrier, r3(F.x), r3(F.z)]);
  if (gameMode === 'koth') { g.cp = r3(koth.progress); g.ct = koth.contested ? 1 : 0; g.ca = koth.att; }
  return g;
}

function hostMessage(from, m) {
  const p = players.find((q) => q.peer === from && q.ctrl === 'remote');
  switch (m.t) {
    case 'hello': {
      if (lobby.players.some((l) => l.id === from)) return;
      if (inGame() || state === 'paused') { sendTo(from, { t: 'busy' }); kick(from); return; }
      if (lobby.players.length >= maxPlayers()) { sendTo(from, { t: 'full' }); kick(from); return; }
      lobby.players.push({ id: from, name: cleanName(m.name) });
      broadcastLobby(); sfx.beep();
      return;
    }
    case 'fire': {
      if (!p || !p.alive || state !== 'playing' || !okVec(m.p) || !okVec(m.v)) return;
      const pos = fromVec(m.p), vel = fromVec(m.v);
      if (vel.length() > 80 || Math.hypot(pos.x - p.x, pos.z - p.z) > 2.5 || Math.abs(pos.y - (p.y + 1.3)) > 2.5) return;
      p.protect = 0;
      spawnBall(p, pos, vel);
      broadcast({ t: 'ball', o: slotIdx(p), p: m.p, v: m.v }, from);
      return;
    }
    case 'pose': {
      if (!p || !p.alive || !okPose(m.d) || !(state === 'playing' || state === 'countdown')) return;
      const d = m.d;
      p.x = d[0]; p.z = d[1]; p.y = clamp(d[10], 0, 12);
      p.ang = d[2]; p.bodyAng = d[3]; p.pitch = clamp(d[4], -1.3, 1.3);
      p.h = clamp(d[5], H_PRONE, H_STAND); p.lean = clamp(d[6], -1, 1);
      p.vx = clamp(d[8], -10, 10); p.vz = clamp(d[9], -10, 10);
      resolveCircle(p, PR);
      return;
    }
  }
}
function hostPeerLeft(id) {
  lobby.players = lobby.players.filter((l) => l.id !== id);
  const p = players.find((q) => q.peer === id);
  if (p) {
    p.ctrl = 'bot'; p.peer = null; p.name = TEAMS[p.team].names[p.i]; setNameTag(p, null);
    p.mag = BOT.mag; p.reloadT = BOT.reload; p.ballSpeed = BOT.ball; p.goal = null; p.tgt = null; p.path = null;
    broadcast({ t: 'ctrl', slot: slotIdx(p), name: p.name });
    feed.unshift({ a: '', at: p.team, b: `${p.name} (bot) joins`, bt: p.team, t: 4, note: true }); renderFeed();
  }
  if (state !== 'home') broadcastLobby();
}

function clientMessage(m) {
  switch (m.t) {
    case 'lobby': {
      if (!Array.isArray(m.players)) return;
      const game = validMode(m.game) ? m.game : 'elim';
      lobby = { code: cleanCode(m.code), mode: m.mode === 'coop' ? 'coop' : 'teams', game, map: validMap(m.map, game) ? m.map : 'random',
        players: m.players.slice(0, 12).map((l) => ({ id: String(l.id), name: cleanName(l.name) })) };
      if (!inGame()) { gameMode = game; ensureMap(previewMap(lobby.map, game), game); }
      renderLobby();
      if (!inGame() && state !== 'results') { state = 'lobby'; showScreen('lobby'); }
      return;
    }
    case 'busy': case 'full':
      quitToHome(m.t === 'busy' ? 'That room is in the middle of a match. Try again when it ends.' : 'That room is full.');
      return;
    case 'start': {
      if (!Array.isArray(m.assign) || !validMode(m.game) || m.ts !== MODES[m.game].teamSize || !validMap(m.map, m.game)) return;
      setupMode(m.game, m.map);
      const assign = m.assign.filter((a) => a && okSlot(a.slot)).map((a) => ({ slot: a.slot, id: String(a.id), name: cleanName(a.name) }));
      assignSlots(assign);
      if (!human()) return;
      beginMatch(m.diff);
      return;
    }
    case 'round':
      if (!isNum(m.r) || !okScore(m.s)) return;
      round = m.r; score = m.s.slice();
      if (earned) { resetPlayers(); resetObjectives(); state = 'countdown'; timer = 3; roundTime = 0; sfx.beep(); }
      return;
    case 's': {
      if (!inGameOrPaused() || !Array.isArray(m.p) || m.p.length !== players.length) return;
      if (['countdown', 'playing', 'roundEnd'].includes(m.st) && state !== m.st && !(state === 'roundEnd' && m.st === 'playing')) state = m.st;
      if (isNum(m.tm)) timer = m.tm;
      if (okScore(m.sc)) score = m.sc.slice();
      m.p.forEach((d, i) => {
        const p = players[i];
        if (!okPose(d)) return;
        if (!d[7] && p.alive) markOut(p);
        if (p.ctrl !== 'net') return;
        p.tx = d[0]; p.tz = d[1]; p.tang = d[2]; p.tbody = d[3]; p.tpitch = d[4]; p.th = d[5]; p.tlean = d[6]; p.ty = d[10];
        p.vx = d[8]; p.vz = d[9];
      });
      const g = m.g;
      if (g && typeof g === 'object') {
        if (isNum(g.tl)) timeLeft = g.tl;
        if (Array.isArray(g.lv) && g.lv.length === players.length) g.lv.forEach((l, i) => { if (isNum(l)) players[i].lives = l < 0 ? Infinity : l; });
        if (flagsSt && Array.isArray(g.f) && g.f.length === 2) g.f.forEach((a, i) => {
          if (!Array.isArray(a) || a.length !== 4 || !a.every(isNum) || ![0, 1, 2].includes(a[0])) return;
          if (a[0] === 1 && !okSlot(a[1])) return;
          Object.assign(flagsSt[i], { st: a[0], carrier: a[1], x: a[2], z: a[3] });
        });
        if (isNum(g.cp)) koth.progress = clamp(g.cp, 0, 1);
        koth.contested = !!g.ct; if (isNum(g.ca)) koth.att = g.ca;
      }
      return;
    }
    case 'ball':
      if (!okSlot(m.o) || !okVec(m.p) || !okVec(m.v) || players[m.o].human) return;
      spawnBall(players[m.o], fromVec(m.p), fromVec(m.v));
      return;
    case 'tag':
      if (!okSlot(m.v) || !okSlot(m.b) || !okVec(m.pt)) return;
      eliminate(players[m.v], players[m.b], fromVec(m.pt), isNum(m.rs) ? clamp(m.rs, 0, 10) : 0);
      return;
    case 'spawn': {
      if (!okSlot(m.s) || ![m.x, m.z, m.y, m.a].every(isNum)) return;
      const p = players[m.s];
      placeAt(p, { x: m.x, z: m.z, y: clamp(m.y, 0, 12), ang: m.a }); freshLife(p);
      p.protect = PROTECT_T; p.respawnT = 0; p.tx = undefined;
      if (p.human) sfx.beep();
      return;
    }
    case 'obj':
      if (typeof m.k !== 'string' || !(m.tm === 0 || m.tm === 1)) return;
      onObj(m.k, m.tm, okSlot(m.by) ? players[m.by] : null);
      return;
    case 'roundEnd':
      if (state === 'roundEnd' || !okScore(m.s) || ![-1, 0, 1].includes(m.w)) return;
      score = m.s.slice(); roundWon(m.w);
      return;
    case 'end':
      if (okScore(m.s)) score = m.s.slice();
      if (inGameOrPaused()) endMatch([-1, 0, 1].includes(m.w) ? m.w : undefined);
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
function smoothNetPlayers(dt) {
  const k = Math.min(1, dt * 14);
  for (const p of players) {
    if (p.ctrl !== 'net' || p.tx === undefined) continue;
    if (Math.hypot(p.tx - p.x, p.tz - p.z) > 3) { p.x = p.tx; p.z = p.tz; p.y = p.ty; }
    p.x += (p.tx - p.x) * k; p.z += (p.tz - p.z) * k; p.y += ((p.ty || 0) - p.y) * k;
    p.ang += angDiff(p.tang, p.ang) * k; p.bodyAng += angDiff(p.tbody, p.bodyAng) * k;
    p.pitch += (p.tpitch - p.pitch) * k; p.h += (p.th - p.h) * k; p.lean += (p.tlean - p.lean) * k;
  }
}
function netTick(dt) {
  if (net.mode === 'host' && inGame()) {
    snapT -= dt;
    if (snapT <= 0) { snapT = 0.05; broadcast({ t: 's', st: state, tm: r3(timer), r: round, sc: score, p: players.map(packPose), g: packObjectives() }); }
  } else if (net.mode === 'client' && inGame()) {
    poseT -= dt;
    if (poseT <= 0) { poseT = 1 / 30; const h = human(); if (h) netSend({ t: 'pose', d: packPose(h) }); }
  }
}

// ---------- update ----------
function update(dt) {
  if (!(dt > 0)) { netTick(0); return; }
  clock += dt; navBudget = 3;
  for (const f of feed) f.t -= dt;
  if (feed.length && feed[feed.length - 1].t <= 0) { feed = feed.filter((f) => f.t > 0); renderFeed(); }
  hitMarker = Math.max(0, hitMarker - dt);
  if (flash) { flash.t -= dt; if (flash.t <= 0) flash = null; }
  const client = net.mode === 'client';

  if (state === 'countdown') {
    const before = Math.ceil(timer); timer -= dt;
    if (Math.ceil(timer) !== before && timer > 0) sfx.beep();
    if (timer <= 0) { state = 'playing'; sfx.go(); }
  } else if (state === 'roundEnd') {
    timer -= dt;
    if (timer <= 0 && !client) { if (matchOver()) endMatch(); else { round++; startRound(); } }
  }
  if (state === 'playing') {
    roundTime += dt;
    for (const p of players) {
      p.protect = Math.max(0, p.protect - dt);
      if (!p.alive) {
        if (p.respawnT > 0) { p.respawnT -= dt; if (p.respawnT <= 0 && !client && p.ctrl !== 'net') respawn(p); }
        continue;
      }
      if (p.ctrl === 'remote' || p.ctrl === 'net') continue;
      const px = p.x, pz = p.z;
      p.cd -= dt;
      if (p.reload > 0) { p.reload -= dt; if (p.reload <= 0) { p.reload = 0; p.ammo = p.mag; } }
      if (p.human) { if (!localPaused) updateHuman(p, dt); else p.moving = false; }
      else updateBot(p, dt);
      physicsY(p, dt);
      p.vx = (p.x - px) / dt; p.vz = (p.z - pz) / dt;
      if (!p.human) {
        const spd = Math.hypot(p.vx, p.vz);
        let target = p.ang;
        if (spd > 0.5) { const md = Math.atan2(p.vz, p.vx); target = Math.abs(angDiff(md, p.ang)) <= Math.PI / 2 ? md : md + Math.PI; }
        p.bodyAng += angDiff(target, p.bodyAng) * Math.min(1, dt * 8);
        const dd = angDiff(p.ang, p.bodyAng); if (Math.abs(dd) > 1.75) p.bodyAng = p.ang - Math.sign(dd) * 1.75;
      }
    }
    const alive = players.filter((p) => p.alive);
    const mine = (p) => p.ctrl === 'bot' || p.ctrl === 'local';
    for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j], dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d > 0 && d < PR * 2 && Math.abs((a.y || 0) - (b.y || 0)) < 1.5) {
        const o = (PR * 2 - d) / (mine(a) && mine(b) ? 2 : 1);
        if (mine(a)) move(a, -dx / d * o, -dz / d * o);
        if (mine(b)) move(b, dx / d * o, dz / d * o);
      }
    }
  }
  if (client) smoothNetPlayers(dt);
  if (state === 'playing' || state === 'roundEnd') updateBalls(dt);
  if (state === 'playing' && !client) {
    if (gameMode === 'elim') endRoundCheck();
    else if (gameMode === 'ctf' && flagsSt) ctfUpdate(dt);
    else if (gameMode === 'koth' && world.info.castle) kothUpdate(dt);
  } else if (state === 'playing' && client && gameMode !== 'elim') timeLeft -= dt;
  for (const p of players) {
    if (p.ctrl === 'remote' || p.ctrl === 'net') continue;
    const target = p.diveT > 0 ? H_PRONE : p.crouch ? H_CROUCH : H_STAND;
    p.h += (target - p.h) * Math.min(1, dt * (p.diveT > 0 ? 16 : 10));
  }
  netTick(dt);
  syncModels(dt);
  syncObjectives();
  updateCamera(dt);
  world.update(dt, clock);
}
function syncModels(dt) {
  for (const p of players) {
    const m = p.model;
    let vis = !(p.human && p.alive && inGameOrPaused());
    if (p.alive && p.protect > 0 && ((clock * 8) | 0) % 2) vis = false; // blink while spawn-protected
    if (!p.alive && respawnMode() && inGame()) vis = false;          // the tagged walk off: hide them until they respawn
    m.root.visible = vis;
    m.root.position.set(p.x, p.y || 0, p.z);
    m.root.rotation.y = -p.bodyAng;
    m.upper.rotation.y = -angDiff(p.ang, p.bodyAng);
    m.upper.rotation.x = p.lean * 0.26;
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
  if (!inGameOrPaused() || !h) {
    const t = clock * 0.05, k = FIELD.hw / 25;
    homeCam.set(Math.cos(t) * 30 * k, (11 + Math.sin(clock * 0.1) * 2) * Math.sqrt(k), Math.sin(t) * 22 * k);
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
      v1.set(t.x - Math.cos(t.ang) * 3.8, (t.y || 0) + 2.6, t.z - Math.sin(t.ang) * 3.8);
      camera.position.lerp(v1, Math.min(1, dt * 4));
      camera.lookAt(t.x + Math.cos(t.ang) * 2, (t.y || 0) + 1.2, t.z + Math.sin(t.ang) * 2);
      const wait = h.respawnT > 0 ? `Respawning in ${Math.ceil(h.respawnT)}… · ` : respawnMode() && h.lives <= 0 ? 'Out of lives · ' : "You're out! · ";
      $('status').textContent = `${wait}Spectating ${t.name} · click to switch`;
    }
  }
  setListener(camera.position.x, camera.position.y, camera.position.z);
}
function setFov(f, dt) {
  const nf = camera.fov + (f - camera.fov) * Math.min(1, dt * 8);
  if (Math.abs(nf - camera.fov) > 0.01) { camera.fov = nf; camera.updateProjectionMatrix(); }
}

// ---------- HUD ----------
const FLAG_WORD = ['AT BASE', 'TAKEN', 'DROPPED'];
const markerEls = [];
function marker(i, pos, label, color) {
  let el = markerEls[i];
  if (!el) { el = document.createElement('div'); el.className = 'marker'; $('markers').appendChild(el); markerEls[i] = el; }
  v1.set(pos.x, pos.y, pos.z).project(camera);
  const behind = v1.z > 1;
  let x = v1.x, y = v1.y;
  if (behind) { x = -x; y = -1; }
  const m = 0.92; x = clamp(x, -m, m); y = clamp(y, -m, m);
  el.style.left = `${(x + 1) * 50}%`; el.style.top = `${(1 - y) * 50}%`;
  const d = Math.round(Math.hypot(pos.x - camera.position.x, pos.z - camera.position.z));
  el.innerHTML = `<i style="background:${color}"></i><span>${label} · ${d}m</span>`;
  el.classList.remove('hidden');
}
function renderHud() {
  if (!inGameOrPaused()) return;
  const h = human(); if (!h) return;
  $('s0').textContent = score[0]; $('s1').textContent = score[1];
  $('roundLbl').textContent = gameMode === 'elim' ? `ROUND ${round}` : gameMode === 'ctf' ? `CTF · ${mmss(timeLeft)}` : `ROUND ${round}/2 · ${mmss(timeLeft)}`;
  for (let t = 0; t < 2; t++) {
    $('pips' + t).innerHTML = players.filter((p) => p.team === t).map((p) => `<i class="${p.alive ? 'on' : ''}"></i>`).join('');
  }
  // objective panel + markers
  let obj = '';
  const used = new Set();
  if (gameMode === 'ctf' && flagsSt) {
    obj = flagsSt.map((F) => {
      const who = F.st === 1 ? ` (${esc(players[F.carrier].name)})` : F.st === 2 ? ` · ${Math.ceil(F.dropT || 0) || ''}` : '';
      return `<span style="color:${TEAMS[F.team].css}">🚩 ${TEAMS[F.team].name}: ${FLAG_WORD[F.st]}${F.st === 1 ? who : ''}</span>`;
    }).join('');
    flagsSt.forEach((F, i) => {
      if (F.st === 1 && F.carrier === slotIdx(h)) return;
      const c = F.st === 1 ? players[F.carrier] : null;
      marker(i, { x: c ? c.x : F.x, y: (c ? c.y || 0 : 0) + 2.6, z: c ? c.z : F.z }, F.team === h.team ? 'YOUR FLAG' : 'ENEMY FLAG', TEAMS[F.team].css);
      used.add(i);
    });
    if (carrying(h)) { const own = flagsSt[h.team]; marker(2, { x: own.hx, y: 2.6, z: own.hz }, 'BRING IT HOME', '#ffd23f'); used.add(2); }
  } else if (gameMode === 'koth' && world.info.castle) {
    const att = attackers(), zn = world.info.castle.zone, pct = Math.round(koth.progress * 100);
    const lives = players.filter((p) => p.team !== att).reduce((s, p) => s + (p.lives === Infinity ? 0 : p.lives), 0);
    const role = h.team === att ? 'ATTACK' : 'DEFEND';
    obj = `<span style="color:${TEAMS[att].css}">${TEAMS[att].name} ATTACKS</span>`
      + `<span class="capbar"><i style="width:${pct}%;background:${TEAMS[att].css}"></i></span>`
      + `<span>${koth.contested ? 'CONTESTED' : `${pct}%`}</span><span style="color:${TEAMS[1 - att].css}">Defender lives: ${lives}</span>`
      + `<span class="role">YOU ${role}</span>`;
    marker(0, { x: zn.x, y: 3.5, z: zn.z }, h.team === att ? 'CAPTURE' : 'DEFEND', TEAMS[att].css); used.add(0);
  }
  $('objective').innerHTML = obj; $('objective').classList.toggle('hidden', !obj);
  markerEls.forEach((el, i) => { if (el && !used.has(i)) el.classList.add('hidden'); });

  $('ammoNum').textContent = h.reload > 0 ? '··' : h.ammo;
  $('ammoMag').textContent = '/ ' + h.mag;
  $('ammoBox').classList.toggle('low', h.ammo <= Math.ceil(h.mag * 0.2));
  $('reloadBar').style.setProperty('--p', h.reload > 0 ? 1 - h.reload / h.reloadT : 0);
  $('reloadBar').classList.toggle('hidden', !(h.reload > 0));
  const leanTxt = h.lean < -0.3 ? 'LEAN ◀' : h.lean > 0.3 ? 'LEAN ▶' : '';
  const lifeTxt = h.lives !== Infinity && respawnMode() ? `${h.lives} ${h.lives === 1 ? 'LIFE' : 'LIVES'}` : '';
  $('stance').textContent = h.diveT > 0 ? 'DIVE' : [h.crouch ? 'CROUCHED' : h.sprint ? 'SPRINT' : '', leanTxt, lifeTxt, h.protect > 0 ? 'PROTECTED' : ''].filter(Boolean).join(' · ');
  const gap = 5 + currentSpread(h) * 500;
  $('cross').style.setProperty('--g', gap.toFixed(1) + 'px');
  $('cross').classList.toggle('hidden', !h.alive);
  $('hitmark').classList.toggle('on', hitMarker > 0);
  $('status').classList.toggle('hidden', h.alive || state !== 'playing');
  $('clickPlay').classList.toggle('hidden', !(inGame() && !locked && !fallbackLook && !localPaused));
  let banner = '';
  if (state === 'countdown') {
    const title = gameMode === 'elim' ? `ROUND ${round}` : gameMode === 'ctf' ? 'CAPTURE THE FLAG'
      : `ROUND ${round} · <span style="color:${TEAMS[attackers()].css}">${TEAMS[attackers()].name} ATTACKS</span>`;
    const sub = gameMode === 'koth' ? `<em>${h.team === attackers() ? 'Take the throne room in the keep' : 'Defend the castle · 3 lives'}</em>` : '';
    banner = `${title}${sub}<small>${Math.ceil(timer)}</small>`;
  } else if (state === 'roundEnd') {
    banner = lastWinner < 0 ? 'DRAW' : `<span style="color:${TEAMS[lastWinner].css}">${TEAMS[lastWinner].name} ${gameMode === 'ctf' ? 'WINS!' : 'WINS THE ROUND'}</span>`;
  } else if (flash) banner = `<span class="flash" style="color:${flash.color}">${esc(flash.text)}</span>`;
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
  const assign = lobby.players.length ? lobbyAssign() : [];
  const n = lobbyTeamSize();
  $('lobbyList').innerHTML = assign.map((a, k) => {
    const team = a.slot >= n ? 1 : 0, you = a.id === net.myId;
    return `<li><i style="background:${TEAMS[team].css}"></i><b>${esc(a.name)}</b>${k === 0 ? '<small>HOST</small>' : ''}${you ? '<small>YOU</small>' : ''}<span style="color:${TEAMS[team].css}">${TEAMS[team].name}</span></li>`;
  }).join('');
  const bots = n * 2 - lobby.players.length;
  $('lobbyBots').textContent = lobby.mode === 'coop'
    ? `Co-op: all players on Blue against ${n} Red bots${lobby.players.length < n ? `, with ${n - lobby.players.length} Blue bot${n - lobby.players.length === 1 ? '' : 's'} helping` : ''}.`
    : `Teams: players split between Blue and Red (${n} v ${n}). ${Math.max(0, bots)} bot${bots === 1 ? '' : 's'} fill the empty slots.`;
  for (const b of document.querySelectorAll('#lobbyMode button')) { b.classList.toggle('on', b.dataset.m === lobby.mode); b.disabled = !isHost; }
  for (const b of document.querySelectorAll('#lobbyGame button')) { b.classList.toggle('on', b.dataset.g === lobby.game); b.disabled = !isHost; }
  $('btnStart').classList.toggle('hidden', !isHost);
  $('lobbyWait').classList.toggle('hidden', isHost);
  const mi = mapInfo(lobby.map, lobby.game);
  $('lobbyMapName').textContent = mi.name; $('lobbyMapDesc').textContent = mi.desc;
  $('lobbyGameDesc').textContent = MODES[lobby.game].desc;
  for (const b of document.querySelectorAll('#lobbyMapPick .arrow')) b.classList.toggle('hidden', !isHost);
}
function renderMapPick() {
  const mode = save.settings.gameMode || 'elim', mi = mapInfo(mapSel(mode), mode);
  $('mapName').textContent = mi.name; $('mapDesc').textContent = mi.desc;
  for (const b of document.querySelectorAll('#gameMode button')) b.classList.toggle('on', b.dataset.g === mode);
  $('modeDesc').textContent = MODES[mode].desc;
}
function renderHome() {
  $('stats').textContent = `${save.stats.matches} matches · ${save.stats.wins} wins · ${save.stats.tags} tags`;
  for (const b of document.querySelectorAll('#diff button')) b.classList.toggle('on', b.dataset.d === save.settings.diff);
  renderMapPick();
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
    preview = { r, s, cam, pivot, m: null, drag: null, yaw: 0.6 };
    c.addEventListener('pointerdown', (e) => { preview.drag = e.clientX; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => { if (preview.drag != null) { preview.yaw += (e.clientX - preview.drag) * 0.01; preview.drag = e.clientX; } });
    c.addEventListener('pointerup', () => { preview.drag = null; });
  }
  if (preview.m) { preview.pivot.remove(preview.m); disposeMarker(preview.m); }
  preview.m = makeMarker(0, upgradeLook());
  preview.m.position.set(-0.07, -0.03, 0);
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

// game mode + map pickers (home)
for (const b of document.querySelectorAll('#gameMode button')) {
  b.addEventListener('click', () => {
    initAudio(); sfx.click();
    const mode = b.dataset.g; save.settings.gameMode = mode; persist();
    gameMode = mode;
    if (players.length !== MODES[mode].teamSize * 2) { makePlayers(MODES[mode].teamSize); assignSlots([{ slot: 1, id: 'local', name: 'You' }]); }
    ensureMap(previewMap(mapSel(mode), mode), mode); resetPlayers();
    renderMapPick();
  });
}
for (const b of document.querySelectorAll('#mapPick .arrow')) {
  b.addEventListener('click', () => {
    initAudio(); sfx.click();
    const mode = save.settings.gameMode || 'elim';
    save.settings['map_' + mode] = cycleMap(mapSel(mode), +b.dataset.d, mode); persist();
    ensureMap(previewMap(mapSel(mode), mode), mode); resetPlayers();
    renderMapPick();
  });
}

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
    const game = save.settings.gameMode || 'elim';
    lobby = { code, mode: hostMode, game, map: mapSel(game), players: [{ id: 'host', name: myName() }] };
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
    if (b.dataset.m === 'coop' && lobby.players.length > lobbyTeamSize()) { toast(`Co-op fits ${lobbyTeamSize()} players. Too many in the room.`); return; }
    lobby.mode = b.dataset.m; sfx.click(); broadcastLobby();
  });
}
for (const b of document.querySelectorAll('#lobbyGame button')) {
  b.addEventListener('click', () => {
    if (net.mode !== 'host' || b.dataset.g === lobby.game) return;
    lobby.game = b.dataset.g; lobby.map = mapSel(lobby.game); sfx.click();
    ensureMap(previewMap(lobby.map, lobby.game), lobby.game);
    broadcastLobby();
  });
}
for (const b of document.querySelectorAll('#lobbyMapPick .arrow')) {
  b.addEventListener('click', () => {
    if (net.mode !== 'host') return;
    initAudio(); sfx.click();
    lobby.map = cycleMap(lobby.map, +b.dataset.d, lobby.game);
    ensureMap(previewMap(lobby.map, lobby.game), lobby.game);
    broadcastLobby();
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
  if (net.mode) localPaused = true;
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
    else if (state === 'playing') h.queued = h.cool + 0.08;
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (inGame() && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
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
if (!validMode(save.settings.gameMode)) save.settings.gameMode = 'elim';
gameMode = save.settings.gameMode;
makePlayers(MODES[gameMode].teamSize);
ensureMap(previewMap(mapSel(gameMode), gameMode), gameMode);
assignSlots([{ slot: 1, id: 'local', name: 'You' }]); resetPlayers(); buildViewmodel();
showScreen('home');
{
  const code = cleanCode(new URLSearchParams(location.search).get('room'));
  if (code.length === 5) { mpCode.value = code; showScreen('mp'); $('mpStatus').textContent = 'Enter your name and press Join.'; }
}
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
    start(mode, map) {
      fallbackLook = true;
      if (mode) { save.settings.gameMode = mode; if (map) save.settings['map_' + mode] = map; }
      startMatch();
    },
    get info() {
      return { state, mode: gameMode, score, round, timeLeft: r3(timeLeft), alive: players.filter((p) => p.alive).map((p) => p.name), balls: balls.length, coins: save.coins,
        flags: flagsSt && flagsSt.map((F) => [F.st, F.carrier]), koth: { ...koth } };
    },
    players: () => players,
    net: () => net,
    lobby: () => lobby,
    loadMap: (id, mode = 'elim') => { gameMode = mode; if (players.length !== MODES[mode].teamSize * 2) { makePlayers(MODES[mode].teamSize); assignSlots([{ slot: 1, id: 'local', name: 'You' }]); } ensureMap(id, mode); resetPlayers(); },
    world: () => world,
    obj: (i) => objectiveFor(players[i]),
    previewYaw(y) { if (preview) preview.yaw = y; },
  };
}
