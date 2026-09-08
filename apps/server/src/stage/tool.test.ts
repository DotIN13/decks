import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
			// The extension is the server's business and comes from the format — the stub
			// mirrors the real table so a test can assert *which file* a format asked for.
			const extension = options.format === "slides" ? ".slides.html" : options.format === "flow" ? ".md" : ".html";
			const path = `boards/${options.title.toLowerCase().replace(/\W+/g, "-")}${extension}`;
			// The size it was asked for goes into the file, because the file is the only
			// place a size lives — a stub that dropped it would make every width assertion
			// below a reading of the loader's fallback instead.
			const meta = `<meta name="board" content='{"w":${options.size?.w ?? 1000},"h":${options.size?.h ?? 700}}' />`;
			writeFileSync(join(root, path), `<!doctype html><title>${options.title}</title>${meta}<body class="board"></body>`);
			return path;
		},
		writeBoard: (path, html) => {
			writeFileSync(join(root, path), html);
			const board = deck.refresh(path);
			if (!board) throw new Error(`no board at ${path}`);
			return board;
		},
		extent: (path, rev) => (extents.get(path)?.rev === rev ? extents.get(path) : undefined),
		/*
		 * A browser that is actually looking.
		 *
		 * The cached reading is per revision, so a resize invalidates it — and `fit` now
		 * resizes and then asks again, which is the second pass. A real frame answers that,
		 * with the same content: narrowing the board does not narrow components that carry
		 * their own width. So this answers whatever revision is asked for.
		 */
		awaitExtent: async (path) => extents.get(path),
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
	return {
		tool,
		sends,
		deck,
		extents,
		/** What was actually written to disk, which is the only place a board's size lives. */
		read: (path: string) => readFileSync(join(root, path), "utf8"),
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
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

	assert.equal(/viewport \d+/.test(result.text), false, "no measurement, because nobody took one");
	// The *rule* is still said, because it still applies: with no screen to measure, the
	// ceiling is the 1600 in the formula rather than a number invented for the occasion.
	assert.match(result.text, /min\(viewport width, 1600\)/);
	assert.equal((await tool.run(`return (await stage.viewport()) ?? "none"`)).text, `"none"`);
	cleanup();
});

/*
 * The acceptance criterion for the width rule, at the two ends of it: a board is never
 * wider than the room the canvas has, and never wider than 1600 however much room there is.
 * Asserted through the tool rather than through `boardWidth` because the point is that the
 * clamp is *applied* — it used to be a sentence in a note that nothing enforced.
 */
test("a new board is never wider than min(viewport, 1600), and says which rule it used", async () => {
	/** The width the file was written with — the only place a board's size lives. */
	const widthOf = (text: string) => Number(/"w":(\d+)/.exec(text)?.[1]);

	const wide = toolOn({ x: 0, y: 0, zoom: 1, width: 1920, height: 1080 });
	const onWide = await wide.tool.run(`return await stage.newBoard({ title: "Wide", kind: "report" })`);
	assert.equal(widthOf(wide.read("boards/wide.html")), 1200, "the shape's own width, which is under the ceiling");
	assert.match(onWide.text, /board width 1200/);
	wide.cleanup();

	const phone = toolOn({ x: 0, y: 0, zoom: 1, width: 390, height: 844 });
	const onPhone = await phone.tool.run(`return await stage.newBoard({ title: "Phone", kind: "report" })`);
	assert.equal(widthOf(phone.read("boards/phone.html")), 390, "the screen, when the screen is smaller");
	assert.match(onPhone.text, /board width 390 — the rule is min\(viewport width, 1600\)/);
	phone.cleanup();

	// And a width somebody typed is still theirs, ceiling or no ceiling.
	const asked = toolOn({ x: 0, y: 0, zoom: 1, width: 390, height: 844 });
	await asked.tool.run(`return await stage.newBoard({ title: "Asked", kind: "report", w: 1800 })`);
	assert.equal(widthOf(asked.read("boards/asked.html")), 1800);
	asked.cleanup();
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
	assert.equal(before?.w, 1600, "the last-resort width, since this board's file says nothing");

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

test("fit takes both dimensions from the content, and narrows a board with room to spare", async () => {
	const { tool, deck, extents, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1400, height: 900 });
	const board = deck.board("boards/plan.html");
	assert.equal(board?.w, 1600, "a board that says nothing about itself gets the ceiling");
	extents.set("boards/plan.html", { rev: board!.rev, w: 700, h: 1400 });

	await tool.run(`return await stage.fit("boards/plan.html")`);
	const fitted = deck.board("boards/plan.html");
	assert.equal(fitted?.h, 1448, "the content, plus the margin its components start at");
	/*
	 * The change this test exists for. `fit` used to grow the width and never shrink it, so
	 * a board guessed at 1200 with 700 of content kept a column of empty grid down its
	 * right-hand side — and a reader cannot tell that from a board whose author meant it.
	 */
	assert.equal(fitted?.w, 748, "and the width comes down to the content too");
	cleanup();
});

test("fit still grows a board its content has outgrown", async () => {
	const { tool, deck, extents, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1400, height: 900 });
	const board = deck.board("boards/plan.html");
	extents.set("boards/plan.html", { rev: board!.rev, w: 1300, h: 600 });

	await tool.run(`return await stage.fit("boards/plan.html", { margin: 0 })`);
	assert.equal(deck.board("boards/plan.html")?.w, 1300);
	assert.equal(deck.board("boards/plan.html")?.h, 600);
	cleanup();
});

