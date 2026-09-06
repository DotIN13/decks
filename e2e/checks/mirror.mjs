/**
 * A mirror: a board that is a live view of a conversation (DESIGN §4, §7).
 *
 * Every other board on the canvas draws itself from its own file. A mirror's file is a stub
 * that never changes — one component carrying `data-live="chat"` — and its turns arrive in
 * the browser, from a transcript the app is already holding for every agent. So what is
 * worth a browser here is exactly the part that is not in a unit test: that the two
 * documents find each other, that the list scrolls without trapping the canvas, and that it
 * lets go of the bottom when a reader does.
 *
 * The delta rule itself — what to send a board that already holds some turns — is
 * `canvas/live-chat.test.ts`. This drives the button a person would press.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 980 });

const MIRROR = '.board-node[data-path^="boards/mirrors/"]';
const inside = (fn, arg) =>
	page.evaluate(
		({ fn, arg }) => {
			const doc = document.querySelector('.board-node[data-path^="boards/mirrors/"] iframe')?.contentDocument;
			// eslint-disable-next-line no-new-func
			return new Function("doc", "arg", `return (${fn})(doc, arg)`)(doc, arg);
		},
		{ fn: fn.toString(), arg },
	);

// --- making one ------------------------------------------------------------------

await page.locator('button:has-text("Agents")').first().click();
await settle(page, 500);
say("the Agents tab lists somebody to mirror", (await page.locator(".agent-row").count()) > 0);

const button = page.locator('[aria-label^="Mirror "]').first();
say("every row offers a mirror", (await button.count()) > 0);
// Clicked through the DOM: the control is revealed by hover and this is about what it
// does, not about when it appears — `panel.mjs` is where the hover affordances are.
await page.evaluate(() => document.querySelector('[aria-label^="Mirror "]').click());
await page.waitForSelector(MIRROR, { timeout: 15000 });
say("pressing it puts a mirror on the canvas", true, await page.locator(MIRROR).getAttribute("data-path"));

await page.waitForFunction(
	() => document.querySelector('.board-node[data-path^="boards/mirrors/"] iframe')?.contentDocument?.querySelector(".live")?.dataset.state === "live",
	null,
	{ timeout: 15000 },
);
say("the board and the app find each other with no handshake to lose", true);
say(
	"…and it wears the agent's own name",
	(await inside((doc) => doc.querySelector(".live-name")?.textContent ?? "")).length > 0,
	await inside((doc) => doc.querySelector(".live-name")?.textContent),
);

/*
 * The file it wrote, and the point of the whole design: it is a stub. Anything that grew
 * as the conversation did would be a write per turn, a watcher event per write, and a
 * revision history nobody asked for.
 */
const source = await page.evaluate(async (path) => (await fetch(`/api/board/${path}`)).text(), await page.locator(MIRROR).getAttribute("data-path"));
say("the file is a stub, not a transcript", source.length < 900 && source.includes('data-live="chat"'), `${source.length} bytes`);

// --- feeding it ------------------------------------------------------------------

/*
 * Turns pushed in the way the app pushes them, so the rest of this is about the board's
 * own behaviour and not about whichever conversation the fixture happens to have.
 */
const agent = await inside((doc) => doc.querySelector(".live").dataset.agent);
const feed = (from, items) =>
	page.evaluate(
		({ agent, from, items }) => {
			const frame = document.querySelector('.board-node[data-path^="boards/mirrors/"] iframe');
			frame.contentWindow.postMessage({ decks: "live.chat", agent, from, items, total: from + items.length, identity: { name: "Probe", color: "#2eaf5a" } }, "*");
		},
		{ agent, from, items },
	);

const many = [];
for (let i = 1; i <= 20; i++) {
	many.push({ kind: "user", id: `u${i}`, text: `Question ${i}`, at: 0 });
	many.push({ kind: "assistant", id: `a${i}`, text: `Answer **${i}**, long enough to take a line or two of the board it is drawn on.`, at: 0 });
}
await feed(0, many);
await settle(page, 800);

const list = () =>
	inside((doc) => {
		const box = doc.querySelector(".live-list");
		const chip = doc.querySelector(".live-new");
		return {
			turns: box.children.length,
			top: Math.round(box.scrollTop),
			max: Math.round(box.scrollHeight - box.clientHeight),
			chip: chip.hidden ? null : chip.textContent,
		};
	});

