import { homedir, tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { layout, Refused } from "../../protocol/index.ts";
import { toDeckPath, type DeckPath } from "./types.ts";

// A mount: apps/<name> in the deck resolves to a folder outside it. The
// folder must be absolute, not the root, a home folder, a system folder,
// the deck or inside it, or inside a hidden folder (a temporary folder is
// allowed, for tests). Nothing above the folder is reachable through it.

export type Mount = { prefix: DeckPath; folder: string };

const SYSTEM = ["/System", "/usr", "/bin", "/sbin", "/etc", "/private", "/Library", "/Applications", "/var", "/opt", "/dev", "/cores"];

const inside = (child: string, parent: string) => {
	const rel = relative(parent, child);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const bad = (message: string) => new Refused("invalid", message, "app.get");

/** Checks a mount once; answers it with the folder made absolute and clean. */
export function checkMount(prefix: string, folder: string, deckRoot?: string): Mount {
	const path = toDeckPath(prefix);
	const parts = path.split("/");
	if (parts.length !== 2 || parts[0] !== "apps" || !layout.plainSegment(parts[1])) throw bad(`${prefix} is not apps/<name>; only an app's folder may be mounted.`);
	if (!isAbsolute(folder)) throw bad(`${folder} is not an absolute path.`);
	const full = resolve(folder);
	const temp = inside(full, resolve(tmpdir())) && full !== resolve(tmpdir());
	if (full === sep || full === resolve(homedir()) || resolve(homedir(), "..") === full) throw bad(`${full} is too wide to mount; name the app's own folder.`);
	if (!temp && SYSTEM.some((one) => inside(full, one))) throw bad(`${full} is a system folder.`);
	if (deckRoot && (inside(full, resolve(deckRoot)) || inside(resolve(deckRoot), full))) throw bad(`${full} is the deck or inside it; an app in the deck needs no mount.`);
	if (full.split(sep).some((part) => part.length > 1 && part.startsWith("."))) throw bad(`${full} is inside a hidden folder.`);
	return { prefix: path, folder: full };
}

/** The mounts of one deck, and which one a path falls under. */
export class Mounts {
	private all = new Map<DeckPath, string>();

	add(mount: Mount): void {
		this.all.set(mount.prefix, mount.folder);
	}

	remove(prefix: DeckPath): boolean {
		return this.all.delete(prefix);
	}

	list(): Mount[] {
		return [...this.all].map(([prefix, folder]) => ({ prefix, folder }));
	}

	/** The mount a path is under, and the rest of the path inside its folder ("" for the mount itself). */
	find(path: string): { mount: Mount; rest: string } | undefined {
		for (const [prefix, folder] of this.all) {
			if (path === prefix) return { mount: { prefix, folder }, rest: "" };
			if (path.startsWith(`${prefix}/`)) return { mount: { prefix, folder }, rest: path.slice(prefix.length + 1) };
		}
		return undefined;
	}

	isMount(path: string): boolean {
		return this.all.has(path as DeckPath);
	}
}
