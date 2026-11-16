# protocol/compat

The calls before the rewrite and how each becomes its new one, imported as `@decks/protocol/compat`
and kept out of the protocol's index: the SDK and the main surface carry no old names.

## Owns

- `old-calls.ts`: every old call (`OLD_CALLS`), the dropped ones (`DROPPED`), `turn` (an old name and
  its arguments as the new call), `keyed`, `withEdit`, `answerBack`, `cardCall`, a card's call
  read as old or new, and `programCall`, the same for the decks command, the SDK and the MCP relay.

## May import

The rest of `protocol/`, nothing outside it.

## Rules

1. Old card shapes carry no date: a card in a deck is the person's file, and its old calls answer
   forever. So do a deck's scripts and an agent's words through the decks command, the SDK and MCP. Compat's line applies its `GOES` date to programs only, passing it to `turn`.
2. A card's call is old or new by shape: a list is an old call; one object is the new call when its
   schema takes it, else the old call of that name. An old `canvas.delete`, `canvas.copy` or
   `canvas.update` acts on an item and never on a canvas.
3. A card makes only the calls a card may (`who` includes `card`), and with its canvas given, only on
   it, whichever shape it uses.
4. Where an old and a new call take the same arguments, a card's answer carries both shapes' fields
   (view.move adds x, y, zoom; view.focus adds target); where the two answers cannot be one
   (view.reload), a card gets the old answer ({ reloaded: n }), so the card docs stay true. The shape
   the card called in decides which it is, not its arguments.
5. The retired words live here as old names only; nothing outside a `compat` folder uses them.

## Check

```
node tools/check.mjs protocol
```
