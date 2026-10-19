import type { UploadedAsset } from "@decks/protocol";
import type { Picture, Placed } from "../canvas/editor/core/clip.ts";
import { api } from "../connections/connection.ts";
import { uploadAsset } from "./upload.ts";

/**
 * A picture dragged or pasted onto the canvas, placed next to it before it lands
 * (`canvas/editor/dom/clip-drop.ts`): a picture already in the deck is used where it is; one from
 * outside is copied into the deck's `assets/` first, as a dropped file is: bytes the page holds (a
 * `data:` or `blob:` picture, a drawing on a canvas, an SVG drawn on a board) are uploaded, and a
 * picture on the web is fetched by the server (`/api/upload-url`). An SVG is shown live and a film
 * plays, so those also bring what the server says about the file (`/api/where`).
 */

/** A deck path as the stage file writes it: from `canvases/<name>/`, two folders up (`files.ts`). */
const fromStage = (path: string) => `../../${path}`;

type Where = { inDeck: boolean; path?: string; preview?: { preview: string; w: number; h: number }; media?: Placed["media"] & { kind: "video" | "audio" } };
const where = async (path: string): Promise<Where> => ((await (await fetch(api(`/where?path=${encodeURIComponent(path)}`))).json().catch(() => ({ inDeck: false }))) as Where);

/** A file name for bytes that came with none. */
function nameFor(src: string | undefined, fallback: string): string {
	if (!src || /^(data|blob):/i.test(src)) return fallback;
	try {
		const last = decodeURIComponent(new URL(src, location.href).pathname.split("/").filter(Boolean).pop() ?? "");
		return /\.[A-Za-z0-9]{2,5}$/.test(last) ? last : fallback;
	} catch {
		return fallback;
	}
}

/** Copied into the deck: bytes the page can read itself are uploaded, a picture on another site is fetched by the server. */
async function copyIn(src: string, fallback: string): Promise<UploadedAsset | undefined> {
	const url = new URL(src, location.href);
	if (/^https?:$/.test(url.protocol) && url.origin !== location.origin) {
		const answer = await fetch(api("/upload-url"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.href }) });
		if (!answer.ok) throw new Error((await answer.text()).trim() || `the picture could not be fetched (${answer.status})`);
		return (await answer.json()) as UploadedAsset;
	}
	const blob = await (await fetch(url.href)).blob();
	return uploadAsset(new File([blob], nameFor(src, fallback), { type: blob.type }));
}

const extensionOf = (type: string) => ({ "image/jpeg": "jpg", "image/svg+xml": "svg", "image/webp": "webp", "image/gif": "gif" })[type] ?? "png";

export async function placePicture(picture: Picture): Promise<Placed | undefined> {
	if (picture.kind === "svg") {
		const file = (await uploadAsset(new File([picture.svg ?? ""], `${(picture.alt || "chart").replace(/[^\w-]+/g, "-").slice(0, 40) || "chart"}.svg`, { type: "image/svg+xml" }))).path;
		const still = (await where(file)).preview?.preview;
		return { url: fromStage(still ?? file), file, ...(still ? { still } : {}) };
	}
	if (picture.kind === "canvas") {
		const blob = await (await fetch(picture.data ?? "")).blob();
		return { url: fromStage((await uploadAsset(new File([blob], "drawing.png", { type: "image/png" }))).path) };
	}
	if (picture.kind === "video" || picture.kind === "audio") {
		const file = picture.path ?? (picture.src ? (await copyIn(picture.src, picture.kind === "video" ? "film.mp4" : "sound.mp3"))?.path : undefined);
		if (!file) return undefined;
		const media = (await where(file)).media;
		if (!media) return undefined;
		return { url: fromStage(media.poster ?? file), file, media };
	}
	let path = picture.path;
	if (!path && picture.src) {
		const type = /^data:([^;,]+)/.exec(picture.src)?.[1] ?? "image/png";
		path = (await copyIn(picture.src, `${(picture.alt || "picture").replace(/[^\w-]+/g, "-").slice(0, 40) || "picture"}.${extensionOf(type)}`))?.path;
	}
	if (!path) return undefined;
	// An SVG is shown live, over a still the server draws of it (`liveFileItem`).
	if (/\.svg$/i.test(path)) {
		const still = (await where(path)).preview?.preview;
		return { url: fromStage(still ?? path), file: path, ...(still ? { still } : {}) };
	}
	return { url: fromStage(path) };
}
