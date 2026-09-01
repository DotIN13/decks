import assert from "node:assert/strict";
import { test } from "node:test";
import { blocks, inline, plainText, type Inline } from "./markdown.ts";

/** A span tree as a readable string, so a failure says what it got. */
function shape(spans: Inline[]): string {
	return spans
		.map((span) => {
			if (span.kind === "text") return JSON.stringify(span.text);
			if (span.kind === "code") return `code(${JSON.stringify(span.text)})`;
			if (span.kind === "link") return `link(${span.href} ${shape(span.spans)})`;
			return `${span.kind}(${shape(span.spans)})`;
		})
		.join(" ");
}

test("bold, italic and strikethrough, including one inside another", () => {
	assert.equal(shape(inline("a **b** c")), '"a " strong("b") " c"');
	assert.equal(shape(inline("*only*")), 'em("only")');
	assert.equal(shape(inline("~~gone~~")), 'strike("gone")');
	assert.equal(shape(inline("***both***")), 'strong(em("both"))');
});

/*
 * The one an agent breaks constantly.
 *
 * Replies are full of `file_path`, `snake_case`, `MAX_DEPTH` and `__init__`, and every rule
 * that treats `__` as bold renders that last one as **init** — eating the two characters
 * that carry the meaning. So underscores are literal here and only `*` emphasises, which is
 * what models actually write. A deliberate break with markdown; see `MARKERS`.
 */
test("an underscore is a character, not emphasis", () => {
	assert.equal(shape(inline("read file_path now")), '"read file_path now"');
	assert.equal(shape(inline("call __init__ first")), '"call __init__ first"');
	assert.equal(shape(inline("_yes_")), '"_yes_"');
	assert.equal(shape(inline("a _b_ c")), '"a _b_ c"');
	// Emphasis still works, with the marker a model reaches for.
	assert.equal(shape(inline("a *b* c")), '"a " em("b") " c"');
});

test("emphasis does not open or close on a space", () => {
	assert.equal(shape(inline("2 * 3 * 4")), '"2 * 3 * 4"');
	assert.equal(shape(inline("a *b")), '"a *b"');
});

test("a backslash makes a marker literal", () => {
	assert.equal(shape(inline("\\*not bold\\*")), '"*not bold*"');
});

test("inline code swallows every marker inside it", () => {
	assert.equal(shape(inline("run `a_b **c**` now")), '"run " code("a_b **c**") " now"');
	// A double backtick span so the content can hold a single one.
	assert.equal(shape(inline("``a ` b``")), 'code("a ` b")');
	// Unterminated: it is the text it is, not code to the end of the reply.
	assert.equal(shape(inline("a ` b")), '"a ` b"');
});

test("a marker inside a code span cannot close emphasis outside it", () => {
	assert.equal(shape(inline("**a `*` b**")), 'strong("a " code("*") " b")');
});

// --- links: the only place structured output can still attack a document -------------

test("a link keeps its label's markup", () => {
	assert.equal(shape(inline("[**docs**](https://example.com/x)")), 'link(https://example.com/x strong("docs"))');
	assert.equal(shape(inline("mail [me](mailto:a@b.co)")), '"mail " link(mailto:a@b.co "me")');
});

test("a target that is not http, https or mailto stays the text it was", () => {
	for (const target of [
		"javascript:alert(1)",
		"JaVaScRiPt:alert(1)",
		"data:text/html;base64,PHNjcmlwdD4=",
		"vbscript:msgbox",
		"file:///etc/passwd",
		"/boards/plan.html",
		"#anchor",
		"//example.com",
	]) {
		const spans = inline(`[click](${target})`);
		assert.equal(spans.length, 1, `${target} produced ${shape(spans)}`);
		assert.equal(spans[0]?.kind, "text", `${target} produced ${shape(spans)}`);
		assert.equal((spans[0] as { text: string }).text, `[click](${target})`);
	}
});

test("no span type can ever carry markup as a string", () => {
	// The property the whole file rests on: every leaf is text or a checked href, so there
	// is nothing anywhere for a renderer to interpret as HTML.
	const spans = inline('[a](https://x.co) `<script>` **<b>** <img onerror=1>');
	const leaves: string[] = [];
	const walk = (list: Inline[]) => {
		for (const span of list) {
			if (span.kind === "text" || span.kind === "code") leaves.push(span.text);
			else walk(span.spans);
		}
	};
	walk(spans);
	assert.ok(leaves.some((leaf) => leaf.includes("<script>")), "the angle brackets survive as text");
	assert.equal(shape(spans).includes("link(https://x.co"), true);
});

