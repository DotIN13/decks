import { Refused, type Caller } from "../../protocol/index.ts";
import { toDeckPath, type Deck, type DeckPath, type Store } from "../kernel/types.ts";
import type { DocsRemote } from "./google.ts";
import { applyAll, diff, transformAll } from "./splice.ts";

// Linked Google Docs: each a mirror file in docs/google/, kept in step with its
// Doc while a page has the mirror open, every two seconds. Rules 11 and 13.

export const TICK_MS = 2000;
export type GoogleDoc = { id: string; title: string; url: string; modified?: number };
/** A linked Doc: its id, and its mirror in the deck. */
export type Link = { id: string; mirror: DeckPath; title?: string };

/** The Docs API, as the server's entry gives it: the mirror's index-aligned text, and markdown for agents. */
export interface GoogleDocs extends DocsRemote {
	list(query?: string): Promise<GoogleDoc[]>;
	title(id: string): Promise<string>;
	/** The Doc as markdown, the words its page shows, with the revision it was read at. */
	markdown(id: string): Promise<{ text: string; revision: string; title?: string }>;
	/** Make the Doc read as this markdown, by the smallest Docs edits; a Doc that moved since revision is a conflict. */
	writeMarkdown(id: string, markdown: string, revision: string): Promise<void>;
	/** The Doc as Google returned it, for drawing. */
	document?(id: string): Promise<unknown>;
	/** Docs requests the page made for styles, applied now. */
	style?(id: string, requests: unknown[]): Promise<void>;
	comments?(id: string): Promise<GoogleComment[]>;
	comment?(id: string, action: "create" | "reply" | "resolve", fields: { comment?: string; content?: string; quote?: string }): Promise<void>;
}

export type GoogleComment = Record<string, unknown> & { id: string; content?: string; quote?: string; resolved?: boolean };
export type Remote = { state: "synced" | "syncing" | "signin" | "error"; at?: number; message?: string };

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
	await store.put(`links/${mirror}`, encoder.encode(JSON.stringify({ id, title: await docs.title(id) })));
	return { id, mirror };
}

export async function links(store: Store): Promise<Link[]> {
	const out: Link[] = [];
	for (const key of await store.keys("links/")) {
		const kept = decoder.decode((await store.get(key))!);
		const { id, title } = kept.startsWith("{") ? (JSON.parse(kept) as { id: string; title?: string }) : { id: kept, title: undefined };
		out.push({ id, mirror: key.slice("links/".length) as DeckPath, ...(title ? { title } : {}) });
	}
	return out;
}

/** What stands behind a mirror, for its page: the Doc's address and title. */
export async function remoteOf(store: Store, mirror: string): Promise<{ url: string; title?: string } | undefined> {
	const found = (await links(store)).find((one) => one.mirror === mirror);
	return found ? { url: `https://docs.google.com/document/d/${found.id}/edit`, ...(found.title ? { title: found.title } : {}) } : undefined;
}

/** One round over the linked mirrors a page has open; a failed round waits for the next. */
export async function tick(docs: GoogleDocs, deck: Deck, store: Store, isOpen: (path: string) => boolean, tell: (mirror: DeckPath, remote: Remote) => void = () => {}, now = Date.now()): Promise<void> {
	for (const one of await links(store)) {
		if (!isOpen(one.mirror)) continue;
		try {
			await syncOnce(one, docs, deck, store, await creditOf(store, one.id, now));
			tell(one.mirror, { state: "synced", at: now });
		} catch (error) {
			const signin = error instanceof Refused && error.code === "unavailable" && /signed in|sign-in|client/i.test(error.message);
			tell(one.mirror, { state: signin ? "signin" : "error", message: (error as Error).message });
		}
	}
}

/** The Doc a mirror is linked to, or not_found. */
export async function linkOf(store: Store, mirror: string): Promise<Link> {
	const found = (await links(store)).find((one) => one.mirror === mirror);
	if (!found) throw new Refused("not_found", `${mirror} is not a linked Google Doc's mirror.`, "google.link");
	return found;
}

/** Credit the next pull of a Doc to whoever changed it. */
export async function credit(store: Store, id: string, by: Caller, now = Date.now()): Promise<void> {
	await store.put(`credit/${id}`, encoder.encode(JSON.stringify({ caller: by, until: now + CREDIT_MS })));
}

export const CREDIT_MS = 15_000;

async function creditOf(store: Store, id: string, now: number): Promise<Caller> {
	const kept = await store.get(`credit/${id}`);
	const credit = kept ? (JSON.parse(decoder.decode(kept)) as { caller: Caller; until: number }) : undefined;
	return credit && credit.until > now ? credit.caller : GOOGLE;
}

// The sync of one linked Doc with its mirror, three ways.

/** Theirs merged into ours, both made from base. At one spot, theirs (already saved) goes first. */
export function merge3(base: string, theirs: string, ours: string): string {
	if (theirs === base || theirs === ours) return ours;
	if (ours === base) return theirs;
	const moved = transformAll(diff(base, theirs), diff(base, ours), true).a;
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
