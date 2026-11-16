// The page is public; a pass needs the person's token and opens one canvas's files only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testServer } from "../kernel/testing.ts";
import { features } from "../main.ts";
import { frameFeature } from "./feature.ts";

/** Every temp folder a test here makes, removed when the file's tests end. */
const made: string[] = [];
after(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const deck = {
	"canvases/plan/canvas.pen": JSON.stringify({ version: "2.14", children: [] }),
	"canvases/plan/canvas.json": JSON.stringify({ title: "Plan" }),
	"canvases/plan/files/a.txt": "hello",
	"canvases/other/canvas.pen": JSON.stringify({ version: "2.14", children: [] }),
	"canvases/other/files/b.txt": "secret",
};

test("the built page is public, and says how to build it when it is not", async () => {
	const dist = `${mkdtempSync(join(tmpdir(), "frame-"))}/`;
	made.push(dist);
	const server = await testServer({ features: [frameFeature({ dist })] });
	const doors = await server.listen(0);
	assert.equal((await fetch(`${doors.url}/canvas-frame.html`)).status, 503);
	writeFileSync(join(dist, "canvas-frame.html"), "<p>frame</p>");
	const page = await fetch(`${doors.url}/canvas-frame.html`, { headers: { origin: "null" } });
	assert.equal(await page.text(), "<p>frame</p>");
	assert.equal((await fetch(`${doors.url}/frame-assets/../../package.json`)).status, 404);
	await doors.close();
	await server.close();
});

test("a pass opens its canvas's files, and nothing else", async () => {
	const server = await testServer({ features: [...features().filter((f) => f.name !== "frame"), frameFeature()], deck });
	const doors = await server.listen(0);
	const ask = (token: string) => fetch(`${doors.url}/api/passes`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ canvas: "Plan" }) });
	const got = (await (await ask(doors.token)).json()) as { pass: string; expires: number; imports?: unknown };
	assert.ok(got.pass && got.expires > Date.now());
	assert.deepEqual(got.imports, {}, "no map in the deck: an empty one, so the frame never looks for it");
	assert.equal((await ask(got.pass)).status, 403, "a pass cannot ask for a pass");
	const file = (path: string) => fetch(`${doors.url}/api/t/${got.pass}/card/${path}`);
	assert.equal(await (await file("canvases/plan/files/a.txt")).text(), "hello");
	assert.equal((await file("canvases/other/files/b.txt")).status, 404);
	assert.equal((await fetch(`${doors.url}/api/t/dk_nothing/card/canvases/plan/files/a.txt`)).status, 404);
	await doors.close();
	await server.close();
});

test("a card asked at a revision is the card's folder", async () => {
	const server = await testServer({ features: features(), deck: { ...deck, "canvases/plan/cards/one/index.html": "<p>one</p>" } });
	const doors = await server.listen(0);
	const got = (await (await fetch(`${doors.url}/api/passes`, { method: "POST", headers: { authorization: `Bearer ${doors.token}` }, body: JSON.stringify({ canvas: "plan" }) })).json()) as { pass: string };
	const raw = await fetch(`${doors.url}/api/t/${got.pass}/card/canvases/plan/cards/one@4/index.html?raw=1`);
	assert.equal(await raw.text(), "<p>one</p>");
	await doors.close();
	await server.close();
});

test("a canvas's lib/ on a pass is the deck's lib/", async () => {
	const server = await testServer({ features: features(), deck: { ...deck, "lib/card.css": "body{}", "assets/a.svg": "<svg/>" } });
	const doors = await server.listen(0);
	const got = (await (await fetch(`${doors.url}/api/passes`, { method: "POST", headers: { authorization: `Bearer ${doors.token}` }, body: JSON.stringify({ canvas: "plan" }) })).json()) as { pass: string };
	const css = await fetch(`${doors.url}/api/t/${got.pass}/card/canvases/plan/lib/card.css`);
	assert.equal(css.status, 200);
	assert.equal((await fetch(`${doors.url}/api/t/${got.pass}/card/canvases/plan/assets/a.svg`)).status, 200);
	await doors.close();
	await server.close();
});

