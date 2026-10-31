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
	// The agent's own token, as its shell has it (`DECKS_TOKEN`): who is calling comes from this alone.
	const token = app.bridge.issue(agent.id);
	const bearer = (one: string) => ({ authorization: `Bearer ${one}` });
	const call = async (verb: string, args: unknown[] = [], headers: Record<string, string> = bearer(token)) => {
		const response = await fetch(`${base}/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ args }) });
		// A refusal at the gate is a sentence, not the verbs' JSON.
		const text = await response.text();
		let body: { ok: boolean; value?: unknown; error?: string; notes: string[] };
		try {
			body = JSON.parse(text) as typeof body;
		} catch {
			body = { ok: false, error: text, notes: [] };
		}
		return { status: response.status, body };
	};
	return {
		app,
		deck,
		base,
		agent,
		token,
		bearer,
		call,
		cleanup: () => {
			server.close();
			app.dispose();
			rmSync(dataDir, { recursive: true, force: true });
		},
	};
}

test("GET /api/v1 lists every verb with its signature", async () => {
	const { base, token, bearer, cleanup } = await open();
	try {
		assert.equal((await fetch(base)).status, 401, "even the list needs a token");
		const listed = (await (await fetch(base, { headers: bearer(token) })).json()) as { verbs: Array<{ name: string; signature: string; effect: string; alias?: string }> };
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
		assert.equal(listed.verbs.find((verb) => verb.name === "move")?.alias, "decks.canvas.move(card, { at })", "an old name is listed with its new call");
	} finally {
		cleanup();
	}
});

test("a verb is called for the agent whose token the request carries, whatever a header says", async () => {
	const { app, call, agent, token, bearer, cleanup } = await open();
	try {
		const byId = await call("boards");
		assert.equal(byId.status, 200);
		assert.ok(byId.body.ok);
		assert.ok((byId.body.value as Array<{ path: string }>).some((board) => board.path === "boards/tall.html"));

		const renamed = await call("me", [{ name: "Wren", tags: ["testing"], workspace: "decks", avatar: { emoji: "🐦" } }]);
		assert.ok(renamed.body.ok, renamed.body.error);
		assert.equal((renamed.body.value as { name: string }).name, "Wren");
		assert.equal(agent.name, "Wren");

		// Another agent named in a header changes nothing: the token is who is calling.
		const other = app.agents.create({ name: "Ada" });
		const claimed = await call("me", [], { ...bearer(token), "x-decks-agent": other.id });
		assert.equal((claimed.body.value as { name: string }).name, "Wren");
		const theirs = await call("me", [], bearer(app.bridge.issue(other.id)));
		assert.equal((theirs.body.value as { name: string }).name, "Ada");
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
		assert.match(path, /^canvases\/[^/]+\/cards\/the-finding\//, "made in the caller's canvas");
		assert.ok(existsSync(join(deck, path)), "the board's file was written");
		assert.ok(made.body.notes.length > 0, "newBoard tells the caller about the viewport, as a run does");
	} finally {
		cleanup();
	}
});

test("wrong calls are answered with a sentence and the verb's signature", async () => {
	const { call, agent, bearer, cleanup } = await open();
	try {
		const missing = await call("move", ["boards/tall.html"]);
		assert.equal(missing.status, 400);
		assert.match(missing.body.error!, /move needs at\. move\(path: string, at: Point\)/);

		const unknown = await call("teleport");
		assert.equal(unknown.status, 404);

		const nobody = await call("boards", [], {});
		assert.equal(nobody.status, 401, "no token, though it comes from this machine");

		const named = await call("boards", [], { "x-decks-agent": agent.id });
		assert.equal(named.status, 401, "a header naming an agent is not a token");

		const stranger = await call("boards", [], bearer("dk_a_nobody-here"));
		assert.equal(stranger.status, 401);

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
	const { base, agent, token, cleanup } = await open();
	try {
		const env = { ...process.env, DECKS_TOKEN: "", ...decksEnv(Number(new URL(base).port), agent.id, token) };
		const listed = await run("sh", ["-c", "decks boards | head -c 2000"], { env });
		assert.ok(JSON.parse(listed.stdout).some((board: { path: string }) => board.path === "boards/tall.html"));
		const made = await run("sh", ["-c", 'p=$(decks new-board --title "From the shell" --at.x1 0 --at.y1 900) && echo "$p"'], { env });
		assert.match(made.stdout.trim(), /^canvases\/[^/]+\/cards\/from-the-shell\//);
		assert.ok(made.stderr.trim().length > 0, `the notes reach the shell on stderr: ${made.stderr}`);
		await assert.rejects(run("sh", ["-c", "decks move boards/tall.html"], { env }), (error: { code: number; stderr: string }) => error.code === 1 && /move needs at/.test(error.stderr));
	} finally {
		cleanup();
	}
});

test("the event stream carries what a verb changed, and only the types asked for", async () => {
	const { connect } = await import("../../../../packages/sdk/src/index.js");
	const { base, token, call, cleanup } = await open();
	try {
		const url = base.replace(/\/api\/v1$/, "");
		const heard: Array<{ type: string; path?: string; card?: { path?: string } }> = [];
		const stream = connect({ url, token, notes: () => {} }).events((event: { type: string; path?: string }) => heard.push(event), { types: ["card.changed", "board.changed"] });
		// The stream is open once its first comment arrives; a short wait is enough on loopback.
		await new Promise((resolve) => setTimeout(resolve, 150));
		const moved = await call("move", ["boards/tall.html", { x: 320, y: 160 }]);
		assert.ok(moved.body.ok, moved.body.error);
		for (let i = 0; i < 40 && !heard.some((event) => event.type === "card.changed" && event.path === "boards/tall.html"); i++) await new Promise((resolve) => setTimeout(resolve, 25));
		stream.close();
		assert.ok(heard.some((event) => event.type === "card.changed" && event.path === "boards/tall.html" && event.card?.path === "boards/tall.html"), `heard ${JSON.stringify(heard.map((event) => event.type))}`);
		// The old name is said beside it until 2026-11-30.
		assert.ok(heard.some((event) => event.type === "board.changed" && event.path === "boards/tall.html"));
		assert.ok(heard.every((event) => event.type === "card.changed" || event.type === "board.changed"), "nothing else came through the filter");
	} finally {
		cleanup();
	}
});

test("the person's verbs act on the stage on screen, and draw no agent cursor", async () => {
	const { app, base, agent, cleanup } = await open();
	try {
		app.agents.focus(agent.id);
		// On screen first, so there is a board to move (`canvas.insert`, as the person).
		// The person's token, as a Decks tab has it; the agent they talk to is a parameter.
		const person = { "content-type": "application/json", authorization: `Bearer ${app.tokens.issue({ kind: "person" }).token}`, "x-decks-agent": agent.id };
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

test("an app is shown by an item: apps.board names it, canvas.insert places it, apps.delete takes it off", async () => {
	const { app, call, cleanup } = await open();
	try {
		mkdirSync(join(app.deck.path, "apps", "notes"), { recursive: true });
		writeFileSync(join(app.deck.path, "apps", "notes", "app.json"), JSON.stringify({ kind: "static", title: "Notes" }));
		writeFileSync(join(app.deck.path, "apps", "notes", "index.html"), "<p>notes</p>");
		const item = await call("apps.board", ["notes"]);
		assert.deepEqual(item.body.value, { type: "app", app: "notes" }, "the item to insert, and no file written");
		assert.equal(existsSync(join(app.deck.path, "boards", "apps", "notes.html")), false);
		const placed = await call("canvas.insert", [item.body.value, { at: { x1: 0, y1: 0 } }]);
		assert.ok(placed.body.ok, placed.body.error);
		const value = placed.body.value as { id: string; type: string; name: string; metadata: unknown; width: number; height: number };
		assert.deepEqual([value.type, value.name, value.metadata, value.width, value.height], ["browser", "Notes", { type: "decks.app", name: "notes" }, 1100, 760]);
		const missing = await call("canvas.insert", [{ type: "app", app: "nothing" }, { at: { x1: 0, y1: 2000 } }]);
		assert.match(String(missing.body.error), /There is no app called "nothing"/);
		const deleted = await call("apps.delete", ["notes"]);
		assert.ok(deleted.body.ok, deleted.body.error);
		const items = (deleted.body.value as { items: string[] }).items;
		assert.equal(items.length, 1, JSON.stringify(deleted.body.value));
		assert.match(items[0]!, new RegExp(`/${value.id}$`), "the item that showed it is off the canvas");
	} finally {
		cleanup();
	}
});

test("each principal calls as itself: an app as the app, a site as the person, whatever board it names", async () => {
	const { callerOf } = await import("./router.ts");
	const { app, call, bearer, cleanup } = await open();
	try {
		mkdirSync(join(app.deck.path, "apps", "notes"), { recursive: true });
		writeFileSync(join(app.deck.path, "apps", "notes", "app.json"), JSON.stringify({ kind: "static" }));
		writeFileSync(join(app.deck.path, "apps", "notes", "index.html"), "<p>notes</p>");
		// Let it in ahead, so no question waits on a person.
		app.evalTrust.allow("apps/notes");

		// An app's server holds a pass for its run; a run that is not the app's (it stopped) is nobody.
		const runs: Record<string, string> = { notes: "run1", nothing: "run2" };
		app.apps.runOf = (name: string) => runs[name];
		const asApp = await call("boards", [], bearer(app.passes.appServer("notes", "run1")));
		assert.equal(asApp.status, 200, asApp.body.error);
		const gone = await call("boards", [], bearer(app.passes.appServer("nothing", "run2")));
		assert.equal(gone.status, 404);
		const stopped = await call("boards", [], bearer(app.passes.appServer("notes", "run0")));
		assert.equal(stopped.status, 401, "an earlier run's pass");
		const tab = await call("boards", [], bearer(app.passes.appTab("notes", app.tokens.issue({ kind: "person" }).id).pass));
		assert.equal(tab.status, 401, "a tab's pass opens the app's page, and calls nothing");

		const site = bearer(app.tokens.issue({ kind: "site", label: "Studio" }).token);
		assert.equal((await call("boards", [], site)).status, 200);
		const named = await callerOf(app, { headers: { "x-decks-board": encodeURIComponent("boards/tall.html") }, principal: { kind: "site", label: "Studio" } }, new Set());
		assert.ok(!("error" in named) && named.announce === undefined, "a site naming a board is still the person");

		const none = await callerOf(app, { headers: { "x-decks-person": "1" } }, new Set());
		assert.ok("error" in none && none.status === 401, "a header is nobody");
	} finally {
		cleanup();
	}
});

test("an agent's harness token calls as that agent while it runs, with no idle limit, and stops working when the agent is removed", async () => {
	const { app, call, bearer, cleanup } = await open();
	try {
		const ada = app.agents.create({ name: "Ada" });
		const token = app.bridge.issue(ada.id);
		assert.match(token, /^dk_h_/);
		assert.equal(app.tokens.verify(token, { now: Date.now() + 400 * 86_400_000 }).ok, true, "no idle limit while its agent is there");
		const me = await call("me", [], bearer(token));
		assert.equal((me.body.value as { name: string }).name, "Ada");
		assert.equal(app.agents.remove(ada.id).removed, true);
		const after = await call("me", [], bearer(token));
		assert.equal(after.status, 401, "its agent stopped: its token with it");
	} finally {
		cleanup();
	}
});
