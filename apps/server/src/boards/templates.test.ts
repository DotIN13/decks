import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoardMeta } from "../deck/meta.ts";
import { BOARD_TEMPLATES, boardWidth, isBoardTemplate, MAX_BOARD_W, renderTemplate, slugFor } from "./templates.ts";

test("every kind renders a board the loader can read", () => {
	for (const kind of BOARD_TEMPLATES) {
		const html = renderTemplate(kind, "Why the second tab fails");
		const meta = readBoardMeta(html);
		assert.equal(meta.title, "Why the second tab fails", kind);
		assert.ok((meta.w ?? 0) >= 800, `${kind} has a width`);
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

test("no shape's own width is above the ceiling", () => {
	for (const kind of BOARD_TEMPLATES) {
		const meta = readBoardMeta(renderTemplate(kind, "T"));
		assert.ok((meta.w ?? 0) <= MAX_BOARD_W, `${kind} is ${meta.w}, over ${MAX_BOARD_W}`);
	}
});

test("a width is the smallest of what the shape wants, the viewport, and the ceiling", () => {
	// A wide screen is still capped: past 1600 a line of prose is too long to track back to.
	assert.equal(boardWidth(undefined, 1920, "report"), 1200);
	assert.equal(boardWidth(undefined, 1920, "blank"), 1000);
	// A screen narrower than the shape wins, which is the whole point of asking.
	assert.equal(boardWidth(undefined, 900, "report"), 900);
	assert.equal(boardWidth(undefined, 390, "report"), 390);
	// Nobody looking: the ceiling, not a guess that would be indistinguishable from a measurement.
	assert.equal(boardWidth(undefined, undefined, "report"), 1200);
	// A number somebody typed is theirs, above the ceiling or not.
	assert.equal(boardWidth(1800, 390, "report"), 1800);
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
