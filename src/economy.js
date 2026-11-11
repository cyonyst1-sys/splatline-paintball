// Coins, gun upgrades and saved progress (kept in this browser's localStorage).
const KEY = 'splatline.save.v1';

const defaults = () => ({
  coins: 0,
  up: { rate: 0, hopper: 0, reload: 0, barrel: 0, velocity: 0 },
  stats: { matches: 0, wins: 0, tags: 0 },
  settings: { sens: 1, quality: 'high', volume: 0.8, diff: 'normal', crouchToggle: false, name: '', map: 'center', gameMode: 'elim' },
  owned: { marker: ['tourney'], hopper: ['agitated'], jersey: ['classic'], mask: ['black'] },
  equip: { marker: 'tourney', hopper: 'agitated', jersey: 'classic', mask: 'black' },
});

function load() {
  const d = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object') {
      const out = { ...d, ...s, up: { ...d.up, ...s.up }, stats: { ...d.stats, ...s.stats }, settings: { ...d.settings, ...s.settings },
        owned: { ...d.owned, ...s.owned }, equip: { ...d.equip, ...s.equip } };
      // drop anything that isn't in the catalog any more, and make sure equipped items are owned
      for (const cat of Object.keys(d.owned)) {
        out.owned[cat] = [...new Set([...d.owned[cat], ...(Array.isArray(out.owned[cat]) ? out.owned[cat] : [])])].filter((id) => ITEMS[cat][id]);
        if (!out.owned[cat].includes(out.equip[cat])) out.equip[cat] = d.equip[cat];
      }
      return out;
    }
  } catch (e) { /* storage blocked or corrupt: start fresh */ }
  return d;
}

// ---------- the shop catalog ----------
// markers: rate = time between shots (x), spread (x), speed (+m/s), mag (+balls)
// hoppers: mag (+balls), reload (+s)
export const ITEMS = {
  marker: {
    tourney: { name: 'Tourney Electro', price: 0, desc: 'Light, fast electronic marker.', stats: { rate: 1, spread: 1, speed: 0, mag: 0 } },
    cocker: { name: 'Autococker', price: 600, desc: 'Pneumatic classic. Back block and bolt cycle on every shot. Steadier aim.', stats: { rate: 1.12, spread: 0.78, speed: 2, mag: 0 } },
    pump: { name: 'Stock-Class Pump', price: 350, desc: 'Pump every shot. Slow, but the most accurate marker there is.', stats: { rate: 2.4, spread: 0.55, speed: 6, mag: -4 } },
    milsim: { name: 'Milsim Carbine', price: 850, desc: 'Rifle-style with a stock and red-dot sight. Fast balls, extra capacity.', stats: { rate: 1.05, spread: 0.85, speed: 5, mag: 6 } },
  },
  hopper: {
    agitated: { name: 'Agitated Loader', price: 0, desc: 'Reliable smoke-shell loader.', stats: { mag: 0, reload: 0 } },
    gravity: { name: 'Gravity Bottle', price: 150, desc: 'Old-school tall bottle. Holds more, slower to refill.', stats: { mag: 8, reload: 0.25 } },
    speed: { name: 'Speed Feed Pro', price: 300, desc: 'Low-profile force-fed loader. Much faster reloads.', stats: { mag: 0, reload: -0.3 } },
  },
  jersey: {
    classic: { name: 'Classic', price: 0, desc: 'Plain team jersey.' },
    stripes: { name: 'Racing Stripes', price: 120, desc: 'Two bold stripes down the front.' },
    chevron: { name: 'Chevron', price: 160, desc: 'Sharp chevrons across the chest.' },
    camo: { name: 'Woodland Camo', price: 180, desc: 'Camo blotches in your team colour.' },
    flame: { name: 'Hot Rod Flames', price: 220, desc: 'Flames licking up from the waist.' },
    pro: { name: 'Pro #7', price: 250, desc: 'Pro-team jersey with your number.' },
  },
  mask: {
    black: { name: 'Stealth Black', price: 0, desc: 'Black mask, smoke lens.', color: 0x1a1c20, lens: 0x16304a, metal: 0.4 },
    white: { name: 'Arctic White', price: 100, desc: 'White mask, ice-blue lens.', color: 0xe8ebee, lens: 0x2a7bd6, metal: 0.4 },
    red: { name: 'Crimson', price: 120, desc: 'Red mask, smoke lens.', color: 0xb3202f, lens: 0x16304a, metal: 0.4 },
    gold: { name: 'Gold Mirror', price: 200, desc: 'Black mask, gold mirrored lens.', color: 0x1a1c20, lens: 0xd9a92a, metal: 1 },
    chrome: { name: 'Chrome', price: 250, desc: 'Polished chrome mask, purple lens.', color: 0xcfd6de, lens: 0x8a3cff, metal: 1 },
  },
};
export const owns = (cat, id) => save.owned[cat].includes(id);
export function buyItem(cat, id) {
  const it = ITEMS[cat] && ITEMS[cat][id];
  if (!it || owns(cat, id) || save.coins < it.price) return false;
  save.coins -= it.price; save.owned[cat].push(id); save.equip[cat] = id;
  persist();
  return true;
}
export function equipItem(cat, id) { if (!owns(cat, id)) return false; save.equip[cat] = id; persist(); return true; }
/** The equipped look, in the shape the game and network use: { marker, hopper, jersey, mask }. */
export const myLook = () => ({ ...save.equip });

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
