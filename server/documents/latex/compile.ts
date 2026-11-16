import { Refused, type Caller } from "../../../protocol/index.ts";
import { toDeckPath, type Deck, type DeckPath, type RunJob, type RunResult } from "../../kernel/types.ts";
import { buildPath, readErrors, tectonicJob, type CompileError } from "./tectonic.ts";

// Typesetting a LaTeX document: one run at a time per document, the PDF and log written through the deck.

/** The kernel's run, read when a call comes. */
export type Run = (job: RunJob) => Promise<RunResult>;

export type Compiled = { path: string; ok: boolean; pdf?: string; errors: CompileError[]; at: number; ms: number; error?: string };

export const NO_TECTONIC = "No LaTeX typesetter is installed on this server (Tectonic).";
export const TOO_LONG = "Typesetting took too long and was stopped.";
const decoder = new TextDecoder();

/** One per server: the runs going now, one queue per document (rule 9). */
export class Typesetter {
	private queues = new Map<string, Promise<unknown>>();

	constructor(
		private machine: () => Run | undefined,
		private candidates?: string[],
	) {}

	/** Typeset the document at raw as the deck holds it when its turn comes. */
	compile(deck: Deck, raw: string, by: Caller): Promise<Compiled> {
		const path = texPath(raw);
		const run = this.machine();
		if (!run) throw new Refused("unavailable", "This server has no machine to run a typesetter on.", "file.read");
		const go = () => typeset(run, deck, path, by, this.candidates);
		const next = (this.queues.get(path) ?? Promise.resolve()).then(go, go);
		const settled = next.then(() => undefined, () => undefined);
		this.queues.set(path, settled);
		void settled.then(() => this.queues.get(path) === settled && this.queues.delete(path));
		return next;
	}
}

/** A path inside the deck to a .tex or .ltx file, else refused (rule 1). */
export function texPath(raw: string): DeckPath {
	const path = toDeckPath(raw);
	if (!/\.(tex|ltx)$/i.test(path)) throw new Refused("invalid", `Only a LaTeX file typesets to a PDF; ${path} is not one.`, "file.read");
	return path;
}

/** One run: the job on the machine, then its PDF and log into docs/build/ (rules 6 to 8). */
async function typeset(run: Run, deck: Deck, path: DeckPath, by: Caller, candidates?: string[]): Promise<Compiled> {
	const started = Date.now();
	const job = tectonicJob(path, candidates);
	const result = await run(job);
	const answer = (fields: Partial<Compiled>): Compiled => ({ path, ok: false, errors: [], at: Date.now(), ms: Date.now() - started, ...fields });
	if (result.missing) return answer({ error: NO_TECTONIC });
	const [pdfName, logName] = job.outputs!;
	const pdfBytes = result.files[pdfName!];
	const logBytes = result.files[logName!];
	const errors = readErrors(logBytes ? decoder.decode(logBytes) : "", result.out);
	if (result.signal) errors.unshift({ message: TOO_LONG });
	if (logBytes) await deck.write(toDeckPath(buildPath(path, "log")), logBytes, by);
	if (!pdfBytes) return answer({ errors, ...(errors.length === 0 ? { error: lastLine(result.out) } : {}) });
	const pdf = buildPath(path, "pdf");
	await deck.write(toDeckPath(pdf), pdfBytes, by);
	return answer({ ok: result.code === 0 && errors.length === 0, pdf, errors });
}

/** The engine's last words, for a run that stopped with no error LaTeX could name. */
function lastLine(out: string): string {
	return out.trim().split("\n").filter((line) => line.trim()).pop() ?? "Typesetting stopped before writing a page.";
}
