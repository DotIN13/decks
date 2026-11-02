# scripts/

What each script is for and how it is run. Three kinds: the ones `package.json` runs, the ones the
browser-check runner or a test runs, and the ones run by hand against a live harness. The last kind
is the one a reader cannot tell apart from dead code, which is why this file exists.

## Run by `npm run …` (root `package.json`, or a package's)

| script | command | what it does |
|---|---|---|
| `css-order.mjs` | `npm run css:order` | the cascade gate: flattens `apps/web/src/index.css`, hashes the rules in order, compares to `apps/web/src/styles/cascade-order.json`; `-- --update` re-stamps |
| `dead-exports.mjs`, `dead-css.mjs`, `stale-paths.mjs` | `npm run gates` (CI runs it after `css:order`) | an exported symbol nothing references, a class no markup writes, a comment naming a file that does not exist: each exits 1 naming what it found; `dead-exports.mjs --over` also lists exports used only in their own file |
| `vendor.mjs` | `npm run vendor` | copies the card primitives (d3, KaTeX, marked, highlight.js, mermaid, pdf.js) from `node_modules` into `packages/card-host/lib` |
| `live-doc.mjs` | `npm run build:live-doc` | bundles `runtime/live-doc.ts` into `packages/card-host/lib/live-doc.js` |
| `build-packages.mjs` | `npm run build:packages` | builds the public `@decks/*` packages into `dist-packages/` for npm |
| `test-packages.mjs` | `npm run test:packages` | packs those, installs the tarballs into an empty folder and runs `examples/share-site` there with plain Node |
| `build-solid-lib.mjs` | `npm run build:lib -w @decks/canvas` (and from `build-packages.mjs`) | a Solid package as JavaScript for npm, one file per source file |
| `gen-sdk.mjs` | by hand, after a change to `packages/api` | writes the SDK's generated parts from the verb table; `packages/api/src/api.test.ts` checks they are current |
| `gen-pen-schema.mjs` | `node --import tsx scripts/gen-pen-schema.mjs` | writes `runtime/skills/canvas-design/schema.md` from `packages/pen`; `--check` is what `packages/pen/src/schema.test.ts` runs |

## Run by `npm test`

`css-order.test.mjs` and `public-entries.test.mjs`: the root `test` script runs `scripts/*.test.mjs`.

## Measures, run by hand

Each starts the e2e runner or opens a harness you point it at, and prints numbers rather than
passing or failing. Run one before a change and after, and keep the change if its numbers hold.

| script | how | what it measures |
|---|---|---|
| `awake-bench.mjs` | `node scripts/awake-bench.mjs` | a pan and a zoom on a canvas heavy with cards, apps and documents (the check of the same name in `e2e/checks/` is what it runs; `AWAKE_BENCH_PROFILE`, `_TRACE`, `_ALLOC` write a profile beside the numbers) |
| `profile-shares.mjs`, `trace-shares.mjs`, `alloc-shares.mjs` | `node scripts/<name>.mjs <file>` | where that profile's, trace's or heap sample's time or bytes went, by share |
| `pan-heavy.mjs` | `node scripts/pan-heavy.mjs` | panning on the fixture's heavy canvases (`e2e/checks/pan-heavy.mjs`) |
| `render-perf.mjs` | `node scripts/render-perf.mjs` | the stage on the 2,000-item `perf` canvas (`e2e/checks/render-perf.mjs`) |
| `card-zoom.mjs` | `node scripts/card-zoom.mjs --url http://127.0.0.1:4876 --canvas <name>` | what pinches cost on a card-heavy canvas in a simulated iPad, against a harness you are running |
| `ipad-profile.mjs` | `node scripts/ipad-profile.mjs` | pan and zoom on a real iPad through Safari's Web Inspector |

## Checks that need a real model or a real service, run by hand

| script | how | what it checks |
|---|---|---|
| `opencode2-live.mts` | `node --import tsx scripts/opencode2-live.mts` | the OpenCode 2 adaptor against a real OpenCode 2 and a real model: a mode that refuses, auto mode, the environment an agent's commands see, the canvas tool, skills, resuming |
| `e2e/checks/cards-smoke.mjs` | see its header | cards in the canvas frame against a server holding the `*-cards` canvases; not in `e2e/run.mjs`'s list because it needs that server |
