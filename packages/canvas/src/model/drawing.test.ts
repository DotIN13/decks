import assert from "node:assert/strict";
import { test } from "node:test";
import { apply as applyOps, applyEdits, baseTheme, DECKS_COLORS, resolve, type PenDocument, type PenEdit } from "@decks/pen";
import { pagesAhead, pagesOf, createDrawing, PENDING_MS, together } from "./drawing.ts";

const sample = (): PenDocument => ({
	version: "2.14",
	children: [
		{ type: "note", id: "a", content: "one", x: 0, y: 0, width: 200, height: 100 },
		{ type: "browser", id: "b", name: "Plan", url: "boards/plan.html", x: 400, y: 10, width: 600, height: 400, metadata: { type: "decks.board", path: "boards/plan.html" } },
	],
});

test("an edit is applied, and reported as the edits that make the last document into the new one", () => {
	const heard: PenEdit[][] = [];
	const drawing = createDrawing(sample(), { onEdits: (edits) => heard.push(edits) });
	const before = drawing.doc();
	assert.equal(drawing.edit([{ op: "update", id: "a", set: { content: "two" } }]), true);
	assert.equal(drawing.doc().children[0]?.content, "two");
	assert.deepEqual(heard, [[{ op: "set", id: "a", key: "content", value: "two" }]]);
	// The host can replay what it heard on its own copy and arrive at the same drawing.
	assert.deepEqual(applyEdits(before, heard[0]!), drawing.doc());
});

test("undo and redo are edits too, and an edit after an undo drops the redo", () => {
	const heard: PenEdit[][] = [];
	const drawing = createDrawing(sample(), { onEdits: (edits) => heard.push(edits) });
	drawing.edit([{ op: "update", id: "a", set: { x: 50 } }]);
	drawing.step("undo");
	assert.equal(drawing.doc().children[0]?.x, 0);
	drawing.step("redo");
	assert.equal(drawing.doc().children[0]?.x, 50);
	drawing.step("undo");
	drawing.edit([{ op: "update", id: "a", set: { y: 30 } }]);
	drawing.step("redo");
	assert.equal(drawing.doc().children[0]?.x, 0, "nothing to redo after a new edit");
	assert.deepEqual(
		heard.map((edits) => edits.map((edit) => (edit.op === "set" ? `${edit.key}=${String(edit.value)}` : edit.op))),
		[["x=50"], ["x=0"], ["x=50"], ["x=0"], ["y=30"]],
	);
});

test("a refused edit changes nothing and reports nothing", () => {
	let heard = 0;
	const drawing = createDrawing(sample(), { onEdits: () => heard++ });
	const warn = console.warn;
	console.warn = () => {};
	try {
		assert.equal(drawing.edit([{ op: "update", id: "nobody", set: { x: 1 } }]), false);
	} finally {
		console.warn = warn;
	}
	assert.equal(heard, 0);
	assert.equal(drawing.doc().children.length, 2);
});

test("read-only takes no edits", () => {
	const drawing = createDrawing(sample(), { readOnly: true });
	assert.equal(drawing.edit([{ op: "delete", id: "a" }]), false);
	assert.equal(drawing.doc().children.length, 2);
});

test("a drawing from elsewhere is shown, not reported, and undo starts again from it", () => {
	let heard = 0;
	const drawing = createDrawing(sample(), { onEdits: () => heard++ });
	drawing.edit([{ op: "update", id: "a", set: { x: 5 } }]);
	const elsewhere = sample();
	elsewhere.children[0]!.content = "from another device";
	drawing.set(JSON.stringify(elsewhere));
	assert.equal(heard, 1);
	assert.equal(drawing.doc().children[0]?.content, "from another device");
	drawing.step("undo");
	assert.equal(drawing.doc().children[0]?.content, "from another device");
});

test("boards are the drawing's decks.board items, and moving one moves its item", () => {
	const drawing = createDrawing(sample());
	assert.deepEqual(
		pagesOf(drawing.doc()).map(({ path, title, x, y, w, h }) => ({ path, title, x, y, w, h })),
		[{ path: "boards/plan.html", title: "Plan", x: 400, y: 10, w: 600, h: 400 }],
	);
	drawing.movePage("boards/plan.html", 420.4, -7.6);
	drawing.resizePage("boards/plan.html", { w: 640, h: 380 });
	const board = drawing.doc().children[1]!;
	assert.deepEqual([board.x, board.y, board.width, board.height], [420, -8, 640, 380]);
});

