import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { createHttpApp } from "../http.ts";

/**
 * The canvas frame's token: made for the person's own page, one canvas and their role on it, and
 * good for that canvas's calls, its drawing and its stream from a sandboxed page, and nothing else.
 */

async function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-canvas-token-")));
	const deck = join(dataDir, "decks");
	mkdirSync(deck, { recursive: true });
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const pens = app.stage.pens!;
	const one = pens.claim("One");
	const two = pens.claim("Two");
	const server = createHttpApp(app).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	// What a sandboxed page sends: an opaque origin, from another site as far as the browser says.
	const sandboxed = { origin: "null", "sec-fetch-site": "cross-site" };
	const post = async (path: string, headers: Record<string, string>, body: unknown = { args: [] }) => {
		const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
		const text = await response.text();
		let parsed: Record<string, unknown> = {};
		try {
			parsed = JSON.parse(text) as Record<string, unknown>;
		} catch {
			/* a sentence */
		}
		return { status: response.status, text, body: parsed, headers: response.headers };
	};
	const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
	return {
		app,
		origin,
		one,
		two,
		post,
		bearer,
		sandboxed,
		cleanup: () => {
			server.close();
			app.dispose();
			rmSync(dataDir, { recursive: true, force: true });
		},
	};
}

test("a canvas frame's token is the person's to make, for one canvas, with their role on it", async () => {
	const { app, one, post, bearer, cleanup } = await open();
	try {
		const person = bearer(app.tokens.issue({ kind: "person" }).token);
		const agent = bearer(app.bridge.issue(app.agents.focused().id));
		assert.equal((await post("/api/tokens", agent, { kind: "canvas", canvas: one })).status, 403, "not an agent's");
		assert.equal((await post("/api/tokens", person, { kind: "canvas", canvas: "nowhere" })).status, 404);
		const made = await post("/api/tokens", person, { kind: "canvas", canvas: one });
		assert.equal(made.status, 200, made.text);
		assert.match(String(made.body.token), /^dk_c_/);
		assert.equal(made.body.role, "edit");
		const seen = app.tokens.verify(String(made.body.token));
		assert.ok(seen.ok);
		assert.deepEqual(seen.principal, { kind: "canvas", canvas: one, role: "edit" });
	} finally {
		cleanup();
	}
});

test("from a sandboxed page, the token edits, undoes and reads its own canvas, and no other", async () => {
	const { app, origin, one, two, post, bearer, sandboxed, cleanup } = await open();
	try {
		const frame = { ...bearer(app.tokens.issue({ kind: "canvas", canvas: one, role: "edit" }).token), ...sandboxed };
		// A preflight for the edit's name is answered, for the opaque origin.
		const preflight = await fetch(`${origin}/api/v1/canvas.batch`, { method: "OPTIONS", headers: { ...sandboxed, "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type, x-decks-edit" } });
		assert.equal(preflight.status, 204);
		assert.equal(preflight.headers.get("access-control-allow-origin"), "null");
		assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /X-Decks-Edit/);

		const made = await post("/api/v1/canvas.insert", { ...frame, "x-decks-edit": "e1" }, { args: [{ type: "note", id: "n1", content: "Hi" }, { at: { x1: 0, y1: 0 } }] });
		assert.equal(made.status, 200, made.text);
		assert.ok(app.stage.pens!.get(one).text?.includes("n1"));
		assert.equal(app.stage.pens!.get(two).text?.includes("n1") ?? false, false, "written on its own canvas, the one the call did not name");

		const back = await post("/api/v1/canvas.step", frame, { args: ["undo"] });
		assert.equal(back.status, 200, back.text);
		assert.deepEqual((back.body as { value: unknown }).value, { undo: false, redo: true });
		assert.equal(app.stage.pens!.get(one).text?.includes("n1") ?? false, false, "undone");

		const read = await post("/api/v1/canvas.read", frame);
		assert.equal(read.status, 200);
		assert.equal((await fetch(`${origin}/api/stage-pen/${one}`, { headers: frame })).status, 200, "its drawing");
		assert.equal((await fetch(`${origin}/api/stage-pen/${two}`, { headers: frame })).status, 403, "not another's");

		const other = await post("/api/v1/canvas.read", frame, { args: [{ canvas: two }] });
		assert.equal(other.status, 403, "another canvas, named");
		assert.match(other.text, /alone/);
		for (const verb of ["agent.send", "agent.update", "canvas.list", "canvas.create", "view.goto", "apps.run", "web.open", "pair.code", "canvas.file"]) {
			const refused = await post(`/api/v1/${verb}`, frame, { args: [] });
			assert.equal(refused.status, 403, `${verb}: ${refused.text}`);
		}
		for (const path of ["/api/tokens", "/api/tickets", "/api/deck", "/api/agents", "/api/settings"]) {
			const refused = await post(path, frame, { kind: "canvas", canvas: one });
			assert.equal(refused.status, 403, `${path}: ${refused.text}`);
		}
	} finally {
		cleanup();
	}
});

