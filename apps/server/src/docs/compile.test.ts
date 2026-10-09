import assert from "node:assert/strict";
import { test } from "node:test";
import { readErrors } from "./compile.ts";

test("LaTeX's errors are read from its log with the line each stopped at", () => {
	const log = ["This is XeTeX", "! Undefined control sequence.", "l.22 Macros from the preamble: $x \\in \\R", "                                        ^n$", "", "! Missing $ inserted.", "<inserted text>", "l.40 x^2"].join("\n");
	assert.deepEqual(readErrors(log, ""), [
		{ message: "Undefined control sequence. — Macros from the preamble: $x \\in \\R", line: 22 },
		{ message: "Missing $ inserted. — x^2", line: 40 },
	]);
});

test("with no log, the engine's own error is the reason", () => {
	assert.deepEqual(readErrors("", "note: downloading\nerror: failed to open input file \"x.tex\"\nerror: the XeTeX engine had an unrecoverable error"), [{ message: 'failed to open input file "x.tex"' }]);
});
