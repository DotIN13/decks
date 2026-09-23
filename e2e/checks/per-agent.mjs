/**
 * Each agent has a stage of its own, and switching agent is switching stage.
 *
 * One agent, one stage: the boards on screen are the focused agent's in-play set, where they
 * sit is that agent's arrangement, and the server keeps both in the agent's own record. So a
 * switch swaps every board on screen, and the camera has to go with them — the only automatic
 * fit in the app runs once per page load, and two agents working in different corners of a
 * deck used to mean coming back to one of them and looking at empty canvas 3000px from
 * anything. The camera rules are unit-tested in `camera/agent-view.ts`; what a browser is
 * needed for is whether they are *wired*: whether `focusAgent` parks and restores the view,
 * whether the composer's own text follows the agent it was typed to, and whether a question
 * drawn over the input bar belongs to one conversation rather than to whichever is on screen.
 *
 * The three agents are real ones, made and given their boards over the socket, because what
 * this check is about is that the *server* keeps a stage per agent — fed frames would only
 * prove the browser can draw one. None of them is ever prompted, so no model is needed. The
 * questions are fed: a question outstanding for the agent you are *not* looking at cannot be
 * produced on demand any other way.
 */
import { deckState, open, ready, say, settle, socket, still } from "../harness.mjs";

const { browser, page, errors, stopAnswering } = await open({ width: 1500, height: 1000 });
/* The harness presses Allow on any dialog it sees, and this check is about dialogs being left alone. */
stopAnswering();

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
/* The init script only runs in a new document, and `open` has already loaded this one. */
await page.reload({ waitUntil: "load" });
await ready(page);
await settle(page, 800);

const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));

/** Wait for something the socket will say, instead of sleeping through it. */
const until = async (test, what, timeout = 15000) => {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const found = test();
		if (found) return found;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`per-agent: waited ${timeout}ms for ${what}`);
};

const link = await socket();
const home = await until(() => link.last("agents")?.focused, "the greeting to name the focused agent");
const paths = (await deckState()).boards.map((board) => board.path);
say("the fixture has at least two boards to be far apart", paths.length >= 2, JSON.stringify(paths));

/*
 * Make an agent, name it, and give it a board — all as the socket, which is on the new agent
 * from the moment it is made (`agent.create` focuses it for the browser that asked, and this
 * socket is that browser). The page is not moved: its focus is its own.
 *
 * Moved after it is played, and far apart: a board joining an empty stage is placed in the
 * middle of that agent's view (`deck/place.ts`), so two fresh agents would otherwise put their
 * boards in the same spot and a switch between them would not have to move the camera at all.
 */
const make = async (name, path, y) => {
	const known = new Set((link.last("agents")?.chats ?? []).map((chat) => chat.id));
	link.send({ type: "agent.create" });
	const id = await until(() => (link.last("agents")?.chats ?? []).find((chat) => !known.has(chat.id))?.id, `${name} to exist`);
	link.send({ type: "agent.rename", id, name });
	if (path) {
		link.send({ type: "board.play", path });
		link.send({ type: "board.move", path, x: 0, y });
	}
	/* A rename is answered with the agent's identity, not a new list. */
	await until(() => link.received.some((m) => m.type === "agent.identity" && m.id === id && m.identity?.name === name), `${name} to be called that`);
	return id;
};
const adaBoard = paths[0];
const boBoard = paths.at(-1);
const A = await make("Ada", adaBoard, 0);
const B = await make("Bo", boBoard, 3200);

/** Everything that should belong to one conversation, read in one go. */
const look = () =>
	page.evaluate(() => {
		const world = document.querySelector(".world");
		return {
			world: world ? (world.getAttribute("style") ?? "").replace(/\s+/g, " ") : "?",
			zoom: document.querySelector('.pill [aria-label^="Zoom"]')?.textContent?.trim(),
			shown: [...document.querySelectorAll(".board-node")].map((node) => node.dataset.path),
			typed: document.querySelector(".dockfield")?.textContent ?? "",
			selected: document.querySelector('.board-node[data-selected="true"]')?.dataset.path ?? null,
			dialog: document.querySelector(".dialog-card")?.innerText?.replace(/\s+/g, " ").trim() ?? null,
		};
	});

/*
 * Switch the way a person does: the composer's recipient chip opens the agent list, and a
 * pick there goes to that agent's stage — the same as pressing its row in the panel.
 *
 * Done when the stage shows exactly the boards the agent is known to have up and the camera
 * has stopped: the boards arrive with the server's answer to `agent.focus`, and the camera
 * waits for them. Not thrown on a timeout, so a switch that shows the wrong boards is reported
 * by the assertion that says so rather than by a stack trace.
 */
const goTo = async (name, expected) => {
	await page.locator(".dock-to-chip").click();
	await page.waitForSelector(".popover", { timeout: 4000 });
	await page.locator('.popover [data-agent="true"]').filter({ hasText: name }).first().click();
	await page
		.waitForFunction(
			(wanted) => JSON.stringify([...document.querySelectorAll(".board-node")].map((node) => node.dataset.path).sort()) === JSON.stringify(wanted),
			[...expected].sort(),
			{ timeout: 10000 },
		)
		.catch(() => {});
	await settle(page, 400);
	await still(page);
	if (expected.length) await ready(page);
};

// --- Ada's stage is Ada's -------------------------------------------------------------

