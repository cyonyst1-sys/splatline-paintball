// Game loop, players, bots, game modes, shooting, menus and HUD.
import * as THREE from 'three';
import { createWorld, TEAMS, NETB, FIELD, resolveCircle, segBlocked2D, segCircle, supportHeight } from './world.js';
import { save, persist, resetSave, UPGRADES, stat, costOf, buy, addCoins, ITEMS, owns, buyItem, equipItem, myLook } from './economy.js';
import { sfx, initAudio, setListener, setVolume } from './audio.js';
import { makeMarker, disposeMarker, cycleMarker, animateMarker } from './marker.js';
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
  koth: { name: 'King of the Castle', desc: 'Attackers respawn forever. Defenders get 5 lives each. Hold the throne room to win.', teamSize: 6 },
};
const CTF = { caps: 3, time: 360, returnT: 20, pickR: 1.4, capR: 2.6 };
// attackRespawn: attackers wait longer than defenders, which gives the castle time to regroup
const KOTH = { time: 240, lives: 5, capSecs: 55, rounds: 2, attackRespawn: 9, defendRespawn: 3 };
const RESPAWN_T = 4, PROTECT_T = 2.5;

// ---------- characters ----------
// A jointed player: pelvis → legs (hip, knee, foot) and spine → chest, head, and an "aim" group that holds
// the marker and both arms. Arms are posed with two-bone IK so the hands sit on the marker's grips.
// Local axes: +x forward, +y up, +z to the right.
const LIMB = { thigh: 0.43, shin: 0.43, upper: 0.29, fore: 0.27, hip: 0.92 };
const G = {
  thigh: new THREE.CapsuleGeometry(0.088, LIMB.thigh - 0.12, 4, 10).translate(0, -LIMB.thigh / 2, 0),
  shin: new THREE.CapsuleGeometry(0.068, LIMB.shin - 0.09, 4, 10).translate(0, -LIMB.shin / 2, 0),
  foot: new THREE.BoxGeometry(0.25, 0.08, 0.11).translate(0.05, -0.04, 0),
  hips: new THREE.CapsuleGeometry(0.125, 0.11, 4, 12).rotateX(Math.PI / 2).scale(0.72, 0.9, 1),
  torso: new THREE.LatheGeometry([[0.0, 0], [0.15, 0], [0.165, 0.08], [0.19, 0.24], [0.205, 0.37], [0.2, 0.45], [0.13, 0.54], [0, 0.56]].map(([x, y]) => new THREE.Vector2(x, y)), 24),
  neck: new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10),
  head: new THREE.SphereGeometry(0.112, 18, 14),
  // sphere phi = PI and cylinder theta = PI/2 both face +x (forward)
  maskShell: new THREE.SphereGeometry(0.13, 20, 12, Math.PI - 1.25, 2.5, 1.0, 1.55),
  lens: new THREE.CylinderGeometry(0.135, 0.135, 0.06, 24, 1, true, Math.PI / 2 - 1.05, 2.1),
  visor: new THREE.BoxGeometry(0.06, 0.012, 0.2),
  strap: new THREE.TorusGeometry(0.118, 0.012, 6, 24),
  upper: new THREE.CapsuleGeometry(0.055, LIMB.upper - 0.08, 4, 10).translate(0, -LIMB.upper / 2, 0),
  fore: new THREE.CapsuleGeometry(0.047, LIMB.fore - 0.07, 4, 10).translate(0, -LIMB.fore / 2, 0),
  hand: new THREE.BoxGeometry(0.06, 0.09, 0.05).translate(0, -0.04, 0),
  belt: new THREE.TorusGeometry(0.16, 0.022, 6, 24).rotateX(Math.PI / 2).scale(0.78, 1, 1),
  pod: new THREE.CylinderGeometry(0.026, 0.026, 0.17, 10),
  podCap: new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10),
};
const M = {
  skin: new THREE.MeshStandardMaterial({ color: 0xd9a37f, roughness: 0.7 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.85 }),
  shoe: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.6 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.75 }),
  belt: new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.6 }),
  pod: new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.3, transparent: true, opacity: 0.85 }),
  out: TEAMS.map((t) => new THREE.MeshStandardMaterial({ color: new THREE.Color(t.color).lerp(new THREE.Color(0x777777), 0.7), roughness: 0.9 })),
  teamPaint: TEAMS.map((t) => new THREE.MeshStandardMaterial({ color: t.paint, roughness: 0.3 })),
};
const jerseyCache = {}, maskCache = {};
// jersey texture on the torso lathe: u = 0.25 is the chest, u = 0.75 the back; the top of the canvas is the collar
function jerseyMat(team, pattern) {
  const key = `${team}_${pattern}`;
  if (jerseyCache[key]) return jerseyCache[key];
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), base = new THREE.Color(TEAMS[team].color), css = (col) => `#${col.getHexString()}`;
  const dark = base.clone().multiplyScalar(0.55), light = base.clone().lerp(new THREE.Color(0xffffff), 0.45);
  g.fillStyle = css(base); g.fillRect(0, 0, 256, 256);
  if (pattern === 'stripes') { g.fillStyle = '#ffffff'; g.fillRect(40, 0, 12, 256); g.fillRect(76, 0, 12, 256); g.fillRect(168, 0, 12, 256); g.fillRect(204, 0, 12, 256); }
  else if (pattern === 'chevron') {
    g.strokeStyle = '#ffffff'; g.lineWidth = 12;
    for (const y of [70, 110, 150]) { g.beginPath(); g.moveTo(14, y - 34); g.lineTo(64, y); g.lineTo(114, y - 34); g.stroke(); }
  } else if (pattern === 'camo') {
    for (let i = 0; i < 70; i++) { g.fillStyle = [css(dark), css(light), '#1d2418'][i % 3]; g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 22, 6 + Math.random() * 14, Math.random() * 3, 0, 7); g.fill(); }
  } else if (pattern === 'flame') {
    for (let i = 0; i < 26; i++) {
      const x = i * 10 + Math.random() * 6, h = 70 + Math.random() * 90;
      const gr = g.createLinearGradient(0, 256, 0, 256 - h); gr.addColorStop(0, '#ffd23f'); gr.addColorStop(0.6, '#ff6a00'); gr.addColorStop(1, 'rgba(255,40,0,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(x - 9, 256); g.quadraticCurveTo(x - 12, 256 - h * 0.5, x + 4, 256 - h); g.quadraticCurveTo(x + 2, 256 - h * 0.45, x + 12, 256); g.fill();
    }
  } else if (pattern === 'pro') {
    g.fillStyle = css(dark); g.fillRect(0, 0, 256, 40); g.fillRect(0, 216, 256, 40);
    g.fillStyle = '#ffffff'; g.fillRect(0, 40, 256, 6);
    g.font = '900 110px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('7', 192, 130);
    g.font = '900 34px system-ui, sans-serif'; g.fillText('7', 82, 92);
  }
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, 256, 10);       // collar
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 246, 256, 10);     // hem
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (jerseyCache[key] = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }));
}
const sleeveMat = TEAMS.map((t) => new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.8 }));
function maskMats(id) {
  if (maskCache[id]) return maskCache[id];
  const it = ITEMS.mask[id] || ITEMS.mask.black;
  return (maskCache[id] = {
    shell: new THREE.MeshStandardMaterial({ color: it.color, roughness: 0.4, metalness: it.metal > 0.5 ? 0.8 : 0.1 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.08, metalness: it.metal, emissive: it.lens, emissiveIntensity: 0.55, side: THREE.DoubleSide }),
  });
}
function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; }

