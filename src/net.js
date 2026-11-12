// Peer-to-peer rooms using PeerJS (loaded as the global `Peer` from the CDN).
// The host's browser runs the match; players connect straight to it with a room code.
// PeerJS's free public server is only used to introduce browsers to each other.
const PREFIX = 'splatline-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid typos

export const net = { mode: null, peer: null, conns: new Map(), host: null, code: null, myId: null };
const handlers = { message() {}, leave() {}, closed() {} };
export function onNet(h) { Object.assign(handlers, h); }
export const available = () => typeof window.Peer === 'function';

const randCode = () => Array.from({ length: 5 }, () => ALPHA[(Math.random() * ALPHA.length) | 0]).join('');
export const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

function newPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new window.Peer(id, { debug: 0 }) : new window.Peer({ debug: 0 });
    const t = setTimeout(() => { peer.destroy(); reject(new Error("Couldn't reach the matchmaking server. Check your connection.")); }, 12000);
    peer.on('open', () => { clearTimeout(t); resolve(peer); });
    peer.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

/** Create a room. Resolves with the room code. */
export async function host() {
  for (let tries = 0; tries < 4; tries++) {
    const code = randCode();
    let peer;
    try { peer = await newPeer(PREFIX + code); }
    catch (e) { if (e && e.type === 'unavailable-id') continue; throw e; }
    Object.assign(net, { mode: 'host', peer, code, myId: 'host', host: null });
    peer.on('connection', (conn) => {
      conn.on('open', () => net.conns.set(conn.peer, conn));
      conn.on('data', (d) => handlers.message(conn.peer, d));
      conn.on('close', () => { if (net.conns.delete(conn.peer)) handlers.leave(conn.peer); });
      conn.on('error', () => {});
    });
    // Losing the matchmaking server doesn't drop players already connected; try to get it back for new joiners.
    peer.on('disconnected', () => { if (net.peer === peer) try { peer.reconnect(); } catch (e) { /* ignore */ } });
    return code;
  }
  throw new Error("Couldn't create a room. Try again.");
}

/** Join a room by code. */
export async function join(code) {
  code = cleanCode(code);
  const peer = await newPeer();
  return new Promise((resolve, reject) => {
    const conn = peer.connect(PREFIX + code, { reliable: true });
    const fail = (msg) => { clearTimeout(t); try { peer.destroy(); } catch (e) { /* ignore */ } reject(new Error(msg)); };
    const t = setTimeout(() => fail('That room isn\'t responding.'), 10000);
    peer.on('error', (e) => { if (e && e.type === 'peer-unavailable') fail(`No room with code ${code}.`); });
    conn.on('open', () => {
      clearTimeout(t);
      Object.assign(net, { mode: 'client', peer, host: conn, code, myId: peer.id });
      resolve();
    });
    conn.on('data', (d) => handlers.message('host', d));
    conn.on('close', () => { if (net.mode === 'client' && net.host === conn) { leave(); handlers.closed(); } });
  });
}

export function send(msg) { if (net.host && net.host.open) net.host.send(msg); }
export function broadcast(msg, except) { for (const [id, c] of net.conns) if (id !== except && c.open) c.send(msg); }
export function sendTo(id, msg) { const c = net.conns.get(id); if (c && c.open) c.send(msg); }
export function kick(id) { const c = net.conns.get(id); if (c) { net.conns.delete(id); setTimeout(() => c.close(), 300); } }

export function leave() {
  const p = net.peer;
  Object.assign(net, { mode: null, peer: null, host: null, code: null, myId: null });
  net.conns.clear();
  if (p) try { p.destroy(); } catch (e) { /* ignore */ }
}

// ---------- room directory (the "open rooms" list) ----------
// There's no game server, so one browser acts as the directory: whoever first claims the well-known peer id
// below. Hosts register their room with it and everyone browsing gets the live list. When the directory
// browser leaves, the others notice the dropped connection and one of them claims the id and takes over;
// hosts re-register automatically, so the list rebuilds itself within a few seconds.
const DIR_ID = PREFIX + 'rooms';
const dir = { on: false, peer: null, conn: null, isDir: false, rooms: [], listeners: new Map(), entries: new Map(),
  myRoom: null, retryT: null, regT: null, sweepT: null, onRooms() {} };
