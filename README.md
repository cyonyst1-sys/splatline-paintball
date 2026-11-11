# Splatline Paintball

A first-person 3D paintball game that runs in the browser. Built with [three.js](https://threejs.org/) (loaded from a CDN), no build step.

You play on Blue with three bot teammates against four Red bots on an outdoor field of inflatable bunkers. One hit and you're out; the first team to win 3 rounds takes the match.

**Play:** https://cyonyst1-sys.github.io/splatline-paintball/

## Controls

| Control | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Look and aim (click the game to lock the mouse) |
| Left or right click | Fire one paintball (semi-auto); alternate buttons to shoot faster |
| Q / E (hold) | Lean left / right around cover (only your upper body is exposed) |
| Space | Dive and slide low |
| Shift | Sprint (less accurate) |
| C | Crouch: hide behind low bunkers, steadier aim (hold or toggle in Settings) |
| R | Reload |
| Esc / P | Pause |

## Multiplayer

Click **Multiplayer** on the home screen.

- **Host:** pick *Teams* (players split Blue vs Red) or *Co-op* (everyone on Blue vs bots), then **Create room**. Share the 5-character code or the invite link.
- **Join:** enter the code (or open the invite link) and press **Join**.
- Up to 8 players in Teams, 4 in Co-op. Bots fill every empty slot, and take over if someone leaves.
- The host's browser runs the match, so the host should keep the game tab open and in front. If the host leaves, the room closes.
- It's peer-to-peer (WebRTC via [PeerJS](https://peerjs.com/)). PeerJS's free public server only introduces the browsers to each other; no game server is needed. Some strict school or work networks block peer-to-peer connections.

## Coins and upgrades

Earn coins for tagging opponents (+25), winning rounds (+40), finishing a match (+30) and winning it (+150). Easy pays ×0.75, Hard pays ×1.5.

Spend them in the **Pro shop**. Click any item to try it on in the 3D preview before buying. Your gear shows on your player, in your first-person view, and to everyone in a multiplayer room.

**Markers** (each has its own model and handling; upgrades apply on top):

| Marker | Price | Handling |
| --- | --- | --- |
| Tourney Electro | free | Light, fast electronic marker |
| Autococker | 600 | Back block, bolt and pump rod cycle on every shot. 22% more accurate, 11% slower trigger, +2 m/s |
| Stock-Class Pump | 350 | Pump the handle every shot. 45% more accurate, +6 m/s, but much slower and 4 fewer balls |
| Milsim Carbine | 850 | Stock, rail and red-dot sight. +6 balls, +5 m/s, 15% more accurate |

**Hoppers:** Agitated Loader (free), Gravity Bottle (150: +8 balls, slower reload), Speed Feed Pro (300: 0.3 s faster reload).

**Jerseys** (Classic, Racing Stripes, Chevron, Woodland Camo, Hot Rod Flames, Pro #7) and **masks** (Stealth Black, Arctic White, Crimson, Gold Mirror, Chrome) are cosmetic, in your team's colours.

**Upgrades:**

| Upgrade | Effect | Levels |
| --- | --- | --- |
| Trigger Job | Max fire rate 6.3 → 14.3 balls/s | 5 |
| Big Hopper | 20 → 50 balls per load | 5 |
| Speed Feed | Reload 1.6 s → 0.7 s | 5 |
| Precision Barrel | Spread down to 35% | 5 |
| HPA Tank | Ball speed 46 → 70 m/s | 3 |

Progress is saved in your browser (localStorage), so it stays on this device and browser.

## Game modes

Pick a mode on the home screen (the host picks it in multiplayer).

| Mode | Teams | Fields | Rules |
| --- | --- | --- | --- |
| Elimination | 4 v 4 | the 10 small maps | One hit and you're out. First team to win 3 rounds. |
| Capture the Flag | 6 v 6 | the 3 large maps | Infinite respawns (6 s, with spawn protection). Grab the enemy flag and bring it to your own flag stand while your flag is home. A carrier who's tagged drops it; touch your own dropped flag to send it home (it also returns by itself after 20 s). First to 3 captures, or the most after 6 minutes. |
| King of the Castle | 6 v 6 | the 3 large maps | Attackers respawn forever (9 s wait); defenders start inside the castle with 5 lives each (3 s wait). Attackers win by holding the throne room on the keep's ground floor for 55 s (faster with up to 3 attackers inside, paused while a defender is in the room, and wound back quickly by defenders standing in it), or by using up every defender life. Defenders win if the 4-minute clock runs out. Two rounds with teams swapping; a 1–1 tie goes to the faster capture. |

### The castle

The castle in King of the Castle is about 31 × 39 m and has real height you can climb:

- Outer curtain walls with battlements, a main gate and two side gates, and corner towers.
- Wall-walks along the tops of the walls, reached by ramps from the courtyard.
- A three-level keep (ground floor, 2nd floor, roof) with ramps inside between floors.
- Waist-high parapets (1 m) on the wall-walks and keep roof with low, gappy battlements: stand up to shoot over the walls, crouch to hide behind them with your eyes just over the top.
- Arrow slits at standing eye height in the ground-floor walls and the keep's 2nd floor.
- The throne room, the zone attackers must hold, is on the keep's ground floor.

## Maps

Pick a map with the arrows on the home screen (or **🎲 Random**). In multiplayer the host picks it in the lobby. Every map has its own bunker style, layout, ground, sky and lighting, and both halves are mirrored so neither team has an advantage.

| Map | Bunker style | Setting |
| --- | --- | --- |
| Center Stage | Classic tournament inflatables | Sunny day |
| Neon Nights | Glowing neon inflatables | Night |
| Timberline | Plank walls, logs, stumps, cable spools | Woodsball forest |
| Downtown | Jersey barriers, shipping containers, dumpsters, traffic drums | Overcast city lot |
| Tire Yard | Stacked tires and a tractor tire | Dirt yard |
| Harvest | Square and round hay bales | Farm at golden hour |
| Outpost | Sandbag walls, oil drums, ammo crates | Dusty military camp |
| Dune Ruins | Adobe walls, stone columns, clay urns, boulders | Desert |
| Frostbite | Snow brick walls, ice blocks, snowmen, an igloo | Snowfield |
| Scrapyard | Pallet stacks, rusty containers, culvert pipes, junk piles | Dusk |

Large maps (100 × 60 m) for Capture the Flag and King of the Castle:

| Map | Bunker style | Castle |
| --- | --- | --- |
| Highland Keep | Woodsball (plank walls, logs, stumps) | Grey stone |
| Sandstone Citadel | Desert ruins (adobe, columns, boulders) | Sandstone |
| Frostgate | Snow walls, ice blocks, snowmen | Snow |

Small fields are 50 × 30 m. Every field has netting, team tents, flags, bleachers and scenery that matches the map. Paint splats stick to bunkers, the ground and tagged players.

## Code

- `index.html`: page, menus, HUD and styles
- `src/world.js`: scene, scenery, map loading, paint decals and collision helpers
- `src/maps.js`: the 10 maps: bunker styles, layouts and themes
- `src/main.js`: game loop, player and bot logic, shooting, menus
- `src/economy.js`: coins, upgrades, saved progress
- `src/audio.js`: procedural sound effects
- `src/net.js`: peer-to-peer rooms (host, join, messages)
- `src/marker.js`: the procedural paintball markers (Tourney, Autococker with cycling back block, pump, milsim) and hoppers

Bots fight from cover: they sprint from bunker to bunker toward the enemy (or the objective), picking bunkers that hide them from the nearest threat and that teammates aren't already using. At each bunker they duck, then peek out to shoot (leaning round tall bunkers, standing up over low ones), and move up again after a few seconds, sooner if nobody is in sight. If they're flanked, they relocate.

In Elimination each bot has a role:

| Role | What it does |
| --- | --- |
| Back | Stays deep, creeps forward slowly, holds each bunker for a long time and ropes paint at the bunkers enemies were last seen behind |
| Mid | Plays the middle of the field with medium bounds and some suppressing fire |
| Front | Pushes up fast with long bounds and dives into bunkers |
| Snake | Runs to the snake on its half, dives in behind it, crawls up it, then shoots from the far end (lying flat, rising to a crouch). Leaves if it's flanked. On fields without a snake it plays front |
| Anchor | Defensive: falls back toward its own base and holds deep cover |

Roles are reassigned whenever someone is tagged, based on the numbers: even teams play back/snake/mid/front; a team down a player plays back and mids; up by 2 or more it pushes with front players; down by 2 or more (or alone against several) it anchors and makes the other team come to it. After 40 s nobody turtles, and after 60 s everyone pushes.

Players are jointed procedural models (hips, knees, ankles, spine, head, and arms posed with two-bone IK onto the marker's grips) with a walk/run cycle, a real crouch, dive, lean, breathing and a hands-up pose when tagged. All models are generated in code; nothing is downloaded.

Every push to `main` redeploys the site on GitHub Pages within about a minute.

To run locally, serve the folder with any static web server (ES modules don't load from `file://`).

Graphics can be set to **Low** in Settings (no shadows, lower resolution) for slower computers. Keyboard and mouse only.
