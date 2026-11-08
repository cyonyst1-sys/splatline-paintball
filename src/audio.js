// Procedural sound effects with Web Audio (no audio files needed).
let ac = null, master = null, vol = 0.8;
const L = { x: 0, y: 0, z: 0 };

export function initAudio() {
  if (!ac) {
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = vol; master.connect(ac.destination);
    } catch (e) { ac = null; }
  }
  if (ac && ac.state === 'suspended') ac.resume();
}
export function setVolume(v) { vol = v; if (master) master.gain.value = v; }
export function setListener(x, y, z) { L.x = x; L.y = y; L.z = z; }

function att(pos) {
  if (!pos) return 1;
  const d = Math.hypot(pos.x - L.x, pos.y - L.y, pos.z - L.z);
  return Math.max(0.05, 1 - d / 55);
}
function noise(dur, freq, v, q = 1) {
  if (!ac || !(v >= 0.004)) return; // also skips NaN
  const n = Math.max(1, (ac.sampleRate * dur) | 0), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const s = ac.createBufferSource(); s.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain(); g.gain.value = v;
  s.connect(f).connect(g).connect(master); s.start();
}
function tone(f0, f1, dur, v, type = 'sine', delay = 0) {
  if (!ac) return;
  const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  shot: (pos) => { noise(0.05, 1700, 0.22 * att(pos), 0.8); noise(0.03, 300, 0.12 * att(pos), 1); },
  splat: (pos) => noise(0.09, 480, 0.3 * att(pos), 1.4),
  tag: (pos) => noise(0.16, 360, 0.55 * att(pos), 1.1),
  hit: () => tone(1100, 1500, 0.07, 0.12, 'square'),
  coin: () => { tone(988, 988, 0.07, 0.1, 'square'); tone(1319, 1319, 0.14, 0.1, 'square', 0.07); },
  click: () => tone(620, 620, 0.04, 0.07, 'triangle'),
  buy: () => { tone(660, 990, 0.12, 0.12, 'triangle'); tone(990, 1480, 0.18, 0.1, 'triangle', 0.1); },
  deny: () => tone(220, 160, 0.18, 0.12, 'sawtooth'),
  beep: () => tone(660, 660, 0.1, 0.1, 'square'),
  go: () => tone(440, 880, 0.3, 0.16, 'sawtooth'),
  reload: () => { noise(0.08, 2400, 0.15, 4); noise(0.12, 700, 0.12, 3); },
  dive: () => { noise(0.22, 700, 0.18, 0.7); setTimeout(() => noise(0.16, 140, 0.45, 1), 330); },
  out: () => tone(320, 110, 0.5, 0.18, 'sawtooth'),
};
