import { defineCall } from "../call.ts";
import { arr, bool, int, opt, str } from "../schema.ts";
import { Deleted, File, FileMatch, FileText, TextEdit } from "../shapes.ts";
import { ANYONE, NOT_CARD } from "./parts.ts";

// Every file in the deck, fenced to it: no hidden folder, nothing outside.
// A file written through a call carries its author. Paths start at the root.

const Path = str("A path from the deck's root.");

export const list = defineCall({
	name: "file.list",
	summary: "The files and folders in a folder of the deck.",
	who: NOT_CARD,
	args: { path: Path, deep: opt(bool()) },
	answer: arr(File),
	effect: "read",
});

export const find = defineCall({
	name: "file.find",
	summary: "Files whose path matches a pattern (*.md, cards/*/index.html), under path.",
	who: NOT_CARD,
	args: { pattern: str(), path: opt(Path), limit: opt(int()) },
	answer: arr(File),
	effect: "read",
});

export const read = defineCall({
	name: "file.read",
	summary: "A text file's words, with its revision for a later write; from and lines read part of it.",
	who: ANYONE,
	args: { path: Path, from: opt(int()), lines: opt(int()) },
	answer: FileText,
	effect: "read",
});

export const write = defineCall({
	name: "file.write",
	summary: "Write a whole file. rev, when given, must be the file's current revision, or the write is a conflict.",
	who: NOT_CARD,
	args: { path: Path, text: str(), rev: opt(int()) },
	answer: File,
	effect: "change",
});

export const edit = defineCall({
	name: "file.edit",
	summary: "Replace exact words in a file, each find matching once unless all is set; all edits or none.",
	who: NOT_CARD,
	args: { path: Path, edits: arr(TextEdit), rev: opt(int()) },
	answer: File,
	effect: "change",
});

export const grep = defineCall({
	name: "file.grep",
	summary: "Lines that match a regular expression, in files under path.",
	who: NOT_CARD,
	args: { pattern: str(), path: opt(Path), glob: opt(str()), limit: opt(int()) },
	answer: arr(FileMatch),
	effect: "read",
});

export const move = defineCall({
	name: "file.move",
	summary: "Move or rename a file or folder inside the deck.",
	who: NOT_CARD,
	args: { path: Path, to: Path },
	answer: File,
	effect: "change",
});

export const remove = defineCall({
	name: "file.delete",
	summary: "Delete a file or folder. Its last content stays in the deck's history.",
	who: NOT_CARD,
	args: { path: Path },
	answer: Deleted,
	effect: "change",
});

export const url = defineCall({
	name: "file.url",
	summary: "A file's address, as a card embeds it.",
	who: ANYONE,
	args: { path: Path },
	answer: str(),
	effect: "read",
});
