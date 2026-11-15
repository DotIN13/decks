# canvas/editor

The TypeScript editor: gestures, ops, overlays, snapping and text editing.

## Owns

- `editor.tsx`, `index.ts`: the editor assembled.
- `core/`: the editor with no page under it (gesture, ops, overlay, pick, resize, snapping, text, arrows), unit-tested.
- `dom/`: its page side: controller, effects, the overlay layer, text editing.
- `snap.ts`, `held.ts`, `pen-tools.ts`, `scene-ts.ts`.

## May import

The rest of `canvas/`, `pen/`, `ui/`, `protocol/`.

## Rules

1. `core/` imports no DOM, no Solid and no engine (its `imports.test.ts`).
2. The person chose today's TypeScript editor, not the editor-remodel branch.

## Check

```
node tools/check.mjs canvas
```
