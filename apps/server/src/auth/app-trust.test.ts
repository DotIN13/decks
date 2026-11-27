import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AppTrust } from "./app-trust.ts";

/**
 * The trust list: what a card can be allowed to do, and what a broken file means.
 *
 * The one that matters is the last: a file that cannot be read is not a list that trusts
 * everything. Any parse failure falls back to trusting nothing, because the failure mode of
 * the other answer — a corrupt file silently running every card's code — is the whole
 * thing this store exists to prevent.
 */

const dir = () => mkdtempSync(join(tmpdir(), "decks-eval-trust-"));

test("nothing is trusted until it is allowed", () => {
	const trust = new AppTrust(dir());
	assert.equal(trust.allows("pages/plan.html"), false);
	assert.deepEqual(trust.list(), []);
});

test("allowing writes the path, and reading it back agrees", () => {
	const where = dir();
	const trust = new AppTrust(where);
	trust.allow("pages/plan.html");

	assert.equal(trust.allows("pages/plan.html"), true);
	assert.deepEqual(JSON.parse(readFileSync(join(where, "app-trust.json"), "utf8")), { allowed: ["pages/plan.html"] });
	assert.equal(new AppTrust(where).allows("pages/plan.html"), true, "and it survives a reopen");
});

test("forgetting takes it back out", () => {
	const where = dir();
	const trust = new AppTrust(where);
	trust.allow("pages/a.html");
	trust.allow("pages/b.html");
	trust.forget("pages/a.html");

	assert.deepEqual(trust.list(), ["pages/b.html"]);
	assert.equal(new AppTrust(where).allows("pages/a.html"), false);
});

test("a broken file trusts nothing", () => {
	const where = dir();
	writeFileSync(join(where, "app-trust.json"), "{ not json");
	assert.deepEqual(new AppTrust(where).list(), []);
	assert.equal(new AppTrust(where).allows("pages/plan.html"), false);
});

test("a file whose shape is wrong trusts nothing either", () => {
	const where = dir();
	writeFileSync(join(where, "app-trust.json"), JSON.stringify({ allowed: ["pages/ok.html", 42, null] }));
	assert.deepEqual(new AppTrust(where).list(), ["pages/ok.html"], "only the strings are paths");
});

test("allowing twice is one entry", () => {
	const trust = new AppTrust(dir());
	trust.allow("pages/plan.html");
	trust.allow("pages/plan.html");
	assert.deepEqual(trust.list(), ["pages/plan.html"]);
});
