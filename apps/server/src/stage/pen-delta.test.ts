import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyEdits, type PenDocument } from "@decks/pen";
import { StagePens } from "./pens.ts";

/** Browsers are sent what changed, and what they apply comes out as the server's drawing. */
test("stage.pen.delta carries an edit, a reroute and a hand edit of the file", () => {
	const deck = mkdtempSync(join(tmpdir(), "pen-delta-"));
	try {
		const pens = new StagePens(deck, () => {});
		const name = pens.claim("Delta test");
		pens.edit(name, [{ op: "insert", node: { type: "rectangle", id: "a", x: 0, y: 0, width: 10, height: 10 } }] as never);
		const first = pens.frame("agent", name) as { rev: number; doc: PenDocument };
		let held = first.doc;
		let rev = first.rev;
		const take = () => {
			const [delta] = pens.changes(["agent"], name) as Array<{ type: string; from: number; rev: number; edits: never[]; doc?: PenDocument }>;
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
		rmSync(deck, { recursive: true, force: true });
	}
});
