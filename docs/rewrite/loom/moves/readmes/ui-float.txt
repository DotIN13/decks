# ui/float

Floating panels: where a panel rests, how a drag or a throw moves it, and where it is kept.

## Owns

- `float.ts`: `makeFloat`, a panel that floats.
- `float-math.ts`: where a panel settles and what it avoids, as pure maths, tested.

## May import

The rest of `ui/`, and `protocol/` at most.

## Rules

1. The maths takes sizes and returns places; it touches no DOM.
2. A panel thrown hard enough tucks away; a drop snaps home or to an edge.

## Check

```
node tools/check.mjs ui
```
