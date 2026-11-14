import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { CALLS, type Node } from "../../protocol/index.ts";
import { fakeServer, type Fake } from "../sdk/testing/fake-server.ts";
import { argsOf } from "./args.ts";

// Plain arguments work for every call, in the order it declares them, and
// the command run as a process sends what the words say.

type Obj = Extract<Node, { k: "obj" }>;
const plain = (n: Node) => n.k === "str" || n.k === "num" || (n.k === "lit" && n.values.every((v) => typeof v === "string"));
const sample = (n: Node, i: number): string => (n.k === "num" ? String(i + 1) : n.k === "lit" ? String(n.values[0]) : `w${i}`);

test("every call takes its required plain arguments as words, in declared order", () => {
	for (const call of CALLS) {
		const input = call.input as Obj;
		const keys = input.required.filter((key) => plain(input.props[key]!));
		const words = keys.map((key, i) => sample(input.props[key]!, i));
		const expected = Object.fromEntries(keys.map((key, i) => [key, input.props[key]!.k === "num" ? i + 1 : words[i]]));
		const got = argsOf(call, words, () => "");
		for (const key of keys) assert.deepEqual(got[key], expected[key], `${call.name}: ${key}`);
	}
});

let fake: Fake;
before(async () => {
	fake = await fakeServer(4604, {
		"view.goto": (args) => ({ canvas: args.canvas, moved: true }),
		"card.create": (args) => ({ path: `canvases/${args.canvas ?? "home"}/cards/x/index.html`, title: args.title }),
		"item.insert": (args) => ({ ...(args.item as object), id: "c1" }),
	});
});
after(() => fake.close());

function decks(...words: string[]): Promise<{ code: number; out: string; err: string }> {
	const main = new URL("./main.ts", import.meta.url).pathname;
	return new Promise((resolve) => {
		execFile(process.execPath, [main, ...words], { env: { ...process.env, DECKS_URL: fake.url, DECKS_TOKEN: fake.token } }, (error, out, err) =>
			resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out, err }),
		);
	});
}

test("decks view goto claude-1: the canvas is the thing, so it is a word", async () => {
	const run = await decks("view", "goto", "claude-1");
	assert.equal(run.code, 0, run.err);
	assert.deepEqual(fake.calls.at(-1), { name: "view.goto", args: { canvas: "claude-1" }, token: fake.token });
});

test("decks card create <title>: the title is a word, the canvas a flag", async () => {
	const run = await decks("card", "create", "Q3 revenue is up a fifth", "--canvas", "plan");
	assert.equal(run.code, 0, run.err);
	assert.deepEqual(fake.calls.at(-1)?.args, { title: "Q3 revenue is up a fifth", canvas: "plan" });
	assert.equal(JSON.parse(run.out).title, "Q3 revenue is up a fifth");
});

test("decks item insert --type card --card p: keys of the item go into it, as today", async () => {
	const run = await decks("item", "insert", "--type", "card", "--card", "canvases/plan/cards/x/index.html", "--beside", "n1");
	assert.equal(run.code, 0, run.err);
	assert.deepEqual(fake.calls.at(-1)?.args, { item: { type: "card", card: "canvases/plan/cards/x/index.html" }, beside: "n1" });
});

test("a word left over is refused with exit 1 and says why", async () => {
	const run = await decks("deck", "now", "extra");
	assert.equal(run.code, 1);
	assert.match(run.err, /left over/);
});
