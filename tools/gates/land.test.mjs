// The lander's two decisions: whether the lock is held (and by whom), and which folders a branch's files touch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foldersOf, heldBy } from "./land.mjs";

test("the lock is free when absent, and held by its owner file's words", () => {
	const lock = mkdtempSync(join(tmpdir(), "land-lock-"));
	try {
		assert.match(heldBy(lock) ?? "", /^someone who named no owner, since \d\d:\d\d$/);
		writeFileSync(join(lock, "owner"), "Mason full run\n");
		assert.match(heldBy(lock) ?? "", /^Mason full run, since/);
		assert.equal(heldBy(join(lock, "absent")), undefined);
	} finally {
		rmSync(lock, { recursive: true, force: true });
	}
});

test("each file's longest known folder is checked, once", () => {
	assert.deepEqual(foldersOf(["server/upgrade/agents.ts", "server/people/x.ts", "clients/sdk/a.ts", "harness/page/b.ts", "docs/rewrite/WORKING.md", "tools/gates/land.mjs"]), ["clients/sdk", "harness/page", "server", "tools"]);
});
