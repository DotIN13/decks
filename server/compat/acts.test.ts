// An app's state and an agent's act told in the shapes today's canvas frame reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { told } from "./events.ts";

const none = async () => undefined;

test("app.changed names the app its windows listen by", async () => {
	assert.deepEqual(await told("app.changed", { ids: ["review"], status: "running" }, none), { type: "app.changed", name: "review", status: "running" });
	assert.equal(await told("app.changed", { status: "running" }, none), undefined, "no app named, nothing told");
});

test("agent.act carries the card's path and the agent; an act on no card is not told", async () => {
	const act = await told("agent.acted", { ids: ["canvases/plan/cards/one/index.html"], by: "a1", phase: "start", what: "edit", label: "Ada", color: "#f60", at: 5 }, none);
	assert.deepEqual(act, { type: "agent.act", agentId: "a1", path: "canvases/plan/cards/one/index.html", phase: "start", what: "edit", label: "Ada", color: "#f60", at: 5 });
	assert.equal(await told("agent.acted", { ids: [], by: "a1", phase: "done", what: "draw", label: "Ada", color: "#f60" }, none), undefined);
});
