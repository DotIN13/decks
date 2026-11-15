import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { join } from "node:path";
import { MemoryDeck } from "../kernel/memory-deck.ts";
import { callers, testServer } from "../kernel/testing.ts";
import { features } from "../main.ts";

// Rule 2: an in-deck app runs in a copy outside the deck, and its data folder is the deck's.

const ann = callers.agent("ann", "work");
const SERVER = `import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
mkdirSync("data", { recursive: true });
createServer((req, res) => {
	if (req.url === "/write") { writeFileSync("data/x.json", JSON.stringify({ from: "app" })); return res.end("ok"); }
	if (req.url === "/read") { try { return res.end(readFileSync("data/note.txt", "utf8")); } catch { return res.end("none"); } }
	res.end("hi");
}).listen(Number(process.env.PORT), "127.0.0.1");
`;

async function until<T>(look: () => Promise<T | undefined>, ms = 5000): Promise<T | undefined> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const got = await look().catch(() => undefined);
		if (got !== undefined) return got;
		await new Promise((r) => setTimeout(r, 100));
	}
	return undefined;
}

test("a server app writes data/x.json in its copy and file.read sees it; a call's write reaches the app", async () => {
	const s = await testServer({ features: features(), deck: new MemoryDeck({ "canvases/work/canvas.pen": '{"version":"2.14","children":[]}' }) });
	const door = await s.listen(0);
	const page = async (path: string) => (await fetch(`${door.url}/app/keep/${path}?pass=${door.token}`)).text();
	await s.value("file.write", { path: "apps/keep/app.json", text: '{"kind":"server","start":"node server.mjs"}' }, ann);
	await s.value("file.write", { path: "apps/keep/server.mjs", text: SERVER }, ann);
	assert.equal((await s.value<{ status: string }>("app.run", { name: "keep" }, ann)).status, "running");
	assert.equal(await page("write"), "ok");
	const read = await until(async () => (await s.call("file.read", { path: "apps/keep/data/x.json" })).ok ? s.value<{ text: string }>("file.read", { path: "apps/keep/data/x.json" }) : undefined);
	assert.equal(read?.text, '{"from":"app"}', "what the app wrote is in the deck");
	await s.value("file.write", { path: "apps/keep/data/note.txt", text: "from ann" }, ann);
	assert.equal(await until(async () => ((await page("read")) === "from ann" ? "yes" : undefined)), "yes", "what a call wrote reaches the app");
	await door.close();
	await s.close();
});

test("after a build the deck holds no node_modules and no build; the copy is under the machine folder", async () => {
	const s = await testServer({ features: features(), deck: new MemoryDeck({ "canvases/work/canvas.pen": '{"version":"2.14","children":[]}' }) });
	const manifest = { kind: "build", install: "mkdir -p node_modules/x && echo 1 > node_modules/x/i.js", build: "mkdir -p dist && echo '<title>B</title>' > dist/index.html" };
	await s.value("file.write", { path: "apps/built/app.json", text: JSON.stringify(manifest) }, ann);
	await s.value("file.write", { path: "apps/built/package.json", text: '{"dependencies":{"x":"1"}}' }, ann);
	assert.equal((await s.value<{ status: string }>("app.build", { name: "built" }, ann)).status, "running");
	const files = await s.value<{ path: string }[]>("file.list", { path: "apps/built", deep: true });
	assert.deepEqual(files.map((one) => one.path).filter((path) => /node_modules|dist/.test(path)), [], "nothing built is in the deck");
	const copy = join(s.kernel.machine(), "app-run", s.kernel.deckId(), "built");
	assert.ok(existsSync(join(copy, "node_modules/x/i.js")) && existsSync(join(copy, "dist/index.html")), `built in ${copy}`);
	await s.close();
});
