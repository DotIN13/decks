import { existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { PenEdit } from "@decks/pen";
import { HarnessSync, type SyncOptions, type SyncProgress } from "@decks/sync-client";
import type { TokenStore } from "../auth/tokens.ts";
import { DEFAULT_STUDIO, type StudioAccount } from "./login.ts";

/**
 * Decks Studio, from the harness's side: when this harness has a Studio key, its deck syncs with
 * Studio in the background (`sync.ts`); without one, nothing here runs.
 *
 * The key comes from the harness signing in to Studio (`login.ts`), which writes it with Studio's
 * address and the account to `<deck>/.decks/studio.json`, `{ "url": "…", "key": "dsk_…", "account":
 * … }`; or from `DECKS_STUDIO_KEY` (and `DECKS_STUDIO_URL`), for a deployment that is handed one. The
 * file is watched: writing it connects, changing it reconnects, and removing it stops. The key is
 * also the link with Studio: Studio's browsers get their tokens through it (below), and the harness
 * says where it can be reached with it (`addresses.ts`).
 */
export interface StudioLink {
	stop(): Promise<void>;
	/** Whether a sync is running, to where, and how far the deck is in step. */
	status(): { connected: boolean; url?: string; sync?: SyncProgress };
	/** An edit made here, as the canvas store logged it: sent up at once for a canvas on Studio (`HarnessSync.edited`). */
	edited(name: string, change: { edits: readonly PenEdit[]; by: { kind: string; id?: string } }): void;
	/** Where someone on this harness is on a canvas, for everyone else on it through Studio (`HarnessSync.presence`). */
	presence(name: string, message: Parameters<HarnessSync["presence"]>[1]): void;
	/** Say again where this harness can be reached: the list changed. */
	report(): void;
	/** A full pass now, not at the next five minutes (Settings' Try again). */
	syncNow(): void;
}

const DEFAULT_URL = DEFAULT_STUDIO;

/*
 * The link with Studio is its key. The harness keeps the key and a socket open to Studio with it;
 * a browser signed in to Studio is never paired itself. When it needs this harness, Studio asks, on
 * that socket, for a harness token for the person signed in there (`token.ask`), and the harness gives
 * one (`studioToken`): an ordinary harness token as a site, bound to Studio's origin, that lapses after
 * an hour unused, marked as Studio's. Studio asks only for someone who may use the harness there, and
 * the browser asks again, through Studio, before its token lapses. Signing out in Settings deletes the key
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

/** The link to Studio as Settings shows it, if there is one: from the environment, or `.decks/studio.json`, with the account it was signed in as. */
export function studioLink(deck: string, env: NodeJS.ProcessEnv = process.env): { url: string; env?: true; account?: StudioAccount } | undefined {
	if (env.DECKS_STUDIO_KEY) return { url: env.DECKS_STUDIO_URL ?? DEFAULT_URL, env: true };
	const file = join(deck, ".decks", "studio.json");
	if (!existsSync(file)) return undefined;
	try {
		const saved = JSON.parse(readFileSync(file, "utf8")) as { url?: string; key?: string; account?: StudioAccount };
		return saved.key ? { url: saved.url ?? DEFAULT_URL, ...(saved.account?.email ? { account: { name: String(saved.account.name ?? ""), email: String(saved.account.email) } } : {}) } : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Sign out of Studio, from this harness's Settings: its key deleted, so the deck stops syncing and Studio
 * can ask for no more tokens, every token given through it taken back at once, and Studio told to
 * forget this harness. A key set by
 * `DECKS_STUDIO_KEY` is not this harness's to delete: that throws, after the tokens are taken back.
 */
export function unpairStudio(deck: string, tokens: TokenStore, env: NodeJS.ProcessEnv = process.env): { revoked: number } {
	const file = join(deck, ".decks", "studio.json");
	// Studio is told, with the key while it is still here: it forgets this harness, so one that signs in again is not listed twice, once dead. Not waited for, and not needed: signed out here is signed out.
	try {
		const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { url?: string; key?: string }) : {};
		if (saved.url && saved.key) void fetch(`${saved.url}/sync/v1/harness`, { method: "DELETE", headers: { Authorization: `Bearer ${saved.key}` }, signal: AbortSignal.timeout(5000) }).catch(() => undefined);
	} catch {
		// A file that does not read holds no key to say it with.
	}
	rmSync(file, { force: true });
	const revoked = revokeStudioTokens(tokens, { paired: true });
	if (env.DECKS_STUDIO_KEY) throw new Error("This harness's Studio key is set by DECKS_STUDIO_KEY: remove it there and restart to unpair.");
	return { revoked };
}

/**
 * Save Studio's address, this harness's key and the account it signed in as to `.decks/studio.json`,
 * which `startStudio` watches, so the deck starts syncing at once. A finished sign-in comes here
 * (`login.ts`), and nothing else: no page hands this harness a key.
 */
export function saveStudioLink(deck: string, url: string, key: string, account?: StudioAccount): { connected: true; url: string } {
	const origin = studioOrigin(url, key);
	const dir = join(deck, ".decks");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "studio.json"), JSON.stringify({ url: origin, key, ...(account?.email ? { account } : {}) }), { mode: 0o600 });
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
	link: Pick<SyncOptions, "issueToken" | "unlinked" | "remote" | "presence"> & { addresses?: () => string[]; progress?: (progress: SyncProgress | undefined) => void } = {},
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
		told.stop();
		link.progress?.(undefined);
		if (!want) return;
		const { addresses: _addresses, progress: _progress, ...syncLink } = link;
		const linked = want;
		// How far the deck is in step: to Settings at once, and to Studio by the key (`progressTeller`).
		const progress = (now: SyncProgress) => {
			link.progress?.(now);
			told.tell(linked, now);
		};
		sync = new HarnessSync({ deck, studio: want.url, key: want.key, ...(harness ? { harness } : {}), ...(inventory ? { inventory } : {}), ...(harnessToken ? { harnessToken } : {}), ...syncLink, progress });
		sync.start().catch((error) => console.error(`[decks] studio: ${(error as Error).message}`));
		void report();
	};

	/*
	 * Where this harness can be reached, said to Studio by its key: at each link, and whenever the
	 * list changes (`report`). Studio not reached is tried again in a minute, while the link is the same.
	 */
	let reporting: ReturnType<typeof setTimeout> | undefined;
	const report = async () => {
		clearTimeout(reporting);
		const want = read();
		const urls = link.addresses?.();
		if (!want || !urls) return;
		const linked = current;
		try {
			const response = await fetch(`${want.url}/sync/v1/addresses`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${want.key}` }, body: JSON.stringify({ urls }) });
			// A Studio from before it kept addresses answers 404: nothing to try again for.
			if (!response.ok && response.status !== 404) throw new Error(`Studio answered ${response.status}`);
		} catch {
			if (current === linked) {
				reporting = setTimeout(() => void report(), 60_000);
				reporting.unref?.();
			}
		}
	};

	const told = progressTeller();
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
			clearTimeout(reporting);
			told.stop();
			await sync?.stop();
		},
		report: () => void report(),
		syncNow: () => void sync?.sync(),
		status: () => ({ connected: Boolean(sync), url: current ? current.split(" ")[0] : undefined, ...(sync ? { sync: sync.progress() } : {}) }),
		edited: (name, change) => sync?.edited(name, change),
		presence: (name, message) => sync?.presence(name, message),
	};
}

/**
 * How far the deck is in step, told to Studio by the key (`PUT /sync/v1/progress`), so Studio can show it
 * beside the harness: at once when the state changes, else at most every two seconds while files move,
 * the last word always sent. A Studio from before it kept progress answers 404, and is told nothing more
 * on that link; one out of reach hears the next change.
 */
export const PROGRESS_EVERY_MS = 2_000;

function progressTeller() {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastAt = 0;
	let lastState = "";
	let waiting: { link: { url: string; key: string }; progress: SyncProgress } | undefined;
	const deaf = new Set<string>();
	const send = () => {
		clearTimeout(timer);
		timer = undefined;
		const one = waiting;
		waiting = undefined;
		if (!one || deaf.has(one.link.key)) return;
		lastAt = Date.now();
		lastState = one.progress.state;
		void fetch(`${one.link.url}/sync/v1/progress`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${one.link.key}` }, body: JSON.stringify(one.progress) })
			.then(async (response) => {
				await response.arrayBuffer().catch(() => undefined);
				if (response.status === 404) deaf.add(one.link.key);
			})
			.catch(() => {
				/* Studio out of reach: the sync says offline itself, and the next change is told */
			});
	};
	return {
		tell(link: { url: string; key: string }, progress: SyncProgress) {
			waiting = { link, progress };
			if (progress.state !== lastState || Date.now() - lastAt >= PROGRESS_EVERY_MS) return send();
			timer ??= setTimeout(send, PROGRESS_EVERY_MS - (Date.now() - lastAt));
			timer.unref?.();
		},
		stop() {
			clearTimeout(timer);
			timer = undefined;
			waiting = undefined;
			lastState = "";
		},
	};
}

