# server/kernel

The kernel: the deck, history, callers, the router, events, features and the three doors. In wave 0 it
holds only the interfaces, as types, so wave 1 can build against them on day one. Lexicon wrote them;
Keel owns the folder from wave 1 and writes what implements them.

## Owns

- `types.ts`: `Deck`, `DeckPath` and `toDeckPath`, `Revision`, `Entry`, `FileChange`, `CanvasDoc`,
  `Events`, `Context` (what a handler sees), `ItemKind`, `Kernel`, `Feature`, `defineFeature`, and
  `handle` and `handleAll` bound to `Context`.
- `memory-deck.ts`: a `Deck` kept in memory, for tests.
- Later (Keel): `deck.ts history.ts callers.ts router.ts events.ts feature.ts lockfile.ts doors/`.

## May import

`protocol/` through its entry, and node's own modules. Never a feature: the kernel names no feature;
only the server's entry file does.

## Rules

1. Every read and write of a deck goes through `Deck`; nothing else touches `node:fs`.
2. A path is a `DeckPath`, from the deck's root, checked once by `toDeckPath`: nothing outside the deck,
   no hidden part. A bad path is refused as `invalid` before it is used.
3. A write, a remove and a move are recorded (a `Revision` naming who and when) and announced to every
   watcher. A remove sends the file to the deck's trash (in `MemoryDeck` it is simply gone).
4. A read of nothing is refused as `not_found`; a write over a folder, or a move onto something, as
   `conflict`.
5. A handler sees `Context` only: the caller, the deck, a canvas, the events, and a way to add a note.
   It never sees a token and cannot tell Decks-local from Studio.
6. Code enters the server only as a `Feature`; its calls are handled with `handle` or `handleAll`, so a
   missing or mistyped handler does not compile.

## Check

```
npx tsc -p server/tsconfig.json
cd server && node --import tsx --test "kernel/*.test.ts"
```
