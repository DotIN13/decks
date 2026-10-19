/**
 * Drag (or copy) anything out of a board and it lands on the canvas as the drawing's own item.
 *
 * Playwright cannot lift a text selection with the mouse, so the drags are dispatched: a real
 * `DataTransfer`, a `dragstart` inside the board's frame (which `board.js` fills with its clip),
 * then `dragover` and `drop` on the canvas in the app's document, as a browser sends them when a
 * drag leaves a same-origin frame. Pastes are a `paste` with a `DataTransfer` as its clipboard.
 *
 * What is asserted is the canvas file, read with `canvas.read`: each item's type, its words or its
 * card's blocks, a picture's fill, `metadata.source`, and its size against the size on the board.
 */
import { writeFileSync } from "node:fs";
import { API, deckState, editMode, open, resetStage, rest, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

const BOARD = "boards/drag-fixture.html";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const deck = await deckState();
writeFileSync(`${deck.path}/assets/drag-fixture.png`, PNG);
writeFileSync(
	`${deck.path}/${BOARD}`,
	`<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Drag fixture</title>
<meta name="board" content='{"w":900,"h":760,"bg":"plain"}' />
<link rel="stylesheet" href="../lib/board.css" />
<style>.board .doc { padding: 24px 30px; font-size: 16px } img { display: block; width: 160px; height: 80px } table { border-collapse: collapse }</style>
</head><body class="board"><div class="doc" data-id="doc">
<h2 id="title" data-id="title">Why pans stalled</h2>
<p id="para" data-id="para">Each new tile made the engine <b>redraw with 4 samples</b>, so a <a href="https://example.com/pan">pan</a> stopped.</p>
<ul id="list" data-id="list"><li>Tiles painted once</li><li>One sample when <i>idle</i></li><li>A check that pans</li></ul>
<table id="table" data-id="table"><tr><th>Stage</th><th>Before</th><th>After</th></tr><tr><td>Herobrine</td><td>58 ms</td><td>9 ms</td></tr><tr><td>Rust</td><td>41 ms</td><td>7 ms</td></tr></table>
<pre id="code" data-id="code" data-lang="rust">fn samples() -> u32 { 4 }</pre>
<img id="pic" data-id="pic" src="../assets/drag-fixture.png" alt="Frame times" />
<p id="edit" data-id="edit" contenteditable="true">Editable words stay put.</p>
</div><script src="../lib/board.js"></script></body></html>
`,
);
// The server lists the new board, then every board goes on the stage.
await until(async () => (await deckState()).boards.some((board) => board.path === BOARD), 15000);
const everyBoard = await resetStage();

// Not waited on for every board to be ready: the fixture is far away until it is moved, and is waited on below.
const { browser, page, errors } = await open({ width: 1500, height: 1100, boards: false });
await rest(page, { start: 0 });
const said = [];
page.on("console", (message) => message.type() !== "debug" && said.push(`${message.type()}: ${message.text()}`.slice(0, 300)));

const call = async (verb, args = [], headers = {}) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ args }) })).json();
const me = (await call("agent.me", [], { "x-decks-person": "1" })).value;
const agent = { "x-decks-agent": me.id };
const items = async () => (await call("canvas.read", [], agent)).value?.items ?? [];

