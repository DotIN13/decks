import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Refused, type Caller } from "../../../protocol/index.ts";
import { MemoryDeck, toDeckPath } from "../../kernel/index.ts";
import { folderRunner } from "../../kernel/run.ts";
import type { RunJob, RunResult } from "../../kernel/types.ts";
import { NO_TECTONIC, TOO_LONG, Typesetter, type Run } from "./compile.ts";
import { buildPath, readErrors, tectonicCandidates, tectonicJob } from "./tectonic.ts";

// Tests from the README's rules: the machine faked at its edge, and one real run when Tectonic is here.

const person: Caller = { kind: "person", id: "person", name: "You" };
const bytes = (text: string) => new TextEncoder().encode(text);
const text = async (deck: MemoryDeck, path: string) => new TextDecoder().decode(await deck.read(toDeckPath(path)));

/** A machine that answers every job with result, and keeps the jobs it was given. */
function fakeMachine(result: Partial<RunResult>, jobs: RunJob[] = []): Run {
	return async (job) => {
		jobs.push(job);
		return { code: 0, out: "", files: {}, ...result };
	};
}

const LOG_WITH_ERROR = ["This is TeX", "! Undefined control sequence.", "l.7 \\foo", "        bar", "Output written"].join("\n");

test("rule 1: only a .tex or .ltx file in the deck typesets", async () => {
	const t = new Typesetter(() => fakeMachine({}));
	assert.throws(() => t.compile(new MemoryDeck(), "papers/a.md", person), (e: Refused) => e.code === "invalid");
	assert.throws(() => t.compile(new MemoryDeck(), "../outside.tex", person), (e: Refused) => e.code === "invalid");
	assert.throws(() => t.compile(new MemoryDeck(), ".decks/a.tex", person), (e: Refused) => e.code === "invalid");
});

test("rules 3 and 4: Tectonic runs in the file's folder, on its name, its own path first when named", () => {
	const job = tectonicJob(toDeckPath("papers/q1/paper.tex"), ["/x/tectonic"]);
	assert.equal(job.cwd, "papers/q1");
	assert.deepEqual(job.args, ["--keep-logs", "--outdir", "{out}", "paper.tex"]);
	assert.deepEqual(job.outputs, ["paper.pdf", "paper.log"]);
	assert.ok(!job.args.some((a) => /shell-escape/.test(a)));
	assert.deepEqual(tectonicCandidates({ DECKS_TECTONIC: "/opt/t" }), ["/opt/t"]);
	assert.deepEqual(tectonicCandidates({}, "/h"), ["/h/.local/bin/tectonic", "/h/tools/tectonic/tectonic", "/usr/local/bin/tectonic", "/usr/bin/tectonic", "tectonic"]);
	assert.equal(tectonicJob(toDeckPath("top.tex")).cwd, "");
});

test("rule 6: the PDF and the log go to docs/build/ through the deck, by the caller", async () => {
	const deck = new MemoryDeck();
	const t = new Typesetter(() => fakeMachine({ files: { "paper.pdf": bytes("%PDF-1.5"), "paper.log": bytes("all fine") } }));
	const done = await t.compile(deck, "papers/paper.tex", person);
	assert.equal(done.pdf, "docs/build/papers/paper.pdf");
	assert.equal(done.ok, true);
	assert.equal(await text(deck, "docs/build/papers/paper.pdf"), "%PDF-1.5");
	assert.equal(await text(deck, "docs/build/papers/paper.log"), "all fine");
	assert.equal(buildPath(toDeckPath("a.ltx"), "pdf"), "docs/build/a.pdf");
});

test("rule 7: LaTeX's errors with their lines; a PDF made with errors is still given, not ok", async () => {
	const deck = new MemoryDeck();
	const t = new Typesetter(() => fakeMachine({ code: 1, files: { "p.pdf": bytes("%PDF"), "p.log": bytes(LOG_WITH_ERROR) } }));
	const done = await t.compile(deck, "p.tex", person);
	assert.equal(done.ok, false);
	assert.equal(done.pdf, "docs/build/p.pdf");
	assert.deepEqual(done.errors, [{ message: "Undefined control sequence.: \\foo", line: 7 }]);
});

test("rule 7: with no LaTeX error in the log, the engine's error lines", () => {
	assert.deepEqual(readErrors("", "note: x\nerror: cannot find style foo.sty\nerror: halted on potentially-recoverable error"), [{ message: "cannot find style foo.sty" }]);
});

test("rule 8: no Tectonic is an answer with ok false, never a throw", async () => {
	const done = await new Typesetter(() => fakeMachine({ missing: true, code: null })).compile(new MemoryDeck(), "p.tex", person);
	assert.deepEqual([done.ok, done.error, done.pdf], [false, NO_TECTONIC, undefined]);
});

test("rule 5: a run stopped for taking too long says so first", async () => {
	const done = await new Typesetter(() => fakeMachine({ code: null, signal: "SIGKILL" })).compile(new MemoryDeck(), "p.tex", person);
	assert.equal(done.errors[0]?.message, TOO_LONG);
	assert.equal(done.ok, false);
});

test("rule 9: asks during a run wait for it, one run at a time per document", async () => {
	let running = 0;
	let most = 0;
	const machine: Run = async () => {
		most = Math.max(most, ++running);
		await new Promise((r) => setTimeout(r, 10));
		running--;
		return { code: 0, out: "", files: {} };
	};
	const t = new Typesetter(() => machine);
	const deck = new MemoryDeck();
	await Promise.all([t.compile(deck, "a.tex", person), t.compile(deck, "a.tex", person), t.compile(deck, "a.tex", person)]);
	assert.equal(most, 1);
});

test("rule 11: no machine is unavailable", () => {
	assert.throws(() => new Typesetter(() => undefined).compile(new MemoryDeck(), "a.tex", person), (e: Refused) => e.code === "unavailable");
});

const hasTectonic = (() => {
	try {
		execFileSync(tectonicCandidates().find((c) => !c.includes("/") || existsSync(c))!, ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();

test("for real: a small paper typesets to a PDF", { skip: !hasTectonic && "Tectonic is not installed" }, async () => {
	const root = mkdtempSync(join(tmpdir(), "quire-tex-"));
	mkdirSync(join(root, "papers"));
	writeFileSync(join(root, "papers/hello.tex"), "\\documentclass{article}\\begin{document}Hello.\\end{document}\n");
	const deck = new MemoryDeck();
	const done = await new Typesetter(() => folderRunner(root)).compile(deck, "papers/hello.tex", person);
	rmSync(root, { recursive: true, force: true });
	assert.equal(done.ok, true, JSON.stringify(done.errors));
	assert.ok((await text(deck, "docs/build/papers/hello.pdf")).startsWith("%PDF"));
});
