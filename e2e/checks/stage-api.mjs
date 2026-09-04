/**
 * The agent's half of the tiers: `attach` and `show` from inside `stage_eval`.
 *
 * Needs a model. The user-facing half — hiding, the rail click, the empty-context fallback
 * — is in tiers.mjs and needs nothing.
 */
import { ask, deckState, emptyCanvas, newAgent, open, openPanel, say, settle } from "../harness.mjs";

const deck = await deckState();
const two = deck.boards.map((board) => board.path).slice(0, 2);
/* The panel's rows say a basename, and the canvas's nodes carry the path. Comparing the two
   lists means coming down to the same thing — the directory is the same for every row and
   spending a third of a 264px panel restating it is what the old rail did. */
const base = (path) => path.split("/").pop();

const { browser, page, errors } = await open({ width: 1600, height: 1000 });
const onCanvas = () => page.evaluate(() => [...document.querySelectorAll(".board-node")].map((n) => n.dataset.path).sort());
// `.nm` — the row says a board's *basename*, and that is the class it says it in. It was
// `.file`, which the panel's rows have never rendered; the two lists were compared as two
// empty arrays and matched.
/*
 * The focused agent's own rows: the panel's first two sections.
 *
 * `.nm` because that is the class a row says its basename in — it used to ask for
 * `.board-row .file`, which the panel has never rendered. `:not([data-kind="deck"])` is what
 * separates "what this agent holds" from "what there is" now that the Context and Deck tabs
 * are three headings in one list.
 */
const inPanel = () =>
	page.evaluate(() =>
		[...document.querySelectorAll('.panel-section:not([data-kind="deck"]) .board-row .nm')].map((n) => n.textContent).sort(),
	);

// A fresh agent, so nothing it holds is inherited.
await newAgent(page);
await settle(page, 1200);
await page.mouse.move(800, 500);
// A fresh agent holds nothing, so its canvas is empty until it attaches something.
await emptyCanvas(page);

await ask(page, `With one stage_eval call, attach ${two[0]} and ${two[1]}, then return stage.inPlay().`);
// The panel has to be up for its rows to exist at all — it is a panel now, not a rail that
// was always mounted.
await openPanel(page, "context");
await settle(page, 400);
say("attaching narrows the canvas to what is held", (await onCanvas()).join() === two.slice().sort().join(), (await onCanvas()).join(" "));
say("the panel lists the same two", (await inPanel()).join() === two.map(base).sort().join(), (await inPanel()).join(" "));

await ask(page, `With one stage_eval call, show only ${two[0]}.`);
say("show narrows the canvas further", (await onCanvas()).join() === two[0], (await onCanvas()).join(" "));
say("…and the panel still lists both", (await inPanel()).length === 2, (await inPanel()).join(" "));

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
