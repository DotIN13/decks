import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

// The harness's own folder: logins, transcripts and runtimes' homes. Never the
// deck. DECKS_DATA_DIR, as today's server reads it, else ~/.decks.

export function harnessHome(): string {
	const named = (process.env.DECKS_DATA_DIR ?? "~/.decks").replace(/^~(?=$|\/)/, homedir());
	return isAbsolute(named) ? named : resolve(process.cwd(), named);
}
