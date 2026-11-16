import { homedir } from "node:os";
import { join } from "node:path";
import type { DeckPath, RunJob } from "../../kernel/types.ts";

// The job Tectonic is given for one document, and LaTeX's errors read back from its log.

export type CompileError = { message: string; line?: number };

/** Long enough for a first run that downloads its packages (rule 5). */
export const TIMEOUT_MS = 180_000;

/** Where the engine may be, in the order tried (rule 3). */
export function tectonicCandidates(env: Record<string, string | undefined> = process.env, home = homedir()): string[] {
	const named = env.DECKS_TECTONIC;
	if (named) return [named];
	return [join(home, ".local", "bin", "tectonic"), join(home, "tools", "tectonic", "tectonic"), "/usr/local/bin/tectonic", "/usr/bin/tectonic", "tectonic"];
}

/** The document's folder and name: Tectonic runs in the folder, on the name (rule 4). */
export function splitPath(path: DeckPath): { folder: DeckPath | ""; name: string; stem: string } {
	const cut = path.lastIndexOf("/");
	const name = path.slice(cut + 1);
	return { folder: (cut < 0 ? "" : path.slice(0, cut)) as DeckPath | "", name, stem: name.replace(/\.[^.]+$/, "") };
}

/** One typesetting of the document at path: shell escape stays off, as Tectonic has it. */
export function tectonicJob(path: DeckPath, candidates = tectonicCandidates()): RunJob {
	const { folder, name, stem } = splitPath(path);
	return {
		command: candidates,
		args: ["--keep-logs", "--outdir", "{out}", name],
		cwd: folder,
		timeoutMs: TIMEOUT_MS,
		outputs: [`${stem}.pdf`, `${stem}.log`],
	};
}

/** Where a document's PDF and log go in the deck: docs/build/ and its path, the extension changed (rule 6). */
export function buildPath(path: DeckPath, extension: "pdf" | "log"): string {
	return `docs/build/${path.replace(/\.[^./]+$/, "")}.${extension}`;
}

/** LaTeX's own errors, `! message` with the `l.<n>` it stopped at; with none, the engine's `error:` lines (rule 7). */
export function readErrors(log: string, output: string): CompileError[] {
	const errors = latexErrors(log.split("\n"));
	if (errors.length > 0) return errors;
	for (const line of output.split("\n")) {
		const m = /^error: (.*)$/.exec(line.trim());
		if (m && !/unrecoverable error|halted on/.test(m[1]!)) errors.push({ message: m[1]! });
	}
	return errors;
}

function latexErrors(lines: string[]): CompileError[] {
	const errors: CompileError[] = [];
	lines.forEach((line, i) => {
		if (!line.startsWith("! ")) return;
		const error: CompileError = { message: line.slice(2).trim() };
		for (const next of lines.slice(i + 1, i + 12)) {
			const at = /^l\.(\d+)\s?(.*)$/.exec(next);
			if (!at) continue;
			error.line = Number(at[1]);
			if (at[2]) error.message += `: ${at[2].trim()}`;
			break;
		}
		errors.push(error);
	});
	return errors;
}
