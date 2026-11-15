import { test } from "node:test";
import assert from "node:assert/strict";
import { safeCanvasName, safeSyncPath, secretLooking } from "./sync.ts";

// What a server and Studio check before they trust a name or a path.

test("sync checks canvas names, bundle paths and secrets", () => {
	assert.ok(safeCanvasName("第二集-v2"));
	assert.ok(!safeCanvasName("../x"));
	assert.ok(safeSyncPath("cards/a/index.html"));
	assert.ok(!safeSyncPath("cards/../x"));
	assert.ok(secretLooking("files/.env"));
});
