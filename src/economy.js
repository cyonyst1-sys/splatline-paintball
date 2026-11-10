// Coins, gun upgrades and saved progress (kept in this browser's localStorage).
const KEY = 'splatline.save.v1';

const defaults = () => ({
  coins: 0,
  up: { rate: 0, hopper: 0, reload: 0, barrel: 0, velocity: 0 },
  stats: { matches: 0, wins: 0, tags: 0 },
  settings: { sens: 1, quality: 'high', volume: 0.8, diff: 'normal', crouchToggle: false, name: '' },
});

function load() {
  const d = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object') {
      return { ...d, ...s, up: { ...d.up, ...s.up }, stats: { ...d.stats, ...s.stats }, settings: { ...d.settings, ...s.settings } };
    }
  } catch (e) { /* storage blocked or corrupt: start fresh */ }
  return d;
}

export const save = load();

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}

export function resetSave() {
  Object.assign(save, defaults());
  persist();
}

export const UPGRADES = {
  rate: {
    name: 'Trigger Job', icon: '⚡', desc: 'Faster trigger reset: raises your max fire rate',
    max: 5, cost: [120, 240, 420, 650, 950],
    value: (l) => +(0.16 - l * 0.018).toFixed(3), // minimum seconds between shots
    fmt: (v) => 'max ' + (1 / v).toFixed(1) + ' balls/s',
  },
  hopper: {
    name: 'Big Hopper', icon: '🛢️', desc: 'More paintballs per load',
    max: 5, cost: [100, 200, 350, 550, 800],
    value: (l) => 20 + l * 6,
    fmt: (v) => v + ' balls',
  },
  reload: {
    name: 'Speed Feed', icon: '🔄', desc: 'Reload quicker',
    max: 5, cost: [100, 200, 350, 550, 800],
    value: (l) => +(1.6 - l * 0.18).toFixed(2),
    fmt: (v) => v.toFixed(2) + ' s reload',
  },
  barrel: {
    name: 'Precision Barrel', icon: '🎯', desc: 'Tighter shot spread',
    max: 5, cost: [150, 300, 500, 750, 1050],
    value: (l) => +(1 - l * 0.13).toFixed(2),
    fmt: (v) => Math.round(v * 100) + '% spread',
  },
  velocity: {
    name: 'HPA Tank', icon: '💨', desc: 'Faster paintballs, less drop',
    max: 3, cost: [200, 400, 700],
    value: (l) => 46 + l * 8,
    fmt: (v) => v + ' m/s',
  },
};

export const stat = (k) => UPGRADES[k].value(save.up[k]);
export function costOf(k) {
  const u = UPGRADES[k], l = save.up[k];
  return l >= u.max ? null : u.cost[l];
}
export function buy(k) {
  const c = costOf(k);
  if (c == null || save.coins < c) return false;
  save.coins -= c; save.up[k]++;
  persist();
  return true;
}
export function addCoins(n) { save.coins += n; persist(); }
