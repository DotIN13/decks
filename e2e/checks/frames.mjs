/**
 * A frame you can put things into and take them out of, and a panel for how it holds them.
 *
 * A frame was a one-way door: a drag wrote an item's x and y and never its parent, and a child's
 * x and y are measured from its frame's corner — so dragging one out slid it out of sight inside
 * a frame that clips. The `move` op has always taken a parent; this is the drag finally asking.
 *
 * Needs no model: the items go on over the wire as `stage.pen.edit`, the same operation an agent
 * makes, and everything after that is the pointer and the panel.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deckState, editMode, open, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

await resetStage();
const deck = await deckState();
const { browser, page, errors } = await open({ width: 1500, height: 950 });
await settle(page, 1500);
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);

link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "note", id: "frames-anchor", content: "x" }, box: { x1: -4000, y1: -4000 } }] });
const frame = await until(() => link.received.filter((m) => m.type === "stage.pen" && m.agentId === agentId && m.doc.children.some((n) => n.id === "frames-anchor")).at(-1));
const file = frame ? join(deck.path, "stages", frame.stage, "stage.pen") : "";
/*
 * The stage file as it is now. Tolerant of a torn read: the server rewrites it while a check is
 * polling, and reading it mid-write once crashed a whole check on a JSON error. The last good
 * answer stands until the next complete one.
 */
let lastGood = { children: [] };
const onDisk = () => {
	if (!existsSync(file)) return { children: [] };
	try {
		lastGood = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		/* half-written; the poll comes round again */
	}
	return lastGood;
};
/** Where an item sits in the tree: the id of its parent, or null at the top. */
const parentOf = (id) => {
	const walk = (nodes, parent) => {
		for (const node of nodes ?? []) {
			if (node.id === id) return parent;
			const deeper = walk(node.children, node.id);
			if (deeper !== undefined) return deeper;
		}
		return undefined;
	};
	return walk(onDisk().children, null);
};
say("the stage has a file to draw in", existsSync(file), file);

await editMode(page, true);

const spot = await page.evaluate(() => {
	const stage = document.querySelector(".stage");
	const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
	const empty = (x, y) => document.elementFromPoint(x, y) === stage;
	for (let y = 170; y < 780; y += 40) {
		for (let x = 380; x < 1300; x += 40) {
			if (empty(x, y) && empty(x + 560, y) && empty(x, y + 340) && empty(x + 560, y + 340)) return { x: (x - m.e) / m.a, y: (y - m.f) / m.a };
		}
	}
});
say("the canvas has room for a frame and a note beside it", !!spot);

