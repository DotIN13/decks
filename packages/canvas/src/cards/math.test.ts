import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formulaOf, formulaText, MATH_FIRST } from "./math.ts";
import { parseMarkdown } from "./markdown.ts";

/** The formulas a text was read as, by their TeX, and the words left around them. */
const read = (text: string) => {
	const out: string[] = [];
	for (const ch of formulaText(text)) {
		const formula = formulaOf(ch.codePointAt(0)!);
		out.push(formula ? `[${formula.width > 0 ? "math" : "empty"}]` : ch);
	}
	return out.join("");
};

describe("formulaText", () => {
	it("reads $…$ in a line and $$…$$ as formulas", () => {
		assert.equal(read("Area $\\pi r^2$ here"), "Area [math] here");
		assert.equal(read("$$\\int_0^1 x\\,dx$$"), "[math]");
	});
	it("leaves money alone, as Obsidian does", () => {
		assert.equal(read("costs $5 and $10"), "costs $5 and $10");
		assert.equal(read("a $ b $ c"), "a $ b $ c");
		assert.equal(read("price \\$5"), "price $5");
	});
	it("gives one formula one character, however often it is asked for", () => {
		assert.equal(formulaText("$x^2$"), formulaText("$x^2$"));
		assert.ok(formulaText("$x^2$").codePointAt(0)! >= MATH_FIRST);
	});
});

describe("formulas in a card", () => {
	it("are runs of their own, and $$ on its own lines is a block", () => {
		const [para] = parseMarkdown("where $x^2$ sits");
		assert.deepEqual(para && "runs" in para ? para.runs.map((r) => r.math?.tex ?? r.text) : [], ["where ", "x^2", " sits"]);
		assert.deepEqual(parseMarkdown("$$\n\\frac{a}{b}\n$$"), [{ kind: "math", tex: "\\frac{a}{b}" }]);
		assert.deepEqual(parseMarkdown("$5 and $10"), [{ kind: "paragraph", runs: [{ text: "$5 and $10" }] }]);
	});
});
