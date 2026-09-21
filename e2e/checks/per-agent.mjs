/**
 * What belongs to a conversation, and what belongs to the room it is held in.
 *
 * A stage is a canvas now, and several agents work on one. So the line moved: the **room**
 * owns the boards, the camera and the selection, and the **conversation** owns the draft,
 * the transcript and any question its agent has asked. Switching agent is a change of
 * addressee — `?agent=` in the hash — and it must leave the room exactly as it was, which is
 * the opposite of what this check used to assert: the canvas swapping under a switch was the
 * behaviour when a canvas was one agent's in-play set.
 *
 * What a browser is needed for is whether that is *wired*: whether the view survives a
 * switch, whether the composer's text follows the agent it was typed to, and whether a
 * question drawn over the input bar belongs to one conversation rather than to whichever is
 * on screen.
 *
 * Two agents are driven over the socket. Doing it with real ones would need two models and
 * several minutes, and the interesting states — a question outstanding for the agent you are
 * *not* looking at — cannot be produced on demand at all.
 */
import { deckState, open, ready, say, settle, socket, still, WEB } from "../harness.mjs";

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

/*
 * A room of this check's own, because a canvas is shared now.
 *
 * Every other check opens the canvas the fixture's first agent works on, and several of
 * them put boards up and take boards down while they run. That was invisible while the
 * canvas drew one agent's in-play set — each check had its own — and it is not now: a board
 * arriving under this one's cursor moved the boards it was about to press, and a board
 * *leaving* took the selection with it. So this check makes a canvas, puts two of the
 * fixture's boards on it, and opens that.
 */
const link = await socket();
link.send({ type: "canvas.create", name: `Per-agent ${Date.now()}` });
await settle(page, 600);
const room = link.last("canvases")?.focused;
if (!room) throw new Error("per-agent: the server made no canvas to work in");
const deck = await deckState();
const wanted = deck.boards.map((board) => board.path).slice(0, 2);
// The socket is looking at the canvas it just made, so a play lands there (`wire/canvas.ts`).
for (const path of wanted) link.send({ type: "board.play", path });
await settle(page, 500);

/*
 * `goto` then `reload`, and the second one is not belt-and-braces: the only difference
 * between this URL and the one the page is on is the hash, which is a same-document
 * navigation — so the init script above, added after `open()`, would never run and
 * `window.__ws` would not exist. The reload is what makes it a new document.
 */
await page.goto(`${WEB}/#/canvas/${room}`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await ready(page);
await settle(page, 1500);

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
	identity: { name, color: "#3b5cf6" },
	boards: ["boards/plan.html"],
	inPlay: [],
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
			typed: document.querySelector(".dockfield")?.textContent ?? "",
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

/*
 * Fit through the button, and then wait for the camera to stop.
 *
 * It was `keyboard.press("0")`, which is the same verb and only works when the cursor is
 * not in a field — and after an open it usually is, so the fit quietly did nothing and this
 * check ran on whatever view the page had loaded with. That was invisible while the canvas
 * held one agent's boards and is not now: the room is shared, so a board another check puts
 * up can be the first in the list and a thousand pixels off screen. The press is a press on
 * the control, and `still` is the stage's own answer to "has it arrived".
 */
await page.locator('[aria-label="Fit the boards on the canvas"]').click();
await still(page);
await settle(page, 300);
await page.locator(".dockfield").fill("meant for Ada");
/*
 * Waited for rather than slept through, and not pinned to one path.
 *
 * The canvas is the room's now, so another check running beside this one can put a board on
 * it or take one off while this one is pressing: a named board may be gone by the time it is
 * clicked, and a fixed wait after the press can end before the mark arrives. Press whatever
 * is first *now*, and wait for something to be selected.
 */
await page.locator(".board-node .chrome").first().click();
await page.waitForSelector('.board-node[data-selected="true"]', { timeout: 5000 });
await settle(page, 350);
await feed({ type: "extension.ui.prompt", agentId: "A", prompt: { id: "q1", method: "confirm", title: "Run it?", message: "asked of Ada" } });
await settle(page, 500);

const ada = await look();
say("Ada has a view, a draft, a selection and a question", Boolean(ada.selected) && ada.typed === "meant for Ada" && ada.dialog?.includes("Run it?"), JSON.stringify({ ...ada, world: undefined }));

// --- switch to Bo: none of it should have come along --------------------------------

await goTo("Bo");
const bo = await look();

/*
 * The room stays. Both of these were the other way round while a canvas was one agent's: the
 * boards swapped and the camera had to be made to follow them. In a room a switch is a change
 * of addressee, and a canvas that rearranged itself when you spoke to somebody else would be
 * the strongest possible argument that the boards are not really shared.
 */
say("the boards stay: they are the room's, not the agent's", JSON.stringify(bo.shown) === JSON.stringify(ada.shown), JSON.stringify(bo.shown));
say("…and so does the camera", bo.world === ada.world, `${ada.zoom} → ${bo.zoom}`);
say("…and the selection, which is a board in the room", bo.selected === ada.selected, JSON.stringify(bo.selected));
/*
 * The sharpest of the five: a half-written prompt used to follow you, addressed to the new
 * agent and one Enter from being sent to a conversation it was not written for.
 */
say("your draft did not follow you", bo.typed === "", JSON.stringify(bo.typed));
/*
 * The question was Ada's. It used to be drawn over whichever conversation you were in, and
 * the card could not say whose it was because the frame carried no id.
 */
say("…nor Ada's question", bo.dialog === null, JSON.stringify(bo.dialog));

// --- and Bo's own draft stays Bo's ---------------------------------------------------

await page.locator(".dockfield").fill("meant for Bo");
await settle(page, 250);

// --- back to Ada: everything exactly as it was --------------------------------------

await goTo("Ada");
const back = await look();

say("the view is where you left it, having never moved", back.world === ada.world && back.zoom === ada.zoom, `${ada.zoom} → ${back.zoom}`);
say("…the draft comes back to the agent it was written for", back.typed === "meant for Ada", JSON.stringify(back.typed));
say("…and the question is still waiting where it was asked", back.dialog?.includes("Run it?"), JSON.stringify(back.dialog));

await goTo("Bo");
say("and Bo's own draft was parked, not lost", (await look()).typed === "meant for Bo");

// --- an agent that has put nothing up is addressed in the room it is addressed from ----

/*
 * The case that used to throw the camera: a brand-new agent holds nothing, and a canvas made
 * of its holdings would be empty. In a room there is nothing to empty — the boards are the
 * canvas's — so the only thing that changes is who the bar is talking to.
 */
const before = await look();
await feed({ type: "agents", defaultKind: "pi", focused: "B", chats: [chat("A", "Ada"), chat("B", "Bo"), chat("C", "Cass")] });
await feed({ type: "context.changed", agentId: "C", boards: [], inPlay: [] });
await settle(page, 500);
await goTo("Cass");
const empty = await look();
say("switching to an agent that holds nothing leaves the camera alone", empty.world === before.world, `${before.zoom} → ${empty.zoom}`);
say("…and the room's boards are still on screen", JSON.stringify(empty.shown) === JSON.stringify(before.shown), JSON.stringify(empty.shown));

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

link.close();
say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