/** A host-owned drawing, and what it sent: each edit's ops and name, each step's direction and name. */
function hosted(doc: PenDocument, answer?: (ops: unknown[], edit?: string) => void | Promise<boolean>) {
	const sent: Array<{ ops: unknown[]; edit?: string }> = [];
	const steps: Array<{ direction: string; edit?: string }> = [];
	const heard: unknown[] = [];
	const d = createDrawing(doc, {
		host: {
			send: (ops, edit) => {
				sent.push({ ops, ...(edit ? { edit } : {}) });
				return answer?.(ops, edit);
			},
			step: (direction, edit) => void steps.push({ direction, ...(edit ? { edit } : {}) }),
		},
		onEdits: (edits) => heard.push(edits),
	});
	return { d, sent, steps, heard };
}
/** The host's drawing after its server applied these ops (a copy, as a server's frame is). */
const served = (doc: PenDocument, ops: unknown[]) => applyOps(structuredClone(doc), ops as never, { theme: baseTheme(doc, "light") }).doc;
const content = (doc: PenDocument, id = "a") => (doc.children.find((one) => one.id === id) as { content?: string } | undefined)?.content;

test("a drawing the host owns shows the person's edit at once, sends it named, and keeps it until the host's drawing has it", () => {
	const { d, sent, heard } = hosted(sample());
	const host0 = d.doc();
	assert.equal(d.edit([{ op: "update", id: "a", set: { content: "two" } }]), true);
	assert.equal(sent.length, 1);
	assert.ok(sent[0]!.edit, "the edit has a name");
	assert.equal(content(d.doc()), "two", "shown before the host answers");
	assert.equal(d.waiting(), 1);
	assert.equal(d.given(), host0, "the host's drawing is still the one it gave");
	assert.deepEqual(d.editsTo(d.doc())?.edits, [{ op: "set", id: "a", key: "content", value: "two" }], "the stage is given the edit");
	// A drawing from the host that does not have it yet (another revision): the edit stays on top.
	const other = served(host0, [{ op: "update", id: "b", set: { x: 999 } }]);
	d.set(other);
	assert.equal(content(d.doc()), "two");
	assert.equal(d.doc().children[1]?.x, 999);
	// The host's drawing that has it: shown as it is, nothing on top any more.
	const answered = served(other, sent[0]!.ops);
	d.set(answered, undefined, [sent[0]!.edit!]);
	assert.equal(d.doc(), answered);
	assert.equal(d.waiting(), 0);
	assert.equal(heard.length, 0, "a host-owned drawing reports nothing as the person's own edits");
});

test("an agent's edit landing while the person's is on its way shows both, and the person's then lands", () => {
	const { d, sent } = hosted(sample());
	const host0 = d.doc();
	d.edit([{ op: "update", id: "a", set: { x: 300, y: 200 } }]);
	// The agent's edit reaches the server first: its drawing has the agent's note and not the person's move.
	const agent = served(host0, [{ op: "insert", node: { type: "note", id: "c", content: "agent" }, box: { x1: 2000, y1: 0 } }]);
	d.set(agent);
	assert.equal(d.doc().children[0]?.x, 300, "the person's move is still shown");
	assert.equal(content(d.doc(), "c"), "agent", "and the agent's note with it");
	const both = served(agent, sent[0]!.ops);
	d.set(both, undefined, [sent[0]!.edit!]);
	assert.equal(d.doc(), both);
	assert.equal(d.doc().children[0]?.x, 300);
	assert.equal(content(d.doc(), "c"), "agent");
});

test("an edit the host refuses stops being shown at once, by its answer or by name", async () => {
	let answer!: (ok: boolean) => void;
	const { d, sent } = hosted(sample(), () => new Promise<boolean>((resolve) => (answer = resolve)));
	const host0 = d.doc();
	d.edit([{ op: "update", id: "a", set: { content: "refused" } }]);
	assert.equal(content(d.doc()), "refused");
	answer(false);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(d.doc(), host0, "back to the host's drawing");
	assert.equal(d.waiting(), 0);
	// Refused by name (a step, or the socket's refusal).
	d.edit([{ op: "update", id: "a", set: { content: "again" } }]);
	d.refused(sent[1]!.edit!);
	assert.equal(content(d.doc()), "one");
	// One that no longer applies to the host's drawing goes: the host's to decide.
	d.edit([{ op: "update", id: "a", set: { content: "gone" } }]);
	d.set(served(d.given(), [{ op: "delete", id: "a" }]));
	assert.equal(d.doc().children.find((one) => one.id === "a"), undefined);
	assert.equal(d.waiting(), 0);
});

