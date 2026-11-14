import { test } from "node:test";
import assert from "node:assert/strict";
import { features } from "../main.ts";
import { testServer } from "../kernel/testing.ts";

// Today's tab socket: the roster on connect, an agent sent to a canvas, its drawing whole,
// and a card moved there, as resetStage in today's checks does it.

const deck = {
	"canvases/plan/canvas.pen": JSON.stringify({ version: "2.14", children: [{ type: "browser", id: "one", name: "One", x: 0, y: 0, width: 400, height: 300, metadata: { type: "decks.card", path: "cards/one/index.html" } }] }),
	"canvases/plan/cards/one/index.html": "<title>One</title><p>one</p>",
};

test("the tab socket gives the roster, sends an agent to a canvas and moves a card", async () => {
	const server = await testServer({ features: features(), deck });
	await server.value("agent.attach", { name: "Ada", kind: "claude" });
	const doors = await server.listen(0);
	const ws = new WebSocket(`${doors.url.replace("http", "ws")}/ws?decks_token=${doors.token}`);
	const heard: Array<Record<string, unknown>> = [];
	ws.onmessage = (m) => heard.push(JSON.parse(String(m.data)));
	const next = async (type: string, test: (m: Record<string, unknown>) => boolean = () => true) => {
		for (let i = 0; i < 100; i++) {
			const found = heard.find((m) => m.type === type && test(m));
			if (found) return found;
			await new Promise((r) => setTimeout(r, 50));
		}
		throw new Error(`no ${type}: ${JSON.stringify(heard).slice(0, 300)}`);
	};
	const agents = await next("agents");
	const focused = String(agents.focused);
	assert.ok(focused);
	ws.send(JSON.stringify({ type: "agent.stage", id: focused, stage: "plan" }));
	await next("agents", (m) => (m.chats as Array<{ inPlay: string[] }>).some((c) => c.inPlay.includes("canvases/plan/cards/one/index.html")));
	ws.send(JSON.stringify({ type: "card.move", stage: "plan", path: "canvases/plan/cards/one/index.html", x: 120, y: 40 }));
	ws.send(JSON.stringify({ type: "stage.pen.get", agentId: focused }));
	const pen = await next("stage.pen", (m) => JSON.stringify(m.doc).includes('"x":120'));
	assert.equal(pen.stage, "plan");
	ws.close();
	await doors.close();
	await server.close();
});
