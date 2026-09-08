import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoardMeta } from "../deck/meta.ts";
import { formatOf } from "../deck/kinds.ts";
import { BOARD_FORMATS, BOARD_TEMPLATES, boardWidth, extensionFor, isBoardFormat, isBoardTemplate, renderFormat, renderTemplate, slugFor, WIDE_BOARD_W } from "./templates.ts";

test("every kind renders a board the loader can read", () => {
	for (const kind of BOARD_TEMPLATES) {
		const html = renderTemplate(kind, "Why the second tab fails");
		const meta = readBoardMeta(html);
		assert.equal(meta.title, "Why the second tab fails", kind);
		assert.ok((meta.w ?? 0) >= 720, `${kind} has a width`);
		assert.ok((meta.h ?? 0) >= 400, `${kind} has a height`);
		// The two things every board must load, and the components the agent will edit.
		assert.match(html, /lib\/board\.css/, kind);
		assert.match(html, /lib\/board\.js/, kind);
		assert.match(html, /data-id="/, kind);
		assert.ok(!html.includes("{{"), `${kind} has no placeholders left`);
	}
});

test("a title is escaped, not injected", () => {
	const html = renderTemplate("answer", 'Tom & Jerry <script>alert("x")</script>');
	assert.ok(!html.includes("<script>alert"), "no injected element");
	assert.match(html, /Tom &amp; Jerry &lt;script&gt;/);
});

test("an explicit size wins over the shape's default", () => {
	const meta = readBoardMeta(renderTemplate("answer", "T", { w: 640, h: 480 }));
	assert.deepEqual([meta.w, meta.h], [640, 480]);
});

test("slugs are file names, and survive titles that are not English", () => {
	assert.equal(slugFor("Why the second tab fails", "answer"), "why-the-second-tab-fails");
	assert.equal(slugFor("  Spaces   and---dashes  ", "answer"), "spaces-and-dashes");
	assert.equal(slugFor("It's a plan!", "plan"), "its-a-plan");
	// The first board this app ever rendered had a Chinese title; letters are letters.
	assert.equal(slugFor("蓝翔技校 招生落地页", "design"), "蓝翔技校-招生落地页");
	// Nothing usable left: fall back to the shape rather than writing `.html`.
	assert.equal(slugFor("!!!", "report"), "report");
	assert.ok(slugFor("x".repeat(200), "answer").length <= 48);
});

test("a kind has to be one of the shapes", () => {
	assert.equal(isBoardTemplate("answer"), true);
	assert.equal(isBoardTemplate("slideshow"), false);
	assert.equal(isBoardTemplate(undefined), false);
});


/*
 * The two rules a board is written to, pinned where they are decided.
 *
 * Rule 1 is a *ceiling*: `min(viewport, 1600)`. Rule 2 is that the order of the file is the
 * order of the page — which is not a matter of taste but of whether an agent and a reader
 * can talk about the same board, since one of them has only the DOM and the other has only
 * the picture.
 */

/** Every positioned component, in the order the file puts them. */
function components(html: string): Array<{ id: string; left: number; top: number; width: number }> {
	return [...html.matchAll(/data-id="([^"]+)"[^>]*style="left: (\d+)px; top: (\d+)px; width: (\d+)px/g)].map((match) => ({
		id: match[1] as string,
		left: Number(match[2]),
		top: Number(match[3]),
		width: Number(match[4]),
	}));
}

/*
 * No shape's own width is above the width a board is worth keeping under.
 *
 * There is no cap any more — a caller who asks for 1800 gets 1800 — so this is the one
 * place the number still has teeth: the *defaults* are ours to choose, and choosing one
 * above the width we tell agents to stay under would be the guidance disagreeing with the
 * thing that implements it.
 */
test("no shape's own width is above the width we tell agents to aim under", () => {
	for (const kind of BOARD_TEMPLATES) {
		const meta = readBoardMeta(renderTemplate(kind, "T"));
		assert.ok((meta.w ?? 0) <= WIDE_BOARD_W, `${kind} is ${meta.w}, over ${WIDE_BOARD_W}`);
	}
});

test("a default width is the smaller of what the shape wants and the room on screen", () => {
	// A wide screen no longer caps anything of ours: the shape's own width is the answer,
	// and it is already under the width a board is worth keeping under.
	assert.equal(boardWidth(undefined, 1920, "report"), 1200);
	assert.equal(boardWidth(undefined, 3840, "report"), 1200, "and a very wide screen changes nothing");
	// 880 for a shape that is mostly one column — nearer the measure prose wants, and the
	// same reasoning that makes a `flow` board 720.
	assert.equal(boardWidth(undefined, 1920, "blank"), 880);
	assert.equal(boardWidth(undefined, 1920, "answer"), 880);
	// …and the two shapes that hold a comparison keep the room to hold it.
	assert.equal(boardWidth(undefined, 1920, "design"), 1000);
	// A screen narrower than the shape wins, which is the whole point of asking.
	assert.equal(boardWidth(undefined, 900, "report"), 900);
	assert.equal(boardWidth(undefined, 390, "report"), 390);
	// Nobody looking: the shape's own width, rather than a guess about the screen that would
	// be indistinguishable from a measurement at the point it got used.
	assert.equal(boardWidth(undefined, undefined, "report"), 1200);
	/*
	 * A number somebody typed is theirs, at any size. This used to be true of the ceiling as
	 * well and is now the whole rule: nothing here clamps, and 2400 is a board somebody meant.
	 */
	assert.equal(boardWidth(1800, 390, "report"), 1800);
	assert.equal(boardWidth(2400, 1440, "answer"), 2400);
});

