import { test } from "node:test";
import assert from "node:assert/strict";
import { calls, events, PROTOCOL_VERSION } from "../../protocol/index.ts";
import { probeFeature } from "./probe.test.ts";
import { callers, testServer } from "./testing.ts";
import { deckPathFrom, defineFeature, handle, inside, type Route } from "./types.ts";

// A caller with a scope (a canvas pass) can never act outside it, whatever
// the feature and whichever door: only its calls, only its canvas, its here
// held to that canvas, only what a route declares for it, only its events.

test("a path from an address is decoded once and fenced before any prefix is tested", () => {
	assert.equal(deckPathFrom("canvases/a/files/x%20y.txt"), "canvases/a/files/x y.txt");
	assert.equal(deckPathFrom("assets/./icons//a.svg"), "assets/icons/a.svg");
	for (const bad of ["assets/..%2fcanvases%2fb%2ffiles%2fsecret.txt", "assets/%2e%2e/canvases/b", "assets/%252e%252e/x", ".decks/tokens.json", "a/%2edecks/x", "%E0%A4%A"]) {
		assert.throws(() => deckPathFrom(bad), { code: "invalid" }, bad);
	}
	assert.ok(inside("canvases/a/cards/x", "canvases/a"));
	assert.ok(!inside("canvases/ab/cards/x", "canvases/a"));
});

test("a pass reaches a route only where it declares scoped, a climb refused; a public GET is open", async () => {
	const routes: Route[] = [
		{ method: "GET", prefix: "/open/", answer: async () => ({ type: "text/plain", body: "whole callers only" }) },
		{ method: "GET", prefix: "/public/", public: true, answer: async () => ({ type: "text/plain", body: "anyone" }) },
		{
			method: "GET",
			prefix: "/files/",
			scoped: (scope, asked) => inside(deckPathFrom(asked.path.slice("/files/".length)), `canvases/${scope.canvas}`),
			answer: async (_ctx, path) => ({ type: "text/plain", body: path }),
		},
	];
	const server = await testServer({ features: [defineFeature({ name: "pages", calls: [], routes })] });
	const doors = await server.listen(0);
	const pass = server.callers.issue({ ...callers.person, id: "person~frame-9" }, "canvas pass", { canvas: "a", until: Date.now() + 60_000 });
	const get = async (path: string, token: string) => (await fetch(`${doors.url}${path}`, { headers: { authorization: `Bearer ${token}` } })).status;
	assert.equal(await get("/open/x", doors.token), 200);
	assert.equal(await get("/open/x", pass), 403, "a route that declares nothing for a pass refuses it");
	assert.equal(await get("/public/x", pass), 200, "a public GET is open to anyone, a pass included");
	assert.equal(await get("/files/canvases/a/files/x.txt", pass), 200);
	assert.equal(await get("/files/canvases/b/files/x.txt", pass), 403);
	assert.equal(await get("/files/canvases/a/files/..%2f..%2fb%2ffiles%2fx.txt", pass), 403);
	await doors.close();
	await server.close();
});

test("a scoped token reaches only its calls and its canvas, through the router and the HTTP door", async () => {
	const seen: (string | undefined)[] = [];
	const canvasy = defineFeature({
		name: "canvasy",
		canvases: () => ({ doc: () => ({ read: () => [], apply: () => ({ items: [], rev: 0 }), since: () => [] }), name: (raw) => raw }),
		calls: [handle(calls.canvas.here, (ctx) => (seen.push(ctx.caller.canvas), { name: ctx.canvasName(), title: "t", open: [], cards: 0 }))],
	});
	const server = await testServer({ features: [probeFeature(), canvasy] });
	server.callers.describe("person", (_id, issued) => ({ ...issued, canvas: "on-screen" }));
	const pass = server.callers.issue({ ...callers.person, id: "person~frame-1" }, "canvas pass", { canvas: "a", calls: ["port.list", "canvas.here"], until: Date.now() + 60_000 });
	const who = server.callers.resolve(pass)!;
	assert.equal(who.canvas, "a", "the pass's here is its canvas, whatever describe says");
	const code = async (name: string, args: Record<string, unknown>) => {
		const answer = await server.call(name, args, who);
		return answer.ok ? "ok" : answer.error.code;
	};
	assert.equal(await code("port.list", {}), "ok");
	assert.equal(await code("port.open", { port: 1 }), "refused");
	assert.equal(await code("canvas.here", {}), "ok");
	assert.equal(await code("canvas.here", { canvas: "b" }), "refused");
	assert.deepEqual(seen, ["a"]);
	const doors = await server.listen(0);
	const post = await fetch(`${doors.url}/api/v1/port.open`, { method: "POST", headers: { authorization: `Bearer ${pass}`, "content-type": "application/json" }, body: JSON.stringify({ port: 2 }) });
	assert.equal(((await post.json()) as { error: { code: string } }).error.code, "refused");
	await doors.close();
	await server.close();
});

