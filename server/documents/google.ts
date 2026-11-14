import { Refused, type Caller } from "../../protocol/index.ts";
import type { Deck, DeckPath, Store } from "../kernel/types.ts";
import { applyAll, diff, transformAll, type Splice } from "./splice.ts";

// Google Docs. The sign-in and the Docs API are given to the feature by the
// server's entry; without them every google call answers unavailable. Rule 10.

export type GoogleStatus = { connected: boolean; email?: string };

/** The server's Google sign-in. */
export interface GoogleAccount {
	status(): Promise<GoogleStatus>;
	connect(url: string): Promise<GoogleStatus>;
	disconnect(): Promise<GoogleStatus>;
}

/** A Google Doc's words, read and written by revision. */
export interface DocsRemote {
	read(id: string): Promise<{ text: string; revision: string }>;
	/** Splices made on revision; a Doc that moved since refuses them as conflict. */
	write(id: string, splices: Splice[], revision: string): Promise<{ revision: string }>;
}

export const NO_GOOGLE = "This server has no Google sign-in set up, so Google Docs are not available.";

/** Call a Google part, or answer unavailable: never any other kind of throw. */
export async function guarded<T>(part: unknown, run: () => Promise<T>): Promise<T> {
	if (!part) throw new Refused("unavailable", NO_GOOGLE, "google.status");
	try {
		return await run();
	} catch (error) {
		if (error instanceof Refused) throw error;
		throw new Refused("unavailable", `Google did not answer: ${(error as Error).message}`, "google.status");
	}
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export type Link = { id: string; mirror: DeckPath };

/** Theirs merged into ours, both made from base; what theirs added that ours did not. */
export function merge3(base: string, theirs: string, ours: string): string {
	if (theirs === base || theirs === ours) return ours;
	if (ours === base) return theirs;
	const moved = transformAll(diff(base, theirs), diff(base, ours), false).a;
	let text = ours;
	for (const s of moved) text = applyAll(text, [s]) ?? text;
	return text;
}

/**
 * One round for a linked Doc. Pull: the Doc moved from base, so its words are
 * merged into the mirror, written as "google" (the page shows it as a change).
 * Push: the mirror moved from base, so its splices go to the Doc.
 */
export async function syncOnce(link: Link, remote: DocsRemote, deck: Deck, store: Store, google: Caller): Promise<"same" | "pulled" | "pushed" | "both"> {
	const key = `google/${link.mirror}`;
	const kept = await store.get(key);
	const base = kept ? (JSON.parse(decoder.decode(kept)) as { text: string; revision: string }) : undefined;
	const doc = await remote.read(link.id);
	const mirror = await deck.read(link.mirror).then((b) => decoder.decode(b), () => "");
	const from = base?.text ?? mirror;
	let pulled = false;
	let ours = mirror;
	if (doc.text !== from) {
		ours = merge3(from, doc.text, mirror);
		if (ours !== mirror) await deck.write(link.mirror, encoder.encode(ours), google);
		pulled = true;
	}
	let revision = doc.revision;
	const pushing = diff(doc.text, ours);
	if (pushing.length) revision = (await remote.write(link.id, pushing, doc.revision)).revision;
	await store.put(key, encoder.encode(JSON.stringify({ text: ours, revision })));
	return pulled && pushing.length ? "both" : pulled ? "pulled" : pushing.length ? "pushed" : "same";
}
