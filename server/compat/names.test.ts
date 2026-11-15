import { test } from "node:test";
import assert from "node:assert/strict";
import { features } from "../main.ts";
import { testServer } from "../kernel/testing.ts";
import { answerBack, itemOp, keyed, turn } from "./args.ts";
import { DROPPED, GOES, OLD_CALLS, OLD_EVENTS } from "./table.ts";
import { told } from "./events.ts";

// Every old name of calls.md answers: by its new call, or for a dropped one by why.

test("every old call reaches a new call the server knows", async () => {
	const server = await testServer({ features: features(), relayWaitMs: 5 });
	const missed: string[] = [];
	for (const [old] of OLD_CALLS) {
		const turned = turn(old, []);
		assert.ok(!("refusal" in turned), `${old} is refused before it is called`);
		const envelope = await server.call(turned.name, turned.args);
		if (!envelope.ok && /There is no call named/.test(envelope.error.message)) missed.push(`${old} -> ${turned.name}`);
	}
	assert.deepEqual(missed, []);
	assert.equal(OLD_CALLS.length, 117);
	await server.close();
});

test("a dropped old call says why, and an unknown one is not found", () => {
	for (const [old, , why] of DROPPED) {
		const turned = turn(old, []);
		assert.ok("refusal" in turned && turned.refusal.message.includes(why), old);
	}
	const unknown = turn("canvas.nothing", []);
	assert.ok("refusal" in unknown && unknown.refusal.code === "not_found");
});

test("after GOES an old name answers refused, naming the new call", () => {
	const late = turn("canvas.read", [], Date.parse(GOES) + 86_400_000);
	assert.ok("refusal" in late && late.refusal.code === "refused" && late.refusal.hint === "item.list");
});

test("old arguments in order become the new call's, options spread", () => {
	assert.deepEqual(keyed(["item", "..."], [{ type: "note" }, { canvas: "c", at: { x1: 1, y1: 2 } }]), { item: { type: "note" }, canvas: "c", at: { x1: 1, y1: 2 } });
	const insert = turn("canvas.insert", [{ type: "note" }, { at: { x1: 1, y1: 2 } }]);
	assert.ok(!("refusal" in insert) && (insert.args.at as { x: number }).x === 1);
	const upd = turn("canvas.update", ["n", { set: { fill: "#fff" }, at: { x1: 1, y1: 2 } }]);
	assert.ok(!("refusal" in upd) && (upd.args.set as { fill: string }).fill === "#fff" && (upd.args.at as { x: number }).x === 1 && upd.args.change === undefined);
	const one = turn("canvas.read", [{ canvas: "c", of: "n", depth: 0 }]);
	assert.ok(!("refusal" in one) && one.name === "item.get" && one.args.id === "n" && one.args.of === undefined);
	assert.deepEqual(answerBack("canvas.read", { id: "n" }), { items: [{ id: "n" }] });
	const move = turn("view.move", [{ x: 1, y: 2, zoom: 0.5, animate: true }]);
	assert.ok(!("refusal" in move) && move.args.zoom === 0.5 && move.args.camera === undefined);
	const set = turn("agent.update", [{ canvas: "plan" }]);
	assert.ok(!("refusal" in set) && (set.args.change as { canvas: string }).canvas === "plan" && set.args.patch === undefined);
	const step = turn("canvas.step", ["redo"]);
	assert.ok(!("refusal" in step) && step.name === "canvas.undo" && step.args.redo === true);
	assert.deepEqual(answerBack("canvas.space", { x: 3, y: 4 }), { x1: 3, y1: 4 });
	assert.equal((answerBack("canvas.insert", { type: "app", app: "n", title: "N notes" }) as { name: string }).name, "N notes");
	assert.deepEqual(answerBack("canvas.screenshot", { file: "f.png", size: { w: 9, h: 4 } }), { file: "f.png", size: { w: 9, h: 4 }, width: 9, height: 4 });
	assert.deepEqual(answerBack("view.reload", 2), { reloaded: 2 });
	assert.deepEqual(answerBack("view.camera", { canvas: "c", camera: { x: 1, y: 2, zoom: 1 } }), { x: 1, y: 2, zoom: 1 });
	assert.deepEqual(answerBack("view.viewport", { canvas: "c", camera: { x: 0, y: 0, zoom: 1 }, screen: { w: 800, h: 600 } }), { width: 800, height: 600 });
	assert.equal(answerBack("view.viewport", { canvas: "c", camera: { x: 0, y: 0, zoom: 1 } }), null);
	assert.deepEqual(answerBack("canvas.fit", { card: "c", canvas: "x", box: { x1: 10, y1: 0, x2: 490, y2: 681 } }), { card: "c", canvas: "x", box: { x1: 10, y1: 0, x2: 490, y2: 681 }, w: 480, h: 681 });
	assert.equal((answerBack("canvas.export", { path: "exports/a.html", size: 3 }) as { file: string }).file, "exports/a.html");
	const app = answerBack("apps.create", { name: "e2e-notes", status: "stopped" }) as { item: unknown; next: string };
	assert.deepEqual(app.item, { type: "app", app: "e2e-notes" });
	assert.match(app.next, /canvas insert '\{"type":"app","app":"e2e-notes"\}'/);
});

