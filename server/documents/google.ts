import { Refused } from "../../protocol/index.ts";
import type { Splice } from "./splice.ts";

// Google Docs as the feature sees them: the sign-in and the Docs API it is given, a Doc's id from
// its address, and the rule that without them every google call answers unavailable. Rule 10.

export type GoogleStatus = { connected: boolean; email?: string };
export type GoogleDoc = { id: string; title: string; url: string; modified?: number };
export type GoogleComment = Record<string, unknown> & { id: string; content?: string; quote?: string; resolved?: boolean };

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

/** A Doc's id from its address, or the id itself. */
export function docIdOf(url: string): string {
	const id = /\/document\/d\/([\w-]+)/.exec(url)?.[1] ?? (/^[\w-]{20,}$/.test(url) ? url : undefined);
	if (!id) throw new Refused("invalid", `${url} is not a Google Doc's address.`, "google.list");
	return id;
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
