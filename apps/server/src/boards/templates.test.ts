import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoardMeta } from "../deck/meta.ts";
import { formatOf, isComponentBoard, shellFor } from "../deck/kinds.ts";
import { BOARD_FORMATS, boardWidth, extensionFor, isBoardFormat, renderBlank, renderFormat, slugFor, WIDE_BOARD_W } from "./templates.ts";

/*
 * The one decision left in creating a board: nothing is shaped any more.
 *
 * There are no templates — every board the app creates is blank on purpose, heading only,
 * and what it becomes is the writer's. What an agent models a board on is the *examples*
 * in `examples/` (see `lib-sync.ts` and the AGENTS context), which is a different thing
 * from being created from one. These tests pin the blank: that it renders, that it is
 * truly empty, and that the formats it can be asked for as still work.
 */

test("a new board is blank, and the loader can read it", () => {
	const html = renderBlank("Why the second tab fails");
	const meta = readBoardMeta(html);
	assert.equal(meta.title, "Why the second tab fails");
	assert.ok((meta.w ?? 0) >= 720, "has a width");
	assert.ok((meta.h ?? 0) >= 400, "has a height");
	// The two things every board must load, and the component the agent will edit.
	assert.match(html, /lib\/board\.css/);
	assert.match(html, /lib\/board\.js/);
	assert.match(html, /data-id="heading"/);
	assert.ok(!html.includes("{{"), "no placeholders left");
});

test("a new board is blank: the heading and nothing else", () => {
	// The whole of "no templates": a new board carries no card, no callout, no chart and no
	// example copy for the writer to keep. One component, the heading, and that is all.
	const html = renderBlank("T");
	const components = [...html.matchAll(/data-id="([^"]+)"/g)].map((match) => match[1]);
	assert.deepEqual(components, ["heading"], components.join(", "));
	for (const no of ['class="card"', 'class="callout"', 'class="kpi"', 'class="table"', 'id="chart"', "Example data"]) {
		assert.ok(!html.includes(no), `a blank board has no ${no}`);
	}
});

/**
 * The import map a new board carries, parsed.
 *
 * Extracted rather than imported from `templates.ts`, deliberately: what matters is the document a
 * browser is handed, and a test that read the constant would pass with a broken substitution.
 */
const importMapOf = (html: string): { imports: Record<string, string> } => {
	const match = /<script type="importmap">\s*([\s\S]*?)\s*<\/script>/.exec(html);
	assert.ok(match, "the board carries an import map");
	assert.equal((html.match(/type="importmap"/g) ?? []).length, 1, "exactly one, because a second is ignored");
	return JSON.parse(match[1]!) as { imports: Record<string, string> };
};

