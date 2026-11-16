import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonSchemaOf, toolText } from "./mcp.ts";
import { arr, int, lit, named, obj, opt, rec, str, union } from "./schema.ts";

// What an MCP client is shown: a shape as plain JSON Schema (named shapes
// written out, optional keys left out of required), and an answer as text.

test("an object lists its required keys, and shuts out others unless it takes them", () => {
	const Point = named("Point", obj({ x: int(), y: int() }), "A point.");
	assert.deepEqual(jsonSchemaOf(obj({ at: Point, tag: opt(str("A tag.")) })), {
		type: "object",
		properties: {
			at: { type: "object", properties: { x: { type: "integer" }, y: { type: "integer" } }, required: ["x", "y"], additionalProperties: false, description: "A point." },
			tag: { type: "string", description: "A tag." },
		},
		required: ["at"],
		additionalProperties: false,
	});
	assert.equal(jsonSchemaOf(obj({}, true)).additionalProperties, true);
	assert.deepEqual(jsonSchemaOf(rec(int())).additionalProperties, { type: "integer" });
});

test("lists, unions and literals", () => {
	assert.deepEqual(jsonSchemaOf(arr(str())), { type: "array", items: { type: "string" } });
	assert.deepEqual(jsonSchemaOf(union(str(), int())), { anyOf: [{ type: "string" }, { type: "integer" }] });
	assert.deepEqual(jsonSchemaOf(lit("a", "b")), { enum: ["a", "b"] });
});

test("an answer's text: the value and its notes; a refusal's sentence, code and hint", () => {
	assert.deepEqual(toolText({ ok: true, value: { a: 1 }, notes: ["n"] }), { text: '{\n  "a": 1\n}\nn', isError: false });
	assert.deepEqual(toolText({ ok: true, value: "plain", notes: [] }), { text: "plain", isError: false });
	assert.deepEqual(toolText({ ok: true, value: null, notes: [] }), { text: "(done)", isError: false });
	assert.deepEqual(toolText({ ok: false, error: { code: "not_found", message: "No item.", hint: "item.list" }, notes: [] }), { text: "No item. (not_found)\nTry item.list.", isError: true });
});
