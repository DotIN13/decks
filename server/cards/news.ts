import type { Caller } from "../../protocol/index.ts";
import type { Deck, DeckPath, Store } from "../kernel/types.ts";
import { parentOf } from "./fence.ts";
import { walk } from "./files.ts";

// Rule 19: what makes a card news. Its writer is who last wrote its index.html
// through a call, or claimed it since (a claim, or the person's resize). It is
// news to the person when a file in its folder changed after they last read it.

const CLAIMS = "claims/";
const SEEN = "seen/";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export type News = { by?: string; named?: number; changed?: number; seen?: number };

async function getJson<T>(store: Store, key: string): Promise<T | undefined> {
	const bytes = await store.get(key);
	return bytes ? (JSON.parse(decoder.decode(bytes)) as T) : undefined;
}

/** Who named the card theirs, and when: the last write of its index.html, or a later claim. */
async function writerOf(deck: Deck, store: Store, path: DeckPath): Promise<{ by: string; at: number } | undefined> {
	const wrote = (await deck.revisions?.(path))?.filter((r) => r.by !== "before").at(-1);
	const claimed = await getJson<{ by: string; rev: number; at?: number }>(store, CLAIMS + path);
	if (claimed && (!wrote || claimed.rev >= wrote.rev)) return { by: claimed.by, at: claimed.at ?? wrote?.at ?? 0 };
	return wrote ? { by: wrote.by, at: wrote.at } : undefined;
}

/** The last time any file in the card's folder was written. */
async function changedAt(deck: Deck, path: DeckPath): Promise<number | undefined> {
	const files = await walk(deck, parentOf(path) as DeckPath, true).catch(() => []);
	const times = await Promise.all(files.filter((e) => e.kind === "file").map(async (e) => (await deck.revisions?.(e.path))?.at(-1)?.at ?? e.at));
	return times.length ? Math.max(...times) : undefined;
}

export async function newsOf(deck: Deck, store: Store, path: DeckPath): Promise<News> {
	const writer = await writerOf(deck, store, path);
	const changed = await changedAt(deck, path);
	const seen = await getJson<number>(store, SEEN + path);
	return { ...(writer ? { by: writer.by, named: writer.at } : {}), ...(changed ? { changed } : {}), ...(seen ? { seen } : {}) };
}

/** A claim holds until the card's index.html is written again. */
export async function claim(store: Store, path: DeckPath, by: Caller, rev: number, at = Date.now()): Promise<void> {
	await store.put(CLAIMS + path, encoder.encode(JSON.stringify({ by: by.id, rev, at })));
}

/** The person read the card now; never earlier than its last change, so a skewed clock leaves no dot. */
export async function markSeen(deck: Deck, store: Store, path: DeckPath, now = Date.now()): Promise<number> {
	const news = await newsOf(deck, store, path);
	const at = Math.max(now, news.changed ?? 0, news.named ?? 0);
	await store.put(SEEN + path, encoder.encode(JSON.stringify(at)));
	return at;
}
