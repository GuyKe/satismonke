# Handover: Satismonke (for the session running on the Mac)

Branch: `claude/quirky-rubin-p6jo1g` (only commit so far builds on `Initial commit`). Pull it and continue there. No PR has been opened.

## What this is
A WebXR browser game: gorilla-tag locomotion inside a space capsule, wall screens, and a main menu operated with a laser pointer. Vite + TypeScript + Three.js. Built so far: milestones M1 (foundation) and M2 (locomotion), plus a small slice of M3-M5 (capsule, telemetry screen, menu).

## Get running
```
git fetch origin claude/quirky-rubin-p6jo1g && git checkout claude/quirky-rubin-p6jo1g
npm install
npm run dev            # http://localhost:5173 (desktop preview: drag to look, click menu)
npm run build          # runs tsc --noEmit then vite build
npm run test:physics   # assertion-based: lift/launch, no-legs, slip, arm-span scaling, tunnelling
```
Desktop XR emulation: open `http://localhost:5173/?emu`, then press Enter VR (uses Meta's IWER, installed as a devDependency).

Headset: WebXR needs HTTPS. Easiest from a Mac: `npx cloudflared tunnel --url http://localhost:5173` (or ngrok, or mkcert plus `vite --https`), then open the URL in Quest Browser.

## Layout
- `src/physics/CollisionWorld.ts`: distance-field collisions. Hull = cylinder along Z (r=3, segment half-length 3, rounded ends); solids = axis-aligned boxes. `sweep()` steps a sphere in r/2 increments so fast hands can't tunnel.
- `src/player/GorillaPlayer.ts`: locomotion, no WebXR dependency. Fed head/hand positions in rig-local space each frame; owns the rig position.
- `src/world/Capsule.ts`: hull meshes, ribs, props (each prop adds both a collider and a mesh), lights.
- `src/ui/`: `Screen` (canvas texture base), `TelemetryScreen`, `MenuConsole` (buttons hit-tested by UV), `LaserPointer`.
- `src/settings.ts`: gravity / jump multiplier / laser mode, persisted in localStorage.
- `src/main.ts`: renderer, XR session, rig, controllers, loop. `window.__game` exposes player/world/settings/menu for debugging.

## Game flow (src/game/Story.ts)
Menu shows only "Play" (laser or mouse). Press -> `alarm` (7 s: lights flash red, siren, rumble, ship shakes, panel flashes "THRUSTERS FAILED / DEPLOYING EMERGENCY / BRAKES") -> `crash` (0.4 s fade to black, synthesized crash) -> `dark` (2 s) -> `title` ("SATISMONKE" fades in 2 s, holds 1.5 s, fades out 2 s) -> `landing` (planet built, player teleported, 3.5 s fade in) -> `planet`.
Debug: `?skip=planet` jumps straight to the planet; `window.__game` has `story`, `planet` (set `planet.clock` to jump in time), `look(yaw, pitch)`.

## Controls and extra features
Quest Touch mapping (UNTESTED on hardware): right controller A = `gamepad.buttons[4]`, B = `buttons[5]`, grip/squeeze = `buttons[1]` on either hand. Desktop test keys: M = A, B = B, G = hold grip.
- A: opens/closes the map (planet only). `ui/MapMenu.ts`: top-down terrain render (re-sampled 4x/s, zoom -/+ and Close buttons via the laser, N = toward the lake) with landmarks, trees, live creature dots, the pod and a facing arrow. Floats 0.85 m in front of you and follows your head.
- B: only in the capsule after Play: `Story.skipToTitle()` fades quickly to black and goes straight to the SATISMONKE title (skips the crash and the dark gap; alarm and crash audio are cut via `Sfx.duck`). Does nothing on the planet or before Play.
- Chop: hold grip and punch a tree at >= 2.2 m/s (`hand.impact` from `GorillaPlayer`). `CollisionWorld` colliders carry an `owner` id (the tree index); `ownerAt(contact)` identifies it and `removeOwner` makes it non-solid. `Planet.fellTree` swaps the instanced tree for a temporary mesh that tips away from you over 1 s, lies there, and after 3 s total disappears and calls `onWood` (2-5 wood by height, +1 for pines). Wood count is shown on the left wrist (`ui/WoodHud.ts`) plus a floating "+N wood" toast; there is no use for wood yet (crafting is a natural next step). Sounds: chop, thump, pickup in `Sfx`.
- Creatures look away: each creature alternates 4-10 s watching you with 3-8 s looking elsewhere (`look.away`). Curious, defensive and friendly ones also lose interest while looking away and go back to wandering; shy and skittish ones still keep their distance.

## Bigger world, more water, more creatures, settings
- World: playable radius `WORLD_R` = 440 m (Planet.ts); trees, boulders, ores, crystals, mushrooms and creatures are spread across it (counts scale with graphics quality, see `QUALITY`). Grass now follows you (`regrowGrass`, hash-placed per 4 m cell so it does not shimmer; rebuilt every ~35 m of travel).
- Terrain (`Terrain.ts`): `WATER_Y` is now -4. `LAKES` (6, the big one still ahead of the landing site), 12 `PONDS`, 3 winding `RIVERS` (centre line x(z), carved into the heightfield) and ridged foothills that rise toward the edge (`ridge()`, grows beyond 200 m). 12 flat-topped land buttes (`buildMesas`, climbable). The terrain mesh is now fine (even rings out to 520 m, then wide rings); `buildTerrainMesh(map, quality)`.
- Creatures: 17 species / ~100 animals on medium. New ground: bulbhog (defensive), shellwalker (huge tortoise with a garden on its shell), spinner (rolls away), antlerback (lives in herds: followers steer to a `leader`). New air: moth (circles your campfires and lamps), wisp (only visible at night, `nocturnal`). New water (`water: true`, stay in lakes/rivers): glowfish (schools, leap out of the water) and sea serpent (2 in the big lake, roars). Voices in `Sfx.VOICES`. Creatures beyond `QUALITY.cull` metres are hidden and ground/water ones freeze.
- Settings (menu SETTINGS page, also in the pause menu): volume, laser always/auto (now actually used), graphics low/medium/high, reset arm span. Stored in `settings.ts`. Graphics changes the number of things generated, so it applies to the next planet you land on; a loaded save always rebuilds its world at the quality it was saved with (`PlanetState.quality`), because save indices only match that exact world.
- Saves are now version 2: saves from before this update no longer match the map and are ignored (they stay in localStorage but show as empty slots).
- Map: panel is 1.35 m wide, 4 zoom levels up to the whole world (4000 m across), also shows buttes. Perf note: medium on desktop measured ~120 draw calls / ~340k triangles at a high viewpoint; use LOW graphics on a Quest if the frame rate is poor.

## Floor fall-through fix (main menu)
Cause: the menu floor was a 0.6 m slab. The legless body and hands hang low, so when your head dropped suddenly (crouching, sitting, entering VR) the body or a hand ended up deeper than half the slab, and the push-out left through the nearest face: the BOTTOM. Fixes: (1) `CollisionWorld.pushOut(..., preferUp)`: a sphere whose centre is already inside something solid climbs straight up out of it (used for the head, body and hand sweeps); (2) floors are thick slabs (menu platform 20 m, capsule floor has an invisible thick collider under it); (3) the menu platform now has invisible walls and a ceiling (`addPlatformColliders`, faint cyan rail marks the edge) because hard launches at 0.3g could also fling you off the edge; (4) a respawn safety net in `main.ts` puts you back if you ever end up outside the world. `npm run test:fuzz` (`tests/fuzz.ts`) throws random hand and head motion, including sudden crouches, at the physics: before the fix 8-21 of 200 runs fell through a 0.6 m floor; now 0. `tests/fuzz.ts thin` uses the thin-floor worst case, `thin handsup` keeps the hands above the waist.

## Main menu, saving, pause, ores
- Boot: the page builds a throwaway planet, renders 7 pictures of it into render targets (`world/Snapshots.ts`: plains, lake, crystals, aerial, Saturn at dusk, night, spires) and disposes it. Those pictures feed the main-menu slideshow (`world/MenuRoom.ts`: cross-fading shader with a slow zoom, captions, on a dark platform under stars). `?skip=planet` skips all this and drops straight onto the planet (used by tests).
- `ui/MenuPanel.ts` is both the main menu (PLAY / CONTROLS / HOW TO PLAY; PLAY opens 3 save slots with NEW / LOAD / DEL, DEL needs a second click) and the in-game pause menu (RESUME, SAVE GAME, CONTROLS, HOW TO PLAY, SAVE & MAIN MENU). Help text lives in `ui/helpText.ts`.
- Pause: Y (left controller `buttons[5]`; the real Quest Menu button is reserved by the system and not readable) or Esc. The game is frozen while it is open (`simDt` = 0). "Save & main menu" saves, tears the game down (`resetGame`: planet disposed, progress reset, no page reload so the VR session stays alive) and returns to the main-menu room.
- Saves (`game/Save.ts`, localStorage `satismonke.save.0..2`, JSON ~1 KB): progress (`Progress.toJSON/load`), player position, play time, and `Planet.exportState/importState` (felled trees, broken boulders/crystals/ores, pod, hub pose, placed campfires/lamps, time of day). Gear effects are recomputed on load by `applyGear()`. Autosave every 45 s on the planet, on Save, and when leaving to the main menu. Choosing NEW creates a capsule-phase save immediately; loading a capsule-phase save restarts the pod sequence. Not saved: creature positions and mid-flight state.
- Ores (`Planet.buildOres`, `ORE_DEF`): copper (veins on the plains, 2 hits), iron (veins, 3 hits), gold (highest ground, 3 hits), plasma (glowing, only on top of the lake mesas, 4 hits). Pickaxe = one fewer hit; Iron Pickaxe = every ore in 1 hit, +1 ore and +2 stone. New resources show on the left wrist (two columns). New bench recipes: Iron Pickaxe, Copper Lantern, Ore Scanner (shows ore on the map), Plasma Core (0.2g). The bench now pages (6 recipes per page). Objectives continue: find ore -> iron pickaxe -> scanner -> plasma core.
- Debug hooks on `window.__game`: `beginGame(slot, 'new'|'load')`, `enterMainMenu(save)`, `saveGame()`, `togglePause()`, `appMode`, `mainPanel`, `camera`.

## Crafting, objectives and the Hub
- `game/Progress.ts` holds the inventory (wood, stone, steel), counters, crafted set, the recipe list (`RECIPES`) and `objective()` which returns the two short lines shown on the right wrist (what to do + how many resources are missing). Progress is in-memory only (not saved yet).
- Objective chain: destroy the crashed pod (grip + punch 5 hits, 8 steel) -> gather for the Hub (10 wood, 8 stone, 8 steel) -> X: craft the Hub -> aim and pull the trigger to place it (B cancels and refunds) -> use the bench -> craft a Stone Axe -> try the computer -> Lantern -> Power Gloves -> Float Core (needs crystals) -> build a Campfire.
- Resources: wood (trees), stone (boulders), steel (the pod), crystal (crystal spires). All gathered by gripping and punching (>= 2.0 m/s; trees 2.2, or 1.2 with the axe). Trees take 2 punches (`TREE_HITS`; they wobble and drop leaves on the first; punches are forgotten after 8 s), boulders 3, crystals 2, the pod 5. Stone Axe = trees in 1 hit, +1 wood; Stone Pickaxe = boulders and crystals in 1 hit, +1 stone.
- Recipes (`RECIPES` in `game/Progress.ts`). X menu (hands only): Hub, Campfire (placeable, repeatable), Stone Pickaxe. Hub bench (each shows its unlock condition while locked): Stone Axe, Lantern (20 wood collected), Power Gloves (5 boulders broken; jump 1.5, speed cap 10), Sticky Gloves (10 trees felled; `player.slipScale` 0.3 so ice grips), Float Core (4 crystals; planet gravity 0.35g), Crystal Gloves (needs Power Gloves + 8 crystals; jump 1.8, cap 12), Crystal Lamp (3 crystals; placeable, repeatable). Campfires and lamps are capped at `MAX_PLACED` (4 each) because each is a point light. Effects are applied in `craft()` in `main.ts`; none are saved.
- Placeables use the same aim-and-trigger flow as the Hub (`placing` in `main.ts`, meshes in `world/Props.ts`, `Planet.canPlaceProp` / `placeProp`, ticked in `Planet.update`). Hub, campfires and lamps show on the map.
- Hub (`world/Hub.ts`): short steel house with a roof, two long walls, open ends with three steps each, a crafting bench and a computer desk inside. It is aligned to your facing when placed, so it needs yawed boxes: `CollisionWorld.addBox(..., yaw)`. Layout constants and parts are at the top of `Hub.ts`; the ghost preview is the same mesh with one translucent material. `Planet.canPlaceHub` / `placeHub` do validation and building.
- Interactive screens share one interface (`mesh`, `hover(pointer, uv)`, `click(pointer)`): ship menu, map, crafting menu, bench panel (`ui/RecipePanel.ts`), computer (`ui/ComputerScreen.ts`: Pong, Snake, Whack and Random). `main.ts` casts both lasers against whatever is active (`LaserPointer.castMany`).
- HUDs (`ui/Hud.ts`): left wrist = resource counts, right wrist = objective; the desktop preview shows the same text top-right. Desktop keys: M map, X craft, B skip, G hold grip; click to use screens and place the Hub.
- Stone/steel/pod mechanics: collider `owner` ids (`POD_OWNER` = 100000, `BOULDER_OWNER` + index = 200000+, trees = their index). Hit thresholds: 2.0 m/s for boulders and the pod, 2.2 for trees (1.2 with the axe).

## Planet (src/world/Planet.ts, Terrain.ts, Animals.ts)
Layout follows a reference screenshot (wide open plains, tree clusters, winding sandy paths, boulders, a big lake with mesas and rock spires, small ponds, hazy mountains) in an alien pink/purple palette. To make it green, change the colours in `Terrain.ts` (`pink`, `violet`, the sand colour in the shader), the grass HSL range in `buildGrass`, and the tree palettes in `buildTrees`.
- Terrain: `heightAt(x, z)` in `Terrain.ts` = gentle sine-sum plains (flat within 8 m of the landing spot) minus a big lake basin (`LAKE`, centred 560 m toward -z, shoreline ~270 m away) and three ponds (`PONDS`). Visual mesh is a polar grid with rings that widen with distance; collision uses `CollisionWorld.heightFn`. Lakes are decorative (no swimming; you fall to the bed). Sandy paths/blotches come from `pathMask` which exists twice: TypeScript (used so grass, trees and boulders avoid paths) and GLSL (paints the ground). Keep the two identical when editing.
- Scatter: 10k short grass blades (0.15-0.45 m), ~18 tree clusters plus loners (mushroom-canopy trees and layered pines; trunks and canopies are colliders, at least 9 m apart), 70 boulders, 11 climbable crystal clusters, 10 floating rocks, 420 glowing mushrooms, fireflies at night, 6 flat-topped mesas and 4 mushroom-capped spires (flat-topped `addPillar` colliders), 34 distant snow-capped mountains (1500-2300 m out).
- `CollisionWorld`: ground plane, height function, boxes, spheres, vertical capsules, flat-top pillars; `finalize()` builds a 32 m spatial hash for spheres/cylinders/pillars (call it after adding colliders; `placePod` calls it again).
- Your pod: `Planet.placePod(headPos, forward)` puts a nose-down, half-buried escape pod (2.6 m x 1.7 m, scorched crater, smoke, flickering light, debris) 4.6 m BEHIND where you are facing at landing. `main.ts` takes the facing from the camera orientation. The pod has sphere colliders so you can push off it.
- Creatures (32, none collide with the player): ground = longneck, stilter, glow-worm, hopper, crawler; flying = jellyfish, manta, birds, buzzers. Built from primitives baked into vertex-coloured merged meshes (one body mesh, one glow mesh, one per animated limb).
  - Reactions (`Planet.updateAnimals`, driven by each creature's `mood`): all of them turn their head to you within 45 m. Curious (longneck, jellyfish): stop and study you at 6-22 m, back off if you get closer than 6. Shy (stilter): retreats within 28 m. Skittish (hopper, bird): flees within 14 m / 25 m. Defensive (crawler): turns to face you and holds within 18 m. Friendly (buzzer): flies over and circles you. Wary (worm, manta): carry on. Anything whose path you walk into (within 15 m, roughly in front) steers around you. Ground animals also steer round rocks, trunks and lakes using the collision world.
  - Roars: each creature roars at random every 14-42 s, and shortly after it first notices you (within 30 m). The head rears and the body swells while it roars. `Planet.onRoar` -> `Sfx.roar` (synthesized, 3D positioned with HRTF; each species has its own voice in `VOICES`). The audio listener follows your head each frame.
  - Animals beyond 220 m are hidden; far ground animals freeze.
- Saturn is the sun: 7 min of day above the horizon, 5 min of night below (`DAY_SECONDS`, `NIGHT_SECONDS`); sky/fog/light follow its height; stars, a moon and fireflies at night. Planet gravity is `PLANET_GRAVITY_G` (0.6) in `main.ts`; the cycle starts 40 s into the day.
- Perf: a desktop render measured ~110 draw calls and ~200k triangles. Probably heavy for a Quest 2; if frame rate is poor cut grass, mountains, boulders and animals first (constants in `Planet.ts`) and the terrain ring/segment counts in `Terrain.ts`.

## Audio (src/audio/Sfx.ts)
All sounds are synthesized with WebAudio (siren, rumble, crash, wind): no asset files. The AudioContext is created on first pointer press / XR session start; if audio is silent in the headset, check that.

## How locomotion works (so you can tune it)
1. If no hand held last frame: gravity (`gravityG` * 9.81) plus light drag, integrate.
2. Each hand sweeps from its last resolved position to rig + controller position. On contact the body moves by the push-out vector minus the hand's tangential motion (grip = 1).
3. Head sphere (r 0.14) and body sphere (r 0.25 at head xz, sitting on the floor) are pushed out of geometry.
   Torso: a sphere hangs 0.45 m under the head (`BODY_DROP`, `BODY_R`). There are no legs, so nothing lets you stand or walk; you rest on surfaces with your head ~0.7 m up and only hand pushes move you. No thumbstick locomotion exists by design.
   Slip: every collider has `slip` 0..1 (0 sticky, 1 ice). Hull 0.35; in `Capsule.ts` the `SLIP` table sets floor 0.05, bark crates/bar 0, ice block/bar 0.95, metal 0.4. Contact grip = 1 - slip, applied to the tangential part of hand motion only; the normal push-off is unaffected.
   Arm span: the menu no longer has a calibrate button. `ArmCalibration.observe` passively remembers the widest hand-to-hand distance seen (>1.1 m, capped 2.2 m) in `settings.armSpan`, so reach scales after you've spread your arms once (the manual 3 s countdown `start()` still exists but is unused), and scales hand offsets about the shoulders by `REF_SPAN (1.7) / armSpan` (clamped 0.6-1.6). Physics, hand spheres and the HUD all see the scaled hands.
4. Velocity is measured from actual displacement and kept for 6 frames. On the frame contact ends, velocity = average * `jumpMult`, capped at `maxSpeed` (8).
Knobs: `HAND_R`, `SKIN`, `BODY_R`, `HISTORY` in `GorillaPlayer.ts`; gravity/jump in the menu.

## Verified vs not verified
Verified (headless Chromium + node): build passes, page loads with no console errors, capsule/console/telemetry render, mouse hover highlights menu buttons, physics script shows push-down lifts the body, release launches, no tunnelling through a 2 cm bar.

NOT verified: anything on a real headset or under IWER. That includes controller tracking, the laser beam, trigger clicks (`selectstart`), haptics, hand sphere placement, and how the locomotion actually feels. Check these first.

## Things to watch for
- Head height: because of the legless torso, desktop preview and VR both sit ~0.7 m above the floor at rest. If that feels too low in a headset, reduce `BODY_DROP` in `GorillaPlayer.ts` (and the torso mesh offset in `main.ts`).
- Arm calibration is untested with real controllers; the 1.7 m reference span and the 0.25 m shoulder drop are guesses to tune.
- Hand detection: `main.ts` treats a controller as present only if `inputs[i]` is set and the grip position is non-zero. If hands never appear in a headset, look there first.
- Haptics use `gamepad.hapticActuators[0].pulse`; Quest Browser may expose it differently.
- The first frame after contact ends skips integration (one stalled frame); fine so far, revisit if launches feel hitched.
- Menu panel sits at z=-3.38 on a pedestal whose front face is z=-3.4. Don't tilt it or the top clips into the pedestal.
- Hull caps must be hemispheres. A full BackSide sphere puts a wall across the interior (this was a bug already fixed).
- Reported "height" on the telemetry screen is a rough floor-relative value, not exact.

## Suggested next steps
1. Test in headset / IWER; tune hand radius, jump multiplier, grip.
2. Snap/smooth turning on the thumbstick (the rig has no rotation yet; physics assumes rig yaw 0, so turning must rotate the local vectors fed to `update`).
3. Comfort vignette option; surface slipperiness (grip per collider).
4. M3: window with stars/planet at the front, more props. M4: map/clock/decorative screens. M6: time trial and banana collecting. M7: deploy to GitHub Pages.
