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
	const others = [
		{ id: "a1", name: "Ada", state: "idle", kind: "claude" as const, context: ["boards/plan.html"], holding: 1, tags: ["panel-css"], queued: 3 },
	];
	const waiting: QueuedWork[] = [];
	/** What a browser would have reported, if one were looking. */
	const extents = new Map<string, { rev: number; w: number; h: number }>();
	const service = new StageService(deck, {
		newMirror: () => "boards/mirrors/x.html",
		newBoard: (options) => {
			const path = `boards/${options.title.toLowerCase().replace(/\W+/g, "-")}.html`;
			writeFileSync(join(root, path), `<!doctype html><title>${options.title}</title><body class="board"></body>`);
			return path;
		},
		writeBoard: (path, html) => {
			writeFileSync(join(root, path), html);
			const board = deck.refresh(path);
			if (!board) throw new Error(`no board at ${path}`);
			return board;
		},
		extent: (path, rev) => (extents.get(path)?.rev === rev ? extents.get(path) : undefined),
		awaitExtent: async (path, rev) => (extents.get(path)?.rev === rev ? extents.get(path) : undefined),
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
	return { tool, sends, deck, extents, cleanup: () => rmSync(root, { recursive: true, force: true }) };
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
	// the others were doing got an object the type said had it and the value did not. `kind`
	// and `holding` joined the row for the same reason — the runtime is load-bearing now, and
	// a capped list without its true total reads as "all of them".
	assert.deepEqual(seen[0]?.tags, ["panel-css"]);
	assert.equal(seen[0]?.queued, 3);
	assert.equal(seen[0]?.me, true);
	assert.equal(seen[0]?.kind, "claude");
	assert.equal(seen[0]?.holding, 1);
	cleanup();
});

test("attach is most-recently-touched first, and re-attaching moves the board to the front", async () => {
	const root = mkdtempSync(join(tmpdir(), "decks-attach-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	for (const name of ["a.html", "b.html", "c.html"]) {
		writeFileSync(join(root, "boards", name), `<!doctype html><title>${name}</title><body class="board"></body>`);
	}
	const deck = Deck.open(root);
	const service = new StageService(deck, {
		newMirror: () => "boards/mirrors/x.html",
		newBoard: () => "",
		writeBoard: () => {
			throw new Error("not used here");
		},
		extent: () => undefined,
		awaitExtent: async () => undefined,
		call: async () => ({ ok: true }),
		connected: () => true,
		broadcast: () => {},
		camera: () => ({ x: 0, y: 0, zoom: 1 }),
		agents: () => [],
	});

	// A hook that really holds the list, so the ordering `attach` builds can be read off it.
	let held: string[] = [];
	const set: string[][] = [];
	const tool = createStageTool({
		stage: service,
		port: 4329,
		agent: {
			id: "a1",
			identity: () => ({ name: "Ada", color: "#000" }),
			context: () => held,
			setContext: (paths) => {
				held = paths;
				set.push([...paths]);
			},
			inPlay: () => [],
			setInPlay: () => {},
			rename: () => {},
			setAvatar: () => {},
			setTags: (tags) => tags as string[],
			agents: () => [],
			camera: () => ({ x: 0, y: 0, zoom: 1 }),
			spawn: async () => ({ agent: "", name: "", report: "", boards: [] }),
			send: () => ({ queued: true, position: 1 }),
			queue: () => [],
			recordRevision: () => undefined,
			boardPathOf: () => undefined,
		},
	});

	await tool.run(`await stage.attach(["boards/a.html", "boards/b.html", "boards/c.html"])`);
	assert.deepEqual(set.at(-1), ["boards/c.html", "boards/b.html", "boards/a.html"], "the last attached leads the list");

	await tool.run(`await stage.attach(["boards/a.html"])`);
	assert.deepEqual(set.at(-1), ["boards/a.html", "boards/c.html", "boards/b.html"], "re-attaching a board moves it to the front");
	rmSync(root, { recursive: true, force: true });
});

/*
 * `resize` and `fit` are the two ways a board's size gets written, and both go through
 * the server so the deck's own record cannot fall behind the file. What is worth testing
 * is the honesty of `fit`: it refuses when nothing has measured the board, because the
 * alternative is a plausible number nobody took.
 */
test("resize writes the meta and the deck agrees immediately", async () => {
	const { tool, deck, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1400, height: 900 });
	const before = deck.board("boards/plan.html");
	assert.equal(before?.w, 1200, "the default, since this board's file says nothing");

	const result = await tool.run(`return await stage.resize("boards/plan.html", { w: 1600, h: 1100 })`);
	assert.match(result.text, /"w": 1600/);
	assert.equal(deck.board("boards/plan.html")?.h, 1100);

	const onlyHeight = await tool.run(`return await stage.resize("boards/plan.html", { h: 900 })`);
	assert.match(onlyHeight.text, /"w": 1600/, "the dimension that was not named is kept");
	assert.match(onlyHeight.text, /"h": 900/);
	cleanup();
});

test("fit says to put the board on the canvas rather than guessing a height", async () => {
	const { tool, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1400, height: 900 });
	const result = await tool.run(`return await stage.fit("boards/plan.html")`);
	assert.equal(result.isError, true);
	assert.match(result.text, /put it on the canvas/);
	cleanup();
});

test("fit takes the height from the content and leaves a margin", async () => {
	const { tool, deck, extents, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1400, height: 900 });
	const board = deck.board("boards/plan.html");
	extents.set("boards/plan.html", { rev: board!.rev, w: 700, h: 1400 });

	await tool.run(`return await stage.fit("boards/plan.html")`);
	const fitted = deck.board("boards/plan.html");
	assert.equal(fitted?.h, 1448, "the content, plus the margin its components start at");
	assert.equal(fitted?.w, 1200, "and a width that was already wide enough is left alone");
	cleanup();
});

test("fit grows the width for content pushed past the edge, and never narrows it", async () => {
	const { tool, deck, extents, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1400, height: 900 });
	const board = deck.board("boards/plan.html");
	extents.set("boards/plan.html", { rev: board!.rev, w: 1500, h: 600 });

	await tool.run(`return await stage.fit("boards/plan.html", { margin: 0 })`);
	assert.equal(deck.board("boards/plan.html")?.w, 1500);
	assert.equal(deck.board("boards/plan.html")?.h, 600);
	cleanup();
});
