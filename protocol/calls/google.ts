import { defineCall } from "../call.ts";
import { arr, bool, named, num, obj, opt, str } from "../schema.ts";
import { File } from "../shapes.ts";
import { PERSON } from "./parts.ts";

// The Google sign-in the server edits Google Docs with, shaped like studio.*.

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