const first = await look();
await goTo("Ada", [adaBoard]);
const arrived = await look();
say(
	"picking Ada from the chip shows Ada's stage: her one board, and none of what was up before",
	JSON.stringify(arrived.shown) === JSON.stringify([adaBoard]),
	`${first.shown.length} boards -> ${JSON.stringify(arrived.shown)}`,
);
say("…and the chip now addresses her", /^to Ada/.test((await page.locator(".dock-to").getAttribute("data-dest")) ?? ""), await page.locator(".dock-to").getAttribute("data-dest"));

// --- set up a distinct view, draft, selection and question for Ada ------------------

/*
 * Fit through the button, and then wait for the camera to stop. `0` on the keyboard is the
 * same verb and only works when the cursor is not in a field — after an open it usually is,
 * so the fit quietly did nothing and the check ran on whatever view the page loaded with.
 */
await page.locator('[aria-label="Fit the boards on the canvas"]').click();
await still(page);
await settle(page, 300);
await page.locator(".dockfield").fill("meant for Ada");
await page.locator(".board-node .chrome").first().click();
await page.waitForSelector('.board-node[data-selected="true"]', { timeout: 5000 });
await settle(page, 350);
await feed({ type: "extension.ui.prompt", agentId: A, prompt: { id: "q1", method: "confirm", title: "Run it?", message: "asked of Ada" } });
await settle(page, 500);

const ada = await look();
say("Ada has a view, a draft, a selection and a question", Boolean(ada.selected) && ada.typed === "meant for Ada" && ada.dialog?.includes("Run it?"), JSON.stringify({ ...ada, world: undefined }));

// --- switch to Bo: none of it should have come along --------------------------------

await goTo("Bo", [boBoard]);
const bo = await look();

say("switching to Bo swaps the stage for his", JSON.stringify(bo.shown) === JSON.stringify([boBoard]), JSON.stringify(bo.shown));
/*
 * The bug this check was first written for. It used to be byte-identical here: the boards
 * changed and the camera did not, leaving the viewport thousands of pixels from the only board
 * on screen.
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

await page.locator(".dockfield").fill("meant for Bo");
await settle(page, 250);

// --- back to Ada: everything exactly as it was --------------------------------------

await goTo("Ada", [adaBoard]);
const back = await look();

say("back on Ada, her stage is hers again", JSON.stringify(back.shown) === JSON.stringify([adaBoard]), JSON.stringify(back.shown));
say("…and the view comes back exactly, not as a fresh fit of it", back.world === ada.world && back.zoom === ada.zoom, `${ada.zoom} → ${back.zoom}`);
say("…the draft comes back to the agent it was written for", back.typed === "meant for Ada", JSON.stringify(back.typed));
say("…the selection with it", back.selected === ada.selected, JSON.stringify(back.selected));
say("…and the question is still waiting where it was asked", back.dialog?.includes("Run it?"), JSON.stringify(back.dialog));

/*
 * And the server has it too. Which agent a browser is on is remembered by the server rather
 * than written in the address — there is nothing in the URL that could say which one — so a
 * reload lands on the same agent's stage.
 */
await page.reload({ waitUntil: "load" });
await ready(page);
await settle(page, 600);
const reloaded = await look();
say("a reload lands on the same agent's stage", JSON.stringify(reloaded.shown) === JSON.stringify([adaBoard]), JSON.stringify(reloaded.shown));

await goTo("Bo", [boBoard]);
/* A reload starts the browser's memory over, drafts included: this is about the switch, not the reload. */
await page.locator(".dockfield").fill("meant for Bo");
await goTo("Ada", [adaBoard]);
await goTo("Bo", [boBoard]);
say("and Bo's own draft was parked, not lost", (await look()).typed === "meant for Bo", JSON.stringify((await look()).typed));

// --- an agent with an empty stage does not move the camera --------------------------

/*
 * Moving to look at nothing is worse than not moving: the view would jump for no reason and
 * land nowhere. This is also the common case for a brand-new agent, which would otherwise
 * throw the camera on every `+`.
 */
const C = await make("Cass");
await settle(page, 300);
const beforeEmpty = await look();
await goTo("Cass", []);
const empty = await look();
say("switching to an agent with an empty stage leaves the camera alone", empty.world === beforeEmpty.world, `${beforeEmpty.zoom} → ${empty.zoom}`);
say("…and its stage really is empty", empty.shown.length === 0, JSON.stringify(empty.shown));

// --- a question for an agent you are not looking at ---------------------------------

/*
 * A question arrives for Ada while you are in Cass. Only the one belonging to the
 * conversation on screen is drawn — the other is reported by the agent list, not by a
 * dialog over somebody else's transcript.
 */
await feed({ type: "extension.ui.prompt", agentId: A, prompt: { id: "q2", method: "confirm", title: "Second question", message: "also Ada's" } });
await settle(page, 500);
say("a background agent's question does not appear over your conversation", (await look()).dialog === null, JSON.stringify((await look()).dialog));

await goTo("Ada", [adaBoard]);
const asked = await look();
say("…and is there when you go to that conversation", asked.dialog?.includes("Second question"), JSON.stringify(asked.dialog));

/*
 * Leave the deck as it was found for the checks after this one. The socket goes back to the
 * agent the page opened on first — which also makes that the conversation a new browser
 * starts on — so the three removals are of agents nobody is on and move no one's focus.
 */
link.send({ type: "agent.focus", id: home });
for (const id of [A, B, C]) link.send({ type: "agent.remove", id });
await until(() => !(link.last("agents")?.chats ?? []).some((chat) => [A, B, C].includes(chat.id)), "the three agents to be removed").catch(() => {});

link.close();
say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