// two-bone IK: rotations for an upper-arm group at `sh` and its forearm (both pointing down -y) so the hand reaches `tgt`
const DOWN = new THREE.Vector3(0, -1, 0);
function solveArm(sh, tgt, L1, L2, pole) {
  const d = tgt.clone().sub(sh), dist = clamp(d.length(), 0.08, L1 + L2 - 0.002), dn = d.normalize();
  const a = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
  const perp = pole.clone().sub(dn.clone().multiplyScalar(pole.dot(dn))).normalize();
  const u = dn.clone().multiplyScalar(Math.cos(a)).add(perp.multiplyScalar(Math.sin(a))).normalize();
  const q1 = new THREE.Quaternion().setFromUnitVectors(DOWN, u);
  const elbow = sh.clone().addScaledVector(u, L1);
  const f = tgt.clone().sub(elbow).normalize().applyQuaternion(q1.clone().invert());
  return { q1, q2: new THREE.Quaternion().setFromUnitVectors(DOWN, f) };
}
const DEFAULT_LOOK = { marker: 'tourney', hopper: 'agitated', jersey: 'classic', mask: 'black' };
function makeModel(team, look = DEFAULT_LOOK) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const pelvis = new THREE.Group(); pelvis.position.y = LIMB.hip; body.add(pelvis);
  pelvis.add(mesh(G.hips, M.pants, 0, 0.02, 0));
  // pod pack on the back of the belt
  pelvis.add(mesh(G.belt, M.belt, 0, 0.06, 0));
  for (let i = 0; i < 4; i++) {
    const z = -0.09 + i * 0.06;
    pelvis.add(mesh(G.pod, M.pod, -0.15, 0.04, z)); pelvis.add(mesh(G.podCap, M.teamPaint[team], -0.15, 0.135, z));
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0, -0.04, s * 0.095); pelvis.add(hip);
    hip.add(mesh(G.thigh, M.pants));
    const knee = new THREE.Group(); knee.position.y = -LIMB.thigh; hip.add(knee);
    knee.add(mesh(G.shin, M.pants));
    const ankle = new THREE.Group(); ankle.position.y = -LIMB.shin; knee.add(ankle);
    ankle.add(mesh(G.foot, M.shoe));
    legs.push({ hip, knee, ankle });
  }
  // spine: torso, neck, head, and the aim group (yaw from the look direction, x = lean, z = forward lean)
  const upper = new THREE.Group(); upper.rotation.order = 'YXZ'; upper.position.y = 0.06; pelvis.add(upper);
  const torso = mesh(G.torso, jerseyMat(team, look.jersey)); torso.scale.set(0.72, 1, 1); upper.add(torso);
  upper.add(mesh(G.neck, M.skin, 0.01, 0.6, 0));
  const head = new THREE.Group(); head.position.set(0.01, 0.7, 0); upper.add(head);
  const mm = maskMats(look.mask);
  head.add(mesh(G.head, M.skin)).scale.set(1, 1.1, 0.95);
  const shellM = mesh(G.maskShell, mm.shell); shellM.rotation.y = 0; head.add(shellM);
  const lens = mesh(G.lens, mm.lens, 0, 0.035, 0); head.add(lens);
  head.add(mesh(G.visor, mm.shell, 0.11, 0.075, 0));
  const strap = mesh(G.strap, M.belt, -0.01, 0.035, 0); strap.rotation.x = Math.PI / 2; head.add(strap);
  // aim group at shoulder height: rotates with pitch, carries the marker and both arms
  const aim = new THREE.Group(); aim.position.y = 0.46; upper.add(aim);
  const gun = makeMarker(team, { detail: 'low', type: look.marker, hopperType: look.hopper });
  const GUN = new THREE.Vector3(0.3, -0.16, 0.11); gun.position.copy(GUN); aim.add(gun);
  const arms = [], sleeves = [];
  for (const s of [1, -1]) { // right arm (z+) holds the trigger grip, left arm the front grip
    const sh = new THREE.Group(); sh.position.set(-0.01, 0, s * 0.2); aim.add(sh);
    const su = mesh(G.upper, sleeveMat[team]); sh.add(su); sleeves.push(su);
    const elbow = new THREE.Group(); elbow.position.y = -LIMB.upper; sh.add(elbow);
    const sf = mesh(G.fore, sleeveMat[team]); elbow.add(sf); sleeves.push(sf);
    const hand = mesh(G.hand, M.glove, 0, -LIMB.fore, 0); elbow.add(hand);
    arms.push({ sh, elbow, s });
  }
  // precompute the aiming pose and the hands-up "I'm out" pose
  const gp = gun.userData, shR = arms[0].sh.position, shL = arms[1].sh.position;
  const aimPose = [
    solveArm(shR, new THREE.Vector3(GUN.x + gp.grip.x, GUN.y + gp.grip.y + 0.03, GUN.z), LIMB.upper, LIMB.fore, new THREE.Vector3(-0.3, -1, 0.7)),
    solveArm(shL, new THREE.Vector3(GUN.x + gp.fore.x, GUN.y + gp.fore.y + 0.02, GUN.z - 0.01), LIMB.upper, LIMB.fore, new THREE.Vector3(-0.2, -1, -0.8)),
  ];
  const outPose = [
    solveArm(shR, new THREE.Vector3(0.02, 0.48, 0.3), LIMB.upper, LIMB.fore, new THREE.Vector3(0, -0.2, 1)),
    solveArm(shL, new THREE.Vector3(0.02, 0.48, -0.3), LIMB.upper, LIMB.fore, new THREE.Vector3(0, -0.2, -1)),
  ];
  root.traverse((m) => { if (m.isMesh) m.castShadow = high; });
  return { root, body, pelvis, upper, aim, head, legs, torso, arms, sleeves, aimPose, outPose, gun, gunHome: GUN.clone(), look: { ...look }, team, outK: 0, recoil: 0, walk: 0, breathe: Math.random() * 6 };
}
// tagged players turn grey; the pose change (hands up) happens in poseModel
function setOutLook(m, out) {
  m.torso.material = out ? M.out[m.team] : jerseyMat(m.team, m.look.jersey);
  for (const s of m.sleeves) s.material = out ? M.out[m.team] : sleeveMat[m.team];
}
const sameLook = (a, b) => a && b && a.marker === b.marker && a.hopper === b.hopper && a.jersey === b.jersey && a.mask === b.mask;
// keep only catalog items (looks arrive over the network)
function cleanLook(l) {
  const o = { ...DEFAULT_LOOK };
  if (l && typeof l === 'object') for (const k of Object.keys(o)) if (typeof l[k] === 'string' && Object.hasOwn(ITEMS[k], l[k])) o[k] = l[k];
  return o;
}
// bots get a fixed look per slot, so the same bot always wears the same kit
function botLook(team, i) {
  const pick = (cat, n) => { const ids = Object.keys(ITEMS[cat]); return ids[n % ids.length]; };
  return { marker: pick('marker', i * 3 + team), hopper: pick('hopper', i + team * 2), jersey: pick('jersey', i * 5 + team), mask: pick('mask', i * 7 + team * 3) };
}
function setLook(p, look) {
  look = cleanLook(look);
  if (sameLook(p.model.look, look)) return;
  const old = p.model, tag = old.tag;
  scene.remove(old.root); disposeMarker(old.gun);
  p.model = makeModel(p.team, look); scene.add(p.model.root);
  if (tag) { old.root.remove(tag); p.model.root.add(tag); p.model.tag = tag; }
  setOutLook(p.model, !p.alive);
}

