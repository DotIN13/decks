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

test("a component with no style attribute gets one, at the end of its tag", () => {
	// After what is already there, not wedged between the tag name and the class: an
	// agent reads these files, and every component in one leads with `class` and
	// `data-id`.
	const plain = `<body class="board">\n\t<div class="text" data-id="t">Hi</div>\n</body>`;
	const { html } = applyPatches(plain, [{ op: "update", id: "t", style: { left: 8, top: 16 } }]);
	assert.match(html, /<div class="text" data-id="t" style="left: 8px; top: 16px">Hi<\/div>/);
});

test("an attribute added to a tag that spans lines lands at its end", () => {
	const wrapped = `<body class="board">\n\t<div class="embed" data-id="paper" data-embed="../a.pdf"\n\t\tstyle="left: 8px"></div>\n</body>`;
	const { html } = applyPatches(wrapped, [{ op: "update", id: "paper", attrs: { "data-pages": "2" } }]);
	assert.match(html, /style="left: 8px" data-pages="2"><\/div>/);
});

test("text is replaced as text, and escaped", () => {
	// The sticky's text is written on the tag's own line, so nothing is trimmed here and
	// a newline the user typed into a sticky would survive.
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

test("two inserts in one batch get two names", () => {
	// Dropping two files on a board at once is exactly this batch. Minting both names
	// against the file as it *arrived* gave them the same one, and the second insert
	// was then refused for a name the first had only just taken.
	const { html, ids } = applyPatches(
		BOARD,
		[
			{ op: "insert", kind: "embed", id: "", at: { left: 0, top: 0 }, embed: "../assets/a.png" },
			{ op: "insert", kind: "embed", id: "", at: { left: 32, top: 32 }, embed: "../assets/b.png" },
		],
		mintId,
	);
	assert.deepEqual(ids, ["embed-1", "embed-2"]);
	assert.ok(html.includes('data-id="embed-1"') && html.includes('data-id="embed-2"'));
});

test("an inserted embed names its file in the summary the agent is told", () => {
	const { summary } = applyPatches(
		BOARD,
		[{ op: "insert", kind: "embed", id: "", at: { left: 0, top: 0 }, embed: "../assets/dropped.png" }],
		mintId,
	);
	assert.deepEqual(summary, ["added embed #embed-1 showing ../assets/dropped.png"]);
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

test("a reordered component keeps its own indentation", () => {
	// Both directions, because they insert at different ends of the body and the first
	// version took the indent from the line it was moving *to*: one tab, against
	// siblings at two.
	const front = applyPatches(BOARD, [{ op: "order", id: "risk", to: "front" }]).html;
	assert.match(front, /\n\t\t<div class="sticky" data-id="risk" style="left: 480px; top: 48px">Refresh races<\/div>\n\t<\/body>/);
	const back = applyPatches(BOARD, [{ op: "order", id: "risk", to: "back" }]).html;
	assert.match(back, /<body class="board">\n\t\t<div class="sticky" data-id="risk"/);
	// Same components, same lines, different order: nothing was reformatted.
	assert.deepEqual([...front.split("\n")].sort(), [...BOARD.split("\n")].sort());
	assert.deepEqual([...back.split("\n")].sort(), [...BOARD.split("\n")].sort());
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

test("an arrow needs two ends, and they are ordinary attributes", () => {
	assert.throws(
		() => applyPatches(BOARD, [{ op: "insert", kind: "arrow", id: "a1", at: { left: 0, top: 0 } }]),
		/needs a from and a to/,
	);
	const { html } = applyPatches(BOARD, [
		{
			op: "insert",
			kind: "arrow",
			id: "a1",
			at: { left: 0, top: 0 },
			attrs: { "data-from": "goal", "data-to": "risk", "data-label": "leads to" },
		},
	]);
	// The ends first and in the order a person writes them, then the rest. They used
	// to arrive as one `"from>to"` string in the `embed` field.
	assert.match(html, /<svg class="link" data-id="a1" data-from="goal" data-to="risk" data-label="leads to"><\/svg>/);
	untouched(BOARD, html, "a1");
});

// --- retyping part of a component ------------------------------------------------

test("a path retypes a card's heading and leaves its paragraph alone", () => {
	const { html, summary } = applyPatches(BOARD, [{ op: "text", id: "goal", text: "Ship it", path: [0] }]);
	assert.match(html, /<h3>Ship it<\/h3>/);
	assert.match(html, /<p>Keep it short\.<\/p>/);
	assert.deepEqual(summary, ["retyped the <h3> in #goal"]);
	// Only the heading's line differs — the component's own tag is not rewritten.
	const differing = BOARD.split("\n").filter((line, index) => line !== html.split("\n")[index]);
	assert.deepEqual(differing, ["\t\t\t<h3>Goal</h3>"]);
});

test("retyping a paragraph written over several lines keeps its shape", () => {
	const board = `<body class="board">
	<section class="card" data-id="goal" style="left: 8px">
		<h3>Goal</h3>
		<p>
			A second tab that wakes up must not spend a token the first tab
			already spent.
		</p>
	</section>
</body>`;
	// The text arrives carrying the indentation the browser read back with it, which is
	// exactly what must not be written on top of the indentation already in the file.
	const { html } = applyPatches(board, [
		{ op: "text", id: "goal", text: "\n\t\t\tOne session, two tabs.\n\t\t", path: [1] },
	]);
	assert.equal(
		html,
		`<body class="board">
	<section class="card" data-id="goal" style="left: 8px">
		<h3>Goal</h3>
		<p>
			One session, two tabs.
		</p>
	</section>
</body>`,
	);
});

test("a path retypes the body of the same card", () => {
	const { html } = applyPatches(BOARD, [{ op: "text", id: "goal", text: "Two sentences now. Both short.", path: [1] }]);
	assert.match(html, /<p>Two sentences now\. Both short\.<\/p>/);
	assert.match(html, /<h3>Goal<\/h3>/);
});

test("a path that resolves to nothing is refused rather than guessed at", () => {
	// This is the markdown case: a `[data-md]` panel's headings exist only in the DOM
	// board.js rendered, so the indices the browser computed address nothing here.
	assert.throws(
		() => applyPatches(BOARD, [{ op: "text", id: "goal", text: "x", path: [4] }]),
		/cannot find that part of #goal/,
	);
	const md = `<body class="board">\n\t<div class="panel" data-id="notes" data-md>## Heading\n\ttext</div>\n</body>`;
	assert.throws(() => applyPatches(md, [{ op: "text", id: "notes", text: "x", path: [0] }]), /cannot find that part/);
});

test("a path onto markup is refused, like a component made of markup", () => {
	const nested = `<body class="board">\n\t<div class="callout" data-id="note"><p><strong>Careful.</strong> Read this.</p></div>\n</body>`;
	assert.throws(() => applyPatches(nested, [{ op: "text", id: "note", text: "flat", path: [0] }]), /contains markup/);
	// One level further in is a run of plain text, and that one goes through.
	const { html } = applyPatches(nested, [{ op: "text", id: "note", text: "Careful!", path: [0, 0] }]);
	assert.match(html, /<strong>Careful!<\/strong> Read this\./);
});

// --- appearance, as attributes ---------------------------------------------------

test("a tone is set as an attribute, and cleared by removing it", () => {
	const { html, summary } = applyPatches(BOARD, [{ op: "update", id: "risk", attrs: { "data-tone": "warn" } }]);
	assert.match(html, /<div class="sticky" data-id="risk" style="left: 480px; top: 48px" data-tone="warn">/);
	assert.deepEqual(summary, ['set data-tone="warn" on #risk']);

	const cleared = applyPatches(html, [{ op: "update", id: "risk", attrs: { "data-tone": null } }]);
	assert.deepEqual(cleared.summary, ["cleared data-tone on #risk"]);
	// Byte-identical to the board before the tone was ever set: the attribute takes
	// the space in front of it with it. `data-tone=""` would have looked the same on
	// screen and been a different file.
	assert.equal(cleared.html, BOARD);
});

test("clearing an attribute that is not there changes nothing", () => {
	const { html } = applyPatches(BOARD, [{ op: "update", id: "risk", attrs: { "data-tone": null } }]);
	assert.equal(html, BOARD);
});

test("a sticky becomes a callout by its class, and the agent is told which", () => {
	const { html, summary } = applyPatches(BOARD, [{ op: "update", id: "risk", class: "callout" }]);
	assert.match(html, /<div class="callout" data-id="risk"/);
	assert.deepEqual(summary, ["made #risk a callout"]);
	untouched(BOARD, html, "risk");
});

test("one update can move, restyle and set an attribute, and says so once", () => {
	const { html, summary } = applyPatches(BOARD, [
		{ op: "update", id: "risk", style: { left: 8 }, class: "callout", attrs: { "data-tone": "danger" } },
	]);
	assert.match(html, /<div class="callout" data-id="risk" style="left: 8px; top: 48px" data-tone="danger">/);
	assert.deepEqual(summary, ['moved #risk and made #risk a callout and set data-tone="danger" on #risk']);
});

// --- duplicate -------------------------------------------------------------------

test("a duplicate is a copy of the source bytes, offset, named after the original", () => {
	const { html, summary, ids } = applyPatches(BOARD, [{ op: "duplicate", id: "goal" }]);
	assert.deepEqual(summary, ["duplicated #goal as #goal-2"]);
	assert.deepEqual(ids, ["goal-2"]);
	// The markup inside it survives, which is the whole reason this is not an insert.
	assert.match(
		html,
		/<section class="card" data-id="goal-2" style="left: 64px; top: 64px; width: 380px; background: var\(--b-bg-deep\)">\n\t\t\t<h3>Goal<\/h3>\n\t\t\t<p>Keep it short\.<\/p>\n\t\t<\/section>\n\t<\/body>/,
	);
	// And the original is exactly as it was.
	assert.ok(html.includes(BOARD.split("\n").slice(8, 11).join("\n")));
});

test("a second duplicate does not reuse the first copy's name", () => {
	const once = applyPatches(BOARD, [{ op: "duplicate", id: "goal" }]).html;
	const { ids } = applyPatches(once, [{ op: "duplicate", id: "goal" }]);
	assert.deepEqual(ids, ["goal-3"]);
	const fromCopy = applyPatches(once, [{ op: "duplicate", id: "goal-2" }]);
	assert.deepEqual(fromCopy.ids, ["goal-3"], "the trailing number is a counter, not part of the name");
});

test("duplicating something with no position copies it as it is", () => {
	// A connector covers the whole board and has no left/top to offset.
	const { html, ids } = applyPatches(BOARD, [{ op: "duplicate", id: "goal-risk" }]);
	assert.deepEqual(ids, ["goal-risk-2"]);
	assert.match(html, /<svg class="link" data-id="goal-risk-2" data-from="goal" data-to="risk"><\/svg>/);
});

test("a duplicate can be offset by the caller", () => {
	const { html } = applyPatches(BOARD, [{ op: "duplicate", id: "risk", offset: { x: 0, y: 200 } }]);
	assert.match(html, /data-id="risk-2" style="left: 480px; top: 248px"/);
});

// --- rename ----------------------------------------------------------------------

test("a rename takes the connectors that named it with it", () => {
	const { html, summary, ids } = applyPatches(BOARD, [{ op: "rename", id: "risk", to: "refresh-race" }]);
	assert.deepEqual(summary, ["renamed #risk to #refresh-race (and 1 connector end)"]);
	assert.deepEqual(ids, ["refresh-race"]);
	assert.match(html, /<div class="sticky" data-id="refresh-race"/);
	assert.match(html, /data-from="goal" data-to="refresh-race"/);
	// An arrow pointing at a name nothing has is drawn as nothing, and the file still
	// looks right — so this is the one edit that must not be a single attribute write.
	assert.ok(!html.includes('"risk"'));
});

test("a rename refuses a name already taken, and one no board could use", () => {
	assert.throws(() => applyPatches(BOARD, [{ op: "rename", id: "risk", to: "goal" }]), /already a component called goal/);
	assert.throws(() => applyPatches(BOARD, [{ op: "rename", id: "risk", to: "a b" }]), /letters, digits and dashes/);
	assert.throws(() => applyPatches(BOARD, [{ op: "rename", id: "risk", to: "" }]), /letters, digits and dashes/);
});

test("renaming something to its own name is a no-op, not a collision", () => {
	const { html, summary } = applyPatches(BOARD, [{ op: "rename", id: "risk", to: "risk" }]);
	assert.equal(html, BOARD);
	assert.deepEqual(summary, ["#risk kept its name"]);
});

test("an insert can carry attributes, so a dropped PDF can arrive with its pages", () => {
	const { html } = applyPatches(BOARD, [
		{
			op: "insert",
			kind: "embed",
			id: "paper",
			at: { left: 40, top: 400, width: 420, height: 320 },
			embed: "../assets/oauth.pdf",
			attrs: { "data-pages": "3-5" },
		},
	]);
	assert.match(html, /<div class="embed" data-id="paper" data-embed="\.\.\/assets\/oauth\.pdf" data-pages="3-5" style="left: 40px/);
});

test("z-order to the back is first in the body", () => {
	const { html, summary } = applyPatches(BOARD, [{ op: "order", id: "risk", to: "back" }]);
	assert.ok(html.indexOf('data-id="risk"') < html.indexOf('data-id="goal"'), "risk now paints under goal");
	assert.deepEqual(summary, ["sent #risk to back"]);
	assert.match(html, /<body class="board">\n\t\t<div class="sticky" data-id="risk"/);
});

// --- the contract the board-authoring skill promises for an invented component ----

/*
 * The skill tells the agent to invent components, and makes it three promises in
 * exchange for following three rules: a box class beside its own keeps the class
 * switch, every string in its own leaf element stays retypeable, and a swap leaves
 * its custom token alone. This is the example printed in that skill, so if these
 * fail the documentation is wrong rather than the test.
 */
const INVENTED = `<body class="board">
	<section class="card phases" data-id="rollout" style="left: 48px; top: 168px; width: 420px">
		<h3>Rollout</h3>
		<div class="phase"><span class="when">week 1</span><span>Lock behind a flag</span></div>
		<div class="phase"><span class="when">week 2</span><span>Ramp to 10%</span></div>
	</section>
</body>
`;

test("every string in an invented component is its own leaf, so each one retypes", () => {
	// The heading, then the label and the text of the first row: [0], [1,0], [1,1].
	const heading = applyPatches(INVENTED, [{ op: "text", id: "rollout", text: "Plan", path: [0] }]);
	assert.match(heading.html, /<h3>Plan<\/h3>/);

	const when = applyPatches(INVENTED, [{ op: "text", id: "rollout", text: "week 3", path: [1, 0] }]);
	assert.match(when.html, /<span class="when">week 3<\/span><span>Lock behind a flag<\/span>/);

	const what = applyPatches(INVENTED, [{ op: "text", id: "rollout", text: "Ramp to 50%", path: [2, 1] }]);
	assert.match(what.html, /<span class="when">week 2<\/span><span>Ramp to 50%<\/span>/);
	assert.deepEqual(what.summary, ["retyped the <span> in #rollout"]);
});

test("the row wrapping two spans is markup, and says so rather than flattening them", () => {
	// Why the skill says one string per leaf: a `.phase` holding two spans is exactly
	// the shape a plain-text replacement would destroy.
	assert.throws(() => applyPatches(INVENTED, [{ op: "text", id: "rollout", text: "week 1 — flag", path: [1] }]), PatchRefused);
});

// --- data-edit: what the board says is the user's to retype ------------------------

const SEALED = `<body class="board">
	<section class="card metrics" data-id="throughput" style="left: 48px; top: 48px; width: 320px">
		<h3 data-edit>Throughput</h3>
		<span class="value" data-edit="false">2,455</span>
		<div class="note" data-edit="false"><span>recomputed on mount</span></div>
	</section>
</body>
`;

test("data-edit on a leaf changes nothing about how it retypes", () => {
	// It is a declaration and an affordance, not a mechanism: the heading was always
	// editable and still is, attribute or no attribute.
	const { html, summary } = applyPatches(SEALED, [{ op: "text", id: "throughput", text: "Requests", path: [0] }]);
	assert.match(html, /<h3 data-edit>Requests<\/h3>/);
	assert.deepEqual(summary, ["retyped the <h3> in #throughput"]);
});

test('data-edit="false" refuses the retype, and says why', () => {
	assert.throws(
		() => applyPatches(SEALED, [{ op: "text", id: "throughput", text: "9,001", path: [1] }]),
		(error) => error instanceof PatchRefused && /data-edit="false"/.test(error.message),
	);
});

test("a seal covers what is inside it, not just the element carrying it", () => {
	// `.note` is sealed and the span within it is a perfectly ordinary leaf — the whole
	// point of the attribute is that the subtree goes with it.
	assert.throws(() => applyPatches(SEALED, [{ op: "text", id: "throughput", text: "no", path: [2, 0] }]), PatchRefused);
});

test("a seal on the component seals every string in it", () => {
	const board = SEALED.replace('class="card metrics"', 'class="card metrics" data-edit="false"');
	assert.throws(() => applyPatches(board, [{ op: "text", id: "throughput", text: "Requests", path: [0] }]), PatchRefused);
	// And the component itself, addressed with no path at all.
	assert.throws(() => applyPatches(board, [{ op: "text", id: "throughput", text: "x" }]), PatchRefused);
});

test("only \"false\" seals — any other value is the opposite claim", () => {
	// Treating a truthy value as a seal would make the affordance turn editing off,
	// which is the one way this attribute could be actively harmful.
	for (const value of ["", "true", "yes", "Label"]) {
		const board = SEALED.replace("<h3 data-edit>", `<h3 data-edit="${value}">`);
		const { html } = applyPatches(board, [{ op: "text", id: "throughput", text: "Requests", path: [0] }]);
		assert.match(html, /Requests/, `data-edit="${value}" should not seal`);
	}
});

test("a seal does not stop the component being moved, restyled or renamed", () => {
	// It is about text. A sealed chart is still a box the user can put somewhere else.
	const board = SEALED.replace('class="card metrics"', 'class="card metrics" data-edit="false"');
	assert.match(applyPatches(board, [{ op: "update", id: "throughput", style: { left: 96 } }]).html, /left: 96px/);
	assert.match(applyPatches(board, [{ op: "rename", id: "throughput", to: "rate" }]).html, /data-id="rate"/);
});

test("a class swap on an invented component keeps the class it invented", () => {
	const { html } = applyPatches(INVENTED, [{ op: "update", id: "rollout", class: "panel phases" }]);
	assert.match(html, /<section class="panel phases" data-id="rollout"/);
	// And the CSS the agent wrote is keyed on `.phases`, which is why that must survive.
	assert.match(html, /class="phase"/);
});