test("a scoped caller hears only its canvas's events, on the stream and the socket", async () => {
	const server = await testServer();
	const pass = server.callers.issue({ ...callers.person, id: "person~frame-2" }, "canvas pass", { canvas: "a", until: Date.now() + 60_000 });
	const doors = await server.listen(0);
	const ws = new WebSocket(`${doors.url.replace("http", "ws")}/api/v1/socket`);
	const heard: string[] = [];
	await new Promise<void>((ready) => {
		ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token: pass, protocol: PROTOCOL_VERSION }));
		ws.onmessage = (m) => {
			const message = JSON.parse(String(m.data));
			if (message.type === "hello") (ws.send(JSON.stringify({ type: "watch" })), setTimeout(ready, 50));
			if (message.type === "event") heard.push(`${message.name}:${message.payload.canvas ?? ""}`);
		};
	});
	server.events.emit(events.itemChanged, { canvas: "a", ids: [], by: "x", rev: 1 });
	server.events.emit(events.itemChanged, { canvas: "b", ids: [], by: "x", rev: 2 });
	server.events.emit(events.chatChanged, { ids: [], by: "x", rev: 3 });
	await new Promise((r) => setTimeout(r, 80));
	assert.deepEqual(heard, ["item.changed:a"]);
	ws.close();
	await doors.close();
	await server.close();
});

test("a scoped caller hears canvasless events of paths in its canvas, and those a feature says belong", async () => {
	const placed = defineFeature({ name: "apps", calls: [], start: (kernel) => kernel.belongs((scope, event, payload) => event === "app.changed" && scope.canvas === "a" && (payload.ids as string[]).includes("notes")) });
	const server = await testServer({ features: [placed] });
	const pass = server.callers.resolve(server.callers.issue({ ...callers.person, id: "person~frame-8" }, "canvas pass", { canvas: "a", until: Date.now() + 60_000 }))!;
	const heard: string[] = [];
	server.events.subscribe({ caller: pass }, (one) => void heard.push(`${one.name}:${(one.payload.ids as string[]).join()}`));
	server.events.emit(events.cardChanged, { ids: ["canvases/a/cards/x/index.html"], by: "x", rev: 1 });
	server.events.emit(events.cardChanged, { ids: ["canvases/b/cards/y/index.html"], by: "x", rev: 2 });
	server.events.emit(events.fileChanged, { ids: ["docs/elsewhere.md"], by: "x", rev: 3 });
	server.events.emit(events.appChanged, { ids: ["notes"], by: "notes", rev: 4 });
	server.events.emit(events.appChanged, { ids: ["other"], by: "other", rev: 5 });
	server.events.emit(events.agentChanged, { ids: ["a_1"], by: "x", rev: 6 });
	assert.deepEqual(heard, ["card.changed:canvases/a/cards/x/index.html", "app.changed:notes"]);
	await server.close();
});

test("a pass's to, card and cards must lie inside its canvas's folder, for any call", async () => {
	const server = await testServer({ features: [probeFeature()] });
	const pass = server.callers.resolve(server.callers.issue({ ...callers.person, id: "person~frame-7" }, "canvas pass", { canvas: "a", until: Date.now() + 60_000 }))!;
	const code = async (args: Record<string, unknown>) => {
		const answer = await server.call("port.list", args, pass);
		return answer.ok ? "ok" : answer.error.code;
	};
	for (const args of [{ to: "assets/importmap.json" }, { to: "canvases/b/canvas.pen" }, { to: "canvases/a/../b/x" }, { card: "canvases/b/cards/real" }, { cards: ["canvases/a/cards/x", "canvases/b/cards/y"] }]) {
		assert.equal(await code(args), "refused", JSON.stringify(args));
	}
	assert.equal(await code({ to: "canvases/a/files/shot.png" }), "invalid", "inside its folder it passes the scope (port.list then refuses the extra argument)");
	await server.close();
});

