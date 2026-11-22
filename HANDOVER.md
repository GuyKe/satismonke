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

## Crafting, objectives and the Hub
- `game/Progress.ts` holds the inventory (wood, stone, steel), counters, crafted set, the recipe list (`RECIPES`) and `objective()` which returns the two short lines shown on the right wrist (what to do + how many resources are missing). Progress is in-memory only (not saved yet).
- Objective chain: destroy the crashed pod (grip + punch 5 hits, gives 8 steel) -> gather for the Hub (10 wood, 8 stone, 8 steel; stone comes from boulders, 3 grip-punches each) -> press X and craft the Hub -> aim the right controller at the ground and pull the trigger to place it (green = ok, red = water/steep/tree/boulder/too close) -> use the bench -> craft a Stone Axe -> try the computer -> unlock + craft the Lantern (collect 20 wood) -> unlock + craft Power Gloves (break 5 boulders).
- X (left controller, `buttons[4]`) opens the crafting menu, which only holds the Hub for now (`where: 'x'` recipes). The Hub bench holds the rest (`where: 'bench'`), each with an unlock condition shown while locked. Add recipes in `RECIPES`; `craft()` in `main.ts` applies effects (axe: weaker punches + 1 extra wood; lantern: PointLight on the camera; gloves: `player.jumpMult` 1.5, `maxSpeed` 10).
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
