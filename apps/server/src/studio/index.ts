import { existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { HarnessSync, type SyncOptions } from "@decks/sync-client";
import type { TokenStore } from "../auth/tokens.ts";

/**
 * Decks Studio, from the harness's side: when this harness has a Studio key, its deck syncs with
 * Studio in the background (`sync.ts`); without one, nothing here runs.
 *
 * The key comes from `DECKS_STUDIO_KEY` (and `DECKS_STUDIO_URL`, Studio's address), or from
 * `<deck>/.decks/studio.json`, `{ "url": "…", "key": "dsk_…" }`, which is watched: writing it
 * connects, changing it reconnects, and removing it stops. The key is also the pairing with Studio:
 * Studio's browsers get their tokens through it (below).
 */
export interface StudioLink {
	stop(): Promise<void>;
	/** Whether a sync is running, and to where. */
	status(): { connected: boolean; url?: string };
}

const DEFAULT_URL = "https://studio.decks.app";

/*
 * The pairing with Studio is its key. The harness keeps the key and a socket open to Studio with it;
 * a browser signed in to Studio is never paired itself. When it needs this harness, Studio asks, on
 * that socket, for a harness token for the person signed in there (`token.ask`), and the harness gives
 * one (`studioToken`): an ordinary harness token as a site, bound to Studio's origin, that lapses after
 * an hour unused, marked as Studio's. Studio asks only for someone who may use the harness there, and
 * the browser asks again, through Studio, before its token lapses. Unpairing in Settings deletes the key
 * and takes back every token given through it (`unpairStudio`), as does Studio revoking the key.
 */

/** How long a token given through Studio may go unused: an hour; the browser has another before then. */
export const STUDIO_TOKEN_MS = 3_600_000;

/** A harness token for a Studio person's browser, as Studio asked for it over the key's socket. */
export function studioToken(tokens: TokenStore, ask: { user: { id: string; name: string }; origin: string }, now = Date.now()): { token: string; expires: number } {
	let origin: string;
	try {
		const url = new URL(ask.origin);
		if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
		origin = url.origin;
	} catch {
		throw new Error("Studio's origin is an http or https address.");
	}
	const name = ask.user.name.trim() || ask.user.id;
	const { token } = tokens.issue({ kind: "site", label: `Studio: ${name}`, origin, studio: true }, { idle: STUDIO_TOKEN_MS, now });
	return { token, expires: now + STUDIO_TOKEN_MS };
}

/**
 * Take back the tokens given through Studio's key; with `paired`, also those Studio's pages were given
 * by pairing (`Decks Studio`: the first connect's, and every browser's from before). Answers how many.
 * A key replaced by another takes back only the first kind, since the new key's own connect has just
 * paired.
 */
export function revokeStudioTokens(tokens: TokenStore, options: { paired?: boolean } = {}): number {
	return tokens.revokeWhere((principal) => principal.kind === "site" && (principal.studio === true || (options.paired === true && principal.label === "Decks Studio")));
}

/** The link to Studio as Settings shows it, if there is one: from the environment, or `.decks/studio.json`. */
export function studioLink(deck: string, env: NodeJS.ProcessEnv = process.env): { url: string; env?: true } | undefined {
	if (env.DECKS_STUDIO_KEY) return { url: env.DECKS_STUDIO_URL ?? DEFAULT_URL, env: true };
	const file = join(deck, ".decks", "studio.json");
	if (!existsSync(file)) return undefined;
	try {
		const saved = JSON.parse(readFileSync(file, "utf8")) as { url?: string; key?: string };
		return saved.key ? { url: saved.url ?? DEFAULT_URL } : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Unpair Studio, from this harness's Settings: its key deleted, so the deck stops syncing and Studio
 * can ask for no more tokens, and every token given through it taken back at once. A key set by
 * `DECKS_STUDIO_KEY` is not this harness's to delete: that throws, after the tokens are taken back.
 */
export function unpairStudio(deck: string, tokens: TokenStore, env: NodeJS.ProcessEnv = process.env): { revoked: number } {
	rmSync(join(deck, ".decks", "studio.json"), { force: true });
	const revoked = revokeStudioTokens(tokens, { paired: true });
	if (env.DECKS_STUDIO_KEY) throw new Error("This harness's Studio key is set by DECKS_STUDIO_KEY: remove it there and restart to unpair.");
	return { revoked };
}

/**
 * Save Studio's address and this harness's key to `.decks/studio.json`, which `startStudio` watches,
 * so the deck starts syncing at once. Both the `studio.connect` verb and `POST /api/pair` with Studio's key
 * come here; neither checks the key with Studio first.
 */
export function saveStudioLink(deck: string, url: string, key: string): { connected: true; url: string } {
	const origin = studioOrigin(url, key);
	const dir = join(deck, ".decks");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "studio.json"), JSON.stringify({ url: origin, key }), { mode: 0o600 });
	return { connected: true, url: origin };
}

/** Studio's origin, once its address and the key both look right; otherwise a sentence saying which is wrong. */
export function studioOrigin(url: string, key: string): string {
	let address: URL;
	try {
		address = new URL(url);
	} catch {
		throw new Error("Studio's address is an http or https URL.");
	}
	if (address.protocol !== "https:" && address.protocol !== "http:") throw new Error("Studio's address is an http or https URL.");
	if (!/^dsk_[A-Za-z0-9_-]{20,}$/.test(key)) throw new Error("That is not a Studio key: they start with dsk_.");
	return address.origin;
}

/**
 * `link`: what Studio may ask of this harness over the key's socket (`issueToken`), and what to do when
 * the key goes (`unlinked`: removed here, replaced by another, or revoked in Studio), which takes back
 * what was given through it.
 */
export function startStudio(
	deck: string,
	env: NodeJS.ProcessEnv = process.env,
	harness?: string,
	inventory?: SyncOptions["inventory"],
	harnessToken?: SyncOptions["harnessToken"],
	link: Pick<SyncOptions, "issueToken" | "unlinked"> = {},
): StudioLink {
	const file = join(deck, ".decks", "studio.json");
	let sync: HarnessSync | undefined;
	let current = "";
	let watcher: FSWatcher | undefined;

	const read = (): { url: string; key: string } | undefined => {
		if (env.DECKS_STUDIO_KEY) return { url: env.DECKS_STUDIO_URL ?? DEFAULT_URL, key: env.DECKS_STUDIO_KEY };
		if (!existsSync(file)) return undefined;
		try {
			const saved = JSON.parse(readFileSync(file, "utf8")) as { url?: string; key?: string };
			return saved.key ? { url: saved.url ?? DEFAULT_URL, key: saved.key } : undefined;
		} catch {
			return undefined;
		}
	};

	const apply = async () => {
		const want = read();
		const id = want ? `${want.url} ${want.key}` : "";
		if (id === current) return;
		// A key gone or replaced: what Studio was given through the old one goes with it.
		if (current) link.unlinked?.("changed");
		current = id;
		await sync?.stop();
		sync = undefined;
		if (!want) return;
		sync = new HarnessSync({ deck, studio: want.url, key: want.key, ...(harness ? { harness } : {}), ...(inventory ? { inventory } : {}), ...(harnessToken ? { harnessToken } : {}), ...link });
		sync.start().catch((error) => console.error(`[decks] studio: ${(error as Error).message}`));
	};

	void apply();
	if (!env.DECKS_STUDIO_KEY) {
		try {
			// A new deck has no .decks folder yet; made now, so a link saved later is seen at once.
			mkdirSync(join(deck, ".decks"), { recursive: true });
			watcher = watch(join(deck, ".decks"), (_event, name) => {
				if (!name || name === "studio.json") void apply();
			});
		} catch {
			// No folder to watch: the key can still come by environment on the next start.
		}
	}

	return {
		async stop() {
			watcher?.close();
			await sync?.stop();
		},
		status: () => ({ connected: Boolean(sync), url: current ? current.split(" ")[0] : undefined }),
	};
}
