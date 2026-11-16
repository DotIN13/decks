import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

// Every token issued for less than a whole caller ends: each callers.issue
// or tokens.issue in server/ passes a third argument, a Scope with until. The
// few that issue a whole caller are in scopes-whole.json, with how many sites
// each file has and why; one more fails, one fewer fails too.

type Whole = Record<string, { sites: number; why: string }>;
const ROOT = new URL("../..", import.meta.url).pathname;
const ISSUE = /(?:callers|tokens)\s*\.issue\s*\(/g;

/** The arguments of a call whose opening paren is at open, split at its top-level commas. */
function argsAt(source: string, open: number): string[] {
	const args: string[] = [];
	let depth = 0;
	let quote: string | undefined;
	let current = "";
	for (let i = open + 1; i < source.length; i++) {
		const c = source[i]!;
		if (quote) {
			current += c;
			if (c === "\\") current += source[++i] ?? "";
			else if (c === quote) quote = undefined;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") quote = c;
		if ("([{".includes(c)) depth++;
		if (")]}".includes(c)) {
			if (depth === 0) return [...args, current.trim()].filter((one) => one.length > 0);
			depth--;
		}
		if (c === "," && depth === 0) (args.push(current.trim()), (current = ""));
		else current += c;
	}
	return args;
}

/** The issue sites in one source that give no Scope with until, by line. */
export function unscoped(source: string): number[] {
	const lines: number[] = [];
	for (const match of source.matchAll(ISSUE)) {
		const open = (match.index ?? 0) + match[0].length - 1;
		const third = argsAt(source, open)[2];
		if (!third || !/\buntil\b/.test(third)) lines.push(source.slice(0, open).split("\n").length);
	}
	return lines;
}

async function sources(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await sources(path)));
		else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(path);
	}
	return out;
}

test("an issue with no Scope, or a Scope with no until, is found", () => {
	assert.deepEqual(unscoped('const a = kernel.callers.issue({ kind: "app", id, name }, "x");'), [1]);
	assert.deepEqual(unscoped('\nk.tokens.issue(who, "x", { canvas, calls: [] });'), [2]);
	assert.deepEqual(unscoped('k.callers.issue(who, "x", { canvas, calls: [f(a, b)], until: Date.now() + 1 });'), []);
});

test("every token issued in server/ for less than a whole caller has a Scope with until", async () => {
	const whole = JSON.parse(await readFile(new URL("scopes-whole.json", import.meta.url), "utf8")) as Whole;
	const found: Record<string, number[]> = {};
	for (const file of await sources(join(ROOT, "server"))) {
		const lines = unscoped(await readFile(file, "utf8"));
		if (lines.length) found[relative(ROOT, file)] = lines;
	}
	const wrong = Object.entries(found)
		.filter(([file, lines]) => lines.length !== (whole[file]?.sites ?? 0))
		.map(([file, lines]) => `${file}: ${lines.length} unscoped (lines ${lines.join(", ")}), ${whole[file]?.sites ?? 0} allowed`);
	const stale = Object.keys(whole).filter((file) => !(file in found)).map((file) => `${file}: allowed, but issues none unscoped now`);
	assert.deepEqual([...wrong, ...stale], [], "give each its Scope with until, or list a whole caller in scopes-whole.json with why");
});
