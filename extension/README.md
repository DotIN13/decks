# The Decks extension

Share one tab of your own Chrome with a Decks deck, so its agents can read the page you are
logged into and fill it in — with you watching, in your own browser.

## Install (unpacked)

1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. **Load unpacked**, and pick this `extension/` directory.

## Pair, once

1. Click the Decks button in Chrome's toolbar, open **Pairing**.
2. Address and code: both are in Decks' own Settings, under **Your Chrome**, each with a
   Copy button. (The code is also on the deck's "Your Chrome" status board, and an agent
   can read it with `stage.web.pairing()`.) **New code** there invalidates the old one.
3. Save.

## Share a tab

Open the tab the agent should work in, click the Decks button, **Share this tab**. The tab
moves into a blue "Decks" tab group and Chrome shows its "is debugging this tab" bar. Drag
another tab into the group to share it too; drag one out to stop sharing it. **Stop sharing**
in the popup, or Stop on the deck's board, lets go of everything.

## What travels

One outgoing websocket from this extension to the Decks server at `/api/web/relay`, carrying
the same five commands and four events Playwright's own browser extension uses (this one is a
fork of it, Apache-2.0). Nothing on your machine listens for connections, and no picture of
the tab is sent anywhere: the deck's board is a status card.
