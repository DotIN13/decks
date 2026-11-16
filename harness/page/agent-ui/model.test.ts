import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HOST_FIELDS, HOST_TOKENS, missingFromHost, OPTIONAL_TOKENS } from "./model.ts";

// The entry's promise to another program: it reaches nothing of the harness's page but the chat, the
// composer and itself, and nothing else but packages Studio has; and a host may leave any field out.

const PAGE = fileURLToPath(new URL("..", import.meta.url));
const OWN = ["agent-ui/", "chat/", "composer/"];
const PACKAGES = ["solid-js", "lucide-solid", "@decks/ui", "@decks/protocol", "@decks/canvas", "@decks/pen"];
const IMPORT = /^\s*(?:import|export)\s[^'";]*?from\s*["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;

/** Every file the entry reaches by relative imports, and every package it names. */
function reach(entry: string): { files: Set<string>; packages: Set<string> } {
	const files = new Set<string>();
	const packages = new Set<string>();
	const walk = (file: string) => {
		if (files.has(file)) return;
		files.add(file);
		for (const m of readFileSync(file, "utf8").matchAll(IMPORT)) {
			const spec = (m[1] ?? m[2])!;
			if (!spec.startsWith(".")) packages.add(spec);
			else if (!spec.endsWith(".css")) walk(join(dirname(file), spec));
			else if (!existsSync(join(dirname(file), spec))) throw new Error(`${file} names a missing sheet ${spec}`);
		}
	};
	walk(join(PAGE, entry));
	return { files, packages };
}

test("a host may leave every field out, and says which it left", () => {
	assert.deepEqual(missingFromHost({}), [...HOST_FIELDS]);
	assert.deepEqual(missingFromHost({ notice: () => {}, api: (path) => path }), ["authHeaders", "AgentFace", "AgentMenu", "FiveHour"]);
});

test("the entry reaches only the chat, the composer and itself in the harness's page", () => {
	const { files } = reach("agent-ui/index.ts");
	const outside = [...files].map((file) => relative(PAGE, file)).filter((file) => !OWN.some((own) => file.startsWith(own)));
	assert.deepEqual(outside, []);
	// The page's own glue stays out: it reads the page's state, which another program does not have.
	const glue = [...files].map((file) => relative(PAGE, file)).filter((file) => /^(chat\/(focused|section)\/|composer\/(bar\/sending|pill\/finding)\.ts)/.test(file));
	assert.deepEqual(glue, []);
});

test("and names no package another program would not have", () => {
	const { packages } = reach("agent-ui/index.ts");
	const unknown = [...packages].filter((spec) => !PACKAGES.some((name) => spec === name || spec.startsWith(`${name}/`)));
	assert.deepEqual(unknown, []);
});

test("the tokens the sheets read from the host are exactly HOST_TOKENS and OPTIONAL_TOKENS", () => {
	const sheets = [...readFileSync(join(PAGE, "agent-ui/styles.css"), "utf8").matchAll(/@import "\.\.\/([^"]+)"/g)].map((m) => readFileSync(join(PAGE, m[1]!), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
	const read = new Set(sheets.flatMap((css) => [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]!)));
	const own = new Set(sheets.flatMap((css) => [...css.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map((m) => m[1]!)));
	const fromHost = [...read].filter((token) => !own.has(token)).sort();
	assert.deepEqual(fromHost, [...HOST_TOKENS, ...OPTIONAL_TOKENS].sort());
});
