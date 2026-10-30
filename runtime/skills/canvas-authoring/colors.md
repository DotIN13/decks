# Decks's adaptive colours

Each is a variable with a light and a dark value (`@decks/pen`, `packages/pen/src/colors.ts`). Write
`fill: "$decks-ink"`; every edit defines any `$decks-*` it uses that the canvas lacks, and a canvas's
own value of one is kept. A rectangle, an ellipse, an icon, an empty frame or an arrow inserted at the
top level with no colour gets these too.

| colour | for | light | dark |
|---|---|---|---|
| `$decks-ink` | words, icons, a shape's label, a dark line | `#1f2328` | `#e6e6e6` |
| `$decks-muted` | quieter words, captions | `#6b7280` | `#a3a3a3` |
| `$decks-line` | arrows, connectors, rules | `#8a8f98` | `#9ba1a9` |
| `$decks-shape` | a box's fill | `#dbe4f0` | `#34404f` |
| `$decks-shape-2` | a second fill: circles, a highlight | `#c7ddf7` | `#2b4766` |
| `$decks-frame` | a frame's paper | `#ffffff` | `#2b2b2b` |
| `$decks-frame-line` | a frame's edge | `#d0d7de` | `#ffffff29` |
| `$decks-figure` | a library shape's fill | `#ffffff` | `#2e2e2e` |
| `$decks-figure-line` | a library shape's outline | `#1f2328` | `#d4d4d4` |
| `$decks-card` | a file card's paper | `#ffffff` | `#2e2e2e` |
| `$decks-card-line` | a file card's edge | `#0000001f` | `#ffffff24` |
| `$decks-red` | an accent: a warning, a no | `#e5484d` | `#ff6369` |
| `$decks-blue` | an accent: a link, a step | `#3b82f6` | `#60a5fa` |
| `$decks-green` | an accent: done, a yes | `#2f9e62` | `#3dd68c` |
| `$decks-yellow` | an accent: a caution, a highlight | `#f2b200` | `#ffc53d` |
| `$decks-orange` | an accent | `#f97316` | `#fb923c` |
| `$decks-purple` | an accent | `#8b5cf6` | `#a78bfa` |
| `$decks-yellow-fill` | a soft fill: a note-like area, a highlight band | `#fde68a` | `#4a3f14` |
| `$decks-orange-fill` | a soft fill | `#fed7aa` | `#5a3517` |
| `$decks-red-fill` | a soft fill: a risk, a no | `#fecaca` | `#5a2626` |
| `$decks-purple-fill` | a soft fill | `#e9d5ff` | `#3f2d5c` |
| `$decks-blue-fill` | a soft fill: a group, a step | `#bfdbfe` | `#1e3a5f` |
| `$decks-green-fill` | a soft fill: a yes, done | `#bbf7d0` | `#1f4730` |
| `$decks-gray-fill` | a soft fill: background areas, lanes | `#e5e7eb` | `#3a3d42` |

## A colour of your own

Define it once with both values, then use `"$brand"` everywhere:

```ts
await decks.canvas.variables({
  brand: { type: "color", value: [{ value: "#4f46e5" }, { value: "#818cf8", theme: { mode: "dark" } }] },
}, { themes: { mode: ["light", "dark"] } });
```

Key the dark value to the canvas's own light/dark axis when `read()` shows one in `themes` (an older
canvas has `Mode: ["Light", "Dark"]`: then `theme: { Mode: "Dark" }` and no `themes`). A hex does not
change with the scheme: use one only for a colour that must not change (a brand mark, a photo's
backdrop, a sticky note's paper).
