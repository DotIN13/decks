import { test } from "node:test";
import assert from "node:assert/strict";
import { defineCall, handlersFor, Refused } from "./call.ts";
import { int, obj, opt, str } from "./schema.ts";

// A handler with the wrong types, or a missing one, must not compile. The
// type check fails if any line marked to expect an error ever compiles.

const move = defineCall({
	name: "item.move",
	summary: "Move an item.",
	who: ["agent"],
	args: { id: str(), x: int(), canvas: opt(str()) },
	answer: obj({ id: str(), x: int() }),
	effect: "change",
});
const get = defineCall({ name: "item.get", summary: "One item.", who: ["agent"], args: { id: str() }, answer: obj({ id: str(), x: int() }), effect: "read" });

type Ctx = { caller: string };
const { handle, handleAll } = handlersFor<Ctx>();

test("a handler with the right types compiles and runs", async () => {
	const handled = handle(move, (_ctx, { id, x }) => ({ id, x: x + 1 }));
	assert.equal(handled.call.name, "item.move");
});

test("a handler with a wrong argument type does not compile", () => {
	// @ts-expect-error id is a string, not a number
	handle(move, (_ctx, args: { id: number; x: number }) => ({ id: String(args.id), x: args.x }));
	// @ts-expect-error the answer needs x
	handle(get, (_ctx, { id }) => ({ id }));
});

test("a call with no handler does not compile, and at run time answers unavailable and warns once", async () => {
	const calls = { move, get };
	const warned: string[] = [];
	const warn = console.warn;
	console.warn = (text: string) => void warned.push(text);
	try {
		// @ts-expect-error get has no handler
		const partial = handleAll(calls, { move: (_ctx, { id, x }) => ({ id, x }) });
		assert.deepEqual(warned, ["decks: item.get is declared but has no handler here; it answers unavailable."]);
		const getStub = partial.find((h) => h.call.name === "item.get")!;
		assert.throws(() => (getStub.run as (ctx: Ctx, args: object) => unknown)({ caller: "x" }, { id: "a" }), { code: "unavailable", message: "item.get is not handled on this server yet." });
	} finally {
		console.warn = warn;
	}
	const all = handleAll(calls, { move: (_c, { id, x }) => ({ id, x }), get: (_c, { id }) => ({ id, x: 0 }) });
	assert.deepEqual(
		all.map((h) => h.call.name),
		["item.move", "item.get"],
	);
});

test("a refusal carries its code and a hint", () => {
	const refused = new Refused("not_found", "No item called a.", "item.list");
	assert.equal(refused.code, "not_found");
	assert.equal(refused.hint, "item.list");
});

test("defineCall answers on the server unless it says otherwise, and builds its input shape", () => {
	assert.equal(move.side, "server");
	assert.deepEqual((move.input as unknown as { required: string[] }).required, ["id", "x"]);
});

test("refusal and refusalFrom build the refusal envelope once, for every door", async () => {
	const { refusal, refusalFrom } = await import("./call.ts");
	assert.deepEqual(refusal("not_found", "No item called a.", "item.list"), { ok: false, error: { code: "not_found", message: "No item called a.", hint: "item.list" }, notes: [] });
	assert.deepEqual(refusal("invalid", "Bad.", undefined, ["n"]), { ok: false, error: { code: "invalid", message: "Bad." }, notes: ["n"] });
	assert.deepEqual(refusalFrom(new Refused("conflict", "Moved on.", "file.read")), refusal("conflict", "Moved on.", "file.read"));
	assert.deepEqual(refusalFrom(new Error("boom")), refusal("unavailable", "boom"));
});