test("an edit the host never says it has is let go of: the host's drawing wins", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { d } = hosted(sample(), () => Promise.resolve(true));
	d.edit([{ op: "update", id: "a", set: { content: "lost" } }]);
	t.mock.timers.tick(PENDING_MS + 1);
	assert.equal(content(d.doc()), "one");
	assert.equal(d.waiting(), 0);
});

test("another canvas's drawing drops every edit on its way", () => {
	const { d } = hosted(sample());
	d.set(sample(), undefined, undefined, "one");
	d.edit([{ op: "insert", node: { type: "note", id: "z", content: "mine" }, box: { x1: 0, y1: 900 } }]);
	assert.equal(content(d.doc(), "z"), "mine");
	d.set({ version: "2.14", children: [] }, undefined, undefined, "two");
	assert.equal(d.doc().children.length, 0);
	assert.equal(d.waiting(), 0);
});

test("undo and redo of the person's own edit are shown at once, named, and put back when refused", () => {
	const { d, sent, steps } = hosted(sample());
	const host0 = d.doc();
	d.edit([{ op: "update", id: "a", set: { x: 50 } }]);
	const host1 = served(host0, sent[0]!.ops);
	d.set(host1, undefined, [sent[0]!.edit!]);
	d.step("undo");
	assert.equal(steps.length, 1);
	assert.ok(steps[0]!.edit, "the step has a name");
	assert.equal(d.doc().children[0]?.x, 0, "undone before the host answers");
	const host2 = structuredClone(host0);
	d.set(host2, undefined, [steps[0]!.edit!]);
	assert.equal(d.doc(), host2);
	d.step("redo");
	assert.equal(d.doc().children[0]?.x, 50, "redone before the host answers");
	d.refused(steps[1]!.edit!);
	assert.equal(d.doc(), host2, "refused: back to the host's drawing");
	// The history went with the refusal: the next step is the host's alone, not shown ahead.
	d.step("redo");
	assert.equal(steps[2]!.edit, undefined);
	assert.equal(d.doc(), host2);
});

test("the same drawing given again with the same names changes nothing", () => {
	const { d, sent, steps } = hosted(sample());
	d.edit([{ op: "update", id: "a", set: { x: 50 } }]);
	const host1 = served(d.given(), sent[0]!.ops);
	d.set(host1, undefined, [sent[0]!.edit!]);
	d.set(host1, undefined, [sent[0]!.edit!]);
	d.step("undo");
	assert.equal(d.doc().children[0]?.x, 0);
	d.set(structuredClone(sample()), undefined, [steps[0]!.edit!]);
	d.step("undo");
	assert.equal(steps[1]!.edit, undefined, "one edit to take back, heard once");
});

test("a step is not shown ahead when anything else changed the drawing since the person's edit", () => {
	const { d, sent, steps } = hosted(sample());
	d.edit([{ op: "update", id: "a", set: { x: 50 } }]);
	const host1 = served(d.given(), sent[0]!.ops);
	d.set(host1, undefined, [sent[0]!.edit!]);
	d.set(served(host1, [{ op: "update", id: "b", set: { x: 1 } }]));
	d.step("undo");
	assert.equal(steps[0]!.edit, undefined);
	assert.equal(d.doc().children[0]?.x, 50, "the host answers, and its answer is shown");
});

test("the host's boards are shown as the person's edits on their way leave them", () => {
	const given = sample();
	const shown = served(given, [{ op: "update", id: "b", set: { x: 700, y: 40 } }]);
	const list = [{ path: "boards/plan.html", title: "Plan", x: 400, y: 10, w: 600, h: 520, rev: 3, inContext: [] }];
	assert.deepEqual(pagesAhead(list, given, shown).map(({ x, y, w, h }) => ({ x, y, w, h })), [{ x: 700, y: 40, w: 600, h: 520 }], "moved, its raised height kept");
	assert.deepEqual(pagesAhead(list, given, served(given, [{ op: "delete", id: "b" }])), [], "taken off");
	assert.equal(pagesAhead(list, given, given), list);
});

