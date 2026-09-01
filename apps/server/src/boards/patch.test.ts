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
		<div class="chip" data-id="status">draft</div>
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
	const { html, summary } = applyPatches(BOARD, [
		{ op: "text", id: "risk", path: [], before: "Refresh races", text: 'Races & <b>bugs</b>' },
	]);
	// `>` is left alone: it is not special in a text node, and escaping it turned every
	// `-->` in a Mermaid source into `--&gt;`.
	assert.match(html, /data-id="risk"[^>]*>Races &amp; &lt;b>bugs&lt;\/b><\/div>/);
	assert.deepEqual(summary, ["retyped #risk"]);
	untouched(BOARD, html, "risk");
});

test("inserting puts a component before </body>, indented like its neighbours", () => {
	const { html, summary } = applyPatches(BOARD, [
		{ op: "insert", kind: "sticky", id: "sticky-1", at: { left: 40, top: 400, width: 220 }, text: "New" },
	]);
	assert.match(
		html,
		/\n\t\t<div class="sticky" data-id="sticky-1" style="left: 40px; top: 400px; width: 220px">New<\/div>\n\t<\/body>/,
	);
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
		{ op: "text", id: "risk", path: [], before: "Refresh races", text: "Two edits" },
	]);
	assert.match(html, /data-id="risk" style="left: 500px; top: 48px">Two edits</);
	// Both patches name #risk and both report it: the agent hears about the component
	// twice, which is what happened to it.
	assert.deepEqual(ids, ["risk", "risk"]);
});

test("minted ids are named after the thing and never collide", () => {
	assert.equal(mintId(BOARD, "sticky"), "sticky-1");
	const once = applyPatches(BOARD, [{ op: "insert", kind: "sticky", id: "sticky-1", at: { left: 0, top: 0 } }]).html;
	assert.equal(mintId(once, "sticky"), "sticky-2");
});

test("there is no arrow left to insert", () => {
	/*
	 * `ComponentKind` no longer has it, so writing this needs a cast — which is the point.
	 * An old client that still sends one is refused with a reason rather than writing an
	 * `svg.link` into the file that nothing will ever draw.
	 */
	assert.throws(
		() => applyPatches(BOARD, [{ op: "insert", kind: "arrow", id: "a1", at: { left: 0, top: 0 } } as never]),
		/cannot insert an? arrow/,
	);
});

// --- retyping, addressed by where the run sits ------------------------------------

/*
 * `(id, path)`: the component, then the element-child indices walked into it. In `BOARD`
 * the card `#goal` holds an `<h3>` at `[0]` and a `<p>` at `[1]`, and the sticky `#risk`
 * holds its own words, which is `[]`.
 *
 * `before` is what the browser was showing. It is not part of the address; it is the guard
 * that makes a *derived* address safe to use at all, and its own tests are further down.
 */

test("a run is addressed by its position inside its component", () => {
	const { html, summary, ids } = applyPatches(BOARD, [{ op: "text", id: "goal", path: [0], before: "Goal", text: "Ship it" }]);
	assert.match(html, /<h3>Ship it<\/h3>/);
	assert.match(html, /<p>Keep it short\.<\/p>/);
	assert.deepEqual(summary, ["retyped the <h3> at child 0 of #goal"]);
	assert.deepEqual(ids, ["goal"]);
	// Only the heading's line differs — the component's own tag is not rewritten.
	const differing = BOARD.split("\n").filter((line, index) => line !== html.split("\n")[index]);
	assert.deepEqual(differing, ["\t\t\t<h3>Goal</h3>"]);
});

test("the second run of the same card is the same id and the next index", () => {
	const { html, ids } = applyPatches(BOARD, [
		{ op: "text", id: "goal", path: [1], before: "Keep it short.", text: "Two sentences now. Both short." },
	]);
	assert.match(html, /<p>Two sentences now\. Both short\.<\/p>/);
	assert.match(html, /<h3>Goal<\/h3>/);
	assert.deepEqual(ids, ["goal"]);
});

test("an empty path is the component's own text, and reads as the component", () => {
	// A sticky holds its words directly, so there is no part to name and the summary says
	// "#risk" rather than "the <div> at … of #risk".
	const { summary } = applyPatches(BOARD, [
		{ op: "text", id: "risk", path: [], before: "Refresh races", text: "Refresh races, again" },
	]);
	assert.deepEqual(summary, ["retyped #risk"]);
});

