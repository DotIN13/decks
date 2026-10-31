import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/*
 * The upgrade guarantee, in the imports: the migrations keep an old deck migrating after the board
 * code is gone, so nothing they load, directly or through what they import, may be the board code:
 * `boards/` (the board shell), `routes/board-pages` or the board runtime.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");

/** What a migration may import from the rest of the server, directly. */
const ALLOWED = new Set(["deck/loader.ts", "deck/layout.ts", "deck/roots.ts", "pictures/ladder.ts", "cards/size.ts", "stage/canvas-files.ts", "config.ts", "agents/slug.ts", "agents/store.ts"]);

const isForbidden = (path: string) => /^boards\//.test(path) || /^routes\/board-pages(\.|\/)/.test(path) || /(^|\/)lib\/board\.js$/.test(path);

/** Every module a file names: `import … from`, `export … from`, bare `import "…"` and `import("…")`, type-only ones included. */
function specifiers(file: string): string[] {
	const text = readFileSync(file, "utf8");
	const out: string[] = [];
	for (const match of text.matchAll(/\b(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) out.push((match[1] ?? match[2] ?? match[3])!);
	return out;
}

const migrationFiles = () =>
	readdirSync(HERE)
		.filter((name) => name.endsWith(".ts"))
		.map((name) => join(HERE, name));

const fromSrc = (file: string) => relative(SRC, file).split(sep).join("/");

test("no migration imports the board code, and each imports from the server only what the upgrade guarantee names", () => {
	for (const file of migrationFiles()) {
		for (const spec of specifiers(file)) {
			assert.doesNotMatch(spec, /(^|\/)boards(\/|$)|board-pages|boards\/shell|renderShell|lib\/board\.js/, `${fromSrc(file)} imports ${spec}`);
			if (!spec.startsWith(".")) continue;
			const target = fromSrc(resolve(dirname(file), spec));
			assert.ok(!isForbidden(target), `${fromSrc(file)} imports ${target}`);
			if (target.startsWith("migrations/") || file.endsWith(".test.ts")) continue;
			assert.ok(ALLOWED.has(target), `${fromSrc(file)} imports ${target}, which the upgrade guarantee does not name (migrations import only ${[...ALLOWED].join(", ")})`);
		}
	}
});

test("nothing the migration runner loads, through any chain of the server's own imports, is the board code", () => {
	const seen = new Set<string>();
	const chain = new Map<string, string>();
	const queue = [join(HERE, "index.ts"), join(HERE, "migrate.ts")];
	while (queue.length) {
		const file = queue.pop()!;
		if (seen.has(file) || !existsSync(file)) continue;
		seen.add(file);
		for (const spec of specifiers(file)) {
			if (!spec.startsWith(".")) continue;
			const target = resolve(dirname(file), spec);
			if (!target.startsWith(SRC + sep)) continue;
			if (!chain.has(target)) chain.set(target, file);
			queue.push(target);
		}
	}
	for (const file of seen) {
		const path = fromSrc(file);
		if (!isForbidden(path)) continue;
		const route: string[] = [path];
		for (let at = chain.get(file); at; at = chain.get(at)) route.unshift(fromSrc(at));
		assert.fail(`the migrations load ${path}: ${route.join(" -> ")}`);
	}
	assert.ok(seen.size > 10, "the import graph was walked");
});
