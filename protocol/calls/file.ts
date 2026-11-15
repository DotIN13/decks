import { defineCall } from "../call.ts";
import { arr, bool, int, opt, str } from "../schema.ts";
import { Deleted, DocState, File, FileMatch, FileText, Spliced, Splice, TextEdit, Version } from "../shapes.ts";
import { ANYONE, NOT_CARD } from "./parts.ts";

// Every file in the deck, and only the deck: no hidden folder, and no folder
// outside it, an app's source included; there is no mount (DESIGN section 10).
// A file written through a call carries its author. Paths start at the root.

const Path = str("A path from the deck's root; nothing outside the deck can be named.");

export const list = defineCall({
	name: "file.list",
	summary: "The files and folders in a folder of the deck. The deck only: never a folder outside it, an app's source included.",
	who: NOT_CARD,
	args: { path: Path, deep: opt(bool()) },
	answer: arr(File),
	effect: "read",
});

export const find = defineCall({
	name: "file.find",
	summary: "Files whose path matches a pattern (*.md, cards/*/index.html), under path. The deck only: never a folder outside it, an app's source included.",
	who: NOT_CARD,
	args: { pattern: str(), path: opt(Path), limit: opt(int()) },
	answer: arr(File),
	effect: "read",
});

export const read = defineCall({
	name: "file.read",
	summary: "A text file's words, with its revision for a later write; from and lines read part of it, sha a past version. The deck only: never a folder outside it, an app's source included.",
	who: ANYONE,
	args: { path: Path, from: opt(int()), lines: opt(int()), sha: opt(str()) },
	answer: FileText,
	effect: "read",
});

export const write = defineCall({
	name: "file.write",
	summary: "Write a whole file. rev, when given, must be the file's current revision, or the write is a conflict. The deck only: never a folder outside it, an app's source included.",
	who: NOT_CARD,
	args: { path: Path, text: str(), rev: opt(int()) },
	answer: File,
	effect: "change",
});

export const edit = defineCall({
	name: "file.edit",
	summary: "Replace exact words in a file, each find matching once unless all is set; all edits or none. The deck only: never a folder outside it, an app's source included.",
	who: NOT_CARD,
	args: { path: Path, edits: arr(TextEdit), rev: opt(int()) },
	answer: File,
	effect: "change",
});

export const grep = defineCall({
	name: "file.grep",
	summary: "Lines that match a regular expression, in files under path. The deck only: never a folder outside it, an app's source included.",
	who: NOT_CARD,
	args: { pattern: str(), path: opt(Path), glob: opt(str()), limit: opt(int()) },
	answer: arr(FileMatch),
	effect: "read",
});

export const move = defineCall({
	name: "file.move",
	summary: "Move or rename a file or folder inside the deck. The deck only: never a folder outside it, an app's source included.",
	who: NOT_CARD,
	args: { path: Path, to: Path },
	answer: File,
	effect: "change",
});

export const remove = defineCall({
	name: "file.delete",
	summary: "Delete a file or folder. Its last content stays in the deck's history. The deck only: never a folder outside it, an app's source included.",
	who: NOT_CARD,
	args: { path: Path },
	answer: Deleted,
	effect: "change",
});

export const url = defineCall({
	name: "file.url",
	summary: "A file's address, as a card embeds it. The deck only: never a folder outside it, an app's source included.",
	who: ANYONE,
	args: { path: Path },
	answer: str(),
	effect: "read",
});

// A document is a file you type into: its page opens it, lands typing as
// splices, and reviews the edits others made.

const Client = str("The page's own id, so its typing is not echoed back.");

export const open = defineCall({ name: "file.open", summary: "Join a page to a document: its words, revision and the edits waiting for review. The deck only: never a folder outside it, an app's source included.", who: ANYONE, args: { path: Path, client: Client }, answer: DocState, effect: "read" });
export const close = defineCall({ name: "file.close", summary: "The page leaves the document. The deck only: never a folder outside it, an app's source included.", who: ANYONE, args: { path: Path, client: Client }, answer: DocState, effect: "read" });

export const splice = defineCall({
	name: "file.splice",
	summary: "Land a page's typing at revision rev, one batch at a time. Splices that no longer fit are refused by index. The deck only: never a folder outside it, an app's source included.",
	who: NOT_CARD,
	args: { path: Path, client: Client, rev: int(), batch: str(), splices: arr(Splice) },
	answer: Spliced,
	effect: "change",
});

export const review = defineCall({
	name: "file.review",
	summary: "Accept or reject an edit waiting for review, or all of them with change: *. The deck only: never a folder outside it, an app's source included.",
	who: NOT_CARD,
	args: { path: Path, change: str(), accept: bool() },
	answer: DocState,
	effect: "change",
});

export const versions = defineCall({ name: "file.versions", summary: "A document's kept versions, newest first. The deck only: never a folder outside it, an app's source included.", who: ANYONE, args: { path: Path }, answer: arr(Version), effect: "read" });
export const restore = defineCall({ name: "file.restore", summary: "Put a document back as it was at a version; the restore is itself a version. The deck only: never a folder outside it, an app's source included.", who: NOT_CARD, args: { path: Path, sha: str() }, answer: File, effect: "change" });
