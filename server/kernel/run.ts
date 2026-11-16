import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { Refused } from "../../protocol/index.ts";
import { toDeckPath, type Bytes, type RunJob, type RunResult } from "./types.ts";

// Starting a program on this machine for a feature (tectonic, git): in a deck
// folder, with "{out}" in an argument standing for a fresh scratch folder
// outside the deck whose named outputs are read back. Decks-local only.

const OUT_LIMIT = 1024 * 1024;

/** The runner for a deck on a folder. */
export function folderRunner(root: string): (job: RunJob) => Promise<RunResult> {
	return async (job) => {
		const program = await find(job.command);
		if (!program) return { code: null, out: `None of ${job.command.join(", ")} is installed.`, missing: true, files: {} };
		const cwd = job.cwd ? join(root, toDeckPath(job.cwd)) : root;
		if (!(await stat(cwd).then((info) => info.isDirectory(), () => false))) throw new Refused("not_found", `There is no folder at ${job.cwd}.`, "file.list");
		const scratch = await mkdtemp(join(tmpdir(), "decks-run-"));
		try {
			const args = job.args.map((arg) => arg.split("{out}").join(scratch));
			const done = await spawned(program, args, cwd, { ...process.env, ...(job.env ?? {}) }, job.timeoutMs);
			return { ...done, files: await outputs(scratch, job.outputs ?? []) };
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	};
}

/** The first candidate that exists: a path as given, a bare name looked up on PATH. */
async function find(candidates: string[]): Promise<string | undefined> {
	for (const one of candidates) {
		const places = isAbsolute(one) || one.includes("/") ? [one] : (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, one));
		for (const place of places) if (await access(place, constants.X_OK).then(() => true, () => false)) return place;
	}
	return undefined;
}

/** Runs it, stdout and stderr together, killed at the timeout; stdin is closed. */
function spawned(program: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Omit<RunResult, "files">> {
	return new Promise((done) => {
		const child = spawn(program, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		const hear = (chunk: Buffer) => void (out.length < OUT_LIMIT && (out += chunk.toString("utf8")));
		child.stdout.on("data", hear);
		child.stderr.on("data", hear);
		const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
		child.on("error", (error) => (clearTimeout(timer), done({ code: null, out: `${out}${error.message}` })));
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			done({ code, out: out.slice(0, OUT_LIMIT), ...(signal ? { signal } : {}) });
		});
	});
}

/** The named files from the scratch folder; one that was not made is left out. */
async function outputs(scratch: string, names: string[]): Promise<Record<string, Bytes>> {
	const files: Record<string, Bytes> = {};
	for (const name of names) {
		if (name.includes("..") || isAbsolute(name)) continue;
		const bytes = await readFile(join(scratch, name)).catch(() => undefined);
		if (bytes) files[name] = new Uint8Array(bytes);
	}
	return files;
}
