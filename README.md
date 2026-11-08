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

## The field

A mirrored 50 × 30 m field with inflatable bunkers: snakes, doritos, cans, bricks, temples, a Maya tower and a centre cake. Around it are netting, team tents, flags, bleachers with spectators and a tree line. Paint splats stick to bunkers, the turf and tagged players.

## Code

- `index.html`: page, menus, HUD and styles
- `src/world.js`: scene, field, bunkers, scenery, paint decals and collision helpers
- `src/main.js`: game loop, player and bot logic, shooting, menus
- `src/economy.js`: coins, upgrades, saved progress
- `src/audio.js`: procedural sound effects

Every push to `main` redeploys the site on GitHub Pages within about a minute.

To run locally, serve the folder with any static web server (ES modules don't load from `file://`).

Graphics can be set to **Low** in Settings (no shadows, lower resolution) for slower computers. Keyboard and mouse only.
