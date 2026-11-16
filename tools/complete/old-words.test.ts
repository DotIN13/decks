import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../clients/cli/index.ts";
import { answer } from "../../clients/mcp/index.ts";
import { clientFor, DecksError } from "../../clients/sdk/index.ts";
import { start, type Started } from "./start.ts";

// Every verb of today's table (packages/api/src/verbs.ts at rewrite-stop-3) is answered by the decks
// command, the SDK and the MCP relay of the rewrite, against the server main starts: an old word may be
// refused for its arguments or for what it needs, but never as a name nobody knows.

const TODAY = [
	"canvas.read", "canvas.space", "canvas.insert", "canvas.update", "canvas.replace", "canvas.delete", "canvas.move", "canvas.copy",
	"canvas.clip", "canvas.paste", "canvas.variables", "canvas.batch", "canvas.step", "canvas.fit", "canvas.save", "canvas.screenshot",
	"canvas.export", "canvas.rename", "canvas.file", "card.list", "card.create", "card.get", "card.canvases", "card.url", "canvas.list",
	"canvas.create", "canvas.copyShared", "frame.create", "file.url", "agent.me", "agent.update", "here", "agent.claim", "agent.inbox",
	"agent.list", "agent.get", "agent.send", "agent.queue", "agent.create", "view.goto", "view.focus", "view.camera", "view.move",
	"view.viewport", "view.cursor", "view.reload", "apps.list", "apps.status", "apps.create", "apps.repo", "apps.clone", "apps.item",
	"apps.build", "apps.run", "apps.stop", "apps.restart", "apps.delete", "apps.logs", "apps.check", "web.status", "web.pairing",
	"web.repair", "web.open", "web.read", "web.screenshot", "web.fill", "web.select", "web.click", "web.press", "web.submit", "web.stop",
	"ports", "studio.connect", "pair.code", "studio.status", "studio.disconnect", "now",
];

/** Calls that would start something real on this machine (an agent, a clone, a pairing): walked with arguments that are refused. */
const UNKNOWN = /no (call|command|tool)\b|there is no call|no call named|is not a call/i;
const words = (name: string) => name.split(".").map((part) => part.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));

let s: Started;
before(async () => {
	s = await start();
	process.env.DECKS_URL = s.url;
	process.env.DECKS_TOKEN = s.token;
});
after(async () => s.stop());

/** At most a few seconds a call: one that waits for a screen or a tab is answered by its new call all the same. */
const settle = <T>(p: Promise<T>) => Promise.race([p, new Promise<"waited">((done) => setTimeout(() => done("waited"), 3000).unref())]);

test("the SDK answers every verb of today's table, by call and as decks.<noun>.<verb>", async () => {
	const client = clientFor(s.url, s.token);
	const unknown: string[] = [];
	for (const name of TODAY) {
		const heard = await settle(client.call(name, []).then(() => "ok", (error: unknown) => (error instanceof DecksError ? error.message : String(error))));
		if (UNKNOWN.test(heard)) unknown.push(`${name}: ${heard}`);
		const [noun, verb] = name.includes(".") ? name.split(".") : [undefined, name];
		const fn = noun ? (client.decks as never as Record<string, Record<string, unknown>>)[noun]?.[verb!] : (client.decks as never as Record<string, unknown>)[verb!];
		if (typeof fn !== "function") unknown.push(`decks.${name} is not a function`);
	}
	assert.deepEqual(unknown, []);
	console.log(`SDK: ${TODAY.length} of today's verbs answered`);
});

test("the decks command answers every verb of today's table", async () => {
	const unknown: string[] = [];
	for (const name of TODAY) {
		const err: string[] = [];
		await settle(run(words(name), { out: () => {}, err: (text) => void err.push(text), stdin: () => "" }));
		if (err.some((line) => UNKNOWN.test(line))) unknown.push(`${name}: ${err.join(" ")}`);
	}
	assert.deepEqual(unknown, []);
	console.log(`decks command: ${TODAY.length} of today's verbs answered`);
});

test("the MCP relay answers every verb of today's table as a tool", async () => {
	const client = async () => clientFor(s.url, s.token);
	const unknown: string[] = [];
	for (const name of TODAY) {
		const out = (await settle(answer({ id: 1, method: "tools/call", params: { name, arguments: {} } }, client))) as { result?: { content: { text: string }[] } } | "waited";
		const text = out === "waited" ? "" : (out.result?.content[0]?.text ?? "");
		if (UNKNOWN.test(text)) unknown.push(`${name}: ${text}`);
	}
	assert.deepEqual(unknown, []);
	console.log(`MCP: ${TODAY.length} of today's verbs answered`);
});

test("today's words do what they did: insert, read with today's answer, delete an item", async () => {
	const client = clientFor(s.url, s.token);
	const d = client.decks as never as Record<string, Record<string, (...args: unknown[]) => Promise<any>>>;
	const made = await d.canvas!.insert!({ type: "note", content: "old words" });
	assert.equal(typeof made.id, "string");
	const read = await d.canvas!.read!();
	assert.ok(Array.isArray(read.items) && read.items.some((item: { id: string }) => item.id === made.id));
	await d.canvas!.delete!(made.id);
	const after = await d.canvas!.read!();
	assert.ok(!after.items.some((item: { id: string }) => item.id === made.id));
});

test("today's command lines and tools do what they did", async () => {
	const out: string[] = [];
	const io = { out: (text: string) => void out.push(text), err: () => {}, stdin: () => "" };
	assert.equal(await run(["canvas", "insert", "--type", "note", "--content", "from the old command"], io), 0);
	const made = JSON.parse(out.pop()!) as { id: string };
	assert.equal(await run(["canvas", "read"], io), 0);
	assert.ok((JSON.parse(out.pop()!) as { items: { id: string }[] }).items.some((item) => item.id === made.id));
	assert.equal(await run(["canvas", "delete", made.id], io), 0);
	const tool = (await answer({ id: 2, method: "tools/call", params: { name: "canvas.insert", arguments: { item: { type: "note" } } } }, async () => clientFor(s.url, s.token))) as { result: { isError: boolean; content: { text: string }[] } };
	assert.equal(tool.result.isError, false, tool.result.content[0]!.text);
});