// --- blocks ---------------------------------------------------------------------------

test("a fenced block is code, with its language", () => {
	const parsed = blocks("before\n\n```bash\nls -la\necho hi\n```\n\nafter");
	assert.deepEqual(parsed.map((block) => block.kind), ["paragraph", "code", "paragraph"]);
	const code = parsed[1];
	assert.equal(code?.kind, "code");
	if (code?.kind === "code") {
		assert.equal(code.lang, "bash");
		assert.equal(code.text, "ls -la\necho hi");
	}
});

/*
 * Streaming is the reason this matters.
 *
 * A reply arrives a token at a time, so the half-typed states are the states the reader
 * actually watches. An unterminated fence read as a paragraph would show three backticks
 * and a run of prose, then snap into a code block when the closing fence lands.
 */
test("an unterminated fence is code to the end, so a streaming block does not flicker", () => {
	const parsed = blocks("here:\n\n```ts\nconst a = 1;");
	assert.deepEqual(parsed.map((block) => block.kind), ["paragraph", "code"]);
	if (parsed[1]?.kind === "code") assert.equal(parsed[1].text, "const a = 1;");
});

test("nothing inside a fence is parsed as anything else", () => {
	const parsed = blocks("```\n# not a heading\n- not a list\n**not bold**\n```");
	assert.equal(parsed.length, 1);
	if (parsed[0]?.kind === "code") assert.equal(parsed[0].text, "# not a heading\n- not a list\n**not bold**");
});

test("headings carry their level and keep their inline markup", () => {
	const parsed = blocks("# One\n\n### Three with `code`");
	assert.deepEqual(parsed.map((block) => (block.kind === "heading" ? block.level : block.kind)), [1, 3]);
	if (parsed[1]?.kind === "heading") assert.equal(shape(parsed[1].spans), '"Three with " code("code")');
});

test("bullets and numbers become one list, and nesting is a depth", () => {
	const bullets = blocks("- one\n- two\n  - nested\n- three");
	assert.equal(bullets.length, 1);
	if (bullets[0]?.kind === "list") {
		assert.equal(bullets[0].ordered, false);
		assert.deepEqual(bullets[0].items.map((item) => item.depth), [0, 0, 1, 0]);
		assert.equal(shape(bullets[0].items[2]!.spans), '"nested"');
	}
	const numbers = blocks("3. three\n4. four");
	if (numbers[0]?.kind === "list") {
		assert.equal(numbers[0].ordered, true);
		assert.equal(numbers[0].start, 3);
	}
});

test("a rule is a rule, not a one-item bullet list", () => {
	assert.deepEqual(blocks("a\n\n---\n\nb").map((block) => block.kind), ["paragraph", "rule", "paragraph"]);
	assert.deepEqual(blocks("***").map((block) => block.kind), ["rule"]);
	// A bullet needs whitespace after its marker, which is what keeps these apart.
	assert.deepEqual(blocks("- a").map((block) => block.kind), ["list"]);
});

test("consecutive quote lines are one block", () => {
	const parsed = blocks("> first\n> second\n\nafter");
	assert.deepEqual(parsed.map((block) => block.kind), ["quote", "paragraph"]);
	if (parsed[0]?.kind === "quote") assert.equal(shape(parsed[0].spans), '"first\\nsecond"');
});

test("a blank line separates paragraphs and a single newline does not", () => {
	const parsed = blocks("one\ntwo\n\nthree");
	assert.deepEqual(parsed.map((block) => block.kind), ["paragraph", "paragraph"]);
	if (parsed[0]?.kind === "paragraph") assert.equal(shape(parsed[0].spans), '"one\\ntwo"');
});

test("plain prose is one paragraph and nothing else", () => {
	assert.deepEqual(blocks("just a sentence.").map((block) => block.kind), ["paragraph"]);
	assert.deepEqual(blocks("").map((block) => block.kind), []);
	assert.deepEqual(blocks("   \n\n  ").map((block) => block.kind), []);
});

// --- the peek -------------------------------------------------------------------------

test("plainText strips the syntax and keeps the words", () => {
	assert.equal(plainText("**bold** and `code`"), "bold and code");
	assert.equal(plainText("# Title\n\n- one\n- two"), "Title\n• one\n• two");
	assert.equal(plainText("see [the docs](https://example.com)"), "see the docs");
	assert.equal(plainText("---"), "");
});
