import assert from "node:assert/strict";
import { test } from "node:test";
import { checkArgs, commandOf, jsonSchemaOf, signature, tsOf, VERB_BY_NAME, VERBS } from "./index.ts";

test("the table has the 53 verbs, each named once", () => {
	assert.equal(VERBS.length, 53);
	assert.equal(new Set(VERBS.map((verb) => verb.name)).size, 53);
});

test("every verb says what it touches", () => {
	const counts = VERBS.reduce<Record<string, number>>((all, verb) => ({ ...all, [verb.effect]: (all[verb.effect] ?? 0) + 1 }), {});
	// As the design board sorts them; it lists camera twice, read and set, and here it is one verb in view.
	assert.deepEqual(counts, { change: 12, view: 4, read: 11, outside: 26 });
});

test("arguments that fit pass, and the wrong ones get a sentence with the signature", () => {
	const move = VERB_BY_NAME.get("move")!;
	assert.equal(checkArgs(move, ["boards/a.html", { x: 1, y: 2 }]), undefined);
	assert.match(checkArgs(move, ["boards/a.html"])!, /move needs at\. move\(path: string, at: Point\)/);
	assert.match(checkArgs(move, ["boards/a.html", { x: "1", y: 2 }])!, /at\.x is a string, where a number is expected/);

	const newBoard = VERB_BY_NAME.get("newBoard")!;
	assert.equal(checkArgs(newBoard, [{ title: "T", at: { x1: 0, y1: 0 } }]), undefined);
	assert.equal(checkArgs(newBoard, [{ title: "T", at: { x: 0, y: 0 } }]), undefined);
	assert.match(checkArgs(newBoard, [{ titel: "T" }])!, /options\.title is missing/);
	assert.match(checkArgs(newBoard, [{ title: "T", colour: "red" }])!, /has no key "colour"/);
	assert.match(checkArgs(newBoard, [{ title: "T", format: "deck" }])!, /one of "board", "slides"/);
});

test("left-out optionals may be sent as null, but a null that means something is kept", () => {
	assert.equal(checkArgs(VERB_BY_NAME.get("camera")!, [null, null]), undefined);
	assert.equal(checkArgs(VERB_BY_NAME.get("cursor")!, ["boards/a.html", null]), undefined);
	assert.equal(checkArgs(VERB_BY_NAME.get("fit")!, ["boards/a.html", { margin: null }]), undefined);
	assert.match(checkArgs(VERB_BY_NAME.get("boards")!, [1])!, /takes 0 arguments/);
});

test("pen edits are checked op by op", () => {
	const edit = VERB_BY_NAME.get("pen.edit")!;
	assert.equal(checkArgs(edit, [[{ op: "insert", node: { type: "note", id: "n1", text: "hi" }, box: { x1: 0, y1: 0 } }]]), undefined);
	assert.equal(checkArgs(edit, [[{ op: "update", id: "n1", set: { text: "yo" } }, { op: "delete", id: "n2" }]]), undefined);
	assert.ok(checkArgs(edit, [[{ op: "explode", id: "n1" }]]));
});

test("shapes print as TypeScript, named ones by name", () => {
	assert.equal(signature(VERB_BY_NAME.get("show")!), 'show(target: string | string[], options?: { fit?: "board" | "all"; highlight?: string; animate?: boolean; at?: Corner })');
	assert.equal(tsOf(VERB_BY_NAME.get("boards")!.result!), "Board[]");
	assert.match(tsOf(VERB_BY_NAME.get("move")!.result!, true), /^\{ path: string; title: string;/);
});

test("JSON Schema writes named shapes out and refuses unknown keys", () => {
	const schema = jsonSchemaOf(VERB_BY_NAME.get("move")!.params[1]!.schema) as { type: string; required: string[]; additionalProperties: boolean };
	assert.equal(schema.type, "object");
	assert.deepEqual(schema.required, ["x", "y"]);
	assert.equal(schema.additionalProperties, false);
});

test("command names are words", () => {
	assert.deepEqual(commandOf(VERB_BY_NAME.get("newBoard")!), ["new-board"]);
	assert.deepEqual(commandOf(VERB_BY_NAME.get("pen.edit")!), ["pen", "edit"]);
});