test("every template reads top to bottom in the order the file is written", () => {
	for (const kind of BOARD_TEMPLATES) {
		for (const width of [1200, 1000, 390]) {
			const boxes = components(renderTemplate(kind, "T", { w: width }));
			assert.ok(boxes.length > 0, `${kind} has components`);
			for (let index = 1; index < boxes.length; index++) {
				const before = boxes[index - 1] as { id: string; left: number; top: number };
				const now = boxes[index] as { id: string; left: number; top: number };
				const order = now.top > before.top || (now.top === before.top && now.left > before.left);
				assert.ok(order, `${kind} at ${width}: ${now.id} comes after ${before.id} in the file but not on the page`);
			}
		}
	}
});

test("nothing sticks out of the board it was laid out for", () => {
	for (const kind of BOARD_TEMPLATES) {
		for (const width of [1200, 1000, 390]) {
			const html = renderTemplate(kind, "T", { w: width });
			const meta = readBoardMeta(html);
			for (const box of components(html)) {
				assert.ok(box.left + box.width <= (meta.w ?? 0), `${kind} at ${width}: ${box.id} runs past the right edge`);
			}
		}
	}
});

/*
 * A pair of columns at 130px each is a mistake with a rule through the middle, so below a
 * threshold the second card goes under the first. The file does not change to do it — which
 * is why the reading-order test above passes at 390 as well as at 1200.
 */
test("a pair folds into one column on a narrow board, and the board grows to hold it", () => {
	const wide = components(renderTemplate("plan", "T", { w: 1000 }));
	const narrow = components(renderTemplate("plan", "T", { w: 390 }));
	const beside = wide.find((box) => box.id === "approach");
	const under = narrow.find((box) => box.id === "approach");
	assert.ok((beside?.left ?? 0) > 48, "wide: the second card is beside the first");
	assert.equal(under?.left, 48, "narrow: it is under it");
	assert.ok(
		(readBoardMeta(renderTemplate("plan", "T", { w: 390 })).h ?? 0) > (readBoardMeta(renderTemplate("plan", "T", { w: 1000 })).h ?? 0),
		"and the board is taller for it, rather than clipping",
	);
});

/*
 * The formats, which are what a board *is as a file* — a different question from its shape.
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
		const source = format === "component" ? renderTemplate("blank", "Talk") : renderFormat(format, "Talk");
		assert.equal(formatOf(path, source), format, path);
	}
});

test("a format has to be one of the three", () => {
	assert.equal(isBoardFormat("slides"), true);
	assert.equal(isBoardFormat("component"), true);
	// The words a caller might reach for, none of which is a format.
	for (const no of ["reveal", "markdown", "md", "html", "deck", "", undefined, 3]) assert.equal(isBoardFormat(no), false, String(no));
});

test("a format's default width is the format's, not the blank shape's", () => {
	// The defect this fixes: `flow` asked for through the stage API got the blank *shape's*
	// 1000 — a wide measure for prose — while the same board from the `+` button got 720.
	assert.equal(boardWidth(undefined, 1440, "blank", "flow"), 720, "a readable measure");
	assert.equal(boardWidth(undefined, 1440, "blank", "slides"), 960, "1:1 with a slide's own layout");
	assert.equal(boardWidth(undefined, 1440, "report", "component"), 1200, "a component board still asks its shape");
	// The ceiling still wins, which is what makes a phone readable.
	assert.equal(boardWidth(undefined, 390, "blank", "slides"), 390);
	// And a width somebody typed is theirs, whatever the format.
	assert.equal(boardWidth(1400, 1440, "blank", "slides"), 1400);
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
	assert.ok((html.match(/<section>/g) ?? []).length >= 2, "more than one slide, or it does not demonstrate a deck");
	// Reveal's own notes element rather than the markdown plugin's `Note:`.
	assert.match(html, /<aside class="notes">/);
	// And the one thing reveal's markup cannot say for itself.
	assert.equal(readBoardMeta(html).aspect, "16:9");
	assert.equal(readBoardMeta(html).title, "The plan, out loud");
	assert.ok(!html.includes("{{"), "no placeholders left");
});

test("a new document is markdown, with a width it can declare", () => {
	const md = renderFormat("flow", "Notes on the refresh", { w: 820 });
	assert.match(md, /^---\ntitle: Notes on the refresh\nw: 820\n---\n/, md.slice(0, 80));
	assert.match(md, /^# Notes on the refresh$/m);
	assert.ok(!md.includes("{{"), "no placeholders left");
	// Markdown, so it must *not* be HTML-escaped: an entity would be shown literally.
	assert.match(renderFormat("flow", "Tom & Jerry"), /# Tom & Jerry/);
});

test("a deck's title is escaped, because a deck is HTML", () => {
	const html = renderFormat("slides", 'Tom & Jerry <script>alert("x")</script>');
	assert.ok(!html.includes("<script>alert"), "no injected element");
	assert.match(html, /Tom &amp; Jerry &lt;script&gt;/);
});
