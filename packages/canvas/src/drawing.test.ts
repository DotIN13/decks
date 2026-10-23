import assert from "node:assert/strict";
import { test } from "node:test";
import { apply as applyOps, applyEdits, baseTheme, type PenDocument, type PenEdit } from "@decks/pen";
import { boardsAhead, boardsOf, createDrawing, PENDING_MS } from "./drawing.ts";

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
		boardsOf(drawing.doc()).map(({ path, title, x, y, w, h }) => ({ path, title, x, y, w, h })),
		[{ path: "boards/plan.html", title: "Plan", x: 400, y: 10, w: 600, h: 400 }],
	);
	drawing.moveBoard("boards/plan.html", 420.4, -7.6);
	drawing.resizeBoard("boards/plan.html", { w: 640, h: 380 });
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
	assert.deepEqual(boardsAhead(list, given, shown).map(({ x, y, w, h }) => ({ x, y, w, h })), [{ x: 700, y: 40, w: 600, h: 520 }], "moved, its raised height kept");
	assert.deepEqual(boardsAhead(list, given, served(given, [{ op: "delete", id: "b" }])), [], "taken off");
	assert.equal(boardsAhead(list, given, given), list);
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
