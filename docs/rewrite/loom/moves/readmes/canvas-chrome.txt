# canvas/chrome

The canvas's own controls: properties, insert menus, the pen and ink bars, callouts, colour picker.

## Owns

- `Properties.tsx`, `Insert.tsx`, `InsertMenu.tsx`, `PenBar.tsx`, `InkBar.tsx`, `Callout.tsx`, `ColorPicker.tsx`, `HoldMenu.tsx`, `AgentCursor.tsx`.
- `keycaps.ts`, `adaptive.ts`, `menu-place.ts`.

## May import

The rest of `canvas/`, `pen/`, `ui/`, `protocol/`.

## Rules

1. Markup and class names stay: the harness page, Studio and the checks select by them.

## Check

```
node tools/check.mjs canvas
```
