# Phasmophobia: fan remake (6 Tanglewood Drive)

A single-player ghost hunting game inspired by *Phasmophobia*, in **one HTML
file** (`index.html`) that runs in Chrome on a Chromebook. It has a main menu,
a lobby with contracts, difficulties and an equipment shop, and one map:
**6 Tanglewood Drive**, with its garage, basement and the van parked out front.

> Fan project. Not affiliated with or endorsed by Kinetic Games.
> "Phasmophobia" is a trademark of its owner. Every model, texture and sound is
> generated in code, so there are no asset files.

## Playing it

| How | What to do |
|---|---|
| GitHub Pages | After this is merged into the default branch, open `https://nickypeakin.github.io/dbd/phasmo/`. |
| Local server | `npm install && npm start`, then open <http://localhost:3000/phasmo/>. |
| Just the file | Download `index.html` and open it in Chrome. three.js then loads from a CDN, so you need to be online the first time. |

Click the game to capture the mouse. Your progress (money, level, equipment,
settings) is saved in the browser.

### Controls

| Key | Action |
|---|---|
| `W A S D` | Move (`Shift` sprint for about 3 s, `C` crouch) |
| Mouse | Look |
| `E` | Interact: doors, light switches, fuse box, closets, pick up items, take gear from the van rack |
| `F` | Flashlight on/off |
| `1` `2` `3` / `Q` / wheel | Select an inventory slot |
| Click | Use the held item: toggle it, take a photo, pour salt, light smudge, take pills |
| `R` / right-click | Turn a placed item on/off |
| `G` | Drop or place the held item (aim at the van rack to put it back) |
| `T` | Talk: ask spirit box questions, say the ghost's name |
| `J` | Journal: mark evidence, read about ghosts, choose your answer |
| `Esc` | Pause |

### How a contract goes

1. In the lobby, pick a difficulty and buy equipment with the money you've earned.
2. You start in the van. Take up to 3 items from the rack (`E`) and walk to the house.
3. Find the ghost room (it's cold, and things happen there), then collect evidence:
   EMF 5, Spirit Box, Ultraviolet fingerprints, Ghost Orbs, Ghost Writing,
   Freezing Temperatures and D.O.T.S.
4. Narrow it down in the journal (`J`), then click the ghost type you think it is.
5. Go back to the van and press the red button to leave. Correct answers,
   objectives, photos and the bone all pay out money and XP.

Sanity drains in the dark. Below the ghost's threshold (usually 50%) it can
**hunt**. During a hunt the lights flicker, the front door locks and
electronics glitch. Break line of sight and hide in a closet or locker with the door shut.
**Turn your flashlight off while hiding**, because ghosts sense active
electronics within 7.5 m.

## Architecture

All the code lives in one `<script type="module">`, split into sections that
share a few plain objects.

| Section | Responsibility |
|---|---|
| **BOOT** | Loads three.js from `../vendor/three` (npm start / Pages), falling back to jsDelivr, then unpkg. |
| **DATA** | The 7 evidence types, 24 ghost types (evidence, hunt thresholds, strengths and weaknesses), 12 items, 4 difficulties, objectives and spirit box phrases. |
| **AUDIO** | WebAudio synthesis: footsteps per floor surface, doors, switches, EMF beeps, spirit box static, whispers, singing, the hunt drone and screams. Sounds are positional, with a low-pass "occlusion" filter for other rooms. Spirit box answers use `speechSynthesis`. |
| **GFX** | Renderer, procedural canvas textures, patched Lambert materials, and the merged static geometry builder. |
| **WORLD (map engine)** | Room table, walls generated from lines with door/window/arch openings (each side gets its room's wallpaper), floors and stairs, furniture, closets, yard, the van. Also axis-aligned colliders, ray casts for line of sight and interaction, and the nav graph the ghost walks on. |
| **ITEMS (evidence system)** | Item models and behaviour: EMF levels from interaction sources, room temperatures, spirit box Q&A, writing pages, UV decals, night-vision render targets, D.O.T.S. dots, photo scoring, salt footprints, crucifix charges, smudge and pills. |
| **GHOST AI** | State machine: *idle/wander → interact → ghost event → hunt*. Interactions throw props, move doors, flip switches, trip the breaker and leave evidence. Hunts blink the model, chase by sight, electronics or voice, path through the nav graph and kill on contact. Each ghost type changes speed, threshold and behaviour (Revenant, Deogen, Hantu, Moroi, Thaye, Jinn, Mare, Shade, Yokai, Raiju, Obake, Twins, Mimic…). |
| **PLAYER** | Pointer-lock mouse look, WASD with sprint stamina and crouch, circle-vs-box collision, stairs, the flashlight, 3 inventory slots and the crosshair interaction ray. |
| **GAME (contract)** | Setup timer, sanity drain, temperatures, the EMF source list, light flicker, objectives, photos, hunt start and end (door lock), death, and rewards. |
| **UI / HUD** | Title, lobby (whiteboard, contract monitor, equipment clipboard), HUD, journal, pause, settings, results. |
| **MAIN LOOP** | `requestAnimationFrame` with `dt` capped at 50 ms, auto resolution scaling, render passes. |

## Why Three.js (3D) rather than Phaser (2D)

Phaser or a 2D canvas would run on anything, but the genre depends on
first-person darkness, a flashlight cone, line of sight and hiding behind
doors. A raycaster or 2.5D fake loses most of that. A small **low-poly Three.js
scene** runs comfortably on Chromebook GPUs as long as it stays inside a few
limits:

- **One real light.** Only the flashlight is a three.js `SpotLight` (with an
  optional 512 px shadow map). Every room light, the moon, porch and street
  lamps, the camera flash, night vision and the UV light are computed in a
  small shader snippet patched into the Lambert material. Each room is an
  axis-aligned box in a uniform array, so switching lights or flickering them
  never recompiles shaders.
- **Few draw calls.** All static geometry (walls, floors, furniture, yard, van)
  is merged into one mesh per material. With doors, switches and throwable
  props on top of that, a typical frame is about 30–150 draw calls.
- **Low resolution on purpose.** The canvas renders at 40–100% of the window
  size and is upscaled with `image-rendering: pixelated` for the PS1 look.
  *Auto* mode lowers the scale whenever the frame rate drops below about 48 fps.
- **Tiny textures.** 64×64 canvas-generated textures with nearest filtering.
- **Cheap extras.** Night-vision feeds render to 176×132 / 224×126 targets every
  2–3 frames. The HUD only touches the DOM when its text changes.
- **Optional PS1 effects.** 15-bit ordered dithering (on by default) and vertex
  wobble (off by default).

If a Chromebook still struggles: Settings → Resolution 50% and Flashlight
shadows Off.

## Differences from the real game

Single player only, with no voice chat: questions are asked with the `T` menu.
There's one map, no cursed possessions, and no motion, sound or parabolic
equipment. Ghost behaviours are simplified versions of each type's main trait.

## Testing hooks

Open `index.html?debug` to expose the internals as `window.PHASMO` in the
console. `?debug&ghost=demon` forces a ghost type, which is useful for trying
out a specific behaviour.