test("each new drawing comes with the edits that made it, for the stage, and edits from elsewhere are followed", () => {
	const drawing = createDrawing(sample());
	const first = drawing.doc();
	assert.equal(drawing.editsTo(first), undefined, "the first drawing was made by nothing");
	drawing.edit([{ op: "update", id: "a", set: { content: "two" } }]);
	const own = drawing.editsTo(drawing.doc());
	assert.equal(own?.from, first);
	assert.deepEqual(own?.edits, [{ op: "set", id: "a", key: "content", value: "two" }]);
	assert.equal(drawing.editsTo(first), undefined, "only for the drawing they made");
	// Someone else's edit: followed in place, the board item shared with the drawing before.
	const before = drawing.doc();
	assert.equal(drawing.follow([{ op: "set", id: "a", key: "x", value: 40 }]), true);
	assert.equal(drawing.doc().children[0]?.x, 40);
	assert.equal(drawing.doc().children[1], before.children[1]);
	assert.equal(drawing.editsTo(drawing.doc())?.from, before);
	assert.equal(drawing.follow([{ op: "set", id: "nobody", key: "x", value: 1 }]), false, "edits that do not apply: the host sends the whole drawing");
	drawing.set(sample());
	assert.equal(drawing.editsTo(drawing.doc()), undefined, "a whole drawing has no edits");
});

/** A host whose `send` answers when the test says: each call's ops, name and the way to answer it. */
function slowHost(doc: PenDocument) {
	const calls: Array<{ ops: unknown[]; edit?: string; answer: (ok: boolean) => void }> = [];
	const steps: Array<{ direction: string; edit?: string }> = [];
	const d = createDrawing(doc, {
		host: {
			send: (ops, edit) => new Promise<boolean>((resolve) => calls.push({ ops, ...(edit ? { edit } : {}), answer: resolve })),
			step: (direction, edit) => void steps.push({ direction, ...(edit ? { edit } : {}) }),
		},
	});
	return { d, calls, steps };
}
const settled = async () => {
	for (let i = 0; i < 4; i++) await Promise.resolve();
};
const nudge = (d: ReturnType<typeof createDrawing>, id: string, dx: number) => {
	const node = d.doc().children.find((one) => one.id === id)!;
	d.edit([{ op: "update", id, set: { x: (node.x as number) + dx, y: node.y } }]);
};

test("edits made while one is on its way are shown at once and go together, folded, once it is answered", async () => {
	const { d, calls } = slowHost(sample());
	const host0 = d.doc();
	for (let i = 0; i < 5; i++) nudge(d, "a", 1);
	assert.equal(d.doc().children[0]?.x, 5, "every press shown at once");
	assert.equal(calls.length, 1, "one call on its way");
	assert.deepEqual(calls[0]!.ops, [{ op: "update", id: "a", set: { x: 1, y: 0 } }]);
	calls[0]!.answer(true);
	await settled();
	assert.equal(calls.length, 2, "the rest went once the first was answered");
	assert.deepEqual(calls[1]!.ops, [{ op: "update", id: "a", set: { x: 5, y: 0 } }], "four presses as one update");
	assert.equal(d.waiting(), 5);
	// The host's drawing with the first: the rest stay on top.
	const host1 = served(host0, calls[0]!.ops);
	d.set(host1, undefined, [calls[0]!.edit!]);
	assert.equal(d.doc().children[0]?.x, 5);
	assert.equal(d.waiting(), 4);
	nudge(d, "a", 1);
	assert.equal(d.doc().children[0]?.x, 6);
	const host2 = served(host1, calls[1]!.ops);
	d.set(host2, undefined, [calls[1]!.edit!]);
	assert.equal(d.doc().children[0]?.x, 6, "the press after them is still shown");
	assert.equal(d.waiting(), 1);
	calls[1]!.answer(true);
	await settled();
	assert.equal(calls.length, 3);
	d.set(served(host2, calls[2]!.ops), undefined, [calls[2]!.edit!]);
	assert.equal(d.doc().children[0]?.x, 6);
	assert.equal(d.waiting(), 0);
});

