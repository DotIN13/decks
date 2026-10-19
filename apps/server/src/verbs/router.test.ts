import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { createHttpApp } from "../http.ts";

/** A deck with one board, its HTTP server on a free port, and the focused agent's id. */
async function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-verbs-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	writeFileSync(
		join(deck, "boards", "tall.html"),
		`<!doctype html><html><head><title>Tall</title><meta name="board" content='{"w":900,"h":400,"bg":"grid"}' /></head><body class="board"></body></html>`,
	);
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const server = createHttpApp(app).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
	const agent = app.agents.focused();
	const call = async (verb: string, args: unknown[] = [], headers: Record<string, string> = { "x-decks-agent": agent.id }) => {
		const response = await fetch(`${base}/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ args }) });
		return { status: response.status, body: (await response.json()) as { ok: boolean; value?: unknown; error?: string; notes: string[] } };
	};
	return {
		app,
		deck,
		base,
		agent,
		call,
		cleanup: () => {
			server.close();
			app.dispose();
			rmSync(dataDir, { recursive: true, force: true });
		},
	};
}

test("GET /api/v1 lists every verb with its signature", async () => {
	const { base, cleanup } = await open();
	try {
		const listed = (await (await fetch(base)).json()) as { verbs: Array<{ name: string; signature: string; effect: string; alias?: string }> };
		const { ALL_VERBS } = await import("@decks/api");
		assert.equal(listed.verbs.length, ALL_VERBS.length);
		assert.deepEqual(listed.verbs.find((verb) => verb.name === "canvas.move"), {
			name: "canvas.move",
			group: "canvas",
			touches: "deck",
			effect: "change",
			summary: "Move an item: to a corner (`at`), 160 px clear of another (`beside`, `below`), or into a frame (`parent`, `index`; null for the canvas itself).",
			signature: "canvas.move(id: string, options?: { canvas?: string; frame?: string; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number })",
		});
		assert.equal(listed.verbs.find((verb) => verb.name === "move")?.alias, "decks.canvas.move(board, { at })", "an old name is listed with its new call");
	} finally {
		cleanup();
	}
});

test("a verb is called for the agent the request names, by id or by name", async () => {
	const { call, agent, cleanup } = await open();
	try {
		const byId = await call("boards");
		assert.equal(byId.status, 200);
		assert.ok(byId.body.ok);
		assert.ok((byId.body.value as Array<{ path: string }>).some((board) => board.path === "boards/tall.html"));

		const renamed = await call("me", [{ name: "Wren", tags: ["testing"], workspace: "decks", avatar: { emoji: "🐦" } }]);
		assert.ok(renamed.body.ok, renamed.body.error);
		assert.equal((renamed.body.value as { name: string }).name, "Wren");
		assert.equal(agent.name, "Wren");

		const byName = await call("me", [], { "x-decks-agent": "wren" });
		assert.equal((byName.body.value as { name: string }).name, "Wren");
	} finally {
		cleanup();
	}
});

test("a change goes to the deck, and its notes come back beside the value", async () => {
	const { call, deck, cleanup } = await open();
	try {
		const made = await call("newBoard", [{ title: "The finding", at: { x1: 0, y1: 0 } }]);
		assert.ok(made.body.ok, made.body.error);
		const path = made.body.value as string;
		assert.match(path, /^boards\/the-finding/);
		assert.ok(existsSync(join(deck, path)), "the board's file was written");
		assert.ok(made.body.notes.length > 0, "newBoard tells the caller about the viewport, as a run does");
	} finally {
		cleanup();
	}
});

test("wrong calls are answered with a sentence and the verb's signature", async () => {
	const { call, cleanup } = await open();
	try {
		const missing = await call("move", ["boards/tall.html"]);
		assert.equal(missing.status, 400);
		assert.match(missing.body.error!, /move needs at\. move\(path: string, at: Point\)/);

		const unknown = await call("teleport");
		assert.equal(unknown.status, 404);

		const nobody = await call("boards", [], {});
		assert.equal(nobody.status, 400);
		assert.match(nobody.body.error!, /X-Decks-Agent/);

		const stranger = await call("boards", [], { "x-decks-agent": "nobody-here" });
		assert.equal(stranger.status, 404);

		const refused = await call("fit", ["boards/no-such.html"]);
		assert.equal(refused.status, 422, "a verb that throws is an answer, not a crash");
		assert.equal(refused.body.ok, false);
		assert.ok(refused.body.error);
	} finally {
		cleanup();
	}
});

test("an agent's shell, as a runtime sets it up, reaches its own stage with the decks command", async () => {
	const { decksEnv } = await import("../runtimes/decks-env.ts");
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const run = promisify(execFile);
	const { base, agent, cleanup } = await open();
	try {
		const env = { ...process.env, ...decksEnv(Number(new URL(base).port), agent.id) };
		const listed = await run("sh", ["-c", "decks boards | head -c 2000"], { env });
		assert.ok(JSON.parse(listed.stdout).some((board: { path: string }) => board.path === "boards/tall.html"));
		const made = await run("sh", ["-c", 'p=$(decks new-board --title "From the shell" --at.x1 0 --at.y1 900) && echo "$p"'], { env });
		assert.match(made.stdout.trim(), /^boards\/from-the-shell/);
		assert.ok(made.stderr.trim().length > 0, `the notes reach the shell on stderr: ${made.stderr}`);
		await assert.rejects(run("sh", ["-c", "decks move boards/tall.html"], { env }), (error: { code: number; stderr: string }) => error.code === 1 && /move needs at/.test(error.stderr));
	} finally {
		cleanup();
	}
});

test("the event stream carries what a verb changed, and only the types asked for", async () => {
	const { connect } = await import("../../../../packages/sdk/src/index.js");
	const { base, agent, call, cleanup } = await open();
	try {
		const url = base.replace(/\/api\/v1$/, "");
		const heard: Array<{ type: string; path?: string }> = [];
		const stream = connect({ url, agent: agent.id, notes: () => {} }).events((event: { type: string; path?: string }) => heard.push(event), { types: ["board.changed"] });
		// The stream is open once its first comment arrives; a short wait is enough on loopback.
		await new Promise((resolve) => setTimeout(resolve, 150));
		const moved = await call("move", ["boards/tall.html", { x: 320, y: 160 }]);
		assert.ok(moved.body.ok, moved.body.error);
		for (let i = 0; i < 40 && !heard.some((event) => event.path === "boards/tall.html"); i++) await new Promise((resolve) => setTimeout(resolve, 25));
		stream.close();
		assert.ok(heard.some((event) => event.type === "board.changed" && event.path === "boards/tall.html"), `heard ${JSON.stringify(heard.map((event) => event.type))}`);
		assert.ok(heard.every((event) => event.type === "board.changed"), "nothing else came through the filter");
	} finally {
		cleanup();
	}
});

test("the person's verbs act on the stage on screen, and draw no agent cursor", async () => {
	const { app, base, agent, cleanup } = await open();
	try {
		app.agents.focus(agent.id);
		// On screen first, so there is a board to move (`canvas.insert`, as the person).
		const person = { "content-type": "application/json", "x-decks-person": "1", "x-decks-agent": agent.id };
		const put = await fetch(`${base}/canvas.insert`, { method: "POST", headers: person, body: JSON.stringify({ args: [{ type: "board", board: "boards/tall.html" }, { at: { x1: 0, y1: 0 } }] }) });
		assert.ok(((await put.json()) as { ok: boolean }).ok);
		const response = await fetch(`${base}/canvas.move`, {
			method: "POST",
			headers: person,
			body: JSON.stringify({ args: ["boards/tall.html", { at: { x1: 40, y1: 80 } }] }),
		});
		const answer = (await response.json()) as { ok: boolean; value?: { box: { x1: number; y1: number } }; notes: string[] };
		assert.ok(answer.ok);
		assert.deepEqual([answer.value?.box.x1, answer.value?.box.y1], [40, 80]);
		assert.deepEqual(answer.notes, [], "the person hears no agent's reminders");
	} finally {
		cleanup();
	}
});
