import { test } from "node:test";
import assert from "node:assert/strict";
import { calls } from "../../protocol/index.ts";
import { probeFeature } from "./probe.test.ts";
import { callers, testServer } from "./testing.ts";
import { defineFeature, handle } from "./types.ts";

// The router's rules, as calls: who may call, the arguments' shape, the five
// refusal codes, notes beside the value, and events heard by who may see them.

test("the kernel starts with no feature, and answers its own deck calls", async () => {
	const server = await testServer();
	const deck = await server.value<{ protocol: string }>("deck.get");
	assert.match(deck.protocol, /^\d+\.\d+\.\d+$/);
	assert.equal((await server.call("port.list")).ok, false);
	await server.close();
});

test("a test feature's call can be made, with its notes and its event", async () => {
	const server = await testServer({ features: [probeFeature()] });
	const answer = await server.call("port.open", { port: 4621, label: "x" });
	assert.deepEqual(answer, { ok: true, value: { port: 4621, label: "x", at: 1, path: "/port/4621/", stripped: "/rport/4621/" }, notes: ["opened 4621"] });
	assert.deepEqual(server.heard.map((one) => one.name), ["deck.changed"]);
	assert.equal((await server.value<unknown[]>("port.list", {}, "agent")).length, 1);
	await server.close();
});

test("each refusal has its code", async () => {
	const server = await testServer({ features: [probeFeature()] });
	const code = async (name: string, args: Record<string, unknown>, as?: Parameters<typeof server.call>[2]) => {
		const answer = await server.call(name, args, as);
		return answer.ok ? "ok" : answer.error.code;
	};
	assert.equal(await code("port.open", { port: "x" }), "invalid");
	assert.equal(await code("port.open", { port: 1, extra: true }), "invalid");
	assert.equal(await code("nothing.here", {}), "not_found");
	assert.equal(await code("port.open", { port: 1 }, "card"), "refused");
	assert.equal(await code("port.open", { port: 1 }), "ok");
	assert.equal(await code("port.open", { port: 1 }), "conflict");
	assert.equal(await code("canvas.list", {}), "unavailable");
	assert.equal(await code("chat.list", { agent: "a" }), "unavailable");
	await server.close();
});

test("two features handling one call stop the server", async () => {
	await assert.rejects(testServer({ features: [probeFeature(), probeFeature()] }), /handled by both/);
});

test("an answer that does not fit its shape is caught in tests", async () => {
	const bad = defineFeature({ name: "bad", calls: [handle(calls.port.list, () => [{ port: "no" }] as never)] });
	const server = await testServer({ features: [bad] });
	const answer = await server.call("port.list");
	assert.equal(answer.ok, false);
	await server.close();
});

test("ctx.canvas uses the caller's here, and refuses without one", async () => {
	const seen: string[] = [];
	const doc = { read: () => [], apply: () => ({ items: [], rev: 0 }), since: () => [] };
	const canvasy = defineFeature({
		name: "canvasy",
		canvases: () => ({ doc: (name) => (seen.push(name), doc), name: (raw) => raw.toLowerCase() }),
		calls: [handle(calls.port.list, (ctx) => (ctx.canvas(), []))],
	});
	const server = await testServer({ features: [canvasy] });
	assert.equal((await server.call("port.list", {}, callers.agent("a", "Plans"))).ok, true);
	assert.deepEqual(seen, ["plans"]);
	const none = await server.call("port.list", {}, callers.agent("b"));
	assert.equal(none.ok ? "" : none.error.code, "invalid");
	await server.close();
});

test("a card hears only its own canvas's events; person-only events reach the person only", async () => {
	const server = await testServer();
	const card: string[] = [];
	const agent: string[] = [];
	server.events.subscribe({ caller: callers.card("canvases/a/cards/x/index.html", "a") }, (one) => void card.push(one.name));
	server.events.subscribe({ caller: callers.agent("ann") }, (one) => void agent.push(one.name));
	const { events } = await import("../../protocol/index.ts");
	server.events.emit(events.itemChanged, { canvas: "a", ids: ["n"], by: "ann", rev: 1 });
	server.events.emit(events.itemChanged, { canvas: "b", ids: ["n"], by: "ann", rev: 2 });
	server.events.emit(events.chatChanged, { ids: [], by: "ann", rev: 3 });
	assert.deepEqual(card, ["item.changed"]);
	assert.deepEqual(agent, ["item.changed", "item.changed"]);
	await server.close();
});

