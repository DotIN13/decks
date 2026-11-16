import { ENV, LOCK_FILE } from "../../protocol/index.ts";

// Where a server is and who is calling, when the caller did not say: the
// environment first, then the lock file of the deck around the working
// folder, then a token decks login kept. Node only; a browser passes both.

export type Found = { url: string; token: string | undefined; from: string };
type Lock = { url: string; token: string };

const inNode = () => typeof process !== "undefined" && !!process.versions?.node;

/** The lock file of the deck named by DECKS_DECK, or the nearest above the working folder. */
async function lockFile(): Promise<{ file: string; lock: Lock } | undefined> {
	const { existsSync, readFileSync } = await import("node:fs");
	const { dirname, join } = await import("node:path");
	const starts = [process.env[ENV.deck], process.cwd()].filter((dir): dir is string => !!dir);
	for (const start of starts) {
		for (let dir = start; ; dir = dirname(dir)) {
			const file = join(dir, LOCK_FILE);
			if (existsSync(file)) return { file, lock: JSON.parse(readFileSync(file, "utf8")) as Lock };
			if (dirname(dir) === dir) break;
		}
	}
	return undefined;
}

/** Where decks login keeps the tokens it got, by server address. */
export async function tokensFile(): Promise<string> {
	const { homedir } = await import("node:os");
	const { join } = await import("node:path");
	return join(process.env[ENV.home] || join(homedir(), ".decks"), "tokens.json");
}

export async function savedToken(url: string): Promise<string | undefined> {
	return (await readTokens(await tokensFile()))[url];
}

/** The tokens decks login kept, by server address; none when the file is missing or unreadable. */
export async function readTokens(file: string): Promise<Record<string, string>> {
	const { readFileSync } = await import("node:fs");
	try {
		const saved = JSON.parse(readFileSync(file, "utf8")) as unknown;
		return saved && typeof saved === "object" ? (saved as Record<string, string>) : {};
	} catch {
		return {};
	}
}

const clean = (url: string) => url.replace(/\/+$/, "");

/** The server and token to use, from what was given and then what can be found. */
export async function find(given: { url?: string; token?: string } = {}): Promise<Found> {
	const env = inNode() ? process.env : {};
	const lock = inNode() ? await lockFile() : undefined;
	const url = given.url ?? env[ENV.url] ?? lock?.lock.url;
	if (!url) throw new Error(`No Decks server found: set ${ENV.url}, run inside a deck whose server is running, or pass { url }.`);
	const sameAsLock = lock && clean(lock.lock.url) === clean(url);
	const token = given.token ?? env[ENV.token] ?? (inNode() ? await savedToken(clean(url)) : undefined) ?? (sameAsLock ? lock.lock.token : undefined);
	const from = given.url ? "given" : env[ENV.url] ? ENV.url : `${lock?.file}`;
	return { url: clean(url), token, from };
}
