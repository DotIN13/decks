import assert from "node:assert/strict";
import { test } from "node:test";
import { merge3 } from "../merge.ts";
import { FakeDoc } from "./fake.ts";
import { docToMarkdown, parseMarkdown } from "./markdown.ts";
import { plan } from "./plan.ts";

/** A stand-in Doc holding this markdown, written into it the way a page writes. */
function docOf(markdown: string): FakeDoc {
	const doc = FakeDoc.empty("d", "Test");
	doc.apply(plan(doc.toDocument(), markdown));
	return doc;
}

/** The page's markdown written into the Doc: the Doc must then read back as meaning the same. */
function roundTrip(from: string, to: string): { doc: FakeDoc; md: string; requests: number } {
	const doc = docOf(from);
	const requests = plan(doc.toDocument(), to);
	doc.apply(requests);
	const md = docToMarkdown(doc.toDocument());
	assert.deepEqual(parseMarkdown(md), parseMarkdown(to), `the Doc reads back as\n${md}`);
	assert.deepEqual(plan(doc.toDocument(), to), [], "and nothing is left to do");
	return { doc, md, requests: requests.length };
}

const PAPER = `# Photos move the answers

Everyday photos shift what a model **writes**, even when they carry *no* politics.

## Method

- Left-leaning photos: 120 users
- Right-leaning photos: 118 users

1. Score each photo
2. Ask the question

See [the protocol](https://example.com/p) and \`code here\`.
`;

test("markdown written into a Doc reads back as the same markdown", () => {
	const doc = docOf(PAPER);
	assert.equal(docToMarkdown(doc.toDocument()), PAPER);
	assert.match(doc.text(), /^Photos move the answers\nEveryday photos shift/);
});

test("typing inside a word is one insertion, and inside bold it needs no style", () => {
	const { requests } = roundTrip(PAPER, PAPER.replace("shift what", "shift exactly what"));
	assert.equal(requests, 1);
	const bold = roundTrip(PAPER, PAPER.replace("**writes**", "**writes down**"));
	assert.equal(bold.requests, 1);
});

test("styles, headings, bullets and links change by what differs", () => {
	roundTrip(PAPER, PAPER.replace("*no* politics", "no ~~politics~~"));
	roundTrip(PAPER, PAPER.replace("## Method", "### Method"));
	roundTrip(PAPER, PAPER.replace("## Method", "Method"));
	roundTrip(PAPER, PAPER.replace("- Left-leaning", "1. Left-leaning").replace("- Right-leaning", "1. Right-leaning"));
	roundTrip(PAPER, PAPER.replace("- Right-leaning photos: 118 users", "  - Right-leaning photos: 118 users"));
	roundTrip(PAPER, PAPER.replace("[the protocol](https://example.com/p)", "the protocol"));
	roundTrip(PAPER, PAPER.replace("Everyday photos", "[Everyday](https://e.org) photos"));
});

test("paragraphs are added, removed and moved without rewriting the rest", () => {
	roundTrip(PAPER, PAPER.replace("## Method\n", "## Method\n\nA new paragraph under the heading.\n"));
	roundTrip(PAPER, `${PAPER}\nA closing line at the very end.\n`);
	roundTrip(PAPER, `A first line before everything.\n\n${PAPER}`);
	roundTrip(PAPER, PAPER.replace("- Right-leaning photos: 118 users\n", "- Right-leaning photos: 118 users\n- Neutral photos: 64 users\n"));
	roundTrip(PAPER, PAPER.replace("Everyday photos shift what a model **writes**, even when they carry *no* politics.\n\n", ""));
	roundTrip(PAPER, PAPER.replace(/See \[the protocol\].*\n$/, ""));
	roundTrip(PAPER, "Only this.\n");
	roundTrip("One.\n\nTwo.\n\nThree.\n", "Three.\n\nOne.\n\nTwo.\n");
});

test("text that looks like markdown is kept as text, both ways", () => {
	const { md } = roundTrip("Plain.\n", "Use 2 \\* 3 and \\# not a heading, and a_b_c.\n");
	assert.match(md, /2 \\\* 3/);
	assert.deepEqual(parseMarkdown("a lone star * here"), [{ kind: "p", level: 0, runs: [{ text: "a lone star * here" }] }]);
});

test("a picture in the Doc is shown, kept by every edit around it, and never typed", () => {
	const doc = docOf("Before the picture after.\n");
	doc.insertPicture(1 + "Before the picture".length);
	const md = docToMarkdown(doc.toDocument());
	assert.match(md, /picture!\[picture\]\(\) after/);
	doc.apply(plan(doc.toDocument(), md.replace("Before", "Just before")));
	assert.equal(doc.text(), "Just before the picture\uFFFC after.\n");
});

