import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Studio imports these names as @decks/agent-ui/chat and /composer (scripts/public-entries.test.mjs).
// At the switch-over those names point at the two entries here, so each must still export them.

const PAGE = fileURLToPath(new URL("..", import.meta.url));
const STUDIO = {
	"chat/index.ts": ["Stream", "receiveToolResult", "setToolResultSender"],
	"composer/index.ts": ["DraftField", "commentLabel", "draftComments", "draftForAgent", "draftIsEmpty", "draftText", "parseDraft", "shortLabel", "textDraft", "Draft", "DraftFieldApi", "DraftMention"],
};

/** Every name a module exports, following `export * from "./…"`. */
function exported(file: string, depth = 0): Set<string> {
	const text = readFileSync(file, "utf8");
	const names = new Set<string>();
	for (const m of text.matchAll(/export\s+(?:async\s+)?(?:declare\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]!);
	for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) for (const part of m[1]!.split(",")) names.add(part.replace(/\btype\b/g, "").trim().split(/\s+as\s+/).pop()!.trim());
	if (depth < 3) for (const m of text.matchAll(/export\s+\*\s+from\s+"(\.[^"]+)"/g)) for (const name of exported(join(file, "..", m[1]!), depth + 1)) names.add(name);
	return names;
}

test("every name Studio imports resolves from the chat's and the composer's entries", () => {
	for (const [entry, wanted] of Object.entries(STUDIO)) {
		const has = exported(join(PAGE, entry));
		assert.deepEqual(wanted.filter((name) => !has.has(name)), [], entry);
	}
});

test("every name today's agent-ui chat and composer entries export is still exported", () => {
	const old = (file: string) => exported(fileURLToPath(new URL(`../../../packages/agent-ui/src/public/${file}`, import.meta.url)));
	for (const [file, entry] of [["chat.ts", "chat/index.ts"], ["composer.ts", "composer/index.ts"]] as const) {
		const has = exported(join(PAGE, entry));
		assert.deepEqual([...old(file)].filter((name) => !has.has(name)), [], entry);
	}
});
