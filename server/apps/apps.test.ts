import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryDeck } from "../kernel/memory-deck.ts";
import { callers, testServer } from "../kernel/testing.ts";
import { features } from "../main.ts";

// The apps feature as calls and as pages, on the real doors, with real processes.

type App = { name: string; kind: string; status: string; url: string; repo?: { branch: string; head: string }; errors?: string[] };
const ann = callers.agent("ann", "work");

/** What each test opened: closed after it whatever it did, so a failed assertion fails and does not hang. */
const open = new Set<() => Promise<void>>();
afterEach(async () => {
	for (const close of [...open]) await close();
});

async function start() {
	const workdir = mkdtempSync(join(tmpdir(), "depot-apps-"));
	const deck = new MemoryDeck({ "canvases/work/canvas.pen": '{"version":"2.14","children":[]}' });
	const s = await testServer({ features: features({ appRun: workdir }), deck });
	const door = await s.listen(0);
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		open.delete(close);
		await door.close();
		await s.close();
		rmSync(workdir, { recursive: true, force: true });
	};
	open.add(close);
	const page = (path: string, init?: RequestInit) => fetch(`${door.url}${path}${path.includes("?") ? "&" : "?"}pass=${door.token}`, init);
	return {
		s,
		page,
		url: (path: string) => `${door.url}${path}`,
		carried: (path: string) => fetch(`${door.url}/app/t/${door.token}/${path}`),
		close,
	};
}

test("a static app is made from its starter, served at once, and is a git repository", async () => {
	const t = await start();
	const made = await t.s.value<App>("app.create", { name: "counter", title: "Counter" }, ann);
	assert.deepEqual([made.kind, made.status, made.url], ["static", "running", "/app/counter/"]);
	assert.equal(made.repo?.branch, "main");
	const home = await t.page("/app/counter/");
	assert.equal(home.status, 200);
	assert.match(await home.text(), /<title>Counter<\/title>/);
	assert.equal((await t.page("/app/counter/style.css")).headers.get("content-type"), "text/css; charset=utf-8");
	assert.equal((await t.page("/app/counter/nope.png")).status, 404);
	const carried = await t.carried("counter/style.css");
	assert.equal(carried.status, 200, "a pass in the path lets a page's relative files in");
	assert.equal((await fetch(t.url("/app/counter/style.css"))).status, 401, "with no pass at all, nothing");
	const again = await t.s.call("app.create", { name: "counter" }, ann);
	assert.equal(again.ok ? "" : again.error.code, "conflict");
	const listed = await t.s.value<App[]>("app.list");
	assert.deepEqual(listed.map((one) => one.name), ["counter"]);
	await t.close();
});

test("a server app runs, answers through the proxy both ways, logs, and stops", async () => {
	const t = await start();
	await t.s.value<App>("app.create", { name: "keep", starter: "node" }, ann);
	const ran = await t.s.value<App>("app.run", { name: "keep" }, ann);
	assert.equal(ran.status, "running");
	const posted = await t.page("/app/keep/api/items", { method: "POST", body: JSON.stringify({ text: "milk" }) });
	assert.equal(posted.status, 201);
	const items = (await (await t.page("/app/keep/api/items")).json()) as { text: string }[];
	assert.deepEqual(items.map((one) => one.text), ["milk"]);
	assert.match(await (await t.page("/app/keep/")).text(), /Something to keep/);
	const logs = await t.s.value<string[]>("app.logs", { name: "keep" }, ann);
	assert.ok(logs.some((line) => /listening on/.test(line)), logs.join("\n"));
	const stopped = await t.s.value<App>("app.stop", { name: "keep" }, ann);
	assert.equal(stopped.status, "stopped");
	assert.equal((await t.page("/app/keep/api/items")).status, 200, "a request wakes a stopped server app");
	await t.close();
});

test("a server app that exits at once is broken, with its error", async () => {
	const t = await start();
	await t.s.value("file.write", { path: "apps/bad/app.json", text: '{"kind":"server","start":"node -e \\"process.exit(3)\\""}' }, ann);
	const ran = await t.s.value<App>("app.run", { name: "bad" }, ann);
	assert.equal(ran.status, "broken");
	assert.ok(ran.errors?.some((line) => /code 3/.test(line)), JSON.stringify(ran.errors));
	await t.close();
});

