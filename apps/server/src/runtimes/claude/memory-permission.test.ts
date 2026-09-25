import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inMemoryFolder } from "./backend.ts";

/*
 * Which writes count as the agent's own memory, allowed in auto mode without a question. Too
 * wide and auto mode waves through writes it should ask about; too narrow and the question stays.
 */

test("a file in a project's memory folder counts, by the linked spelling and the real one", () => {
	const root = mkdtempSync(join(tmpdir(), "decks-memory-"));
	try {
		const real = join(root, "accounts", "agent");
		mkdirSync(join(real, "projects", "-home-decks-data-decks", "memory"), { recursive: true });
		const link = join(root, "link");
		symlinkSync(real, link);
		assert.ok(inMemoryFolder(link, join(link, "projects", "-home-decks-data-decks", "memory", "note.md")));
		assert.ok(inMemoryFolder(link, join(real, "projects", "-home-decks-data-decks", "memory", "MEMORY.md")));
		assert.ok(inMemoryFolder(link, join(link, "projects", "-tmp-decks-isolation-x", "memory", "new.md")), "a memory folder not made yet");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("nothing else in the config folder counts, and nothing outside it", () => {
	const root = mkdtempSync(join(tmpdir(), "decks-memory-"));
	try {
		const config = join(root, "config");
		mkdirSync(join(config, "projects", "p", "memory"), { recursive: true });
		assert.ok(!inMemoryFolder(config, join(config, "settings.json")));
		assert.ok(!inMemoryFolder(config, join(config, "projects", "p", "session.jsonl")));
		assert.ok(!inMemoryFolder(config, join(config, "projects", "memory.md")));
		assert.ok(!inMemoryFolder(config, join(config, "projects", "p", "memory", "..", "..", "..", "settings.json")));
		assert.ok(!inMemoryFolder(config, join(root, "elsewhere", "projects", "p", "memory", "note.md")));
		assert.ok(!inMemoryFolder(config, "/etc/passwd"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
