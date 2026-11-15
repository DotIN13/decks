# canvas/input

Pointer, wheel, touch and keys, before they mean an edit.

## Owns

- `canvas-input.ts`: wheel, pinch and the canvas's keys.
- `pointer.ts`: presses, hovers and drags on the drawing.
- `keys.ts`, `item-keys.ts`: keys for the editor, and keys that stay inside an item.
- `touch-rules.ts`: what a finger does on each device.

## May import

The rest of `canvas/`, `pen/`, `protocol/`.

## Rules

1. Every finger on the canvas is the canvas's own.
2. A key from inside an item stays in it until Escape.

## Check

```
node tools/check.mjs canvas
```
