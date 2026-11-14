import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { features } from "../main.ts";
import { testServer } from "../kernel/testing.ts";

// Today's line against the fixture deck: hello, watch, an edit in pen.dev's own form,
// the change told back whole as canvas.changed, and the drawing's file written.

const FIXTURE = new URL("../../tools/fixtures/deck/", import.meta.url).pathname;

export function fixtureFiles(dir = FIXTURE): Record<string, string> {
	const out: Record<string, string> = {};
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) Object.assign(out, fixtureFiles(path));
		else if (!/\.(pdf|png|jpg)$/.test(name)) out[relative(FIXTURE, path)] = readFileSync(path, "utf8");
	}
	return out;
}

type Said = Record<string, unknown>;

function openLine(url: string): { send(m: Said): void; next(type: string): Promise<Said>; close(): void } {
	const ws = new WebSocket(`${url.replace("http", "ws")}/compat/v1/socket`);
	const heard: Said[] = [];
	const waiting: Array<() => void> = [];
	ws.onmessage = (m) => (heard.push(JSON.parse(String(m.data)) as Said), waiting.splice(0).forEach((w) => w()));
	const opened = new Promise((done) => (ws.onopen = done));
	return {
		send: (m) => void opened.then(() => ws.send(JSON.stringify(m))),
		async next(type) {
			const until = Date.now() + 5_000;
			for (;;) {
				if (Date.now() > until) throw new Error(`no ${type}; heard ${JSON.stringify(heard).slice(0, 400)}`);
				const at = heard.findIndex((m) => m.type === type);
				if (at >= 0) return heard.splice(at, 1)[0]!;
				await new Promise<void>((done) => (waiting.push(done), setTimeout(done, 200)));
			}
		},
		close: () => ws.close(),
	};
}

test("today's line draws and edits the fixture canvas through compat", async () => {
	const server = await testServer({ features: features(), deck: fixtureFiles() });
	const doors = await server.listen(0);
	const drawing = await fetch(`${doors.url}/compat/stage-pen/auth-refresh`, { headers: { authorization: `Bearer ${doors.token}` } });
	const first = (await drawing.json()) as { doc: { children: unknown[] }; rev: number; cards: Array<{ path: string }> };
	assert.ok(first.doc.children.length >= 5);
	assert.ok(first.cards.some((c) => c.path === "canvases/auth-refresh/cards/plan/index.html"));
	const line = openLine(doors.url);
	line.send({ type: "line.hello", token: doors.token, watch: [{ canvas: "auth-refresh", since: first.rev }] });
	assert.equal((await line.next("line.hello")).who, "person");
	const op = { op: "insert", node: { type: "note", id: "compat-note", content: "From today's line" }, box: { x1: 40, y1: 2000 } };
	line.send({ type: "line.call", id: "1", verb: "canvas.batch", args: [[op], { canvas: "auth-refresh" }] });
	const answered = await line.next("call.answered");
	assert.equal(answered.ok, true, String(answered.error));
	const changed = await line.next("canvas.changed");
	assert.ok(JSON.stringify(changed.doc).includes("compat-note"), `rev ${String(changed.rev)} first ${first.rev}`);
	const file = new TextDecoder().decode(await server.deck.read("canvases/auth-refresh/canvas.pen" as never));
	assert.match(file, /From today's line/);
	line.close();
	await doors.close();
	await server.close();
});