// The board far from the others, an anchor 1400 to its right, and the view on both: the band between is bare canvas.
const link = await socket();
// The other boards off this stage: each live page holds connections, and a page waiting behind them never came.
for (const path of everyBoard) if (path !== BOARD) link.send({ type: "board.hide", path });
link.send({ type: "board.move", path: BOARD, x: 40000, y: 40000 });
await until(async () => (await items()).find((item) => item.board === BOARD)?.box?.x1 === 40000);
await call("canvas.insert", [{ type: "note", id: "dfb-anchor", content: "anchor" }, { at: { x1: 42300, y1: 40000 } }], agent);
const madeCard = await call("canvas.insert", [{ type: "frame", id: "dfb-card", name: "Card", width: 320, layout: "vertical", gap: 16, padding: 20, cornerRadius: 12, metadata: { type: "decks.card" }, children: [{ type: "text", id: "dfb-c1", content: "First block", fontSize: 16, textGrowth: "fixed-width", width: "fill_container", metadata: { type: "decks.markdown" } }, { type: "text", id: "dfb-c2", content: "Second block", fontSize: 16, textGrowth: "fixed-width", width: "fill_container", metadata: { type: "decks.markdown" } }] }, { at: { x1: 41950, y1: 40450 } }], agent);
say("a card to drop on is on the canvas", madeCard.ok, JSON.stringify(madeCard).slice(0, 300));
// The screen is the person's for a few seconds after the harness touched it.
await settle(page, 6500);
const focused = await call("view.focus", [[BOARD, "dfb-anchor"]], agent);
say("the view is on the fixture board and the canvas beside it", focused.ok, JSON.stringify(focused).slice(0, 200));
await rest(page);
const boardReady = () => page.evaluate((path) => document.querySelector(`iframe[data-path="${path}"]`)?.contentWindow?.__boardReady === true, BOARD);
let live = await until(boardReady, 12000);
// A page that has not come in a while (a busy fixture server) is asked for again.
if (!live) {
	await call("view.reload", [{ board: BOARD }], agent);
	live = await until(boardReady, 20000);
}
say("the fixture board is live", live, live ? "" : JSON.stringify(await page.evaluate((path) => document.querySelector(`iframe[data-path="${path}"]`)?.contentWindow?.location.href, BOARD)));
await settle(page, 400);

/** A stage point on the screen, from the engine's camera (its x, y are the stage point at the window's middle). */
const screenOf = (x, y) =>
	page.evaluate(
		({ x, y }) => {
			const cam = globalThis.__decksRust.camera;
			return { x: innerWidth / 2 + (x - cam.x) * cam.zoom, y: innerHeight / 2 + (y - cam.y) * cam.zoom, zoom: cam.zoom };
		},
		{ x, y },
	);

/**
 * A drag out of the board onto the canvas. `pick` says what is picked up: a selection from one node
 * to another (`from`/`to`: a selector, a child index or a path of them, an offset; `node` selects
 * that element's contents), or an element dragged by itself (`element`). Answers what the page saw.
 */
const drag = (pick, to) =>
	page.evaluate(
		({ path, pick, to }) => {
			const frame = document.querySelector(`iframe[data-path="${path}"]`);
			const win = frame.contentWindow;
			const doc = frame.contentDocument;
			const nodeAt = ([selector, ...steps]) => steps.reduce((node, i) => node.childNodes[i], doc.querySelector(selector));
			const selection = win.getSelection();
			selection.removeAllRanges();
			let target;
			let range;
			if (pick.node || pick.from) {
				range = doc.createRange();
				if (pick.node) range.selectNodeContents(doc.querySelector(pick.node));
				else {
					range.setStart(nodeAt(pick.from[0]), pick.from[1]);
					range.setEnd(nodeAt(pick.to[0]), pick.to[1]);
				}
				selection.addRange(range);
				target = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
			} else target = doc.querySelector(pick.element);
			const box = (range ?? target).getBoundingClientRect();
			const dt = new DataTransfer();
			// A dispatched drag's DataTransfer ignores `effectAllowed`; what the board asked for is recorded instead.
			let effect = "unset";
			Object.defineProperty(dt, "effectAllowed", { configurable: true, get: () => effect, set: (value) => (effect = value) });
			target.dispatchEvent(new win.DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.left + 1, clientY: box.top + 1 }));
			const types = [...dt.types];
			const hit = document.elementFromPoint(to.x, to.y);
			const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: to.x, clientY: to.y };
			hit.dispatchEvent(new DragEvent("dragenter", at));
			const over = new DragEvent("dragover", at);
			hit.dispatchEvent(over);
			const ghost = document.querySelector(".stage .clip-ghost");
			const slot = document.querySelector(".stage .clip-slot");
			const preview = {
				accepted: over.defaultPrevented,
				ghost: ghost && getComputedStyle(ghost).display !== "none" ? ghost.textContent : "",
				ghostBox: ghost ? [ghost.offsetWidth, ghost.offsetHeight] : [],
				slot: slot && getComputedStyle(slot).display !== "none" ? slot.textContent : "",
			};
			hit.dispatchEvent(new DragEvent("drop", at));
			target.dispatchEvent(new win.DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
			selection.removeAllRanges();
			return { types, effect, preview, width: box.width, height: box.height, text: range ? range.toString() : "" };
		},
		{ path: BOARD, pick, to },
	);

