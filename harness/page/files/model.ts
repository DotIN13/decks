// Files dropped on the page, with no store and no DOM: which a canvas shows
// as itself (a picture, words, a player), which open as documents, how far
// a deck path is from a canvas's folder, and a size in words.

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

/** A canvas's folder: a friend's under shared/canvases/<owner>/, yours under canvases/. */
export function folderOf(name: string): string {
	const friend = /^shared\/([^/]+)\/([^/]+)$/.exec(name);
	return friend ? `shared/canvases/${friend[1]}/${friend[2]}` : `canvases/${name}`;
}

/** A deck path as the canvas's page reaches it: inside its folder plainly, else up and back down. */
export function fromCanvas(asset: string, canvas: string | undefined): string {
	if (!canvas) return `../../${asset}`;
	const folder = folderOf(canvas);
	if (asset.startsWith(`${folder}/`)) return asset.slice(folder.length + 1);
	return `${"../".repeat(folder.split("/").length)}${asset}`;
}

export function sizeLabel(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
