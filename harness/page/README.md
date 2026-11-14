# harness/page

The person's page: the shell, the agent list and pills, the canvas manager and the frame that
holds the canvas page, settings, connections, panels and pages. Pane owns it; `chat/` and
`composer/` are Scribe's.

## Owns

- `shell/`: the page's frame. `view.tsx` lays out each area; `actions.ts` wires them once.
- `state/`: every store and the one line to the server (`line.ts`, `sync.ts`), entered by
  `state/index.ts`; `state/compat/` hears today's socket messages for today's checks.
- `agents/ canvases/ settings/ panel/ connections/ frame/ files/ markup/ lib/ perf/ app/`: the parts.
- `styles/`: the sheets in their cascade order, until each is scoped to its part.
- `pages/`: the entry of each HTML page. `vite.config.ts`, `index.html`: the build and dev server.

## May import

`@decks-next/protocol` and `@decks-next/sdk` by name; `@decks/ui`, `@decks/canvas`,
`@decks/pen`, `@decks/ink`, `@decks/agent-ui` as libraries by name until they move; solid-js,
lucide-solid, marked. Never `server/`, `apps/`, nor `@decks/protocol` or `@decks/api`.

## Rules

1. The page talks to one door, the server's: every call through `decks` from `@decks-next/sdk`,
   every event through `on(name, hear)` from `state/`. It opens no socket of its own.
2. The harness's calls (`chat.*`, `account.*`, `runtime.*`) are made at the same door; the
   server passes them to the harness. When none is connected they answer `unavailable`, and the
   page says so in a notice instead of failing.
3. The page learns its server and token from `/page.json` (served by whatever serves the page),
   else from `?token=` once; the token goes only in a header and the socket's hello.
4. The shell holds no data: stores are in `state/`, and the shell wires them to each area's view.
5. Moved, not redesigned: markup, class names and behaviour stay as today's `apps/web`, because
   the browser checks and the styles hold them.
6. A part over the limits splits into `model.ts` (state and rules, no DOM, unit-tested),
   `view.tsx` and `actions.ts`. A moved file over a limit is listed in the gate's baseline,
   and that list only shrinks.
7. Changing values live in a store in `state/`, never loose at the top of a file.
8. Styles move first in their order, so the page looks the same; each is then scoped to its part,
   proven by pictures before and after in light and dark.
9. Another folder reaches an area only through its `index.ts`.

## Check

- `node tools/check.mjs harness/page`: the type check and unit tests.
- `node tools/heavy.mjs --wait -- npm run build -w @decks-next/page`: the build.
- `npm run dev -w @decks-next/page`: the dev server on 4680, proxying the server's door
  (`DECKS_URL`, else the lock file of `DECKS_DECK`).
