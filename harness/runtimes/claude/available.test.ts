import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CLAUDE_BUNDLED_ENV, CLAUDE_PATH_ENV, claudeAvailability, claudeBundledExecutable, claudeExecutable } from "./available.ts";

/**
 * Finding the CLI, which the SDK will not do for us.
 *
 * `PATH` is set explicitly in each case rather than trusted: whether the machine running
 * the tests happens to have Claude Code installed is not what is being tested.
 */
function withEnv(env: Record<string, string | undefined>, body: () => void): void {
	const before = { ...process.env };
	Object.assign(process.env, env);
	for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key];
	try {
		body();
	} finally {
		process.env = before;
	}
}

test("an explicit override wins, if it exists", () => {
	const dir = mkdtempSync(join(tmpdir(), "decks-claude-"));
	const real = join(dir, "claude");
	writeFileSync(real, "#!/bin/sh\n");

	withEnv({ PATH: "", [CLAUDE_PATH_ENV]: real }, () => {
		assert.equal(claudeExecutable(), real);
		assert.equal(claudeAvailability().available, true);
	});
	// An override that is not there falls through rather than being trusted.
	withEnv({ PATH: "", [CLAUDE_PATH_ENV]: join(dir, "nope") }, () => {
		assert.equal(claudeExecutable(), undefined);
	});
});

test("PATH is searched when nothing is set", () => {
	const dir = mkdtempSync(join(tmpdir(), "decks-claude-path-"));
	writeFileSync(join(dir, "claude"), "#!/bin/sh\n");
	withEnv({ PATH: dir, [CLAUDE_PATH_ENV]: undefined }, () => {
		assert.equal(claudeExecutable(), join(dir, "claude"));
	});
});

test("nothing found says what to do about it", () => {
	// The bundled binary is disabled explicitly, or this machine's own install would
	// answer instead of the "nothing found" branch.
	withEnv({ PATH: "", [CLAUDE_PATH_ENV]: undefined, [CLAUDE_BUNDLED_ENV]: "0" }, () => {
		const availability = claudeAvailability();
		assert.equal(availability.available, false);
		assert.match(availability.reason ?? "", /Install Claude Code/);
		assert.match(availability.reason ?? "", new RegExp(CLAUDE_PATH_ENV), "and names the variable to set");
	});
});

test("the SDK's own bundled binary counts as available", (t) => {
	if (!claudeBundledExecutable()) {
		t.skip("no bundled Claude Code on this machine");
		return;
	}
	withEnv({ PATH: "", [CLAUDE_PATH_ENV]: undefined, [CLAUDE_BUNDLED_ENV]: undefined }, () => {
		assert.equal(claudeExecutable(), undefined, "nothing on PATH");
		assert.equal(claudeAvailability().available, true, "but the bundle exists, so the agent can start");
	});
});