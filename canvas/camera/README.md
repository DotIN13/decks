# canvas/camera

Where the canvas looks: the camera, glides, insets, landing on a canvas, agents' views, touch and zoom keys.

## Owns

- `camera.ts`, `controller.ts`, `coords.ts`: the camera and who moves it.
- `spring.ts`, `landing-camera.ts` (where the camera lands), `landing.ts`: motion and arriving.
- `agent-view.ts` (what a view remembers), `agent-view-store.ts` (where views are kept).
- `view-calls.ts`: the view calls a screen answers (`view.focus`, `view.goto`, ...).
- `insets.ts`, `scroll-area.ts`, `touch.ts`, `hands-on.ts` (when a hand last touched the canvas), `zoom-keys.ts`.

## May import

The rest of `canvas/`, `protocol/`.

## Rules

1. No frame of a gesture waits on the main thread's other work.
2. The settled camera is the only one that readers outside a gesture see.

## Check

```
node tools/check.mjs canvas
```
