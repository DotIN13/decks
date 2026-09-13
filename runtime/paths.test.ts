import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { antigravityServer, installDir, opencodeConfigDir, runtimeDir, runtimeLib, SHIPPED, skillsDir, stageDts, toolDescription } from "./paths.ts";

/**
 * What this build ships, and where it says it is.
 *
 * The paths used to be four independent sums in four files, each correct about a different
 * depth, and nothing checked that any of them pointed at a directory that existed. A broken
 * one showed up as an agent that could not read a board, several hundred milliseconds later,
 * with a path in the message.
 */

test("every path resolves to something real", () => {
	for (const asset of SHIPPED) {
		const path = join(runtimeDir(), asset.path);
		assert.ok(existsSync(path), `${asset.path} is missing — ${asset.what}`);
		if (asset.dir) assert.ok(statSync(path).isDirectory(), `${asset.path} should be a directory`);
	}
});

test("the named spots are the ones the app asks for", () => {
	assert.ok(isAbsolute(runtimeDir()));
	assert.equal(runtimeLib(), join(runtimeDir(), "lib"));
	assert.equal(skillsDir(), join(runtimeDir(), "skills"));
	assert.equal(stageDts(), join(runtimeDir(), "stage.d.ts"));
	assert.equal(toolDescription(), join(runtimeDir(), "tool-description.txt"));
	assert.equal(opencodeConfigDir(), join(runtimeDir(), "opencode"));
	assert.equal(antigravityServer(), join(runtimeDir(), "antigravity", "mcp-server.mjs"));
});

test("the install directory is the one node_modules sits in", () => {
	// This is the value handed to an agent as `DECKS_APP_DIR`, and the `board-debug` skill
	// anchors `createRequire` on it to find Playwright — from a deck, which is not inside the
	// install. A wrong answer here is a skill that cannot work, only for agents, only
	// sometimes.
	assert.ok(existsSync(join(installDir(), "package.json")), "installDir is not a package root");
	assert.ok(existsSync(join(installDir(), "node_modules")), "installDir has no node_modules");
});

test("the two out-of-process shims are where their runtimes are told to look", () => {
	// opencode is handed this directory as `OPENCODE_CONFIG_DIR`, and the file name is the
	// tool name — `tools/stage_eval.ts` is the tool `stage_eval`.
	assert.ok(existsSync(join(opencodeConfigDir(), "tools", "stage_eval.ts")));
	// antigravity is given this path as an MCP server command in its own config.
	assert.ok(existsSync(antigravityServer()));
});

test("the description every runtime shows is one file", () => {
	// Read by the server's tool, by opencode's loader and by antigravity's MCP server. The
	// server asserts the same thing from its side (`stage/tool.test.ts`); this is the one
	// that fails if the file itself is missing from a checkout.
	const text = existsSync(toolDescription()) ? readFileSync(toolDescription(), "utf8") : "";
	assert.ok(text.length > 500, "the tool description is missing or empty");
});
