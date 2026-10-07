import assert from "node:assert/strict";
import { test } from "node:test";
import { applySplice } from "../index.ts";
import { docxBlocks, markdownBlocks, paragraphSplices, readParagraph, texBlocks } from "./blocks.ts";
import { texToHtml } from "./render.ts";

const tiles = (source: string, list: Array<{ start: number; end: number }>) => {
	assert.equal(list[0]!.start, 0);
	for (let i = 1; i < list.length; i++) assert.equal(list[i]!.start, list[i - 1]!.end, "blocks leave no gap");
	assert.equal(list.at(-1)!.end, source.length);
};

test("markdown is cut at blank lines, with a fence and a $$ display kept whole", () => {
	const md = "# Title\n\nOne paragraph\nstill one.\n\n```\ncode\n\nmore code\n```\n\n$$\na\n\nb\n$$\n\nLast.\n";
	const list = markdownBlocks(md);
	tiles(md, list);
	assert.deepEqual(
		list.map((b) => md.slice(b.start, b.end).trim()),
		["# Title", "One paragraph\nstill one.", "```\ncode\n\nmore code\n```", "$$\na\n\nb\n$$", "Last."],
	);
});

test("LaTeX keeps its preamble and its environments whole", () => {
	const tex = "\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\\section{Results}\n\nText here.\n\n\\begin{equation}\na = b\n\n\\end{equation}\n\n\\end{document}\n";
	const list = texBlocks(tex);
	tiles(tex, list);
	assert.equal(list[0]!.kind, "preamble");
	assert.ok(tex.slice(list[3]!.start, list[3]!.end).includes("a = b\n\n\\end{equation}"));
	assert.equal(texToHtml("\\section{Results}"), "<h2>Results</h2>");
	assert.equal(texToHtml("We \\emph{find} 50\\% more, see \\cite{pan}."), '<p>We <i>find</i> 50% more, see <span class="dp-cite">[pan]</span>.</p>');
	assert.equal(texToHtml("\\begin{equation}\\label{e1} a = b \\end{equation}"), "<p>\\[a = b\\]</p>");
});

const DOC = `<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Results</w:t></w:r></w:p><w:p><w:r><w:t>The effect </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>is small</w:t></w:r><w:r><w:t xml:space="preserve"> &amp; real.</w:t></w:r></w:p><w:p/><w:sectPr/></w:body></w:document>`;

test("a .docx is cut at its paragraphs, and a paragraph reads as the words Word shows", () => {
	const list = docxBlocks(DOC);
	tiles(DOC, list);
	const shown = list.filter((b) => b.kind === "text").map((b) => readParagraph(DOC.slice(b.start, b.end)));
	assert.deepEqual(shown.map((p) => p.text), ["Results", "The effect is small & real.", ""]);
	assert.equal(shown[0]!.style, "Heading1");
	assert.deepEqual(shown[1]!.runs.map((r) => [r.text, r.bold]), [["The effect ", false], ["is small", true], [" & real.", false]]);
});

test("typing in a Word paragraph becomes splices of its XML that keep the runs", () => {
	const para = DOC.slice(DOC.indexOf("<w:p><w:r><w:t>The"), DOC.indexOf("<w:p/>"));
	const edit = (xml: string, splice: { at: number; before: string; text: string }) => {
		const out = paragraphSplices(xml, readParagraph(xml), splice).reduce(applySplice, xml);
		return { xml: out, text: readParagraph(out).text };
	};
	const read = readParagraph(para);
	// Typing inside the bold run takes its bold.
	const bold = edit(para, { at: read.text.indexOf("small"), before: "", text: "very " });
	assert.equal(bold.text, "The effect is very small & real.");
	assert.ok(bold.xml.includes("<w:b/></w:rPr><w:t xml:space=\"preserve\">is very small</w:t>"));
	// A deletion across two runs, and an entity, come out right.
	const cut = edit(para, { at: read.text.indexOf("small"), before: "small & ", text: "" });
	assert.equal(cut.text, "The effect is real.");
	// A line break typed is Word's own break.
	const br = edit(para, { at: 3, before: "", text: "\n" });
	assert.equal(br.text, "The\n effect is small & real.");
	assert.ok(br.xml.includes("<w:br/>"));
	// An empty paragraph gets a run of its own.
	const empty = edit("<w:p></w:p>", { at: 0, before: "", text: "New <words>" });
	assert.equal(empty.text, "New <words>");
	assert.ok(empty.xml.includes("New &lt;words&gt;"));
});
