import { defineCall } from "../call.ts";
import { arr, bool, named, num, obj, opt, str } from "../schema.ts";
import { File } from "../shapes.ts";
import { PEOPLE, PERSON } from "./parts.ts";

// The Google sign-in the server edits Google Docs with, shaped like studio.*,
// and the Docs themselves: list, link, read and edit as markdown.

const Google = obj({ connected: bool(), email: opt(str()) });

export const status = defineCall({ name: "google.status", summary: "Whether the server is signed in to Google, and as whom.", who: PERSON, args: {}, answer: Google, effect: "read" });

export const connect = defineCall({
	name: "google.connect",
	summary: "Finish a Google sign-in from the address the browser landed on.",
	who: PERSON,
	args: { url: str() },
	answer: Google,
	effect: "change",
});

export const disconnect = defineCall({ name: "google.disconnect", summary: "Sign out of Google.", who: PERSON, args: {}, answer: Google, effect: "change" });

const GoogleDoc = named("GoogleDoc", obj({ id: str(), title: str(), url: str(), modified: opt(num()) }), "A Google Doc the person can link.");

export const list = defineCall({ name: "google.list", summary: "The person's Google Docs, those matching query when given.", who: PERSON, args: { query: opt(str()) }, answer: arr(GoogleDoc), effect: "read" });

export const link = defineCall({
	name: "google.link",
	summary: "Link a Google Doc: its mirror in docs/ is made and kept in step, and a document item can then name it.",
	who: PERSON,
	args: { url: str(), canvas: opt(str()) },
	answer: File,
	effect: "change",
});

const Doc = str("A Google Doc's address or id.");

export const read = defineCall({
	name: "google.read",
	summary: "A Google Doc as markdown, the same text its Decks page shows. Unavailable when the server is not signed in to Google.",
	who: PEOPLE,
	args: { doc: Doc },
	answer: obj({ doc: str(), title: opt(str()), text: str() }),
	effect: "read",
});

export const edit = defineCall({
	name: "google.edit",
	summary: "Replace one exact piece of a Doc's markdown with new markdown, landing as a change the person reviews on the Doc. Refused as invalid when old is missing or not unique.",
	who: PEOPLE,
	args: { doc: Doc, old: str("The exact markdown to replace, found once."), new: str("What replaces it; empty deletes it.") },
	answer: obj({ doc: str(), text: str() }),
	effect: "change",
});
