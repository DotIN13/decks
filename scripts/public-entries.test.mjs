// The editor's packages promise only their public entry points: no package exports its internals, and no app imports them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const SHARED = ["canvas", "ui", "agent-ui"];

test("the shared editor packages export no internal paths", () => {
	for (const dir of SHARED) {
		const { exports } = JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8"));
		assert.deepEqual(Object.keys(exports).filter((key) => key.includes("internal")), [], `@decks/${dir}`);
	}
});

test("no app imports a shared package's files by path", () => {
	const deep = new RegExp(`["']@decks/(${SHARED.join("|")})/(internal|src)/`);
	const found = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			if (name === "node_modules" || name === "dist") continue;
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(ts|tsx|mjs|js)$/.test(name) && deep.test(readFileSync(path, "utf8"))) found.push(path.slice(root.length));
		}
	};
	walk(join(root, "apps"));
	assert.deepEqual(found, []);
});
