import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EVENTS, type Caller } from "@decks/protocol";
import { harnessOffers, line, start, type Line, type Started } from "./start.ts";

// Every event the protocol declares is heard: the server started as main.ts
// starts it is driven through the smallest action that should cause each one,
// and a socket hears it. An event with no step must be in unheard.json: under
// unheard with its owner and why, or under notDrivenHere with what proves it.
// A listed event that a step now hears fails, so the list only shrinks.

type Listed = { unheard: Record<string, { owner: string; why: string }>; notDrivenHere: Record<string, { owner: string; provedBy: string }> };
type World = Started & { host: Line; screen: Line; frame: Line; agent: Caller; item: string };
type Step = { event: string; run(world: World): Promise<unknown> };
const CANVAS = "auth-refresh";

const STEPS: Step[] = [
	{ event: "deck.changed", run: (w) => w.server.call("deck.update", { timezone: "UTC" }) },
	{ event: "canvas.changed", run: (w) => w.server.call("canvas.create", { title: "Probe" }) },
	{ event: "item.changed", run: (w) => w.server.call("item.insert", { item: { type: "note", content: "hi" }, canvas: CANVAS }) },
	{ event: "card.changed", run: (w) => w.server.call("card.create", { title: "A card", canvas: CANVAS }) },
	{ event: "agent.changed", run: (w) => w.server.call("agent.update", { change: { tags: ["probing"] } }, w.agent) },
	{ event: "agent.requested", run: (w) => w.server.call("agent.create", { name: "Made", kind: "claude" }) },
	{ event: "agent.mailed", run: (w) => w.server.call("agent.send", { agent: "Made", task: "hi" }, w.agent) },
	{ event: "agent.acted", run: (w) => w.server.call("item.insert", { item: { type: "note", content: "by an agent" }, canvas: CANVAS }, w.agent) },
	{ event: "file.created", run: (w) => w.server.call("file.write", { path: "docs/new.md", text: "new" }, w.agent) },
	{ event: "file.changed", run: async (w) => (await w.host.call("file.open", { path: "docs/probe.md", client: "complete" }), w.server.call("file.write", { path: "docs/probe.md", text: "changed" }, w.agent)) },
	{ event: "view.changed", run: (w) => w.host.call("view.update", { canvas: CANVAS, selection: [] }) },
	{ event: "view.requested", run: (w) => w.host.call("view.focus", { target: w.item, canvas: CANVAS }) },
	{ event: "tab.changed", run: (w) => w.server.call("tab.pair", {}) },
	{ event: "app.changed", run: async (w) => (await w.server.call("app.create", { name: "probe" }), w.server.call("app.run", { name: "probe" })) },
	{ event: "agent.deleted", run: (w) => w.server.call("agent.delete", { agent: "Made" }) },
];

/** The world the steps act in: a host offering a kind, a person's screen and a canvas frame showing
 *  the canvas, an agent attached to it, an item on it. */
async function world(started: Started): Promise<World> {
	const host = await line(started.url, started.token);
	const screen = await line(started.url, started.token);
	const frame = await line(started.url, started.token);
	await host.call("agent.host", { kinds: ["claude"], calls: harnessOffers() });
	await screen.call("view.move", { x: 0, y: 0, zoom: 1, canvas: CANVAS });
	await frame.call("view.update", { canvas: CANVAS });
	await started.server.call("file.write", { path: "docs/probe.md", text: "first" });
	const attached = (await started.server.call("agent.attach", { name: "Prober", canvas: CANVAS })) as { value: { token: string } };
	const agent = started.server.callers.resolve(attached.value.token)!;
	const item = ((await started.server.call("item.insert", { item: { type: "note", content: "target" }, canvas: CANVAS })) as { value: { id: string } }).value.id;
	return { ...started, host, screen, frame, agent, item };
}

/** Whether any line heard the event within two seconds of the step. */
async function hears(w: World, event: string): Promise<boolean> {
	for (let waited = 0; waited < 2000; waited += 50) {
		if ([w.host, w.screen, w.frame].some((one) => one.heard.includes(event))) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	return false;
}

test("every declared event is heard after the action that causes it, or listed with its owner", async () => {
	const listed = JSON.parse(await readFile(new URL("unheard.json", import.meta.url), "utf8")) as Listed;
	const isListed = (name: string) => name in listed.unheard || name in listed.notDrivenHere;
	const started = await start();
	const w = await world(started);
	const silent: string[] = [];
	const stale: string[] = [];
	try {
		for (const step of STEPS) {
			for (const one of [w.host, w.screen, w.frame]) one.heard.length = 0;
			await step.run(w);
			const heard = await hears(w, step.event);
			if (!heard && !isListed(step.event)) silent.push(step.event);
			if (heard && isListed(step.event)) stale.push(step.event);
		}
		const declared = EVENTS.map((event) => event.name);
		const uncovered = declared.filter((name) => !STEPS.some((step) => step.event === name) && !isListed(name));
		const gone = [...Object.keys(listed.unheard), ...Object.keys(listed.notDrivenHere)].filter((name) => !declared.includes(name));
		assert.deepEqual(silent, [], "driven but not heard, and not in unheard.json");
		assert.deepEqual(uncovered, [], "no step causes it, and not in unheard.json");
		assert.deepEqual([...stale, ...gone], [], "in unheard.json but heard now, or no longer declared: take them out");
	} finally {
		for (const one of [w.host, w.screen, w.frame]) one.close();
		await w.server.call("app.stop", { name: "probe" });
		await started.stop();
	}
});
