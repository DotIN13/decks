/**
 * The three tiers (DESIGN §2), driven the way a user drives them.
 *
 * `board.play` attaches as well as showing, so the whole thing can be set up over the
 * socket — no model needed. The agent-side half (`attach`/`show` from `stage_eval`) is
 * checked in stage-api.mjs, which does need one.
 */
import { deckState, newAgent, open, openAllBoards, openPanel, say, settle, socket } from "../harness.mjs";

const deck = await deckState();
const paths = deck.boards.map((board) => board.path).sort();

const { browser, page, errors } = await open({ width: 1600, height: 1000 });
const onCanvas = () => page.evaluate(() => [...document.querySelectorAll(".board-node")].map((n) => n.dataset.path).sort());

/*
 * A row says a board's *basename*, so a check that wants to compare against the deck has to
 * come down to the same thing. `boards/plan.html` is the path everywhere else in this file,
 * and the panel draws `plan.html` — the directory is the same for every row and spending a
 * third of a 264px panel restating it was what the old rail did.
 */
const base = (path) => path.split("/").pop();
const names = paths.map(base).sort();

/**
 * The focused agent's own rows: the "on the canvas" and "held, not shown" sections.
 *
 * `:not([data-kind="deck"])` is the whole of the difference between "what this agent is
 * working from" and "what there is". The panel is one list now — the two tabs were the same
 * list with a line through it — so the line lives in this selector instead, which is where
 * it was always doing its work.
 */
const mine = () =>
	page.evaluate(() =>
		[...document.querySelectorAll('.panel-section:not([data-kind="deck"]) .board-row .row-name')].map((n) => n.textContent).sort(),
	);

/** Every row in the list, all three sections of it. */
const listed = () => page.evaluate(() => [...document.querySelectorAll(".panel-list .board-row .row-name")].map((n) => n.textContent).sort());

/*
 * The canvas is the room's, and the panel says the same thing about it.
 *
 * `inPlay` used to be one agent's, so the two surfaces could be made to disagree by
 * switching agent; both read the canvas now. The deck is the last section of the list,
 * always there under whatever is up, so the panel is never a list of nothing.
 */
await openPanel(page);
say("the canvas shows the room's boards", (await onCanvas()).join() === paths.join(), (await onCanvas()).join(" "));
say("…and the panel's own headings say the same", (await mine()).join() === names.join(), (await mine()).join(" "));

await openAllBoards(page);
say("every board is reachable from here, which is where you find one", (await listed()).join() === names.join(), (await listed()).join(" "));
await page.mouse.move(800, 500);

/*
 * A new agent joins the room it was made in.
 *
 * It used to make a canvas of its own, named after the chat, and the boards on screen went
 * away — which is what "the canvas is one agent's in-play set" looked like from the front.
 * An agent made while looking at a canvas is put on it (`wire/agents.ts`), so the room is
 * unchanged and the only thing that moved is who the bar is talking to.
 */
const roomBefore = await onCanvas();
await newAgent(page);
await settle(page, 1200);
say("a new agent joins the room rather than emptying it", (await onCanvas()).join() === roomBefore.join(), (await onCanvas()).join(" ") || "(empty)");
/*
 * And it is called something nothing else is called.
 *
 * Every unnamed chat used to be `Agent`, which is an address two of them shared: `@Agent`
 * from the bar could mean either. The roster is read off a fresh socket, because the
 * greeting carries it and this is a fact about the server rather than about the pill.
 */
const roster = await socket();
await settle(page, 600);
const chats = (roster.last("agents")?.chats ?? []).filter((chat) => chat.role !== "dispatcher");
roster.close();
const chatNames = chats.map((chat) => chat.name);
say("…with a number of its own: Agent 1, Agent 2", chatNames.every((name) => /^Agent \d+$/.test(name)), JSON.stringify(chatNames));
say("…and no two chats share one", new Set(chatNames.map((name) => name.toLowerCase())).size === chatNames.length, JSON.stringify(chatNames));
await openPanel(page);
say("…and the room's boards are still what the panel lists", (await mine()).join() === names.join(), (await mine()).join(" "));

// Two more plays land on the canvas the browser is looking at, whoever sent them.
const two = paths.slice(0, 2);
const link = await socket({ canvas: true });
for (const path of two) link.send({ type: "board.play", path });
await settle(page, 800);
say("a board played again is not a second copy of it", (await onCanvas()).join() === paths.join(), (await onCanvas()).join(" "));
await openPanel(page, "context");

// The hide button on a board takes it off the canvas, and the rail keeps it.
//
// Fitted first, on purpose: it is at a board's top-right corner, so with the camera left
// wherever the previous check put it the button can sit off-screen or exactly where the
// neighbouring board begins — which is a fact about the camera, not about hiding.
const first = two[0];
await page.locator(`.board-node[data-path="${first}"] .chrome`).hover();
await page.locator(`.board-node[data-path="${first}"] .chrome .hide`).click();
await page.waitForFunction((wanted) => !document.querySelector(`.board-node[data-path="${wanted}"]`), first, { timeout: 8000 });
say("the hide button takes a board off the canvas", !(await onCanvas()).includes(first), `canvas=${(await onCanvas()).join(" ") || "(empty)"}`);
/*
 * And it is still in the panel, under a different heading.
 *
 * Which heading depends on who holds it: a board an agent has read falls to `Held, not
 * shown`, and one that was only ever *up* — which is what a board played onto the room is —
 * falls back to `In the deck`. Both are the list; the tier it lands in is the point of
 * having three.
 */
say("…without dropping it from the list", (await listed()).includes(base(first)), (await listed()).join(" "));

// Clicking its row in the panel puts it back on the canvas.
await openPanel(page, "context");
await page.locator(`.panel-list .board-row:has(.row-name:text-is("${base(first)}"))`).first().click();
await page.waitForFunction((wanted) => Boolean(document.querySelector(`.board-node[data-path="${wanted}"]`)), first, { timeout: 8000 });
await page.mouse.move(800, 500);
say("clicking a rail item plays it", (await onCanvas()).includes(first), (await onCanvas()).join(" "));

link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
