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

test("a route that declares scoped holds a pass to what it says, a climb included", async () => {
	const routes: Route[] = [
		{ method: "GET", prefix: "/open/", answer: async () => ({ type: "text/plain", body: "whole callers only" }) },
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
	assert.equal(await get("/open/x", pass), 200, "until every route declares scoped, one without it lets a pass through");
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
