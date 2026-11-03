# Styling: one canvas surface, a kit per app

The canvas is shared by the Decks app (the harness) and Decks Studio, and each themes it; the tools
around it are each app's own.

**The surface** (`@decks/canvas`, `packages/canvas/styles/`, entry `surface.css`, built to
`dist/surface.css`): the stage and the world, card slots and their title bars, the hidden selection
elements the engine paints over, the media player, the card editor, live ink and the lasso, an agent's
edit marks and cursors. It sits in `@layer decks.surface`, under an app's own sheets, and reads only
the `--canvas-*` tokens of `surface-tokens.css` (colours, type, corners, the floating layer). What the
engine paints (the drawing, card pictures, outlines and handles) has no CSS: it reads `--canvas-accent`
and `--canvas-panel` and the light or dark scheme. A card's own content keeps its `--b-*` tokens.

**Theming it.** An app sets the `--canvas-*` tokens on `.stage` or `.decks-canvas`; the Decks app maps
its own tokens onto them at the end of `apps/web/src/styles/tokens.css`. An app's sheets may name only
the surface's hooks (`styles/surface-hooks.json`: `.decks-canvas`, `.stage`, `.stage-fixed`), never its
other classes; `npm run gates` checks both rules (`scripts/surface-gate.mjs`).

**The kit** is each app's. The Decks app's is in `apps/web/src/styles/`: the controls (`kit/chrome.css`),
the pill and the hold menu (`kit/callout.css`), the tool column (`kit/tools.css`), the ink tray
(`kit/ink-tray.css`), the comment box (`kit/comment.css`), the properties panel (`kit/properties.css`),
the conversation (`stream.css`, `markdown.css`). The components that draw these (`@decks/canvas/src/ui`,
`@decks/agent-ui`) ship markup and behaviour, no stylesheet; Studio styles the parts it shows in its own
`@studio/ui`.

**Checking a change to the look**: `LOOK_SHOTS=<dir> npm run test:e2e -- look-shots` pictures the
canvas and its kit in light and dark (and an iPad's hold menu); take a set before and after and compare.
