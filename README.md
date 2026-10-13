# Dead by Daylight — fan recreation

A browser-based, multiplayer, 1 vs 4 asymmetric horror game inspired by
*Dead by Daylight*. One Killer hunts four Survivors who must repair
generators, open an exit gate and escape. Play with friends over the
internet or LAN; any empty seat in the lobby is filled by a bot.

**Play it: <https://nickypeakin.github.io/dbd/>**. Nothing to install, it
runs in Chrome, Edge or Firefox on a computer with a keyboard and mouse.

Everything — models, textures, sounds and music — is generated in code, so
there are no asset downloads. The only dependencies are `three` (3D), `ws`
and `peerjs` (networking) and two open-source fonts.

> **Fan project.** Not affiliated with, endorsed by or connected to
> Behaviour Interactive or Unity Technologies. "Dead by Daylight" is a
> trademark of Behaviour Interactive Inc. The "Made with Unity" splash is a
> parody start-up screen; the game is plain JavaScript and WebGL.

## Also in this repo: Phasmophobia fan remake

`public/phasmo/index.html` is a separate single-player ghost hunting game
inspired by *Phasmophobia*. It's one self-contained HTML file with a lobby,
24 ghost types and the 6 Tanglewood Drive map, tuned for Chromebooks. Play it
at `/phasmo/` (for example <http://localhost:3000/phasmo/>, or
<https://nickypeakin.github.io/dbd/phasmo/> once it's on the default branch).
See [public/phasmo/README.md](public/phasmo/README.md) for controls and how
it's built.

## Playing online (GitHub Pages)

The link above is a static copy of the game that GitHub hosts for free, and
it stays up whether or not your computer is on. There's no game server
behind it: the browser of whoever hosts a lobby runs the match.

- **Solo:** click **Play**, and bots fill every other seat. The match runs in
  your own tab, so it works even on a slow connection.
- **With friends:** one person clicks **Play with Friends → Host** and sends
  the invite link or 5-letter code. Friends connect straight to the host's
  browser over WebRTC. The free [PeerJS](https://peerjs.com) service is only
  used to find each other by code. The host has to keep the game open while
  everyone plays; if the host leaves, the lobby closes. If a friend's
  connection drops mid-match, a bot takes over their character.
- The public lobby browser is only in the self-hosted server version below.

### Publishing setup (one time)

`.github/workflows/pages.yml` builds and publishes the site on every push to
the default branch. GitHub only needs to be told to use it once: in the
repository go to **Settings → Pages → Build and deployment → Source** and
choose **GitHub Actions**. Then re-run the latest **Deploy to GitHub Pages**
workflow from the **Actions** tab, or push any commit.

To build the same static site yourself, run `npm run build` and serve the
`dist/` folder with any static file server, for example `npx serve dist`.

## Running your own server

Requires **Node.js 20 or newer**.

```bash
npm install
npm start
```

Open <http://localhost:3000> in Chrome, Edge or Firefox. Click **Play**,
pick Survivor or Killer, press **Ready**, and the other four seats fill
with bots.

Set `PORT` to change the port (`PORT=8080 npm start`).
`npm run dev` restarts the server when files change.

The self-hosted server adds public lobby listings, and lobbies don't depend
on any one player's browser staying open.

## Playing with friends on your own server

1. Start the server (see above). One person hosts it; everyone else only
   needs a browser.
2. In the game, choose **Play with Friends → Host a lobby**. You get a
   **lobby code** and an **invite link** (`http://<host>/?join=CODE`).
3. Friends open the link, or enter the code under **Join with code**.
   Public lobbies also appear in the lobby browser.
4. Anyone can switch between Killer and Survivor while that seat is free.
   The host can change the map, bot difficulty and privacy, re-roll bots,
   and kick players. Bots take any seat a person doesn't.
5. When everyone is **Ready**, a 5-second countdown starts the trial. If
   someone disconnects mid-match, a bot takes over for them.

Your friends must be able to reach your server:

| Situation | What to do |
|---|---|
| Same Wi-Fi / LAN | The server prints your LAN address on start (for example `http://192.168.1.20:3000`). Share that. |
| Over the internet, quick | Run a tunnel such as `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, and share the HTTPS URL it prints. WebSockets work through both. |
| Over the internet, router | Forward TCP port 3000 on your router to your PC and share `http://<your-public-ip>:3000`. |
| Always-on | Deploy to any Node host that supports WebSockets (Render, Railway, Fly.io, a VPS). Use `npm start` as the start command; the server reads `PORT` from the environment. A `Dockerfile` is included. |

The server is authoritative, and the client predicts its own movement, so
the game stays playable at typical internet pings (≈150 ms).

### Docker

```bash
docker build -t dbd-fan .
docker run -p 3000:3000 dbd-fan
```

## Controls

| | Survivor | Killer |
|---|---|---|
| Move | `WASD` (+ `Shift` to run) | `WASD` |
| Look | Mouse | Mouse |
| Crouch | `C` | — |
| Main action | Hold `M1`: repair, heal, unhook, open gate, search chest, cleanse totem | `M1` attack (hold to lunge) |
| Secondary | `M2` use item (medkit, toolbox, flashlight) | `M2` use power |
| Interact | `Space`: vault, drop pallet, hide in locker, jump into hatch | `Space`: pick up, hook, break pallet, kick generator, vault, search locker |
| Skill check | `Space` when the needle is in the white zone | — |
| Other | `E` active perk (Dead Hard, Self-Care) · `A`/`D` wiggle when carried | `E` drop the carried survivor |
| Scoreboard / pause | `Tab` / `Esc` | `Tab` / `Esc` |

## What's in it

- **Start-up flow:** a fake Unity loader and "Made with Unity" splash, a
  title screen, and a main menu over an animated campfire scene.
- **Lobby:** survivors sit around the campfire and the killer stands in the
  woods. It has character portraits, a perk and item loadout picker, ready
  states, chat, invite codes and links, a public lobby browser, and host
  settings for map, bot difficulty and privacy.
- **Survivors:** Dwight, Meg, Claudette, Jake, Nea, David, Ace and Feng.
  Each has health states, bleeding, crawling, recovery, Exhaustion, and
  scratch marks and blood pools that killers can track.
- **Killers:**
  - The Trapper (bear traps).
  - The Wraith (Wailing Bell cloak).
  - The Hillbilly (chainsaw sprint).
  - The Huntress (throwable hatchets, reloaded at lockers).
  - All killers have a terror radius with heartbeat and chase music, a red
    stain, and lunges.
- **Core loop:**
  - 7 generators with skill checks (good, great, failed and explosions).
  - Pallets with stuns, windows with fast and medium vaults, and the Entity
    blocking windows.
  - Lockers, chests, hex totems, and hooks with struggle phases and
    self-unhook attempts.
  - Exit gates, the hatch, and the End Game Collapse.
- **36 perks:**
  - 20 for Survivors: Sprint Burst, Dead Hard, Decisive Strike, Borrowed
    Time, Adrenaline, Self-Care, Bond, Kindred, and more.
  - 16 for the Killer: Barbecue & Chili, Hex: Ruin, Pop Goes the Weasel,
    Hex: No One Escapes Death, Bamboozle, and more.
- **Items:** medkit, toolbox and flashlight (which can blind the killer and
  save a carried survivor).
- **Maps:** procedural maps on three realms (MacMillan Estate, Coldwind
  Farm and Autohaven Wreckers), built from DBD-style tiles such as jungle
  gyms, shack, long walls, car loops and corn.
- **Bots:** bots fill the lobby on Easy, Normal or Hard. Survivor bots
  repair, heal, rescue, loop pallets and windows, and hide. Killer bots
  patrol, chase, use their powers, kick generators and search lockers.
- **Results screen:** bloodpoints by category and an emblem for each player.

## Development

```
server/        Node server: static files, WebSocket lobbies, match simulation, bots
  match.js     authoritative game rules (30 Hz)
  lobby.js     lobbies, bot filling, ready/countdown, match lifecycle
  nav.js       A* navigation grid used by bots
  bots/        survivor and killer AI
shared/        code used by both the server and the browser
  mapgen.js    procedural map generator
  collision.js collision world
  interact.js  which action is available where (vault, repair, hook…)
  motor.js     movement speeds and stepping
  data.js      characters, perks, items, realms
public/        the browser client (no build step)
  js/net.js        WebSocket connection to the Node server
  js/p2p.js        GitHub Pages mode: in-tab host plus WebRTC for friends
  js/host-worker.js runs server/lobby.js in a Web Worker for that mode
  js/gfx/      renderer, procedural models/textures, world, campfire scene
  js/game/     in-match client: prediction, interpolation, camera, effects
  js/ui/       splash, menus, lobby, HUD, results
scripts/
  build-static.js  builds dist/ for GitHub Pages
test/
  simulate.js      runs all-bot matches headlessly and prints balance stats
  human-client.js  scripted WebSocket player for integration testing
```

```bash
npm test                               # bot-only match simulation
node test/simulate.js 10 hard          # 10 matches on Hard
node test/human-client.js 3000 killer  # with the server running
```

Add `?norender` to the URL to run the client without drawing frames. It is
handy for automated browser tests.
