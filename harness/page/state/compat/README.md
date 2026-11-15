# harness/page/state/compat

Today's socket messages, heard on the page's line and applied as today's page applied them. It goes
with the server's compat after stop 3.

## Owns

- `socket.ts`: `hearOld`, which hears what arrives on the page's line that is not a new event.
- `apply.ts`: `applyOld`, the old agent and chat messages applied to the page's state.
- `line.ts`: today's line at /compat/v1/socket, opened only in compat mode (`DECKS_PAGE_COMPAT=1`), for
  the two calls today's checks read from the page's own frames: agent.set and view.remember.

## May import

The page's `state/` modules, and `@decks-next/protocol`.

## Rules

1. Only today's browser checks send these: they dispatch today's messages on the page's socket.
2. An old agent list is the whole list: while one has been told, its rows are drawn alone.
3. A message the page never drew from is left alone.
4. Compat mode is off unless the dev server runs with `DECKS_PAGE_COMPAT=1`; only the checks set it.
5. Deleting this folder means deleting its imports in `shell/actions.ts`, `state/line.ts`,
   `agents/actions.ts` and `app/camera-report.ts`.

## Check

`node tools/check.mjs harness/page`
