import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyEdits, type PenDocument } from "@decks/pen";
import { penEditBy, StagePens } from "./pens.ts";

/** Browsers are sent what changed, and what they apply comes out as the server's drawing. */
test("stage.pen.delta carries an edit, a reroute and a hand edit of the file", () => {
	const deck = mkdtempSync(join(tmpdir(), "pen-delta-"));
	const pens = new StagePens(deck, () => {});
	try {
		const name = pens.claim("Delta test");
		pens.edit(name, [{ op: "insert", node: { type: "rectangle", id: "a", x: 0, y: 0, width: 10, height: 10 } }] as never);
		const first = pens.frame("agent", name) as { rev: number; doc: PenDocument };
		let held = first.doc;
		let rev = first.rev;
		const take = () => {
			const [delta] = pens.changes(["agent"], name) as unknown as Array<{ type: string; from: number; rev: number; edits: never[]; doc?: PenDocument }>;
			assert.equal(delta!.type, "stage.pen.delta");
			assert.equal(delta!.from, rev);
			held = applyEdits(held, delta!.edits);
			rev = delta!.rev;
			const whole = pens.frame("agent", name) as { doc: PenDocument };
			assert.deepEqual(JSON.parse(JSON.stringify(held)), JSON.parse(JSON.stringify(whole.doc)));
		};
		pens.edit(name, [{ op: "update", id: "a", set: { x: 40, fill: "#f00" } }, { op: "insert", node: { type: "ellipse", id: "b" } }] as never);
		take();
		// Written by hand, as an agent's own tools would.
		mkdirSync(join(deck, "stages", name), { recursive: true });
		writeFileSync(join(deck, "stages", name, "stage.pen"), JSON.stringify({ version: "2.14", children: [{ type: "ellipse", id: "b", x: 5 }, { type: "note", id: "n", content: "hi" }] }, null, 2));
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
	let pens!: StagePens;
	pens = new StagePens(deck, (name) => sent.push(...(pens.changes(["agent"], name) as never[])));
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
		penEditBy.run("tab.4", () => pens.step(name, "undo"));
		assert.deepEqual(sent.at(-1)!.made, ["tab.4"]);
	} finally {
		pens.close();
		rmSync(deck, { recursive: true, force: true });
	}
});
