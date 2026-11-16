import { Refused, type Caller } from "../../protocol/index.ts";
import type { Store } from "../kernel/types.ts";
import { docIdOf, type GoogleDocs } from "./google.ts";
import { credit } from "./links.ts";

// What an agent does to a Google Doc: reads it as markdown, and edits it by one exact replacement.
// The edit goes to Google; the next pull into its mirror is credited to the agent. Rule 13.

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
	await credit(store, id, by, now);
	return { doc: id, text: (await docs.markdown(id)).text };
}
