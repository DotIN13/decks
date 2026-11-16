// A runtime with one server for every agent (opencode) learns which agent a
// session is from a file the harness writes: <home>/harness/sessions/<session>,
// holding that agent's token, readable by this user alone.
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionTokens } from "../backend.ts";
import { harnessHome } from "./home.ts";

/** The folder the files live in: what the server's DECKS_OPENCODE_SESSIONS names. */
export function sessionTokensDir(home = harnessHome()): string {
	return join(home, "harness", "sessions");
}

/** One agent's binding of its sessions to its token. */
export function sessionTokenFiles(token: string | undefined, dir = sessionTokensDir()): SessionTokens {
	const file = (session: string) => (/^[\w.-]+$/.test(session) ? join(dir, session) : undefined);
	return {
		setServerToken: () => {},
		registerSession: (session) => {
			const at = file(session);
			if (!at || !token) return;
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			chmodSync(dir, 0o700);
			writeFileSync(at, token, { mode: 0o600 });
		},
		unregisterSession: (session) => {
			const at = session ? file(session) : undefined;
			if (at) rmSync(at, { force: true });
		},
	};
}
