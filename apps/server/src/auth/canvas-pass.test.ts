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
 * The canvas pass (`passes.ts`): made for the person's own page, one canvas and their role on it, and
 * good for that canvas's calls, its drawing, its stream and its files from a sandboxed page, and
 * nothing else; checked on every use against the token that asked and the role now.
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
	/** A pass for a canvas, made with a fresh person token, as a Decks tab asks for one. */
	const passFor = (canvas: string, role: "edit" | "view" = "edit") => app.passes.canvas(canvas, role, app.tokens.issue({ kind: "person" }).id).pass;
	return {
		passFor,
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

test("a canvas pass is the person's to ask for, for one canvas, with their role on it, for an hour", async () => {
	const { app, one, post, bearer, cleanup } = await open();
	try {
		const person = app.tokens.issue({ kind: "person" });
		const agent = bearer(app.bridge.issue(app.agents.focused().id));
		assert.equal((await post("/api/passes", agent, { canvas: one })).status, 403, "not an agent's");
		assert.equal((await post("/api/passes", bearer(person.token), { canvas: "nowhere" })).status, 404);
		const before = Date.now();
		const made = await post("/api/passes", bearer(person.token), { canvas: one });
		assert.equal(made.status, 200, made.text);
		assert.match(String(made.body.pass), /^dk_cp_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
		assert.equal(made.body.role, "edit");
		const expires = Number(made.body.expires);
		assert.ok(expires >= before + 3_600_000 - 1000 && expires <= Date.now() + 3_600_000, "an hour");
		const seen = app.passes.openCanvas(String(made.body.pass));
		assert.deepEqual(seen && { canvas: seen.canvas, role: seen.role, by: seen.by }, { canvas: one, role: "edit", by: person.id });
		assert.equal(app.tokens.verify(String(made.body.pass)).ok, false, "a pass is not a token");
	} finally {
		cleanup();
	}
});

test("a pass dies with the token that asked for it, and runs out after its hour", async () => {
	const { app, origin, one, post, bearer, sandboxed, cleanup } = await open();
	try {
		const person = app.tokens.issue({ kind: "person" });
		const pass = String((await post("/api/passes", bearer(person.token), { canvas: one })).body.pass);
		const frame = { ...bearer(pass), ...sandboxed };
		assert.equal((await post("/api/v1/canvas.read", frame)).status, 200);
		assert.equal((await fetch(`${origin}/api/t/${pass}/card/canvases/${one}/not-here.png`)).status, 404, "its files, by address");
		app.tokens.revoke(person.id);
		assert.equal((await post("/api/v1/canvas.read", frame)).status, 401, "signed out: its calls end at once");
		assert.equal((await fetch(`${origin}/api/t/${pass}/card/canvases/${one}/not-here.png`)).status, 401, "and its files");
		const later = app.tokens.issue({ kind: "person" });
		const made = app.passes.canvas(one, "edit", later.id, Date.now() - 3_600_000 - 1);
		assert.equal(app.passes.openCanvas(made.pass), undefined, "run out");
		assert.equal((await post("/api/v1/canvas.read", { ...bearer(made.pass), ...sandboxed })).status, 401);
		// A pass made by a different secret, or changed, is nobody's.
		const forged = made.pass.replace(/\.[^.]+$/, ".AAAA");
		assert.equal(app.passes.openCanvas(forged), undefined);
	} finally {
		cleanup();
	}
});

test("a stream opened on a pass ends when the pass stops working, at the next message", async () => {
	const { app, origin, one, bearer, sandboxed, cleanup } = await open();
	try {
		const person = app.tokens.issue({ kind: "person" });
		const pass = app.passes.canvas(one, "edit", person.id).pass;
		const response = await fetch(`${origin}/api/v1/events`, { headers: { ...bearer(pass), ...sandboxed } });
		assert.equal(response.status, 200);
		const reader = response.body!.getReader();
		await reader.read();
		app.tokens.revoke(person.id);
		app.stage.pens!.edit(one, [{ op: "insert", node: { type: "note", id: "after", content: "x" } }] as never);
		const ended = await Promise.race([
			(async () => {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) return true;
					if (new TextDecoder().decode(value).includes('"after"')) return false;
				}
			})(),
			new Promise<boolean>((done) => setTimeout(() => done(false), 3000)),
		]);
		assert.equal(ended, true, "closed, and nothing said after the sign-out");
	} finally {
		cleanup();
	}
});

