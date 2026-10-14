import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Where OpenCode 2 is, and the folders it is given so that it never touches opencode 1's.
 *
 * Separate from the backend for the reason `opencode/install.ts` is: "can this run here" is
 * asked before anything starts, and answering it must not import a class that spawns a server.
 *
 * **Why the folders.** OpenCode 2 keeps its data, config and cache in the same XDG folders as
 * opencode 1 (`~/.local/share/opencode` and the rest), and on its first start it migrates
 * opencode 1's session database *in place*. Started with the person's own folders it would
 * leave their opencode 1 unable to read its history. So the server Decks starts is pointed at
 * folders of its own: data, state and cache under an `opencode2` root, and the person's own
 * OpenCode 2 config folder, `~/.config/opencode2`, which they can fill as they like.
 */

/** The binary: `DECKS_OPENCODE2_BIN`, then the install beside opencode 1's, then `opencode2` on PATH. */
export function opencode2Executable(): string | undefined {
	const named = process.env.DECKS_OPENCODE2_BIN;
	if (named && existsSync(named)) return named;

	const installed = join(homedir(), ".opencode2", "bin", "opencode2");
	if (existsSync(installed)) return installed;

	// `opencode2` and never `opencode`: the second name is the one OpenCode 2's own package
	// ships so the two can sit on one PATH, and `opencode` there is opencode 1.
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, "opencode2");
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

/**
 * OpenCode 2's folders for the server Decks starts, as the environment that names them.
 *
 * Rooted at the home folder, or at `DECKS_OPENCODE2_HOME` when it is set: a test or a second
 * Decks can give OpenCode 2 a home of its own without changing `HOME` for every other runtime.
 */
export function opencode2Folders(home = homedir(), env: NodeJS.ProcessEnv = process.env): { config: string; env: Record<string, string> } {
	home = env.DECKS_OPENCODE2_HOME ?? home;
	const config = env.DECKS_OPENCODE2_CONFIG ?? join(home, ".config", "opencode2");
	return {
		config,
		env: {
			// OpenCode appends `opencode` to each of these, so data lands in
			// `~/.local/share/opencode2/opencode`, beside opencode 1's and never in it.
			XDG_DATA_HOME: join(home, ".local", "share", "opencode2"),
			XDG_STATE_HOME: join(home, ".local", "state", "opencode2"),
			XDG_CACHE_HOME: join(home, ".cache", "opencode2"),
			// Replaces the global config folder in OpenCode 2, which is what is wanted here: the
			// person's opencode 1 config loads opencode 1 plugins that OpenCode 2 cannot run.
			OPENCODE_CONFIG_DIR: config,
		},
	};
}
