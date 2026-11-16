import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller, shapes } from "../../protocol/index.ts";
import { callers } from "../kernel/testing.ts";
import { fakeClient, peopleServer } from "./kit.test.ts";

// The README's rules for records, attach, hosts, mail and news, as calls.

type Agent = shapes.Agent;
type Message = { id: string; state?: string; position?: number; task: string };
const person = callers.person;

test("after attach, a call with the new token runs as that agent, and its item says so", async () => {
	const { s } = await peopleServer();
	const made = await s.value<Agent>("agent.attach", { name: "Cody", kind: "claude", canvas: "a" });
	assert.ok(made.token, "attach answers a token");
	const as = s.callers.resolve(made.token) as Caller;
	assert.deepEqual(as, { kind: "agent", id: made.id, name: "Cody", canvas: "a" });
	const item = await s.value<{ by: string }>("item.insert", { item: { type: "note" }, canvas: "a" }, as);
	assert.equal(item.by, "Cody");
	await s.value("agent.update", { change: { name: "Cody Two" } }, as);
	assert.equal(s.callers.resolve(made.token)?.name, "Cody Two", "the token speaks under the current name");
	await s.value("agent.delete", { agent: made.id });
	assert.equal(s.callers.resolve(made.token), undefined, "a deleted agent's token stops working");
	await s.close();
});

test("attach gives a home: the canvas named, else a new one titled for the agent", async () => {
	const { s, docs } = await peopleServer();
	const named = await s.value<Agent>("agent.attach", { name: "Ann", canvas: "Title B" });
	assert.equal(named.canvas, "b");
	const fresh = await s.value<Agent>("agent.attach", { name: "Cody Two" });
	assert.equal(fresh.canvas, "cody-two");
	assert.ok(docs.has("cody-two"), "the new canvas was made through canvas.create");
	const as = s.callers.resolve(fresh.token)!;
	assert.equal(as.canvas, "cody-two", "here works on the first call");
	assert.equal((await s.value<Agent>("agent.me", {}, as)).canvas, "cody-two");
	const bad = await s.call("agent.attach", { name: "Dee", canvas: "nowhere" });
	assert.equal(bad.ok ? "ok" : bad.error.code, "not_found");
	assert.equal((await s.call("agent.get", { agent: "Dee" })).ok, false, "a refused attach leaves no record");
	await s.close();
});

test("names are unique however capitalised, and default to the first free number", async () => {
	const { s } = await peopleServer();
	const one = await s.value<Agent>("agent.attach", {});
	const two = await s.value<Agent>("agent.attach", { kind: "claude" });
	assert.equal(one.name, "Agent 1");
	assert.equal(two.name, "Agent 2", "the kind does not change the word");
	assert.notEqual(one.color, two.color);
	assert.equal((await s.value<Agent>("agent.attach", { canvas: "Title A" })).canvas, "a", "a title becomes the canvas's name");
	const clash = await s.call("agent.attach", { name: "agent 1" });
	assert.equal(clash.ok ? "ok" : clash.error.code, "conflict");
	await s.close();
});

test("an agent changes only itself; the person changes any", async () => {
	const { s } = await peopleServer();
	const ann = await s.value<Agent>("agent.attach", { name: "Ann" });
	const bo = await s.value<Agent>("agent.attach", { name: "Bo" });
	const asAnn = s.callers.resolve(ann.token) as Caller;
	const tried = await s.call("agent.update", { agent: "Bo", change: { tags: ["x"] } }, asAnn);
	assert.equal(tried.ok ? "ok" : tried.error.code, "refused");
	const mine = await s.value<Agent>("agent.update", { change: { tags: ["Panel CSS", "panel-css"], workspace: "Decks Rewrite" } }, asAnn);
	assert.deepEqual([mine.tags, mine.workspace], [["panel-css"], "decks-rewrite"]);
	assert.equal((await s.value<Agent>("agent.update", { agent: bo.id, change: { name: "Beau" } }, person)).name, "Beau");
	assert.equal((await s.value<Agent>("agent.me", {}, asAnn)).name, "Ann");
	assert.equal((await s.value<Agent[]>("agent.list", { workspace: "decks-rewrite" })).length, 1);
	await s.close();
});

test("mail to an agent with no host waits in its inbox", async () => {
	const { s } = await peopleServer();
	const ann = await s.value<Agent>("agent.attach", { name: "Ann" });
	const sent = await s.value<Message>("agent.send", { agent: "Ann", task: "Look at the plan" });
	assert.deepEqual([sent.state, sent.position], ["queued", 1]);
	await s.value("agent.queue", { agent: "Ann", task: "Then the chart", reply: true });
	const inbox = await s.value<Message[]>("agent.inbox", {}, s.callers.resolve(ann.token)!);
	assert.deepEqual(inbox.map((m) => m.task), ["Look at the plan", "Then the chart"]);
	assert.equal((await s.value<Agent>("agent.get", { agent: "Ann" })).queued, 2);
	await s.close();
});

