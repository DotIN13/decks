import type { Caller } from "../../protocol/index.ts";
import { readJson, writeJson } from "../kernel/store.ts";
import type { Deck, DeckPath, Store } from "../kernel/types.ts";
import { parentOf } from "./fence.ts";
import { walk } from "./files.ts";

// Rule 19: what makes a card news. Its writer is who last wrote its index.html
// through a call, or claimed it since (a claim, or the person's resize). It is
// news to the person when a file in its folder changed after they last read it.

export const CLAIMS = "claims/";
export const SEEN = "seen/";
export type News = { by?: string; named?: number; changed?: number; seen?: number };

/** What the person sees of a card's news: its writer and when, its last change, their last read. */
export async function newsOf(deck: Deck, store: Store, path: DeckPath): Promise<News> {
	const writer = await writerOf(deck, store, path);
	const changed = await changedAt(deck, path);
	const seen = await readJson<number | undefined>(store, SEEN + path, undefined);
	return { ...(writer ? { by: writer.by, named: writer.at } : {}), ...(changed ? { changed } : {}), ...(seen ? { seen } : {}) };
}

/** Who named the card theirs, and when: the last write of its index.html, or a later claim. */
async function writerOf(deck: Deck, store: Store, path: DeckPath): Promise<{ by: string; at: number } | undefined> {
	// A write through a call names its writer; one heard on the disk ("disk") or kept from before history does not.
	const wrote = (await deck.revisions?.(path))?.filter((r) => r.by !== "before" && r.by !== "disk").at(-1);
	const claimed = await readJson<{ by: string; rev: number; at?: number } | undefined>(store, CLAIMS + path, undefined);
	if (claimed && (!wrote || claimed.rev >= wrote.rev)) return { by: claimed.by, at: claimed.at ?? wrote?.at ?? 0 };
	return wrote ? { by: wrote.by, at: wrote.at } : undefined;
}

/** The last time any file in the card's folder was written. */
async function changedAt(deck: Deck, path: DeckPath): Promise<number | undefined> {
	const files = await walk(deck, parentOf(path) as DeckPath, true).catch(() => []);
	const times = await Promise.all(files.filter((e) => e.kind === "file").map(async (e) => (await deck.revisions?.(e.path))?.at(-1)?.at ?? e.at));
	return times.length ? Math.max(...times) : undefined;
}

/** A claim holds until the card's index.html is written again. */
export async function claim(store: Store, path: DeckPath, by: Caller, rev: number, at = Date.now()): Promise<void> {
	await writeJson(store, CLAIMS + path, { by: by.id, rev, at });
}

/** The person read the card now; never earlier than its last change, so a skewed clock leaves no dot. */
export async function markSeen(deck: Deck, store: Store, path: DeckPath, now = Date.now()): Promise<number> {
	const news = await newsOf(deck, store, path);
	const at = Math.max(now, news.changed ?? 0, news.named ?? 0);
	await writeJson(store, SEEN + path, at);
	return at;
}
