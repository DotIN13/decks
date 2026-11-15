import { Refused, type Caller } from "../../protocol/index.ts";
import { toDeckPath, type Deck, type DeckPath, type Store } from "../kernel/types.ts";
import { syncOnce, type DocsRemote, type Link } from "./google.ts";

// Linked Google Docs: each a mirror file in docs/google/, kept in step with its
// Doc while a page has the mirror open, every two seconds. Rule 11.

export const TICK_MS = 2000;
export type GoogleDoc = { id: string; title: string; url: string; modified?: number };

/** The Docs API, as the server's entry gives it. */
export interface GoogleDocs extends DocsRemote {
	list(query?: string): Promise<GoogleDoc[]>;
	title(id: string): Promise<string>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const GOOGLE: Caller = { kind: "app", id: "google", name: "Google Docs" };

/** A Doc's id from its address, or the id itself. */
export function docIdOf(url: string): string {
	const id = /\/document\/d\/([\w-]+)/.exec(url)?.[1] ?? (/^[\w-]{20,}$/.test(url) ? url : undefined);
	if (!id) throw new Refused("invalid", `${url} is not a Google Doc's address.`, "google.list");
	return id;
}

const slug = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "doc";

/** Link a Doc: its mirror written from the Doc, the link kept. A Doc linked before keeps its mirror. */
export async function link(docs: GoogleDocs, deck: Deck, store: Store, url: string): Promise<Link> {
	const id = docIdOf(url);
	for (const one of await links(store)) if (one.id === id) return one;
	const mirror = toDeckPath(`docs/google/${slug(await docs.title(id))}-${id.slice(0, 6)}.md`);
	const doc = await docs.read(id);
	await deck.write(mirror, encoder.encode(doc.text), GOOGLE);
	await store.put(`google/${mirror}`, encoder.encode(JSON.stringify({ text: doc.text, revision: doc.revision })));
	await store.put(`links/${mirror}`, encoder.encode(id));
	return { id, mirror };
}

export async function links(store: Store): Promise<Link[]> {
	const out: Link[] = [];
	for (const key of await store.keys("links/")) out.push({ id: decoder.decode((await store.get(key))!), mirror: key.slice("links/".length) as DeckPath });
	return out;
}

/** One round over the linked mirrors a page has open; a failed round waits for the next. */
export async function tick(docs: GoogleDocs, deck: Deck, store: Store, isOpen: (path: string) => boolean): Promise<void> {
	for (const one of await links(store)) {
		if (!isOpen(one.mirror)) continue;
		await syncOnce(one, docs, deck, store, GOOGLE).catch(() => undefined);
	}
}
