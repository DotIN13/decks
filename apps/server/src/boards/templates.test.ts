import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoardMeta } from "../deck/meta.ts";
import { formatOf, isOurs, shellFor } from "../deck/kinds.ts";
import { asBoardFormat, BOARD_FORMATS, boardWidth, extensionFor, isBoardFormat, renderBlank, renderSlides, slugFor, WIDE_BOARD_W } from "./templates.ts";

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
	assert.equal(meta.h, undefined, "and no height: a stated one is a floor, and a new board wants none");
	// The two things every board must load, and the block the agent will write in.
	assert.match(html, /lib\/board\.css/);
	assert.match(html, /lib\/board\.js/);
	assert.match(html, /data-id="doc"/);
	assert.ok(!html.includes("{{"), "no placeholders left");
});

/*
 * The layout model, in the one board every other board starts as.
 *
 * board.css puts every root-level block out of the page's flow, and `.doc` is the one that
 * covers the board: the origin, the full width, as tall as what is written in it. It states no
 * coordinates of its own, which is also what says it is not a box to be dragged — a block that
 * means to be placed states a `left` and a `top`, and that is the whole of the difference.
 */
test("the blank's one block states no coordinates, so it is the document rather than a box", () => {
	const html = renderBlank("T");
	const block = /<div class="doc"[^>]*>/.exec(html)?.[0] ?? "";
	assert.ok(block, "the blank has a document block");
	assert.ok(!/style=/.test(block), `a document block places nothing itself: ${block}`);
});

test("a new board is blank: the heading and nothing else", () => {
	// The whole of "no templates": a new board carries no card, no callout, no chart and no
	// example copy for the writer to keep. One block, holding the heading, and that is all.
	const html = renderBlank("T");
	const components = [...html.matchAll(/data-id="([^"]+)"/g)].map((match) => match[1]);
	assert.deepEqual(components, ["doc"], components.join(", "));
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
	// The width a board is asked for changes nothing about the map.
	assert.ok(importMapOf(renderBlank("Notes", { w: 820 })).imports.three);
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
	assert.equal(renderSlides("Talk").includes("importmap"), false);
});

test("a board's copy is plain, with no em dashes in it", () => {
	// The app has kept em dashes out of its own copy for a while, and a board is copy of the same
	// kind. The rendered document is what is checked, not the source file.
	const rendered = [renderBlank("T"), renderSlides("T")];
	for (const html of rendered) assert.equal(html.includes("—"), false, `an em dash reached ${html.slice(0, 40)}`);
});

test("a title is escaped, not injected", () => {
	const html = renderBlank('Tom & Jerry <script>alert("x")</script>');
	assert.ok(!html.includes("<script>alert"), "no injected element");
	assert.match(html, /Tom &amp; Jerry &lt;script&gt;/);
});