test("a component the board does not have is refused, with the id in the reason", () => {
	assert.throws(
		() => applyPatches(BOARD, [{ op: "text", id: "nope", path: [0], before: "x", text: "y" }]),
		(error: unknown) => {
			assert.ok(error instanceof PatchRefused);
			assert.match(error.message, /no component with data-id="nope"/);
			return true;
		},
	);
});

test("a path that walks past the end of the file's tree is refused", () => {
	// #goal has two element children, so `[2]` is a shape this file does not have. The
	// equivalent under the old scheme was a name nothing carried.
	assert.throws(
		() => applyPatches(BOARD, [{ op: "text", id: "goal", path: [2], before: "x", text: "y" }]),
		/#goal has nothing at child 2 any more/,
	);
	assert.throws(
		() => applyPatches(BOARD, [{ op: "text", id: "goal", path: [0, 0], before: "x", text: "y" }]),
		/#goal has nothing at child 0 › 0 any more/,
	);
});

test("a run whose content is markup is refused rather than flattened", () => {
	// A paragraph with a link in it is exactly the shape a plain-text replacement would
	// destroy, so the leaf is what has to be addressed.
	const nested = `<body class="board">\n\t<div class="callout" data-id="note"><p><strong>Careful.</strong> Read this.</p></div>\n</body>`;
	assert.throws(
		() => applyPatches(nested, [{ op: "text", id: "note", path: [0], before: "Careful. Read this.", text: "flat" }]),
		/contains markup/,
	);
	// One level further in it is a leaf, and that one goes through.
	const { html, summary } = applyPatches(nested, [
		{ op: "text", id: "note", path: [0, 0], before: "Careful.", text: "Careful!" },
	]);
	assert.match(html, /<strong>Careful!<\/strong> Read this\./);
	assert.deepEqual(summary, ["retyped the <strong> at child 0 › 0 of #note"]);
});

