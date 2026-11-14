import { test } from "node:test";
import assert from "node:assert/strict";
import { REFUSAL_CODES, WHO, type AnyCall } from "./call.ts";
import { CALLS } from "./calls/index.ts";
import { EVENTS } from "./events.ts";
import { HARNESS_NOUNS, ITEM_OPS, NOUNS, SHARED_VERBS } from "./glossary.ts";
import type { Node } from "./schema.ts";
import { Deleted } from "./shapes.ts";

// The grammar's eight rules (DESIGN.md section 5), held over every call and event.

const nounOf = (call: AnyCall) => call.name.split(".")[0]!;
const verbOf = (call: AnyCall) => call.name.split(".")[1]!;
const READS = new Set(["list", "get"]);
const CHANGES = new Set(["create", "update", "delete", "move", "copy", "insert", "replace"]);
/** Calls whose canvas argument is the thing itself, not an option. */
const CANVAS_IS_THE_THING = new Set(["canvas.delete", "canvas.copy", "view.goto"]);

test("1: every call says who may call it", () => {
	for (const call of CALLS) {
		assert.ok(call.who.length > 0, call.name);
		for (const who of call.who) assert.ok(WHO.includes(who), `${call.name}: ${who}`);
	}
});

test("2: a name is noun.verb, the noun one of the glossary's, answered on its noun's side", () => {
	const seen = new Set<string>();
	for (const call of CALLS) {
		assert.match(call.name, /^[a-z]+\.[a-z][a-zA-Z]*$/, call.name);
		assert.ok((NOUNS as readonly string[]).includes(nounOf(call)), call.name);
		const harness = (HARNESS_NOUNS as readonly string[]).includes(nounOf(call));
		assert.equal(call.side, harness ? "harness" : "server", call.name);
		assert.ok(!seen.has(call.name), `${call.name} declared twice`);
		seen.add(call.name);
	}
});

test("3: a shared verb means the same everywhere, and an item's verbs are pen's ops", () => {
	const itemExtras = new Set(["list", "get", "batch", "clip", "paste", "space", "variables"]);
	for (const call of CALLS) {
		const verb = verbOf(call);
		if (READS.has(verb)) assert.equal(call.effect, "read", call.name);
		if ((SHARED_VERBS as readonly string[]).includes(verb) && !READS.has(verb)) assert.equal(call.effect, "change", call.name);
		if (nounOf(call) === "item") assert.ok((ITEM_OPS as readonly string[]).includes(verb) || itemExtras.has(verb), call.name);
	}
});

test("4: canvas and frame are options, after the thing and the change", () => {
	for (const call of CALLS) {
		const keys = Object.keys(call.args);
		const input = call.input as Extract<Node, { k: "obj" }>;
		for (const key of ["canvas", "frame"]) {
			if (!keys.includes(key) || CANVAS_IS_THE_THING.has(call.name)) continue;
			assert.ok(!input.required.includes(key), `${call.name}: ${key} must be optional`);
			const after = keys.slice(keys.indexOf(key));
			assert.ok(after.every((k) => !input.required.includes(k)), `${call.name}: a required argument comes after ${key}`);
		}
	}
});

test("5: a change answers the thing, a delete answers { deleted }, a list answers a list", () => {
	for (const call of CALLS) {
		const verb = verbOf(call);
		const answer = call.answer as Node;
		if (verb === "delete") assert.equal(answer.name, Deleted.name, call.name);
		else if (verb === "list") assert.equal(answer.k, "arr", call.name);
		else if (CHANGES.has(verb) && verb !== "batch") assert.ok(answer.name !== undefined || answer.k === "arr", `${call.name} answers no named thing`);
	}
});

test("6: there are exactly five refusal codes", () => {
	assert.deepEqual([...REFUSAL_CODES], ["invalid", "not_found", "refused", "conflict", "unavailable"]);
});

test("7: an event is noun.verbed with canvas, ids, by and rev", () => {
	for (const event of EVENTS) {
		assert.match(event.name, /^[a-z]+\.[a-z]+ed$/, event.name);
		assert.ok((NOUNS as readonly string[]).includes(event.name.split(".")[0]!), event.name);
		const payload = event.payload as Extract<Node, { k: "obj" }>;
		for (const key of ["canvas", "ids", "by", "rev"]) assert.ok(key in payload.props, `${event.name}: ${key}`);
	}
});

/** Every object shape inside a node. */
function objects(node: Node, into: Extract<Node, { k: "obj" }>[] = [], seen = new Set<Node>()): typeof into {
	if (seen.has(node)) return into;
	seen.add(node);
	if (node.k === "obj") {
		into.push(node);
		for (const one of Object.values(node.props)) objects(one, into, seen);
	}
	if (node.k === "arr") objects(node.items, into, seen);
	if (node.k === "union") for (const one of node.of) objects(one, into, seen);
	return into;
}

test("8: one geometry: no width or height, no { x, y, w, h } box", () => {
	const nodes = [...CALLS.flatMap((c) => [c.input as Node, c.answer as Node]), ...EVENTS.map((e) => e.payload as Node)];
	for (const node of nodes) {
		for (const one of objects(node)) {
			const keys = Object.keys(one.props);
			assert.ok(!keys.includes("width") && !keys.includes("height"), `width or height in ${keys.join(", ")}`);
			assert.ok(!(keys.includes("x") && keys.includes("w")), `an x, y, w, h box in ${keys.join(", ")}`);
		}
	}
});