/** The item made since `before`, found by a test on it. */
const made = (before, test) =>
	until(async () => {
		const now = await items();
		return now.find((item) => !before.some((old) => old.id === item.id) && test(item));
	}, 10000);
const near = (a, b, slack = 2) => Math.abs(a - b) <= slack;
const source = (item, block) => item?.metadata?.source?.board === BOARD && item.metadata.source.block === block;

let before = await items();
// Where each one lands: drags apart from every card made before them, so none drops into one.
const SPOTS = { words: [41000, 39700], heading: [41000, 39850], list: [41000, 40000], table: [41400, 40000], code: [41800, 40000], image: [41850, 40250], multi: [41000, 40400], markdown: [41000, 40750], plain: [41500, 40750], png: [41800, 39650], copy: [41500, 41000] };
const spot = async (name) => {
	const [x, y] = SPOTS[name];
	return { ...(await screenOf(x, y)), world: { x, y } };
};

// Words picked in a paragraph: a text item, bold and link kept, as wide as on screen, remembering the board.
{
	const to = await spot("words");
	const seen = await drag({ from: [["#para", 0], 5], to: [["#para", 4], 3] }, to);
	say("the board writes a clip, HTML and text, and the drag is a copy", seen.types.includes("application/x-decks-clip") && seen.types.includes("text/html") && seen.types.includes("text/plain") && seen.effect === "copy", JSON.stringify(seen.types) + seen.effect);
	say("while over the canvas the preview names what will land", seen.preview.accepted && /text item/.test(seen.preview.ghost), JSON.stringify(seen.preview));
	const item = await made(before, (one) => one.type === "text" && source(one, "para"));
	say("words land as a text item, bold and link kept", item?.content === "new tile made the engine **redraw with 4 samples**, so a [pan](https://example.com/pan) st", JSON.stringify(item?.content));
	say("…a markdown text, remembering its board and block", item?.metadata?.type === "decks.markdown" && source(item, "para"), JSON.stringify(item?.metadata));
	say("…at the width it had on screen", near(item?.width, Math.round(seen.width * 1.06 + 8), 3), `${item?.width} vs ${seen.width}`);
	say("…at the board's size of words", item?.fontSize === 16, String(item?.fontSize));
	say("…where it was dropped", near(item?.box?.x1, to.world.x - 1, 3) && near(item?.box?.y1, to.world.y - 1, 3), JSON.stringify(item?.box));
	before = await items();
}

// A heading: a text item at its size.
{
	const to = await spot("heading");
	await drag({ node: "#title" }, to);
	const item = await made(before, (one) => one.type === "text" && source(one, "title"));
	say("a heading lands as a text item with its level", item?.content === "## Why pans stalled", JSON.stringify(item?.content));
	before = await items();
}

// Two items of a list: a card with that list.
{
	const to = await spot("list");
	await drag({ from: [["#list", 0, 0], 0], to: [["#list", 1, 1, 0], 4] }, to);
	const card = await made(before, (one) => one.type === "frame" && source(one, "list"));
	say("two list items land as a card", card?.metadata?.type === "decks.card" && card.layout === "vertical", JSON.stringify(card?.metadata));
	say("…holding just those items as one list block", card?.children?.length === 1 && card.children[0].content === "- Tiles painted once\n- One sample when *idle*", JSON.stringify(card?.children?.map((c) => c.content)));
	before = await items();
}