test("a batch against an old revision is refused, as Google refuses it", () => {
	const doc = docOf("One.\n");
	const old = doc.revisionId;
	doc.apply(plan(doc.toDocument(), "One, two.\n"));
	assert.throws(() => doc.apply(plan(doc.toDocument(), "Three.\n"), { requiredRevisionId: old }), /FAILED_PRECONDITION/);
});

test("Google's edits come into the page's text, and the page's own are kept", () => {
	const base = "One line.\n\nTwo line.\n";
	const theirs = "One line, from Google.\n\nTwo line.\n";
	const ours = "One line.\n\nTwo line, typed here.\n";
	assert.equal(merge3(base, theirs, ours).text, "One line, from Google.\n\nTwo line, typed here.\n");
	assert.equal(merge3(base, theirs, theirs).applied.length, 0, "an edit both made is taken once");
});

test("any mix of edits to the markdown is written into the Doc exactly, 400 random documents", () => {
	let seed = 7;
	const rand = (n: number) => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed % n;
	};
	const words = ["photos", "move", "the", "answers", "small", "steady", "model", "writes", "politics", "every"];
	const line = () => {
		const ws = Array.from({ length: 2 + rand(6) }, () => words[rand(words.length)]!);
		const k = rand(ws.length);
		const style = rand(5);
		if (style === 1) ws[k] = `**${ws[k]}**`;
		if (style === 2) ws[k] = `*${ws[k]}*`;
		if (style === 3) ws[k] = `[${ws[k]}](https://x.org/${k})`;
		if (style === 4) ws[k] = `~~${ws[k]}~~`;
		const text = ws.join(" ");
		const kind = rand(6);
		return kind === 0 ? `## ${text}` : kind === 1 ? `- ${text}` : kind === 2 ? `1. ${text}` : text;
	};
	const docMd = (lines: string[]) => `${lines.join("\n\n")}\n`;
	for (let round = 0; round < 400; round++) {
		const lines = Array.from({ length: 1 + rand(6) }, line);
		const next = [...lines];
		for (let e = 0; e < 1 + rand(3); e++) {
			const op = rand(5);
			const i = rand(next.length || 1);
			if (op === 0) next.splice(i, 0, line());
			else if (op === 1 && next.length > 1) next.splice(i, 1);
			else if (op === 2 && next[i]) next[i] = next[i]!.replace(/\b(\w+)\b/, (w) => `${w}s`);
			else if (op === 3 && next[i]) next[i] = line();
			else if (op === 4 && next.length > 1) next.push(next.splice(i, 1)[0]!);
		}
		roundTrip(docMd(lines), docMd(next));
	}
});

test("the Doc's index-aligned text has one character per index, and typing on it lands at exactly those indices", async () => {
	const { docUnits, unitRequests } = await import("./units.ts");
	const doc = docOf(PAPER);
	const units = docUnits(doc.toDocument());
	assert.equal(units.length, doc.toDocument().body!.content!.at(-1)!.endIndex);
	assert.equal(units.slice(1), doc.text());
	let seed = 11;
	const rand = (n: number) => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed % n;
	};
	for (let round = 0; round < 300; round++) {
		const from = docUnits(doc.toDocument());
		let to = from;
		for (let e = 0; e < 1 + rand(3); e++) {
			const at = 1 + rand(to.length - 1);
			const cut = rand(3) === 0 ? rand(6) : 0;
			const text = ["x", "new words ", "\n", "", "ü"][rand(5)]!;
			to = to.slice(0, at) + text + to.slice(Math.min(to.length - 1, at + cut));
		}
		const { requests } = unitRequests(from, to);
		doc.apply(requests);
		const after = docUnits(doc.toDocument());
		// Only the body's last newline is kept where the edit would have taken it.
		assert.equal(after.replace(/\n$/, ""), to.replace(/\n$/, ""), `round ${round}`);
	}
});

test("structure and a cell's last newline are never deleted, and pictures are never typed", async () => {
	const { unitRequests } = await import("./units.ts");
	const from = "one\ncell\ntwo\nend\n";
	const { requests, refused } = unitRequests(from, "one\ntwo\nend\n");
	assert.equal(refused, true);
	for (const r of requests) if ("deleteContentRange" in r) assert.ok(![...from.slice(r.deleteContentRange.range.startIndex, r.deleteContentRange.range.endIndex)].some((c) => c >= "" && c <= ""));
	assert.equal(unitRequests("a\n", "a￼\n").refused, true);
});

test("a paragraph typed after the Doc's last one goes in before the body's final newline, which Docs requires", async () => {
	const { docUnits, unitRequests } = await import("./units.ts");
	const doc = docOf("One.\n\nTwo.\n");
	const from = docUnits(doc.toDocument());
	const to = `${from}Three.\n`;
	doc.apply(unitRequests(from, to).requests);
	assert.equal(docUnits(doc.toDocument()), to);
});

