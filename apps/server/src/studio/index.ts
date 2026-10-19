import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { HarnessSync } from "./sync.ts";

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

export function startStudio(deck: string, env: NodeJS.ProcessEnv = process.env, harness?: string): StudioLink {
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
		sync = new HarnessSync({ deck, studio: want.url, key: want.key, ...(harness ? { harness } : {}) });
		sync.start().catch((error) => console.error(`[decks] studio: ${(error as Error).message}`));
	};

	void apply();
	if (!env.DECKS_STUDIO_KEY) {
		try {
			watcher = watch(join(deck, ".decks"), (_event, name) => {
				if (name === "studio.json") void apply();
			});
		} catch {
			// No .decks folder yet: the key can still come by environment on the next start.
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
