import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { HarnessSync, type SyncOptions } from "./sync.ts";

/**
 * Decks Studio, from the harness's side: when this harness has a Studio key, its deck syncs with
 * Studio in the background (`sync.ts`); without one, nothing here runs.
 *
 * The key comes from `DECKS_STUDIO_KEY` (and `DECKS_STUDIO_URL`, Studio's address), or from
 * `<deck>/.decks/studio.json`, `{ "url": "…", "key": "dsk_…" }`, which is watched: writing it
 * connects, changing it reconnects, and removing it stops.
 */
export interface StudioLink {
	stop(): Promise<void>;
	/** Whether a sync is running, and to where. */
	status(): { connected: boolean; url?: string };
}

const DEFAULT_URL = "https://studio.decks.app";

/**
 * Save Studio's address and this harness's key to `.decks/studio.json`, which `startStudio` watches,
 * so the deck starts syncing at once. Both the `studio.connect` verb and `POST /api/studio/connect`
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

export function startStudio(deck: string, env: NodeJS.ProcessEnv = process.env, harness?: string, inventory?: SyncOptions["inventory"], harnessToken?: SyncOptions["harnessToken"]): StudioLink {
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
		current = id;
		await sync?.stop();
		sync = undefined;
		if (!want) return;
		sync = new HarnessSync({ deck, studio: want.url, key: want.key, ...(harness ? { harness } : {}), ...(inventory ? { inventory } : {}), ...(harnessToken ? { harnessToken } : {}) });
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