let state = await list();
say("every turn is drawn", state.turns === many.length, `${state.turns} of ${many.length}`);
say("more than fits means it scrolls", state.max > 0, `${state.max}px of overflow`);
say("and it opens at the newest turn", state.max - state.top <= 8, JSON.stringify(state));

// --- pinned to now, until you scroll away ------------------------------------------

await feed(many.length, [{ kind: "user", id: "u99", text: "one more", at: 0 }]);
await settle(page, 400);
state = await list();
say("a new turn while you are at the bottom follows", state.max - state.top <= 8 && state.turns === many.length + 1, JSON.stringify(state));

await inside((doc) => {
	doc.querySelector(".live-list").scrollTop = 40;
});
await settle(page, 300);
await feed(many.length + 1, [
	{ kind: "user", id: "u100", text: "and another", at: 0 },
	{ kind: "assistant", id: "a100", text: "and a reply", at: 0 },
]);
await settle(page, 400);
state = await list();
say("scroll away and it lets go rather than yanking you back", state.top === 40, JSON.stringify(state));
say("…and says how many you are missing", state.chip === "↓ 2 new", state.chip);

/*
 * A turn *growing* is not a turn you have missed. Without this the chip counted every
 * frame of a streaming answer, which is a number that means nothing and never stops.
 */
await feed(many.length + 2, [{ kind: "assistant", id: "a100", text: "and a reply, still arriving", at: 0, streaming: true }]);
await settle(page, 300);
state = await list();
say("a turn growing in place is not something you missed", state.chip === "↓ 2 new", state.chip);

await inside((doc) => doc.querySelector(".live-new").click());
await settle(page, 400);
state = await list();
say("pressing the chip goes back to now", state.chip === null && state.max - state.top <= 8, JSON.stringify(state));

// --- and it does not trap the canvas ------------------------------------------------

/*
 * The property the whole design leans on. `frame-gestures.ts` gives a wheel to the nearest
 * box inside a board that can still take it and hands it to the camera at the ends — so a
 * mirror scrolls under the pointer, and a flick past the last turn keeps going as a pan.
 * A board that swallowed the wheel outright would be a hole in an infinite canvas.
 */
const world = () => page.evaluate(() => document.querySelector(".world").style.transform);
const zoom = () => page.evaluate(() => Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")));

/*
 * Fly to it first, and *assert the zoom*, because below `INTERACT_ZOOM` a board takes no
 * pointer events at all: every wheel assertion below would pass for the wrong reason on a
 * canvas fitted to twenty boards, which is exactly how this check first went green.
 */
await page.locator(`${MIRROR} .chrome`).first().dblclick();
await settle(page, 900);
await page.waitForFunction(
	() =>
		document.querySelector('.board-node[data-path^="boards/mirrors/"] iframe')?.contentWindow?.__boardReady === true &&
		Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")) >= 50,
	null,
	{ timeout: 15000 },
);
say("zoomed in far enough for the board to take a wheel at all", (await zoom()) >= 50, `${await zoom()}%`);

const point = await page.evaluate(() => {
	const box = document.querySelector('.board-node[data-path^="boards/mirrors/"]').getBoundingClientRect();
	return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
});
await inside((doc) => {
	doc.querySelector(".live-list").scrollTop = 0;
});
await settle(page, 200);

const before = { camera: await world(), top: (await list()).top };
await page.mouse.move(point.x, point.y);
await page.mouse.wheel(0, 240);
await settle(page, 400);
const scrolled = await list();
say("a wheel over a mirror scrolls the mirror", scrolled.top > before.top, `${before.top} → ${scrolled.top}`);
say("…and leaves the camera alone", (await world()) === before.camera);

// Now to the end, and past it.
await inside((doc) => {
	const box = doc.querySelector(".live-list");
	box.scrollTop = box.scrollHeight;
});
await settle(page, 250);
const parked = await world();
await page.mouse.wheel(0, 240);
await settle(page, 400);
say("past the last turn the canvas takes over", (await world()) !== parked, "a mirror cannot trap the pointer");

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