test("the stand-in's tables read as Docs' do: one index each for the table, its rows and cells, and rows and columns go in and out", async () => {
	const { docUnits } = await import("./units.ts");
	const doc = docOf("Before.\n\nAfter.\n");
	doc.apply([{ insertTable: { rows: 2, columns: 2, location: { index: 8 } } }]);
	let d = doc.toDocument();
	const table = d.body!.content!.find((e) => e.table)!;
	assert.equal(table.table!.tableRows!.length, 2);
	assert.equal(docUnits(d).length, d.body!.content!.at(-1)!.endIndex, "every index accounted for");
	const cell = table.table!.tableRows![0]!.tableCells![0]!.content![0]!.startIndex!;
	doc.apply([{ insertText: { location: { index: cell }, text: "A1" } }]);
	doc.apply([{ insertTableRow: { tableCellLocation: { tableStartLocation: { index: table.startIndex! }, rowIndex: 0, columnIndex: 0 }, insertBelow: true } }]);
	doc.apply([{ insertTableColumn: { tableCellLocation: { tableStartLocation: { index: table.startIndex! }, rowIndex: 0, columnIndex: 1 }, insertRight: true } }]);
	d = doc.toDocument();
	const after = d.body!.content!.find((e) => e.table)!.table!;
	assert.equal(after.tableRows!.length, 3);
	assert.equal(after.tableRows![0]!.tableCells!.length, 3);
	assert.equal(after.tableRows![0]!.tableCells![0]!.content![0]!.paragraph!.elements![0]!.textRun!.content, "A1\n");
	assert.equal(docUnits(d).length, d.body!.content!.at(-1)!.endIndex);
	doc.apply([{ deleteTableRow: { tableCellLocation: { tableStartLocation: { index: table.startIndex! }, rowIndex: 2, columnIndex: 0 } } }]);
	assert.equal(doc.toDocument().body!.content!.find((e) => e.table)!.table!.tableRows!.length, 2);
});

test("deleting every paragraph before a table, and every cell's words, reaches the Doc whole: the diff keeps to the table's structure", async () => {
	const { docUnits, segmentEnds, unitRequests } = await import("./units.ts");
	const doc = docOf("Normal one.\n\n## Heading two\n\nNormal three.\n");
	doc.apply([{ insertTable: { rows: 2, columns: 2, location: { index: doc.text().indexOf("Normal three.") + 14 } } }]);
	let d = doc.toDocument();
	const cells = d.body!.content!.find((e) => e.table)!.table!.tableRows!.flatMap((r) => r.tableCells!.map((c) => c.content![0]!.startIndex!));
	doc.apply([{ insertText: { location: { index: cells[3]! }, text: "D" } }, { insertText: { location: { index: cells[0]! }, text: "A" } }]);
	d = doc.toDocument();
	const from = docUnits(d);
	// What the page has: one empty paragraph before the table, empty cells.
	const to = from.slice(0, 1) + from.slice(from.indexOf("Normal three.") + 13).replace(/[AD]/g, "");
	const { requests, refused } = unitRequests(from, to, segmentEnds(d));
	assert.equal(refused, false);
	doc.apply(requests);
	assert.equal(docUnits(doc.toDocument()), to);
});

test("a table cell's last newline cannot go, in the stand-in as in Docs", () => {
	const doc = docOf("Before.\n\nAfter.\n");
	doc.apply([{ insertTable: { rows: 1, columns: 1, location: { index: 8 } } }]);
	const cell = doc.toDocument().body!.content!.find((e) => e.table)!.table!.tableRows![0]!.tableCells![0]!.content![0]!;
	assert.throws(() => doc.apply([{ deleteContentRange: { range: { startIndex: cell.startIndex!, endIndex: cell.endIndex! } } }]), /last newline/);
});

test("a list item's depth comes from the tabs it starts with, and taking its bullet off keeps its text where it sat", () => {
	const doc = docOf("one\n\ntwo\n");
	doc.apply([{ insertText: { location: { index: 5 }, text: "\t" } }, { createParagraphBullets: { range: { startIndex: 1, endIndex: 9 }, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } }]);
	let ps = doc.toDocument().body!.content!.filter((e) => e.paragraph).map((e) => e.paragraph!);
	assert.deepEqual(ps.map((p) => p.bullet?.nestingLevel), [0, 1]);
	assert.equal(doc.text(), "one\ntwo\n");
	doc.apply([{ deleteParagraphBullets: { range: { startIndex: 5, endIndex: 8 } } }]);
	ps = doc.toDocument().body!.content!.filter((e) => e.paragraph).map((e) => e.paragraph!);
	assert.equal(ps[1]!.bullet, undefined);
	assert.equal(ps[1]!.paragraphStyle!.indentStart!.magnitude, 72);
});
