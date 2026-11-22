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

## How locomotion works (so you can tune it)
1. If no hand held last frame: gravity (`gravityG` * 9.81) plus light drag, integrate.
2. Each hand sweeps from its last resolved position to rig + controller position. On contact the body moves by the push-out vector minus the hand's tangential motion (grip = 1).
3. Head sphere (r 0.14) and body sphere (r 0.25 at head xz, sitting on the floor) are pushed out of geometry.
   Torso: a sphere hangs 0.45 m under the head (`BODY_DROP`, `BODY_R`). There are no legs, so nothing lets you stand or walk; you rest on surfaces with your head ~0.7 m up and only hand pushes move you. No thumbstick locomotion exists by design.
   Slip: every collider has `slip` 0..1 (0 sticky, 1 ice). Hull 0.35; in `Capsule.ts` the `SLIP` table sets floor 0.05, bark crates/bar 0, ice block/bar 0.95, metal 0.4. Contact grip = 1 - slip, applied to the tangential part of hand motion only; the normal push-off is unaffected.
   Arm span: `ArmCalibration` measures the widest hand-to-hand distance (arms outstretched) via the menu's "Calibrate arms" button (3 s countdown, 2 s sampling), stores it in `settings.armSpan`, and scales hand offsets about the shoulders by `REF_SPAN (1.7) / armSpan` (clamped 0.6-1.6). Physics, hand spheres and the HUD all see the scaled hands.
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
