import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

/**
 * Nothing reads the device on its own: a difference between a desk, a tablet and a phone is a row of
 * the rules table (`rules.json`), read through `profile.ts`, or a style under `data-form` / `data-touch`
 * on the root. These files still ask the pointer, the hover or the system directly, from before the
 * table; the remodel's chrome step takes them off this list one by one. A file not on it that asks is
 * a new stray branch, and fails here; a file on it that no longer asks fails too, so the list shrinks.
 */
const STILL_ASKING = new Set([
	"apps/web/src/index.css",
	"apps/web/src/lib/media.ts",
	"apps/web/src/styles/agents.css",
	"apps/web/src/styles/cascade-order.json",
	"apps/web/src/styles/composer.css",
	"apps/web/src/styles/dock.css",
	"apps/web/src/styles/inspector.css",
	"apps/web/src/styles/panel.css",
	"apps/web/src/styles/settings.css",
	"apps/web/src/styles/shell.css",
	"apps/web/src/styles/stages.css",
	"apps/web/src/styles/v3.css",
	"packages/canvas/src/edit/core/overlay-json.ts",
	"packages/canvas/src/edit/dom/OverlayLayer.tsx",
	"packages/canvas/src/edit/dom/touch-rules.ts",
	"packages/canvas/src/items/item-slot.tsx",
	"packages/canvas/src/render/device.ts",
	"packages/canvas/src/stage/Stage.tsx",
	"packages/canvas/src/stage/selection.tsx",
	"packages/canvas/src/ui/Callout.tsx",
	"packages/canvas/src/ui/Properties.tsx",
	"packages/canvas/styles/canvas.css",
	"packages/canvas/styles/chrome.css",
	"packages/canvas/styles/properties.css",
	"packages/canvas/styles/tokens.css",
]);

const ASKS = /\bCOARSE\b|\bisPhone\(|matchMedia\("\((pointer|hover)|pointer: coarse|hover: none|hover: hover/;
const ROOT = new URL("../../../../", import.meta.url).pathname;
const SCANNED = ["packages/canvas/src", "packages/canvas/styles", "apps/web/src", "packages/ui/src"];

function* files(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (name !== "node_modules" && name !== "dist") yield* files(path);
		} else if (/\.(ts|tsx|css|json)$/.test(name) && !/\.test\.ts$/.test(name)) yield path;
	}
}

test("no file reads the device on its own but the ones still on the list, and every one on it still does", () => {
	const asking: string[] = [];
	for (const dir of SCANNED) {
		for (const path of files(join(ROOT, dir))) {
			const rel = relative(ROOT, path);
			if (rel.startsWith("packages/canvas/src/device/")) continue;
			if (ASKS.test(readFileSync(path, "utf8"))) asking.push(rel);
		}
	}
	const stray = asking.filter((rel) => !STILL_ASKING.has(rel));
	assert.deepEqual(stray, [], "new files that ask the pointer, hover or system directly: read device/profile.ts's RULES, or style under data-form / data-touch, instead");
	const done = [...STILL_ASKING].filter((rel) => !asking.includes(rel));
	assert.deepEqual(done, [], "these no longer ask: take them off STILL_ASKING");
});
