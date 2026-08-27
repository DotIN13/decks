---
name: board-debug
description: Look at a board with your own eyes — screenshot it, read its console, measure or click things — using Playwright over bash. Use when you have built or changed a board, when something may be clipping or overlapping, or when the user says a board looks wrong.
---

# Looking at a board

Boards are HTML, and the app serves them at a URL, so the way to see one is to open
it in a browser you drive. There is no screenshot tool to call: you have `bash`, and
that is enough.

## Once, if Playwright is not installed

```bash
npm ls playwright 2>/dev/null | grep -q playwright || npx --yes playwright install chromium
```

The download is ~100MB and only happens once per machine. If there is no network,
work from the source instead — you wrote it, so you know what it says.

## The loop

The app serves boards at `http://127.0.0.1:4329/api/board/<deck-relative path>`
(port 4329 unless `DECKS_PORT` says otherwise). Wait for `window.__boardReady`: the
board sets it after fonts, markdown, diagrams and PDFs have all finished, and a
screenshot taken before it is a picture of a board still loading.

```bash
cat > /tmp/shot.mjs <<'JS'
import { chromium } from "playwright";
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
node /tmp/shot.mjs "http://127.0.0.1:4329/api/board/boards/plan.html" /tmp/board.png
```

Then `read /tmp/board.png`. That is the picture, in your context, at full size.

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

**Did an embed resolve?** An embed that failed has `data-kind="missing"`:

```js
await page.evaluate(() => [...document.querySelectorAll(".embed")]
  .map((el) => ({ id: el.dataset.id, kind: el.dataset.kind, embed: el.dataset.embed })));
```

**Just one component, not the whole board:**

```js
await page.locator('[data-id="risk"]').screenshot({ path: "/tmp/risk.png" });
```

**Dark as well as light**, since the app hands boards its theme:

```js
await page.emulateMedia({ colorScheme: "dark" });
```

## Baking a poster

A board that is slow to mount — many PDF pages, a large diagram — can hand the rail
a still image instead. Screenshot it, save it into `assets/`, and add the meta tag:

```html
<meta name="poster" content="assets/plan.png" />
```

## Habits

- Screenshot after you build something visual, not after every edit. It costs real
  tokens; the source is free.
- Fix from the source. A screenshot tells you *that* something is wrong and roughly
  where; the HTML tells you why.
- If `__boardReady` never arrives, the console output in the same run usually says
  which mount threw.