if (spot) {
	const at = { x: Math.round(spot.x), y: Math.round(spot.y) };
	link.send({
		type: "stage.pen.edit",
		agentId,
		ops: [
			{ op: "insert", node: { type: "frame", id: "f-box", name: "Frame", layout: "none", fill: "#ffffff", stroke: "#d0d7de", strokeWidth: 1, cornerRadius: 12, clip: true }, box: { x1: at.x, y1: at.y, x2: at.x + 300, y2: at.y + 220 } },
			{ op: "insert", node: { type: "rectangle", id: "f-note", name: "Note", fill: "#fde68a", cornerRadius: 6 }, box: { x1: at.x + 400, y1: at.y + 40, x2: at.x + 500, y2: at.y + 110 } },
		],
	});
	const both = await until(() => (onDisk().children.some((n) => n.id === "f-box") && onDisk().children.some((n) => n.id === "f-note") ? true : undefined));
	say("a frame and a loose item start side by side at the top of the file", !!both, JSON.stringify({ note: parentOf("f-note"), frame: parentOf("f-box"), layout: onDisk().children.find((n) => n.id === "f-box")?.layout, clip: onDisk().children.find((n) => n.id === "f-box")?.clip }));

	const boxOf = (id) => page.evaluate((one) => globalThis.__decksPenBox?.(one), id);
	const middleOf = async (id) => {
		const box = await boxOf(id);
		return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : undefined;
	};

	// --- in: dragging the loose item onto the frame makes it a child -------------------------------
	const from = await middleOf("f-note");
	const into = await middleOf("f-box");
	const wouldTake = await page.evaluate(([x, y]) => globalThis.__decksFrameUnder?.(x, y), [into.x, into.y]);
	say("both are on screen to drag between", !!from && !!into, JSON.stringify({ from, into, wouldTake }));
	if (from && into) {
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move((from.x + into.x) / 2, (from.y + into.y) / 2, { steps: 6 });
		await settle(page, 200);
		const holding = await page.evaluate(() => document.querySelectorAll(".pen-selection:not([data-board])").length);
		say("the press picked the item up rather than starting a marquee", holding === 1, `outlines ${holding}`);
		// The frame says it would take it, before anything is let go: the gesture has to be legible.
		const lit = await page.evaluate(() => document.querySelectorAll('.pen-join[data-drop="frame"]').length);
		await page.mouse.move(into.x, into.y, { steps: 6 });
		await settle(page, 150);
		const during = await page.evaluate(() => ({
			joins: document.querySelectorAll(".pen-join").length,
			drops: document.querySelectorAll('.pen-join[data-drop="frame"]').length,
			carried: globalThis.__decksPenBox?.("f-note")?.x,
			selection: document.querySelectorAll(".pen-selection:not([data-board])").length,
		}));
		await page.mouse.up();
		const refused = link.received.filter((m) => m.type === "notice").map((m) => m.text);
		say("the frame lights up while the item is over it", during.drops === 1, JSON.stringify({ midDrag: lit, atDrop: during, refused }));
		const inside = await until(() => (parentOf("f-note") === "f-box" ? true : undefined));
		say("dropping it on the frame makes it a child of the frame in the file", !!inside, `parent ${parentOf("f-note")}`);
		// And it is where it was dropped, not at the frame's corner: the box travels in stage pixels.
		const landed = await until(async () => {
			const box = await boxOf("f-note");
			return box && Math.abs(box.x + box.width / 2 - into.x) < 24 ? box : undefined;
		});
		say("…and it is where it was let go, not at the frame's corner", !!landed && Math.abs(landed.y + landed.height / 2 - into.y) < 24, JSON.stringify(landed && { x: Math.round(landed.x), y: Math.round(landed.y), wanted: Math.round(into.x) }));
	}

	// --- out: dragging it clear of the frame puts it back on the stage -----------------------------
	await page.keyboard.press("Escape");
	await settle(page, 700);
	const child = await middleOf("f-note");
	const frameBox = await boxOf("f-box");
	if (child && frameBox) {
		const out = { x: frameBox.x + frameBox.width + 140, y: frameBox.y + 40 };
		await page.mouse.move(child.x, child.y);
		await page.mouse.down();
		await page.mouse.move((child.x + out.x) / 2, out.y, { steps: 6 });
		await page.mouse.move(out.x, out.y, { steps: 6 });
		await settle(page, 150);
		await page.mouse.up();
		const loose = await until(() => (parentOf("f-note") === null ? true : undefined));
		say("dragging it clear of the frame puts it back on the stage", !!loose, `parent ${parentOf("f-note")}`);
		const after = await until(async () => {
			const box = await boxOf("f-note");
			return box && box.width > 0 && Math.abs(box.x + box.width / 2 - out.x) < 24 ? box : undefined;
		});
		say("…and it is visible where it was let go, not clipped away inside", !!after, JSON.stringify({ got: after && Math.round(after.x), wanted: Math.round(out.x) }));
	}

	// --- the frame's own panel --------------------------------------------------------------------
	const frameMiddle = await middleOf("f-box");
	if (frameMiddle) {
		await page.keyboard.press("Escape");
		await settle(page, 200);
		// Its edge, not its middle, which is where the item it holds would be.
		const box = await boxOf("f-box");
		await page.mouse.click(box.x + 6, box.y + box.height / 2);
		const panel = await until(() => page.evaluate(() => {
			const section = document.querySelector('[data-section="layout"]');
			return section ? { buttons: [...section.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean) } : undefined;
		}));
		say("a selected frame has a Layout section", !!panel, JSON.stringify(panel?.buttons?.slice(0, 6)));
		if (panel) {
			say("…whose words are CSS: a direction, a size that can fit its content, and overflow", ["none", "column", "row", "fit-content", "hidden"].every((word) => panel.buttons.includes(word)), JSON.stringify(panel.buttons));
			await page.evaluate(() => {
				const section = document.querySelector('[data-section="layout"]');
				[...section.querySelectorAll("button")].find((b) => b.textContent?.trim() === "column")?.click();
			});
			const stacked = await until(() => (onDisk().children.find((n) => n.id === "f-box")?.layout === "vertical" ? true : undefined));
			say("…and pressing column writes pen's own vertical layout to the file", !!stacked, JSON.stringify(onDisk().children.find((n) => n.id === "f-box")?.layout));
			// A frame that follows its children keeps a floor, so emptying it leaves something to drop into.
			await page.evaluate(() => {
				const group = document.querySelector('[data-section="layout"] [aria-label="height"]');
				[...group.querySelectorAll("button")].find((b) => b.textContent?.trim() === "fit-content")?.click();
			});
			const floor = await until(() => (String(onDisk().children.find((n) => n.id === "f-box")?.height ?? "").startsWith("fit_content(") ? true : undefined));
			say("…and pressing fit-content writes a hug with a floor under it", !!floor, JSON.stringify(onDisk().children.find((n) => n.id === "f-box")?.height));
		}
	}

	// --- a frame that stacks: the frame tool's own default, and a drop that takes a place in it ----
	await page.keyboard.press("Escape");
	await settle(page, 300);
	/*
	 * Drawn with the tool, not sent over the wire: the default is the point of this act. A hand-made
	 * frame is a column, so a drop into it is a place in an order rather than a pixel, and the line
	 * between two children is what says which place.
	 */
	await page.click('.pen-tools button[data-tool="frame"]');
	const room = await page.evaluate(() => {
		const stage = document.querySelector(".stage");
		const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
		const empty = (x, y) => document.elementFromPoint(x, y) === stage;
		for (let y = 200; y < 680; y += 40) for (let x = 420; x < 1150; x += 40) if (empty(x, y) && empty(x + 240, y + 200) && empty(x + 420, y + 60)) return { at: { x, y }, world: { x: (x - m.e) / m.a, y: (y - m.f) / m.a } };
	});
	say("the canvas has room for a column and an item beside it", !!room, JSON.stringify(room?.at));
	if (room) {
		await page.mouse.move(room.at.x, room.at.y);
		await page.mouse.down();
		await page.mouse.move(room.at.x + 240, room.at.y + 200, { steps: 8 });
		await page.mouse.up();
		const made = await until(() => onDisk().children.find((n) => n.type === "frame" && n.id !== "f-box"));
		say("a frame drawn with the tool is a column", made?.layout === "vertical", JSON.stringify(made && { layout: made.layout, gap: made.gap, padding: made.padding, radius: made.cornerRadius, height: made.height }));
		// Its corner is a card's 12 plus its own padding, so a card dropped in sits concentric with it.
		say("…padded 18, with a corner that nests a card's inside it", made?.padding === 18 && made?.cornerRadius === 30, JSON.stringify({ padding: made?.padding, radius: made?.cornerRadius }));
		say("…with a height in pixels, so an empty one is something to drop into", typeof made?.height === "number" && made.height > 0, JSON.stringify(made?.height));
		if (made) {
			await page.keyboard.press("Escape");
			await settle(page, 200);
			link.send({
				type: "stage.pen.edit",
				agentId,
				ops: [
					{ op: "insert", parent: made.id, node: { type: "rectangle", id: "s-one", fill: "#bfdbfe" }, box: { x1: room.world.x + 20, y1: room.world.y + 20, x2: room.world.x + 160, y2: room.world.y + 70 } },
					{ op: "insert", parent: made.id, node: { type: "rectangle", id: "s-two", fill: "#bbf7d0" }, box: { x1: room.world.x + 20, y1: room.world.y + 90, x2: room.world.x + 160, y2: room.world.y + 140 } },
					{ op: "insert", node: { type: "rectangle", id: "s-new", fill: "#fecaca" }, box: { x1: room.world.x + 420, y1: room.world.y + 30, x2: room.world.x + 540, y2: room.world.y + 80 } },
				],
			});
			const three = await until(() => (parentOf("s-two") === made.id && parentOf("s-new") === null ? true : undefined));
			say("the column holds two children, with a third loose beside it", !!three, JSON.stringify({ one: parentOf("s-one"), two: parentOf("s-two"), loose: parentOf("s-new") }));
			const now = await until(async () => {
				const all = { one: await boxOf("s-one"), two: await boxOf("s-two"), carry: await boxOf("s-new") };
				return all.one && all.two && all.carry && all.carry.width > 0 ? all : undefined;
			});
			say("all three are on screen", !!now, JSON.stringify(now && { one: Math.round(now.one.y), two: Math.round(now.two.y), carry: Math.round(now.carry.x) }));
			if (now) {
				// Aim at the gap between the two children: the drop should take the place between them.
				const gap = { x: now.one.x + now.one.width / 2, y: (now.one.y + now.one.height + now.two.y) / 2 };
				await page.mouse.move(now.carry.x + now.carry.width / 2, now.carry.y + now.carry.height / 2);
				await page.mouse.down();
				await page.mouse.move(gap.x + 40, gap.y - 20, { steps: 6 });
				await page.mouse.move(gap.x, gap.y, { steps: 6 });
				await settle(page, 200);
				const line = await page.evaluate(() => {
					const one = document.querySelector(".pen-insert");
					if (!one) return undefined;
					const box = one.getBoundingClientRect();
					return { w: Math.round(box.width), h: Math.round(box.height), y: Math.round(box.y) };
				});
				await page.mouse.up();
				say("a line shows which place in the column the drop would take", !!line && line.w > line.h, JSON.stringify(line));
				const order = await until(() => {
					const kids = (onDisk().children.find((n) => n.id === made.id)?.children ?? []).map((n) => n.id);
					return kids.length === 3 ? kids : undefined;
				});
				say("the drop lands between the two, not at the end", !!order && order[1] === "s-new", JSON.stringify(order));
			}
			link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: made.id }] });
		}
		await page.keyboard.press("Escape");
		await settle(page, 300);
	}

	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "f-note" }, { op: "delete", id: "f-box" }] });
}

link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "frames-anchor" }] });
await settle(page, 300);
await editMode(page, false);
link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
