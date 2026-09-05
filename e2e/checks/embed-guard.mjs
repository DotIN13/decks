/**
 * A gesture over an HTML embed gets out of it too (DESIGN §4, §7).
 *
 * `frame-gestures.ts` forwards a wheel out of a board by listening inside the board's
 * document. An HTML embed is one document deeper and sandboxed, so nobody can listen
 * inside it: the scroll arrived there and stopped, and the canvas never learned it
 * happened. Two answers, and this asserts both — a veil over a page that knows nothing
 * about Decks, and the posted-wheel bridge for a page that opts in.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();

const BOARD = '.board-node[data-path="boards/sources.html"]';

await page.evaluate(() => [...document.querySelectorAll(".board-row")].find((i) => i.textContent.includes("sources"))?.click());
await page.waitForFunction(
	() => {
		const frame = document.querySelector('.board-node[data-path="boards/sources.html"] iframe');
		return (
			frame?.contentWindow?.__boardReady === true &&
			Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")) > 40
		);
	},
	null,
	{ timeout: 15000 },
);
// The guest announces itself on load, which is after the board is ready.
await page.waitForFunction(
	() => document.querySelector('.board-node[data-path="boards/sources.html"] iframe')?.contentDocument?.querySelector('[data-id="live"].embed-guest') !== null,
	null,
	{ timeout: 10000 },
).catch(() => {});

const camera = () =>
	page.evaluate(() => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
			document.querySelector(".world").style.transform,
		);
		return { zoom: Number(m[3]), x: -Number(m[4]), y: -Number(m[5]) };
	});

/** Where a point inside a board component sits on screen, in the parent's coordinates. */
const screenPoint = (id, dx, dy) =>
	page.evaluate(
		({ id, dx, dy }) => {
			const frame = document.querySelector('.board-node[data-path="boards/sources.html"] iframe');
			const rect = frame.getBoundingClientRect();
			const scale = rect.width / frame.clientWidth;
			const box = frame.contentDocument.querySelector(`[data-id="${id}"]`).getBoundingClientRect();
			return { x: rect.left + (box.left + dx) * scale, y: rect.top + (box.top + dy) * scale };
		},
		{ id, dx, dy },
	);

const shape = (id) =>
	page.evaluate((id) => {
		const doc = document.querySelector('.board-node[data-path="boards/sources.html"] iframe').contentDocument;
		const host = doc.querySelector(`[data-id="${id}"]`);
		return {
			veil: !!host.querySelector(".embed-veil"),
			hint: host.querySelector(".embed-hint")?.textContent ?? null,
			live: host.classList.contains("embed-live"),
			guest: host.classList.contains("embed-guest"),
		};
	}, id);

const moved = (was, now) => Math.hypot(now.x - was.x, now.y - was.y);

// --- 1. the veil, on a page that knows nothing about Decks ---------------------------
const foreign = await shape("report");
say("a foreign html embed is veiled", foreign.veil && !foreign.guest, `veil=${foreign.veil} guest=${foreign.guest}`);
say("and says what the veil is for", foreign.hint === "click to interact", `hint "${foreign.hint}"`);

const at = await screenPoint("report", 120, 200);
const c0 = await camera();
await page.mouse.move(at.x, at.y);
await page.mouse.wheel(0, 120);
await settle(page, 250);
const c1 = await camera();
say("a wheel over a veiled embed pans the canvas", moved(c0, c1) > 20, `moved ${moved(c0, c1).toFixed(1)}px`);

// --- 2. a click hands the pointer to the page, and leaving hands it back --------------
await page.mouse.click(at.x, at.y);
await settle(page, 150);
const clicked = await shape("report");
say("a click lifts the veil", clicked.live && clicked.hint === "interacting · leave to pan", `live=${clicked.live} hint "${clicked.hint}"`);

const c2 = await camera();
await page.mouse.move(at.x, at.y + 6);
await page.mouse.wheel(0, 120);
await settle(page, 250);
const c3 = await camera();
say("and then the scroll belongs to the page", moved(c2, c3) < 1, `moved ${moved(c2, c3).toFixed(2)}px`);

await page.mouse.move(20, 20);
await settle(page, 150);
const left = await shape("report");
say("leaving the embed hands the gesture back", !left.live, `live=${left.live}`);

// --- 3. the bridge, on a page that opts in -------------------------------------------
const guest = await shape("live");
say("a guest embed needs no veil", guest.guest && !guest.veil && guest.hint === null, `guest=${guest.guest} veil=${guest.veil}`);

const inner = page.frameLocator(`${BOARD} iframe`).frameLocator('[data-id="live"] iframe');
await inner.locator("#go").click();
say("and takes the pointer without being asked", (await inner.locator("#go").textContent()) === "clicked 1 time", await inner.locator("#go").textContent());

/*
 * The rule, one document deeper: a scroll the guest's own box can take is the box's, and
 * the canvas takes the rest. Both halves are asserted, because the interesting failure is
 * a bridge that forwards everything and makes an embedded page unreadable.
 */
const boxAt = await inner.locator("#box").boundingBox();
const readTop = () => inner.locator("#box").evaluate((el) => Math.round(el.scrollTop));
const topWas = await readTop();
const c4 = await camera();
await page.mouse.move(boxAt.x + boxAt.width / 2, boxAt.y + boxAt.height / 2);
await page.mouse.wheel(0, 60);
await settle(page, 250);
const topNow = await readTop();
const c5 = await camera();
say("a scroll the guest's own box can take stays there", topNow > topWas, `scrollTop ${topWas} -> ${topNow}`);
say("and leaves the camera alone", moved(c4, c5) < 1, `moved ${moved(c4, c5).toFixed(2)}px`);

const headAt = await inner.locator("h1").boundingBox();
const c6 = await camera();
await page.mouse.move(headAt.x + headAt.width / 2, headAt.y + headAt.height / 2);
await page.mouse.wheel(0, 120);
await settle(page, 250);
const c7 = await camera();
say("a scroll it cannot use is posted up and pans the canvas", moved(c6, c7) > 20, `moved ${moved(c6, c7).toFixed(1)}px`);

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
