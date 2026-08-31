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
			<h3 data-edit="goal-title">Goal</h3>
			<p data-edit="goal-body">Keep it short.</p>
		</section>
		<div class="sticky" data-id="risk" data-edit="risk-text" style="left: 480px; top: 48px">Refresh races</div>
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
	assert.match(html, /data-id="risk" data-edit="risk-text" style="left: 512px; top: 96px"/);
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
	const { html, summary } = applyPatches(BOARD, [{ op: "text", edit: "risk-text", text: 'Races & <b>bugs</b>' }]);
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
		/\n\t\t<div class="sticky" data-id="sticky-1" data-edit="sticky-1-text" style="left: 40px; top: 400px; width: 220px">New<\/div>\n\t<\/body>/,
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
	assert.match(front, /\n\t\t<div class="sticky" data-id="risk" data-edit="risk-text" style="left: 480px; top: 48px">Refresh races<\/div>\n\t<\/body>/);
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
		{ op: "text", edit: "risk-text", text: "Two edits" },
	]);
	assert.match(html, /data-id="risk" data-edit="risk-text" style="left: 500px; top: 48px">Two edits</);
	// The second patch named no component, and the id it reports is the one the run was
	// found inside: an agent hears about #risk twice, which is what happened.
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

// --- retyping, addressed by the name its author wrote -----------------------------

test("a run is addressed by its data-edit, and the component is read back off the file", () => {
	const { html, summary, ids } = applyPatches(BOARD, [{ op: "text", edit: "goal-title", text: "Ship it" }]);
	assert.match(html, /<h3 data-edit="goal-title">Ship it<\/h3>/);
	assert.match(html, /<p data-edit="goal-body">Keep it short\.<\/p>/);
	// The patch said nothing about #goal; the server found the run and looked up.
	assert.deepEqual(summary, ["retyped the <h3> in #goal"]);
	assert.deepEqual(ids, ["goal"]);
	// Only the heading's line differs — the component's own tag is not rewritten.
	const differing = BOARD.split("\n").filter((line, index) => line !== html.split("\n")[index]);
	assert.deepEqual(differing, ['\t\t\t<h3 data-edit="goal-title">Goal</h3>']);
});

test("the second run of the same card is a second name, not a second index", () => {
	const { html, ids } = applyPatches(BOARD, [{ op: "text", edit: "goal-body", text: "Two sentences now. Both short." }]);
	assert.match(html, /<p data-edit="goal-body">Two sentences now\. Both short\.<\/p>/);
	assert.match(html, /<h3 data-edit="goal-title">Goal<\/h3>/);
	assert.deepEqual(ids, ["goal"]);
});

test("an editable that is the whole component reads as the component", () => {
	// `data-edit` on the component's own element: the summary says "#risk" rather than
	// "the <div> in #risk", because there is no part to name.
	const { summary } = applyPatches(BOARD, [{ op: "text", edit: "risk-text", text: "Refresh races, again" }]);
	assert.deepEqual(summary, ["retyped #risk"]);
});

test("a name nothing on the board carries is refused, with the name in the reason", () => {
	assert.throws(
		() => applyPatches(BOARD, [{ op: "text", edit: "goal-subtitle", text: "x" }]),
		(error: unknown) => {
			assert.ok(error instanceof PatchRefused);
			assert.match(error.message, /nothing on this board is called data-edit="goal-subtitle"/);
			return true;
		},
	);
});

test("a name two elements share is refused rather than resolved to the first", () => {
	/*
	 * The one wrong answer this addressing scheme could give, so it is the one it
	 * checks: with an index path a wrong element was impossible, and writing a user's
	 * words into a component they were not looking at would be worse than any refusal.
	 */
	const twice = `<body class="board">
	<div class="sticky" data-id="a" data-edit="note">one</div>
	<div class="sticky" data-id="b" data-edit="note">two</div>
</body>`;
	assert.throws(
		() => applyPatches(twice, [{ op: "text", edit: "note", text: "which?" }]),
		/data-edit="note" is on 2 elements — an editable name has to be unique in a board/,
	);
});

test("a run whose content is markup is refused rather than flattened", () => {
	// Why the skill says to mark the leaf: a paragraph with a link in it is exactly the
	// shape a plain-text replacement would destroy.
	const nested = `<body class="board">\n\t<div class="callout" data-id="note" data-edit="note-body"><p><strong>Careful.</strong> Read this.</p></div>\n</body>`;
	assert.throws(() => applyPatches(nested, [{ op: "text", edit: "note-body", text: "flat" }]), /contains markup/);
	// Marked one level further in, it is a leaf, and that one goes through.
	const marked = nested.replace("<strong>", '<strong data-edit="note-warning">');
	const { html, summary } = applyPatches(marked, [{ op: "text", edit: "note-warning", text: "Careful!" }]);
	assert.match(html, /<strong data-edit="note-warning">Careful!<\/strong> Read this\./);
	assert.deepEqual(summary, ["retyped the <strong> in #note"]);
});

