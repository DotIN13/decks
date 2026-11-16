# harness/page/shell

The page's frame: what lays the areas out and wires them once, and the chrome that belongs to no
other area (the bars over the canvas, the dock and floats, the keys, the viewport, notices).

## Owns

- `view.tsx`: each area in its place. `actions.ts`: `createPage`, the wiring, made once.
- `TopBar.tsx`, `TopRight.tsx`, `more-menu.ts`: the bars over the canvas and the ⋯ menu.
- `dock.ts`, `floats.ts`: the composer and the conversation as floats, and the tab of a put-away one.
- `keys.ts`, `viewport.ts`, `tooltip.ts`, `presenting.ts`: the page's keys, its visual viewport, tooltips, Present.
- `NoticeStrip.tsx`, `ConfirmDialog.tsx`, `ContextRing.tsx`, `PictureProgress.tsx`: what the shell shows itself.
- The v3 sheets and the tokens, imported by `../index.css` in their cascade order.

## May import

Every part of the page through its `index.ts` or its entry file; `@decks/canvas`, `@decks/ui` by name.

## Rules

1. Only what belongs to no other area lives here: a thing with an area (agents, canvases, the panel,
   the composer, the camera) goes to that area, not to the shell.
2. The shell holds no data: stores are in `state/`.

## Check

`node tools/check.mjs harness/page`