// Two rows of a table: a card with a table, the header row added.
{
	const to = await spot("table");
	await drag({ from: [["#table", 0, 1, 0, 0], 0], to: [["#table", 0, 2, 2, 0], 4] }, to);
	const card = await made(before, (one) => one.type === "frame" && source(one, "table"));
	say("two table rows land as a card with the header row over them", card?.children?.[0]?.content === "| Stage | Before | After |\n| --- | --- | --- |\n| Herobrine | 58 ms | 9 ms |\n| Rust | 41 ms | 7 ms |", JSON.stringify(card?.children?.[0]?.content));
	before = await items();
}

// A selection across blocks: a card of each part in order.
{
	const to = await spot("multi");
	await drag({ from: [["#title", 0], 0], to: [["#list", 2, 0], 7] }, to);
	const card = await made(before, (one) => one.type === "frame" && source(one, "doc"));
	const kinds = card?.children?.map((child) => child.content.split("\n")[0]) ?? [];
	say("a selection across blocks lands as one card, each block in order", kinds.length === 3 && kinds[0] === "## Why pans stalled" && kinds[1].startsWith("Each new tile") && kinds[2] === "- Tiles painted once", JSON.stringify(kinds));
	say("…with its blocks at the board's size, as wide as the card", card?.children?.every((child) => child.fontSize === 16 && child.width === "fill_container"));
	before = await items();
}

// Code: a card with a fenced block in its language.
{
	const to = await spot("code");
	await drag({ node: "#code" }, to);
	const card = await made(before, (one) => one.type === "frame" && source(one, "code"));
	say("code lands as a card with its language kept", card?.children?.[0]?.content === "```rust\nfn samples() -> u32 { 4 }\n```", JSON.stringify(card?.children?.[0]?.content));
	before = await items();
}

// A picture dragged by itself: an image item, at its size on screen, its alt text its name.
{
	const to = await spot("image");
	const seen = await drag({ element: "#pic" }, to);
	say("a picture's preview says image item", /image item/.test(seen.preview.ghost), seen.preview.ghost);
	const item = await made(before, (one) => one.type === "rectangle" && source(one, "pic"));
	say("a picture lands as an image item filled with the deck's own file", item?.fill?.type === "image" && item.fill.url === "../../assets/drag-fixture.png", JSON.stringify(item?.fill));
	say("…named by its alt text, at its size on screen", item?.name === "Frame times" && near(item?.width, 160) && near(item?.height, 80), `${item?.name} ${item?.width}x${item?.height}`);
	before = await items();
}

// Dropped on a card: a block in it.
{
	const card = (await items()).find((item) => item.id === "dfb-card");
	const box = card.box;
	const to = await screenOf((box.x1 + box.x2) / 2, box.y2 - 24);
	const seen = await drag({ from: [["#list", 2, 0], 0], to: [["#list", 2, 0], 7] }, to);
	say("over a card the preview shows the slot among its blocks", /block/.test(seen.preview.slot), JSON.stringify(seen.preview));
	const grown = await until(async () => {
		const now = (await items()).find((item) => item.id === "dfb-card");
		return now?.children?.length === 3 ? now : undefined;
	});
	say("a drop on a card adds a block to it", !!grown, JSON.stringify(grown?.children?.map((c) => c.content)));
	say("…the words picked, as a block", grown?.children?.some((child) => child.content === "A check" && child.metadata?.type === "decks.markdown"));
	before = await items();
}

