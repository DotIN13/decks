import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyEdits, type PenDocument } from "@decks/pen";
import { penEditBy, CanvasPens } from "./pens.ts";

/** Browsers are sent what changed, and what they apply comes out as the server's drawing. */
test("canvas.changed carries an edit, a reroute and a hand edit of the file as edits", () => {
	const deck = mkdtempSync(join(tmpdir(), "pen-delta-"));
	const pens = new CanvasPens(deck, () => {});
	try {
		const name = pens.claim("Delta test");
		pens.edit(name, [{ op: "insert", node: { type: "rectangle", id: "a", x: 0, y: 0, width: 10, height: 10 } }] as never);
		// Said whole the first time, and as edits from then on.
		const first = pens.log.changes(name) as unknown as { rev: number; doc: PenDocument };
		let held = first.doc;
		let rev = first.rev;
		const take = () => {
			const delta = pens.log.changes(name) as unknown as { type: string; from: number; rev: number; edits: never[]; doc?: PenDocument };
			assert.equal(delta.type, "canvas.changed");
			assert.ok(delta.edits && !delta.doc, "as edits, not whole");
			assert.equal(delta!.from, rev);
			held = applyEdits(held, delta!.edits);
			rev = delta!.rev;
			const whole = pens.log.frame(name);
			assert.deepEqual(JSON.parse(JSON.stringify(held)), JSON.parse(JSON.stringify(whole.doc)));
		};
		pens.edit(name, [{ op: "update", id: "a", set: { x: 40, fill: "#f00" } }, { op: "insert", node: { type: "ellipse", id: "b" } }] as never);
		take();
		// Written by hand, as an agent's own tools would.
		mkdirSync(join(deck, "canvases", name), { recursive: true });
		writeFileSync(join(deck, "canvases", name, "canvas.pen"), JSON.stringify({ version: "2.14", children: [{ type: "ellipse", id: "b", x: 5 }, { type: "note", id: "n", content: "hi" }] }, null, 2));
		take();
	} finally {
		pens.close();
		rmSync(deck, { recursive: true, force: true });
	}
});

/** The person's edit named by the browser comes back with the revision that has it, and with no other. */
test("an edit or a step made under a browser's name says so in the delta that has it", () => {
	const deck = mkdtempSync(join(tmpdir(), "pen-made-"));
	const sent: Array<{ type: string; made?: string[] }> = [];
	let pens!: CanvasPens;
	pens = new CanvasPens(deck, (name) => sent.push(pens.log.changes(name) as never));
	try {
		const name = pens.claim("Made test");
		pens.edit(name, [{ op: "insert", node: { type: "rectangle", id: "a", x: 0, y: 0, width: 10, height: 10 } }] as never);
		assert.equal(sent.at(-1)!.made, undefined, "an edit nobody named");
		penEditBy.run("tab.1", () => pens.edit(name, [{ op: "update", id: "a", set: { x: 40 } }] as never, undefined, { undoable: true }));
		assert.deepEqual(sent.at(-1)!.made, ["tab.1"]);
		// An agent's edit after it is not the person's.
		pens.edit(name, [{ op: "update", id: "a", set: { y: 5 } }] as never);
		assert.equal(sent.at(-1)!.made, undefined);
		// Refused (nothing to write): no revision, and the name is not kept for the next one.
		assert.throws(() => penEditBy.run("tab.2", () => pens.edit(name, [{ op: "update", id: "nobody", set: { x: 1 } }] as never)));
		pens.edit(name, [{ op: "update", id: "a", set: { y: 6 } }] as never);
		assert.equal(sent.at(-1)!.made, undefined);
		penEditBy.run("tab.3", () => pens.edit(name, [{ op: "update", id: "a", set: { x: 41 } }] as never, undefined, { undoable: true }));
		penEditBy.run("tab.4", () => pens.log.step(name, "undo"));
		assert.deepEqual(sent.at(-1)!.made, ["tab.4"]);
	} finally {
		pens.close();
		rmSync(deck, { recursive: true, force: true });
	}
});

/** A drawing sent whole to one browser (asked again, a picture of the canvas) leaves the names for the rest. */
test("a drawing sent whole to one browser takes no names from the others' next delta, and carries the recent ones", () => {
	const deck = mkdtempSync(join(tmpdir(), "pen-made-frame-"));
	const pens = new CanvasPens(deck, () => {});
	try {
		const name = pens.claim("Frame test");
		pens.edit(name, [{ op: "insert", node: { type: "rectangle", id: "a", x: 0, y: 0, width: 10, height: 10 } }] as never);
		pens.log.changes(name);
		penEditBy.run("tab.1", () => pens.edit(name, [{ op: "update", id: "a", set: { x: 40 } }] as never));
		const whole = pens.log.frame(name);
		assert.deepEqual(whole.made, ["tab.1"], "the one asking hears it too");
		const delta = pens.log.changes(name) as unknown as { type: string; made?: string[] };
		assert.equal(delta.type, "canvas.changed");
		assert.deepEqual(delta!.made, ["tab.1"], "and so do the others");
		penEditBy.run("tab.2", () => pens.edit(name, [{ op: "update", id: "a", set: { x: 41 } }] as never));
		pens.log.changes(name);
		assert.deepEqual(pens.log.frame(name).made, ["tab.1", "tab.2"], "recent names, already sent, for a browser that missed them");
	} finally {
		pens.close();
		rmSync(deck, { recursive: true, force: true });
	}
});
