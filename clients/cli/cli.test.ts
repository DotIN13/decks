import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { CALL_BY_NAME, Refused } from "../../protocol/index.ts";
import { fakeServer, type Fake } from "../sdk/testing/fake-server.ts";
import { argsOf } from "./args.ts";
import { run, type Io } from "./index.ts";

// The command turns words and flags into one call, prints the value on
// stdout and notes on stderr, and a refusal with its code and hint.

let fake: Fake;
const item = { type: "note", id: "n1" };
before(async () => {
	fake = await fakeServer(4606, {
		"item.move": (args) => ({ ...item, id: args.id }),
		"card.url": () => "http://127.0.0.1:4606/cards/a",
		"item.get": () => {
			throw new Refused("not_found", "No item called zz.", "item.list");
		},
	});
	process.env.DECKS_URL = fake.url;
	process.env.DECKS_TOKEN = fake.token;
});
after(() => fake.close());

function io(stdin = ""): Io & { outs: string[]; errs: string[] } {
	const outs: string[] = [];
	const errs: string[] = [];
	return { outs, errs, out: (t) => outs.push(t), err: (t) => errs.push(t), stdin: () => stdin };
}

test("words fill plain arguments in order, flags fill keys, dots go deeper", () => {
	const move = CALL_BY_NAME.get("item.move")!;
	assert.deepEqual(argsOf(move, ["n1", "--at.x", "5", "--at.y", "7", "--canvas", "plan"], () => ""), { id: "n1", at: { x: 5, y: 7 }, canvas: "plan" });
	const claim = CALL_BY_NAME.get("card.claim")!;
	assert.deepEqual(argsOf(claim, ["a", "b"], () => ""), { cards: ["a", "b"] });
	const batch = CALL_BY_NAME.get("item.batch")!;
	assert.deepEqual(argsOf(batch, ["--ops", "-"], () => '[{"op":"delete","id":"n1"}]'), { ops: [{ op: "delete", id: "n1" }] });
	assert.deepEqual(argsOf(move, ["--args", '{"id":"x"}'], () => ""), { id: "x" });
	assert.throws(() => argsOf(move, ["--nope", "1"], () => ""), /no flag --nope/);
	assert.throws(() => argsOf(CALL_BY_NAME.get("deck.now")!, ["extra"], () => ""), /left over/);
});

test("a call prints its value as JSON on stdout and its notes on stderr", async () => {
	const out = io();
	assert.equal(await run(["item", "move", "n1", "--at.x", "1", "--at.y", "2"], out), 0);
	assert.deepEqual(JSON.parse(out.outs[0]!), { type: "note", id: "n1" });
	assert.deepEqual(out.errs, ["item.move answered by the fake server."]);
	assert.deepEqual(fake.calls.at(-1)?.args, { id: "n1", at: { x: 1, y: 2 } });
});

test("a string value is printed as it is", async () => {
	const out = io();
	assert.equal(await run(["card", "url", "canvases/a/cards/x/index.html"], out), 0);
	assert.deepEqual(out.outs, ["http://127.0.0.1:4606/cards/a"]);
});

test("a refusal goes to stderr with its code and hint, and exits 1", async () => {
	const out = io();
	assert.equal(await run(["item", "get", "zz"], out), 1);
	assert.deepEqual(out.errs, ["decks: No item called zz. (not_found)\n  try: decks item list"]);
	const missing = io();
	assert.equal(await run(["item", "list"], missing), 1);
	assert.match(missing.errs[0]!, /\(unavailable\)/);
});

test("help lists every call, or says one call's usage", async () => {
	const all = io();
	assert.equal(await run(["help"], all), 0);
	assert.match(all.outs[0]!, /decks item move/);
	const one = io();
	assert.equal(await run(["help", "item", "move"], one), 0);
	assert.match(one.outs[0]!, /^decks item move/);
	assert.equal(await run(["nothing", "here"], io()), 1);
});