// Edit mode: a drag out of an editable board copies and never cuts, and the board refuses the clip back.
{
	const result = await page.evaluate((path) => {
		const frame = document.querySelector(`iframe[data-path="${path}"]`);
		const win = frame.contentWindow;
		const doc = frame.contentDocument;
		const para = doc.querySelector("#edit");
		const range = doc.createRange();
		range.selectNodeContents(para);
		win.getSelection().removeAllRanges();
		win.getSelection().addRange(range);
		const dt = new DataTransfer();
		let effect = "unset";
		Object.defineProperty(dt, "effectAllowed", { configurable: true, get: () => effect, set: (value) => (effect = value) });
		let dropEffect = "unset";
		Object.defineProperty(dt, "dropEffect", { configurable: true, get: () => dropEffect, set: (value) => (dropEffect = value) });
		para.dispatchEvent(new win.DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
		const over = new win.DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt });
		para.dispatchEvent(over);
		const drop = new win.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
		para.dispatchEvent(drop);
		para.dispatchEvent(new win.DragEvent("dragend", { bubbles: true, dataTransfer: dt, }));
		win.getSelection().removeAllRanges();
		return { effect, refused: over.defaultPrevented && dropEffect === "none" && drop.defaultPrevented, text: para.textContent };
	}, BOARD);
	say("a drag out of an editable board is a copy", result.effect === "copy", result.effect);
	say("…the board refuses a clip dropped on it", result.refused);
	say("…and keeps its words", result.text === "Editable words stay put.", result.text);
}

/** A paste on the canvas: with the pointer at `at` (or off the canvas), the clipboard holding `fill`'s data. */
const paste = (at, fill) =>
	page.evaluate(
		({ at, fill }) => {
			const stage = document.querySelector(".stage");
			if (at) stage.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: at.x, clientY: at.y }));
			else stage.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
			const dt = new DataTransfer();
			for (const [type, value] of Object.entries(fill.data ?? {})) dt.setData(type, value);
			if (fill.png) dt.items.add(new File([Uint8Array.from(atob(fill.png), (c) => c.charCodeAt(0))], "shot.png", { type: "image/png" }));
			stage.focus();
			const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
			stage.dispatchEvent(event);
			return event.defaultPrevented;
		},
		{ at, fill },
	);
// Nothing selected, as a person who has just clicked bare canvas.
{
	const bare = await screenOf(40450, 41150);
	await page.mouse.click(bare.x, bare.y);
	await page.keyboard.press("Escape");
	await settle(page, 200);
}

