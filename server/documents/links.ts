import { Refused, type Caller } from "../../protocol/index.ts";
import { toDeckPath, type Deck, type DeckPath, type Store } from "../kernel/types.ts";
import { syncOnce, type DocsRemote, type Link } from "./google.ts";

// Linked Google Docs: each a mirror file in docs/google/, kept in step with its
// Doc while a page has the mirror open, every two seconds. Rule 11.

export const TICK_MS = 2000;
export type GoogleDoc = { id: string; title: string; url: string; modified?: number };

/** The Docs API, as the server's entry gives it: the mirror's index-aligned text, and markdown for agents. */
export interface GoogleDocs extends DocsRemote {
	list(query?: string): Promise<GoogleDoc[]>;
	title(id: string): Promise<string>;
	/** The Doc as markdown, the words its page shows, with the revision it was read at. */
	markdown(id: string): Promise<{ text: string; revision: string; title?: string }>;
	/** Make the Doc read as this markdown, by the smallest Docs edits; a Doc that moved since revision is a conflict. */
	writeMarkdown(id: string, markdown: string, revision: string): Promise<void>;
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
export async function tick(docs: GoogleDocs, deck: Deck, store: Store, isOpen: (path: string) => boolean, now = Date.now()): Promise<void> {
	for (const one of await links(store)) {
		if (!isOpen(one.mirror)) continue;
		await syncOnce(one, docs, deck, store, await creditOf(store, one.id, now)).catch(() => undefined);
	}
}

// Rule 13: an agent reads a Doc as its text and edits it by one exact replacement. The edit goes
// to Google; the next pull into its mirror is credited to that agent, so the page shows it as theirs.

export const CREDIT_MS = 15_000;

async function creditOf(store: Store, id: string, now: number): Promise<Caller> {
	const kept = await store.get(`credit/${id}`);
	const credit = kept ? (JSON.parse(decoder.decode(kept)) as { caller: Caller; until: number }) : undefined;
	return credit && credit.until > now ? credit.caller : GOOGLE;
}

/** A Doc's words and title, by its address or id. */
export async function readDoc(docs: GoogleDocs, url: string): Promise<{ doc: string; title?: string; text: string }> {
	const id = docIdOf(url);
	const doc = await docs.markdown(id);
	return { doc: id, ...(doc.title ? { title: doc.title } : {}), text: doc.text };
}

/** Replace one exact piece of a Doc's words, all of it or none; the Doc's words as they now are. */
export async function editDoc(docs: GoogleDocs, store: Store, url: string, old: string, next: string, by: Caller, now = Date.now()): Promise<{ doc: string; text: string }> {
	const id = docIdOf(url);
	const doc = await docs.markdown(id);
	const count = old ? doc.text.split(old).length - 1 : 0;
	if (count !== 1) throw new Refused("invalid", count === 0 ? "Those exact words are not in the Doc: google.read shows its words as they are now." : `Those words are in the Doc ${count} times: give more of them, so they are found once.`, "google.read");
	const at = doc.text.indexOf(old);
	await docs.writeMarkdown(id, doc.text.slice(0, at) + next + doc.text.slice(at + old.length), doc.revision);
	await store.put(`credit/${id}`, encoder.encode(JSON.stringify({ caller: by, until: now + CREDIT_MS })));
	return { doc: id, text: (await docs.markdown(id)).text };
}