test("agent.create with no host is refused unavailable, saying a harness must run", async () => {
	const { s } = await peopleServer();
	const answer = await s.call("agent.create", { name: "Rune" });
	assert.equal(answer.ok, false);
	if (!answer.ok) {
		assert.equal(answer.error.code, "unavailable");
		assert.match(answer.error.message, /harness/);
	}
	await s.close();
});

test("with a host connected, create asks that host alone, and send reaches it", async () => {
	const { s, on, listen } = await peopleServer();
	const host = fakeClient("host-1");
	const other = fakeClient("page-1");
	const heard = listen(host.id);
	const otherHeard = listen(other.id);
	assert.deepEqual(await on(host, "agent.host", { kinds: ["claude", "pi"] }, person), ["claude", "pi"]);
	const rune = await s.value<Agent>("agent.create", { name: "Rune", kind: "pi" });
	const asked = heard.find((h) => h.name === "agent.requested");
	assert.ok(asked, "the host hears agent.requested");
	const spec = asked.payload.spec as { id: string; kind: string; token: string };
	assert.deepEqual([spec.id, spec.kind], [rune.id, "pi"]);
	assert.equal(s.callers.resolve(spec.token)?.id, rune.id, "the host gets the agent's token to start it with");
	assert.equal(rune.token, undefined, "the token is not in the answer");
	const sent = await s.value<Message>("agent.send", { agent: "Rune", task: "Hello" });
	assert.equal(sent.state, "delivered");
	assert.ok(heard.some((h) => h.name === "agent.mailed" && (h.payload.message as Message).task === "Hello"));
	assert.equal(otherHeard.filter((h) => h.name === "agent.mailed" || h.name === "agent.requested").length, 0);
	host.close();
	const after = await s.call("agent.create", { kind: "pi" });
	assert.equal(after.ok ? "ok" : after.error.code, "unavailable", "the offer ends with the connection");
	await s.close();
});

test("agent.news gives others' changes since the last ask, then nothing new", async () => {
	const { s } = await peopleServer();
	const ann = await s.value<Agent>("agent.attach", { name: "Ann", canvas: "a" });
	const asAnn = s.callers.resolve(ann.token)!;
	await s.value("item.insert", { item: { type: "note", id: "n1" }, canvas: "a" }, person);
	await s.value("item.insert", { item: { type: "note", id: "mine" }, canvas: "a" }, asAnn);
	await s.value("agent.send", { agent: "Ann", task: "See n1" });
	const first = await s.value<shapes.Agent & { changes: { ids: string[]; by: string }[]; mail: Message[]; rev: number }>("agent.news", {}, asAnn);
	assert.deepEqual(first.changes.map((c) => [c.ids, c.by]), [[["n1"], "person"]]);
	assert.deepEqual(first.mail.map((m) => m.task), ["See n1"]);
	assert.equal(first.rev, 2);
	const second = await s.value<{ changes: unknown[]; mail: unknown[] }>("agent.news", {}, asAnn);
	assert.deepEqual([second.changes.length, second.mail.length], [0, 0]);
	await s.close();
});

test("only the hosting socket reports state and queue; a working agent is not deleted", async () => {
	const { s, on } = await peopleServer();
	const host = fakeClient("host-1");
	await on(host, "agent.host", { kinds: ["pi"] }, person);
	const rune = await s.value<Agent>("agent.create", { name: "Rune", kind: "pi", canvas: "a" });
	const told = await on(host, "agent.update", { agent: rune.id, change: { state: "thinking", queued: 3 } }, person);
	assert.deepEqual([(told as Agent).state, (told as Agent).queued], ["thinking", 3]);
	assert.ok(s.heard.some((h) => h.name === "agent.changed" && h.payload.state === "thinking"));
	const elsewhere = await s.call("agent.update", { agent: rune.id, change: { state: "idle" } }, person);
	assert.equal(elsewhere.ok ? "ok" : elsewhere.error.code, "refused", "not from a socket that does not host it");
	const busy = await s.call("agent.delete", { agent: "Rune" });
	assert.equal(busy.ok ? "ok" : busy.error.code, "conflict");
	await on(host, "agent.update", { agent: rune.id, change: { state: "idle" } }, person);
	assert.equal((await s.call("agent.delete", { agent: "Rune" })).ok, true);
	await s.close();
});