test("a data-edit outside any component is refused, because nothing could be told about it", () => {
	// An id is how the agent hears what the user changed (§6.5), and a run with no
	// component around it has no id to report.
	const loose = `<body class="board">\n\t<h1 data-edit="stray">Hello</h1>\n</body>`;
	assert.throws(() => applyPatches(loose, [{ op: "text", edit: "stray", text: "x" }]), /is not inside a component/);
});

test("a void element has no text to retype, and says so", () => {
	const image = `<body class="board">\n\t<div class="text" data-id="t"><img data-edit="t-pic" src="a.png" /></div>\n</body>`;
	assert.throws(() => applyPatches(image, [{ op: "text", edit: "t-pic", text: "x" }]), /is a void element and has no text/);
});

test("retyping a paragraph written over several lines keeps its shape", () => {
	const board = `<body class="board">
	<section class="card" data-id="goal" style="left: 8px">
		<h3 data-edit="goal-title">Goal</h3>
		<p data-edit="goal-body">
			A second tab that wakes up must not spend a token the first tab
			already spent.
		</p>
	</section>
</body>`;
	// The text arrives carrying the indentation the browser read back with it, which is
	// exactly what must not be written on top of the indentation already in the file.
	const { html } = applyPatches(board, [{ op: "text", edit: "goal-body", text: "\n\t\t\tOne session, two tabs.\n\t\t" }]);
	assert.equal(
		html,
		`<body class="board">
	<section class="card" data-id="goal" style="left: 8px">
		<h3 data-edit="goal-title">Goal</h3>
		<p data-edit="goal-body">
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
	<div class="card" data-id="sequence" data-md data-edit="sequence-md" style="left: 48px; top: 604px; width: 620px">
		## The sequence

		1. Tab A and tab B both see a 401.
		2. Both ask to refresh with the same token \`t0\`.

		Cost per refresh stays $O(1)$.
	</div>
</body>
`;

test("a markdown component's whole source is one editable", () => {
	const { summary, ids } = applyPatches(MARKDOWN, [
		{ op: "text", edit: "sequence-md", text: "\t\t## The sequence\n\n\t\t1. Both tabs see a 401.\n" },
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
	const { html } = applyPatches(MARKDOWN, [{ op: "text", edit: "sequence-md", text: edited }]);
	const differing = MARKDOWN.split("\n").filter((line, index) => line !== html.split("\n")[index]);
	assert.deepEqual(differing, ["\t\t2. Both ask to refresh with the same token `t0`."]);
	assert.match(html, /2\. Both ask to refresh with the token they hold\./);
	// The component's own tag is untouched: `data-md` still says what it is.
	assert.match(html, /<div class="card" data-id="sequence" data-md data-edit="sequence-md" style="left: 48px/);
});

test("markdown with raw HTML in it is refused, for the same reason a card is", () => {
	/*
	 * Not an exception written for markdown — the same markup check. `board.js` mounts
	 * one of these from the element's `textContent`, which is the source with the tags
	 * already dropped, so the browser never had the file's bytes to send back.
	 */
	const raw = `<body class="board">\n\t<div class="card" data-id="notes" data-md data-edit="notes-md">A line<br />and another</div>\n</body>`;
	assert.throws(() => applyPatches(raw, [{ op: "text", edit: "notes-md", text: "A line" }]), /contains markup/);
});

test("a mermaid diagram is the same mechanism, not a second one", () => {
	const board = `<body class="board">
	<div class="card" data-id="flow" data-mermaid data-edit="flow-src" style="left: 48px; top: 184px">
		flowchart TD
			A["tab A: 401"] --> L{"lock free?"}
	</div>
</body>`;
	const { html, summary } = applyPatches(board, [
		{ op: "text", edit: "flow-src", text: '\t\tflowchart TD\n\t\t\tA["tab A: 401"] --> L{"lock free?"}\n\t\t\tL -- yes --> R["refresh"]' },
	]);
	assert.deepEqual(summary, ["retyped #flow"]);
	assert.match(html, /L -- yes --> R\["refresh"\]/);
	assert.match(html, /<div class="card" data-id="flow" data-mermaid data-edit="flow-src"/);
});

// --- a fresh component is editable, and a copy is separately editable -------------

test("an inserted component carries a data-edit, so its placeholder can be retyped", () => {
	const { html, ids } = applyPatches(BOARD, [{ op: "insert", kind: "card", id: "", at: { left: 0, top: 0 } }], mintId);
	assert.deepEqual(ids, ["card-1"]);
	assert.match(html, /<h3 data-edit="card-1-title">Untitled<\/h3>/);
	// And it works immediately, which is the only reason the insert writes one.
	const { summary } = applyPatches(html, [{ op: "text", edit: "card-1-title", text: "Rollout" }]);
	assert.deepEqual(summary, ["retyped the <h3> in #card-1"]);
});

test("an inserted run's name gives way to one the board already has", () => {
	// Contrived, but the alternative is an insert that silently makes two runs share a
	// name and breaks retyping on both.
	const taken = BOARD.replace('data-edit="goal-title"', 'data-edit="sticky-1-text"');
	const { html } = applyPatches(taken, [{ op: "insert", kind: "sticky", id: "sticky-1", at: { left: 0, top: 0 } }]);
	assert.match(html, /data-id="sticky-1" data-edit="sticky-1-text-2"/);
});

test("the copy a duplicate makes is editable on its own", () => {
	const copied = applyPatches(BOARD, [{ op: "duplicate", id: "goal" }]).html;
	const { html, summary } = applyPatches(copied, [{ op: "text", edit: "goal-title-2", text: "Ship it" }]);
	assert.deepEqual(summary, ["retyped the <h3> in #goal-2"]);
	// The original still says what it said: the two runs are two names now.
	assert.match(html, /<h3 data-edit="goal-title">Goal<\/h3>/);
	assert.match(html, /<h3 data-edit="goal-title-2">Ship it<\/h3>/);
});

test("a second copy's runs do not collide with the first copy's", () => {
	const once = applyPatches(BOARD, [{ op: "duplicate", id: "goal" }]).html;
	const twice = applyPatches(once, [{ op: "duplicate", id: "goal" }]).html;
	const names = [...twice.matchAll(/data-edit="([^"]+)"/g)].map((match) => match[1]);
	assert.deepEqual(names.length, new Set(names).size, `duplicate editable names: ${names.join(" ")}`);
	assert.deepEqual(names, ["goal-title", "goal-body", "risk-text", "goal-title-2", "goal-body-2", "goal-title-3", "goal-body-3"]);
});

// --- appearance, as attributes ---------------------------------------------------

test("a tone is set as an attribute, and cleared by removing it", () => {
	const { html, summary } = applyPatches(BOARD, [{ op: "update", id: "risk", attrs: { "data-tone": "warn" } }]);
	assert.match(html, /<div class="sticky" data-id="risk" data-edit="risk-text" style="left: 480px; top: 48px" data-tone="warn">/);
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
	assert.match(html, /<div class="callout" data-id="risk" data-edit="risk-text" style="left: 8px; top: 48px" data-tone="danger">/);
	assert.deepEqual(summary, ['moved #risk and made #risk a callout and set data-tone="danger" on #risk']);
});

// --- duplicate -------------------------------------------------------------------

test("a duplicate is a copy of the source bytes, offset, named after the original", () => {
	const { html, summary, ids } = applyPatches(BOARD, [{ op: "duplicate", id: "goal" }]);
	assert.deepEqual(summary, ["duplicated #goal as #goal-2"]);
	assert.deepEqual(ids, ["goal-2"]);
	// The markup inside it survives, which is the whole reason this is not an insert —
	// and every editable name inside it is a new one, because two components sharing a
	// `data-edit` would make a retype of either of them ambiguous.
	assert.match(
		html,
		/<section class="card" data-id="goal-2" style="left: 64px; top: 64px; width: 380px; background: var\(--b-bg-deep\)">\n\t\t\t<h3 data-edit="goal-title-2">Goal<\/h3>\n\t\t\t<p data-edit="goal-body-2">Keep it short\.<\/p>\n\t\t<\/section>\n\t<\/body>/,
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
	assert.match(html, /data-id="risk-2" data-edit="risk-text-2" style="left: 480px; top: 248px"/);
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
	assert.match(html, /<div class="sticky" data-id="refresh-race" data-edit="risk-text" style="left: 480px; top: 48px">Refresh races<\/div>/);
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
		<h3 data-edit="rollout-title">Rollout</h3>
		<div class="phase"><span class="when" data-edit="rollout-when-1">week 1</span><span data-edit="rollout-what-1">Lock behind a flag</span></div>
		<div class="phase"><span class="when" data-edit="rollout-when-2">week 2</span><span data-edit="rollout-what-2">Ramp to 10%</span></div>
	</section>
</body>
`;

test("every named run in an invented component retypes, however deep it sits", () => {
	const heading = applyPatches(INVENTED, [{ op: "text", edit: "rollout-title", text: "Plan" }]);
	assert.match(heading.html, /<h3 data-edit="rollout-title">Plan<\/h3>/);

	// Two levels down and in the middle of a row: nothing about the position is in the
	// patch, which is the difference between this and the index path it replaced.
	const when = applyPatches(INVENTED, [{ op: "text", edit: "rollout-when-1", text: "week 3" }]);
	assert.match(when.html, /data-edit="rollout-when-1">week 3<\/span><span data-edit="rollout-what-1">Lock behind a flag<\/span>/);

	const what = applyPatches(INVENTED, [{ op: "text", edit: "rollout-what-2", text: "Ramp to 50%" }]);
	assert.match(what.html, /data-edit="rollout-when-2">week 2<\/span><span data-edit="rollout-what-2">Ramp to 50%<\/span>/);
	assert.deepEqual(what.summary, ["retyped the <span> in #rollout"]);
});

test("a row wrapping two named spans is markup, and cannot itself be named", () => {
	// Why the skill says to mark the leaf: a `.phase` holding two spans is exactly the
	// shape a plain-text replacement would destroy, so a `data-edit` on the row is a
	// refusal rather than a shortcut.
	const onTheRow = INVENTED.replace('<div class="phase">', '<div class="phase" data-edit="rollout-row-1">');
	assert.throws(() => applyPatches(onTheRow, [{ op: "text", edit: "rollout-row-1", text: "week 1 — flag" }]), PatchRefused);
});

// --- data-edit: "false" is the one value that is never a name ---------------------

/*
 * These replace six tests from the other line of this branch, which covered
 * `data-edit="false"` as a subtree seal over editability that was otherwise inferred: a
 * declaration changing nothing, a seal refusing, a seal covering a subtree, a seal on a
 * whole component, only "false" sealing, and a seal leaving move and rename alone. All
 * six addressed the run with `{ id, path }`, and the seal is gone with the path — under
 * this rule a run with no name is not editable, so omitting the name already does
 * everything a seal did.
 *
 * What survives is the reservation, and these are the tests for it. An author who read
 * that other guidance would write `data-edit="false"` to turn editing off, and with the
 * name as the address it would do the opposite: mint a retypeable run called `false`.
 */

const RESERVED = `<body class="board">
	<section class="card metrics" data-id="throughput" style="left: 48px; top: 48px; width: 320px">
		<h3 data-edit="throughput-title">Throughput</h3>
		<span class="value" data-edit="false">2,455</span>
	</section>
</body>
`;

test('data-edit="false" is refused as a name, and the reason says what to do instead', () => {
	assert.throws(
		() => applyPatches(RESERVED, [{ op: "text", edit: "false", text: "9,001" }]),
		(error: unknown) => {
			assert.ok(error instanceof PatchRefused);
			assert.match(error.message, /data-edit="false" is not a name — omit the attribute/);
			return true;
		},
	);
	// And the refusal is the whole batch: nothing was spliced on the way to it.
	assert.throws(
		() =>
			applyPatches(RESERVED, [
				{ op: "text", edit: "throughput-title", text: "Requests" },
				{ op: "text", edit: "false", text: "9,001" },
			]),
		PatchRefused,
	);
});

test('only "false" is reserved — every other value is an ordinary name', () => {
	// Reserving anything that merely looks boolean would be a second rule to remember,
	// and `true` or `yes` on a run is an author naming it badly rather than sealing it.
	for (const value of ["true", "yes", "False", "false-start"]) {
		const board = RESERVED.replace('data-edit="false"', `data-edit="${value}"`);
		const { html } = applyPatches(board, [{ op: "text", edit: value, text: "9,001" }]);
		assert.match(html, /9,001/, `data-edit="${value}" should be a usable name`);
	}
});

test("a run the author did not name is not editable, which is what a seal used to be for", () => {
	const unnamed = RESERVED.replace(' data-edit="false"', "");
	assert.throws(
		() => applyPatches(unnamed, [{ op: "text", edit: "throughput-value", text: "9,001" }]),
		/nothing on this board is called data-edit="throughput-value"/,
	);
	// The named heading beside it still retypes, so this is the absence of a name and not
	// a component-wide refusal.
	assert.match(applyPatches(unnamed, [{ op: "text", edit: "throughput-title", text: "Requests" }]).html, /Requests/);
});

test("a class swap on an invented component keeps the class it invented", () => {
	const { html } = applyPatches(INVENTED, [{ op: "update", id: "rollout", class: "callout phases" }]);
	assert.match(html, /<section class="callout phases" data-id="rollout"/);
	// And the CSS the agent wrote is keyed on `.phases`, which is why that must survive.
	assert.match(html, /class="phase"/);
});
