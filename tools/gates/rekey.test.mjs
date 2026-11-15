// A moved file's or folder's baseline keys move with it, same counts, in every gate's baseline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moved, rekey } from "./rekey.mjs";

const scratch = (baselines) => {
	const root = mkdtempSync(join(tmpdir(), "rekey-"));
	mkdirSync(join(root, "tools/gates/baseline"), { recursive: true });
	for (const [name, keys] of Object.entries(baselines)) writeFileSync(join(root, `tools/gates/baseline/${name}.json`), JSON.stringify(keys));
	return root;
};
const read = (root, name) => JSON.parse(readFileSync(join(root, `tools/gates/baseline/${name}.json`), "utf8"));

test("a file and a folder move; others and look-alike names stay", () => {
	const pairs = [["packages/stage/src/a.ts", "engine/src/a.ts"], ["packages/canvas/src", "canvas"]];
	assert.equal(moved("packages/stage/src/a.ts", pairs), "engine/src/a.ts");
	assert.equal(moved("packages/canvas/src/ui/x.css", pairs), "canvas/ui/x.css");
	assert.equal(moved("packages/canvas/srcx/y.ts", pairs), "packages/canvas/srcx/y.ts");
});

test("keys move with the same counts, the legacy gate's prefix kept, a collision summed", () => {
	const root = scratch({
		names: { "packages/canvas/src/a.ts: stage": 3, "server/b.ts: board": 1 },
		legacy: { "stale-paths: packages/canvas/src/m.md: x.ts": 1 },
		readme: { "packages/canvas/src: has no README.md": 1 },
		size: { "packages/canvas/src/a.ts: over 400 lines": 1, "canvas/a.ts: over 400 lines": 1 },
	});
	assert.equal(rekey(root, [["packages/canvas/src", "canvas"]]), 4);
	assert.deepEqual(read(root, "names"), { "canvas/a.ts: stage": 3, "server/b.ts: board": 1 });
	assert.deepEqual(read(root, "legacy"), { "stale-paths: canvas/m.md: x.ts": 1 });
	assert.deepEqual(read(root, "readme"), { "canvas: has no README.md": 1 });
	assert.deepEqual(read(root, "size"), { "canvas/a.ts: over 400 lines": 2 });
});

test("an imports key's old unit moves with the package's files: its name in the text too", () => {
	const root = scratch({
		imports: {
			"packages/pen/src/a.ts: reaches past the entry of packages/pen": 1,
			"harness/x.ts: harness may not import pen (packages/pen)": 2,
			"harness/y.ts: harness may not import pen (packages/penny)": 1,
		},
	});
	rekey(root, [["packages/pen/src/a.ts", "pen/a.ts"], ["packages/pen/package.json", "pen/package.json"]]);
	assert.deepEqual(read(root, "imports"), {
		"pen/a.ts: reaches past the entry of pen": 1,
		"harness/x.ts: harness may not import pen (pen)": 2,
		"harness/y.ts: harness may not import pen (packages/penny)": 1,
	});
});
