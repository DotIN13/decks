// A moved file's or folder's baseline keys move with it, same counts, in every gate's baseline.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moved, rekey, splitKeys } from "./rekey.mjs";

/** Every temp folder a test here makes, removed when the file's tests end. */
const made = [];
after(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const scratch = (baselines) => {
	const root = mkdtempSync(join(tmpdir(), "rekey-"));
	made.push(root);
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
		size: { "packages/canvas/src/a.ts: over 1000 lines": 1, "canvas/a.ts: over 1000 lines": 1 },
	});
	assert.equal(rekey(root, [["packages/canvas/src", "canvas"]]), 4);
	assert.deepEqual(read(root, "names"), { "canvas/a.ts: stage": 3, "server/b.ts: board": 1 });
	assert.deepEqual(read(root, "legacy"), { "stale-paths: canvas/m.md: x.ts": 1 });
	assert.deepEqual(read(root, "readme"), { "canvas: has no README.md": 1 });
	assert.deepEqual(read(root, "size"), { "canvas/a.ts: over 1000 lines": 2 });
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

test("a split's new files carry its exceptions, never above its total", () => {
	const before = { "canvas/gesture.ts: board": 106, "canvas/gesture.ts: over 1000 lines": 1 };
	const split = { added: ["canvas/a.ts", "canvas/b.ts"], modified: ["canvas/gesture.ts"] };
	const kept = { "canvas/gesture.ts: board": 50, "canvas/a.ts: board": 30, "canvas/b.ts: board": 20, "canvas/a.ts: over 1000 lines": 1 };
	assert.deepEqual([...splitKeys(before, kept, split)].sort(), ["canvas/a.ts: board", "canvas/a.ts: over 1000 lines", "canvas/b.ts: board"]);
	const more = { "canvas/gesture.ts: board": 90, "canvas/a.ts: board": 30 };
	assert.deepEqual([...splitKeys(before, more, split)], [], "120 of a kind the file had 106 of is growth");
	assert.deepEqual([...splitKeys(before, { "canvas/a.ts: stage": 1 }, split)], [], "a kind the file never had is growth");
});
