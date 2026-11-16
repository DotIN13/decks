import { Refused } from "../../protocol/index.ts";
import type { Splice } from "./splice.ts";

// Google Docs as the feature sees them: the sign-in and the Docs API it is given, and the rule
// that without them every google call answers unavailable. Rule 10.

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