test("a void element has no text to retype, and says so", () => {
	const image = `<body class="board">\n\t<div class="text" data-id="t"><img src="a.png" /></div>\n</body>`;
	assert.throws(
		() => applyPatches(image, [{ op: "text", id: "t", path: [0], before: "", text: "x" }]),
		/is a void element and has no text/,
	);
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
		{
			op: "text",
			id: "goal",
			path: [1],
			before: "A second tab that wakes up must not spend a token the first tab already spent.",
			text: "\n\t\t\tOne session, two tabs.\n\t\t",
		},
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

// --- markdown, whose editable unit is its whole source ----------------------------

/*
 * The shape that was not editable at all until now. `board.js` reads the source out of
 * the element and replaces it with rendered HTML, so there was nothing in the live DOM
 * to double-click and an index path into what it drew addressed nothing in the file.
 * The answer is one editable, named on the component itself, holding the source.
 */
const MARKDOWN = `<body class="board">
	<div class="card" data-id="sequence" data-md style="left: 48px; top: 604px; width: 620px">
		## The sequence

		1. Tab A and tab B both see a 401.
		2. Both ask to refresh with the same token \`t0\`.

		Cost per refresh stays $O(1)$.
	</div>
</body>
`;

/** The source as the editor hands it back, dedented — which is what `before` carries. */
const SEQUENCE_SOURCE = `## The sequence

1. Tab A and tab B both see a 401.
2. Both ask to refresh with the same token \`t0\`.

Cost per refresh stays $O(1)$.`;

test("a markdown component's whole source is one editable", () => {
	const { summary, ids } = applyPatches(MARKDOWN, [
		{
			op: "text",
			id: "sequence",
			path: [],
			before: SEQUENCE_SOURCE,
			text: "\t\t## The sequence\n\n\t\t1. Both tabs see a 401.\n",
		},
	]);
	assert.deepEqual(summary, ["retyped #sequence"]);
	assert.deepEqual(ids, ["sequence"]);
});

test("editing one line of a markdown source is a one-line diff", () => {
	/*
	 * The whole point of splicing rather than re-serialising, for the case that used to
	 * be impossible. The editor sends the source back indented as the file had it, so
	 * the lines it did not touch come out byte-identical and the diff names the sentence
	 * that changed.
	 */
	const edited = `\t\t## The sequence

\t\t1. Tab A and tab B both see a 401.
\t\t2. Both ask to refresh with the token they hold.

\t\tCost per refresh stays $O(1)$.`;
	const { html } = applyPatches(MARKDOWN, [{ op: "text", id: "sequence", path: [], before: SEQUENCE_SOURCE, text: edited }]);
	const differing = MARKDOWN.split("\n").filter((line, index) => line !== html.split("\n")[index]);
	assert.deepEqual(differing, ["\t\t2. Both ask to refresh with the same token `t0`."]);
	assert.match(html, /2\. Both ask to refresh with the token they hold\./);
	// The component's own tag is untouched: `data-md` still says what it is.
	assert.match(html, /<div class="card" data-id="sequence" data-md style="left: 48px/);
});

test("markdown with raw HTML in it is refused, for the same reason a card is", () => {
	/*
	 * Not an exception written for markdown — the same markup check. `board.js` mounts
	 * one of these from the element's `textContent`, which is the source with the tags
	 * already dropped, so the browser never had the file's bytes to send back.
	 */
	const raw = `<body class="board">\n\t<div class="card" data-id="notes" data-md>A line<br />and another</div>\n</body>`;
	assert.throws(
		() => applyPatches(raw, [{ op: "text", id: "notes", path: [], before: "A lineand another", text: "A line" }]),
		/contains markup/,
	);
});

test("a mermaid diagram is the same mechanism, not a second one", () => {
	const board = `<body class="board">
	<div class="card" data-id="flow" data-mermaid style="left: 48px; top: 184px">
		flowchart TD
			A["tab A: 401"] --> L{"lock free?"}
	</div>
</body>`;
	const { html, summary } = applyPatches(board, [
		{
			op: "text",
			id: "flow",
			path: [],
			before: 'flowchart TD\n\tA["tab A: 401"] --> L{"lock free?"}',
			text: '\t\tflowchart TD\n\t\t\tA["tab A: 401"] --> L{"lock free?"}\n\t\t\tL -- yes --> R["refresh"]',
		},
	]);
	assert.deepEqual(summary, ["retyped #flow"]);
	assert.match(html, /L -- yes --> R\["refresh"\]/);
	assert.match(html, /<div class="card" data-id="flow" data-mermaid/);
});

// --- a fresh component is editable, and a copy is separately editable -------------

test("an inserted component is retypeable because it holds text, not because it was named", () => {
	const { html, ids } = applyPatches(BOARD, [{ op: "insert", kind: "card", id: "", at: { left: 0, top: 0 } }], mintId);
	assert.deepEqual(ids, ["card-1"]);
	/*
	 * No name on the heading. There used to be one, minted here against the whole file,
	 * because a retype was addressed by name and without one a user could double-click the
	 * placeholder and nothing at all would happen.
	 */
	assert.match(html, /<h3>Untitled<\/h3>/);
	assert.ok(!html.includes("data-edit"), "an insert writes no run names");
	const { summary } = applyPatches(html, [{ op: "text", id: "card-1", path: [0], before: "Untitled", text: "Rollout" }]);
	assert.deepEqual(summary, ["retyped the <h3> at child 0 of #card-1"]);
});

test("a copy is separately retypeable, and nothing inside it had to be renamed", () => {
	/*
	 * The mechanism this replaces: a copy used to mint a fresh `data-edit` for every run
	 * inside it, because a name was unique to the board and two components sharing one made
	 * a retype of either ambiguous. Two copies have two ids, so the same path under each of
	 * them is two addresses by construction.
	 */
	const copied = applyPatches(BOARD, [{ op: "duplicate", id: "goal" }]).html;
	const { html, summary } = applyPatches(copied, [{ op: "text", id: "goal-2", path: [0], before: "Goal", text: "Ship it" }]);
	assert.deepEqual(summary, ["retyped the <h3> at child 0 of #goal-2"]);
	assert.match(html, /data-id="goal"[\s\S]*?<h3>Goal<\/h3>/);
	assert.match(html, /data-id="goal-2"[\s\S]*?<h3>Ship it<\/h3>/);
});

test("a duplicate rewrites one name, where it used to rewrite one per run", () => {
	const once = applyPatches(BOARD, [{ op: "duplicate", id: "goal" }]).html;
	const twice = applyPatches(once, [{ op: "duplicate", id: "goal" }]).html;
	const ids = [...twice.matchAll(/data-id="([^"]+)"/g)].map((match) => match[1]);
	assert.deepEqual(ids.length, new Set(ids).size, `duplicate ids: ${ids.join(" ")}`);
	assert.deepEqual(ids, ["goal", "risk", "status", "goal-2", "goal-3"]);
	assert.ok(!twice.includes("data-edit"), "and no run names to keep unique");
});

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
	// The markup inside it survives, which is the whole reason this is not an insert. Only
	// the `data-id` is rewritten: nothing inside a component is named any more, so a copy
	// has nothing else to mint.
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
	// No `style` attribute to offset, so the copy is not given coordinates this file
	// invented — it lands on top of the original and the user drags it off.
	const { html, ids } = applyPatches(BOARD, [{ op: "duplicate", id: "status" }]);
	assert.deepEqual(ids, ["status-2"]);
	assert.match(html, /<div class="chip" data-id="status-2">draft<\/div>/);
});

test("a duplicate can be offset by the caller", () => {
	const { html } = applyPatches(BOARD, [{ op: "duplicate", id: "risk", offset: { x: 0, y: 200 } }]);
	assert.match(html, /data-id="risk-2" style="left: 480px; top: 248px"/);
});

// --- rename ----------------------------------------------------------------------

test("a rename writes the name, answers with it, and touches nothing else", () => {
	const { html, summary, ids } = applyPatches(BOARD, [{ op: "rename", id: "risk", to: "refresh-race" }]);
	// No parenthetical about connector ends: nothing in a board names another component
	// any more, so a rename is a single-attribute splice and says so.
	assert.deepEqual(summary, ["renamed #risk to #refresh-race"]);
	// The new name is what the op answers with, because an agent holding the old one is
	// told what to address it by now.
	assert.deepEqual(ids, ["refresh-race"]);
	assert.match(html, /<div class="sticky" data-id="refresh-race" style="left: 480px; top: 48px">Refresh races<\/div>/);
	assert.ok(!html.includes('"risk"'));
	untouched(BOARD, html, "risk", "refresh-race");
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
 * exchange for three rules: a box class beside its own keeps the class switch, an id on
 * every editable run keeps it retypeable, and a swap leaves its custom token alone.
 * This is the example printed in that skill, so if these fail the documentation is
 * wrong rather than the test.
 */
const INVENTED = `<body class="board">
	<section class="card phases" data-id="rollout" style="left: 48px; top: 168px; width: 420px">
		<h3>Rollout</h3>
		<div class="phase"><span class="when">week 1</span><span>Lock behind a flag</span></div>
		<div class="phase"><span class="when">week 2</span><span>Ramp to 10%</span></div>
	</section>
</body>
`;

test("every run in an invented component retypes, however deep it sits", () => {
	const heading = applyPatches(INVENTED, [{ op: "text", id: "rollout", path: [0], before: "Rollout", text: "Plan" }]);
	assert.match(heading.html, /<h3>Plan<\/h3>/);

	// Two levels down and in the middle of a row, which is the case the skill used to have
	// to ask the agent to name in advance.
	const when = applyPatches(INVENTED, [{ op: "text", id: "rollout", path: [1, 0], before: "week 1", text: "week 3" }]);
	assert.match(when.html, />week 3<\/span><span>Lock behind a flag<\/span>/);

	const what = applyPatches(INVENTED, [{ op: "text", id: "rollout", path: [2, 1], before: "Ramp to 10%", text: "Ramp to 50%" }]);
	assert.match(what.html, />week 2<\/span><span>Ramp to 50%<\/span>/);
	assert.deepEqual(what.summary, ["retyped the <span> at child 2 › 1 of #rollout"]);
});

test("a row wrapping two spans is markup, and addressing the row is refused", () => {
	// A `.phase` holding two spans is exactly the shape a plain-text replacement would
	// destroy, so the leaf is what has to be addressed and the row is a refusal.
	assert.throws(
		() =>
			applyPatches(INVENTED, [
				{ op: "text", id: "rollout", path: [1], before: "week 1Lock behind a flag", text: "week 1" },
			]),
		/contains markup/,
	);
});

test("the indices are the file's element children, so text nodes do not shift them", () => {
	/*
	 * The one way the two derivations of this address could disagree. A file indents its
	 * markup, so a parse tree is full of whitespace text nodes between the elements — and
	 * the browser's `children` skips them. Counting `childNodes` on this side would put
	 * every index in a formatted board off by one or more.
	 */
	const spaced = `<body class="board">
	<section class="card" data-id="c" style="left: 0">

		<h3>One</h3>

		<p>Two</p>

	</section>
</body>`;
	assert.match(applyPatches(spaced, [{ op: "text", id: "c", path: [0], before: "One", text: "First" }]).html, /<h3>First<\/h3>/);
	assert.match(applyPatches(spaced, [{ op: "text", id: "c", path: [1], before: "Two", text: "Second" }]).html, /<p>Second<\/p>/);
});

// --- retyping a run that has marks in it ------------------------------------------

/*
 * `html` rather than `text`, because `See <a>the doc</a>` has no plain-text form: sending
 * the words alone would throw the link away, which is why a marked-up run used to be
 * refused outright. The payload is the element's new inner HTML and `inline-html.ts` decides
 * what a file may hold; these are the tests for the *splice*, not for the normalising.
 */

const MARKED = `<body class="board">
	<div class="text" data-id="intro" style="left: 8px">
		<p>See <a href="../docs/notes.md">the doc</a>, then <b>ship it</b>.</p>
	</div>
</body>`;

test("a run with marks in it is retyped as markup, and the marks survive", () => {
	const { html, summary, ids } = applyPatches(MARKED, [
		{
			op: "html",
			id: "intro",
			path: [0],
			before: "See the doc, then ship it.",
			html: 'See <a href="../docs/notes.md">the doc</a>, then <b>ship it now</b>.',
		},
	]);
	assert.match(html, /<p>See <a href="\.\.\/docs\/notes\.md">the doc<\/a>, then <b>ship it now<\/b>\.<\/p>/);
	assert.deepEqual(summary, ["retyped the <p> at child 0 of #intro"]);
	assert.deepEqual(ids, ["intro"]);
	// One line, as every other retype is.
	const differing = MARKED.split("\n").filter((line, index) => line !== html.split("\n")[index]);
	assert.equal(differing.length, 1);
});

test("what the browser hands back is normalised on the way in", () => {
	/*
	 * The gestures, end to end: a mark split by typing across its end, an empty one left by
	 * a delete, a paste that brought a `style`, and a space made non-breaking at an edge.
	 * `inline-html.test.ts` covers each in isolation; this is the assertion that the splice
	 * writes the *normalised* form and never the raw `innerHTML`.
	 */
	const { html } = applyPatches(MARKED, [
		{
			op: "html",
			id: "intro",
			path: [0],
			before: "See the doc, then ship it.",
			html: 'See <b>ship</b><b> it</b><i></i> <span style="color: #f0c">now</span>.',
		},
	]);
	assert.match(html, /<p>See <b>ship it<\/b> <span>now<\/span>\.<\/p>/);
});

test("the same run may still be retyped as plain text, and then it is escaped", () => {
	// A leaf with no marks in it: both ops can address it, and `text` is what the source
	// editor and a plain run send.
	const plain = `<body class="board">\n\t<div class="sticky" data-id="s" style="left: 8px">Refresh races</div>\n</body>`;
	const { html } = applyPatches(plain, [
		{ op: "text", id: "s", path: [], before: "Refresh races", text: "Races & <b>bugs</b>" },
	]);
	assert.match(html, />Races &amp; &lt;b>bugs&lt;\/b><\/div>/);
});

test("a box of blocks is refused, so one field cannot swallow a heading and a paragraph", () => {
	const card = `<body class="board">
	<section class="card" data-id="goal" style="left: 8px">
		<h3>Goal</h3>
		<p>Keep it short.</p>
	</section>
</body>`;
	assert.throws(
		() => applyPatches(card, [{ op: "html", id: "goal", path: [], before: "GoalKeep it short.", html: "<h3>Goal</h3>" }]),
		/holds blocks rather than words/,
	);
});

test("the race guard reads the file as text, so markup and entities do not trip it", () => {
	/*
	 * The guard compares what was on screen with what the file says. The browser has the
	 * words; the file has the tags and `&amp;`. Comparing bytes would refuse every edit to a
	 * paragraph with a link in it, which is the case this op exists for.
	 */
	const entity = `<body class="board">\n\t<div class="text" data-id="t" style="left: 8px"><p>Races &amp; <b>bugs</b></p></div>\n</body>`;
	const { html } = applyPatches(entity, [
		{ op: "html", id: "t", path: [0], before: "Races & bugs", html: "Races &amp; <b>races</b>" },
	]);
	assert.match(html, /<p>Races &amp; <b>races<\/b><\/p>/);
	// And a real disagreement about the words is still refused.
	assert.throws(
		() => applyPatches(entity, [{ op: "html", id: "t", path: [0], before: "Something else", html: "x" }]),
		/is not what it was when you started typing/,
	);
});

test("a paragraph written over several lines keeps its indentation", () => {
	const board = `<body class="board">
	<div class="text" data-id="t" style="left: 8px">
		<p>
			See <a href="/a">the doc</a>, then ship it.
		</p>
	</div>
</body>`;
	const { html } = applyPatches(board, [
		{
			op: "html",
			id: "t",
			path: [0],
			before: "See the doc, then ship it.",
			html: '\n\t\t\tSee <a href="/a">the doc</a>, then ship it now.\n\t\t',
		},
	]);
	assert.equal(
		html,
		`<body class="board">
	<div class="text" data-id="t" style="left: 8px">
		<p>
			See <a href="/a">the doc</a>, then ship it now.
		</p>
	</div>
</body>`,
	);
});

// --- the guard, which is why a derived address is safe ----------------------------

/*
 * A frame is pinned to the revision it loaded (§7), so the DOM a path was computed from can
 * be older than the file it is resolved against. Indices that pointed at a heading can
 * point at something else by the time the patch lands, and writing the user's words into a
 * component they were not looking at is the worst available outcome: worse than any
 * refusal, and invisible when it happens.
 *
 * So the patch carries what was on screen and the server checks it. This replaces six tests
 * from the other line of this branch about `data-edit="false"` as a subtree seal, and one
 * about two elements sharing a name — the first is meaningless now that nothing needs
 * naming, and the second was the wrong answer *that* scheme could give, resolved by
 * counting matches. This is the wrong answer *this* one could give, and it is closed by
 * comparing rather than by counting.
 */

test("a run that changed under the browser is refused rather than overwritten", () => {
	// The agent rewrote the heading while the frame was pinned. The path still resolves,
	// and it resolves to something the user never saw.
	const moved = BOARD.replace("<h3>Goal</h3>", "<h3>Ship the refresh</h3>");
	assert.throws(
		() => applyPatches(moved, [{ op: "text", id: "goal", path: [0], before: "Goal", text: "Goals" }]),
		(error: unknown) => {
			assert.ok(error instanceof PatchRefused);
			assert.match(error.message, /is not what it was when you started typing/);
			return true;
		},
	);
	// And the refusal is the whole batch: nothing was spliced on the way to it.
	assert.throws(
		() =>
			applyPatches(moved, [
				{ op: "text", id: "goal", path: [1], before: "Keep it short.", text: "Fine" },
				{ op: "text", id: "goal", path: [0], before: "Goal", text: "Goals" },
			]),
		PatchRefused,
	);
});

test("the guard is about words, not about whitespace", () => {
	/*
	 * The file indents a paragraph across three lines and the browser hands back what it
	 * rendered, so the two never agree about spaces and always agree about words. A guard
	 * comparing them literally would refuse every multi-line paragraph in every board,
	 * which is the ordinary case rather than the dangerous one.
	 */
	const board = `<body class="board">\n\t<div class="text" data-id="t">\n\t\tOne session,\n\t\ttwo tabs.\n\t</div>\n</body>`;
	const { html } = applyPatches(board, [
		{ op: "text", id: "t", path: [], before: "One session, two tabs.", text: "One session, three tabs." },
	]);
	assert.match(html, /three tabs\./);
});

test("the component is found by id, so its words are checked even when it has moved", () => {
	// #risk is addressed by id rather than by position, so a component reordered in the
	// file is still found — and this is the content check, not the path check.
	const changed = BOARD.replace("Refresh races", "Token rotation");
	assert.throws(
		() => applyPatches(changed, [{ op: "text", id: "risk", path: [], before: "Refresh races", text: "Races" }]),
		/is not what it was when you started typing/,
	);
});

test("a class swap on an invented component keeps the class it invented", () => {
	const { html } = applyPatches(INVENTED, [{ op: "update", id: "rollout", class: "callout phases" }]);
	assert.match(html, /<section class="callout phases" data-id="rollout"/);
	// And the CSS the agent wrote is keyed on `.phases`, which is why that must survive.
	assert.match(html, /class="phase"/);
});
