import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { start, type Started } from "./start.ts";

// Reader's attack on a canvas pass, kept: the server started as main starts
// it, a deck with canvases a and b where b holds a secret, and a's pass trying
// every way into b it found. Each must be refused and leak nothing; what a
// pass may do on its own canvas must still answer.

const A = "auth-refresh";
const SECRET = "SECRET-OF-B";

/** Canvas b: a copy of a's folder, with a secret file and a secret card. */
async function withB(root: string): Promise<void> {
	await cp(join(root, "canvases", A), join(root, "canvases", "b"), { recursive: true });
	await mkdir(join(root, "canvases", "b", "files"), { recursive: true });
	await writeFile(join(root, "canvases", "b", "files", "secret.txt"), SECRET);
	await mkdir(join(root, "canvases", "b", "cards", "secret"), { recursive: true });
	await writeFile(join(root, "canvases", "b", "cards", "secret", "index.html"), `<title>${SECRET}</title><div class="doc">${SECRET}</div>`);
}

type Probe = { status: number; text: string };

function probes(s: Started, pass: string) {
	const call = async (name: string, args: Record<string, unknown> = {}): Promise<Probe> => {
		const r = await fetch(`${s.url}/api/v1/${name}`, { method: "POST", headers: { authorization: `Bearer ${pass}`, "content-type": "application/json" }, body: JSON.stringify(args) });
		return { status: r.status, text: await r.text() };
	};
	const get = async (path: string, how: "bearer" | "query" | "none" = "bearer"): Promise<Probe> => {
		const url = how === "query" ? `${s.url}${path}${path.includes("?") ? "&" : "?"}pass=${encodeURIComponent(pass)}` : `${s.url}${path}`;
		const r = await fetch(url, { headers: how === "bearer" ? { authorization: `Bearer ${pass}` } : {} });
		return { status: r.status, text: await r.text() };
	};
	return { call, get };
}

const answered = (p: Probe) => p.status === 200 && /"ok":true/.test(p.text);
const leaks = (p: Probe) => p.text.includes(SECRET);

test("a canvas pass reaches nothing of another canvas, on any call or route Reader tried", async () => {
	const s = await start("deck", withB);
	try {
		const issued = await fetch(`${s.url}/api/passes`, { method: "POST", headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" }, body: JSON.stringify({ canvas: A }) });
		const pass = ((await issued.json()) as { pass: string }).pass;
		assert.ok(pass, "the person's token asks for a pass");
		const { call, get } = probes(s, pass);
		assert.ok(answered(await call("item.list", {})), "on its own canvas a pass still reads its items");
		const calls: [string, Record<string, unknown>][] = [
			["item.list", { canvas: "b" }],
			["canvas.create", { title: "evil" }],
			["agent.create", { name: "evil" }],
			["agent.send", { agent: "anyone", task: "hi" }],
			["agent.queue", { agent: "anyone", task: "hi" }],
			["file.read", { path: "canvases/b/files/secret.txt" }],
			["file.read", { path: "assets/../canvases/b/files/secret.txt" }],
			["item.insert", { item: { type: "card", card: "canvases/b/cards/secret" } }],
			["item.insert", { item: { type: "document", path: "canvases/b/files/secret.txt" } }],
			["item.batch", { ops: [{ op: "insert", item: { type: "card", card: "canvases/b/cards/secret/index.html" } }] }],
			["card.get", { card: "canvases/b/cards/secret" }],
			["canvas.read", { canvas: "b" }],
			["view.goto", { canvas: "b" }],
			["canvas.export", { of: "x", to: "assets/importmap.json" }],
			["canvas.export", { of: "x", to: "canvases/b/canvas.pen" }],
			["canvas.screenshot", { to: "canvases/b/cards/secret/index.html" }],
			["canvas.screenshot", { to: "apps/x/server.js" }],
		];
		for (const [name, args] of calls) {
			const p = await call(name, args);
			assert.ok(!answered(p) && !leaks(p), `${name} ${JSON.stringify(args)} answered a pass: ${p.text.slice(0, 160)}`);
		}
		const routes: [string, "bearer" | "query" | "none"][] = [
			["/files/canvases/b/files/secret.txt", "query"],
			["/files/canvases/b/cards/secret/index.html", "bearer"],
			[`/api/t/${pass}/card/canvases/b/files/secret.txt`, "none"],
			[`/api/t/${pass}/card/canvases/${A}/%2e%2e/b/files/secret.txt`, "none"],
			[`/api/t/${pass}/card/assets/..%2fcanvases%2fb%2ffiles%2fsecret.txt`, "none"],
			["/pictures/canvases/b/cards/secret/index.html", "bearer"],
			["/pictures/shot?canvas=b", "bearer"],
		];
		for (const [path, how] of routes) {
			const p = await get(path, how);
			assert.ok(p.status !== 200 && !leaks(p), `GET ${path} gave a pass ${p.status}: ${p.text.slice(0, 120)}`);
		}
		const secretCard = await readFile(join(s.root, "canvases", "b", "cards", "secret", "index.html"), "utf8");
		assert.ok(secretCard.includes(SECRET), "nothing a pass called overwrote b's card");
		assert.equal(await stat(join(s.root, "assets", "importmap.json")).then(() => true, () => false), false, "a pass wrote assets/importmap.json");
		const upload = await fetch(`${s.url}/api/upload?name=planted.txt`, { method: "POST", headers: { authorization: `Bearer ${pass}` }, body: "planted" });
		const exists = (path: string) => stat(join(s.root, path)).then(() => true, () => false);
		assert.equal(await exists("assets/planted.txt"), false, `a pass wrote into the deck's assets/ (upload answered ${upload.status})`);
		if (upload.ok) assert.ok(await exists(`canvases/${A}/files/planted.txt`), "an upload a pass may make lands in its own canvas's files/");
		const again = await fetch(`${s.url}/api/passes`, { method: "POST", headers: { authorization: `Bearer ${pass}`, "content-type": "application/json" }, body: JSON.stringify({ canvas: "b" }) });
		assert.ok(again.status >= 400, "a pass asked for a pass");
		const mcp = await fetch(`${s.url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${pass}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "item.list", arguments: { canvas: "b" } } }) });
		const answer = (await mcp.json()) as { result?: { isError?: boolean } };
		assert.equal(answer.result?.isError, true, "MCP answered a pass on b");
	} finally {
		await s.stop();
	}
});
