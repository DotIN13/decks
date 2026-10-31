import assert from "node:assert/strict";
import { test } from "node:test";
import { checkArgs, commandOf, jsonSchemaOf, Placement, signature, tsOf, VERB_BY_NAME, VERBS } from "./index.ts";

test("the table has every call of the redesign, each named once", () => {
	assert.equal(new Set(VERBS.map((verb) => verb.name)).size, VERBS.length, "no name twice");
	const names = new Set(VERBS.map((verb) => verb.name));
	for (const name of [
		"canvas.read", "canvas.insert", "canvas.update", "canvas.replace", "canvas.delete", "canvas.move", "canvas.copy", "canvas.clip", "canvas.paste", "canvas.variables", "canvas.batch",
		"canvas.space", "canvas.step", "canvas.fit", "canvas.save", "canvas.screenshot", "canvas.export", "canvas.rename", "canvas.file", "canvas.list", "canvas.create", "canvas.copyShared",
		"card.list", "card.create", "card.get", "card.canvases", "card.url", "frame.create", "file.url",
		"agent.me", "agent.update", "here", "agent.claim", "agent.inbox", "agent.list", "agent.get", "agent.send", "agent.queue", "agent.create",
		"view.goto", "view.focus", "view.camera", "view.move", "view.viewport", "view.cursor", "view.reload",
		"apps.list", "apps.status", "apps.create", "apps.repo", "apps.clone", "apps.item", "apps.build", "apps.run", "apps.stop", "apps.restart", "apps.delete", "apps.logs", "apps.check",
		"web.status", "web.pairing", "web.repair", "web.open", "web.read", "web.screenshot", "web.fill", "web.select", "web.click", "web.press", "web.submit", "web.stop",
		"ports", "now", "pair.code", "studio.connect", "studio.status", "studio.disconnect",
	]) assert.ok(names.has(name), `${name} is in the table`);
	assert.equal(VERBS.length, 77);
	assert.equal(VERB_BY_NAME.size, VERBS.length, "a name finds only the table's calls");
});

test("every call says what it touches and whether it changes it, in the redesign's groups", () => {
	const groups = new Set(["canvas", "card", "agent", "view", "apps", "web", "misc"]);
	for (const verb of VERBS) {
		assert.ok(["deck", "screen", "agents", "outside"].includes(verb.touches), verb.name);
		assert.ok(["change", "read"].includes(verb.effect), verb.name);
		assert.ok(groups.has(verb.group), verb.name);
	}
	const count = (touches: string, effect: string) => VERBS.filter((verb) => verb.touches === touches && verb.effect === effect).length;
	// As the cards sort them.
	assert.equal(count("screen", "read"), 2, "camera and viewport only read the screen");
	assert.equal(count("screen", "change"), 5);
	assert.ok(VERBS.filter((verb) => verb.group === "view").every((verb) => verb.touches === "screen"), "view calls never write files");
	assert.equal(VERB_BY_NAME.get("web.board"), undefined, "the shared tab has no board: its status is web.status");
});

test("every canvas call takes an optional canvas, last", () => {
	for (const verb of VERBS.filter((one) => one.name.startsWith("canvas.") && !["canvas.list", "canvas.create"].includes(one.name))) {
		const last = verb.params.at(-1)!;
		assert.equal(last.optional, true, verb.name);
		const schema = last.schema as { properties?: Record<string, unknown> };
		assert.ok(schema.properties?.canvas, `${verb.name} takes { canvas }`);
	}
});

test("arguments that fit pass, and the wrong ones get a sentence with the signature", () => {
	const insert = VERB_BY_NAME.get("canvas.insert")!;
	assert.equal(checkArgs(insert, [{ type: "board", board: "boards/a.html" }, { beside: "boards/b.html" }]), undefined);
	assert.equal(checkArgs(insert, [{ type: "note", content: "hi" }, { at: { x1: 0, y1: 0 }, canvas: "plan" }]), undefined);
	assert.match(checkArgs(insert, [{ type: "note" }, { besides: "x" }])!, /has no key "besides"/);
	assert.match(checkArgs(insert, [])!, /canvas\.insert needs item/);

	const create = VERB_BY_NAME.get("card.create")!;
	assert.equal(checkArgs(create, [{ title: "T" }]), undefined);
	assert.match(checkArgs(create, [{ titel: "T" }])!, /options\.title is missing/);
	assert.match(checkArgs(create, [{ title: "T", format: "slides" }])!, /has no key "format"/, "there are no slide decks");
	assert.match(checkArgs(create, [{ title: "T", at: { x1: 0, y1: 0 } }])!, /has no key "at"/, "a new card is not placed");

	const cursor = VERB_BY_NAME.get("view.cursor")!;
	assert.match(checkArgs(cursor, ["cards/a/index.html"])!, /view\.cursor needs at\. view\.cursor\(card: string, at: Point \| null\)/);
});

