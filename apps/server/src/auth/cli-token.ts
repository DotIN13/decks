import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TokenStore } from "./tokens.ts";

/**
 * `decks login` with no code, on the harness's own machine, by the user it runs as.
 *
 * When the harness starts it writes a person token to `<data dir>/.decks/cli-token`, readable by
 * this user alone, with the address it listens on; it makes a new one on every start, taking the
 * last one back, and takes it back and deletes the file when it stops. Reading that file is the
 * proof: only this user, on this machine, can. `decks login` reads it and trades it at
 * `POST /api/login` for a terminal's own person token (`issue.ts`), which outlives the harness's
 * restarts as a code's does. Nothing is opened on the network for it; a code from `decks pair code`
 * is still how a terminal anywhere else logs in.
 */

/** Where the file is, for a data directory. */
export function cliTokenFile(dataDir: string): string {
	return join(dataDir, ".decks", "cli-token");
}

/** The label the token is given, by which the one from the last start is found and taken back. */
export const CLI_TOKEN_LABEL = "decks login on this machine";

export interface CliToken {
	/** The id of the token written down: `POST /api/login` trades this one, and no other, without a code. */
	id: string;
	/** Take it back and delete the file: at stop. */
	stop(): void;
}

/** Write a fresh token for this start, taking back the last one; answers its id and how to stop it. */
export function writeCliToken(store: Pick<TokenStore, "issue" | "revoke" | "revokeWhere">, dataDir: string, url: string): CliToken {
	const file = cliTokenFile(dataDir);
	// The last start's, if it did not stop cleanly: one file, one token.
	store.revokeWhere((principal, row) => principal.kind === "person" && row.label === CLI_TOKEN_LABEL);
	const { token, id } = store.issue({ kind: "person" }, { label: CLI_TOKEN_LABEL });
	mkdirSync(join(dataDir, ".decks"), { recursive: true, mode: 0o700 });
	// Gone first, so a file another user made cannot be written through with its own modes.
	rmSync(file, { force: true });
	writeFileSync(file, `${JSON.stringify({ url, token }, null, "\t")}\n`, { mode: 0o600 });
	chmodSync(file, 0o600);
	return {
		id,
		stop: () => {
			store.revoke(id);
			rmSync(file, { force: true });
		},
	};
}

/** What the file says, or undefined: for tests and for the command, which reads it the same way. */
export function readCliToken(dataDir: string): { url?: string; token: string } | undefined {
	try {
		const saved = JSON.parse(readFileSync(cliTokenFile(dataDir), "utf8")) as { url?: unknown; token?: unknown };
		return typeof saved.token === "string" ? { token: saved.token, ...(typeof saved.url === "string" ? { url: saved.url } : {}) } : undefined;
	} catch {
		return undefined;
	}
}
