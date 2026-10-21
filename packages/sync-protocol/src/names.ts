/**
 * What a sharing service sends is not trusted to name places on a harness's disk, and what a
 * harness sends is not trusted to name places in the service's store. A canvas's name becomes a
 * folder under canvases/ or shared/canvases/, and a file's path a file in that canvas's folder;
 * either, unchecked, could be `../../.ssh/authorized_keys`. Both sides check them here, the same way.
 */

/** Where a deck keeps its canvases, and where a friend's land: `shared/canvases/<owner>/<canvas>/`. */
export const CANVASES = "canvases";
export const SHARED_CANVASES = "shared/canvases";
/** What a canvas's own folder holds besides its drawing (`canvas.pen`). */
export const OWN_PARTS = ["boards", "frames", "files"] as const;
/** The deck folders a canvas's boards may point at, synced at their deck paths inside the canvas's bundle. */
export const MIRRORED_PARTS = ["assets", "docs"] as const;
/** The canvas's pictures, the one hidden part a bundle has. */
export const PICTURES = ".pictures";
/** Every top-level part a synced file of a canvas can be in. */
export const BUNDLE_PARTS: readonly string[] = [...OWN_PARTS, ...MIRRORED_PARTS, PICTURES];

/** A canvas's folder name as the service keeps it: letters, digits, dots, dashes and underscores, starting with a letter or digit, at most 100. */
export const CANVAS_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const CANVAS_NAME_ERROR = "Name the canvas folder: letters, digits, dots, dashes and underscores, starting with a letter or digit, at most 100.";

/** Whether a canvas name from the other side may name a folder. */
export function safeCanvasName(name: unknown): name is string {
	return typeof name === "string" && CANVAS_NAME.test(name) && name !== "." && name !== "..";
}

/**
 * Whether a canvas folder's name is one plain segment of canvases/. Looser than `safeCanvasName`,
 * because a folder made on a harness by hand (with a space in it, say) is the person's and still syncs.
 */
export function safeCanvasFolder(name: unknown): name is string {
	return typeof name === "string" && name.length > 0 && name.length <= 200 && name !== "." && name !== ".." && !/[/\\\0]/.test(name);
}

export const CANVAS_PATH_ERROR = "A path inside a canvas's boards/, frames/, files/, assets/, docs/ or .pictures/, with no empty, . or .. parts and no hidden folder.";

/**
 * Whether a file path may name a file of a canvas: in one of its bundle's parts, every segment a
 * plain name (`.pictures` the one hidden part, and only first), no backslashes or NULs, at most 1000.
 */
export function safeSyncPath(path: unknown): path is string {
	if (typeof path !== "string" || !path || path.length > 1000 || path.includes("\\") || path.includes("\0")) return false;
	const parts = path.split("/");
	if (parts.length < 2 || !BUNDLE_PARTS.includes(parts[0]!)) return false;
	return parts.every((part, i) => part !== "" && part !== "." && part !== ".." && (i === 0 || !part.startsWith(".")));
}

const SECRET_FILE = /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore)|id_(?:rsa|ed25519|ecdsa).*|credentials\.json)$/i;

/**
 * Whether a file looks like a secret, or a dependency, and so is never synced either way: an `.env`,
 * a key or certificate, an SSH key, a `credentials.json`, anything in `node_modules`.
 */
export function secretLooking(path: string): boolean {
	const parts = path.split("/");
	return parts.includes("node_modules") || SECRET_FILE.test(parts[parts.length - 1] ?? "");
}
