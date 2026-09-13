import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Where opencode is, and where Decks keeps the things it hands opencode.
 *
 * Separated from the backend for the reason `claude/available.ts` is: "can this run here"
 * is a question the shell asks before it starts anything, and answering it should not mean
 * importing a class that spawns a server.
 */

/** The opencode binary: `DECKS_OPENCODE_BIN`, then the usual install, then PATH. */
export function opencodeExecutable(): string | undefined {
	const named = process.env.DECKS_OPENCODE_BIN;
	if (named && existsSync(named)) return named;

	const home = process.env.HOME;
	if (home) {
		const installed = join(home, ".opencode", "bin", "opencode");
		if (existsSync(installed)) return installed;
	}

	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, "opencode");
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}
