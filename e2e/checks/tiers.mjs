/**
 * The three tiers (DESIGN §2), driven the way a user drives them.
 *
 * `board.play` attaches as well as showing, so the whole thing can be set up over the
 * socket — no model needed. The agent-side half (`attach`/`show` from `stage_eval`) is
 * checked in stage-api.mjs, which does need one.
 */
import { deckState, emptyCanvas, newAgent, open, openAllBoards, openPanel, say, settle, socket } from "../harness.mjs";

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
 * `:not([data-kind="other"])` is load-bearing. The Context tab ends with one section per
 * *other* agent that holds something — the answer to "then where is that board" — so a
 * selector that takes every row in the list reads somebody else's holdings as this agent's.
 */
const mine = () =>
	page.evaluate(() => [...document.querySelectorAll('.panel-section:not([data-kind="other"]) .board-row .nm')].map((n) => n.textContent).sort());

/** Every row in the list, whichever tab is up. Both tabs draw into the same `.panel-list`. */
const listed = () => page.evaluate(() => [...document.querySelectorAll(".panel-list .board-row .nm")].map((n) => n.textContent).sort());

/*
 * A fresh agent holds nothing, so it puts nothing on the canvas. The canvas used to fall
 * back to every board, which claimed the agent was working from all of them and made its
 * first act — narrowing to one — look like boards disappearing.
 *
 * The context panel used to fall back the same way, on the argument that it was the only
 * place to find a board so it had to list every one. That is the Deck tab's job now — it was
 * an all-canvases modal when this check was written — which lets both surfaces say what is
 * true rather than one of them saying two things depending on state nobody is looking at:
 * the Context tab is the agent's holdings, the Deck tab is every board there is.
 */
await newAgent(page);
await settle(page, 1200);
await emptyCanvas(page);
say("an agent holding nothing puts nothing on the canvas", (await onCanvas()).length === 0, (await onCanvas()).join(" ") || "(empty)");

await openPanel(page, "context");
say("…and the context tab lists nothing of its own", (await mine()).length === 0, (await mine()).join(" ") || "(empty)");
say(
	"…saying so rather than looking broken",
	(await page.locator(".panel-shell").innerText()).includes("not holding any boards"),
	"the line is keyed on the agent's own sections, so the tail of other agents' holdings does not suppress it",
);

await openAllBoards(page);
say("the whole deck is in the Deck tab, which is where you find a board", (await listed()).join() === names.join(), (await listed()).join(" "));
await openPanel(page, "context");
await page.mouse.move(800, 500);

// Holding two boards narrows the canvas to them.
const two = paths.slice(0, 2);
const link = await socket();
for (const path of two) link.send({ type: "board.play", path });
await page.waitForFunction((wanted) => document.querySelectorAll(".board-node").length === wanted, two.length, { timeout: 8000 });
say("the canvas narrows to what the agent holds", (await onCanvas()).join() === two.join(), (await onCanvas()).join(" "));
await openPanel(page, "context");
say("the context tab lists the same two", (await mine()).join() === two.map(base).sort().join(), (await mine()).join(" "));

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
say("…without dropping it from the agent's context", (await mine()).length === 2, (await mine()).join(" "));

// Clicking a thumbnail in the context panel puts it back.
await openPanel(page, "context");
await page.locator(`.panel-section:not([data-kind="other"]) .board-row:has(.nm:text-is("${base(first)}"))`).first().click();
await page.waitForFunction((wanted) => Boolean(document.querySelector(`.board-node[data-path="${wanted}"]`)), first, { timeout: 8000 });
await page.mouse.move(800, 500);
say("clicking a rail item plays it", (await onCanvas()).includes(first), (await onCanvas()).join(" "));

link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
