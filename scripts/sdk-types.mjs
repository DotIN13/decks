// Copy the stage API's types (runtime/stage.d.ts) into the SDK (packages/sdk/src/stage.d.ts), so the
// SDK's `decks.stage` is typed by the same file agents read and never drifts from it.
// Run: node scripts/sdk-types.mjs        Check only: node scripts/sdk-types.mjs --check
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = `${root}runtime/stage.d.ts`;
const target = `${root}packages/sdk/src/stage.d.ts`;

export function sdkTypes(text) {
	const body = text
		.replace("inside `{{STAGE_TOOL}}` as `stage`", "as `decks.stage` in the SDK, and to agents as `stage`")
		.replace(/\ndeclare const stage: Stage;\s*$/, "\n");
	return `// Generated from runtime/stage.d.ts by scripts/sdk-types.mjs. Edit that file, then run the script.\n${body}`;
}

const wanted = sdkTypes(readFileSync(source, "utf8"));
if (process.argv.includes("--check")) {
	let have = "";
	try { have = readFileSync(target, "utf8"); } catch {}
	if (have !== wanted) { console.error("packages/sdk/src/stage.d.ts is out of date: run node scripts/sdk-types.mjs"); process.exit(1); }
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
	writeFileSync(target, wanted);
	console.log("wrote packages/sdk/src/stage.d.ts");
}