test("a canvas shared to view gets a token that reads only", async () => {
	const { app, one, post, bearer, sandboxed, cleanup } = await open();
	try {
		const frame = { ...bearer(app.tokens.issue({ kind: "canvas", canvas: one, role: "view" }).token), ...sandboxed };
		assert.equal((await post("/api/v1/canvas.read", frame)).status, 200);
		const refused = await post("/api/v1/canvas.insert", frame, { args: [{ type: "note", content: "x" }, { at: { x1: 0, y1: 0 } }] });
		assert.equal(refused.status, 403);
		assert.match(refused.text, /view/);
	} finally {
		cleanup();
	}
});

test("its stream carries its own canvas's drawing and nothing else", async () => {
	const { app, origin, one, two, bearer, sandboxed, cleanup } = await open();
	try {
		const frame = { ...bearer(app.tokens.issue({ kind: "canvas", canvas: one, role: "edit" }).token), ...sandboxed };
		const controller = new AbortController();
		const response = await fetch(`${origin}/api/v1/events`, { headers: frame, signal: controller.signal });
		assert.equal(response.status, 200);
		const reader = response.body!.getReader();
		const heard: string[] = [];
		const reading = (async () => {
			const decoder = new TextDecoder();
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) return;
					heard.push(decoder.decode(value));
				}
			} catch {
				/* stopped */
			}
		})();
		const pens = app.stage.pens!;
		pens.edit(two, [{ op: "insert", node: { type: "note", id: "theirs", content: "x" } }] as never);
		pens.edit(one, [{ op: "insert", node: { type: "note", id: "mine", content: "x" } }] as never);
		await new Promise((done) => setTimeout(done, 300));
		controller.abort();
		await reading;
		const text = heard.join("");
		assert.match(text, new RegExp(`"stage":"${one}"`), "its own canvas, with no agent on it");
		assert.match(text, /"id":"mine"/);
		assert.equal(text.includes(`"stage":"${two}"`), false, "nothing of the other canvas");
	} finally {
		cleanup();
	}
});

test("an agent's view of its canvas reaches the frame on its stream, and the frame's answer settles it", async () => {
	const { app, origin, one, post, bearer, sandboxed, cleanup } = await open();
	const controller = new AbortController();
	try {
		const agent = app.agents.focused();
		// A view of this canvas by name: the frame following it is the one to answer.
		const person = bearer(app.tokens.issue({ kind: "person" }).token);
		assert.equal((await post("/api/v1/canvas.insert", person, { args: [{ type: "note", id: "n", content: "x" }, { canvas: one, at: { x1: 0, y1: 0 } }] })).status, 200);
		const frame = { ...bearer(app.tokens.issue({ kind: "canvas", canvas: one, role: "edit" }).token), ...sandboxed };
		const response = await fetch(`${origin}/api/v1/events?types=stage.call`, { headers: frame, signal: controller.signal });
		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		let text = "";
		const asked = (async () => {
			while (!text.includes('"stage.call"')) {
				const { value, done } = await reader.read();
				if (done) break;
				text += decoder.decode(value);
			}
		})();
		const answered = post("/api/v1/view.focus", bearer(app.bridge.issue(agent.id)), { args: ["n", { canvas: one }] });
		await asked;
		const line = text.split("\n").find((one) => one.startsWith("data:") && one.includes('"stage.call"'));
		const id = line ? (JSON.parse(line.slice(5)) as { call: { id: string } }).call.id : undefined;
		assert.ok(id, text);
		assert.equal((await post("/api/v1/stage-result", bearer(app.bridge.issue(agent.id)), { id, value: { no: 1 } })).status, 403, "an agent does not answer the canvas's calls");
		const settled = await post("/api/v1/stage-result", frame, { id, value: { shown: ["n"] } });
		assert.equal(settled.body.settled, true);
		const shown = (await answered).body as { value?: { deferred?: string }; notes?: string[] };
		assert.equal(shown.value?.deferred, undefined, `shown, not skipped: ${JSON.stringify(shown)}`);
		await reader.cancel().catch(() => undefined);
	} finally {
		controller.abort();
		cleanup();
	}
});

test("the frame says a card on its canvas was read and how it measured, and gets an old board's token, for its own canvas only", async () => {
	const { app, one, two, post, bearer, sandboxed, cleanup } = await open();
	try {
		const person = bearer(app.tokens.issue({ kind: "person" }).token);
		const mine = String(((await post("/api/v1/card.create", person, { args: [{ title: "Mine", canvas: one }] })).body.value as { path: string }).path);
		const theirs = String(((await post("/api/v1/card.create", person, { args: [{ title: "Theirs", canvas: two }] })).body.value as { path: string }).path);
		const frame = { ...bearer(app.tokens.issue({ kind: "canvas", canvas: one, role: "edit" }).token), ...sandboxed };
		assert.equal((await post("/api/v1/board-seen", frame, { path: mine })).status, 200);
		assert.equal((await post("/api/v1/board-extent", frame, { path: mine, rev: 1, w: 400, h: 300, words: 12 })).status, 200);
		const token = await post("/api/v1/board-token", frame, { path: mine });
		assert.match(String(token.body.token), /^dk_b_/);
		for (const route of ["board-seen", "board-extent", "board-token"]) assert.equal((await post(`/api/v1/${route}`, frame, { path: theirs, rev: 1, w: 1, h: 1 })).status, 403, route);
	} finally {
		cleanup();
	}
});
