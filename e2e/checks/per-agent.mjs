/**
 * Five things that belong to a conversation and used to be shared by all of them.
 *
 * The canvas has always been per agent — it is the focused agent's in-play set — while the
 * camera was one value for the whole app. So switching swapped every board on screen and
 * left the camera exactly where the last conversation had it, and nothing refitted, because
 * the only automatic fit in the app runs once per page load. In the example deck two boards
 * sit 3009px apart, so coming back to an agent meant looking at empty canvas.
 *
 * The rules are unit-tested in `chrome/agent-view.ts`. What a browser is needed for is
 * whether they are *wired*: whether `focusAgent` parks and restores, whether the composer's
 * own text follows the agent it was typed to, and whether a question drawn over the input
 * bar belongs to one conversation rather than to whichever is on screen.
 *
 * Two agents are driven over the socket. Doing it with real ones would need two models and
 * several minutes, and the interesting states — a question outstanding for the agent you are
 * *not* looking at — cannot be produced on demand at all.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1500, height: 1000 });

await page.addInitScript(() => {
	if (window.top !== window.self) return;
	const Real = window.WebSocket;
	window.WebSocket = class extends Real {
		constructor(...args) {
			super(...args);
			window.__ws = this;
		}
	};
});
await page.reload({ waitUntil: "load" });
await settle(page, 2500);

const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
const boards = await page.evaluate(() => [...document.querySelectorAll(".board-node")].map((node) => node.dataset.path));
say("the fixture has at least two boards to be far apart", boards.length >= 2, JSON.stringify(boards));

const chat = (id, name) => ({
	id,
	name,
	kind: "claude",
	state: "idle",
	lastAt: Date.now(),
	unread: 0,
	contextCount: 1,
	capabilities: { modes: [] },
	commands: [],
});
await feed({ type: "agents", defaultKind: "pi", focused: "A", chats: [chat("A", "Ada"), chat("B", "Bo")] });
/* Deliberately different corners of the deck: `plan` at 0,0 and `deep` at 0,2440. */
await feed({ type: "context.changed", agentId: "A", boards: [boards[0]], inPlay: [boards[0]] });
await feed({ type: "context.changed", agentId: "B", boards: [boards.at(-1)], inPlay: [boards.at(-1)] });
await settle(page, 900);

/** Everything that should belong to one conversation, read in one go. */
const look = () =>
	page.evaluate(() => {
		const world = document.querySelector("[style*='translate']");
		return {
			world: world ? (world.getAttribute("style") ?? "").replace(/\s+/g, " ") : "?",
			zoom: document.querySelector('.pill [aria-label^="Zoom"]')?.textContent?.trim(),
			shown: [...document.querySelectorAll(".board-node")].map((node) => node.dataset.path),
			typed: document.querySelector("textarea")?.value ?? "",
			selected: document.querySelector('.board-node[data-selected="true"]')?.dataset.path ?? null,
			dialog: document.querySelector(".dialog-card")?.innerText?.replace(/\s+/g, " ").trim() ?? null,
		};
	});

const goTo = async (name) => {
	await page.evaluate(() => {
		const trigger = [...document.querySelectorAll(".float.pill button")].find((button) => /^Agents/.test(button.getAttribute("aria-label") ?? ""));
		trigger?.click();
	});
	await page.waitForSelector(".popover", { timeout: 4000 });
	await page.locator('.popover [data-agent="true"]').filter({ hasText: name }).first().click();
	await settle(page, 900);
};

// --- set up a distinct view, draft, selection and question for Ada ------------------

await page.keyboard.press("0");
await settle(page, 700);
await page.locator("textarea").first().fill("meant for Ada");
await page.locator(".board-node .chrome").first().click();
await settle(page, 350);
await feed({ type: "extension.ui.prompt", agentId: "A", prompt: { id: "q1", method: "confirm", title: "Run it?", message: "asked of Ada" } });
await settle(page, 500);

const ada = await look();
say("Ada has a view, a draft, a selection and a question", Boolean(ada.selected) && ada.typed === "meant for Ada" && ada.dialog?.includes("Run it?"), JSON.stringify({ ...ada, world: undefined }));

// --- switch to Bo: none of it should have come along --------------------------------

await goTo("Bo");
const bo = await look();

say("the canvas swapped, as it always did", JSON.stringify(bo.shown) !== JSON.stringify(ada.shown), JSON.stringify(bo.shown));
/*
 * The reported bug. It used to be byte-identical here: the boards changed and the camera did
 * not, leaving the viewport thousands of pixels from the only board on screen.
 */
say("…and the camera went with it", bo.world !== ada.world, `${ada.zoom} → ${bo.zoom}`);
/*
 * The sharpest of the five: a half-written prompt used to follow you, addressed to the new
 * agent and one Enter from being sent to a conversation it was not written for.
 */
say("your draft did not follow you", bo.typed === "", JSON.stringify(bo.typed));
say("…nor did the selection", bo.selected === null, JSON.stringify(bo.selected));
/*
 * The question was Ada's. It used to be drawn over whichever conversation you were in, and
 * the card could not say whose it was because the frame carried no id.
 */
say("…nor Ada's question", bo.dialog === null, JSON.stringify(bo.dialog));

// --- and Bo's own draft stays Bo's ---------------------------------------------------

await page.locator("textarea").first().fill("meant for Bo");
await settle(page, 250);

// --- back to Ada: everything exactly as it was --------------------------------------

await goTo("Ada");
const back = await look();

say("the view comes back exactly, not as a fresh fit of it", back.world === ada.world && back.zoom === ada.zoom, `${ada.zoom} → ${back.zoom}`);
say("…the draft comes back to the agent it was written for", back.typed === "meant for Ada", JSON.stringify(back.typed));
say("…the selection with it", back.selected === ada.selected, JSON.stringify(back.selected));
say("…and the question is still waiting where it was asked", back.dialog?.includes("Run it?"), JSON.stringify(back.dialog));

await goTo("Bo");
say("and Bo's own draft was parked, not lost", (await look()).typed === "meant for Bo");

// --- an agent with an empty canvas does not move the camera -------------------------

/*
 * Moving to look at nothing is worse than not moving: the view would jump for no reason and
 * land nowhere. This is also the common case for a brand-new agent, which would otherwise
 * throw the camera on every `+`.
 */
const before = await look();
await feed({ type: "agents", defaultKind: "pi", focused: "B", chats: [chat("A", "Ada"), chat("B", "Bo"), chat("C", "Cass")] });
await feed({ type: "context.changed", agentId: "C", boards: [], inPlay: [] });
await settle(page, 500);
await goTo("Cass");
const empty = await look();
say("switching to an agent with an empty canvas leaves the camera alone", empty.world === before.world, `${before.zoom} → ${empty.zoom}`);
say("…and its canvas really is empty", empty.shown.length === 0, JSON.stringify(empty.shown));

// --- a question for an agent you are not looking at ---------------------------------

/*
 * Cass asks while you are in Cass; then a question arrives for Ada. Only the one belonging to
 * the conversation on screen is drawn — the other is reported by the agent list, not by a
 * dialog over somebody else's transcript.
 */
await feed({ type: "extension.ui.prompt", agentId: "A", prompt: { id: "q2", method: "confirm", title: "Second question", message: "also Ada's" } });
await settle(page, 500);
say("a background agent's question does not appear over your conversation", (await look()).dialog === null, JSON.stringify((await look()).dialog));

await goTo("Ada");
const asked = await look();
say("…and is there when you go to that conversation", asked.dialog?.includes("Run it?") || asked.dialog?.includes("Second question"), JSON.stringify(asked.dialog));

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