test("a drawing that has a later edit has the earlier ones sent before it, even when their names were lost", async () => {
	const { d, calls } = slowHost(sample());
	const host0 = d.doc();
	nudge(d, "a", 1);
	calls[0]!.answer(true);
	await settled();
	nudge(d, "a", 1);
	const host1 = served(host0, calls[0]!.ops);
	const host2 = served(host1, calls[1]!.ops);
	// Only the second's name comes (the first's drawing was passed over): the first is not kept on top.
	d.set(host2, undefined, [calls[1]!.edit!]);
	assert.equal(d.waiting(), 0);
	assert.equal(d.doc(), host2);
	// An agent moves it after: what is shown is the agent's, not an old press put back.
	const agent = served(host2, [{ op: "update", id: "a", set: { x: 100 } }]);
	d.set(agent);
	assert.equal(d.doc().children[0]?.x, 100);
});

test("a refused call takes every edit that went with it off, and the next ones still go", async () => {
	const { d, calls } = slowHost(sample());
	nudge(d, "a", 1);
	nudge(d, "a", 1);
	nudge(d, "a", 1);
	calls[0]!.answer(true);
	await settled();
	calls[1]!.answer(false);
	await settled();
	assert.equal(d.waiting(), 1, "the two sent together are gone, the first still waits for its drawing");
	assert.equal(d.doc().children[0]?.x, 1);
	nudge(d, "a", 1);
	assert.equal(calls.length, 3, "nothing on its way: sent at once");
});

test("a step asked for while edits are still to go is sent after them", async () => {
	const { d, calls, steps } = slowHost(sample());
	nudge(d, "a", 1);
	nudge(d, "a", 1);
	d.step("undo");
	assert.equal(steps.length, 0);
	calls[0]!.answer(true);
	await settled();
	assert.equal(steps.length, 0, "the second edit goes first");
	calls[1]!.answer(true);
	await settled();
	assert.deepEqual(steps, [{ direction: "undo" }]);
});

test("a call that never answers holds the next edits up no longer than an edit is shown ahead", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { d, calls } = slowHost(sample());
	nudge(d, "a", 1);
	nudge(d, "a", 1);
	assert.equal(calls.length, 1);
	t.mock.timers.tick(PENDING_MS + 1);
	assert.equal(calls.length, 2);
});

test("edits go together as their ops in order, runs of plain updates folded into one an item", () => {
	assert.deepEqual(
		together([
			[{ op: "update", id: "a", set: { x: 1, y: 0 } }, { op: "update", id: "b", set: { x: 5 } }],
			[{ op: "update", id: "a", set: { x: 2, y: 0 } }],
			[{ op: "update", id: "a", set: { fill: "#fff" } }],
		]),
		[
			{ op: "update", id: "a", set: { x: 2, y: 0, fill: "#fff" } },
			{ op: "update", id: "b", set: { x: 5 } },
		],
	);
	// Anything else between them keeps its place, and the updates either side of it stay apart.
	assert.deepEqual(
		together([[{ op: "update", id: "a", set: { x: 1 } }], [{ op: "delete", id: "b" }], [{ op: "update", id: "a", set: { x: 2 } }]]),
		[{ op: "update", id: "a", set: { x: 1 } }, { op: "delete", id: "b" }, { op: "update", id: "a", set: { x: 2 } }],
	);
	const first = { op: "update", id: "a", set: { x: 1 } };
	together([[first], [{ op: "update", id: "a", set: { x: 2 } }]]);
	assert.deepEqual(first.set, { x: 1 }, "the edits' own ops are not changed");
});

