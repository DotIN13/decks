import assert from "node:assert/strict";
import { test } from "node:test";
import { PILL_LIMIT, pillTip, pillWords } from "./pill-card.ts";

test("a pill's words are cut to fit a sentence, a quotation keeping its closing mark", () => {
	assert.equal(pillWords("plan.pdf"), "plan.pdf");
	const title = pillWords("The chrome choice is who owns the canvas's behaviour rules");
	assert.equal(title.length, PILL_LIMIT);
	assert.ok(title.endsWith("…"));
	const quote = pillWords("“A hidden item lingers one or two frames after it is hidden”");
	assert.ok(quote.length <= PILL_LIMIT && quote.startsWith("“") && quote.endsWith("…”"), quote);
	assert.equal(pillWords("two\nlines"), "two lines");
});

test("the tooltip names the thing, cut short, and cuts a long note", () => {
	const name = "The chrome choice is who owns the canvas's behaviour rules";
	const bare = pillTip({ name, of: "card", source: "On the canvas", exact: "@x" });
	assert.ok(bare.tip.length <= 32 && bare.tip.endsWith("…") && name.startsWith(bare.tip.slice(0, -1)), bare.tip);
	assert.equal(bare.sub, "On the canvas · click to read all");
	const tip = pillTip({ name, of: "card", quote: "q", note: "word ".repeat(100), source: "Your comment", exact: "1. x" });
	assert.ok(tip.tip.length < 200 && tip.tip.endsWith("…"));
	assert.ok(tip.sub.startsWith(bare.tip));
	assert.equal(pillTip({ name: "plan.pdf", of: "file", source: "File", exact: "@plan.pdf" }).tip, "plan.pdf");
});
