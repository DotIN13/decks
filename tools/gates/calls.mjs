// Rule 4: a call is declared once in the protocol and handled once; everything else is generated.
// Checks: defineCall only in protocol/, each name declared once, each call handled once in server/ and harness/.
// Today's two tables (packages/api verbs.ts and person.ts) count each name declared in both.
// Test files are not counted: they declare calls to test the builders.
import { CODE, bump, isSource } from "./lib.mjs";

const DEFINE = /defineCall\s*\(\s*\{[^}]*?name:\s*["']([\w.]+)["']/gs;
const HANDLE = /\bhandle\s*\(\s*([\w.$]+)\s*,/g;
const TEST = /\.test\.[a-z]+$/;
const OLD_TABLES = ["packages/api/src/verbs.ts", "packages/api/src/person.ts"];

function declarations(ctx, counts) {
	const seen = new Map();
	for (const f of ctx.files.filter((f) => isSource(f) && CODE.test(f) && !TEST.test(f))) {
		for (const m of ctx.read(f).matchAll(DEFINE)) {
			if (!f.startsWith("protocol/")) bump(counts, `${f}: declares ${m[1]} outside protocol/`);
			seen.set(m[1], [...(seen.get(m[1]) || []), f]);
		}
	}
	for (const [name, where] of seen) if (where.length > 1) bump(counts, `${where[1]}: declares ${name} again`);
}

function handlers(ctx, counts) {
	const seen = new Map();
	const inPrograms = (f) => f.startsWith("server/") || f.startsWith("harness/");
	for (const f of ctx.files.filter((f) => isSource(f) && CODE.test(f) && inPrograms(f) && !TEST.test(f))) {
		for (const m of ctx.read(f).matchAll(HANDLE)) {
			const name = m[1].split(".").pop();
			if (seen.has(name)) bump(counts, `${f}: handles ${name} again (first in ${seen.get(name)})`);
			else seen.set(name, f);
		}
	}
}

function oldTables(ctx, counts) {
	const names = OLD_TABLES.filter(ctx.exists).map((f) => new Set([...ctx.read(f).matchAll(/name:\s*"([\w.]+)"/g)].map((m) => m[1])));
	if (names.length < 2) return;
	for (const n of names[0]) if (names[1].has(n)) bump(counts, `${OLD_TABLES[1]}: declares ${n} again`);
}

export default {
	name: "calls",
	rule: "4. A call is declared once in the protocol and handled once; everything else is generated.",
	scan(ctx) {
		const counts = new Map();
		declarations(ctx, counts);
		handlers(ctx, counts);
		oldTables(ctx, counts);
		return { counts, notes: ["Not checked: that the clients' call lists are generated, not written by hand."] };
	},
};