test("a host that comes up takes the agents of its kinds with no host, each told with a token", async () => {
	const { s, on, listen } = await peopleServer();
	const first = fakeClient("host-1");
	await on(first, "agent.host", { kinds: ["pi"] }, person);
	const rune = await s.value<Agent>("agent.create", { name: "Rune", kind: "pi", canvas: "a" });
	await s.value("agent.attach", { name: "Term", kind: "pi", canvas: "a" });
	first.close();
	const second = fakeClient("host-2");
	const heard = listen(second.id);
	await on(second, "agent.host", { kinds: ["pi"] }, person);
	const asked = heard.filter((h) => h.name === "agent.requested").map((h) => h.payload.spec as { id: string; token: string; adopted: boolean });
	assert.deepEqual(asked.map((a) => [a.id, a.adopted]), [[rune.id, true]], "attached agents are never adopted");
	assert.equal(s.callers.resolve(asked[0]!.token)?.id, rune.id);
	assert.equal((await s.value<Agent>("agent.send", { agent: "Rune", task: "hi" }) as unknown as { state: string }).state, "delivered");
	await s.close();
});

test("the person's new agent joins its workspace's latest canvas, else gets its own", async () => {
	const { s, on } = await peopleServer();
	await on(fakeClient("host-1"), "agent.host", { kinds: ["pi"] }, person);
	const first = await s.value<Agent>("agent.create", { name: "Pi One", kind: "pi" });
	assert.equal(first.canvas, "pi-one", "no workspace agent has a canvas yet: a new one");
	const second = await s.value<Agent>("agent.create", { name: "Pi Two", kind: "pi" });
	assert.equal(second.canvas, "pi-one", "joins the latest canvas of its workspace");
	const other = await s.value<Agent>("agent.create", { name: "Elsewhere", kind: "pi", workspace: "films" });
	assert.equal(other.canvas, "elsewhere", "another workspace starts its own");
	const asAgent = s.callers.resolve((await s.value<Agent>("agent.attach", { name: "Maker", canvas: "a" })).token)!;
	assert.equal((await s.value<Agent>("agent.create", { name: "Helper", kind: "pi" }, asAgent)).canvas, "helper", "an agent's new agent gets its own");
	await s.close();
});

test("an agent's change on a card is told as agent.acted, in its name and colour; the person's is not", async () => {
	const { s } = await peopleServer();
	const ann = await s.value<Agent>("agent.attach", { name: "Ann", canvas: "a" });
	const card = "canvases/a/cards/x/index.html";
	await s.value("item.insert", { item: { type: "card", card }, canvas: "a" }, s.callers.resolve(ann.token)!);
	await s.value("item.insert", { item: { type: "card", card }, canvas: "a" }, person);
	const acted = s.heard.filter((h) => h.name === "agent.acted");
	assert.equal(acted.length, 1);
	assert.deepEqual([acted[0]!.payload.ids, acted[0]!.payload.by, acted[0]!.payload.label, acted[0]!.payload.color, acted[0]!.payload.canvas], [[card], ann.id, "Ann", ann.color, "a"]);
	await s.close();
});

test("agent.act tells a start and a finish on a card's file, and records nothing", async () => {
	const { s } = await peopleServer();
	const ann = await s.value<Agent>("agent.attach", { name: "Ann", canvas: "a" });
	const as = s.callers.resolve(ann.token)!;
	const file = "canvases/a/cards/x/chart.js";
	assert.deepEqual(await s.value("agent.act", { cards: [file], phase: "start", what: "edit" }, as), { ok: true });
	assert.deepEqual(await s.value("agent.act", { cards: ["assets/x.png"], phase: "done" }, as), { ok: false }, "no card, no act");
	const acted = s.heard.filter((h) => h.name === "agent.acted");
	assert.equal(acted.length, 1, "agent.act itself is not told again as a done act");
	assert.deepEqual([acted[0]!.payload.phase, acted[0]!.payload.what, acted[0]!.payload.ids, acted[0]!.payload.canvas], ["start", "edit", ["canvases/a/cards/x/index.html"], "a"]);
	await s.close();
});

test("from a card, agent.me and agent.inbox answer for the agent whose home is the card's canvas", async () => {
	const { s } = await peopleServer();
	await s.value<Agent>("agent.attach", { name: "Ann", canvas: "a" });
	await s.value("agent.queue", { agent: "Ann", task: "From the card's button" }, person);
	const card = { kind: "card" as const, id: "canvases/a/cards/x/index.html", name: "x", canvas: "a" };
	assert.equal((await s.value<Agent>("agent.me", {}, card)).name, "Ann");
	assert.deepEqual((await s.value<Message[]>("agent.inbox", {}, card)).map((m) => m.task), ["From the card's button"]);
	const elsewhere = await s.call("agent.me", {}, { ...card, canvas: "b" });
	assert.equal(elsewhere.ok ? "ok" : elsewhere.error.code, "not_found");
	await s.close();
});
