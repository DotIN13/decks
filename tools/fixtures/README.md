# tools/fixtures

The files Decks-local, Studio and the iPad app are all tested on. Few and plain on purpose.

## Owns

- `deck/`: a small deck, copied from today's `e2e/fixture/decks`. One canvas with five cards,
  a document, a PDF, a picture, and a friend's shared canvas that still holds an old board (for
  the upgrade code to read).
- `drawings/`: six drawings, each `<name>.pen` with `<name>.layout.json` beside it: every item's
  box, parent and paint order as today's `packages/pen` lays it out, in the light theme.
  notes-and-text, flex-frames (gap, padding, fill, alignment, clipping), nested-groups, refs
  (a reusable item and two instances, one overridden), arrows (an elbow joining two boxes),
  themed (a variable with a dark value, and a frame in the dark theme).
- `layouts.mjs`: writes or compares the expected layouts.

## May import

`packages/pen` (today's file format), and only to write the expected layouts.

## Rules

- Text is measured by pen's `estimateText`, so a client can match a layout without a font.
- A change to pen that moves any box fails the compare; write the layouts again only on purpose,
  and say why in the commit.
- Fixtures are data: the gates do not count their words or sizes.
- Add a drawing only for a case no other drawing covers.

## Check

- `node --import tsx tools/fixtures/layouts.mjs`: compare (exit 1 naming what moved).
- `node --import tsx tools/fixtures/layouts.mjs --write`: write them again.
- `node tools/check.mjs tools` runs the compare as a test.
