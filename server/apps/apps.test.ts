import { test } from "node:test";
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

async function start() {
	const workdir = mkdtempSync(join(tmpdir(), "depot-apps-"));
	const deck = new MemoryDeck({ "canvases/work/canvas.pen": '{"version":"2.14","children":[]}' });
	const s = await testServer({ features: features({ appRun: workdir }), deck });
	const door = await s.listen(0);
	const page = (path: string, init?: RequestInit) => fetch(`${door.url}${path}${path.includes("?") ? "&" : "?"}pass=${door.token}`, init);
	return {
		s,
		page,
		url: (path: string) => `${door.url}${path}`,
		carried: (path: string) => fetch(`${door.url}/app/t/${door.token}/${path}`),
		async close() {
			await door.close();
			await s.close();
			rmSync(workdir, { recursive: true, force: true });
		},
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
	const placed = await t.s.value<{ type: string; app: string }>("item.insert", { item: { type: "app", app: "gone" }, at: { x: 0, y: 0 } }, ann);
	assert.deepEqual([placed.type, placed.app], ["app", "gone"]);
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
