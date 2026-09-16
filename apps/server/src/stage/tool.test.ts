import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Camera } from "@decks/protocol";
import { runtimeDir } from "@decks/runtime";
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
		{ id: "a1", name: "Ada", state: "idle" as const, kind: "claude" as const, context: ["boards/plan.html"], holding: 1, tags: ["panel-css"], workspace: "political-llm", queued: 3 },
		{ id: "a2", name: "Rune", state: "idle" as const, kind: "claude" as const, context: ["boards/plan.html", "boards/notes.html"], holding: 2, tags: [], workspace: "political-llm", queued: 0 },
		{ id: "a3", name: "Iris", state: "idle" as const, kind: "claude" as const, context: ["boards/notes.html"], holding: 1, tags: [], queued: 0 },
	];
	const waiting: QueuedWork[] = [];
	/** The workspace the fake session is in, so `me.setWorkspace` → `me.get` is one round trip. */
	let room: string | undefined;
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
		place: () => undefined, broadcast: () => {},
		camera: () => camera,
		agents: () => others,
	});

	const tool = createStageTool({
		stage: service,
		port: 4329,
		agent: {
			id: "a1",
			identity: () => ({ name: "Ada", color: "#000", ...(room ? { workspace: room } : {}) }),
			context: () => [],
			setContext: () => {},
			inPlay: () => [],
			setInPlay: () => {},
			rename: () => {},
			setAvatar: () => {},
			setTags: (tags) => tags as string[],
			setWorkspace: (workspace) => {
				room = typeof workspace === "string" && workspace ? workspace : undefined;
				return room ?? null;
			},
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
		service,
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
	// The *advice* is still said, because it still applies: a board nobody is looking at is
	// still a board somebody will read.
	assert.match(result.text, /keep a board under 1200/);
	assert.equal((await tool.run(`return (await stage.viewport()) ?? "none"`)).text, `"none"`);
	cleanup();
});

/*
 * What a *default* width comes out as, at both ends of the screen — and that a width somebody
 * asked for survives at any size.
 *
 * There is no cap here any more. It used to be `min(viewport, 1600)`, applied rather than
 * suggested; the 1600 is gone entirely and the viewport is now a *default* being fitted to
 * the screen rather than a limit being enforced. So what is asserted is the shape of the
 * default and the fact that an explicit width is never touched.
 */
test("a default width is the shape's own, or the screen when the screen is smaller", async () => {
	/** The width the file was written with — the only place a board's size lives. */
	const widthOf = (text: string) => Number(/"w":(\d+)/.exec(text)?.[1]);

	const wide = toolOn({ x: 0, y: 0, zoom: 1, width: 1920, height: 1080 });
	const onWide = await wide.tool.run(`return await stage.newBoard({ title: "Wide", kind: "report" })`);
	assert.equal(widthOf(wide.read("boards/wide.html")), 1200, "the shape's own width, on a screen with room to spare");
	assert.match(onWide.text, /board width 1200/);
	wide.cleanup();

	const phone = toolOn({ x: 0, y: 0, zoom: 1, width: 390, height: 844 });
	const onPhone = await phone.tool.run(`return await stage.newBoard({ title: "Phone", kind: "report" })`);
	assert.equal(widthOf(phone.read("boards/phone.html")), 390, "the screen, when the screen is smaller");
	assert.match(onPhone.text, /board width 390 — keep a board under 1200/);
	phone.cleanup();

	// A huge screen is not an invitation: the shape's own width is still the answer.
	const huge = toolOn({ x: 0, y: 0, zoom: 1, width: 3840, height: 2160 });
	await huge.tool.run(`return await stage.newBoard({ title: "Huge", kind: "report" })`);
	assert.equal(widthOf(huge.read("boards/huge.html")), 1200);
	huge.cleanup();

	/*
	 * And a width somebody typed is theirs at any size — which is the whole of the rule now.
	 * 1800 used to be silently narrowed to 1600 on a wide screen and to the screen on a
	 * narrow one; a caller who means 1800 has a reason that cannot be seen from in there.
	 */
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
	// And the workspace, which is the same argument one level up: "who else is on this" should
	// not need a second call for a fact the first one already had in hand.
	assert.equal(seen[0]?.workspace, "political-llm");
	assert.equal(seen[2]?.workspace, undefined, "an agent in none says so by saying nothing");
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
		place: () => undefined, broadcast: () => {},
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
			setWorkspace: () => null,
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

test("fit takes the height from the content and leaves the width alone", async () => {
	const { tool, deck, extents, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1400, height: 900 });
	const board = deck.board("boards/plan.html");
	assert.equal(board?.w, 1600, "a board that says nothing about itself gets the ceiling");
	extents.set("boards/plan.html", { rev: board!.rev, w: 700, h: 1400 });

	await tool.run(`return await stage.fit("boards/plan.html")`);
	const fitted = deck.board("boards/plan.html");
	assert.equal(fitted?.h, 1448, "the content, plus the margin its components start at");
	/*
	 * The change this test exists for. `fit` used to take the width too, in two passes, which made
	 * it the one call that could reflow a document to a number it measured for a moment — and on a
	 * flow board, whose `.doc` is `width: 100%` of the frame, the width it read back was the frame's
	 * own, so every fit grew the board by the margin.
	 */
	assert.equal(fitted?.w, 1600, "and the width is exactly what the file said");
	cleanup();
});

test("fit still grows the height past a board its content has outgrown", async () => {
	const { tool, deck, extents, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1400, height: 900 });
	const board = deck.board("boards/plan.html");
	extents.set("boards/plan.html", { rev: board!.rev, w: 1300, h: 600 });

	await tool.run(`return await stage.fit("boards/plan.html", { margin: 0 })`);
	assert.equal(deck.board("boards/plan.html")?.w, 1600, "the width is not what grew");
	assert.equal(deck.board("boards/plan.html")?.h, 600);
	cleanup();
});

/*
 * And a wide board stays wide: the width is the author's, and a fit is not the place to disagree
 * with it silently. Nothing is said about it either — a note on every fit of a wide board is a
 * note nobody reads, and narrowing is `stage.resize`'s job.
 */
test("a fit of a wide board leaves it wide and says nothing about width", async () => {
	const { tool, deck, extents, cleanup } = toolOn({ x: 0, y: 0, zoom: 1, width: 1400, height: 900 });
	const board = deck.board("boards/plan.html");
	extents.set("boards/plan.html", { rev: board!.rev, w: 1900, h: 600 });

	const result = await tool.run(`return await stage.fit("boards/plan.html", { margin: 0 })`);
	assert.equal(deck.board("boards/plan.html")?.w, 1600, "the width the file has, not the content's");
	assert.equal(deck.board("boards/plan.html")?.h, 600);
	assert.equal(/came out \d+ wide/.test(result.text), false, result.text);
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

/*
 * `stage.web`: the user's shared Chrome, through the one object the server holds for it.
 *
 * What is tested is the wording again — the sentence an agent gets on a server with no shared
 * browser, and that the calls reach the host — because the real thing (`web/bridge.test.ts`)
 * runs against a Chromium and this is the tool's own contract with it.
 */
test("stage.web says so when this server has no shared browser, and reaches the host when it has", async () => {
	const { tool, service, cleanup } = toolOn({ x: 0, y: 0, zoom: 1 });
	const without = await tool.run(`return await stage.web.status()`);
	assert.equal(without.isError, true);
	assert.match(without.text, /This server has no shared browser/);

	const calls: string[] = [];
	const status = { paired: true, connected: true, tab: { title: "Sign up", url: "https://x.example/join" }, tabs: [], actions: [] };
	service.web = {
		code: () => "code-1234",
		repair: () => "code-5678",
		status: () => status,
		stop: () => void calls.push("stop"),
		open: async (url) => (calls.push(`open ${url}`), { url, title: "Sign up" }),
		read: async () => ({ url: "https://x.example/join", title: "Sign up", snapshot: "- textbox \"Email\"" }),
		screenshot: async () => ({ file: "/tmp/shot.png", width: 800, height: 600, png: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }),
		fill: async (field, text) => (calls.push(`fill ${name(field)}=${text}`), { field: name(field) }),
		select: async (field, option) => ({ field: name(field), option }),
		click: async (what) => (calls.push(`click ${name(what)}`), { clicked: name(what) }),
		press: async (key) => ({ pressed: key }),
		submit: async (what) => (calls.push(`submit ${what === undefined ? "Enter" : name(what)}`), { submitted: what === undefined ? "Enter" : name(what), allowed: true }),
		board: () => "boards/your-chrome.html",
	};
	const pairing = await tool.run(`return await stage.web.pairing()`);
	assert.equal(pairing.isError, false);
	assert.match(pairing.text, /"code": "code-1234"/);
	assert.match(pairing.text, /Decks extension/);

	const drove = await tool.run(`
		await stage.web.open("https://x.example/join");
		await stage.web.fill("Email", "ada@example.org");
		await stage.web.click("Next");
		const page = await stage.web.read();
		const done = await stage.web.submit("Create account");
		return { page: page.snapshot, done, board: await stage.web.board() };
	`);
	assert.equal(drove.isError, false, drove.text);
	assert.deepEqual(calls, ["open https://x.example/join", "fill Email=ada@example.org", "click Next", "submit Create account"]);
	assert.match(drove.text, /textbox \\"Email\\"/);
	assert.match(drove.text, /"allowed": true/);
	assert.match(drove.text, /boards\/your-chrome\.html/);

	// A screenshot is handed back as an image block beside the text, and the text names the file.
	const looked = await tool.run(`return await stage.web.screenshot()`);
	assert.equal(looked.isError, false, looked.text);
	assert.match(looked.text, /"file": "\/tmp\/shot.png"/);
	assert.deepEqual(looked.images, [{ data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"), mimeType: "image/png" }]);
	// …and only on the run that took one.
	assert.equal((await tool.run(`return 1`)).images, undefined);

	const empty = await tool.run(`return await stage.web.fill("", "x")`);
	assert.equal(empty.isError, true);
	assert.match(empty.text, /fill needs the field's label/);

	// A target may also be a reference from `read`, or a name with a position.
	const byRef = await tool.run(`
		await stage.web.fill({ ref: "e42" }, "no label on this one");
		await stage.web.click({ name: "Degree", nth: 2 });
		return true;
	`);
	assert.equal(byRef.isError, false, byRef.text);
	assert.deepEqual(calls.slice(-2), ["fill e42=no label on this one", "click Degree (2)"]);
	const nonsense = await tool.run(`return await stage.web.click({ nth: 2 })`);
	assert.equal(nonsense.isError, true);
	assert.match(nonsense.text, /click needs the button's or link's name/);
	cleanup();
});

/** A target as the log should name it: the string, the reference, or the name and position. */
function name(target: string | { ref: string } | { name: string; nth?: number }): string {
	if (typeof target === "string") return target;
	if ("ref" in target) return target.ref;
	return target.nth === undefined ? target.name : `${target.name} (${target.nth})`;
}

/**
 * The description four runtimes show to a model is one file.
 *
 * The tool is registered with a different adapter on every runtime — a Pi extension, an
 * in-process MCP server for Claude, a loader in opencode's Bun, a JSON-RPC server for
 * antigravity — so the *words* cannot be a string in one module that the others import.
 * They live in `runtime/tool-description.txt` and all four read it.
 *
 * The failure this pins down is not hypothetical: opencode's loader and antigravity's MCP
 * server each carried their own shortened copy, under a comment saying they were "in the
 * same words", and the model on those runtimes was told something different about what a
 * board is for.
 */
test("the description is the file, and nothing carries its own copy", async () => {
	const { tool } = toolOn({ x: 0, y: 0, zoom: 1 });
	const file = readFileSync(join(runtimeDir(), "tool-description.txt"), "utf8").trim();
	assert.equal(tool.description, file);
	assert.ok(file.length > 500, "the description is the agent's main briefing; a stub means the file was emptied");

	// And no runtime may grow a second copy again: a sentence from the description
	// hardcoded anywhere under `runtime/` is that drift coming back.
	const marker = "Boards are how you answer";
	for (const script of ["runtime/opencode/tools/stage_eval.ts", "runtime/antigravity/mcp-server.mjs"]) {
		const source = readFileSync(join(runtimeDir(), "..", script), "utf8");
		assert.ok(!source.includes(marker), `${script} has its own copy of the description`);
	}
});

test("stage.workspaces() is who is on what, and what they are working from", async () => {
	const { tool, cleanup } = toolOn({ x: 0, y: 0, zoom: 1 });
	const rooms = JSON.parse((await tool.run(`return await stage.workspaces()`)).text) as Array<Record<string, unknown>>;

	// One workspace, because only Ada and Rune have one — and the agent asking is `a1`.
	assert.equal(rooms.length, 1);
	assert.equal(rooms[0]?.name, "political-llm");
	assert.deepEqual((rooms[0]?.agents as Array<{ name: string }>).map((one) => one.name), ["Ada", "Rune"]);
	/*
	 * The boards, most members first: `plan` is held by both and `notes` by one. That order is
	 * the whole point of asking about a group rather than about an agent — the first entry is
	 * the board everybody there is working from, so an agent joining does not have to be told.
	 */
	assert.deepEqual(rooms[0]?.boards, ["boards/plan.html", "boards/notes.html"]);
	cleanup();
});

test("stage.me.setWorkspace hands the value to the session, and reports what came back", async () => {
	const { tool, cleanup } = toolOn({ x: 0, y: 0, zoom: 1 });
	/*
	 * The tool does not clean it. `session.setWorkspace` is the one place that slugs a
	 * workspace, so that one an agent declares and one you type are the same word — and the
	 * *return* is the point of the call: it is how a model finds out that the sentence it sent
	 * became `political-llm`, and therefore how two agents land in one group rather than two.
	 */
	assert.equal((await tool.run(`return await stage.me.setWorkspace("political-llm")`)).text, `"political-llm"`);
	assert.equal((await tool.run(`return (await stage.me.get()).workspace`)).text, `"political-llm"`, "and it is on the identity");
	assert.equal((await tool.run(`return await stage.me.setWorkspace(null)`)).text, "null", "`null` leaves the workspace");
	// Leaving it is an absence, and an absence has nothing to print — the tool's own sentence
	// for a run that returned nothing, rather than the word `undefined` dressed up as JSON.
	assert.equal((await tool.run(`return (await stage.me.get()).workspace`)).text, "(done)");
	cleanup();
});