test("a pass names its asker, and page: false leaves the page to the host", async () => {
	const server = await testServer({ features: [...features().filter((f) => f.name !== "frame"), frameFeature({ page: false })], deck });
	const doors = await server.listen(0);
	assert.equal((await fetch(`${doors.url}/canvas-frame.html`)).status, 404);
	const got = (await (await fetch(`${doors.url}/api/passes`, { method: "POST", headers: { authorization: `Bearer ${doors.token}` }, body: JSON.stringify({ canvas: "plan" }) })).json()) as { pass: string };
	const who = await fetch(`${doors.url}/api/v1/agent.list`, { method: "POST", headers: { authorization: `Bearer ${got.pass}` }, body: "{}" });
	assert.ok(who.status === 200);
	await doors.close();
	await server.close();
});

test("a pass's caller id starts with its asker's id", async () => {
	const { Passes, isPass } = await import("./passes.ts");
	const issued: Array<{ id: string; name: string; canvas?: string }> = [];
	const passes = new Passes({ issue: (who) => (issued.push(who), "tok"), forget: () => undefined });
	passes.issue("plan", { kind: "person", id: "acct-7", name: "Ada" });
	assert.match(issued[0]!.id, /^acct-7~frame-\d+-/);
	assert.equal(issued[0]!.name, "Ada");
	assert.ok(isPass(issued[0]!.id) && !isPass("acct-7"));
	passes.end("tok");
});

test("a renewal keeps its pass's caller id, and the old pass ends by its own token", async () => {
	const { Passes } = await import("./passes.ts");
	const ids = new Map<string, string>();
	const forgotten: string[] = [];
	let n = 0;
	const passes = new Passes({ issue: (who) => { const token = `tok-${++n}`; ids.set(token, who.id); return token; }, forget: (token) => void forgotten.push(token) });
	const ada = { kind: "person" as const, id: "acct-7", name: "Ada" };
	const first = passes.issue("plan", ada).pass;
	const renewed = passes.issue("plan", ada, first).pass;
	assert.equal(ids.get(renewed), ids.get(first));
	// Only a pass held for the same asker and canvas lends its id.
	assert.notEqual(ids.get(passes.issue("other", ada, first).pass), ids.get(first));
	assert.notEqual(ids.get(passes.issue("plan", { ...ada, id: "acct-8" }, first).pass), ids.get(first));
	assert.notEqual(ids.get(passes.issue("plan", ada, "tok-unknown").pass), ids.get(first));
	passes.end(first);
	assert.deepEqual(forgotten, [first]);
	assert.equal(passes.canvasOf(renewed), "plan");
	for (const token of ids.keys()) passes.end(token);
});

test("the sandboxed frame (origin null) reads its page, assets and pass files", async () => {
	const server = await testServer({ features: features(), deck });
	const doors = await server.listen(0);
	const got = (await (await fetch(`${doors.url}/api/passes`, { method: "POST", headers: { authorization: `Bearer ${doors.token}` }, body: JSON.stringify({ canvas: "plan" }) })).json()) as { pass: string };
	const file = await fetch(`${doors.url}/api/t/${got.pass}/card/canvases/plan/files/a.txt`, { headers: { origin: "null" } });
	assert.equal(file.status, 200);
	assert.equal(file.headers.get("access-control-allow-origin"), "*");
	await doors.close();
	await server.close();
});

test("the deck's import map is read by the protocol's rule: paths under assets/ (a leading / too, as today), https as it is", async () => {
	const { deckFiles } = await import("../../protocol/index.ts");
	const map = JSON.stringify({ imports: { greet: "./libs/greet/index.js", d3: "https://cdn.example/d3.js", out: "../secret.js", hid: "./.git/x.js", root: "/abs.js", n: 3 } });
	assert.deepEqual(deckFiles.importMap(map), { greet: "assets/libs/greet/index.js", d3: "https://cdn.example/d3.js", root: "assets/abs.js" });
});