test("an explicit size wins over the blank's default", () => {
	const meta = readBoardMeta(renderBlank("T", { w: 640, h: 480 }));
	assert.deepEqual([meta.w, meta.h], [640, 480], "a height that was asked for is written, as a floor");
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
 * 1000 is about as wide as a board is read at, and it is now one number rather than two: the
 * 880 that a board of boxes defaulted to and the 1000 a document did were a distinction the
 * formats carried and nothing else did. A deck keeps 960 because it is laid out at that
 * logical width and opens 1:1 with its own layout.
 */
test("a default width is the format's own, or the screen when the screen is smaller", () => {
	// A wide screen has no ceiling of ours: the format's own width is the answer.
	assert.equal(boardWidth(undefined, 1920), 1000);
	assert.equal(boardWidth(undefined, 3840), 1000, "and a very wide screen changes nothing");
	assert.equal(boardWidth(undefined, 1920, "slides"), 960);
	// A screen narrower than the default wins, which is the whole point of asking.
	assert.equal(boardWidth(undefined, 390, "slides"), 390);
	// Nobody looking: the format's own width, rather than a guess about the screen.
	assert.equal(boardWidth(undefined, undefined), 1000);
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
		const w = boardWidth(undefined, 1920, format);
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
		assert.equal(formatOf(path), format, path);
	}
});

test("a format has to be one of the two", () => {
	assert.equal(isBoardFormat("slides"), true);
	assert.equal(isBoardFormat("board"), true);
	// The words a caller might reach for, none of which is a format.
	for (const no of ["reveal", "markdown", "md", "html", "deck", "answer", "", undefined, 3]) assert.equal(isBoardFormat(no), false, String(no));
});

/*
 * The two words that used to name the two board formats still answer, because they are in
 * every agent's notes, in old wire messages and in this deck's own history. Both are `board`:
 * a board of placed boxes and a document that reflows are one file, written two ways.
 */
test("component and flow are still understood, and both mean board", () => {
	assert.equal(asBoardFormat("component"), "board");
	assert.equal(asBoardFormat("flow"), "board");
	assert.equal(asBoardFormat("board"), "board");
	assert.equal(asBoardFormat("slides"), "slides");
	assert.equal(asBoardFormat("reveal"), undefined, "and a word that never named anything is still nothing");
	assert.equal(asBoardFormat(undefined), undefined);
});

test("a deck honours a width it was given, and declares it where a deck can", () => {
	assert.equal(readBoardMeta(renderSlides("T")).w, 960, "the format's own default");
	assert.equal(readBoardMeta(renderSlides("T", { w: 1280 })).w, 1280, "or what was asked for");
	// Which is what makes it reach the board: `readMeta` takes an HTML deck's size from this
	// tag, since reveal's markup has nowhere to put one.
	assert.equal(readBoardMeta(renderSlides("T", { w: 1280 })).aspect, "16:9", "and the aspect is still there beside it");
});

test("a new deck is reveal's own format, and this view's rules can read it", () => {
	const html = renderSlides("The plan, out loud");
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
 * A board is a single HTML file, and a document in its own right.
 *
 * It has to be, or the route would wrap it, and a document inside a document is the thing this
 * design removed. So the assertions are: the class that declares what it is, the primitives it
 * brings, a block for a comment or an edit to land on, and a width but no height.
 */
test("a new board is one HTML file that needs no wrapping", () => {
	const html = renderBlank("Notes on the refresh", { w: 820 });
	assert.match(html, /<body class="board">/);
	assert.match(html, /lib\/board\.css/, "the primitives, and the rule that places a root-level block");
	assert.match(html, /lib\/board\.js/);
	assert.match(html, /<div class="doc" data-id="doc"/, "a block with an id, so a comment has something to land on");
	assert.ok(!html.includes("{{"), "no placeholders left");

	const meta = readBoardMeta(html);
	assert.equal(meta.w, 820, "the width it was asked for");
	assert.equal(meta.h, undefined, "and no height: the content's is the answer until somebody says otherwise");
	assert.equal(meta.title, "Notes on the refresh");

	// And it is blank: the title and an empty block, no example copy.
	assert.ok(!html.includes("<p>"), "nothing but the heading in a fresh board");
	assert.match(renderBlank("Tom & Jerry"), /Tom &amp; Jerry/, "the title is escaped, because this is HTML");
});

test("a new board is read back as a board, and is not wrapped in a shell", () => {
	const html = renderBlank("Notes");
	assert.equal(formatOf("boards/notes.html"), "board");
	assert.equal(shellFor("boards/notes.html", html), undefined, "it is already a document");
	assert.equal(isOurs(html), true);
	// The boards written before the two formats became one are still ours, which is the
	// regression that would matter most: every board in the author's own deck is one.
	assert.equal(isOurs('<body class="board flow">'), true);
});

test("a deck's title is escaped, because a deck is HTML", () => {
	const html = renderSlides('Tom & Jerry <script>alert("x")</script>');
	assert.ok(!html.includes("<script>alert"), "no injected element");
	assert.match(html, /Tom &amp; Jerry &lt;script&gt;/);
});