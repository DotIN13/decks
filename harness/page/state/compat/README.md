# harness/page/state/compat

Today's socket messages, heard on the page's line and applied as today's page applied them. It goes
with the server's compat after stop 3.

## Owns

- `socket.ts`: `hearOld`, which hears what arrives on the page's line that is not a new event.
- `apply.ts`: `applyOld`, the old agent and chat messages applied to the page's state.

## May import

The page's `state/` modules, and `@decks-next/protocol`.

## Rules

1. Only today's browser checks send these: they dispatch today's messages on the page's socket.
2. An old agent list is the whole list: while one has been told, its rows are drawn alone.
3. A message the page never drew from is left alone.
4. Nothing outside `shell/actions.ts` calls it, so deleting this folder is one import.

## Check

`node tools/check.mjs harness/page`
