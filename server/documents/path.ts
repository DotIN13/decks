import { layout, Refused } from "../../protocol/index.ts";
import { toDeckPath, type DeckPath } from "../kernel/types.ts";

// A document's path, fenced as every file's is: from the deck's root, nothing hidden. Rule 1.

export function fence(raw: unknown): DeckPath {
	if (typeof raw !== "string" || !raw.trim()) throw new Refused("invalid", "The path is empty: name a document from the deck's root.", "file.list");
	const path = raw.split("\\").join("/").trim().replace(/^\.\/+/, "");
	if (/^(?:[a-z]:|\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(path) || path.includes("\0") || path.split("/").includes("..")) {
		throw new Refused("refused", `${raw} is outside the deck: a path starts at the deck's root.`, "file.list");
	}
	const hidden = layout.hiddenPart(path);
	if (hidden) throw new Refused("refused", `${hidden} is a hidden folder, and no call reads or writes one.`, "file.list");
	return toDeckPath(path);
}
