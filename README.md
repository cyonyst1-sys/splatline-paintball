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
| C | Crouch: hide behind low bunkers, steadier aim (hold or toggle in Settings) || R | Reload |
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

Spend them on the **Upgrade marker** screen:

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
- `src/marker.js`: the procedural paintball marker model

Every push to `main` redeploys the site on GitHub Pages within about a minute.

To run locally, serve the folder with any static web server (ES modules don't load from `file://`).

Graphics can be set to **Low** in Settings (no shadows, lower resolution) for slower computers. Keyboard and mouse only.
