import { test } from "node:test";
import assert from "node:assert/strict";
import type { shapes } from "../../protocol/index.ts";
import { callers } from "../kernel/testing.ts";
import { fakeClient, peopleServer } from "./kit.test.ts";

// Rules 12 and 13: a screen follows an agent, an agent's view calls reach
// only those screens, and cameras are kept per caller, canvas and device.

type View = { canvas: string; camera?: { x: number; y: number; zoom: number }; moved?: boolean; waiting?: string };
const person = callers.person;

test("an agent's view.focus reaches a screen that follows it and no other", async () => {
	const { s, on, listen } = await peopleServer();
	const ann = await s.value<shapes.Agent>("agent.attach", { name: "Ann", canvas: "a" });
	await s.value<shapes.Agent>("agent.attach", { name: "Bo", canvas: "a" });
	const asAnn = s.callers.resolve(ann.token)!;
	await s.value("item.insert", { item: { type: "note", id: "n1" }, canvas: "a" }, person);
	const one = fakeClient("screen-1");
	const two = fakeClient("screen-2");
	const heardOne = listen(one.id);
	const heardTwo = listen(two.id);
	await on(one, "view.move", { x: 0, y: 0, zoom: 1, canvas: "a", agent: "Ann" }, person);
	await on(two, "view.move", { x: 0, y: 0, zoom: 1, canvas: "a", agent: "Bo" }, person);
	const view = await s.value<View>("view.focus", { target: "n1" }, asAnn);
	assert.equal(view.moved, true);
	const asked = heardOne.filter((h) => h.name === "view.requested");
	assert.deepEqual(asked.map((h) => h.payload.call), ["view.focus"]);
	assert.equal(heardTwo.filter((h) => h.name === "view.requested").length, 0);
	await s.close();
});

test("with no screen following, the view waits and says why", async () => {
	const { s } = await peopleServer();
	const ann = await s.value<shapes.Agent>("agent.attach", { name: "Ann", canvas: "a" });
	await s.value("item.insert", { item: { type: "note", id: "n1" }, canvas: "a" }, person);
	const view = await s.value<View>("view.focus", { target: "n1" }, s.callers.resolve(ann.token)!);
	assert.equal(view.moved, false);
	assert.match(view.waiting ?? "", /no screen follows/);
	const missing = await s.call("view.focus", { target: "nope" }, s.callers.resolve(ann.token)!);
	assert.equal(missing.ok ? "ok" : missing.error.code, "not_found");
	await s.close();
});

test("cameras are kept per agent and canvas; the agent reads the screen that follows it", async () => {
	const { s, on } = await peopleServer();
	const ann = await s.value<shapes.Agent>("agent.attach", { name: "Ann", canvas: "a" });
	const asAnn = s.callers.resolve(ann.token)!;
	const screen = fakeClient("screen-1");
	await on(screen, "view.move", { x: 10, y: 20, zoom: 2, canvas: "a", agent: "Ann", device: "mac" }, person);
	assert.deepEqual((await s.value<View>("view.get", {}, asAnn)).camera, { x: 10, y: 20, zoom: 2 });
	assert.deepEqual((await s.value<View>("view.get", { canvas: "b" }, asAnn)).camera, { x: 0, y: 0, zoom: 1 });
	await s.close();
});

test("view.goto moves an agent's home and its following screens with it", async () => {
	const { s, on, listen } = await peopleServer();
	const ann = await s.value<shapes.Agent>("agent.attach", { name: "Ann", canvas: "a" });
	const screen = fakeClient("screen-1");
	const heard = listen(screen.id);
	await on(screen, "view.move", { x: 0, y: 0, zoom: 1, canvas: "a", agent: "Ann" }, person);
	await s.value<View>("view.goto", { canvas: "b" }, s.callers.resolve(ann.token)!);
	assert.equal((await s.value<shapes.Agent>("agent.get", { agent: "Ann" })).canvas, "b");
	assert.ok(heard.some((h) => h.name === "view.requested" && h.payload.call === "view.goto"));
	assert.equal(s.callers.resolve(ann.token)?.canvas, "b", "here follows the home");
	await s.close();
});

test("view.reload answers how many screens on the canvas were asked", async () => {
	const { s, on } = await peopleServer();
	await on(fakeClient("s1"), "view.move", { x: 0, y: 0, zoom: 1, canvas: "a" }, person);
	await on(fakeClient("s2"), "view.move", { x: 0, y: 0, zoom: 1, canvas: "b" }, person);
	assert.equal(await s.value<number>("view.reload", { canvas: "a", card: "canvases/a/cards/x/index.html" }, person), 1);
	await s.close();
});

test("the person's here is the canvas on their screen, and they act for the agent it follows", async () => {
	const { s, on } = await peopleServer();
	const token = s.token(person);
	assert.equal(s.callers.resolve(token)?.canvas, "a", "no screen yet: the first canvas");
	await s.value<shapes.Agent>("agent.attach", { name: "Ann", canvas: "a" });
	const screen = fakeClient("screen-1");
	await on(screen, "view.move", { x: 0, y: 0, zoom: 1, canvas: "a", agent: "Ann" }, person);
	assert.equal(s.callers.resolve(token)?.canvas, "a", "here is the canvas on screen");
	const me = await on(screen, "agent.me", {}, person);
	assert.equal((me as shapes.Agent).name, "Ann", "agent.me answers the agent on screen");
	await s.value<View>("view.goto", { canvas: "b" }, person);
	assert.equal((await s.value<shapes.Agent>("agent.get", { agent: "Ann" })).canvas, "b", "goto moves that conversation");
	assert.equal(s.callers.resolve(token)?.canvas, "b", "and here goes with it at once");
	await s.close();
});
