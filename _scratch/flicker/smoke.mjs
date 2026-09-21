import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:4327/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(12000);
console.log(JSON.stringify({
  boards: await page.locator(".board-node").count(),
  docs: await page.locator(".board-node iframe").count(),
  rows: await page.locator(".board-row").count(),
  title: await page.title(),
  errors: errors.slice(0, 3),
}, null, 1));
await browser.close();