/*
 * The ceiling is the same one `newBoard` applies: `min(viewport, 1600)`. A board wider than
 * the room the canvas has is read scaled down, so growing past it does not help — and the
 * note says so rather than leaving the agent to find the clipping later.
 */
test("fit will not grow a board past min(viewport, 1600), and says why", async () => {
	const { tool, deck, extents, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1400, height: 900 });
	const board = deck.board("boards/plan.html");
	extents.set("boards/plan.html", { rev: board!.rev, w: 1900, h: 600 });

	const result = await tool.run(`return await stage.fit("boards/plan.html", { margin: 0 })`);
	assert.equal(deck.board("boards/plan.html")?.w, 1400, "the viewport, not the content");
	assert.match(result.text, /narrow a component rather than widening the board/);
	cleanup();
});

test("with a wide screen the ceiling is 1600 rather than the screen", async () => {
	const { tool, deck, extents, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 2560, height: 1400 });
	const board = deck.board("boards/plan.html");
	extents.set("boards/plan.html", { rev: board!.rev, w: 1900, h: 600 });

	await tool.run(`return await stage.fit("boards/plan.html", { margin: 0 })`);
	assert.equal(deck.board("boards/plan.html")?.w, 1600);
	cleanup();
});

/*
 * A format is what the board *is as a file*, and the thing worth pinning is that asking for
 * one reaches the server — for a long time the only way to a markdown board or a deck was to
 * write the file by hand, because this call had no way to say which you wanted.
 */
test("a format reaches the service, and decides the file", async () => {
	const { tool, read, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1440, height: 900 });

	const deck = await tool.run(`return await stage.newBoard({ title: "The plan out loud", format: "slides" })`);
	assert.match(deck.text.split("\n")[0] ?? "", /boards\/the-plan-out-loud\.slides\.html/);
	assert.ok(read("boards/the-plan-out-loud.slides.html"), "and the file is the one the format names");

	const doc = await tool.run(`return await stage.newBoard({ title: "Notes", format: "flow" })`);
	assert.match(doc.text.split("\n")[0] ?? "", /boards\/notes\.md/);
	// And the width it was sized at is the *format's* default, not the blank shape's 1000.
	assert.match(doc.text, /board width 720/);
	assert.match(deck.text, /board width 960/, "a deck opens 1:1 with a slide's own layout");

	// Nothing said is a component board, which is what every board was before formats.
	const board = await tool.run(`return await stage.newBoard({ title: "Ordinary", kind: "answer" })`);
	assert.match(board.text.split("\n")[0] ?? "", /boards\/ordinary\.html/);
	cleanup();
});

test("an unknown format is refused by name rather than quietly becoming a board", async () => {
	const { tool, cleanup } = toolOn({ x: 0, y: 0, zoom: 1 });
	const result = await tool.run(`return await stage.newBoard({ title: "Talk", format: "reveal" })`);

	assert.equal(result.isError, true);
	// The words a caller reaches for — `reveal`, `markdown`, `deck` — are not formats, and a
	// silent fallback to component would write positioned boxes for a talk.
	assert.match(result.text, /Unknown format reveal/);
	assert.match(result.text, /component, flow, slides/);
	cleanup();
});

test("a shape asked for alongside a format that has none is said, not silently dropped", async () => {
	const { tool, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1440, height: 900 });
	const result = await tool.run(`return await stage.newBoard({ title: "Talk", format: "slides", kind: "report" })`);

	assert.equal(result.isError, false);
	// There is no report-flavoured slide deck; a deck is already the shape it is.
	assert.match(result.text, /a slides board has no template shape — report was ignored/);
	cleanup();
});
