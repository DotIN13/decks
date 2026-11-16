# protocol

What every program agrees on: the calls, the events, the shapes they carry, the deck's layout and the
messages a server and Studio exchange. Package `@decks/protocol`. Only Lexicon edits it.

## Owns

- `schema.ts`: the schema builders (`str`, `obj`, `opt`, `arr`, ...). A shape is plain data the generators
  walk, and it carries its TypeScript type: `Infer<typeof Shape>`. `validate.ts` checks a value against one.
- `shapes.ts`: the named shapes (Box, Size, Point, Item, Card, Canvas, Agent, App, Message, View, ...).
- `call.ts`: `defineCall`, `Caller`, the five refusal codes, the envelope, `handlersFor`.
- `event.ts`: `defineEvent`. `events.ts`: every event.
- `calls/<noun>.ts`: every call, one file per noun; `calls/index.ts` lists them all.
- `glossary.ts`: the nouns, the shared verbs, and `retired`, the words the names gate refuses.
- `layout.ts`: the deck folder's layout and path rules. `deck-files.ts`: a card's meta tag and the deck's
  import map, read one way. `sync.ts`: what a server and Studio exchange.
- `version.ts`: the protocol's version.

## May import

Nothing outside this folder: no node, no packages. `tsconfig.json` gives the code no node types; only the
tests (`tsconfig.test.json`) have them.

## Rules

1. A call is declared once, here, and handled once, in one feature, through `handlersFor<Ctx>()`. A missing
   handler, or one whose arguments or answer differ from the declaration, does not compile.
2. A name is `noun.verb`, the noun from the glossary. The shared verbs (`list get create update delete move
   copy`) mean the same on every noun; an item's verbs are pen.dev's ops.
3. Arguments are one object keyed by name: the thing, the change, then options. `canvas` is an option and
   defaults to the caller's here, except where the canvas is the thing itself.
4. A change answers the thing as it now is; a delete answers `{ deleted }`; a list answers a list. Notes
   ride beside the value in the envelope `{ ok, value, notes }` or `{ ok: false, error, notes }`.
5. A refusal is `{ code, message, hint }`, the code one of `invalid not_found refused conflict unavailable`.
6. An event is `noun.verbed` with `{ canvas?, ids, by, rev }` and a few small fields. A snapshot is a call.
7. One geometry: `Box { x1, y1, x2, y2 }`, `Size { w, h }`, `Point { x, y }`. A path starts at the deck's root.
8. Calls on `chat`, `account` and `runtime` are answered by the harness, for the person; all others by the server.
9. Within a major version calls, events and optional fields are only added.
10. A card imports only from the deck's `assets/`, never from outside it or a hidden folder (`deck-files.ts`).

`grammar.test.ts` holds rules 2 to 8 over every declared call and event. `docs/rewrite/calls.md` is the table
of every old name and what it became; `node tools/gen/table.ts` proves it whole.

## Check

```
npx tsc -p protocol/tsconfig.json && npx tsc -p protocol/tsconfig.test.json
cd protocol && node --import tsx --test "**/*.test.ts"
```
