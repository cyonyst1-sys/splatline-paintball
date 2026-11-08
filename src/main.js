// Game loop, players, bots, shooting, menus and HUD.
import * as THREE from 'three';
import { createWorld, TEAMS, NETB, resolveCircle, segBlocked2D, segCircle } from './world.js';
import { save, persist, resetSave, UPGRADES, stat, costOf, buy, addCoins } from './economy.js';
import { sfx, initAudio, setListener, setVolume } from './audio.js';
import { makeMarker, disposeMarker } from './marker.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (id) => document.getElementById(id);
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
  const torso = mesh(G.torso, M.jersey[team], 0, 1.15, 0); torso.scale.z = 1.12; body.add(torso);
  body.add(mesh(G.head, M.skin, 0, 1.58, 0));
  body.add(mesh(G.mask, M.mask, 0.1, 1.56, 0));
  body.add(mesh(G.lens, M.lens, 0.165, 1.6, 0));
  const gun = makeMarker(team, { detail: 'low' }); gun.position.set(0.24, 1.2, 0.13); body.add(gun);
  const armR = mesh(G.arm, M.jersey[team], 0.18, 1.22, 0.18); armR.rotation.z = -1.35; body.add(armR);
  const armL = mesh(G.arm, M.jersey[team], 0.28, 1.24, -0.06); armL.rotation.set(0.5, 0, -1.4); body.add(armL);
  const armUp = mesh(G.arm, M.jersey[team], 0, 1.82, -0.26); armUp.visible = false; body.add(armUp);
  root.traverse((m) => { if (m.isMesh) m.castShadow = high; });
  return { root, body, legs, torso, arms: [armR, armL, armUp], armUp, gun };
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
  const m = makeMarker(0, upgradeLook());
  vm.add(m); vmMuzzle = m.userData.muzzle;
}
buildViewmodel();

// ---------- state ----------
let players = [], balls = [], feed = [];
let state = 'home', prevState = 'playing', timer = 0, round = 1, score = [0, 0], lastWinner = 0;
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
      team, i, human: team === 0 && i === 1, name: TEAMS[team].names[i], model,
      x: 0, z: 0, ang: 0, pitch: 0, h: H_STAND, crouch: false, alive: true,
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
    p.ang = p.team ? Math.PI : 0; p.pitch = 0;
    p.alive = true; p.crouch = false; p.h = H_STAND; p.ammo = p.mag; p.reload = 0; p.cd = 0;
    p.vx = p.vz = p.mvx = p.mvz = 0;
    p.goal = null; p.tgt = null; p.seen = 0; p.scanT = Math.random() * 0.2; p.stuckT = 0; p.lx = p.x; p.lz = p.z;
    p.hold = Math.random() < 0.5; p.avoid = Math.random() < 0.5 ? 1 : -1;
    p.model.torso.material = M.jersey[p.team];
    for (const a of p.model.arms) a.material = M.jersey[p.team];
    p.model.armUp.visible = false; p.model.gun.visible = true;
  }
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
const eyeY = (p) => p.h * 0.9;
const chestY = (p) => p.h * 0.72;
function move(p, dx, dz) { p.x += dx; p.z += dz; resolveCircle(p, PR); }

