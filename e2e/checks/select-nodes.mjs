/**
 * Phase 3: what a press means in the editor's frame.
 *
 * The whole check is presses through the frame — no calling into the editor, no reaching for internals —
 * because the thing being checked is a *gesture*, and a gesture is only right if a real press makes it
 * happen. Four answers and one non-answer:
 *
 * - a **container** is selected (a card);
 * - a **leaf** is a leaf (a paragraph inside it);
 * - a press **inside a drawn panel** resolves to the panel — what the script drew has no handle — and
 *   offers its **source**, which is the text the file holds;
 * - a press on **empty space** clears the selection, because the body is not a component;
 * - and in **browse** nothing is selected at all, which is what makes the two modes one board rather
 *   than two.
 *
 * It also pins the two properties the design leans on: the frame carries the gate
 * (`data-decks-edit`), and the affordance is an *attribute* on the selected element rather than
 * anything the editor draws into the board.
 */
import { chromium } from "playwright";
import { WEB, say } from "../harness.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(`${WEB}/editor.html?board=${encodeURIComponent("boards/plan.html")}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__editorDev?.loaded === true, null, { timeout: 20000 });

const board = page.frameLocator(".board-frame");
const selection = () => page.evaluate(() => window.__editorDev?.selection ?? null);
const gate = () => board.locator("html").getAttribute("data-decks-edit");
const marked = () => board.locator("[data-node-selected]").count();

// --- browse ---------------------------------------------------------------------------------
await board.locator('[data-id="goal"]').click();
say("in browse, a press selects nothing", (await selection()) === null, JSON.stringify(await selection()));
say("and the gate is not on the frame", (await gate()) === null, `data-decks-edit=${await gate()}`);
say("so nothing is outlined", (await marked()) === 0, `${await marked()} outlined`);

// --- edit -----------------------------------------------------------------------------------
await page.locator("#mode").click();

/*
 * A press **on a node's own box** selects that node; a press on its content selects the content.
 *
 * Which is why this presses the card's corner rather than its middle: the middle of a card is inside
 * its paragraph, and descending to the paragraph is the rule — the same rule Figma has, and the one
 * that lets a person select the text they are looking at without first selecting the box around it.
 * The first version of this check pressed the centre and failed, correctly.
 */
await board.locator('[data-id="goal"]').click({ position: { x: 4, y: 4 } });
const card = await selection();
say(
	"in edit, a press on a card's own box selects the container, by path",
	card?.kind === "container" && card?.id === "goal" && Array.isArray(card?.path),
	JSON.stringify(card),
);
say("the gate is on the frame", (await gate()) !== null, `data-decks-edit=${await gate()}`);
say("and the selected element carries the affordance", (await marked()) === 1, `${await marked()} outlined`);

await board.locator('[data-id="goal"] p').first().click();
const leaf = await selection();
say(
	"…and a press on the card's own paragraph descends into it, one step deeper",
	leaf?.kind === "leaf" && leaf.path.length === card.path.length + 1,
	JSON.stringify(leaf),
);

/*
 * The panel, and the rule that matters most here.
 *
 * `[data-md]` is drawn by `board.js` — so the elements inside it are the script's and carry no handle.
 * That the rendered content exists at all is the first thing asserted: it proves the scripts ran in
 * the editor's frame. Then a press *inside* that content has to resolve to the panel itself.
 */
const drawn = await board.locator("[data-md] > *").count();
say("the panel is drawn in the editor's frame, so its script ran", drawn > 0, `${drawn} element(s) inside [data-md]`);
const inside = drawn > 0 ? board.locator("[data-md] > *").first() : board.locator("[data-md]").first();
await inside.click();
const panel = await selection();
say(
	"a press inside a drawn panel offers the panel, not the script's elements",
	panel?.kind === "projection",
	JSON.stringify(panel ? { kind: panel.kind, path: panel.path } : null),
);
say(
	"…and its source is what the file holds there",
	typeof panel?.source === "string" && panel.source.trim().length > 0,
	JSON.stringify((panel?.source ?? "").slice(0, 60)),
);

await board.locator("body").click({ position: { x: 12, y: 12 } });
say("a press on empty space clears the selection", (await selection()) === null, JSON.stringify(await selection()));
say("and takes the affordance with it", (await marked()) === 0, `${await marked()} outlined`);

/*
 * And the first write: a node, its address, and an op.
 *
 * Not a drag — that is phase 5 — but the whole path out of the editor: the selection is a node, the node
 * has a path counted in the tree, the op carries that path and the style it is changing, and nothing
 * else about the element is in it. What the app will send is this object.
 */
await board.locator('[data-id="goal"]').click({ position: { x: 4, y: 4 } });
await page.locator("#nudge").click();
const op = await page.evaluate(() => window.__editorDev?.ops?.at(-1) ?? null);
say(
	"an edit leaves as an op: the path from the body, and the style it changes",
	op?.op === "set" && Array.isArray(op?.path) && typeof op?.style?.left === "string",
	JSON.stringify(op),
);
say(
	"…and the path is the one the selection reported",
	JSON.stringify(op?.path) === JSON.stringify((await selection())?.path),
	`op ${JSON.stringify(op?.path)} vs selection ${JSON.stringify((await selection())?.path)}`,
);
say(
	"…with the element's other style kept, because the op changes one attribute of one element",
	op?.style?.top === "168px" && op?.style?.left === "56px",
	JSON.stringify(op?.style),
);
say(
	"…and no markup of the element in it: this op cannot re-spell the thing it edits",
	!("html" in (op ?? {})) && !("model" in (op ?? {})),
	JSON.stringify(Object.keys(op ?? {})),
);

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
