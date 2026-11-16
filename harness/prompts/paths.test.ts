// What the prompts folder ships, and that every path names something real.
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { installDir, mcpRelay, opencodeConfigDir, runtimeDir, SHIPPED, skillsDir } from "./paths.ts";

test("every shipped path resolves to something real", () => {
	for (const asset of SHIPPED) {
		const path = join(runtimeDir(), asset.path);
		assert.ok(existsSync(path), `${asset.path} is missing: ${asset.what}`);
		if (asset.dir) assert.ok(statSync(path).isDirectory(), `${asset.path} should be a folder`);
	}
});

test("the named spots are the ones the runtimes ask for", () => {
	assert.ok(isAbsolute(runtimeDir()));
	assert.equal(skillsDir(), join(runtimeDir(), "skills"));
	assert.equal(opencodeConfigDir(), join(runtimeDir(), "opencode"));
	assert.ok(existsSync(mcpRelay()), "the MCP relay the runtimes outside this process run");
});

test("the install folder is the one node_modules sits in", () => {
	assert.ok(existsSync(join(installDir(), "package.json")));
	assert.ok(existsSync(join(installDir(), "node_modules")));
});
