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