test("pen.dev's own ops become item ops", () => {
	assert.deepEqual(itemOp({ op: "insert", node: { type: "note", id: "n" }, box: { x1: 10, y1: 20, x2: 110, y2: 70 } }), { op: "insert", item: { type: "note", id: "n", box: { x1: 10, y1: 20, x2: 110, y2: 70 } } });
	assert.deepEqual(itemOp({ op: "update", id: "n", set: { content: "a" }, box: { x1: 5, y1: 6 } }), { op: "update", id: "n", set: { content: "a" }, at: { x: 5, y: 6 } });
	assert.deepEqual(itemOp({ op: "insert", node: { type: "note" }, box: { x1: 5, y1: 6 } }), { op: "insert", item: { type: "note", x: 5, y: 6 } });
	assert.deepEqual(itemOp({ op: "delete", id: "n" }), { op: "delete", id: "n" });
});

test("every old event name is told as one the server emits", async () => {
	const { EVENTS } = await import("../../protocol/index.ts");
	const names = new Set<string>(EVENTS.map((e) => e.name));
	for (const [old, now] of OLD_EVENTS) assert.ok(names.has(now), `${old} -> ${now}`);
	const said = await told("item.changed", { canvas: "c", rev: 3, by: "x", ids: [] }, async () => ({ doc: { children: [] }, base: "/b/" }));
	assert.deepEqual(said, { type: "canvas.changed", canvas: "c", rev: 3, doc: { children: [] }, base: "/b/", by: "x" });
	assert.deepEqual(await told("card.changed", { canvas: "c", ids: ["p"], rev: 2 }, async () => undefined, async () => ({ path: "p", modifiedAt: 5 })), { type: "card.changed", path: "p", rev: 2, card: { path: "p", modifiedAt: 5 } });
});

test("an old name posted to /api/v1 answers through the kernel's translator", async () => {
	const server = await testServer({ features: features(), deck: { "canvases/c/canvas.pen": JSON.stringify({ version: "2.14", children: [{ type: "note", id: "n", x: 0, y: 0, content: "hi" }] }) } });
	const doors = await server.listen(0);
	const post = (name: string, body: unknown) => fetch(`${doors.url}/api/v1/${name}`, { method: "POST", headers: { authorization: `Bearer ${doors.token}` }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<{ ok: boolean; value?: { items?: unknown[] } }>);
	const read = await post("canvas.read", { args: [{ canvas: "c" }] });
	assert.equal(read.ok, true);
	assert.equal(read.value?.items?.length, 1, "canvas.read answers { items } as it did");
	assert.equal((await post("canvas.file", { args: [] })).ok, false);
	await doors.close();
	await server.close();
});

test("a same-name old call in the positional form answers through the translator", async () => {
	const server = await testServer({ features: features(), deck: { "canvases/c/canvas.pen": JSON.stringify({ version: "2.14", children: [] }) } });
	const doors = await server.listen(0);
	const answer = await fetch(`${doors.url}/api/v1/canvas.create`, { method: "POST", headers: { authorization: `Bearer ${doors.token}` }, body: JSON.stringify({ args: ["A new one"] }) });
	const body = (await answer.json()) as { ok: boolean; value?: { title?: string } };
	assert.equal(body.ok, true, JSON.stringify(body));
	assert.equal(body.value?.title, "A new one");
	await doors.close();
	await server.close();
});

test("an app to open is named from today's path", async () => {
	const { appToOpen } = await import("./apps.ts");
	assert.equal(appToOpen("/compat/apps/e2e-notes/open", "/compat/apps/"), "e2e-notes");
	assert.equal(appToOpen("/compat/apps/e2e-notes", "/compat/apps/"), undefined);
});

test("a screen's request for a card's picture is told as today's view.called shot", async () => {
	const said = await told("view.requested", { canvas: "c", ids: ["p"], call: "view.screenshot", id: "q1", args: { card: "canvases/c/cards/p/index.html" } }, async () => undefined);
	assert.deepEqual(said, { type: "view.called", call: { op: "shot", id: "q1", agentId: "", args: { path: "canvases/c/cards/p/index.html" } } });
	const cursor = (await told("view.requested", { canvas: "c", ids: [], by: "a1", call: "view.cursor", args: { card: "p", at: { x: 1, y: 2 }, label: "Ada" } }, async () => undefined)) as { call: { op: string; agentId: string; args: unknown } };
	assert.deepEqual([cursor.call.op, cursor.call.agentId, cursor.call.args], ["cursor", "a1", { path: "p", at: { x: 1, y: 2 }, label: "Ada" }]);
	assert.equal(await told("view.requested", { canvas: "c", ids: [], call: "view.reload", args: {} }, async () => undefined), undefined);
});

test("view.changed is told as today's presence.changed", async () => {
	const said = await told("view.changed", { canvas: "c", ids: [], by: "l2", kind: "person", name: "you", color: "#123", pointer: { x: 1, y: 2 }, rev: 0 }, async () => undefined);
	assert.deepEqual(said, { type: "presence.changed", canvas: "c", by: { kind: "person", id: "l2", name: "you", color: "#123" }, pointer: { x: 1, y: 2 } });
});
