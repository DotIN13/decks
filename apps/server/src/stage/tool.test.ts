import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Camera } from "@decks/protocol";
import { Deck } from "../deck/loader.ts";
import { StageService } from "./service.ts";
import { createStageTool, type QueuedWork, type SendSpec } from "./tool.ts";

/**
 * What the tool *says*, as opposed to what it does (DESIGN §6.3).
 *
 * The two things under test here are both result text rather than return values: the
 * viewport line after `newBoard`, and the refusals `send` gives an address it cannot use.
 * Neither is reachable from a browser check — the e2e suite needs a model to make an agent
 * call a tool at all — and both are the part a model actually reads.
 */
function toolOn(camera: Camera) {
	const root = mkdtempSync(join(tmpdir(), "decks-tool-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	writeFileSync(join(root, "boards", "plan.html"), `<!doctype html><title>plan</title><body class="board"></body>`);
	const deck = Deck.open(root);

	const sends: Array<{ target: string; spec: SendSpec }> = [];
	const others = [{ id: "a1", name: "Ada", state: "idle", context: ["boards/plan.html"], tags: ["panel-css"], queued: 3 }];
	const waiting: QueuedWork[] = [];
	const service = new StageService(deck, {
		newBoard: (options) => {
			const path = `boards/${options.title.toLowerCase().replace(/\W+/g, "-")}.html`;
			writeFileSync(join(root, path), `<!doctype html><title>${options.title}</title><body class="board"></body>`);
			return path;
		},
		call: async () => ({ ok: true }),
		connected: () => true,
		broadcast: () => {},
		camera: () => camera,
		agents: () => others,
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
			agents: () => others,
			camera: () => camera,
			spawn: async () => ({ agent: "", name: "", report: "", boards: [] }),
			send: (target, spec) => {
				sends.push({ target, spec });
				return { queued: true, position: sends.length };
			},
			queue: () => waiting,
			recordRevision: () => undefined,
			boardPathOf: () => undefined,
		},
	});
	return { tool, sends, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("newBoard says how much room the canvas has, after the path it returns", async () => {
	const { tool, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1440, height: 900 });
	const result = await tool.run(`return await stage.newBoard({ title: "Sizing", kind: "answer" })`);

	assert.equal(result.isError, false);
	const lines = result.text.split("\n");
	assert.match(lines[0] ?? "", /boards\/sizing\.html/, "the path is still the value, so `const path = await …` keeps working");
	assert.equal(lines[1], "viewport 1440×900 px");
	cleanup();
});

test("with no reading from a browser, it says nothing rather than making a number up", async () => {
	const { tool, cleanup } = toolOn({ x: 0, y: 0, zoom: 1 });
	const result = await tool.run(`return await stage.newBoard({ title: "Sizing", kind: "answer" })`);

	assert.equal(result.text.includes("viewport"), false);
	assert.equal((await tool.run(`return (await stage.viewport()) ?? "none"`)).text, `"none"`);
	cleanup();
});

test("the viewport is the canvas in pixels, not divided by the zoom", async () => {
	const { tool, cleanup } = toolOn({ x: 0, y: 0, zoom: 0.25, width: 1440, height: 900 });
	assert.equal((await tool.run(`return await stage.viewport()`)).text, `{\n  "width": 1440,\n  "height": 900\n}`);
	cleanup();
});

test("the note is per run: a call that did not start a board carries no viewport line", async () => {
	const { tool, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1440, height: 900 });
	await tool.run(`return await stage.newBoard({ title: "One", kind: "blank" })`);
	const second = await tool.run(`return (await stage.boards()).length`);

	assert.equal(second.text.includes("viewport"), false);
	cleanup();
});

test("send needs an address and a task, and passes both on", async () => {
	const { tool, sends, cleanup } = toolOn({ x: 0, y: 0, zoom: 1 });

	assert.match((await tool.run(`return await stage.send("", { task: "x" })`)).text, /Say which agent/);
	assert.match((await tool.run(`return await stage.send("Kit", { task: "  " })`)).text, /needs a description/);
	assert.equal(sends.length, 0, "and neither reached the registry");

	const ok = await tool.run(`return await stage.send(" Kit ", { task: "Remeasure", boards: ["boards/plan.html"] })`);
	assert.equal(ok.isError, false);
	assert.deepEqual(sends, [{ target: "Kit", spec: { task: "Remeasure", boards: ["boards/plan.html"] } }]);
	cleanup();
});

test("stage.agents() carries what each one is working on, and what is waiting for them", async () => {
	const { tool, cleanup } = toolOn({ x: 0, y: 0, zoom: 1 });
	const seen = JSON.parse((await tool.run(`return await stage.agents()`)).text) as Array<Record<string, unknown>>;

	// `tags` was documented in stage.d.ts and dropped on the way out, so an agent asking what
	// the others were doing got an object the type said had it and the value did not.
	assert.deepEqual(seen[0]?.tags, ["panel-css"]);
	assert.equal(seen[0]?.queued, 3);
	assert.equal(seen[0]?.me, true);
	cleanup();
});
