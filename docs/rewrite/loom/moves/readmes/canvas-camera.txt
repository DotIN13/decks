# canvas/camera

Where the canvas looks: the camera, glides, insets, landing on a canvas, agents' views, touch and zoom keys.

## Owns

- `camera.ts`, `controller.ts`, `coords.ts`: the camera and who moves it.
- `glide.ts`, `spring.ts`, `land.ts`, `landing.ts`: motion and arriving.
- `agent-view.ts`, `agent-views.ts`: each agent's own view.
- `view-calls.ts`: the view calls a screen answers (`view.focus`, `view.goto`, ...).
- `insets.ts`, `scroll-area.ts`, `touch.ts`, `touched.ts`, `zoom-keys.ts`.

## May import

The rest of `canvas/`, `protocol/`.

## Rules

1. No frame of a gesture waits on the main thread's other work.
2. The settled camera is the only one that readers outside a gesture see.

## Check

```
node tools/check.mjs canvas
```
