// The pass's calls are what the frame really calls: every call name the canvas frame sends (canvas/, its
// socket's act and its line's call, an old name turned as compat turns it) and every call compat's document
// line makes as the pass (server/compat/docs.ts, google.ts) is in PASS_CALLS, or this test names it.
// The agent calls and view.goto stay out: the frame hands them to the page, which asks the person (Reader, 5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CALL_BY_NAME } from "../../protocol/index.ts";
import { isOld, turn } from "@decks/protocol/compat";
import { PASS_CALLS } from "./passes.ts";

const ROOT = new URL("../../", import.meta.url).pathname;

/** The code files under a folder, tests and built output left out. */
function codeFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(join(ROOT, dir))) {
		const rel = `${dir}/${name}`;
		if (/^(node_modules|dist|lib|pkg|target)$/.test(name)) continue;
		if (statSync(join(ROOT, rel)).isDirectory()) out.push(...codeFiles(rel));
		else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
	}
	return out;
}

/** A name as the server takes it: a declared call as it is, an old one as compat turns it; undefined for neither. */
function asCall(name: string): string | undefined {
	if (CALL_BY_NAME.has(name)) return name;
	if (!isOld(name)) return undefined;
	const turned = turn(name, {});
	return "refusal" in turned ? undefined : turned.name;
}

const PAGE_ONLY = (name: string) => name.startsWith("agent.") || name === "view.goto";

/** Every call name the frame and compat-for-the-frame send, with the file that sends it. */
function frameCalls(): Map<string, string> {
	const found = new Map<string, string>();
	const take = (file: string, pattern: RegExp) => {
		for (const m of readFileSync(join(ROOT, file), "utf8").matchAll(pattern)) {
			const call = asCall(m[1]!);
			if (call && !PAGE_ONLY(call) && !found.has(call)) found.set(call, file);
		}
	};
	// The frame: a name handed to its socket (act), its line (call) or its harness.
	for (const file of codeFiles("canvas/host")) take(file, /\b(?:act|call|harness)\(\s*["']([a-z]+\.[a-zA-Z]+)["']/g);
	// Compat's document line acts as the pass: every call name it may make, the git ones chosen by a ternary too.
	for (const file of ["server/compat/docs.ts", "server/compat/google.ts"]) take(file, /["']((?:file|google)\.[a-zA-Z]+)["']/g);
	return found;
}

test("every call the frame and compat's document line make as the pass is one of its calls", () => {
	const allowed = new Set(PASS_CALLS);
	const calls = frameCalls();
	assert.ok(calls.size > 10, `the scan found only ${calls.size} names: the patterns no longer match the code`);
	const missing = [...calls].filter(([name]) => !allowed.has(name)).map(([name, file]) => `${name} (${relative(ROOT, join(ROOT, file))})`);
	assert.deepEqual(missing, [], `the frame calls these, and its pass may not: ${missing.join(", ")}`);
});

test("the pass makes no agent call and no view.goto: the page asks the person first", () => {
	assert.deepEqual(PASS_CALLS.filter(PAGE_ONLY), []);
});
