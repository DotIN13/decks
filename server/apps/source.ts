import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, normalize, sep } from "node:path";
import { Refused, type Caller } from "../../protocol/index.ts";

// Where an app lives (rules 14 to 17): a source folder outside the deck, which only the person
// names, because the server runs commands there. File calls never reach it.

export type Source = { path: string; repo?: string };
const SYSTEM = ["/System", "/usr", "/bin", "/sbin", "/etc", "/private", "/Library", "/Applications", "/var", "/opt", "/dev", "/Volumes"];

/** Refuse a source or a folder from anyone but the person, naming the call that would work. */
export function personOnly(caller: Caller, what: string, call: string): void {
	if (caller.kind !== "person") throw new Refused("refused", `Only the person may name ${what}: the server runs commands there.`, `${call}, as the person`);
}

/** A folder an app may live in: absolute, not a system or home folder itself, nothing hidden. The OS temp folder is allowed. */
export function outsideFolder(raw: string, home = homedir()): string {
	if (!isAbsolute(raw)) throw new Refused("invalid", `${raw} is not an absolute path.`, "app.move");
	const path = normalize(raw).replace(/\/+$/, "") || "/";
	const parts = path.split(sep).filter(Boolean);
	if (path === "/" || path === home || path === normalize(`${home}/..`)) throw new Refused("invalid", `${path} is a whole home or the disk itself; name a folder for this app.`, "app.move");
	const temp = [tmpdir(), realpathSync(tmpdir())].map((one) => normalize(one).replace(/\/+$/, ""));
	const inTemp = temp.some((root) => path.startsWith(`${root}/`));
	if (!inTemp && SYSTEM.some((root) => path === root || path.startsWith(`${root}/`))) throw new Refused("invalid", `${path} is a system folder.`, "app.move");
	if (parts.some((part) => part.startsWith("."))) throw new Refused("invalid", `${path} is inside a hidden folder.`, "app.move");
	return path;
}

/** The source an app.json names, or undefined when its source is in the deck. */
export function sourceOf(raw: unknown): Source | undefined {
	const read = raw as { path?: unknown; repo?: unknown } | undefined;
	if (!read || typeof read.path !== "string" || !read.path) return undefined;
	return { path: read.path, ...(typeof read.repo === "string" && read.repo ? { repo: read.repo } : {}) };
}
