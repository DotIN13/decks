import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("the SDK's stage types are the stage API's, copied by scripts/sdk-types.mjs", () => {
	const script = fileURLToPath(new URL("./sdk-types.mjs", import.meta.url));
	assert.doesNotThrow(() => execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" }), "run node scripts/sdk-types.mjs after changing runtime/stage.d.ts");
});
