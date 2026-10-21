import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, type PenDocument, type PenEdit } from "@decks/pen";
import { CanvasFollower, loosely } from "../src/follower.ts";

const start = (): PenDocument => ({ version: "2.14", children: [{ id: "a", type: "note", x: 0, y: 0 } as never, { id: "b", type: "note", x: 100, y: 0 } as never] });
const x = (id: string, value: number): PenEdit => ({ op: "set", id, key: "x", value });
const at = (doc: PenDocument, id: string) => (doc.children.find((n) => n.id === id) as unknown as { x: number }).x;

/** A page: its drawing, and a Studio whose log it can ask (`changes`) or read whole. */
function page(rev = 1) {
	let doc = start();
	const log: PenEdit[][] = [];
	const studio = { doc: start(), rev };
	const asked: string[] = [];
	const f = new CanvasFollower(
		{
			doc: () => doc,
			show: (next) => void (doc = next),
			changes: async (since) => {
				asked.push(`since ${since}`);
				return since < rev ? { rev: studio.rev, tooOld: true } : { rev: studio.rev, changes: log.slice(since - rev) };
			},
			whole: async () => (asked.push("whole"), { rev: studio.rev, pen: studio.doc }),
		},
		rev,
		"me",
	);
	/** Someone else's revision, made in Studio. */
	const theirs = (edits: PenEdit[]) => {
		studio.doc = applyEdits(studio.doc, edits);
		log.push(edits);
		studio.rev++;
		return { type: "canvas" as const, id: "c", rev: studio.rev, base: studio.rev - 1, by: "them", client: "them", changes: edits as never };
	};
	/** The page's own edit: shown at once, taken by Studio, answered. */
	const mine = (edits: PenEdit[]) => {
		doc = applyEdits(doc, edits);
		f.sending(edits);
		const base = studio.rev;
		studio.doc = applyEdits(studio.doc, edits);
		log.push(edits);
		studio.rev++;
		return { answer: { rev: studio.rev, base, changes: edits, applied: edits.length, adjusted: 0, dropped: 0 }, event: { type: "canvas" as const, id: "c", rev: studio.rev, base, by: "u", client: "me", changes: edits as never } };
	};
	return { f, doc: () => doc, studio, asked, theirs, mine, log };
}

describe("an open canvas following Studio by changes", () => {
	it("applies someone else's revision from the message, with nothing fetched", () => {
		const p = page();
		p.f.heard(p.theirs([x("a", 5)]));
		assert.equal(at(p.doc(), "a"), 5);
		assert.equal(p.f.rev, 2);
		assert.deepEqual(p.asked, []);
	});

	it("does not apply its own edits twice, whichever comes first, the answer or the message", () => {
		const p = page();
		const one = p.mine([x("a", 10)]);
		p.f.heard(one.event);
		p.f.answered(one.answer);
		const two = p.mine([x("a", 20)]);
		p.f.answered(two.answer);
		p.f.heard(two.event);
		assert.equal(p.f.rev, 3);
		assert.equal(at(p.doc(), "a"), 20);
		assert.deepEqual(p.asked, []);
	});

	it("asks for the changes since its revision when a message is missed, and skips its own among them", async () => {
		const p = page();
		p.theirs([x("b", 1)]); // never heard
		const own = p.mine([x("a", 7)]);
		p.f.heard(own.event); // base 2 is not the page's 1: it asks
		await p.f.settled();
		assert.deepEqual(p.asked, ["since 1"]);
		assert.equal(at(p.doc(), "b"), 1);
		assert.equal(at(p.doc(), "a"), 7);
		assert.equal(p.f.rev, 3);
		p.f.answered(own.answer);
		assert.equal(p.f.rev, 3);
	});

	it("keeps its own edit on its way over someone else's change to the same field, as Studio will", () => {
		const p = page();
		p.doc();
		const theirs = p.theirs([x("a", 99)]);
		// The page moved a before it heard theirs; Studio applies the page's after theirs.
		const own = p.mine([x("a", 3)]);
		p.f.heard(theirs);
		assert.equal(at(p.doc(), "a"), 3);
		p.f.answered(own.answer);
		assert.equal(p.f.rev, 3);
	});

	it("takes the whole drawing when the log no longer reaches, keeping its edits on their way", async () => {
		const p = page(5);
		p.studio.doc = applyEdits(p.studio.doc, [x("b", 50)]);
		p.f.sending([x("a", 1)]);
		await p.f.catchUp(true);
		assert.deepEqual(p.asked, ["whole"]);
		assert.equal(at(p.doc(), "b"), 50);
		assert.equal(at(p.doc(), "a"), 1);
	});

	it("applies edits loosely: an insert of an item already there, or an edit to one gone, is left out", () => {
		const doc = loosely(start(), [{ op: "insert", id: "a", parent: null, after: null, props: { type: "note" }, list: false }, x("gone", 1), x("b", 2)]);
		assert.equal(doc.children.length, 2);
		assert.equal(at(doc, "b"), 2);
	});
});
