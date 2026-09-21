import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Canvas } from "@decks/protocol";
import { CanvasStore } from "../canvas/store.ts";
import { Deck } from "../deck/loader.ts";
import { StageService } from "./service.ts";
import { createStageTool, type StageAgentHooks } from "./tool.ts";

/*
 * The verbs an agent draws on a canvas with: where am I, move, arrow, group.
 *
 * What is under test is what a model reads — the canvas each verb answers with, and the
 * sentence it refuses with — because that is the only feedback an agent gets about a line it
 * cannot see.
 */

function toolOn(options: { canvas?: boolean } = {}) {
	const root = mkdtempSync(join(tmpdir(), "decks-canvas-verbs-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	for (const name of ["plan.html", "result.html", "judge.html"]) {
		writeFileSync(join(root, "boards", name), `<!doctype html><title>${name}</title><body class="board"></body>`);
	}
	const deck = Deck.open(root);
	const canvases = new CanvasStore(root);
	let on: string | undefined;
	const list = (): Canvas[] =>
		canvases.list().map((canvas) => ({ ...canvas, agents: canvas.id === on ? ["a1"] : [] }));
	const current = () => list().find((canvas) => canvas.id === on);
	const here = () => (on ??= canvases.ensure("Ada").id);
	const hooks: StageAgentHooks["canvas"] = {
		current,
		list,
		use: (name) => {
			on = canvases.ensure(name).id;
			return current();
		},
		link: (from, to, label) => (canvases.link(here(), from, to, label) ? current() : undefined),
		unlink: (from, to) => (on && canvases.unlink(on, from, to) ? current() : undefined),
		group: (paths, name) => (canvases.group(here(), name, paths) ? current() : undefined),
		ungroup: (name) => (on && canvases.ungroup(on, name) ? current() : undefined),
	};
	const service = new StageService(deck, {
		newBoard: () => "boards/x.html",
		newMirror: () => "boards/mirrors/x.html",
		writeBoard: () => deck.board("boards/plan.html")!,
		extent: () => undefined,
		awaitExtent: async () => undefined,
		call: async () => ({ ok: true }),
		connected: () => false,
		broadcast: () => {},
		camera: () => ({ x: 0, y: 0, zoom: 1 }),
		agents: () => [],
		place: () => undefined,
	});
	const tool = createStageTool({
		stage: service,
		port: 4329,
		agent: {
			id: "a1",
			identity: () => ({ name: "Ada", color: "#000" }),
			context: () => [],
			setContext: () => {},
			inPlay: () => [],
			setInPlay: () => {},
			rename: () => {},
			setAvatar: () => {},
			setTags: (tags) => tags as string[],
			setWorkspace: () => null,
			...(options.canvas === false ? {} : { canvas: hooks }),
			agents: () => [],
			camera: () => ({ x: 0, y: 0, zoom: 1 }),
			send: () => ({ queued: true, position: 1 }),
			queue: () => [],
			recordRevision: () => undefined,
			boardPathOf: () => undefined,
		},
	});
	return { tool, canvases };
}

test("an arrow lands on the agent's canvas, and the verb answers with the canvas", async () => {
	const { tool } = toolOn();
	const result = await tool.run(`return (await stage.link("boards/plan.html", "boards/result.html", "ran")).links`);
	assert.equal(result.isError, false, result.text);
	assert.deepEqual(JSON.parse(result.text), [{ from: "boards/plan.html", to: "boards/result.html", label: "ran" }]);
});

test("a group needs two boards and a name, and says so", async () => {
	const { tool } = toolOn();
	const one = await tool.run(`return await stage.group(["boards/plan.html"], { name: "the pilot" })`);
	assert.equal(one.isError, true);
	assert.match(one.text, /two or more boards/);
	const nameless = await tool.run(`return await stage.group(["boards/plan.html", "boards/judge.html"], {})`);
	assert.match(nameless.text, /needs a name/);
	const made = await tool.run(`return (await stage.group(["boards/plan.html", "boards/judge.html"], { name: "the pilot" })).groups`);
	assert.deepEqual(JSON.parse(made.text), [{ name: "the pilot", boards: ["boards/plan.html", "boards/judge.html"] }]);
});

test("a path that is not a board is refused with the shape of one that is", async () => {
	const { tool } = toolOn();
	const result = await tool.run(`return await stage.link("plan", "boards/result.html")`);
	assert.equal(result.isError, true);
	assert.match(result.text, /No such board: plan/);
	assert.match(result.text, /boards\/plan\.html/);
});

test("canvas(name) joins by name, and canvas() says where you are", async () => {
	const { tool } = toolOn();
	const before = await tool.run(`return (await stage.canvas()) ?? "none"`);
	assert.equal(before.text, `"none"`, "an agent that has drawn nothing is on no canvas");
	await tool.run(`return await stage.canvas("Political LLM")`);
	const after = await tool.run(`return (await stage.canvas()).name`);
	assert.equal(after.text, `"Political LLM"`);
	const all = await tool.run(`return (await stage.canvases()).map((canvas) => canvas.name)`);
	assert.deepEqual(JSON.parse(all.text), ["Political LLM"]);
});

test("with no canvas to draw on, every verb refuses in a sentence", async () => {
	const { tool } = toolOn({ canvas: false });
	const result = await tool.run(`return await stage.link("boards/plan.html", "boards/result.html")`);
	assert.equal(result.isError, true);
	assert.match(result.text, /no canvas here/);
});

test("the opposites fold into the verbs: a null label unlinks, an empty list ungroups", async () => {
	const { tool } = toolOn();
	await tool.run(`await stage.link("boards/plan.html", "boards/result.html", "ran"); await stage.group(["boards/plan.html", "boards/result.html"], { name: "the pilot" });`);
	const gone = await tool.run(`
		await stage.link("boards/plan.html", "boards/result.html", null);
		const canvas = await stage.group([], { name: "the pilot" });
		return { links: canvas.links.length, groups: canvas.groups.length };
	`);
	assert.deepEqual(JSON.parse(gone.text), { links: 0, groups: 0 });
	const missing = await tool.run(`return await stage.group([], { name: "nothing" })`);
	assert.match(missing.text, /no group called nothing/);
});

test("a verb that is gone refuses with the call that replaces it", async () => {
	const { tool } = toolOn();
	for (const [code, expected] of [
		[`return await stage.useCanvas("x")`, /stage\.canvas\(name\)/],
		[`return await stage.unlink("boards/plan.html", "boards/result.html")`, /stage\.link\(a, b, null\)/],
		[`return await stage.ungroup("the pilot")`, /stage\.group\(\[\], \{ name \}\)/],
		[`return await stage.workspaces()`, /stage\.canvases\(\)/],
		[`return await stage.me.setTags(["x"])`, /stage\.me\(\{ tags \}\)/],
		[`return await stage.delegate({ task: "x" })`, /abandoned after 20 seconds[\s\S]*stage\.send/],
	] as const) {
		const result = await tool.run(code);
		assert.equal(result.isError, true, code);
		assert.match(result.text, expected, code);
	}
});
