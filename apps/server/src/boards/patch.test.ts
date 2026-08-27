import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPatches, mintId, PatchRefused } from "./patch.ts";

/**
 * The contract these tests exist for: everything the patch did not name comes out
 * byte-identical. A drag that reformats the file is a drag the agent cannot read
 * back, and a diff nobody can review.
 */
const BOARD = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Plan</title>
		<meta name="board" content='{"w":1600,"h":1000,"bg":"grid"}' />
		<link rel="stylesheet" href="../lib/board.css" />
	</head>
	<body class="board">
		<section class="card" data-id="goal" style="left: 48px; top: 48px; width: 380px; background: var(--b-bg-deep)">
			<h3>Goal</h3>
			<p>Keep it short.</p>
		</section>
		<div class="sticky" data-id="risk" style="left: 480px; top: 48px">Refresh races</div>
		<svg class="link" data-id="goal-risk" data-from="goal" data-to="risk"></svg>
		<script src="../lib/board.js"></script>
	</body>
</html>
`;

/** Everything except the lines that mention `id` must be identical. */
function untouched(before: string, after: string, ...ids: string[]) {
	const strip = (text: string) =>
		text
			.split("\n")
			.filter((line) => !ids.some((id) => line.includes(`data-id="${id}"`)))
			.join("\n");
	assert.equal(strip(after), strip(before));
}

test("a drag rewrites the style attribute and nothing else", () => {
	const { html, summary } = applyPatches(BOARD, [{ op: "update", id: "risk", style: { left: 512, top: 96 } }]);
	assert.match(html, /data-id="risk" style="left: 512px; top: 96px"/);
	assert.deepEqual(summary, ["moved #risk"]);
	untouched(BOARD, html, "risk");
});

test("a resize keeps declarations the patch never mentioned", () => {
	const { html } = applyPatches(BOARD, [{ op: "update", id: "goal", style: { width: 420, height: 300 } }]);
	// left and top unchanged, background kept, and in the original order.
	assert.match(html, /style="left: 48px; top: 48px; width: 420px; background: var\(--b-bg-deep\); height: 300px"/);
	untouched(BOARD, html, "goal");
});

test("a component with no style attribute gets one, beside its tag name", () => {
	const plain = `<body class="board">\n\t<div class="text" data-id="t">Hi</div>\n</body>`;
	const { html } = applyPatches(plain, [{ op: "update", id: "t", style: { left: 8, top: 16 } }]);
	assert.match(html, /<div style="left: 8px; top: 16px" class="text" data-id="t">Hi<\/div>/);
});

test("text is replaced as text, and escaped", () => {
	const { html, summary } = applyPatches(BOARD, [{ op: "text", id: "risk", text: 'Races & <b>bugs</b>' }]);
	assert.match(html, /data-id="risk"[^>]*>Races &amp; &lt;b&gt;bugs&lt;\/b&gt;<\/div>/);
	assert.deepEqual(summary, ["retyped #risk"]);
	untouched(BOARD, html, "risk");
});

test("a component made of markup is refused rather than flattened", () => {
	assert.throws(
		() => applyPatches(BOARD, [{ op: "text", id: "goal", text: "just this" }]),
		(error: unknown) => {
			assert.ok(error instanceof PatchRefused);
			assert.match(error.message, /contains markup/);
			return true;
		},
	);
});

test("inserting puts a component before </body>, indented like its neighbours", () => {
	const { html, summary } = applyPatches(BOARD, [
		{ op: "insert", kind: "sticky", id: "sticky-1", at: { left: 40, top: 400, width: 220 }, text: "New" },
	]);
	assert.match(html, /\n\t\t<div class="sticky" data-id="sticky-1" style="left: 40px; top: 400px; width: 220px">New<\/div>\n\t<\/body>/);
	assert.deepEqual(summary, ["added sticky #sticky-1"]);
	untouched(BOARD, html, "sticky-1");
});

test("an insert cannot reuse an id", () => {
	assert.throws(
		() => applyPatches(BOARD, [{ op: "insert", kind: "sticky", id: "risk", at: { left: 0, top: 0 } }]),
		/already a component called risk/,
	);
});

test("removing takes the whitespace with it", () => {
	const { html, summary } = applyPatches(BOARD, [{ op: "remove", id: "risk" }]);
	assert.ok(!html.includes('data-id="risk"'));
	assert.ok(!html.includes("\n\t\t\n"), "no blank line left behind");
	assert.deepEqual(summary, ["removed #risk"]);
	untouched(BOARD, html, "risk");
});

test("z-order is document order, so to-front is last in the body", () => {
	const { html } = applyPatches(BOARD, [{ op: "order", id: "goal", to: "front" }]);
	const goal = html.indexOf('data-id="goal"');
	const risk = html.indexOf('data-id="risk"');
	assert.ok(goal > risk, "goal now paints over risk");
	assert.match(html, /<script src="\.\.\/lib\/board\.js"><\/script>/, "the script tag survives");
});

test("an unknown id is refused, with the id in the reason", () => {
	assert.throws(() => applyPatches(BOARD, [{ op: "update", id: "nope", style: { left: 1 } }]), /no component with data-id="nope"/);
});

test("several patches in one gesture apply in order", () => {
	const { html, ids } = applyPatches(BOARD, [
		{ op: "update", id: "risk", style: { left: 500 } },
		{ op: "text", id: "risk", text: "Two edits" },
	]);
	assert.match(html, /data-id="risk" style="left: 500px; top: 48px">Two edits</);
	assert.deepEqual(ids, ["risk", "risk"]);
});

test("minted ids are named after the thing and never collide", () => {
	assert.equal(mintId(BOARD, "sticky"), "sticky-1");
	const once = applyPatches(BOARD, [{ op: "insert", kind: "sticky", id: "sticky-1", at: { left: 0, top: 0 } }]).html;
	assert.equal(mintId(once, "sticky"), "sticky-2");
});

test("an arrow needs two ends", () => {
	assert.throws(
		() => applyPatches(BOARD, [{ op: "insert", kind: "arrow", id: "a1", at: { left: 0, top: 0 } }]),
		/needs a from and a to/,
	);
	const { html } = applyPatches(BOARD, [
		{ op: "insert", kind: "arrow", id: "a1", at: { left: 0, top: 0 }, embed: "goal>risk" },
	]);
	assert.match(html, /<svg class="link" data-id="a1" data-from="goal" data-to="risk"><\/svg>/);
});