// first-person marker, with gloved hands on it
const vm = new THREE.Group();
vm.rotation.y = Math.PI / 2 + 0.06;
vm.position.set(0.17, -0.19, -0.36);
vm.scale.setScalar(0.85);
camera.add(vm);
const VM_BASE = vm.position.clone();
let vmMuzzle = null, vmMarker = null;
// a gloved hand gripping a vertical handle at the group's origin (marker space: +x forward, +z right)
const HG = {
  palm: new THREE.CapsuleGeometry(0.026, 0.05, 4, 10),
  finger: new THREE.CapsuleGeometry(0.0115, 0.034, 3, 8),
  knuckle: new THREE.CapsuleGeometry(0.022, 0.05, 4, 10).rotateX(Math.PI / 2),
  cuff: new THREE.CylinderGeometry(0.034, 0.036, 0.05, 12),
  fore: new THREE.CapsuleGeometry(0.036, 0.3, 4, 12),
};
function buildHand(g, team, armDir, trigger) {
  const side = trigger ? 1 : -1;
  g.add(mesh(HG.palm, M.glove, -0.012, -0.012, side * 0.024));                    // palm on the outer side of the grip
  for (let i = 0; i < 4; i++) {                                                   // fingers wrapping round the front
    if (trigger && i === 0) continue;
    const f = mesh(HG.finger, M.glove, 0.024, 0.014 - i * 0.022, -side * 0.006); f.rotation.x = Math.PI / 2; g.add(f);
  }
  g.add(mesh(HG.knuckle, M.glove, 0.012, -0.012, side * 0.006)).children.at(-1).scale.set(0.8, 1.35, 0.9);
  if (trigger) { const t = mesh(HG.finger, M.glove, 0.05, 0.03, 0.004); t.rotation.z = -Math.PI / 2 + 0.25; g.add(t); }
  const thumb = mesh(HG.finger, M.glove, 0.0, 0.04, -side * 0.02); thumb.rotation.set(side * 0.5, 0, -0.9); g.add(thumb);
  // cuff and sleeve running from the wrist back toward the shoulder
  const dir = armDir.clone().normalize(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const wrist = new THREE.Vector3(-0.025, -0.045, side * 0.02);
  const cuff = mesh(HG.cuff, M.glove); cuff.position.copy(wrist).addScaledVector(dir, 0.02); cuff.quaternion.copy(q); g.add(cuff);
  const fore = mesh(HG.fore, sleeveMat[team]); fore.position.copy(wrist).addScaledVector(dir, 0.21); fore.quaternion.copy(q); g.add(fore);
}
const upgradeLook = () => ({ barrel: save.up.barrel, hopperLvl: save.up.hopper, tank: save.up.velocity });
function buildViewmodel() {
  for (const c of [...vm.children]) { vm.remove(c); disposeMarker(c); }
  const me = players.find((p) => p.human);
  const team = me ? me.team : 0, look = me ? me.look : myLook();
  const m = makeMarker(team, { ...upgradeLook(), type: look.marker, hopperType: look.hopper });
  const u = m.userData;
  // right hand wrapped round the grip with a finger on the trigger; forearm runs back and down off-screen
  const rh = new THREE.Group(); rh.position.set(u.grip.x, u.grip.y + 0.01, 0); m.add(rh);
  buildHand(rh, team, new THREE.Vector3(-0.8, -0.5, 0.33), true);
  // left hand on the front grip (it rides along with a pump handle)
  const lh = new THREE.Group(); lh.position.set(u.fore.x, u.fore.y, 0); (look.marker === 'pump' ? u.cyclers[0] : m).add(lh);
  if (look.marker === 'pump') lh.position.set(0, -0.006, 0);
  buildHand(lh, team, new THREE.Vector3(-0.5, -0.62, -0.6), false);
  m.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  vm.add(m); vmMuzzle = u.muzzle; vmMarker = m;
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
    const look = botLook(team, i), model = makeModel(team, look); scene.add(model.root);
    players.push({
      team, i, human: false, ctrl: 'bot', peer: null, name: TEAMS[team].names[i], model, look,
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
  setOutLook(p.model, false); p.model.outK = 0; p.model.gun.visible = true;
  for (const c of [...p.model.root.children]) if (c.userData.decal) c.removeFromParent();
}
function freshLife(p) {
  p.pitch = 0; p.diveT = 0; p.diveCd = 0; p.queued = 0; p.crouchOn = false; p.lean = 0;
  p.alive = true; p.crouch = false; p.ammo = p.mag; p.reload = 0; p.cd = 0;
  p.vx = p.vz = p.mvx = p.mvz = 0; p.tx = undefined;
  p.goal = null; p.tgt = null; p.seen = 0; p.scanT = Math.random() * 0.2; p.stuckT = 0; p.lx = p.x; p.lz = p.z; p.path = null; p.flankDone = false; p.cv = null; p.cvLean = 0;
  p.crawl = false; p.erole = null; p.sn = null; p.snakeDone = false; p.lastSeen = null;
  p.lane = [-1, -0.45, 0, 0.45, 1][(Math.random() * 5) | 0];
  p.hold = Math.random() < 0.5; p.avoid = Math.random() < 0.5 ? 1 : -1;
  reviveModel(p);
}
function resetPlayers() {
  roleT = 0;
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
    p.name = TEAMS[p.team].names[p.i]; setNameTag(p, null); p.look = botLook(p.team, p.i);
  }
  const me = net.mode ? net.myId : 'local';
  for (const a of assign) {
    const p = players[a.slot]; if (!p) continue;
    p.peer = a.id; p.name = a.name; p.look = a.id === me ? myLook() : cleanLook(a.look);
    if (a.id === me) { p.human = true; p.ctrl = 'local'; }
    else { p.ctrl = net.mode === 'host' ? 'remote' : 'net'; setNameTag(p, a.name); }
  }
  for (const p of players) setLook(p, p.look);
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
      const mk = ITEMS.marker[p.look.marker].stats, hp = ITEMS.hopper[p.look.hopper].stats;
      p.mag = Math.max(8, stat('hopper') + mk.mag + hp.mag); p.cool = stat('rate') * mk.rate; p.reloadT = Math.max(0.5, stat('reload') + hp.reload);
      p.spread = stat('barrel') * mk.spread; p.ballSpeed = stat('velocity') + mk.speed;
    }
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
  cycleMarker(owner.model.gun); owner.model.recoil = 1;
  if (owner.human) cycleMarker(vmMarker);
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
    p.respawnT = p.lives <= 0 ? 0 : gameMode === 'ctf' ? 6
      : gameMode === 'koth' ? (p.team === attackers() ? KOTH.attackRespawn : KOTH.defendRespawn) : RESPAWN_T;
  } else if (!local) p.respawnT = rs || 0;
  if (net.mode === 'host') broadcast({ t: 'tag', v: slotIdx(p), b: slotIdx(by), pt: vec(point), rs: p.respawnT });
  if (local && flagsSt) for (const F of flagsSt) if (F.st === 1 && F.carrier === slotIdx(p)) dropFlag(F, p);
  p.alive = false; p.reload = 0; p.crouch = false; p.lean = 0; p.diveT = 0; p.crawl = false; roleT = 0;
  const n = new THREE.Vector3(point.x - p.x, 0, point.z - p.z).normalize();
  const d = world.addSplat(point, n, by.team, 0.42, p.model.root); if (d) d.userData.decal = true;
  world.puff(point, by.team);
  sfx.tag(point);
  setOutLook(p.model, true);
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
// Bots fight from cover: they bound from bunker to bunker toward the enemy (or the objective), then hold each
// bunker for a few seconds, ducking behind it and peeking out (leaning round tall bunkers, standing up over
// low ones) to trade paint, before sprinting to the next one.
function nearestFoe(b, foes) {
  let near = null, nd = 1e9;
  for (const f of foes) { const d = Math.hypot(f.x - b.x, f.z - b.z); if (d < nd) { nd = d; near = f; } }
  return near;
}
// the next bunker to run to: closer to `target`, within `step` metres, hidden from the threat, not a teammate's
function pickCover(b, target, threat, o, relax) {
  const fd = Math.hypot(target.x - b.x, target.z - b.z);
  const taken = players.filter((q) => q !== b && q.alive && q.team === b.team && q.cv && q.cv.spot).map((q) => q.cv.spot);
  const minProg = relax ? -3 : Math.min(1.5, fd * 0.3);
  const cands = [];
  for (const c of world.cover) {
    const dB = Math.hypot(c.x - b.x, c.z - b.z);
    if (dB < 1.5 || dB > o.step) continue;
    if (taken.some((g) => Math.hypot(g.x - c.x, g.z - c.z) < 1.8)) continue;
    const prog = fd - Math.hypot(target.x - c.x, target.z - c.z);
    if (prog < minProg) continue;
    cands.push({ c, s: prog - dB * 0.3 + Math.random() * 3 });
  }
  cands.sort((a, b2) => b2.s - a.s);
  let best = null, bs = -1e9;
  for (const { c, s } of cands.slice(0, 10)) {
    let sc = s;
    if (threat) {
      const ty = eyeY(threat), dT = Math.hypot(threat.x - c.x, threat.z - c.z);
      if (losClear(threat.x, ty, threat.z, c.x, 1.0, c.z)) sc -= 14;           // can't even hide crouched here
      else if (!losClear(threat.x, ty, threat.z, c.x, 1.55, c.z)) sc += 2;     // hides you standing up too
      if (dT < 5) sc -= 8;
      if (o.keepAway && dT < o.keepAway) sc -= 10;
    }
    if (sc > bs) { bs = sc; best = c; }
  }
  return best;
}
// eye position when leaning to `side` (+1 right, -1 left) while facing `ang`
const leanEye = (b, side, ang) => ({ x: b.x - Math.sin(ang) * side * LEAN_DIST, z: b.z + Math.cos(ang) * side * LEAN_DIST });
// o: { hold: [min, max] seconds per bunker, step: max bound length, push: walk straight at the target when
//      no cover is left, keepAway: avoid bunkers closer than this to the enemy, fixed: a spot to hold }
function coverAdvance(b, dt, D, target, foes, o) {
  const cv = b.cv || (b.cv = { mode: 'pick', t: 0 });
  const threat = b.tgt || nearestFoe(b, foes);
  cv.quiet = b.tgt ? 0 : (cv.quiet || 0) + dt;
  // nobody in sight for a while: don't sit around, keep moving up
  // (patient players, like a back player or an anchor, sit tight anyway)
  cv.t -= cv.mode === 'cover' && cv.quiet > 1.5 && !o.patient ? dt * (gameMode === 'koth' ? 20 : 3) : dt;
  if (cv.mode === 'pick') {
    cv.spot = o.fixed ? { x: o.fixed.x, z: o.fixed.z } : pickCover(b, target, threat, o, false) || (o.push ? null : pickCover(b, target, threat, o, true));
    cv.open = false; cv.willDive = Math.random() < (o.dive || 0);
    if (!cv.spot && !o.push) { cv.spot = { x: b.x, z: b.z }; cv.open = true; } // nowhere better: stay and fight from here
    cv.mode = 'move'; cv.t = 7; b.stuckT = 0; b.lx = b.x; b.lz = b.z;
  }
  if (cv.mode === 'move') {
    const goal = cv.spot || target, d = Math.hypot(goal.x - b.x, goal.z - b.z);
    if (d < (cv.spot ? 0.45 : 1.5)) {
      if (!cv.spot) { cv.mode = 'pick'; return; }
      cv.mode = 'cover'; cv.t = rand(o.hold[0], o.hold[1]); cv.peek = false; cv.peekT = rand(0.2, 0.6); cv.check = 0; cv.lowOk = cv.highOk = true;
    } else {
      // the last couple of metres into a bunker: dive in (front players mostly)
      if (cv.willDive && cv.spot && d < 3.2 && d > 1.8 && (b.y || 0) < 0.3 && b.diveCd <= 0 && b.reload <= 0) {
        cv.willDive = false; botDive(b, Math.atan2(goal.z - b.z, goal.x - b.x)); return;
      }
      // sprint between bunkers; shoot on the run if someone's in view
      const a = followPath(b, goal, D.speed * (b.tgt ? 0.95 : 1.1) * (o.fast || 1), dt);
      if (!b.tgt) b.ang += angDiff(d < 2.5 && threat ? Math.atan2(threat.z - b.z, threat.x - b.x) : a, b.ang) * Math.min(1, dt * 6);
      b.stuckT += dt;
      if (b.stuckT > 0.9) {
        if (Math.hypot(b.x - b.lx, b.z - b.lz) < 0.4) { b.avoid = -b.avoid; b.path = null; if (!o.fixed) cv.mode = 'pick'; }
        b.stuckT = 0; b.lx = b.x; b.lz = b.z;
      }
      if (cv.t <= 0 && !o.fixed) cv.mode = 'pick';
      return;
    }
  }
  // ---- in cover ----
  const ta = threat ? Math.atan2(threat.z - b.z, threat.x - b.x) : b.ang;
  if (!b.tgt) b.ang += angDiff(ta, b.ang) * Math.min(1, dt * 5);
  cv.check -= dt;
  if (threat && cv.check <= 0) {
    cv.check = 0.5;
    const ty = eyeY(threat);
    cv.lowOk = !losClear(threat.x, ty, threat.z, b.x, 1.0, b.z);   // hidden when crouched
    cv.highOk = !losClear(threat.x, ty, threat.z, b.x, 1.55, b.z); // hidden standing
  }
  // flanked: this bunker no longer hides us from them, so find one that does (fighting on the way)
  if (threat && !cv.lowOk && !o.fixed) {
    if (!cv.open) { cv.mode = 'pick'; return; }
    if (b.tgt) { // caught in the open: strafe while shooting
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = rand(0.5, 1.4); }
      const perp = ta + Math.PI / 2 * b.strafe;
      move(b, Math.cos(perp) * D.speed * 0.75 * dt, Math.sin(perp) * D.speed * 0.75 * dt, true);
      if (cv.t <= 0) cv.mode = 'pick';
      return;
    }
  }
  cv.peekT -= dt;
  if (b.reload > 0) cv.peek = false;
  else if (cv.peekT <= 0) {
    if (cv.peek) {
      // stay out while trading paint, but not forever
      if (b.tgt && b.ammo > 0 && cv.peekLen < 2.6) { cv.peekT = 0.3; cv.peekLen += 0.3; }
      else { cv.peek = false; cv.peekT = rand(0.6, 1.5); }
    } else {
      cv.peek = true; cv.peekT = cv.peekLen = rand(0.8, 1.6);
      cv.supp = Math.random() < (o.suppress || 0); // lay down paint on their last spot even if they're hiding
      cv.low = false;
      if (!cv.highOk) cv.side = 0; // low bunker: pop up over the top
      else {                       // tall bunker: lean out the side that has a view, often from a crouch
        const sides = Math.random() < 0.5 ? [1, -1] : [-1, 1];
        cv.side = sides[0]; cv.low = Math.random() < 0.45;
        if (threat) for (const s of sides) {
          const e = leanEye(b, s, ta);
          if (losClear(e.x, (b.y || 0) + (cv.low ? H_CROUCH : H_STAND) * 0.9 - 0.05, e.z, threat.x, chestY(threat), threat.z)) { cv.side = s; break; }
        }
      }
    }
  }
  b.cvLean = cv.peek ? cv.side : 0;
  b.cvCrouch = cv.peek ? cv.low : !cv.highOk;
  // time to move up (only once ducked back in)
  if (cv.t <= 0 && !cv.peek && !o.fixed) cv.mode = 'pick';
}
// ---- Elimination roles ----
// back:   stays deep, creeps forward slowly, holds long and lays ropes of paint on the enemy's bunkers
// mid:    plays the middle of the field, medium bounds, some suppressing fire
// front:  pushes up fast with long bounds, dives into bunkers, gets close
// snake:  runs to the snake, dives in, crawls up it and shoots from the end
// anchor: (defending when down on numbers) falls back to deep cover and makes them come to you
const ROLE = {
  back:   { hold: [3.5, 6], step: 7, keepAway: 20, suppress: 0.9, rope: 0.5, dive: 0, fast: 0.8, patient: true },
  mid:    { hold: [2, 4], step: 10, keepAway: 12, suppress: 0.45, rope: 0.75, dive: 0.3 },
  front:  { hold: [0.8, 2], step: 14, keepAway: 3, push: true, suppress: 0.2, rope: 1, dive: 0.75, fast: 1.12 },
  anchor: { hold: [6, 10], step: 7, keepAway: 22, suppress: 0.6, rope: 0.7, dive: 0.15, retreat: true, patient: true },
  snake:  { suppress: 0.3, rope: 0.9 },
};
const ROLE_RANK = { front: 0, snake: 1, mid: 2, anchor: 3, back: 4 }; // most advanced bot gets the most forward role
const teamPlan = ['even', 'even'];
let roleT = 0;
// the snake on a team's own half (closest to its base), if this field has one
function ownSnake(team) {
  const side = team ? 1 : -1;
  let best = null, bd = 1e9;
  for (const s of world.info.snakes || []) {
    if (s.x * side < -4) continue;
    const d = Math.abs(s.x - side * FIELD.hw) + Math.random() * 0.5;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
// What a team does depends on the numbers: up by 2+ → push, down by 2+ (or alone against several) → defend.
function assignRoles(team) {
  const mine = players.filter((p) => p.team === team && p.alive), n = mine.length;
  const m = players.filter((p) => p.team !== team && p.alive).length;
  if (!n) return;
  const late = roundTime > HUNT_AFTER + 20;       // a long stalemate: everybody goes
  let plan = n - m >= 2 ? 'push' : m - n >= 2 || (n === 1 && m >= 2) ? 'defend' : m > n ? 'behind' : 'even';
  if (late) plan = 'push';
  else if (plan === 'defend' && roundTime > HUNT_AFTER) plan = 'behind'; // can't turtle forever
  const sets = {
    even:   [['mid'], ['mid', 'front'], ['back', 'mid', 'front'], ['back', 'snake', 'mid', 'front']],
    behind: [['mid'], ['back', 'mid'], ['back', 'mid', 'mid'], ['back', 'snake', 'mid', 'mid']],
    push:   [['front'], ['mid', 'front'], ['mid', 'front', 'front'], ['back', 'snake', 'front', 'front']],
    defend: [['anchor'], ['back', 'anchor'], ['back', 'anchor', 'anchor'], ['back', 'anchor', 'anchor', 'mid']],
  };
  let roles = sets[plan][Math.min(n, 4) - 1].slice();
  while (roles.length < n) roles.push(plan === 'push' ? 'front' : 'mid');
  if (late) roles = roles.map((r) => (r === 'back' ? 'mid' : r === 'snake' ? 'snake' : 'front'));
  // a human on the team takes one of the slots (a mid if there is one)
  if (mine.some((p) => !(p.ctrl === 'bot'))) { const k = roles.indexOf('mid'); roles.splice(k >= 0 ? k : roles.length - 1, 1); }
  const bots = mine.filter((p) => p.ctrl === 'bot');
  const hasSnake = !!ownSnake(team);
  roles = roles.map((r) => (r === 'snake' && !hasSnake ? 'front' : r));
  // someone already down in the snake stays there (it's a commitment), as long as the team isn't turtling
  const inSnake = bots.find((b) => b.erole === 'snake' && b.sn && b.sn.st !== 'go');
  if (inSnake && !roles.includes('snake') && n >= 2 && plan !== 'defend' && roles.length) {
    const k = ['front', 'mid', 'anchor'].map((r) => roles.indexOf(r)).find((i) => i >= 0);
    roles[k ?? roles.length - 1] = 'snake';
  }
  // keep roles that still exist (no pointless reshuffles), then hand out the rest by how far up each bot is
  const pending = [];
  for (const b of bots) {
    const k = b.erole && !(b.erole === 'snake' && b.snakeDone) ? roles.indexOf(b.erole) : -1;
    if (k >= 0) roles.splice(k, 1); else pending.push(b);
  }
  const side = team ? 1 : -1;
  pending.sort((a, b2) => a.x * side - b2.x * side);        // most advanced first
  roles.sort((a, b2) => ROLE_RANK[a] - ROLE_RANK[b2]);
  for (const b of pending) {
    let r = roles.shift() || 'mid';
    if (r === 'snake' && b.snakeDone) r = 'front';
    if (b.erole !== r) { b.erole = r; b.cv = null; b.sn = null; b.crawl = false; }
  }
  teamPlan[team] = plan;
}
function botDive(b, dir) { b.diveT = DIVE_T; b.diveDir = dir; b.crawl = false; b.crouch = false; }
// snake player: go to the back end of your snake, dive in behind it, crawl up to the far end, play from there
function snakeRole(b, dt, D, foes) {
  let sn = b.sn;
  if (!sn) {
    const s = ownSnake(b.team);
    if (!s) { b.erole = 'front'; return; }
    const u = { x: Math.cos(s.rot), z: -Math.sin(s.rot) }, n = { x: Math.sin(s.rot), z: Math.cos(s.rot) };
    const sd = Math.sign(n.z * s.z + n.x * 0.001) || 1;       // the outside of the snake, away from the middle
    const off = s.hd + 0.42, side = b.team ? 1 : -1;
    const ends = [1, -1].map((k) => ({ x: s.x + u.x * k * (s.hw - 0.3) + n.x * sd * off, z: s.z + u.z * k * (s.hw - 0.3) + n.z * sd * off }));
    ends.sort((a, c) => c.x * side - a.x * side);            // [entry (own end), far end]
    const [entry, far] = ends, L = Math.hypot(entry.x - far.x, entry.z - far.z);
    const back = { x: (entry.x - far.x) / L, z: (entry.z - far.z) / L };
    sn = b.sn = { entry, far, back, approach: { x: entry.x + back.x * 3, z: entry.z + back.z * 3 }, st: 'go', t: 14 };
    b.cv = { mode: 'move', peek: false };
  }
  sn.t -= dt;
  const cv = b.cv, fwd = Math.atan2(-sn.back.z, -sn.back.x);
  const threat = b.tgt || nearestFoe(b, foes);
  if (sn.st === 'go') {
    b.crawl = false;
    const d = Math.hypot(sn.approach.x - b.x, sn.approach.z - b.z);
    if (d < 0.7 || sn.t <= 0) {
      // dive in along the snake; if the run-up is blocked just get down at the entry
      if (sn.t > 0 && b.diveCd <= 0) botDive(b, Math.atan2(sn.entry.z - b.z, sn.entry.x - b.x));
      sn.st = 'crawl'; sn.t = 30;
    } else {
      const a = followPath(b, sn.approach, D.speed * 1.1, dt);
      if (!b.tgt) b.ang += angDiff(a, b.ang) * Math.min(1, dt * 6);
    }
    return;
  }
  if (sn.st === 'crawl') {
    b.crawl = true; cv.mode = 'move'; cv.peek = false;
    const d = Math.hypot(sn.far.x - b.x, sn.far.z - b.z);
    if (d < 0.6 || sn.t <= 0) { sn.st = 'hold'; sn.t = rand(7, 12); cv.mode = 'cover'; cv.peekT = rand(0.5, 1); return; }
    // still well off the snake line (pushed off by something)? walk to the entry first
    const offLine = Math.abs((b.x - sn.entry.x) * sn.back.z - (b.z - sn.entry.z) * sn.back.x);
    if (offLine > 1.6) { b.crawl = false; steer(b, sn.entry.x, sn.entry.z, D.speed, dt); return; }
    steer(b, sn.far.x, sn.far.z, b.tgt ? 0.8 : 1.8, dt);                       // crawl (inching while shooting)
    if (!b.tgt) b.ang += angDiff(fwd, b.ang) * Math.min(1, dt * 5);
    return;
  }
  // holding the end of the snake: lie flat, come up to a crouch to shoot down the line
  cv.mode = 'cover';
  if (!b.tgt) b.ang += angDiff(threat ? Math.atan2(threat.z - b.z, threat.x - b.x) : fwd, b.ang) * Math.min(1, dt * 4);
  cv.peekT -= dt;
  if (b.reload > 0) cv.peek = false;
  else if (cv.peekT <= 0) {
    if (cv.peek && !(b.tgt && b.ammo > 0 && cv.peekLen < 3)) { cv.peek = false; cv.peekT = rand(0.8, 1.6); }
    else if (cv.peek) { cv.peekT = 0.3; cv.peekLen += 0.3; }
    else { cv.peek = true; cv.peekT = cv.peekLen = rand(1, 1.8); cv.supp = Math.random() < ROLE.snake.suppress; }
  }
  b.crawl = !cv.peek; b.cvCrouch = cv.peek;
  // flanked (seen from the middle while down), or played it out: get up and become a front player
  // (only fire from the side counts: down the line is where a snake player expects it)
  const side = threat && Math.abs(((threat.x - b.x) * -sn.back.x + (threat.z - b.z) * -sn.back.z) / Math.max(0.1, dist(b, threat))) < 0.7;
  const exposed = side && dist(b, threat) < 22 && !cv.peek && losClear(threat.x, eyeY(threat), threat.z, b.x, 0.45, b.z);
  if (sn.t <= 0 || exposed) { b.snakeDone = true; b.erole = 'front'; b.sn = null; b.cv = null; b.crawl = false; }
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
    // (past 40% captured, everyone abandons their post to save the throne room)
    const alarm = ((koth.att >= 2 || koth.progress > 0.12) && (onGround || b.i % 2 === 0)) || koth.progress > 0.4;
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
  const R = gameMode === 'elim' ? ROLE[b.erole || 'mid'] : null;
  // mid-dive: the slide carries them; nothing else until they land
  b.diveCd -= dt;
  if (b.diveT > 0) {
    const t = DIVE_T - b.diveT;
    b.diveT -= dt;
    const sp = t < 0.35 ? 8.6 - t * 12 : Math.max(0, 4.4 - (t - 0.35) * 11);
    move(b, Math.cos(b.diveDir) * sp * dt, Math.sin(b.diveDir) * sp * dt, true);
    b.lean *= 0.8; b.crouch = false;
    if (b.diveT <= 0) { b.diveT = 0; b.diveCd = 1.5; }
    return;
  }
  const me = leanOffset(b);
  b.scanT -= dt;
  if (b.tgt && (!b.tgt.alive || b.tgt.protect > 0)) b.tgt = null;
  if (b.scanT <= 0) {
    b.scanT = rand(0.12, 0.22);
    let best = null, bd = 1e9;
    const sight = respawnMode() ? D.sight * 0.75 : D.sight; // big fields: cover and flanks need to actually hide you
    for (const f of foes) {
      const d = Math.hypot(f.x - b.x, f.z - b.z);
      const lo = leanOffset(f, 0.8);
      if (d < sight && d < bd && losClear(b.x + me.x, eyeY(b), b.z + me.z, f.x + lo.x, chestY(f), f.z + lo.z)) { best = f; bd = d; }
    }
    if (best !== b.tgt) b.seen = 0;
    b.tgt = best; b.td = bd;
  }
  if (b.ammo < b.mag && b.reload <= 0 && (b.ammo === 0 || (!b.tgt && b.ammo < 8))) startReload(b);
  // castle defenders behind a parapet fight crouched: eyes over the wall, body behind it
  const hunker = gameMode === 'koth' && b.spot && b.spot.hunker && b.team !== attackers() && b.y > 0.6 && dist(b, b.spot) < 2;
  b.cvLean = 0; b.cvCrouch = false;

  let want = b.ang;
  if (b.tgt) {
    const t = b.tgt, td = Math.hypot(t.x - b.x, t.z - b.z);
    b.seen += dt;
    b.lastSeen = { x: t.x, z: t.z, y: chestY(t), t: clock };
    const ft = td / b.ballSpeed;
    const tl = leanOffset(t, 0.8);
    const px = t.x + tl.x + t.vx * ft * D.lead, pz = t.z + tl.z + t.vz * ft * D.lead;
    want = Math.atan2(pz - b.z, px - b.x);
    const da = angDiff(want, b.ang);
    b.ang += da * Math.min(1, dt * 9);
    const muzzleY = eyeY(b) - 0.25;
    b.pitch = Math.atan2(chestY(t) + 0.5 * GRAV * ft * ft - muzzleY, Math.max(0.5, td));
    // castle defenders are braced behind walls: steadier aim and quicker reactions than the attackers
    const castleDef = gameMode === 'koth' && b.team !== attackers();
    const react = D.react + (respawnMode() ? (castleDef ? 0 : 0.25) : 0);
    if (b.seen > react && b.cd <= 0 && b.reload <= 0 && Math.abs(da) < 0.2) {
      // paintballs wander more over long distances; respawn modes are a bit looser so attacks can get through
      const err = D.err * (1 + Math.max(0, td - 12) / 20) * (castleDef ? 0.85 : respawnMode() ? 1.35 : 1);
      const yaw = b.ang + gauss() * err, pitch = b.pitch + gauss() * err * 0.6;
      const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
      const pos = new THREE.Vector3(b.x + me.x + Math.cos(b.ang) * 0.55, muzzleY, b.z + me.z + Math.sin(b.ang) * 0.55);
      fire(b, pos, dir.multiplyScalar(b.ballSpeed));
      b.cd = D.rate * rand(0.8, 1.4) * (R ? R.rope : 1); // back players rope it: a steady stream of paint
    }
  } else {
    b.seen = 0; b.pitch *= 0.9;
    if (R && b.cv && b.cv.peek && b.cv.supp) suppress(b, D, R, me, dt);
  }

  botMove(b, dt, D, obj, foes, want);
  b.crouch = !b.crawl && (b.reload > 0 || hunker || b.cvCrouch);
  if (b.crawl) b.cvLean = 0;
  b.lean += (b.cvLean - b.lean) * Math.min(1, dt * 8);
}
// Suppressing fire: no one in view, but someone was just there. Walk a rope of paint back and forth across the
// edge of the bunker they ducked behind, so anyone who pokes out runs into it.
function suppress(b, D, R, me, dt) {
  const L = b.lastSeen;
  if (!L || clock - L.t > 5 || b.reload > 0 || b.ammo <= 3) return;
  const dx = L.x - b.x, dz = L.z - b.z, d = Math.hypot(dx, dz);
  if (d < 4 || d > D.sight) return;
  const sweep = Math.sin(clock * 2.6 + b.i * 1.7) * 0.8;
  const px = L.x - (dz / d) * sweep, pz = L.z + (dx / d) * sweep;
  const want = Math.atan2(pz - b.z, px - b.x), da = angDiff(want, b.ang);
  b.ang += da * Math.min(1, dt * 9);
  if (b.cd > 0 || Math.abs(da) > 0.25) return;
  const muzzleY = eyeY(b) - 0.25, ft = d / b.ballSpeed;
  const pitch = Math.atan2(L.y + 0.5 * GRAV * ft * ft - muzzleY, d) + gauss() * D.err * 0.6;
  const yaw = b.ang + gauss() * D.err;
  const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
  const pos = new THREE.Vector3(b.x + me.x + Math.cos(b.ang) * 0.55, muzzleY, b.z + me.z + Math.sin(b.ang) * 0.55);
  fire(b, pos, dir.multiplyScalar(b.ballSpeed));
  b.cd = D.rate * R.rope * rand(0.85, 1.15);
}
function botMove(b, dt, D, obj, foes, want) {
  if (obj) {
    const ground = (b.y || 0) < 0.6;
    if (!obj.carry && !obj.drop && ground) {
      // CTF defenders hold a bunker near their flag and peek from it
      if (obj.hold && gameMode === 'ctf') return coverAdvance(b, dt, D, obj, foes, { fixed: obj, hold: [1e9, 1e9], step: 30 });
      // attackers bound up from cover to cover until they're close, then rush in
      // (castle attackers only cross the open field this way; inside the walls they storm the keep)
      if (!obj.hold && dist(b, obj) > 8 && (gameMode === 'ctf' || !obj.rush)) return coverAdvance(b, dt, D, obj, foes, { hold: obj.rush || gameMode === 'koth' ? [0.4, 1.2] : [1, 2.4], step: 14, push: true });
    }
    b.cv = null; b.crawl = false;
    return objectiveMove(b, dt, D, obj, want);
  }
  if (!foes.length) return;
  // Elimination: play your role (see assignRoles)
  const role = b.erole || 'mid';
  if (role === 'snake') return snakeRole(b, dt, D, foes);
  b.crawl = false;
  const R = ROLE[role];
  // anchors fall back toward their own base; everyone else works toward the nearest opponent
  const target = R.retreat ? { x: (b.team ? 1 : -1) * (FIELD.hw - 5), z: b.z * 0.6 } : nearestFoe(b, foes);
  coverAdvance(b, dt, D, target, foes, R);
}
// close-in objective play: grabbing flags, running them home, taking or defending the throne room
function objectiveMove(b, dt, D, obj, want) {
  if (b.tgt) {
    const td = Math.hypot(b.tgt.x - b.x, b.tgt.z - b.z);
    if (obj.rush && !obj.hold) {
      // keep pushing toward the objective, zig-zagging to be harder to hit; flag carriers just sprint home
      const a = followPath(b, obj, D.speed * (obj.carry ? 1.25 : 1.0), dt);
      if (!obj.carry) {
        b.strafeT -= dt;
        if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = rand(0.35, 0.8); }
        const w = D.speed * 0.55 * b.strafe;
        move(b, -Math.sin(a) * w * dt, Math.cos(a) * w * dt, true);
      }
    } else if (obj.hold && b.y > 0.6) { /* hold the firing position */ }
    else {
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = rand(0.5, 1.4); }
      const perp = want + Math.PI / 2 * b.strafe;
      let sx = Math.cos(perp), sz = Math.sin(perp);
      if (td < 7) { sx -= Math.cos(want) * 0.8; sz -= Math.sin(want) * 0.8; }
      const sp = obj.hold ? D.speed * 0.4 : D.speed * 0.75;
      move(b, sx * sp * dt, sz * sp * dt, true);
    }
    return;
  }
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
  else if (a === 0) koth.progress = Math.max(0, koth.progress - dt / KOTH.capSecs * (d > 0 ? 3 : 1)); // defenders in the room win it back fast
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
    return { slot: slotOrder(team, n)[idx], id: pl.id, name: pl.name, look: cleanLook(pl.look) };
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
  p.alive = false; setOutLook(p.model, true);
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
      lobby.players.push({ id: from, name: cleanName(m.name), look: cleanLook(m.look) });
      broadcastLobby(); sfx.beep();
      return;
    }
    case 'look': { // a joiner changed gear in the lobby
      const l = lobby.players.find((q) => q.id === from);
      if (!l || inGame()) return;
      l.look = cleanLook(m.l); broadcastLobby();
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
    p.ctrl = 'bot'; p.peer = null; p.name = TEAMS[p.team].names[p.i]; setNameTag(p, null); p.look = botLook(p.team, p.i); setLook(p, p.look);
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
        players: m.players.slice(0, 12).filter((l) => l && typeof l === 'object').map((l) => ({ id: String(l.id), name: cleanName(l.name), look: cleanLook(l.look) })) };
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
      const assign = m.assign.filter((a) => a && okSlot(a.slot)).map((a) => ({ slot: a.slot, id: String(a.id), name: cleanName(a.name), look: cleanLook(a.look) }));
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
    // Elimination bots re-think their roles twice a second (and right away when someone is tagged)
    if (gameMode === 'elim' && !client) { roleT -= dt; if (roleT <= 0) { roleT = 0.5; assignRoles(0); assignRoles(1); } }
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
        if (p.diveT > 0) target = p.diveDir;                    // dive head-first
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
    const target = p.diveT > 0 || p.crawl ? H_PRONE : p.crouch ? H_CROUCH : H_STAND;
    p.h += (target - p.h) * Math.min(1, dt * (p.diveT > 0 ? 16 : 10));
  }
  netTick(dt);
  syncModels(dt);
  syncObjectives();
  updateCamera(dt);
  world.update(dt, clock);
}
const ease = (cur, tgt, k) => cur + (tgt - cur) * k;
function syncModels(dt) {
  const k = Math.min(1, dt * 12);
  for (const p of players) {
    const m = p.model;
    let vis = !(p.human && p.alive && inGameOrPaused());
    if (p.alive && p.protect > 0 && ((clock * 8) | 0) % 2) vis = false; // blink while spawn-protected
    if (!p.alive && respawnMode() && inGame()) vis = false;          // the tagged walk off: hide them until they respawn
    m.root.visible = vis;
    animateMarker(m.gun, dt);
    if (!vis) continue;
    poseModel(m, p, dt, k);
  }
  if (vmMarker) animateMarker(vmMarker, dt);
}
// the whole-body pose: legs from movement, crouch and dive from height, spine from aim and lean, arms by IK
function poseModel(m, p, dt, k) {
  m.root.position.set(p.x, p.y || 0, p.z);
  m.root.rotation.y = -p.bodyAng;
  const crouch = clamp((H_STAND - p.h) / (H_STAND - H_CROUCH), 0, 1);
  const prone = clamp((H_CROUCH - p.h) / (H_CROUCH - H_PRONE), 0, 1);
  // movement relative to where the hips face
  const speed = p.alive ? Math.hypot(p.vx, p.vz) : 0, ca = Math.cos(p.bodyAng), sa = Math.sin(p.bodyAng);
  const fwd = speed > 0.01 ? (p.vx * ca + p.vz * sa) / speed : 1, side = speed > 0.01 ? (-p.vx * sa + p.vz * ca) / speed : 0;
  const run = clamp(speed / 6, 0, 1), moving = speed > 0.4 ? 1 : 0;
  if (moving) p.phase += dt * (4.5 + speed * 1.15) * (crouch > 0.5 ? 0.8 : 1);
  m.walk = ease(m.walk, moving * (1 - prone), Math.min(1, dt * 8));
  const stride = (0.42 + run * 0.35) * (1 - crouch * 0.45) * m.walk;
  // legs: hip swings forward/back (and out to the side when strafing), knee bends as the leg comes through
  for (let j = 0; j < 2; j++) {
    const L = m.legs[j], ph = p.phase + j * Math.PI;
    const sw = Math.sin(ph) * stride, lift = Math.max(0, Math.cos(ph)) * m.walk * (0.5 + run * 0.6);
    let hz = sw * fwd + crouch * 1.0, hx = -sw * side * 0.8;
    let kz = -(0.06 + lift) * (1 - crouch) - crouch * 1.9;
    if (j === 1 && !moving) { hz -= 0.35 * crouch; kz += 0.5 * crouch; } // a staggered, braced crouch
    hz *= 1 - prone; hx *= 1 - prone; kz *= 1 - prone * 0.9;
    L.hip.rotation.z = ease(L.hip.rotation.z, hz, k);
    L.hip.rotation.x = ease(L.hip.rotation.x, hx + (j ? 0.04 : -0.04), k);
    L.knee.rotation.z = ease(L.knee.rotation.z, kz, k);
    L.ankle.rotation.z = -(L.hip.rotation.z + L.knee.rotation.z) * 0.85;
  }
  // pelvis height follows the legs, with a little bob on every step
  const bob = Math.abs(Math.cos(p.phase)) * 0.045 * m.walk * (0.6 + run);
  m.pelvis.position.y = ease(m.pelvis.position.y, LIMB.hip - crouch * 0.36 * (1 - prone) - prone * 0.62 + bob - m.walk * 0.03, k);
  m.body.rotation.z = ease(m.body.rotation.z, -prone * 1.25, k);
  m.pelvis.rotation.y = Math.sin(p.phase) * 0.12 * m.walk;                  // hips twist with the stride
  // spine: turn toward the aim, lean around cover, bend forward when running or crouched; breathe
  m.breathe += dt * (1.6 + run * 2);
  m.torso.scale.x = 0.72 * (1 + Math.sin(m.breathe) * 0.015); m.torso.scale.z = 1 + Math.sin(m.breathe) * 0.012;
  m.upper.rotation.y = -angDiff(p.ang, p.bodyAng) - m.pelvis.rotation.y;
  m.upper.rotation.x = ease(m.upper.rotation.x, p.lean * 0.32 + side * run * 0.08, k);
  m.upper.rotation.z = ease(m.upper.rotation.z, -(run * 0.16 + crouch * 0.18) * (1 - prone), k);
  // tagged: hands go up, marker held high
  m.outK = ease(m.outK, p.alive ? 0 : 1, Math.min(1, dt * 6));
  const o = m.outK, pitch = p.alive ? p.pitch : 0.15;
  m.aim.rotation.z = (pitch - m.upper.rotation.z - m.body.rotation.z * 0.8) * (1 - o);
  m.head.rotation.z = pitch * 0.45 + o * 0.25 - m.upper.rotation.z * 0.5;
  for (let j = 0; j < 2; j++) {
    const A = m.arms[j], a = m.aimPose[j], b = m.outPose[j];
    A.sh.quaternion.copy(a.q1).slerp(b.q1, o); A.elbow.quaternion.copy(a.q2).slerp(b.q2, o);
  }
  m.gun.visible = o < 0.5;
  m.recoil = Math.max(0, m.recoil - dt * 9);
  m.gun.position.x = m.gunHome.x - m.recoil * 0.035;
  m.gun.rotation.z = m.recoil * 0.05;
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
    const sub = gameMode === 'koth' ? `<em>${h.team === attackers() ? 'Take the throne room in the keep' : `Defend the castle · ${KOTH.lives} lives`}</em>` : '';
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
// ---------- pro shop: upgrades + markers, hoppers, jerseys, masks ----------
let shopTab = 'upgrades', trying = null; // trying: { cat, id } shown in the preview before buying
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
function itemStats(cat, it) {
  const s = it.stats, out = [];
  if (!s) return '';
  const pct = (v) => (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
  if (cat === 'marker') {
    if (s.rate !== 1) out.push([1 / s.rate - 1 > 0, pct(1 / s.rate - 1) + ' fire rate']);
    if (s.spread !== 1) out.push([s.spread < 1, pct(1 - s.spread) + ' accuracy']);
    if (s.speed) out.push([s.speed > 0, '+' + s.speed + ' m/s']);
    if (s.mag) out.push([s.mag > 0, (s.mag > 0 ? '+' : '') + s.mag + ' balls']);
  } else {
    if (s.mag) out.push([s.mag > 0, '+' + s.mag + ' balls']);
    if (s.reload) out.push([s.reload < 0, (s.reload > 0 ? '+' : '') + s.reload.toFixed(2) + ' s reload']);
  }
  if (!out.length) return '<div class="statrow"><span>Standard</span></div>';
  return `<div class="statrow">${out.map(([g, t]) => `<span class="${g ? 'good' : 'bad'}">${t}</span>`).join('')}</div>`;
}
function renderShop() {
  for (const b of document.querySelectorAll('#shopTabs button')) b.classList.toggle('on', b.dataset.tab === shopTab);
  if (shopTab === 'upgrades') {
    $('shopGrid').innerHTML = Object.entries(UPGRADES).map(([k, u]) => {
      const lvl = save.up[k], cost = costOf(k), now = u.fmt(u.value(lvl));
      const next = cost == null ? '' : `<span class="arrow">→</span><b>${u.fmt(u.value(lvl + 1))}</b>`;
      const pips = [...Array(u.max)].map((_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      const btn = cost == null ? '<button class="buy" disabled>MAXED</button>'
        : `<button class="buy" data-k="${k}" ${save.coins < cost ? 'data-poor="1"' : ''}><i class="coin"></i>${cost}</button>`;
      return `<div class="card"><div class="ico">${u.icon}</div><h3>${u.name}</h3><p>${u.desc}</p>
        <div class="pips">${pips}</div><div class="vals">${now}${next}</div>${btn}</div>`;
    }).join('');
    return;
  }
  const cat = shopTab;
  $('shopGrid').innerHTML = Object.entries(ITEMS[cat]).map(([id, it]) => {
    const own = owns(cat, id), on = save.equip[cat] === id, sel = trying && trying.cat === cat && trying.id === id;
    const btn = on ? '<button class="buy" disabled>EQUIPPED</button>'
      : own ? `<button class="buy equip" data-eq="${id}">Equip</button>`
      : `<button class="buy" data-item="${id}" ${save.coins < it.price ? 'data-poor="1"' : ''}><i class="coin"></i>${it.price}</button>`;
    const sw = cat === 'mask' ? `<div class="swatch" style="background:linear-gradient(90deg, ${hex(it.color)} 0 55%, ${hex(it.lens)} 55%)"></div>` : '';
    return `<div class="card item${sel ? ' sel' : ''}" data-try="${id}">${sw}<div class="tagline">${own ? (on ? 'Equipped' : 'Owned') : 'Click to try on'}</div>
      <h3>${esc(it.name)}</h3><p>${esc(it.desc)}</p>${itemStats(cat, it)}${btn}</div>`;
  }).join('');
}
// the gear the preview shows: what's equipped, with the item being tried swapped in
function previewLook() {
  const l = myLook();
  if (trying) l[trying.cat] = trying.id;
  return l;
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
    const cam = new THREE.PerspectiveCamera(28, 2, 0.01, 20);
    const pivot = new THREE.Group(); s.add(pivot);
    preview = { r, s, cam, pivot, m: null, model: null, drag: null, yaw: 0.6, t: 0 };
    c.addEventListener('pointerdown', (e) => { preview.drag = e.clientX; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => { if (preview.drag != null) { preview.yaw += (e.clientX - preview.drag) * 0.01; preview.drag = e.clientX; } });
    c.addEventListener('pointerup', () => { preview.drag = null; });
  }
  if (preview.m) { preview.pivot.remove(preview.m); disposeMarker(preview.m); preview.m = null; }
  if (preview.model) { preview.pivot.remove(preview.model.root); disposeMarker(preview.model.gun); preview.model = null; }
  const look = previewLook(), body = shopTab === 'jersey' || shopTab === 'mask';
  const h = human(), team = h ? h.team : 0;
  $('markerPreview').parentElement.classList.toggle('tall', body);
  if (body) {
    // the whole player, standing at ease
    preview.model = makeModel(team, look);
    preview.model.root.position.y = -0.95;
    preview.pivot.add(preview.model.root);
    preview.cam.position.set(0, shopTab === 'mask' ? 0.7 : 0.1, shopTab === 'mask' ? 1.5 : 4.1); preview.cam.lookAt(0, shopTab === 'mask' ? 0.62 : -0.06, 0);
    $('previewLabel').textContent = 'Your player · drag to spin';
  } else {
    preview.m = makeMarker(team, { ...upgradeLook(), type: look.marker, hopperType: look.hopper });
    const wide = look.marker === 'milsim' || look.marker === 'pump';
    preview.m.position.set(wide ? -0.16 : -0.07, -0.03, 0);
    preview.pivot.add(preview.m);
    preview.cam.position.set(0, 0.1, wide ? 1.35 : 1.05); preview.cam.lookAt(0, 0, 0);
    $('previewLabel').textContent = `${ITEMS.marker[look.marker].name} · ${ITEMS.hopper[look.hopper].name} · drag to spin`;
  }
}
const fakeP = { x: 0, z: 0, y: 0, vx: 0, vz: 0, bodyAng: 0, ang: 0, pitch: 0, h: H_STAND, lean: 0, alive: true, phase: 0 };
function renderPreview(dt) {
  if (!preview || $('shop').classList.contains('hidden')) return;
  const c = preview.r.domElement, w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * preview.r.getPixelRatio()) || c.height !== Math.round(h * preview.r.getPixelRatio())) {
    preview.r.setSize(w, h, false); preview.cam.aspect = w / h; preview.cam.updateProjectionMatrix();
  }
  if (preview.drag == null) preview.yaw += dt * 0.5;
  preview.pivot.rotation.y = preview.yaw;
  preview.t += dt;
  // show off the action: cycle the marker every so often
  if (preview.m) {
    if (preview.t > 1.4) { preview.t = 0; cycleMarker(preview.m); }
    animateMarker(preview.m, dt);
  }
  if (preview.model) {
    const m = preview.model;
    poseModel(m, fakeP, dt, Math.min(1, dt * 12));
    m.root.position.set(0, -0.95, 0); m.root.rotation.y = 0;
    if (preview.t > 1.6) { preview.t = 0; cycleMarker(m.gun); m.recoil = 1; }
    animateMarker(m.gun, dt);
  }
  preview.r.render(preview.s, preview.cam);
}
$('shopTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  initAudio(); sfx.click();
  shopTab = b.dataset.tab; trying = null;
  renderShop(); refreshPreview();
});
$('shopGrid').addEventListener('click', (e) => {
  initAudio();
  const deny = (b) => { sfx.deny(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); };
  const up = e.target.closest('button[data-k]');
  if (up) {
    if (buy(up.dataset.k)) { sfx.buy(); renderShop(); updateCoins(); refreshPreview(); } else deny(up);
    return;
  }
  const bi = e.target.closest('button[data-item]');
  if (bi) {
    if (buyItem(shopTab, bi.dataset.item)) { sfx.buy(); trying = null; afterGearChange(); } else deny(bi);
    return;
  }
  const be = e.target.closest('button[data-eq]');
  if (be) { equipItem(shopTab, be.dataset.eq); sfx.click(); trying = null; afterGearChange(); return; }
  const card = e.target.closest('[data-try]');
  if (card) { sfx.click(); trying = { cat: shopTab, id: card.dataset.try }; renderShop(); refreshPreview(); }
});
// new gear: refresh the shop, your in-game model and first-person marker, and tell the room
function sendLook() {
  if (!net.mode || inGame()) return;
  if (net.mode === 'client') netSend({ t: 'look', l: myLook() });
  else { const l = lobby.players.find((q) => q.id === 'host'); if (l) { l.look = myLook(); broadcastLobby(); } }
}
function afterGearChange() {
  renderShop(); updateCoins(); refreshPreview();
  const h = human();
  if (h) { h.look = myLook(); setLook(h, h.look); }
  buildViewmodel();
  if (!inGame()) applyLoadout();
  sendLook();
}
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
    lobby = { code, mode: hostMode, game, map: mapSel(game), players: [{ id: 'host', name: myName(), look: myLook() }] };
    state = 'lobby'; mpBusy(false); showScreen('lobby');
  } catch (e) { mpBusy(false, e.message || "Couldn't create a room."); }
});
nav('btnJoin', async () => {
  const code = cleanCode(mpCode.value);
  if (code.length !== 5) { mpBusy(false, 'Enter the 5-character room code.'); return; }
  mpBusy(true, `Joining ${code}…`);
  try {
    await netJoin(code);
    netSend({ t: 'hello', name: myName(), look: myLook() });
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
