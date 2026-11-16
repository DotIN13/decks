// Files dropped on the page, with no store and no DOM: which a canvas shows
// as itself (a picture, words, a player), which open as documents, how far
// a deck path is from a canvas's folder, and a size in words.
import { layout } from "@decks/protocol";

export const RASTER = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"]);
const WORDS = new Set(["md", "markdown", "mdx", "txt", "text"]);
const CARD_BYTES = 256 * 1024;
export const PLAYABLE = new Set(["mp4", "m4v", "webm", "mov", "ogv", "mkv", "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "weba"]);
export const DOCUMENTS = new Set(["md", "markdown", "txt", "tex", "bib", "sty", "cls", "ltx", "rst", "org", "docx"]);

type Named = { name: string; type: string; size: number };

export const extensionOf = (file: { name: string }) => (file.name.split(".").pop() ?? "").toLowerCase();
export const isRaster = (file: Named) => RASTER.has(extensionOf(file)) || (file.type.startsWith("image/") && file.type !== "image/svg+xml");
export const isWords = (file: Named) => file.size <= CARD_BYTES && (WORDS.has(extensionOf(file)) || file.type === "text/markdown" || file.type === "text/plain");
export const isPlayable = (file: Named) => PLAYABLE.has(extensionOf(file)) || file.type.startsWith("video/") || file.type.startsWith("audio/");
export const showsAsItself = (file: Named) => isRaster(file) || isWords(file) || isPlayable(file);

/** A deck path as the canvas's page reaches it: inside its folder plainly, else up and back down. */
export function fromCanvas(asset: string, canvas: string | undefined): string {
	if (!canvas) return `../../${asset}`;
	const folder = layout.canvasFolder(canvas);
	if (asset.startsWith(`${folder}/`)) return asset.slice(folder.length + 1);
	return `${"../".repeat(folder.split("/").length)}${asset}`;
}

export function sizeLabel(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type Browsed = { path: string; parent: string | null; entries: Array<{ name: string; path: string; kind: "dir" | "file"; size?: number }> };

/** file.list's answer as the picker lists a folder: its entries by name, and the folder above it. */
export function browsed(path: string, files: ReadonlyArray<{ path: string; size?: number; dir?: boolean }>): Browsed {
	const parent = path ? path.split("/").slice(0, -1).join("/") : null;
	const entries = files.map((one) => ({ name: one.path.split("/").pop() ?? one.path, path: one.path, kind: one.dir ? ("dir" as const) : ("file" as const), ...(one.size !== undefined ? { size: one.size } : {}) }));
	return { path, parent, entries };
}

/** A deck file's address through the server's files door. */
export const fileAddress = (path: string): string => `/files/${path.split("/").map(encodeURIComponent).join("/")}`;
