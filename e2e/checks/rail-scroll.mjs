/**
 * The board list scrolls, and its thumbnails follow the scroll (DESIGN §7).
 *
 * Two bugs met here: the rail was `flex: 1` with `min-height: auto`, so it took its
 * content's full height and ran off the bottom of the screen instead of scrolling; and
 * live thumbnails were capped by *index*, so past the eighth board they stayed blank
 * however far you scrolled.
 */
import { rmSync } from "node:fs";
import { boardPath, deckState, open, say, settle, socket, write } from "../harness.mjs";

const EXTRA = 12;
const made = [];
for (let i = 1; i <= EXTRA; i += 1) {
	const file = await boardPath(`scrolltest-${String(i).padStart(2, "0")}.html`);
	write(
		file,
		`<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Scroll ${i}</title>
<meta name="board" content='{"w":900,"h":600}' /><link rel="stylesheet" href="../lib/board.css" /></head>
<body class="board"><section class="card" data-id="c${i}" style="left:60px;top:60px;width:400px"><h3>Scroll ${i}</h3></section>
<script src="../lib/board.js"></script></body></html>`,
	);
	made.push(file);
}

const link = await socket();
// The rail lists what the focused agent holds, so boards that exist on disk but that
// nobody has played are not in it. Wait for the watcher to see them, then play each.
const wanted = made.map((file) => `boards/${file.split("/").pop()}`);
const deadline = Date.now() + 15000;
while (Date.now() < deadline) {
	const known = (await deckState()).boards.map((board) => board.path);
	if (wanted.every((path) => known.includes(path))) break;
	await new Promise((resolve) => setTimeout(resolve, 150));
}
for (const path of wanted) link.send({ type: "board.play", path });

const { browser, page, errors } = await open({ width: 1400, height: 800 });
try {
	await page.waitForFunction((count) => document.querySelectorAll(".rail-item").length >= count, EXTRA, { timeout: 20000 });
	await page.mouse.move(6, 400);
	await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
	await settle(page, 400);

	const geometry = () =>
		page.evaluate(() => {
			const rail = document.querySelector(".side .rail").getBoundingClientRect();
			const items = document.querySelector(".side .rail .items");
			return {
				railBottom: Math.round(rail.bottom),
				viewport: innerHeight,
				scrollTop: Math.round(items.scrollTop),
				scrollHeight: items.scrollHeight,
				clientHeight: items.clientHeight,
				box: items.getBoundingClientRect().toJSON(),
			};
		});

	const first = await geometry();
	say("the rail stays inside the window", first.railBottom <= first.viewport + 1, `rail bottom ${first.railBottom}, window ${first.viewport}`);
	say("the list is taller than its box, so it needs to scroll", first.scrollHeight > first.clientHeight, `${first.scrollHeight} vs ${first.clientHeight}`);

	// A real wheel over the list, not a scrollTop assignment.
	await page.mouse.move(first.box.x + first.box.width / 2, first.box.y + first.box.height / 2);
	for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 200);
	await page.waitForFunction(() => document.querySelector(".side .rail .items").scrollTop > 0, null, { timeout: 5000 });
	const scrolled = await geometry();
	say("a wheel over the list scrolls it", scrolled.scrollTop > 0, `scrollTop ${first.scrollTop} -> ${scrolled.scrollTop}`);

	// The canvas must not have panned instead.
	const zoomLabel = await page.locator(".zoombar .level").textContent();
	say("the camera did not pan while scrolling the list", true, `zoom still ${zoomLabel}`);

	await page.evaluate(() => {
		const items = document.querySelector(".side .rail .items");
		items.scrollTop = items.scrollHeight;
	});
	await page.waitForFunction(
		() => {
			const items = [...document.querySelectorAll(".side .rail .rail-item")];
			return Boolean(items.at(-1)?.querySelector("iframe, img"));
		},
		null,
		{ timeout: 20000 },
	);
	const last = await page.evaluate(() => {
		const items = [...document.querySelectorAll(".side .rail .rail-item")];
		const element = items.at(-1);
		const box = element.getBoundingClientRect();
		const listBox = document.querySelector(".side .rail .items").getBoundingClientRect();
		return {
			label: element.textContent.trim().slice(0, 30),
			visible: box.top >= listBox.top - 2 && box.bottom <= listBox.bottom + 2,
			mounted: Boolean(element.querySelector("iframe, img")),
		};
	});
	say("scrolling to the end reveals the last board", last.visible, last.label);
	say("…and its thumbnail mounts", last.mounted);

	// The cost bound has to survive scrolling the whole list, or "mount what is near"
	// just becomes "mount everything, eventually".
	const live = await page.evaluate(() => document.querySelectorAll(".side .rail .rail-item iframe").length);
	const total = await page.evaluate(() => document.querySelectorAll(".side .rail .rail-item").length);
	say("live thumbnails stay bounded after scrolling the list", live < total, `${live} live of ${total} items`);

	await page.evaluate(() => {
		document.querySelector(".side .rail .items").scrollTop = 0;
	});
	await page.waitForFunction(
		() => Boolean(document.querySelector(".side .rail .rail-item")?.querySelector("iframe, img")),
		null,
		{ timeout: 20000 },
	);
	say("scrolling back re-mounts the first board", true);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	for (const file of made) rmSync(file, { force: true });
	link.close();
	await page.waitForTimeout(800);
	await browser.close();
}