test("every use reads the role on the canvas now: shared to view, a pass for editing reads only; unshared, it ends", async () => {
	const { app, one, post, bearer, passFor, sandboxed, cleanup } = await open();
	try {
		let role: "edit" | "view" | undefined = "edit";
		const checks = (app.passes as unknown as { checks: { role(canvas: string): "edit" | "view" | undefined } }).checks;
		const real = checks.role;
		checks.role = (canvas) => (canvas === one ? role : real(canvas));
		const frame = { ...bearer(passFor(one, "edit")), ...sandboxed };
		const insert = () => post("/api/v1/canvas.insert", frame, { args: [{ type: "note", content: "x" }, { at: { x1: 0, y1: 0 } }] });
		assert.equal((await insert()).status, 200);
		role = "view";
		const refused = await insert();
		assert.equal(refused.status, 403, "downgraded to view: refused on the next use");
		assert.match(refused.text, /view/);
		assert.equal((await post("/api/v1/canvas.read", frame)).status, 200, "still reads");
		role = undefined;
		assert.equal((await post("/api/v1/canvas.read", frame)).status, 401, "no longer shared: nothing");
		role = "edit";
		assert.equal((await insert()).status, 200, "shared to edit again");
	} finally {
		cleanup();
	}
});

test("files read on a pass are sent with no referrer, readable by the sandboxed frame, and only its canvas's", async () => {
	const { app, one, two, origin, post, bearer, passFor, cleanup } = await open();
	try {
		const person = bearer(app.tokens.issue({ kind: "person" }).token);
		const mine = String(((await post("/api/v1/card.create", person, { args: [{ title: "Mine", canvas: one }] })).body.value as { path: string }).path);
		const theirs = String(((await post("/api/v1/card.create", person, { args: [{ title: "Theirs", canvas: two }] })).body.value as { path: string }).path);
		const pass = passFor(one);
		const at = (path: string, prefix = "card") => fetch(`${origin}/api/t/${pass}/${prefix}/${path.split("/").map(encodeURIComponent).join("/")}?raw=1`);
		const read = await at(mine);
		assert.equal(read.status, 200);
		assert.equal((await at(mine, "board")).status, 401, "the old prefix reaches nothing");
		assert.equal(read.headers.get("referrer-policy"), "no-referrer");
		assert.equal(read.headers.get("access-control-allow-origin"), "*");
		assert.equal((await at(theirs)).status, 401, "another canvas's card");
		assert.equal((await fetch(`${origin}/api/t/${pass}/f/etc/passwd`)).status, 401, "nothing but its canvas's files and pictures");
		assert.equal((await fetch(`${origin}/api/t/${pass}/card/canvases/${one}/x.png`, { method: "POST" })).status, 401, "reads only");
	} finally {
		cleanup();
	}
});

test("from a sandboxed page, the pass edits, undoes and reads its own canvas, and no other", async () => {
	const { app, origin, one, two, post, bearer, sandboxed, passFor, cleanup } = await open();
	try {
		const frame = { ...bearer(passFor(one, "edit")), ...sandboxed };
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
		for (const path of ["/api/tokens", "/api/passes", "/api/tickets", "/api/deck", "/api/agents", "/api/settings"]) {
			const refused = await post(path, frame, { canvas: one });
			assert.equal(refused.status, 403, `${path}: ${refused.text}`);
		}
	} finally {
		cleanup();
	}
});

test("a pass for a canvas shared to view reads only", async () => {
	const { app, one, post, bearer, sandboxed, passFor, cleanup } = await open();
	try {
		const frame = { ...bearer(passFor(one, "view")), ...sandboxed };
		assert.equal((await post("/api/v1/canvas.read", frame)).status, 200);
		const refused = await post("/api/v1/canvas.insert", frame, { args: [{ type: "note", content: "x" }, { at: { x1: 0, y1: 0 } }] });
		assert.equal(refused.status, 403);
		assert.match(refused.text, /view/);
	} finally {
		cleanup();
	}
});

