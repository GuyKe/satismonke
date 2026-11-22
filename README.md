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
- Push, swipe and swing your hands against surfaces to move. Release to launch.
- Menu (console at the front of the capsule): point a controller at it, pull the trigger.

## Layout
- `src/physics/CollisionWorld.ts` – distance-field collisions (capsule hull + boxes), swept spheres
- `src/player/GorillaPlayer.ts` – locomotion (WebXR-independent, tested in `tests/`)
- `src/world/Capsule.ts` – hull, props, lights
- `src/ui/` – canvas-texture screens, menu console, laser pointer
