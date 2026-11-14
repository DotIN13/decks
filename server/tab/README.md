# server/tab

The person's shared Chrome tab: `tab.*`, relayed to the Decks extension they paired.

## Owns

- `tab.status pair open read screenshot fill select click press submit answer stop`, in calls.ts.
- hub.ts: the pairing code, the one extension line, the pending question; emits `tab.changed`.
- line.ts: the extension's wire, numbered commands down and Chrome's events up.
- driver.ts: what each call does in the tab, as Chrome DevTools commands; page.ts: the scripts
  that run in the page to read it and find a field.
- relay.ts: the `/api/web/relay` route; its upgrade checks the code, then gives the line to the hub.

## May import

`protocol/` and `server/kernel/`, through their entry files. No other feature, no npm package.

## Rules

1. The extension dials `/api/web/relay?code=<code>` on the server's own address and speaks the
   wire of Playwright's extension: `{ id, method, params }` down (`chrome.debugger.attach`,
   `detach`, `sendCommand`, `chrome.tabs.create`, `remove`, `decks.ping`), `{ id, result }` or
   `{ id, error }` back, and `{ method, params }` for `chrome.tabs.onCreated`, `onRemoved`,
   `chrome.debugger.onEvent`, `onDetach` and `extension.initialized`. That extension is not ours to
   change; this side speaks what it speaks.
2. The pairing code is minted on the first `tab.pair` and kept in the feature's store. A line
   with another code is refused before any command. `fresh: true` mints a new one and drops the
   line. A code does not expire: `expires` is 0.
3. One extension at a time: a new line replaces the old one. The first tab it names is the tab.
   It is pinged every 20 s, so Chrome keeps its worker awake.
4. With no line, every call but `tab.status`, `tab.pair` and `tab.stop` answers `unavailable`
   with a sentence: pair first, or share a tab from the extension.
5. `tab.read` is the page as lines, one per field, button, link and heading, each with
   `[ref=eN]`. References belong to the address they were read at: after a navigation, using
   one is refused with a sentence. Over 60,000 characters the snapshot is cut and says so.
6. A target is a label, `{ ref }`, or `{ name, nth }` (1 is the first). A name that matches more
   than one thing, with no `nth`, is refused naming both ways out; one that matches nothing says so.
7. A click on something covered by another element is refused naming what covers it; a control
   the page hides and paints over is clicked on the element itself.
8. `tab.submit` asks the person first: it answers at once with `pending`, and `tab.answer` does
   the submit on yes. Two minutes with no answer is a no. `ask: false` skips the question.
9. `tab.screenshot` writes a PNG into the deck at `exports/tab/<time>.png`, through `ctx.deck`
   with the caller, and answers its path and size. A tab Chrome is not painting answers in 15 s
   with a sentence saying to bring it to the front.
10. An action answers the Tab as it now is, and every change of the tab emits `tab.changed`.

## Check

- `node tools/check.mjs server`
- `node tools/gates/run.mjs`
