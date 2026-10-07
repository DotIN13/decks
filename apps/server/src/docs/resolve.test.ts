import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveDoc } from "./resolve.ts";

test("a document is named by its deck path, a root's by its absolute path, and .decks/ is refused", () => {
	const top = realpathSync(mkdtempSync(join(tmpdir(), "decks-resolve-")));
	const deck = join(top, "deck");
	const shared = join(top, "shared");
	const readonly = join(top, "readonly");
	for (const dir of [deck, shared, readonly]) mkdirSync(dir);
	const roots = { deck, roots: [{ path: shared, writable: true, exists: true }, { path: readonly, writable: false, exists: true }] };
	assert.deepEqual(resolveDoc(roots, "docs/paper.md"), { file: join(deck, "docs/paper.md"), key: "docs/paper.md", writable: true });
	assert.deepEqual(resolveDoc(roots, join(shared, "a.tex")), { file: join(shared, "a.tex"), key: join(shared, "a.tex"), writable: true });
	assert.equal(resolveDoc(roots, join(readonly, "b.md")).writable, false);
	assert.throws(() => resolveDoc(roots, ".decks/settings.json"), /own record/);
	assert.throws(() => resolveDoc(roots, "../elsewhere.md"), /outside the deck/);
	rmSync(top, { recursive: true, force: true });
});
