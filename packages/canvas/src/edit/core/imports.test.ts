import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

/** Core is the editor with no page under it: it may import itself, the pen types, edit/snap.ts, model/file-kinds.ts and camera/glide.ts, and nothing else. */
test("edit/core imports nothing from the page, Solid or the engine", () => {
	const dir = new URL(".", import.meta.url);
	for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
		const text = readFileSync(new URL(file, dir), "utf8");
		for (const [, from] of text.matchAll(/^\s*import[^"']*["']([^"']+)["']/gm)) {
			const ok = from!.startsWith("./") || from === "@decks/pen" || from === "../snap.ts" || from === "../../model/file-kinds.ts" || from === "../../camera/glide.ts" || from!.startsWith("node:");
			assert.ok(ok, `${file} imports ${from}`);
		}
		assert.ok(!/\b(document|window)\./.test(text.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")), `${file} touches the page`);
	}
});
