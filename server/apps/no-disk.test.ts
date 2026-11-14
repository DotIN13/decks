import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryDeck } from "../kernel/memory-deck.ts";
import { callers, testServer } from "../kernel/testing.ts";
import { features } from "../main.ts";

// The no-disk check for apps: a client with no disk writes an app with the
// file calls alone, builds it, runs it and reads its page over HTTP. The
// deck is in memory; only the server's running copy is on this machine.

const SERVER = `import { createServer } from "node:http";
createServer((req, res) => res.end("<title>Hello</title><p>Made by calls at " + req.url + "</p>")).listen(Number(process.env.PORT), "127.0.0.1");
`;

test("an app made with file.write is built, run and read, with no disk on the client", async () => {
	const workdir = mkdtempSync(join(tmpdir(), "depot-nodisk-"));
	const ann = callers.agent("ann", "work");
	const deck = new MemoryDeck({ "canvases/work/canvas.pen": '{"version":"2.14","children":[]}' });
	const s = await testServer({ features: features({ appRun: workdir }), deck });
	const door = await s.listen(0);
	await s.value("file.write", { path: "apps/hello/app.json", text: '{ "title": "Hello", "kind": "server", "build": "node -e \\"console.log(1)\\"", "start": "node server.mjs" }\n' }, ann);
	await s.value("file.write", { path: "apps/hello/server.mjs", text: SERVER }, ann);
	const built = await s.value<{ status: string }>("app.build", { name: "hello" }, ann);
	assert.equal(built.status, "stopped", "a built server app waits to be run");
	const ran = await s.value<{ status: string; url: string }>("app.run", { name: "hello" }, ann);
	assert.equal(ran.status, "running");
	const page = await fetch(`${door.url}${ran.url}there?pass=${door.token}`);
	assert.equal(await page.text(), "<title>Hello</title><p>Made by calls at /there</p>");
	await s.value("file.edit", { path: "apps/hello/server.mjs", edits: [{ find: "Made by calls", replace: "Changed by calls" }] }, ann);
	await s.value("app.restart", { name: "hello" }, ann);
	assert.match(await (await fetch(`${door.url}/app/hello/?pass=${door.token}`)).text(), /Changed by calls/);
	await door.close();
	await s.close();
	rmSync(workdir, { recursive: true, force: true });
});