test("an app shown on a canvas is an app item, and app.delete takes it off and trashes the folder", async () => {
	const t = await start();
	await t.s.value("app.create", { name: "gone" }, ann);
	const placed = await t.s.value<{ type: string; app: string; title?: string }>("item.insert", { item: { type: "app", app: "gone" }, at: { x: 0, y: 0 } }, ann);
	assert.deepEqual([placed.type, placed.app, placed.title], ["app", "gone", "gone"], "placed with no title, it takes its app's");
	assert.deepEqual(await t.s.value("app.delete", { name: "gone" }, ann), { deleted: "apps/gone" });
	const items = await t.s.value<unknown[]>("item.list", { canvas: "work" });
	assert.equal(items.length, 0);
	const got = await t.s.call("app.get", { name: "gone" });
	assert.equal(got.ok ? "" : got.error.code, "not_found");
	await t.close();
});

test("a forwarded port is reached at /rnode with the path stripped and at /node with it kept", async () => {
	const t = await start();
	const local = createServer((req, res) => res.end(`seen ${req.url} auth=${req.headers.authorization ?? "none"}`));
	await new Promise<void>((done) => local.listen(0, "127.0.0.1", done));
	const port = (local.address() as { port: number }).port;
	assert.equal((await t.page(`/rnode/localhost/${port}/x`)).status, 404, "not forwarded yet");
	const opened = await t.s.value<{ port: number; stripped: string }>("port.open", { port, label: "test" }, ann);
	assert.equal(opened.stripped, `/rnode/localhost/${port}/`);
	assert.equal(await (await t.page(`/rnode/localhost/${port}/x?q=1`)).text(), "seen /x?q=1 auth=none");
	assert.equal(await (await t.page(`/node/localhost/${port}/y`)).text(), `seen /node/localhost/${port}/y auth=none`);
	assert.equal((await t.s.value<unknown[]>("port.list")).length, 1);
	await t.s.value("port.close", { port }, ann);
	assert.equal((await t.s.value<unknown[]>("port.list")).length, 0);
	local.close();
	await t.close();
});

test("an app page gets decks-canvas.js, and a canvas pass opens a placed app inside its canvas", async () => {
	const t = await start();
	await t.s.value("app.create", { name: "inside" }, ann);
	await t.s.value("file.write", { path: "apps/inside/sub/page.html", text: "<html><head><title>S</title></head><body>x</body></html>" }, ann);
	assert.match(await (await t.page("/app/inside/sub/page.html")).text(), /<head><script src="\.\.\/decks-canvas\.js"><\/script>/);
	const script = await t.page("/app/inside/decks-canvas.js");
	assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
	assert.match(await script.text(), /decks-storage[\s\S]*decks-wheel/);
	const open = (as: string) => fetch(t.url("/app-pass/inside"), { method: "POST", headers: { authorization: `Bearer ${as}` } });
	const pass = t.s.token({ kind: "person", id: "person~frame-1", name: "you", canvas: "work" });
	assert.equal((await open(pass)).status, 403, "not placed on the canvas yet");
	await t.s.value("item.insert", { item: { type: "app", app: "inside" }, at: { x: 0, y: 0 } }, ann);
	const opened = (await (await open(pass)).json()) as { url: string };
	assert.match(opened.url, /^\/app\/t\/[^/]+\/inside\/$/);
	assert.equal((await fetch(t.url(opened.url))).status, 200, "the address with its pass loads the app");
	const appPass = opened.url.split("/")[3]!;
	await t.s.value("app.create", { name: "neighbour" }, ann);
	assert.equal((await fetch(t.url(`/app/t/${appPass}/neighbour/`))).status, 403, "an app's pass opens only its own app");
	const called = (await (await fetch(t.url("/api/v1/app.list"), { method: "POST", headers: { authorization: `Bearer ${appPass}` } })).json()) as { ok: boolean };
	assert.equal(called.ok, false, "the app's pass makes no calls");
	for (let i = 0; i < 3; i++) await open(pass);
	assert.equal((await fetch(t.url(opened.url))).status, 401, "only the newest three passes live");
	const noCanvas = t.s.token({ kind: "app", id: "some-app", name: "some-app" });
	assert.equal((await open(noCanvas)).status, 403, "a caller with no canvas opens nothing inside one");
	await t.close();
});

test("rule 5: each change of an app's status is app.changed with its name", async () => {
	const t = await start();
	await t.s.value("app.create", { name: "told", starter: "node" }, ann);
	await t.s.value("app.run", { name: "told" }, ann);
	await t.s.value("app.stop", { name: "told" }, ann);
	const told = t.s.heard.filter((one) => one.name === "app.changed" && (one.payload.ids as string[])[0] === "told").map((one) => one.payload.status);
	assert.deepEqual(told.filter((status, i) => status !== told[i - 1]), ["stopped", "starting", "running", "stopped"]);
	await t.close();
});