/** How far the deck is in step, as a sentence: for `decks studio status`, read by agents and people at a terminal. */
export function syncWords(p: SyncProgress, now = Date.now()): string {
	const mb = (bytes: number) => (bytes < 1e6 ? `${Math.max(0, Math.round(bytes / 1e3))} KB` : bytes < 1e9 ? `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB` : `${(bytes / 1e9).toFixed(2)} GB`);
	const clock = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
	const left = p.skipped ? `; ${p.skipped} ${p.skipped === 1 ? "file is" : "files are"} left out (over 50 MB, or refused)` : "";
	switch (p.state) {
		case "connecting":
			return "Reaching Studio.";
		case "offline":
			return `Not syncing: ${p.error ?? "Studio could not be reached."}${p.syncedAt ? ` Last in step at ${clock(p.syncedAt)}.` : ""}`;
		case "held":
			return `Studio asked for a wait${p.heldUntil && p.heldUntil > now ? ` until ${clock(p.heldUntil)}` : ""}: ${mb(p.bytes.done)} of ${mb(p.bytes.total)} done, the rest go then${left}.`;
		case "synced":
			return `In step with Studio${p.syncedAt ? ` since ${clock(p.syncedAt)}` : ""}${left}.`;
		case "syncing": {
			const moving = p.now?.path ? `, now ${p.now.up === false ? "taking" : "sending"} ${p.now.canvas}/${p.now.path}` : p.now ? `, now ${p.now.canvas}` : "";
			const files = !p.files.total ? "checking what changed" : p.files.done >= p.files.total ? `finishing, every file of ${mb(p.bytes.total)} done` : `${mb(p.bytes.done)} of ${mb(p.bytes.total)}, ${p.files.done} of ${p.files.total} files`;
			return `Syncing: ${files}${moving}${left}.`;
		}
	}
}
