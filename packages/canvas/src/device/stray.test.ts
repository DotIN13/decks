import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

/**
 * Nothing reads the device on its own: a difference between a desk, a tablet and a phone is a row of
 * the rules table (`rules.json`), read through `profile.ts`, or a style under `data-form` / `data-touch`
 * on the root (in Tailwind markup, the `touch:` variant). A file that asks the pointer, the hover or
 * the system directly is a stray branch, and fails here. The cascade-order stamp is scanned too: it
 * holds every app rule as written, so a media query in a sheet outside these folders shows there.
 */
const ASKS = /pointer-coarse:|pointer-fine:|\bCOARSE\b|\bisPhone\(|matchMedia\("\((pointer|hover)|pointer: coarse|hover: none|hover: hover/;
const ROOT = new URL("../../../../", import.meta.url).pathname;
const SCANNED = ["packages/canvas/src", "packages/canvas/styles", "apps/web/src", "packages/ui/src", "packages/agent-ui/src", "packages/agent-ui/styles"];

function* files(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (name !== "node_modules" && name !== "dist") yield* files(path);
		} else if (/\.(ts|tsx|css|json)$/.test(name) && !/\.test\.ts$/.test(name)) yield path;
	}
}

test("no file reads the device on its own", () => {
	const asking: string[] = [];
	for (const dir of SCANNED) {
		for (const path of files(join(ROOT, dir))) {
			const rel = relative(ROOT, path);
			if (rel.startsWith("packages/canvas/src/device/")) continue;
			if (ASKS.test(readFileSync(path, "utf8"))) asking.push(rel);
		}
	}
	assert.deepEqual(asking, [], "these ask the pointer, hover or system directly: read device/profile.ts's RULES, or style under data-form / data-touch, instead");
});
