/**
 * A scroll a box inside a board can take is given to it (DESIGN §7).
 *
 * An embedded paper or a long markdown file has its own scrollbar, and turning that into a
 * canvas pan would make the embed unreadable. The canvas takes over at the end of the box.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();

const showSources = async () => {
	await page.evaluate(() => [...document.querySelectorAll(".rail-item")].find((i) => i.textContent.includes("sources"))?.click());
	await page.waitForFunction(
		() => {
			const frame = document.querySelector('.board-node[data-path="boards/sources.html"] iframe');
			return frame?.contentWindow?.__boardReady === true && Number((document.querySelector(".zoombar .level")?.textContent ?? "0%").replace("%", "")) > 40;
		},
		null,
		{ timeout: 15000 },
	);
};
await showSources();

const world = () => page.evaluate(() => document.querySelector(".world").style.transform);
const zoom = async () => Number((await page.locator(".zoombar .level").textContent()).replace("%", ""));

/** Where a component inside a board sits on screen, in the parent's coordinates. */
const screenPoint = (id, dx, dy) =>
	page.evaluate(
		({ id, dx, dy }) => {
			const frame = document.querySelector('.board-node[data-path="boards/sources.html"] iframe');
			const doc = frame.contentDocument;
			const element = doc.querySelector(`[data-id="${id}"] .embed-body`) ?? doc.querySelector(`[data-id="${id}"]`);
			const rect = frame.getBoundingClientRect();
			const scale = rect.width / frame.clientWidth;
			const box = element.getBoundingClientRect();
			return { x: rect.left + (box.left + dx) * scale, y: rect.top + (box.top + dy) * scale };
		},
		{ id, dx, dy },
	);

const embedScroll = () =>
	page.evaluate(() => {
		const body = document
			.querySelector('.board-node[data-path="boards/sources.html"] iframe')
			.contentDocument.querySelector('[data-id="notes"] .embed-body');
		return { top: Math.round(body.scrollTop), room: Math.round(body.scrollHeight - body.clientHeight) };
	});

const at = await screenPoint("notes", 40, 60);
const start = await embedScroll();
say("the markdown embed has something to scroll", start.room > 20, `${start.room}px of overflow`);

// Real, trusted wheel events — the only kind that scrolls anything.
const w0 = await world();
await page.mouse.move(at.x, at.y);
await page.mouse.wheel(0, 60);
await page.waitForFunction(
	(was) => {
		const body = document
			.querySelector('.board-node[data-path="boards/sources.html"] iframe')
			.contentDocument.querySelector('[data-id="notes"] .embed-body');
		return Math.round(body.scrollTop) > was;
	},
	start.top,
	{ timeout: 5000 },
);
const inside = await embedScroll();
say("scrolling inside an embed scrolls the embed", inside.top > start.top, `scrollTop ${start.top} → ${inside.top}`);
say("…and leaves the canvas where it was", (await world()) === w0);

// Run it to the end, then one more: the canvas should take over.
for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 120);
await settle(page, 400);
const end = await embedScroll();
const w1 = await world();
await page.mouse.wheel(0, 120);
await page.waitForFunction((was) => document.querySelector(".world").style.transform !== was, w1, { timeout: 5000 });
say("at the end of the embed the canvas takes over", (await world()) !== w1, `scrollTop ${end.top}/${end.room}`);

// Over a plain part of the board, a scroll is always the canvas. Re-fit first: the
// scrolling above moved the camera, and the heading may no longer be on screen.
await showSources();
const plain = await screenPoint("heading", 20, 10);
const w2 = await world();
await page.mouse.move(plain.x, plain.y);
await page.mouse.wheel(0, 100);
await page.waitForFunction((was) => document.querySelector(".world").style.transform !== was, w2, { timeout: 5000 });
say("over the board itself, a scroll pans the canvas", (await world()) !== w2);

// A trusted pinch: Chromium reports ctrl+wheel as a pinch.
const z0 = await zoom();
await page.keyboard.down("Control");
await page.mouse.move(at.x, at.y);
await page.mouse.wheel(0, -120);
await page.keyboard.up("Control");
await page.waitForFunction((was) => Number((document.querySelector(".zoombar .level")?.textContent ?? "").replace("%", "")) !== was, z0, { timeout: 5000 });
say("a pinch inside an embed zooms the canvas", (await zoom()) !== z0, `${z0}% → ${await zoom()}%`);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
