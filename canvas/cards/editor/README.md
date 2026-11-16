# canvas/cards/editor

The parts of the card editor (`../CardEditor.tsx`), where a person types a card's words in place
and they are written back as its markdown.

## Owns

- `ctx.ts`: `EditorCtx`, the one state the parts share: the props, the elements, what the editor
  remembers between events, and each part's functions bound to it.
- `model.ts`: the pieces a card's markdown becomes, and reading it in block by block.
  `inline.ts`: a block's inline runs. `tables.ts`: what typing turns into a style or a block, and
  each style the bar puts on.
- `selection.ts`: the page's selection, the block the caret is in, placing the caret.
- `markup.ts`: the page written back as markdown. `style.ts`: styling what is selected, the block
  the caret is in, and the selection cut into runs.
- `view.tsx`: the markup, the style bar and its menus, the drop marks.
- `actions.ts`: typing, undo, pasting, clicks, committing. `actions-press.ts`: what mounting
  wires, dragging a piece, the keys.

## May import

The rest of `canvas/`, `ui/`, `protocol/`, and today's `marked` and icons.

## Rules

1. `CardEditor` keeps its props and builds the state; each part takes it as `cx`, first.
2. A part calls another's function through `cx` (`cx.showBar()`), so no part needs the state
   passed by hand; a function that touches no state is a plain export.
3. A block not touched is written back exactly as it was read (`data-raw`).
4. Markup and class names are today's: the browser checks and the styles hold them.

## Check

`node tools/check.mjs canvas`; browser checks card-editor, card-keys, card-copy, card-tab,
card-links, edits-wait and placement, each with `node tools/checks/run.mjs <check>`.