{
	const to = await spot("markdown");
	const taken = await paste(to, { data: { "text/plain": "- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```" } });
	const card = await made(before, (one) => one.type === "frame" && one.children?.some((child) => child.content === "- one\n- two"));
	say("pasted markdown is read: a card with a list, a table and code", taken && card?.children?.length === 3 && card.children[1].content.startsWith("| a | b |") && card.children[2].content.startsWith("```ts"), JSON.stringify(card?.children?.map((c) => c.content)));
	say("…under the pointer", near(card?.box?.x1, to.world.x, 3) && near(card?.box?.y1, to.world.y, 3), JSON.stringify(card?.box));
	before = await items();
}
{
	const to = await spot("plain");
	await paste(to, { data: { "text/plain": "Just a sentence from another app." } });
	const item = await made(before, (one) => one.type === "text" && one.content === "Just a sentence from another app.");
	say("pasted plain text lands as a text item", item?.metadata?.type === "decks.markdown", JSON.stringify(item));
	before = await items();
}
{
	const to = await spot("png");
	await paste(to, { png: PNG.toString("base64") });

	const item = await made(before, (one) => one.type === "rectangle" && /shot/.test(one.fill?.url ?? ""));
	say("a pasted screenshot lands as an image item, saved next to the canvas", item?.fill?.type === "image" && /^\.\.\/\.\.\/assets\/shot/.test(item.fill.url), JSON.stringify(item?.fill ?? (await items()).filter((one) => !before.some((old) => old.id === one.id))));
	before = await items();
}
{
	// ⌘C on the board writes the clip; ⌘V on the canvas makes what a drag would.
	const copied = await page.evaluate((path) => {
		const frame = document.querySelector(`iframe[data-path="${path}"]`);
		const win = frame.contentWindow;
		const doc = frame.contentDocument;
		const list = doc.querySelector("#list");
		const range = doc.createRange();
		range.setStart(list.childNodes[1].firstChild, 0);
		range.setEnd(list.childNodes[2].firstChild, 7);
		win.getSelection().removeAllRanges();
		win.getSelection().addRange(range);
		const dt = new DataTransfer();
		doc.dispatchEvent(new win.ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: dt }));
		win.getSelection().removeAllRanges();
		return Object.fromEntries([...dt.types].map((type) => [type, dt.getData(type)]));
	}, BOARD);
	say("⌘C on a board writes its clip with HTML and words", !!copied["application/x-decks-clip"] && !!copied["text/html"] && !!copied["text/plain"], Object.keys(copied).join(", "));
	const to = await spot("copy");
	await paste(to, { data: copied });
	const card = await made(before, (one) => one.type === "frame" && source(one, "list"));
	say("…and ⌘V on the canvas lands it as a drag would", card?.children?.[0]?.content === "- One sample when *idle*\n- A check", JSON.stringify(card?.children?.map((c) => c.content)));
	before = await items();
}
{
	// The pointer off the canvas: the middle of the screen. ⇧⌘V: plain text, nothing in it meaning anything.
	const r = await page.evaluate(() => document.querySelector(".stage").getBoundingClientRect().toJSON());
	await page.evaluate(() => document.querySelector(".stage").focus());
	// The key alone, as a person's ⇧⌘V sends it before its paste (a real one would read the machine's clipboard).
	await page.evaluate(() => document.querySelector(".stage").dispatchEvent(new KeyboardEvent("keydown", { key: "v", metaKey: true, shiftKey: true, bubbles: true })));
	await paste(null, { data: { "text/plain": "- not a *list*" } });
	const item = await made(before, (one) => one.type === "text" && /not a/.test(one.content ?? ""));
	say("⇧⌘V pastes plain text: nothing in it is markdown", item?.content === "\\- not a \\*list\\*", JSON.stringify(item?.content ?? (await items()).filter((one) => !before.some((old) => old.id === one.id))));
	const middle = await page.evaluate(({ r }) => {
		const cam = globalThis.__decksRust.camera;
		return { x: cam.x + (r.left + r.width / 2 - innerWidth / 2) / cam.zoom, y: cam.y + (r.top + r.height / 2 - innerHeight / 2) / cam.zoom };
	}, { r });
	const box = item?.box;
	say("…in the middle of the screen when the pointer is not over the canvas", box && near((box.x1 + box.x2) / 2, middle.x, 60) && near((box.y1 + box.y2) / 2, middle.y, 60), JSON.stringify({ box, middle }));
	before = await items();
}

// The pill: an item from a board offers "Open in board", which selects that board.
await editMode(page, true);
{
	const item = (await items()).find((one) => one.type === "text" && source(one, "para"));
	const a = await screenOf(item.box.x1, item.box.y1);
	const b = await screenOf(item.box.x2, item.box.y2);
	await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
	const button = page.locator('.stage > .board-callout [aria-label="Open in board"]');
	const shown = await until(() => button.isVisible().catch(() => false), 4000);
	say("an item from a board has Open in board on its pill", shown);
	if (shown) {
		await page.evaluate(() => {
			const frame = [...document.querySelectorAll("iframe")].find((one) => one.dataset.path === "boards/drag-fixture.html");
			const win = frame?.contentWindow;
			const own = win.__decksFlash;
			win.__decksFlash = (block) => ((globalThis.__flashed = block), own(block));
		});
		await button.click();
		const flashed = await until(() => page.evaluate(() => globalThis.__flashed), 6000);
		say("…which goes to the board and outlines the block it came from", flashed === "para", String(flashed));
	}
}

say("no errors on the page", errors.length === 0, errors.join(" | "));
if (process.exitCode) console.log("CONSOLE", said.slice(-30).join("\n"));
link.close?.();
await browser.close();