test("a new board's head names the libraries it may import, pinned over https", () => {
	const { imports } = importMapOf(renderBlank("T"));
	for (const name of ["d3", "three", "three/addons/", "gsap", "chart.js"]) {
		assert.ok(imports[name], `can import ${name}`);
		assert.match(imports[name]!, /^https:\/\//, `${name} is a URL a browser can fetch`);
		assert.equal(imports[name]!.includes("@latest"), false, `${name} is pinned to a version`);
	}
	// And the same map on a flow document, which is a board too.
	assert.ok(importMapOf(renderFormat("flow", "Notes")).imports.three);
});

test("three and its addons resolve to the same build", () => {
	const { imports } = importMapOf(renderBlank("T"));
	const version = (url: string) => /three@([\d.]+)/.exec(url)?.[1];
	assert.ok(version(imports.three!), "three names a version");
	// Two builds of three in one page is a scene where an object from one is not an object from
	// the other, and the failure reads as "my code does nothing".
	assert.equal(version(imports["three/addons/"]!), version(imports.three!));
});

test("a slide deck carries no map, because nothing in it could run one", () => {
	// A deck's sections are rendered by the shell rather than executed — a `<script>` inside one is
	// text — so a map there would be a promise the format cannot keep.
	assert.equal(renderFormat("slides", "Talk").includes("importmap"), false);
});

test("a board's copy is plain, with no em dashes in it", () => {
	// The app has kept em dashes out of its own copy for a while, and a board is copy of the same
	// kind. The rendered document is what is checked, not the source file.
	const rendered = [renderBlank("T"), renderFormat("flow", "T"), renderFormat("slides", "T")];
	for (const html of rendered) assert.equal(html.includes("—"), false, `an em dash reached ${html.slice(0, 40)}`);
});

test("a title is escaped, not injected", () => {
	const html = renderBlank('Tom & Jerry <script>alert("x")</script>');
	assert.ok(!html.includes("<script>alert"), "no injected element");
	assert.match(html, /Tom &amp; Jerry &lt;script&gt;/);
});

test("an explicit size wins over the blank's default", () => {
	const meta = readBoardMeta(renderBlank("T", { w: 640, h: 480 }));
	assert.deepEqual([meta.w, meta.h], [640, 480]);
});

test("slugs are file names, and survive titles that are not English", () => {
	assert.equal(slugFor("Why the second tab fails"), "why-the-second-tab-fails");
	assert.equal(slugFor("  Spaces   and---dashes  "), "spaces-and-dashes");
	assert.equal(slugFor("It's a plan!"), "its-a-plan");
	// The first board this app ever rendered had a Chinese title; letters are letters.
	assert.equal(slugFor("蓝翔技校 招生落地页"), "蓝翔技校-招生落地页");
	// Nothing usable left: fall back to the word for what is being made, not `.html`.
	assert.equal(slugFor("!!!"), "board");
	assert.equal(slugFor("!!!", "mirror"), "mirror");
	assert.ok(slugFor("x".repeat(200)).length <= 48);
});

/*
 * The widths a board may actually be, since the shape no longer gets a say.
 *
 * The blank's 880 is the measure prose actually wants (the same reasoning that makes a flow
 * board 720): a component board has no pair of columns to hold, so 1000 and 1200 — which
 * existed to give a comparison room to be compared — have nothing left to decide. A deck
 * keeps 960 because it is laid out at that logical width and opens 1:1 with its own layout.
 */
test("a default width is the format's own, or the screen when the screen is smaller", () => {
	// A wide screen has no ceiling of ours: the format's own width is the answer.
	assert.equal(boardWidth(undefined, 1920), 880);
	assert.equal(boardWidth(undefined, 3840), 880, "and a very wide screen changes nothing");
	// The other two formats keep their own measures.
	assert.equal(boardWidth(undefined, 1920, "flow"), 720);
	assert.equal(boardWidth(undefined, 1920, "slides"), 960);
	// A screen narrower than the default wins, which is the whole point of asking.
	assert.equal(boardWidth(undefined, 390, "slides"), 390);
	// Nobody looking: the format's own width, rather than a guess about the screen.
	assert.equal(boardWidth(undefined, undefined), 880);
	/*
	 * A number somebody typed is theirs, at any size. This used to be true of the ceiling as
	 * well and is now the whole rule: nothing here clamps, and 2400 is a board somebody meant.
	 */
	assert.equal(boardWidth(1800, 390), 1800);
	assert.equal(boardWidth(2400, 1440), 2400);
});

test("no default is above the width we tell agents to aim under", () => {
	// The defaults are the one place the guidance still has teeth — a caller who means wider
	// means it, but a default above the number in the tool's own note would be the guidance
	// disagreeing with the thing that implements it.
	for (const format of BOARD_FORMATS) {
		const w = boardWidth(undefined, 1920, format as "component" | "flow" | "slides");
		assert.ok(w <= WIDE_BOARD_W, `${format} defaults to ${w}, over ${WIDE_BOARD_W}`);
	}
});

/*
 * The formats, which are what a board *is as a file*.
 *
 * The invariant worth a test: **the extension a format is written with must be the extension
 * that format is read back from.** `deck/kinds.ts` decides a board's format from its
 * filename, so if these two ever disagree, a board asked for as a deck is silently a
 * markdown document and nothing anywhere says why. Asserted by round-tripping rather than by
 * comparing two tables, because two tables are the thing that drifts.
 */
test("a format's extension is the extension that format is read back from", () => {
	for (const format of BOARD_FORMATS) {
		const path = `boards/talk${extensionFor(format)}`;
		const source = format === "component" ? renderBlank("Talk") : renderFormat(format, "Talk");
		assert.equal(formatOf(path, source), format, path);
	}
});

test("a format has to be one of the three", () => {
	assert.equal(isBoardFormat("slides"), true);
	assert.equal(isBoardFormat("component"), true);
	// The words a caller might reach for, none of which is a format.
	for (const no of ["reveal", "markdown", "md", "html", "deck", "answer", "", undefined, 3]) assert.equal(isBoardFormat(no), false, String(no));
});

test("a deck honours a width it was given, and declares it where a deck can", () => {
	assert.equal(readBoardMeta(renderFormat("slides", "T")).w, 960, "the format's own default");
	assert.equal(readBoardMeta(renderFormat("slides", "T", { w: 1280 })).w, 1280, "or what was asked for");
	// Which is what makes it reach the board: `readFlowMeta` takes an HTML deck's size from
	// this tag, since reveal's markup has nowhere to put one.
	assert.equal(readBoardMeta(renderFormat("slides", "T", { w: 1280 })).aspect, "16:9", "and the aspect is still there beside it");
});

test("a new deck is reveal's own format, and this view's rules can read it", () => {
	const html = renderFormat("slides", "The plan, out loud");
	// Reveal's structure, which is what makes the file portable: it opens in reveal unchanged.
	assert.match(html, /<body class="reveal">/);
	assert.match(html, /<div class="slides">/);
	// One slide, and it is the title: a new deck is blank, exactly as a new board is.
	assert.equal((html.match(/<section>/g) ?? []).length, 1, "one blank slide, no example deck to edit");
	assert.equal(readBoardMeta(html).aspect, "16:9");
	assert.equal(readBoardMeta(html).title, "The plan, out loud");
	assert.ok(!html.includes("{{"), "no placeholders left");
});

/*
 * A flow board is a single HTML file now, not markdown — every board this app writes is.
 *
 * Which is only true if the file is a *document*: it has to carry the primitives itself, or
 * the route would have to wrap it, and a document inside a document is the thing this change
 * removed. So the assertions are: the two classes that declare what it is, the primitives,
 * one component for the editor to land on, and no stored height.
 */
test("a new document is one HTML file, and a document in its own right", () => {
	const html = renderFormat("flow", "Notes on the refresh", { w: 820 });
	assert.match(html, /<body class="board flow">/, "`board` for the primitives, `flow` for the reflow");
	assert.match(html, /lib\/board\.css/);
	assert.match(html, /lib\/board\.js/);
	assert.match(html, /class="doc" data-id="body"/, "one component, so a double-click has something to land on");
	assert.ok(!html.includes("{{"), "no placeholders left");

	const meta = readBoardMeta(html);
	assert.equal(meta.w, 820, "the width it was asked for");
	assert.equal(meta.h, undefined, "and no height: a flow board's is measured, never stored");
	assert.equal(meta.title, "Notes on the refresh");

	// And it is blank too: the title and an empty section, no example copy.
	assert.ok(!html.includes("<p>"), "nothing but the heading in a fresh document");

	// HTML now, so the title is escaped — it was left raw while this was markdown, where an
	// entity is shown literally rather than decoded.
	assert.match(renderFormat("flow", "Tom & Jerry"), /Tom &amp; Jerry/);
});

test("a flow board is read back as flow, and is not wrapped in a shell", () => {
	const html = renderFormat("flow", "Notes");
	assert.equal(formatOf("boards/notes.html", html), "flow", "the body class decides, not the extension");
	assert.equal(shellFor("boards/notes.html", html), undefined, "it is already a document");
	// And it is not handed the component editor, which is what the narrower class is for.
	assert.equal(isComponentBoard(html), false);
	// A component board is still a component board, which is the regression that would
	// matter most: every board in the author's own deck is one.
	assert.equal(formatOf("boards/plan.html", renderBlank("T")), "component");
});

test("a deck's title is escaped, because a deck is HTML", () => {
	const html = renderFormat("slides", 'Tom & Jerry <script>alert("x")</script>');
	assert.ok(!html.includes("<script>alert"), "no injected element");
	assert.match(html, /Tom &amp; Jerry &lt;script&gt;/);
});