test("left-out optionals may be sent as null, but a null that means something is kept", () => {
	assert.equal(checkArgs(VERB_BY_NAME.get("view.camera")!, [null]), undefined);
	assert.equal(checkArgs(VERB_BY_NAME.get("view.cursor")!, ["boards/a.html", null]), undefined);
	assert.equal(checkArgs(VERB_BY_NAME.get("canvas.fit")!, ["boards/a.html", { margin: null }]), undefined);
	assert.match(checkArgs(VERB_BY_NAME.get("card.list")!, [1, 2])!, /takes 0 arguments/);
});

test("batch ops are checked op by op, pen edits among them", () => {
	const batch = VERB_BY_NAME.get("canvas.batch")!;
	assert.equal(checkArgs(batch, [[{ op: "insert", item: { type: "note", id: "n1" }, below: "boards/a.html" }, { op: "update", id: "n1", set: { content: "yo" } }, { op: "delete", id: "n2" }]]), undefined);
	assert.ok(checkArgs(batch, [[{ op: "explode", id: "n1" }]]));
	assert.equal(checkArgs(batch, [[{ op: "insert", node: { type: "note", id: "n1", text: "hi" }, box: { x1: 0, y1: 0 } }]]), undefined);
});

test("shapes print as TypeScript, named ones by name", () => {
	assert.equal(signature(VERB_BY_NAME.get("view.focus")!), "view.focus(target: string | string[], options?: { canvas?: string; highlight?: string; animate?: boolean })");
	assert.equal(tsOf(VERB_BY_NAME.get("card.list")!.result!), "Card[]");
	assert.equal(tsOf(VERB_BY_NAME.get("card.canvases")!.result!), "Placement[]");
	assert.match(tsOf(VERB_BY_NAME.get("card.get")!.result!, true), /^\{ path: string; title: string; lastWrittenBy\?: string \}$/);
	assert.equal(tsOf(Placement, true), "{ card: string; canvas: string; box: Box; clipped?: boolean }", "no board field beside card");
});

test("JSON Schema writes named shapes out and refuses unknown keys", () => {
	const schema = jsonSchemaOf(VERB_BY_NAME.get("view.move")!.params[0]!.schema) as { type: string; required: string[]; additionalProperties: boolean };
	assert.equal(schema.type, "object");
	assert.deepEqual(schema.required, ["x", "y", "zoom"]);
	assert.equal(schema.additionalProperties, false);
});

test("command names are noun then verb", () => {
	assert.deepEqual(commandOf(VERB_BY_NAME.get("canvas.insert")!), ["canvas", "insert"]);
	assert.deepEqual(commandOf(VERB_BY_NAME.get("agent.send")!), ["agent", "send"]);
	assert.deepEqual(commandOf(VERB_BY_NAME.get("canvas.copyShared")!), ["canvas", "copy-shared"]);
});

test("the names from before cards are gone", () => {
	for (const old of ["board.list", "board.create", "board.get", "board.canvases", "board.url", "apps.board", "newBoard", "fit", "show", "hide", "move", "boards", "pen.read", "pen.edit", "pen.create", "pen.save", "pen.file", "stages", "open", "newStage", "title", "me", "agents", "send", "queue", "report", "reload", "url", "resolve", "camera", "viewport", "screenshot", "cursor"]) {
		assert.equal(VERB_BY_NAME.get(old), undefined, `${old} is not a call`);
	}
	const fields = (verb: string, param: number) => Object.keys((VERB_BY_NAME.get(verb)!.params[param]!.schema as { properties: object }).properties);
	assert.ok(!fields("agent.send", 1).includes("boards") && !fields("agent.queue", 1).includes("boards"), "a hand-off names cards");
	assert.ok(!fields("view.reload", 0).includes("board"), "a reload names a card");
});

test("the SDK's generated files match the table", async () => {
	const { execFileSync } = await import("node:child_process");
	const root = new URL("../../../", import.meta.url);
	// Throws, with the script's sentence, when someone changed the table and not the SDK.
	execFileSync(process.execPath, ["--import", "tsx", "scripts/gen-sdk.mjs", "--check"], { cwd: root, stdio: "pipe" });
});

test("canvas.screenshot says what scale is measured against and where to writes", () => {
	const shot = VERBS.find((verb) => verb.name === "canvas.screenshot")!;
	assert.match(shot.summary, /long side is at most 1,600 px; `scale` multiplies/);
	assert.match(shot.summary, /`to` a path in the deck/);
});