// ---------- balls ----------
const ballGeo = new THREE.SphereGeometry(0.05, 10, 8);
const ballMats = TEAMS.map((t) => new THREE.MeshStandardMaterial({ color: t.paint, emissive: t.paint, emissiveIntensity: 0.4, roughness: 0.2 }));
const ballPool = [];
function freeBall(b) { b.mesh.removeFromParent(); ballPool.push(b.mesh); }
function fire(p, pos, vel) {
  if (p.ammo <= 0 || p.reload > 0) return;
  p.ammo--;
  const m = ballPool.pop() || new THREE.Mesh(ballGeo, ballMats[0]);
  m.material = ballMats[p.team]; m.position.copy(pos); scene.add(m);
  balls.push({ pos: pos.clone(), vel: vel.clone(), team: p.team, owner: p, life: 1.8, mesh: m });
  sfx.shot(p.human ? null : pos);
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
      const t = p0.y / (p0.y - (p0.y + seg.y));
      if (t < tBest) { tBest = t; kind = 'ground'; point = p0.clone().addScaledVector(seg, t); point.y = 0; normal = UP; }
    }
    if (state === 'playing') {
      for (const p of players) {
        if (!p.alive || p.team === b.team) continue;
        const t = segCircle(p0.x, p0.z, p0.x + seg.x, p0.z + seg.z, p.x, p.z, PR + 0.04);
        if (t >= 0 && t < tBest) {
          const y = p0.y + seg.y * t;
          if (y >= 0 && y <= p.h + 0.05) { tBest = t; kind = 'player'; hitP = p; point = p0.clone().addScaledVector(seg, t); }
        }
      }
    }
    if (kind) {
      if (kind === 'player') eliminate(hitP, b.owner, point);
      else { world.addSplat(point, normal, b.team, rand(0.32, 0.5)); world.puff(point, b.team); sfx.splat(point); }
      freeBall(b); balls.splice(k, 1); continue;
    }
    b.pos.add(seg); b.mesh.position.copy(b.pos); b.life -= dt;
    if (b.life <= 0 || Math.abs(b.pos.x) > NETB.hw || Math.abs(b.pos.z) > NETB.hd) { freeBall(b); balls.splice(k, 1); }
  }
}
function eliminate(p, by, point) {
  p.alive = false; p.reload = 0; p.crouch = false;
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
const reward = (n) => Math.round(n * DIFF[save.settings.diff].reward);

// ---------- human ----------
function updateHuman(p, dt) {
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  p.crouch = !!keys.KeyC;
  p.sprint = !!(keys.ShiftLeft || keys.ShiftRight) && f > 0 && !p.crouch;
  const sp = p.crouch ? 2.4 : p.sprint ? 7.2 : 4.8;
  let mx = Math.cos(p.ang) * f - Math.sin(p.ang) * s, mz = Math.sin(p.ang) * f + Math.cos(p.ang) * s;
  const len = Math.hypot(mx, mz);
  if (len > 0) { mx = mx / len * sp; mz = mz / len * sp; }
  const k = Math.min(1, dt * 12);
  p.mvx += (mx - p.mvx) * k; p.mvz += (mz - p.mvz) * k;
  move(p, p.mvx * dt, p.mvz * dt);
  p.moving = len > 0;
  if (keys.KeyR) startReload(p);
  if (mouse.down && p.cd <= 0 && p.reload <= 0 && p.ammo > 0) humanFire(p);
}
function currentSpread(p) {
  let s = 0.012;
  if (p.moving) s += 0.015;
  if (p.sprint) s += 0.04;
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
  const D = DIFF[save.settings.diff];
  const foes = players.filter((p) => p.alive && p.team !== b.team);
  if (!foes.length) return;
  b.scanT -= dt;
  if (b.tgt && !b.tgt.alive) b.tgt = null;
  if (b.scanT <= 0) {
    b.scanT = rand(0.12, 0.22);
    let best = null, bd = 1e9;
    for (const f of foes) {
      const d = Math.hypot(f.x - b.x, f.z - b.z);
      if (d < D.sight && d < bd && losClear(b.x, eyeY(b), b.z, f.x, chestY(f), f.z)) { best = f; bd = d; }
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
    const px = t.x + t.vx * ft * D.lead, pz = t.z + t.vz * ft * D.lead;
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
    if (!b.goal || b.goalT <= 0) pickGoal(b, foes);
    const d = Math.hypot(b.goal.x - b.x, b.goal.z - b.z);
    if (d > 0.3) {
      const a = steer(b, b.goal.x, b.goal.z, b.crouch ? D.speed * 0.6 : D.speed, dt);
      b.ang += angDiff(a, b.ang) * Math.min(1, dt * 6);
    } else {
      let near = foes[0], nd = 1e9;
      for (const f of foes) { const dd = Math.hypot(f.x - b.x, f.z - b.z); if (dd < nd) { nd = dd; near = f; } }
      b.ang += angDiff(Math.atan2(near.z - b.z, near.x - b.x), b.ang) * Math.min(1, dt * 4);
      if (Math.random() < dt * 0.25) pickGoal(b, foes); // move up now and then
    }
    b.stuckT += dt;
    if (b.stuckT > 0.8) {
      if (d > 0.8 && Math.hypot(b.x - b.lx, b.z - b.lz) < 0.4) { b.avoid = -b.avoid; pickGoal(b, foes); }
      b.stuckT = 0; b.lx = b.x; b.lz = b.z;
    }
  }
}

// ---------- match flow ----------
function startMatch() {
  initAudio(); sfx.click();
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
  lock();
}
function startRound() {
  resetPlayers();
  state = 'countdown'; timer = 3;
  sfx.beep();
}
function endRoundCheck() {
  const left = [0, 1].map((t) => players.filter((p) => p.alive && p.team === t).length);
  if (left[0] && left[1]) return;
  lastWinner = left[0] ? 0 : 1;
  score[lastWinner]++;
  if (lastWinner === 0) { const c = reward(REWARD.round); earned.rounds += c; addCoins(c); popCoins(c, 'ROUND'); }
  state = 'roundEnd'; timer = 3;
}
function endMatch() {
  const won = score[0] > score[1];
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
  showScreen('results');
  sfx.coin();
}
function quitToHome() {
  state = 'home'; releaseLock();
  resetPlayers(); feed = []; renderFeed();
  $('hud').classList.add('hidden');
  showScreen('home');
}

// ---------- update ----------
function update(dt) {
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
    if (timer <= 0) { if (score[0] >= WIN_ROUNDS || score[1] >= WIN_ROUNDS) endMatch(); else { round++; startRound(); } }
  }
  if (state === 'playing') {
    for (const p of players) {
      if (!p.alive) continue;
      const px = p.x, pz = p.z;
      p.cd -= dt;
      if (p.reload > 0) { p.reload -= dt; if (p.reload <= 0) { p.reload = 0; p.ammo = p.mag; } }
      if (p.human) updateHuman(p, dt); else updateBot(p, dt);
      p.vx = (p.x - px) / dt; p.vz = (p.z - pz) / dt;
    }
    const alive = players.filter((p) => p.alive);
    for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j], dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d > 0 && d < PR * 2) { const o = (PR * 2 - d) / 2; move(a, -dx / d * o, -dz / d * o); move(b, dx / d * o, dz / d * o); }
    }
  }
  if (state === 'playing' || state === 'roundEnd') updateBalls(dt);
  if (state === 'playing') endRoundCheck();
  for (const p of players) {
    const target = p.crouch ? H_CROUCH : H_STAND;
    p.h += (target - p.h) * Math.min(1, dt * 10);
  }
  syncModels(dt);
  updateCamera(dt);
  world.update(dt, clock);
}
function syncModels(dt) {
  for (const p of players) {
    const m = p.model;
    m.root.visible = !(p.human && p.alive && inGameOrPaused());
    m.root.position.set(p.x, 0, p.z);
    m.root.rotation.y = -p.ang;
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
    camera.position.set(h.x, eyeY(h) + bob, h.z);
    camera.rotation.set(h.pitch, -h.ang - Math.PI / 2, 0);
    vm.visible = true;
    vm.position.x += (VM_BASE.x + (h.moving ? Math.sin(clock * 5) * 0.012 : 0) - vm.position.x) * Math.min(1, dt * 10);
    vm.position.y += (VM_BASE.y + bob * 0.4 - (h.reload > 0 ? 0.12 : 0) - vm.position.y) * Math.min(1, dt * 10);
    vm.position.z += (VM_BASE.z - vm.position.z) * Math.min(1, dt * 14);
    vm.rotation.x += ((h.reload > 0 ? -0.5 : 0) - vm.rotation.x) * Math.min(1, dt * 12);
    setFov(h.sprint ? 82 : 75, dt);
  } else {
    vm.visible = false; setFov(70, dt);
    const allies = players.filter((p) => p.alive && p.team === 0);
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
  $('stance').textContent = h.crouch ? 'CROUCHED' : h.sprint ? 'SPRINT' : '';
  const gap = 5 + currentSpread(h) * 500;
  $('cross').style.setProperty('--g', gap.toFixed(1) + 'px');
  $('cross').classList.toggle('hidden', !h.alive);
  $('hitmark').classList.toggle('on', hitMarker > 0);
  $('status').classList.toggle('hidden', h.alive || state !== 'playing');
  let banner = '';
  if (state === 'countdown') banner = `ROUND ${round}<small>${Math.ceil(timer)}</small>`;
  else if (state === 'roundEnd') banner = `<span style="color:${TEAMS[lastWinner].css}">${TEAMS[lastWinner].name} WINS THE ROUND</span>`;
  $('banner').innerHTML = banner;
  $('banner').classList.toggle('hidden', !banner);
}
function renderFeed() {
  $('feed').innerHTML = feed.map((f) =>
    `<div><b style="color:${TEAMS[f.at].css}">${f.a}</b><i class="splat-ico" style="background:${TEAMS[f.at].paintCss}"></i><b style="color:${TEAMS[f.bt].css}">${f.b}</b></div>`).join('');
}
function popCoins(n, label) {
  sfx.coin(); updateCoins();
  const el = document.createElement('div'); el.className = 'pop';
  el.innerHTML = `<i class="coin"></i>+${n} <small>${label}</small>`;
  $('pops').appendChild(el); setTimeout(() => el.remove(), 1400);
}
function updateCoins() { for (const el of document.querySelectorAll('.coin-count')) el.textContent = save.coins.toLocaleString(); }

// ---------- menus ----------
const SCREENS = ['home', 'shop', 'settings', 'help', 'pause', 'results'];
function showScreen(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  document.body.classList.toggle('menu', !!id);
  if (id === 'home') renderHome();
  if (id === 'shop') { renderShop(); refreshPreview(); }
  updateCoins();
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
nav('btnQuit', quitToHome);
nav('resAgain', startMatch);
nav('resShop', () => { shopBack = 'results'; showScreen('shop'); });
nav('resHome', () => showScreen('home'));

// settings
const sens = $('sens'), volume = $('volume');
sens.value = save.settings.sens; volume.value = save.settings.volume;
sens.addEventListener('input', () => { save.settings.sens = +sens.value; persist(); });
volume.addEventListener('input', () => { save.settings.volume = +volume.value; setVolume(+volume.value); persist(); });
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
  if (!inGame()) return;
  prevState = state; state = 'paused'; mouse.down = false;
  for (const k in keys) keys[k] = false;
  showScreen('pause');
}
function resume() {
  if (state !== 'paused') return;
  state = prevState; showScreen(null); lock();
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
  if (e.button === 0) { if (h.alive) mouse.down = true; else specIdx++; }
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  if (inGame() && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyP' || (e.code === 'Escape' && !locked)) {
    if (state === 'paused') resume();
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
makePlayers(); resetPlayers();
showScreen('home');

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
    step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { last += dt * 1000; update(dt); } renderHud(); renderer.render(scene, camera); renderPreview(dt); },
    start() { fallbackLook = true; startMatch(); },
    get info() { return { state, score, round, alive: players.filter((p) => p.alive).map((p) => p.name), balls: balls.length, coins: save.coins }; },
    players: () => players,
    previewYaw(y) { if (preview) preview.yaw = y; },
  };
}
