# harness/page/camera

The page's side of the canvas camera: where the person is looking, where the camera lands when a
canvas opens, and the view calls other callers make of this screen.

## Owns

- `report.ts`: tells the server where the person looks (`view.move`), a reading after each gesture.
- `landing.ts`: where the camera lands on opening a canvas, and when a person's move calls it off.
- `remember-view.ts`: a view kept on this device for an agent not on screen.
- `view-call.ts`: a `view.requested` event as the call the canvas host runs; `view-requests.ts` answers it.
- `links.ts`: flying the camera to cards, and following a link from one card to another.

## May import

The page's `state/`, `connections/` and `lib/`; `@decks/canvas` and `@decks/protocol` by name.

## Rules

1. The camera itself is the canvas frame's: this folder asks it to move and reports where it is, never draws.
2. A move the person makes wins over one still on its way (a landing, an agent's focus).

## Check

`node tools/check.mjs harness/page`