const GAMES = ['elim', 'ctf', 'koth'];
const cleanText = (s, n) => String(s ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, n);
const int = (x, lo, hi) => (Number.isInteger(x) && x >= lo && x <= hi ? x : null);
/** Validate a room listing (they come from other browsers). */
export function cleanRoom(r) {
  if (!r || typeof r !== 'object') return null;
  const code = cleanCode(r.code), n = int(r.n, 0, 12), max = int(r.max, 1, 12);
  if (code.length !== 5 || n === null || max === null || !GAMES.includes(r.game)) return null;
  return { code, name: cleanText(r.name, 14) || 'Player', game: r.game, map: cleanText(r.map, 20).toLowerCase(),
    mode: r.mode === 'coop' ? 'coop' : 'teams', n, max, st: r.st === 'playing' ? 'playing' : 'lobby' };
}
/** Start following the room list. onRooms(rooms) is called whenever it changes. */
export function dirStart(onRooms) {
  if (onRooms) dir.onRooms = onRooms;
  if (dir.on) { dir.onRooms(dir.rooms); return; }
  dir.on = true; dirConnect();
}
export function dirStop() {
  dir.on = false; dir.myRoom = null;
  clearTimeout(dir.retryT); clearInterval(dir.regT); clearInterval(dir.sweepT); dir.regT = dir.sweepT = null;
  const p = dir.peer;
  Object.assign(dir, { peer: null, conn: null, isDir: false, rooms: [] });
  dir.listeners.clear(); dir.entries.clear();
  if (p) try { p.destroy(); } catch (e) { /* ignore */ }
}
/** List (or, with null, unlist) this browser's room. */
export function dirSetRoom(room) { dir.myRoom = room ? cleanRoom(room) : null; pushReg(); }
export const dirActive = () => dir.on;

function retry(ms) { clearTimeout(dir.retryT); dir.retryT = setTimeout(dirConnect, ms); }
async function dirConnect() {
  if (!dir.on || dir.isDir) return;
  try { if (!dir.peer || dir.peer.destroyed) dir.peer = await newPeer(); }
  catch (e) { retry(4000); return; }
  if (!dir.on) return;
  const peer = dir.peer;
  let settled = false;
  const conn = peer.connect(DIR_ID, { reliable: true });
  const giveUp = () => { if (settled) return; settled = true; clearTimeout(t); peer.off('error', onErr); try { conn.close(); } catch (e) { /* ignore */ } claim(); };
  const onErr = (e) => { if (e && e.type === 'peer-unavailable') giveUp(); };
  const t = setTimeout(giveUp, 6000);
  peer.on('error', onErr);
  conn.on('open', () => {
    if (settled) return; settled = true; clearTimeout(t); peer.off('error', onErr);
    dir.conn = conn; conn.send({ t: 'list' }); pushReg();
    if (!dir.regT) dir.regT = setInterval(pushReg, 5000);
  });
  conn.on('data', (d) => {
    if (!d || d.t !== 'rooms' || !Array.isArray(d.rooms)) return;
    dir.rooms = d.rooms.slice(0, 50).map(cleanRoom).filter(Boolean);
    dir.onRooms(dir.rooms);
  });
  conn.on('close', () => { if (dir.conn === conn) { dir.conn = null; retry(300 + Math.random() * 1700); } });
  conn.on('error', () => {});
}
// nobody is running the directory: try to become it (if someone beats us to it, go back to listening)
async function claim() {
  if (!dir.on) return;
  let p;
  try { p = await newPeer(DIR_ID); }
  catch (e) { retry(e && e.type === 'unavailable-id' ? 400 + Math.random() * 1500 : 4000); return; }
  if (!dir.on) { try { p.destroy(); } catch (e) { /* ignore */ } return; }
  const old = dir.peer;
  Object.assign(dir, { isDir: true, peer: p, conn: null });
  if (old && old !== p) try { old.destroy(); } catch (e) { /* ignore */ }
  p.on('connection', (c) => {
    c.on('open', () => { dir.listeners.set(c.peer, c); c.send({ t: 'rooms', rooms: dir.rooms }); });
    c.on('data', (d) => {
      if (!d || typeof d !== 'object') return;
      if (d.t === 'list') { if (c.open) c.send({ t: 'rooms', rooms: dir.rooms }); }
      else if (d.t === 'reg') {
        const r = cleanRoom(d.room);
        if (r) dir.entries.set(c.peer, { r, at: Date.now() }); else dir.entries.delete(c.peer);
        publish();
      }
    });
    c.on('close', () => { dir.listeners.delete(c.peer); if (dir.entries.delete(c.peer)) publish(); });
    c.on('error', () => {});
  });
  p.on('disconnected', () => { if (dir.peer === p) try { p.reconnect(); } catch (e) { /* ignore */ } });
  // drop rooms whose host stopped checking in
  dir.sweepT = setInterval(() => {
    const now = Date.now(); let changed = false;
    for (const [k, e] of dir.entries) if (now - e.at > 20000) { dir.entries.delete(k); changed = true; }
    if (changed) publish();
  }, 5000);
  publish();
}
let pubT = null;
function publish() {
  if (pubT) return;                       // at most a few updates a second
  pubT = setTimeout(() => {
    pubT = null;
    if (!dir.isDir) return;
    const seen = new Set(), list = [];
    for (const r of [dir.myRoom, ...[...dir.entries.values()].map((e) => e.r)]) {
      if (!r || seen.has(r.code) || list.length >= 50) continue;
      seen.add(r.code); list.push(r);
    }
    dir.rooms = list;
    for (const c of dir.listeners.values()) if (c.open) c.send({ t: 'rooms', rooms: list });
    dir.onRooms(list);
  }, 150);
}
function pushReg() {
  if (dir.isDir) publish();
  else if (dir.conn && dir.conn.open) dir.conn.send({ t: 'reg', room: dir.myRoom });
}
