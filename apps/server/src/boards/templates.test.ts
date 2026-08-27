import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoardMeta } from "../deck/meta.ts";
import { BOARD_KINDS, isBoardKind, renderTemplate, slugFor } from "./templates.ts";

test("every kind renders a board the loader can read", () => {
	for (const kind of BOARD_KINDS) {
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
	assert.equal(isBoardKind("answer"), true);
	assert.equal(isBoardKind("slideshow"), false);
	assert.equal(isBoardKind(undefined), false);
});
