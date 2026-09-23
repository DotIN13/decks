import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Which boards this install has allowed to run their own code.
 *
 * A board's code runs in the **server process** (`stage/eval.ts` is a `new Function`, not a
 * sandbox, deliberately, because the agent that wrote the board already has `bash`). What is
 * new here is the *trigger*: the code runs because a person pressed something on a board,
 * and a board is a file that may have been written by an agent that had just read a web
 * page. So the click is not the permission. This is.
 *
 * One list, on the install rather than on a deck, for the reason `browser/bridge.ts` gives about
 * the pairing code: what a machine trusts should not have to be re-granted per deck. It is
 * a path list and nothing else — no capability is granted in degrees, because "some code"
 * is not a thing a server process can be given a little of.
 *
 * **The list is written by the question, not by the panel.** `wire/boards.ts` raises the
 * question the first time a board asks to run; the answer "Always allow this board" is what
 * calls `allow`. Nothing here decides anything.
 */
export class EvalTrust {
	private readonly file: string;
	private readonly allowed: Set<string>;

	constructor(private readonly dataDir: string) {
		this.file = join(dataDir, "board-eval.json");
		this.allowed = new Set(this.read());
	}

	/** The paths in the file, whatever they are; a broken file trusts nothing. */
	private read(): string[] {
		try {
			if (!existsSync(this.file)) return [];
			const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { allowed?: unknown };
			if (!Array.isArray(parsed.allowed)) return [];
			return parsed.allowed.filter((path): path is string => typeof path === "string" && path.length > 0);
		} catch {
			return [];
		}
	}

	private write(): void {
		try {
			mkdirSync(this.dataDir, { recursive: true });
			writeFileSync(this.file, `${JSON.stringify({ allowed: this.list() }, null, "\t")}\n`);
		} catch (error) {
			console.warn("[board-eval] could not write the trust list:", error);
		}
	}

	allows(path: string): boolean {
		return this.allowed.has(path);
	}

	allow(path: string): void {
		if (this.allowed.has(path)) return;
		this.allowed.add(path);
		this.write();
	}

	forget(path: string): void {
		if (this.allowed.delete(path)) this.write();
	}

	/** Every trusted path, sorted, for the panel and for a check. */
	list(): string[] {
		return [...this.allowed].sort();
	}
}