test("a pass's card may be one its canvas already places, as the canvas feature says; its to may not", async () => {
	const canvasy = defineFeature({ name: "canvasy", calls: [], start: (kernel) => kernel.places((canvas, path) => canvas === "a" && path === "pages/old.html") });
	const server = await testServer({ features: [canvasy, probeFeature()] });
	const pass = server.callers.resolve(server.callers.issue({ ...callers.person, id: "person~frame-6" }, "canvas pass", { canvas: "a", until: Date.now() + 60_000 }))!;
	const code = async (args: Record<string, unknown>) => {
		const answer = await server.call("port.list", args, pass);
		return answer.ok ? "ok" : answer.error.code;
	};
	assert.equal(server.kernel.placed("a", "pages/old.html"), true);
	assert.equal(await code({ card: "pages/old.html" }), "invalid", "a placed old page passes the scope");
	assert.equal(await code({ cards: ["canvases/a/cards/x", "pages/old.html"] }), "invalid");
	assert.equal(await code({ card: "pages/other.html" }), "refused");
	assert.equal(await code({ to: "pages/old.html" }), "refused", "a write still stays in its folder");
	await server.close();
});

test("a pass's call that only reads may name the deck's assets/ and lib/; one that writes may not", async () => {
	const server = await testServer();
	const pass = server.callers.resolve(server.callers.issue({ ...callers.person, id: "person~frame-4" }, "canvas pass", { canvas: "a", until: Date.now() + 60_000 }))!;
	const code = async (name: string, args: Record<string, unknown>) => {
		const answer = await server.call(name, args, pass);
		return answer.ok ? "ok" : answer.error.code;
	};
	assert.notEqual(await code("file.url", { path: "assets/a.png" }), "refused", "file.url (read) of assets/ passes the scope");
	assert.notEqual(await code("file.url", { path: "lib/card.css" }), "refused");
	assert.equal(await code("file.url", { path: "docs/loose.md" }), "refused", "docs/ only when placed");
	assert.equal(await code("file.url", { path: "canvases/b/files/x.png" }), "refused");
	assert.equal(await code("file.write", { path: "assets/a.png", text: "x" }), "refused", "a write stays in its folder or what is placed");
	assert.equal(await code("file.write", { path: "lib/card.css", text: "x" }), "refused");
	await server.close();
});

test("each refusal a pass meets, by a call or a route, is one JSON line in DECKS_REFUSALS", async () => {
	const { tempFolder } = await import("./disk.ts");
	const { readFile } = await import("node:fs/promises");
	const folder = await tempFolder("keel-refusals");
	const file = `${folder.folder}/refusals.jsonl`;
	process.env.DECKS_REFUSALS = file;
	try {
		const routes: Route[] = [{ method: "GET", prefix: "/open/", answer: async () => ({ type: "text/plain", body: "x" }) }];
		const server = await testServer({ features: [probeFeature(), defineFeature({ name: "pages", calls: [], routes })] });
		const token = server.callers.issue({ ...callers.person, id: "person~frame-5" }, "canvas pass", { canvas: "a", calls: ["port.list"], until: Date.now() + 60_000 });
		await server.call("port.open", { port: 1 }, server.callers.resolve(token)!);
		await server.call("port.list", {}, server.callers.resolve(token)!);
		await server.call("port.open", { port: 2 });
		const doors = await server.listen(0);
		await fetch(`${doors.url}/open/x`, { headers: { authorization: `Bearer ${token}` } });
		await doors.close();
		await server.close();
		const lines = (await readFile(file, "utf8")).trim().split("\n").map((one) => JSON.parse(one) as { caller: string; call?: string; route?: string });
		assert.deepEqual(lines.map((one) => one.call ?? one.route), ["port.open", "GET /open/x"]);
		assert.ok(lines.every((one) => one.caller === "person~frame-5"));
	} finally {
		delete process.env.DECKS_REFUSALS;
		await folder.remove();
	}
});

test("a scoped token ends at its until, and is dropped from the kept tokens", async () => {
	const at = { now: 1000 };
	const server = await testServer({ clock: () => at.now });
	const pass = server.callers.issue({ ...callers.person, id: "person~frame-3" }, "canvas pass", { canvas: "a", until: 2000 });
	assert.equal(server.callers.resolve(pass)?.canvas, "a");
	at.now = 2000;
	assert.equal(server.callers.resolve(pass), undefined);
	assert.equal(server.callers.scopeOf({ ...callers.person, id: "person~frame-3" }), undefined);
	await server.close();
});

test("a scope with no canvas holds calls and an end only, and leaves the caller's here as described", async () => {
	const server = await testServer({ features: [probeFeature()] });
	const token = server.callers.issue(callers.app("notes"), "app server", { calls: ["port.list"], until: Date.now() + 60_000 });
	const app = server.callers.resolve(token)!;
	assert.equal(app.canvas, undefined);
	assert.equal((await server.call("port.list", {}, app)).ok, true);
	const other = await server.call("port.open", { port: 3 }, app);
	assert.equal(other.ok ? "" : other.error.code, "refused");
	await server.close();
});
