import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("runtime/skills/canvas-design/schema.md is what the pen package says", () => {
	const root = new URL("../../../", import.meta.url);
	// Throws, with the script's sentence, when a field changed in types.ts or fields.ts and the page did not.
	execFileSync(process.execPath, ["--import", "tsx", "scripts/gen-pen-schema.mjs", "--check"], { cwd: root, stdio: "pipe" });
});