test("an event sent to some clients reaches only them", async () => {
	const server = await testServer();
	const heard: string[] = [];
	server.events.subscribe({ caller: callers.person, client: "c1" }, () => void heard.push("c1"));
	server.events.subscribe({ caller: callers.person, client: "c2" }, () => void heard.push("c2"));
	const { events } = await import("../../protocol/index.ts");
	server.events.emit(events.viewRequested, { ids: [], by: "ann", rev: 1, call: "view.focus", args: {} }, { clients: ["c2"] });
	assert.deepEqual(heard, ["c2"]);
	await server.close();
});

test("a token issued to a caller resolves to it until revoked, and describe gives its current name", async () => {
	const server = await testServer();
	const token = server.token(callers.agent("ann", "plans"));
	assert.equal(server.callers.resolve(token)?.id, "ann");
	server.callers.describe("agent", (id) => (id === "ann" ? { kind: "agent", id, name: "Ann Renamed" } : undefined));
	assert.equal(server.callers.resolve(token)?.name, "Ann Renamed");
	server.callers.revoke("ann");
	assert.equal(server.callers.resolve(token), undefined);
	await server.close();
});

test("a handler makes another feature's call as the same caller, and a refusal throws", async () => {
	const relay = defineFeature({
		name: "relay",
		calls: [handle(calls.port.list, async (ctx) => [await ctx.call("port.open", { port: ctx.caller.kind === "agent" ? 7 : -1 })] as never)],
	});
	const opener = defineFeature({ name: "opener", calls: probeFeature().calls.filter((one) => one.call.name === "port.open") });
	const server = await testServer({ features: [relay, opener] });
	const answer = await server.call("port.list", {}, "agent");
	assert.equal(answer.ok && (answer.value as { port: number }[])[0]?.port, 7);
	assert.deepEqual(answer.notes, ["opened 7"]);
	const card = await server.call("port.list", {}, callers.app("x"));
	assert.equal(card.ok ? "" : card.error.code, "refused");
	await server.close();
});

test("an old name is translated into a declared call, checked as usual, and its answer turned back", async () => {
	const old = defineFeature({
		name: "old",
		calls: [],
		start: (kernel) =>
			kernel.translate((name, args) => {
				if (name === "ports") return { name: "port.list", args: {}, back: (value) => ({ ports: value }) };
				if (name === "web.open") return { name: "port.open", args: { port: (args as { args: unknown[] }).args[0] as number } };
				if (name === "port.open" && (args as { args?: unknown[] }).args) return { name: "port.open", args: { port: (args as { args: number[] }).args[0]!, label: "old" } };
				if (name === "gone") return { refusal: { code: "not_found", message: "gone is retired.", hint: "port.list" } };
				return name === "loop" ? { name: "loop2", args: {} } : undefined;
			}),
	});
	const server = await testServer({ features: [old, probeFeature()] });
	assert.deepEqual(await server.value("ports"), { ports: [] });
	assert.equal((await server.value<{ port: number }>("web.open", { args: [5] })).port, 5);
	const bad = await server.call("web.open", { args: ["x"] });
	assert.equal(bad.ok ? "" : bad.error.code, "invalid");
	assert.equal((await server.value<{ label: string }>("port.open", { args: [6] })).label, "old");
	assert.equal((await server.value<{ label?: string }>("port.open", { port: 8 })).label, undefined);
	const gone = await server.call("gone");
	assert.equal(gone.ok ? "" : gone.error.hint, "port.list");
	for (const name of ["loop", "nothing"]) {
		const answer = await server.call(name);
		assert.equal(answer.ok ? "" : answer.error.code, "not_found");
	}
	await server.close();
});
