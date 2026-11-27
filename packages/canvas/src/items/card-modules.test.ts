import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCardModule } from "./card-modules.ts";

/** The card's files, served by a stand-in for `fetch`; each fetch counted. */
const files = new Map<string, string>();
const fetched: string[] = [];
globalThis.fetch = (async (input: string | URL) => {
	const url = String(input);
	fetched.push(url);
	const body = files.get(url.replace(/\?.*$/, ""));
	return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 });
}) as typeof fetch;

const BASE = "http://deck.test/canvases/c/cards/chart@1/index.html";

test("a card's script runs as a module would: imports by name and beside it, every kind of export, import.meta", async () => {
	files.set(`${BASE}.m0.js`, [
		`import path, { join as joined } from "node:path";`,
		`import * as everything from "node:path";`,
		`import { scale, NAME } from "./chart.js";`,
		`export const twice = (n) => scale(n) * 2, { a, b: [c] } = { a: 1, b: [3] };`,
		`export function named() { return NAME; }`,
		`const hidden = 5; export { hidden as shown };`,
		`export * from "./more.js";`,
		`export const where = import.meta.url;`,
		`export const dynamic = (await import("./more.js")).extra;`,
		`export default function (card) { return joined("a", card) + (path === everything.default ? "!" : "?"); }`,
	].join("\n"));
	files.set("http://deck.test/canvases/c/cards/chart@1/chart.js", `export const scale = (n) => n * 10; export const NAME = "chart";`);
	files.set("http://deck.test/canvases/c/cards/chart@1/more.js", `export const extra = 42;`);
	const m = await loadCardModule("canvases/c/cards/chart/index.html", `${BASE}.m0.js`, "chart@1");
	assert.equal((m.default as (x: string) => string)("b"), "a/b!");
	assert.equal((m.twice as (n: number) => number)(2), 40);
	assert.equal(m.a, 1);
	assert.equal(m.c, 3);
	assert.equal((m.named as () => string)(), "chart");
	assert.equal(m.shown, 5);
	assert.equal(m.extra, 42);
	assert.equal(m.dynamic, 42);
	assert.equal(m.where, `${BASE}.m0.js`);
	// Asked again at the same version: the same module, nothing fetched again.
	const count = fetched.length;
	assert.equal(await loadCardModule("canvases/c/cards/chart/index.html", `${BASE}.m0.js`, "chart@1"), m);
	assert.equal(fetched.length, count);
});

test("a new version of a card lets the old one go, and runs its own", async () => {
	const path = "canvases/c/cards/clock/index.html";
	files.set("http://deck.test/canvases/c/cards/clock@1/index.html.m0.js", `export default "one";`);
	files.set("http://deck.test/canvases/c/cards/clock@2/index.html.m0.js", `export default "two";`);
	const one = await loadCardModule(path, "http://deck.test/canvases/c/cards/clock@1/index.html.m0.js", "clock@1");
	const two = await loadCardModule(path, "http://deck.test/canvases/c/cards/clock@2/index.html.m0.js", "clock@2");
	assert.equal(one.default, "one");
	assert.equal(two.default, "two");
	// The old version is not kept: asked for again, it is fetched and run afresh.
	const count = fetched.length;
	await loadCardModule(path, "http://deck.test/canvases/c/cards/clock@1/index.html.m0.js", "clock@1");
	assert.equal(fetched.length, count + 1);
});

test("an error in a card's script names the card's file and its own line", async () => {
	const address = "http://deck.test/canvases/c/cards/bad@1/index.html.m0.js";
	files.set(address, `import { x } from "./ok.js";\nconst y = 1;\nthrow new Error("line three");`);
	files.set("http://deck.test/canvases/c/cards/bad@1/ok.js", `export const x = 1;`);
	await assert.rejects(loadCardModule("canvases/c/cards/bad/index.html", address, "bad@1"), (error: Error) => {
		assert.match(error.message, /line three/);
		assert.match(String(error.stack), /bad@1\/index\.html\.m0\.js:3/);
		return true;
	});
});
