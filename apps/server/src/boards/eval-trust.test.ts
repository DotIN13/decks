import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EvalTrust } from "./eval-trust.ts";

/**
 * The trust list: what a board can be allowed to do, and what a broken file means.
 *
 * The one that matters is the last: a file that cannot be read is not a list that trusts
 * everything. Any parse failure falls back to trusting nothing, because the failure mode of
 * the other answer — a corrupt file silently running every board's code — is the whole
 * thing this store exists to prevent.
 */

const dir = () => mkdtempSync(join(tmpdir(), "decks-eval-trust-"));

test("nothing is trusted until it is allowed", () => {
	const trust = new EvalTrust(dir());
	assert.equal(trust.allows("boards/plan.html"), false);
	assert.deepEqual(trust.list(), []);
});

test("allowing writes the path, and reading it back agrees", () => {
	const where = dir();
	const trust = new EvalTrust(where);
	trust.allow("boards/plan.html");

	assert.equal(trust.allows("boards/plan.html"), true);
	assert.deepEqual(JSON.parse(readFileSync(join(where, "board-eval.json"), "utf8")), { allowed: ["boards/plan.html"] });
	assert.equal(new EvalTrust(where).allows("boards/plan.html"), true, "and it survives a reopen");
});

test("forgetting takes it back out", () => {
	const where = dir();
	const trust = new EvalTrust(where);
	trust.allow("boards/a.html");
	trust.allow("boards/b.html");
	trust.forget("boards/a.html");

	assert.deepEqual(trust.list(), ["boards/b.html"]);
	assert.equal(new EvalTrust(where).allows("boards/a.html"), false);
});

test("a broken file trusts nothing", () => {
	const where = dir();
	writeFileSync(join(where, "board-eval.json"), "{ not json");
	assert.deepEqual(new EvalTrust(where).list(), []);
	assert.equal(new EvalTrust(where).allows("boards/plan.html"), false);
});

test("a file whose shape is wrong trusts nothing either", () => {
	const where = dir();
	writeFileSync(join(where, "board-eval.json"), JSON.stringify({ allowed: ["boards/ok.html", 42, null] }));
	assert.deepEqual(new EvalTrust(where).list(), ["boards/ok.html"], "only the strings are paths");
});

test("allowing twice is one entry", () => {
	const trust = new EvalTrust(dir());
	trust.allow("boards/plan.html");
	trust.allow("boards/plan.html");
	assert.deepEqual(trust.list(), ["boards/plan.html"]);
});
