# server/frame

The canvas page that clients frame, and the pass the frame calls with, as today's server gives them.

## Owns

- `static.ts`: `GET /canvas-frame.html` and `/frame-assets/…`, the built canvas page, public.
- `passes.ts`: canvas passes: issued for one canvas, an hour long, kept in memory.
- `routes.ts`: `POST /api/passes` (a pass for a canvas) and `/api/t/<pass>/card/<path>` (the
  canvas's files on a pass).
- `build.mjs`: builds `canvas-frame.html` alone from `harness/page` into `dist/`, a heavy job.
- `feature.ts`: its one export.

## May import

The kernel and the protocol through their entries. No other feature.

## Rules

1. The page is served as built; nothing is built on a request. Without a build, the page answers
   503 with the command that builds it.
2. A pass is a kernel token for the person on one canvas, its caller id `frame-<n>`. It lives an
   hour, and is revoked then. Asking for one needs the person's own token.
3. A file on a pass is a file of that pass's canvas folder, or of the deck's `assets/` and
   `lib/`. Anything else is 404, and so is a pass that ran out.
4. The page and its assets are public: an iframe and a module script send no token. Nothing on
   them reads the deck.

## Check

```
node tools/check.mjs server
node tools/heavy.mjs --wait -- node server/frame/build.mjs
```
