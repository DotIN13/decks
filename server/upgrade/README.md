# server/upgrade

Old decks brought up to date when the server opens them, before any feature starts.

## Owns

- `migrations.ts`: today's numbered migrations, in order, each a function of the deck.
- `version.ts`: the deck's version in `.decks/migrations.json`, read and written as today.
- `feature.ts`: its one export, with `upgrade(deck)`.

## May import

The kernel and the protocol through their entries, and today's `@decks/pen` to read drawings.

## Rules

1. Every read and write goes through the `Deck`, so every change is a revision by `upgrade`.
2. A deck runs only the migrations after its version, oldest first, then records the new one.
   A deck already up to date reads one file and writes none. A new, empty deck runs none.
3. A migration is idempotent: run twice, the second run changes nothing.
4. A migration that fails stops the upgrade there; the version stays at the last that worked,
   and the server says which one failed.
5. Old words live here: a migration reads boards and stages, because old decks hold them.

## Check

```
node tools/check.mjs server
node --import tsx --test server/upgrade/*.test.ts
```
