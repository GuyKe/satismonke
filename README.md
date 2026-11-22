# Satismonke

A WebXR browser game: gorilla-tag style locomotion inside a space capsule, with wall screens and a laser-pointer main menu.

## Run
```
npm install
npm run dev        # serves over the LAN; WebXR needs HTTPS on a headset (use a tunnel or deploy)
npm run build
npm run test:physics
```
- Desktop preview: open the page, drag to look, click menu buttons with the mouse.
- Desktop XR emulation: add `?emu` to the URL (uses Meta's IWER), then press Enter VR.
- Headset: open the HTTPS URL in Quest Browser and press Enter VR.

## Controls
- No joystick or legs: only your hands move you. Sticky surfaces (orange crates) grip, ice (blue) slides.
- Press Play on the console. Reach scales to your arm span automatically once you have spread your arms wide.
- Push, swipe and swing your hands against surfaces to move. Release to launch.
- Menu (console at the front of the capsule): point a controller at it, pull the trigger on Play.
- On the planet: A opens the map. Hold grip and punch a tree to fell it for wood. In the capsule after Play, B skips to the title.
- X opens crafting. Follow the objective on your right wrist: smash your pod, gather wood and stone, craft the Hub and place it, then use its bench and computer.
- Desktop test keys: M = A, X = X, B = B, G (hold) = grip.
- Debug: add `?skip=planet` to jump to the planet.

## Layout
- `src/physics/CollisionWorld.ts` – distance-field collisions (capsule hull + boxes), swept spheres
- `src/player/GorillaPlayer.ts` – locomotion (WebXR-independent, tested in `tests/`)
- `src/world/Capsule.ts` – hull, props, lights
- `src/ui/` – canvas-texture screens, menu console, laser pointer
