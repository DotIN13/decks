import { test } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "../kernel/index.ts";
import { features } from "../main.ts";
import { callers, testServer } from "../kernel/testing.ts";

// A second turn started right after the first ends: the tab socket never shows the agent idle
// until the second turn ends, though a roster built for the first turn's end may finish late.

const cards = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`canvases/plan/cards/c${i}/index.html`, `<title>C${i}</title>`]));
const children = Array.from({ length: 30 }, (_, i) => ({ type: "browser", id: `c${i}`, x: i * 500, y: 0, width: 400, height: 300, metadata: { type: "decks.card", path: `cards/c${i}/index.html` } }));
const deck = { "canvases/plan/canvas.pen": JSON.stringify({ version: "2.14", children }), ...cards };
const host = (id: string): Client => ({ id, closed: () => () => {} });

test("a second turn right after the first never shows the agent idle until it ends", async () => {
	const server = await testServer({ features: features(), deck });
	const harness = host("harness-1");
	const person = callers.person;
	const on = async (name: string, args: Record<string, unknown>) => {
		const answer = await server.call(name, args, person, harness);
		if (!answer.ok) throw new Error(answer.error.message);
		return answer.value as { id: string };
	};
	await on("agent.host", { kinds: ["pi"] });
	const agents = await Promise.all(Array.from({ length: 6 }, (_, i) => on("agent.create", { name: `A${i}`, kind: "pi", canvas: "plan" })));
	const ada = agents[0].id;
	const doors = await server.listen(0);
	const ws = new WebSocket(`${doors.url.replace("http", "ws")}/ws?decks_token=${doors.token}`);
	const states: string[] = [];
	ws.onmessage = (m) => {
		const said = JSON.parse(String(m.data));
		if (said.type === "agent.state" && said.id === ada) states.push(said.state);
		if (said.type === "agents") states.push(said.chats.find((c: { id: string }) => c.id === ada)?.state ?? "?");
	};
	await new Promise((r) => (ws.onopen = r));
	await new Promise((r) => setTimeout(r, 300));
	for (let round = 0; round < 5; round++) {
		await on("agent.update", { agent: ada, change: { state: "thinking" } });
		await on("agent.update", { agent: ada, change: { state: "idle" } });
		await on("agent.update", { agent: ada, change: { state: "thinking" } });
		await new Promise((r) => setTimeout(r, 400));
		assert.equal(states.at(-1), "thinking", `round ${round}: the last state the page heard: ${states.slice(-8).join(" ")}`);
		await on("agent.update", { agent: ada, change: { state: "idle" } });
		await new Promise((r) => setTimeout(r, 300));
	}
	ws.close();
	await doors.close();
	await server.close();
});
