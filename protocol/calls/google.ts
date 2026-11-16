import { defineCall } from "../call.ts";
import { any, arr, bool, int, lit, named, num, obj, opt, str } from "../schema.ts";
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

// A Google Doc on the canvas, by its mirror's deck path (docs/google/<name>.md), never its id.
const Mirror = str("The Doc's mirror in the deck, docs/google/<name>.md.");
const GoogleComment = named("GoogleComment", obj({ id: str(), content: opt(str()), quote: opt(str()), resolved: opt(bool()) }, true), "A comment on a Google Doc, with Google's own fields.");

export const get = defineCall({
	name: "google.get",
	summary: "A linked Doc as Google returned it, for drawing, and the text it reads as, by its mirror's path.",
	who: PEOPLE,
	args: { path: Mirror },
	answer: obj({ path: str(), document: any(), text: str() }),
	effect: "read",
});

export const style = defineCall({
	name: "google.style",
	summary: "Docs requests at the page's indices, made after the typing before them; text is the words the page read them against.",
	who: PEOPLE,
	args: { path: Mirror, requests: arr(any()), text: opt(str()) },
	answer: obj({ path: str(), rev: int() }),
	effect: "change",
});

export const comments = defineCall({ name: "google.comments", summary: "A linked Doc's open comments.", who: PEOPLE, args: { path: Mirror }, answer: arr(GoogleComment), effect: "read" });

export const comment = defineCall({
	name: "google.comment",
	summary: "A new comment on the quoted words, a reply to one, or resolving one. Answers the open comments as they now are.",
	who: PEOPLE,
	args: { path: Mirror, action: lit("create", "reply", "resolve"), comment: opt(str()), content: opt(str()), quote: opt(str()) },
	answer: arr(GoogleComment),
	effect: "change",
});
