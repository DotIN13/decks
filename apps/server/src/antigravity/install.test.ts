import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mcpServerPath, parseModelsOutput, prepareAntigravityHome } from "./install.ts";

/**
 * The HOME Decks hands every `agy` it spawns.
 *
 * Worth testing because it is the whole security boundary of the integration: everything
 * the CLI can see runs through this directory, and the deal it encodes is that Decks
 * writes *nothing* into the user's own `~/.gemini` — auth, settings and projects arrive
 * as symlinks, and the only real file is Decks' own `mcp_config.json`.
 */

function fakeUserGemini(): { real: string; home: string } {
	const root = mkdtempSync(join(tmpdir(), "agy-install-"));
	// The user's own `.gemini`, complete enough to be signed in.
	mkdirSync(join(root, "user", ".gemini", "antigravity-cli"), { recursive: true });
	mkdirSync(join(root, "user", ".gemini", "config", "projects"), { recursive: true });
	writeFileSync(join(root, "user", ".gemini", "config", "config.json"), "{}", "utf8");
	return { real: join(root, "user", ".gemini"), home: join(root, "sandbox") };
}

test("the sandbox links the user's auth and owns its mcp_config.json", () => {
	const { real, home } = fakeUserGemini();
	try {
		const prepared = prepareAntigravityHome(home, real);
		assert.equal(prepared.ok, true);

		const cli = join(home, ".gemini", "antigravity-cli");
		assert.ok(existsSync(cli), "the CLI's state dir is reachable");
		assert.ok(lstatSync(cli).isSymbolicLink(), "…through a symlink, not a copy");

		const config = join(home, ".gemini", "config");
		assert.ok(lstatSync(join(config, "config.json")).isSymbolicLink());
		assert.ok(lstatSync(join(config, "projects")).isSymbolicLink());

		// The one real file: the canvas-tool server, named with the Node that runs Decks.
		const mcp = JSON.parse(readFileSync(join(config, "mcp_config.json"), "utf8")) as {
			mcpServers?: Record<string, { command?: string; args?: string[] }>;
		};
		assert.equal(mcp.mcpServers?.decks?.args?.[0], mcpServerPath());
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("preparing twice is a quiet no-op", () => {
	const { real, home } = fakeUserGemini();
	try {
		prepareAntigravityHome(home, real);
		const mcp = readFileSync(join(home, ".gemini", "config", "mcp_config.json"), "utf8");
		// The second call must not error on the symlinks that exist, nor rewrite the config.
		const again = prepareAntigravityHome(home, real);
		assert.equal(again.ok, true);
		assert.equal(readFileSync(join(home, ".gemini", "config", "mcp_config.json"), "utf8"), mcp);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("a machine with no `~/.gemini` is refused at the desk", () => {
	const root = mkdtempSync(join(tmpdir(), "agy-nogemini-"));
	const home = join(root, "sandbox");
	try {
		const prepared = prepareAntigravityHome(home, join(root, "user", ".gemini"));
		assert.equal(prepared.ok, false, "no sign-in to reuse must not half-build a sandbox");
		assert.ok(!existsSync(home) || readdirIsEmpty(home));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

function readdirIsEmpty(dir: string): boolean {
	return existsSync(dir) && readdirSync(dir).length === 0;
}

test("`agy models` output parses to rows, noise and all", () => {
	const out = "Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.7-flash-low\tGemini 3.7 Flash (Low)\n";
	assert.deepEqual(parseModelsOutput(out), [
		{ model: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
		{ model: "gemini-3.7-flash-low", label: "Gemini 3.7 Flash (Low)" },
	]);
});