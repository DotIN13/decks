#!/usr/bin/env node
// Installs the rewrite's two git hooks in this checkout: node tools/gates/install-hooks.mjs
// commit-msg checks the title and body (rule 7); pre-commit checks your paths against your lane.
import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = execFileSync("git", ["rev-parse", "--git-path", "hooks"], { encoding: "utf8" }).trim();
const hooks = {
	"commit-msg": 'exec node "$(git rev-parse --show-toplevel)/tools/gates/commits.mjs" --hook "$1"',
	"pre-commit": 'exec node "$(git rev-parse --show-toplevel)/tools/gates/lanes.mjs" --staged',
};
for (const [name, line] of Object.entries(hooks)) {
	const path = join(dir, name);
	writeFileSync(path, `#!/bin/sh\n# Installed by tools/gates/install-hooks.mjs\n${line}\n`);
	chmodSync(path, 0o755);
	console.log(`installed ${path}`);
}
