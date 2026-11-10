# Splatline Paintball

A first-person 3D paintball game that runs in the browser. Built with [three.js](https://threejs.org/) (loaded from a CDN), no build step.

You play on Blue with three bot teammates against four Red bots on an outdoor field of inflatable bunkers. One hit and you're out; the first team to win 3 rounds takes the match.

**Play:** https://cyonyst1-sys.github.io/splatline-paintball/

## Controls

| Control | Action |
| --- | --- |
| WASD / arrows | Move your legs (forward, back, strafe) |
| Mouse | Look and aim, independently of your legs (click the game to lock the mouse) |
| Left or right click | Fire one paintball (semi-auto); alternate buttons to shoot faster |
| Q / E (hold) | Lean left / right around cover (only your upper body is exposed) |
| Space | Dive and slide low |
| Shift | Sprint (less accurate) |
| C | Crouch: hide behind low bunkers, steadier aim (hold or toggle in Settings) |

**Free look:** once you're moving, your legs keep their heading while you look and shoot anywhere. Stop and your body turns to face your view; look more than ~100° away and your body turns with you. The LEGS arrow on the HUD shows where your legs point.
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

Spend them on the **Upgrade marker** screen:

| Upgrade | Effect | Levels |
| --- | --- | --- |
| Trigger Job | Max fire rate 6.3 → 14.3 balls/s | 5 |
| Big Hopper | 20 → 50 balls per load | 5 |
| Speed Feed | Reload 1.6 s → 0.7 s | 5 |
| Precision Barrel | Spread down to 35% | 5 |
| HPA Tank | Ball speed 46 → 70 m/s | 3 |

Progress is saved in your browser (localStorage), so it stays on this device and browser.

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

Each field is 50 × 30 m with netting, team tents, flags, bleachers and scenery that matches the map. Paint splats stick to bunkers, the ground and tagged players.

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
