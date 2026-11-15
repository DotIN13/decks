# ui

Controls that know nothing of Decks: icons, the popover and the layer it opens in, floating panels,
agent marks, time and label helpers. Today's `packages/ui`, moved.

## Owns

- `index.ts`: the entry, `@decks/ui`; `float/float.ts` (`@decks/ui/float`) and `agent-marks.tsx`
  (`@decks/ui/agent-marks`) are its other two doors.
- `Popover.tsx`, `portal.ts`, `dismiss.ts`: a popover and how it closes.
- `float/`: panels that float, snap and tuck away.
- `icons.tsx`, `scribble.tsx`, `agent-marks.tsx`, `time.ts`, `labels.ts`, `velocity.ts`, `css.ts`.

## May import

`protocol/` at most (`agent-marks.tsx` reads `AgentKind`).

## Rules

1. A control takes what it shows as arguments; it never reaches a deck, a canvas or a server.
2. Markup and class names stay as they are: the harness page, Studio and the browser checks select
   by them.

## Check

```
node tools/check.mjs ui
node tools/check.mjs harness
```
