import { layout, Refused } from "../../protocol/index.ts";
import { toDeckPath, type DeckPath } from "../kernel/types.ts";

// Rule 1: a path starts at the deck's root; outside the deck or hidden is refused.

/** A path a call named, checked: refused when it leaves the deck or names a hidden part. */
export function fence(raw: unknown, what = "path"): DeckPath {
	if (typeof raw !== "string" || !raw.trim()) throw new Refused("invalid", `The ${what} is empty: name a file from the deck's root.`, "file.list");
	const path = raw.split("\\").join("/").trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
	if (path.includes("\0")) throw new Refused("refused", `${raw} has a null byte in it.`, "file.list");
	if (/^(?:[a-z]:|\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(path)) throw new Refused("refused", `${raw} is outside the deck: a path starts at the deck's root.`, "file.list");
	if (path.split("/").includes("..")) throw new Refused("refused", `${raw} climbs out of the deck: a path starts at the deck's root.`, "file.list");
	const hidden = layout.hiddenPart(path);
	if (hidden) throw new Refused("refused", `${hidden} is a hidden folder, and no call reads or writes one.`, "file.list");
	return toDeckPath(path);
}

/** The deck's root, or a folder in it. */
export function fenceDir(raw: unknown): DeckPath | "" {
	if (raw === undefined || raw === "" || raw === "." || raw === "/") return "";
	return fence(raw);
}

/** The folder a path is in, "" for the root. */
export function parentOf(path: DeckPath): DeckPath | "" {
	const at = path.lastIndexOf("/");
	return at === -1 ? "" : (path.slice(0, at) as DeckPath);
}
