import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The README's fence: this folder imports the protocol, the kernel, its own
// files and node's crypto, never a runtime, a model, a login or a transcript.

const HERE = new URL(".", import.meta.url).pathname;
const ALLOWED = [/^\.\.\/\.\.\/protocol\/index\.ts$/, /^\.\.\/kernel\/(types|testing|events|index)\.ts$/, /^\.\/[\w-]+(\.test)?\.ts$/, /^node:(crypto|test|assert\/strict|fs|path)$/];

test("nothing in server/people imports a runtime, a model or a transcript", () => {
	const bad: string[] = [];
	for (const file of readdirSync(HERE).filter((f) => f.endsWith(".ts"))) {
		const text = readFileSync(join(HERE, file), "utf8");
		for (const m of text.matchAll(/from\s+"([^"]+)"/g)) if (!ALLOWED.some((r) => r.test(m[1]!))) bad.push(`${file}: ${m[1]}`);
		if (!file.endsWith(".test.ts") && /runtime|transcript|anthropic|session\.ts/i.test(text.replace(/\/\/.*$/gm, ""))) bad.push(`${file}: names a runtime or transcript`);
	}
	assert.deepEqual(bad, []);
});
