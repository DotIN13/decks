---
name: card-debug
description: Look at a card with your own eyes — screenshot it, read its console, measure or click things — using Playwright over bash. Use when you have built or changed a card, when something may be clipping or overlapping, or when the user says a card looks wrong.
---

# Looking at a card

A card is HTML, and the app serves each card as a page of its own at a URL (`decks card url <path>`),
so the way to see one is to open it in a browser you drive. On that page the card's `index.html` is
the page's body and its module is called with the page itself as `card.root`, so it looks as it
does on the canvas. `decks canvas screenshot --of <path>` is the other way: the card as the
person's browser has it now, among nothing else. There is no screenshot tool to call: you have `bash`, and
that is enough.

## Once, if the browser is not installed

Playwright ships with Decks; its browser does not, because it is ~100MB. Install it
from Decks' own directory, which is where its `node_modules` lives:

```bash
cd "$DECKS_APP_DIR" && npx playwright install chromium
```

Once per machine, cached under `~/.cache/ms-playwright` and shared by every deck. If
there is no network, work from the source instead — you wrote it, so you know what it
says. If a launch later fails naming a missing shared library, the host is short of
the system packages Chromium links against; that needs root, so say so rather than
trying — `npx playwright install-deps chromium`, as root, is the fix.

## The loop

`decks card url <path>` is the address: the card in a page of its own. Wait for
`window.__boardReady`, the only ready signal the card page's runtime (`lib/board.js`) gives (the
name is from before cards): it goes true after fonts, markdown, maths and diagrams have finished,
and a screenshot taken before it is a picture of a card still loading.

Two things in the preamble are worth keeping when you adapt this. `createRequire`
anchored at `DECKS_APP_DIR` is what lets the script resolve `playwright` from wherever
you wrote it — your cwd is the deck, and a deck is not inside the install, so a bare
`import "playwright"` fails. And the origin comes from the environment, because the
host and port are configurable.

```bash
cat > /tmp/shot.mjs <<'JS'
import { createRequire } from "node:module";
// The deck is not inside Decks' install, so resolve from the install instead.
const base = process.env.DECKS_APP_DIR ? `${process.env.DECKS_APP_DIR}/` : import.meta.url;
const { chromium } = createRequire(base)("playwright");
const [url, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const notes = [];
page.on("console", (m) => notes.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => notes.push(`pageerror: ${e.message}`));
page.on("response", (r) => { if (r.status() >= 400) notes.push(`http ${r.status()}: ${r.url()}`); });
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction("window.__boardReady === true", { timeout: 15000 })
  .catch(() => notes.push("!! __boardReady never became true — something did not finish mounting"));
await page.screenshot({ path: out, fullPage: true });
console.log(notes.join("\n") || "(clean)");
await browser.close();
JS
HOST=${DECKS_HOST:-127.0.0.1}; [ "$HOST" = "0.0.0.0" ] && HOST=127.0.0.1
node /tmp/shot.mjs "$(decks card url canvases/<canvas>/cards/plan/index.html)" /tmp/card.png
```

Then `read /tmp/card.png`. That is the picture, in your context, at full size.

## What else the page will tell you

It is a browser, not a camera. Some things worth asking it:

**Is anything overflowing its box, or overlapping something else?**

```js
await page.evaluate(() => [...document.querySelectorAll("[data-id]")].map((el) => {
  const r = el.getBoundingClientRect();
  return { id: el.dataset.id, x: r.x, y: r.y, w: r.width, h: r.height,
           clipped: el.scrollHeight > el.clientHeight + 1 };
}));
```

**Just one block, not the whole card:**

```js
await page.locator('[data-id="risk"]').screenshot({ path: "/tmp/risk.png" });
```

**Dark as well as light**, since the app hands cards its theme:

```js
await page.emulateMedia({ colorScheme: "dark" });
```

## Habits

- Screenshot after you build something visual, not after every edit. It costs real
  tokens; the source is free.
- Look at it narrow too: before the screenshot, `await page.evaluate(() => (document.body.style.width = "360px"))`
  (the card's element is its container, so its `@container card` rules apply), or set its item to
  360 wide with `decks canvas update <id> --size.w 360` and take `decks canvas screenshot --of <path>`.
- Fix from the source. A screenshot tells you *that* something is wrong and roughly
  where; the HTML tells you why.
- If `__boardReady` never arrives, the console output in the same run usually says
  which mount threw. A module that throws is named with its card's file (`index.html.m0.js`).
- A card that works on its own page and not on the canvas is reaching for `document` or `window`:
  on the canvas those are the app's page. Use `card.root`.
