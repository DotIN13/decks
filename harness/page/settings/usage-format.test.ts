import assert from "node:assert/strict";
import { test } from "node:test";
import { behaviorLabel, duration, exact, modelLabel, money, planLabel, resetsAt, resetsIn, tokens } from "./usage-format.ts";

test("token counts read as magnitudes", () => {
	assert.equal(tokens(0), "0");
	assert.equal(tokens(940), "940");
	assert.equal(tokens(1400), "1.4k");
	assert.equal(tokens(148_000), "148k");
	assert.equal(tokens(1_240_000), "1.24M");
	// Two decimals under ten million, one above: `2.40M` keeps its column width against
	// `1.24M`, which is the point of the figures being tabular in the first place.
	assert.equal(tokens(2_400_000), "2.40M");
	assert.equal(tokens(24_000_000), "24.0M");
});

test("a cost is never rounded down to nothing", () => {
	// A session that cost a third of a cent is not a free one, and `$0.00` says it was.
	assert.equal(money(0.0033), "$0.0033");
	assert.equal(money(0.00001), "$0.0001");
	assert.equal(money(0.42), "$0.420");
	assert.equal(money(11.5), "$11.50");
	assert.equal(money(0), "$0.00");
});

test("a duration stops at two units", () => {
	assert.equal(duration(4200), "4s");
	assert.equal(duration(95_000), "1m 35s");
	assert.equal(duration(3_900_000), "1h 5m");
	assert.equal(duration(0), "0s");
});

test("a reset in the past reads as now, not as a negative", () => {
	// The panel is a snapshot. A window that turned over while it was open has not gone
	// wrong, and "-3m" would say something did.
	const now = Date.parse("2026-09-04T12:00:00Z");
	assert.equal(resetsIn("2026-09-04T11:57:00Z", now), "now");
	assert.equal(resetsIn("2026-09-04T12:40:00Z", now), "40m");
	assert.equal(resetsIn("2026-09-04T16:20:00Z", now), "4h 20m");
	assert.equal(resetsIn("2026-09-07T12:00:00Z", now), "3d");
});

test("no reset is null rather than a made-up one", () => {
	assert.equal(resetsIn(null, Date.now()), null);
	assert.equal(resetsIn("not a date", Date.now()), null);
	assert.equal(resetsAt(null, Date.now()), null);
});

test("the wall-clock reset names a day only when it is not today", () => {
	const now = Date.parse("2026-09-04T12:00:00Z");
	assert.equal(/\d/.test(resetsAt("2026-09-04T16:20:00Z", now) ?? ""), true);
	assert.match(resetsAt("2026-09-11T16:20:00Z", now) ?? "", /Sep/);
});

test("a model id loses what every row shares and keeps what it does not", () => {
	assert.equal(modelLabel("claude-sonnet-4-5-20250929"), "sonnet-4-5");
	// The bracket is a different context window and a different price — the table's subject.
	assert.equal(modelLabel("claude-opus-5[1m]"), "opus-5[1m]");
	assert.equal(modelLabel("gpt-5-codex"), "gpt-5-codex");
});

test("an unknown plan or behaviour appears as itself", () => {
	assert.equal(planLabel("max"), "Max plan");
	assert.equal(planLabel(null), null);
	assert.equal(behaviorLabel("long_context"), "Long context");
	assert.equal(behaviorLabel("brand_new_thing"), "brand new thing");
});

test("exact is every digit, for the figure that is a count", () => {
	assert.equal(exact(148_000), "148,000");
});
