# Decks's adaptive colours

Each is a variable with a light and a dark value (`@decks/pen`, `packages/pen/src/colors.ts`), named
`decks-<role>[-<variant>]` in five roles: text, line, surface, fill, accent. Write
`fill: "$decks-text"`; every edit defines any `$decks-*` it uses that the canvas lacks, and a canvas's
own value of one is kept. A rectangle, an ellipse, an icon, an empty frame or an arrow inserted at the
top level with no colour gets these too.

| colour | for | light | dark |
|---|---|---|---|
| `$decks-text` | words, icons, a shape's label | `#1f2328` | `#e6e6e6` |
| `$decks-text-muted` | quieter words, captions | `#6b7280` | `#a3a3a3` |
| `$decks-line` | arrows, connectors | `#8a8f98` | `#9ba1a9` |
| `$decks-line-strong` | a dark line: a library shape's outline | `#1f2328` | `#d4d4d4` |
| `$decks-line-subtle` | a frame's or card's edge, dividers | `#d0d7de` | `#ffffff29` |
| `$decks-surface` | paper: a frame, a card, a library shape | `#ffffff` | `#2e2e2e` |
| `$decks-fill-slate` | a box's fill | `#dbe4f0` | `#34404f` |
| `$decks-fill-sky` | a second fill: circles, a highlight | `#c7ddf7` | `#2b4766` |
| `$decks-fill-gray` | background areas, lanes | `#e5e7eb` | `#3a3d42` |
| `$decks-fill-red` | a soft fill: a risk, a no | `#fecaca` | `#5a2626` |
| `$decks-fill-orange` | a soft fill | `#fed7aa` | `#5a3517` |
| `$decks-fill-yellow` | a soft fill: a note-like area, a highlight band | `#fde68a` | `#4a3f14` |
| `$decks-fill-green` | a soft fill: a yes, done | `#bbf7d0` | `#1f4730` |
| `$decks-fill-blue` | a soft fill: a group, a step | `#bfdbfe` | `#1e3a5f` |
| `$decks-fill-purple` | a soft fill | `#e9d5ff` | `#3f2d5c` |
| `$decks-accent-red` | an accent: a warning, a no | `#e5484d` | `#ff6369` |
| `$decks-accent-orange` | an accent | `#f97316` | `#fb923c` |
| `$decks-accent-yellow` | an accent: a caution, a highlight | `#f2b200` | `#ffc53d` |
| `$decks-accent-green` | an accent: done, a yes | `#2f9e62` | `#3dd68c` |
| `$decks-accent-blue` | an accent: a link, a step | `#3b82f6` | `#60a5fa` |
| `$decks-accent-purple` | an accent | `#8b5cf6` | `#a78bfa` |

The old names (`$decks-ink`, `$decks-shape`, `$decks-frame`, `$decks-red`, …) still work and show as
their new colour; write the new ones.

## A colour of your own

Give it a light and a dark value once, then use `"$brand"` everywhere:

```sh
decks canvas variables '{"brand":{"light":"#4f46e5","dark":"#818cf8"}}'
```

The dark value is keyed to the canvas's own light/dark axis. A plain `"#hex"` does not change with
the scheme: use one only for a colour that must not change (a brand mark, a photo's backdrop, a
sticky note's paper).
