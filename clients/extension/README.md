# clients/extension

The Decks extension for Chrome: share one tab of your own browser with a deck, so its agents can read the
page you are logged into and fill it in, with you watching. Package `@decks-next/extension` until the
switch-over. Chrome loads these files as they are; there is no build.

## Owns

- `manifest.json`: Manifest V3, a module service worker, the popup.
- `background.js`: the worker: the address and pairing code, sharing, reconnecting, and `globalThis.__decks`
  for the tests. `relay.js`: the socket to the server. `group.js`: the blue Decks tab group. `shared.js`:
  what they share. `popup.js`, `popup.html`: the toolbar popup.
- `extension.test.ts`: holds the extension's names to the protocol's. `chrome.d.ts`: Chrome's API, loosely,
  for the type check.

## May import

Nothing at run time: Chrome loads plain JavaScript, so the worker imports only its own modules. Its test
imports `protocol/` through its entry.

## Rules

1. One outgoing socket to the server at the protocol's `TAB_RELAY_PATH` (`/api/web/relay?code=<code>`).
   Nothing on this machine listens. The test holds `background.js` to that path.
2. The wire is Playwright's own extension's (a fork of its relay connection and connected
   tab group, Apache-2.0, Microsoft): five commands down (attach, detach, sendCommand,
   tabs.create, tabs.remove) and Chrome's events up. A `decks.ping` is answered so the worker stays awake.
3. No picture of the tab leaves it: the server knows only whether a tab is shared, and which.
4. A dropped socket is reopened with a growing delay while the tab is still wanted shared; "Stop sharing"
   here or in Decks lets go of everything.
5. The worker's state is one object, `state`; nothing changing sits loose at the top of a file.

## Install and pair

Open `chrome://extensions`, turn on Developer mode, Load unpacked, and pick this folder. Click the Decks
button, open Pairing, and paste the address and code from Decks' Settings, under Your Chrome (an agent can
read the code with `decks tab pair`). Then open a tab and press Share this tab: it joins a blue Decks tab
group; drag a tab in to share it too, or out to stop.

## Check

`node tools/check.mjs clients/extension` (the scripts' type check and the test). Pairing with the server
is Depot's `server/tab` test, whose fake extension speaks this wire.
