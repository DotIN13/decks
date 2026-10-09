import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import type { CompileError, CompileResult } from "@decks/docs";

/**
 * Typesetting a LaTeX document page with Tectonic, a self-contained TeX engine that fetches the
 * packages a paper uses the first time it needs them and keeps them in its cache.
 *
 * The file is typeset where it is, from its own folder, so its pictures, `.bib` files and style
 * files are found where the paper keeps them; the PDF and the log go to its records in the deck. Shell escape stays off, as
 * Tectonic has it by default: a document cannot run commands on this machine.
 */

/** Long enough for a first run that downloads its packages; a stuck run is stopped. */
const TIMEOUT_MS = 180_000;

/** The engine: `DECKS_TECTONIC`, else the first install found, else whatever `tectonic` is on the path. */
export function tectonicPath(): string {
	const named = process.env.DECKS_TECTONIC;
	if (named) return named;
	for (const candidate of [join(homedir(), ".local", "bin", "tectonic"), join(homedir(), "tools", "tectonic", "tectonic"), "/usr/local/bin/tectonic", "/usr/bin/tectonic"]) {
		if (existsSync(candidate)) return candidate;
	}
	return "tectonic";
}

export function compileTex(job: { file: string; inputs: string; out: string }): Promise<CompileResult> {
	const engine = tectonicPath();
	const stem = basename(job.file, extname(job.file));
	return new Promise((resolve) => {
		const child = spawn(engine, ["--keep-logs", "--keep-intermediates", "--outdir", job.out, "-Z", `search-path=${job.inputs}`, job.file], {
			cwd: job.inputs,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
		child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
		const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
		child.on("error", (error: NodeJS.ErrnoException) => {
			clearTimeout(timer);
			resolve({ ok: false, errors: [], error: error.code === "ENOENT" ? "No LaTeX typesetter is installed on this server (Tectonic)." : error.message });
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			const pdf = join(job.out, `${stem}.pdf`);
			let log = "";
			try {
				log = readFileSync(join(job.out, `${stem}.log`), "utf8");
			} catch {
				// No log: the engine stopped before TeX ran, and its own words say why.
			}
			const errors = readErrors(log, output);
			if (signal) errors.unshift({ message: "Typesetting took too long and was stopped." });
			// A PDF written by this run, even with errors TeX recovered from, is still worth showing.
			const made = code === 0 && existsSync(pdf);
			resolve({ ok: made && errors.length === 0, ...(made ? { pdf } : {}), errors });
		});
	});
}

/** LaTeX's own errors from its log, `! message` with the `l.<n>` line it stopped at; else the engine's. */
export function readErrors(log: string, output: string): CompileError[] {
	const errors: CompileError[] = [];
	const lines = log.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (!line.startsWith("! ")) continue;
		const error: CompileError = { message: line.slice(2).trim() };
		for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
			const at = /^l\.(\d+)\s?(.*)$/.exec(lines[j]!);
			if (at) {
				error.line = Number(at[1]);
				if (at[2]) error.message += ` — ${at[2].trim()}`;
				break;
			}
		}
		errors.push(error);
	}
	if (errors.length === 0) {
		for (const line of output.split("\n")) {
			const m = /^error: (.*)$/.exec(line.trim());
			if (m && !/unrecoverable error|halted on/.test(m[1]!)) errors.push({ message: m[1]! });
		}
	}
	return errors;
}