test("its stream carries its own canvas's drawing and nothing else", async () => {
	const { app, origin, one, two, bearer, sandboxed, passFor, cleanup } = await open();
	try {
		const frame = { ...bearer(passFor(one, "edit")), ...sandboxed };
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
	const { app, origin, one, post, bearer, sandboxed, passFor, cleanup } = await open();
	const controller = new AbortController();
	try {
		const agent = app.agents.focused();
		// A view of this canvas by name: the frame following it is the one to answer.
		const person = bearer(app.tokens.issue({ kind: "person" }).token);
		assert.equal((await post("/api/v1/canvas.insert", person, { args: [{ type: "note", id: "n", content: "x" }, { canvas: one, at: { x1: 0, y1: 0 } }] })).status, 200);
		const frame = { ...bearer(passFor(one, "edit")), ...sandboxed };
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

test("the frame says a card on its canvas was read and how it measured, for its own canvas only", async () => {
	const { app, one, two, origin, post, bearer, sandboxed, passFor, cleanup } = await open();
	try {
		const person = bearer(app.tokens.issue({ kind: "person" }).token);
		const mine = String(((await post("/api/v1/card.create", person, { args: [{ title: "Mine", canvas: one }] })).body.value as { path: string }).path);
		const theirs = String(((await post("/api/v1/card.create", person, { args: [{ title: "Theirs", canvas: two }] })).body.value as { path: string }).path);
		const frame = { ...bearer(passFor(one, "edit")), ...sandboxed };
		assert.equal((await post("/api/v1/card-seen", frame, { path: mine })).status, 200);
		assert.equal((await post("/api/v1/card-extent", frame, { path: mine, rev: 1, w: 400, h: 300, words: 12 })).status, 200);
		for (const route of ["card-seen", "card-extent"]) assert.equal((await post(`/api/v1/${route}`, frame, { path: theirs, rev: 1, w: 1, h: 1 })).status, 403, route);
		// A card written out for the harness's Chrome to draw (an agent's screenshot of it): past the gate, and refused by the route for another canvas's card.
		const snapshot = await fetch(`${origin}/api/snapshot?path=${encodeURIComponent(theirs)}`, { method: "POST", headers: { ...frame, "content-type": "text/html" }, body: "<p>x</p>" });
		assert.equal(snapshot.status, 403);
		assert.match(await snapshot.text(), /not on this canvas/);
	} finally {
		cleanup();
	}
});

test("a document or an app item is placed by the person, not the frame, and the frame opens only the files document items name", async () => {
	const { app, one, post, bearer, sandboxed, passFor, cleanup } = await open();
	try {
		const person = bearer(app.tokens.issue({ kind: "person" }).token);
		const frame = { ...bearer(passFor(one, "edit")), ...sandboxed };
		const doc = { type: "browser", id: "paper", width: 800, height: 600, metadata: { type: "decks.document", path: "notes.md" } };
		assert.equal((await post("/api/v1/canvas.insert", frame, { args: [doc, { at: { x1: 0, y1: 0 } }] })).status, 403, "the frame may not place one");
		assert.equal((await post("/api/v1/canvas.batch", frame, { args: [[{ op: "insert", item: { ...doc, id: "p2", metadata: { type: "decks.app", name: "terminal" } }, at: { x1: 0, y1: 0 } }]] })).status, 403, "nor an app, in a batch");
		assert.equal((await post("/api/v1/canvas.insert", frame, { args: [{ type: "document", path: "deck.json" }, { at: { x1: 0, y1: 0 } }] })).status, 403, "nor by its short form");
		assert.equal((await post("/api/v1/canvas.insert", frame, { args: [{ type: "app", app: "terminal" }, { at: { x1: 0, y1: 0 } }] })).status, 403, "an app's short form neither");
		assert.equal((await post("/api/v1/canvas.insert", person, { args: [doc, { canvas: one, at: { x1: 0, y1: 0 } }] })).status, 200, "the person may");
		const short = await post("/api/v1/canvas.insert", person, { args: [{ type: "document", path: "plan.md" }, { canvas: one, at: { x1: 2000, y1: 0 } }] });
		assert.equal(short.status, 200, "and by its short form, which becomes the item");
		const made = (short.body as unknown as { value: { id: string; type: string; metadata: { type: string; path: string }; width: number; height: number } }).value;
		assert.deepEqual([made.type, made.metadata, made.width, made.height], ["browser", { type: "decks.document", path: "plan.md" }, 1000, 1100]);
		assert.equal((await post("/api/v1/canvas.update", frame, { args: ["paper", { set: { metadata: { type: "decks.document", path: "secret.md" } } }] })).status, 403, "the frame may not point it elsewhere");
		assert.equal((await post("/api/v1/canvas.update", frame, { args: ["paper", { at: { x1: 40, y1: 40 } }] })).status, 200, "but may move it");
		assert.deepEqual([...app.documentsOn(one)].includes("notes.md"), true);
		assert.equal((await post("/api/v1/doc", frame, { frame: "f1", message: { type: "doc.open", path: "deck.json" } })).status, 403, "a file no document item names");
		assert.equal((await post("/api/v1/doc", frame, { frame: "f1", message: { type: "doc.open", path: "notes.md" } })).status, 200, "the one it names");
		assert.equal((await post("/api/v1/doc", person, { frame: "f1", message: { type: "doc.open", path: "notes.md" } })).status, 403, "a tab sends documents on its socket");
	} finally {
		cleanup();
	}
});

test("on the canvas's pass, a file that is not there answers 404, and a hidden one is still refused", async () => {
	const { one, origin, passFor, cleanup } = await open();
	try {
		const ticket = passFor(one);
		const at = (path: string) => fetch(`${origin}/api/t/${ticket}/card/canvases/${one}/${path}`);
		assert.equal((await at("assets/not-here.png")).status, 404, "a missing picture");
		assert.equal((await at("cards/not-here/index.html?raw=1")).status, 404, "a missing card");
		assert.equal((await at("cards/not-here@1/index.m0.js")).status, 404, "a missing card's module");
		assert.notEqual((await at(".decks/x")).status, 200, "a hidden file");
		assert.notEqual((await at(".decks/x")).status, 404);
	} finally {
		cleanup();
	}
});