test("an edit routes again only the arrows it touches; the others stay as the server routed them", () => {
	// Routed by a server that measured the card's words taller than pen's estimate does.
	const served: PenDocument = {
		version: "2.14",
		children: [
			{ type: "frame", id: "card", layout: "vertical", width: 200, x: 0, y: 0, children: [{ type: "text", id: "words", content: "Some words", width: "fill_container", textGrowth: "fixed-width" }] },
			{ type: "rectangle", id: "box", x: 400, y: 0, width: 100, height: 60 },
			{ type: "rectangle", id: "far", x: 400, y: 300, width: 100, height: 60 },
			{ type: "path", id: "card-box", x: 200, y: 10, width: 200, height: 20, geometry: "M0 10 L200 10", metadata: { type: "decks.arrow", from: "card", to: "box" } },
			{ type: "path", id: "box-far", x: 440, y: 60, width: 20, height: 240, geometry: "M10 0 L10 240", metadata: { type: "decks.arrow", from: "box", to: "far" } },
		],
	};
	const sent: unknown[][] = [];
	const drawing = createDrawing(structuredClone(served), { host: { send: (ops) => void sent.push(ops), step: () => {} } });
	const arrow = (id: string) => drawing.doc().children.find((node) => node.id === id);
	drawing.edit([{ op: "update", id: "far", set: { fill: "#ff0000" } }]);
	assert.deepEqual(arrow("card-box"), served.children[3], "an edit that moves nothing leaves every arrow");
	assert.deepEqual(arrow("box-far"), served.children[4]);
	drawing.edit([{ op: "update", id: "far", set: { y: 400 } }]);
	assert.deepEqual(arrow("card-box"), served.children[3], "an arrow away from what moved is left");
	assert.notEqual(arrow("box-far")?.geometry, served.children[4]!.geometry, "the arrow to what moved follows it");
	// Measured as the server measures: words twice the estimate's height move the card's arrow when the card moves.
	const tall = createDrawing(structuredClone(served), { measure: (text) => ({ w: text.length * 8, h: 60 }), host: { send: () => {}, step: () => {} } });
	tall.edit([{ op: "update", id: "card", set: { y: 5 } }]);
	const routed = tall.doc().children.find((node) => node.id === "card-box");
	const guessed = createDrawing(structuredClone(served), { host: { send: () => {}, step: () => {} } });
	guessed.edit([{ op: "update", id: "card", set: { y: 5 } }]);
	assert.notEqual(routed?.y, guessed.doc().children.find((node) => node.id === "card-box")?.y, "the card's measured height, not the estimate's, places its arrow");
});

test("a tool's item comes with the Decks colours it uses, defined once, and reads dark in the dark", () => {
	const sent: unknown[][] = [];
	const drawing = createDrawing(sample(), { host: { send: (ops) => void sent.push(ops), step: () => {} } });
	drawing.edit([{ op: "insert", node: { type: "rectangle", id: "r", fill: "$decks-fill-slate", cornerRadius: 8 }, box: { x1: 0, y1: 0, x2: 160, y2: 100 } }]);
	assert.equal((sent[0]![0] as { op: string }).op, "variables", "the variables come first, in the same edit");
	const doc = drawing.doc();
	assert.deepEqual(doc.themes, { mode: ["light", "dark"] });
	assert.equal(doc.children.find((node) => node.id === "r")?.fill, "$decks-fill-slate");
	drawing.edit([{ op: "insert", node: { type: "rectangle", id: "s", fill: "$decks-fill-slate" }, box: { x1: 200, y1: 0, x2: 360, y2: 100 } }]);
	assert.equal(sent[1]!.length, 1, "a second one defines nothing");
	assert.equal(resolve(doc, "$decks-fill-slate", baseTheme(doc, "light")), "#dbe4f0");
	assert.equal(resolve(doc, "$decks-fill-slate", baseTheme(doc, "dark")), DECKS_COLORS["decks-fill-slate"]!.dark);
});

test("a colour picked in the panel: an adaptive one is written as its variable and defined with it, a custom hex stays as it is", () => {
	const sent: unknown[][] = [];
	const drawing = createDrawing(sample(), { host: { send: (ops) => void sent.push(ops), step: () => {} } });
	drawing.edit([{ op: "insert", node: { type: "rectangle", id: "r", fill: "#ff0000" }, box: { x1: 0, y1: 0, x2: 160, y2: 100 } }]);
	assert.equal(sent[0]!.length, 1, "a fixed colour defines nothing");
	drawing.edit([{ op: "update", id: "r", set: { fill: "$decks-accent-blue", stroke: "$decks-text" } }]);
	const [vars] = sent[1] as Array<{ op: string; set: Record<string, unknown> }>;
	assert.equal(vars!.op, "variables");
	assert.deepEqual(Object.keys(vars!.set).sort(), ["decks-accent-blue", "decks-text"]);
	const doc = drawing.doc();
	assert.equal(resolve(doc, "$decks-accent-blue", baseTheme(doc, "light")), DECKS_COLORS["decks-accent-blue"]!.light);
	assert.equal(resolve(doc, "$decks-accent-blue", baseTheme(doc, "dark")), DECKS_COLORS["decks-accent-blue"]!.dark);
	drawing.edit([{ op: "update", id: "r", set: { fill: "#12ab34" } }]);
	assert.equal(sent[2]!.length, 1, "a custom hex is just the update");
	const fill = drawing.doc().children.find((node) => node.id === "r")?.fill;
	assert.equal(fill, "#12ab34");
	assert.equal(resolve(drawing.doc(), fill, baseTheme(drawing.doc(), "dark")), "#12ab34", "and is the same in the dark");
});
