import { createHash } from "node:crypto";
import type { Board } from "@decks/protocol";
import type { Page } from "./pool.ts";

/**
 * The picture ladder: what a card's pictures are called on disk, the widths they are kept at, how a whole
 * picture is sized and taken, and the in-page scripts that measure a card and make a smaller copy.
 */

export type ThumbScheme = "light" | "dark";
/**
 * Which picture: `whole` is the whole card at up to twice its size (screenshots, exports, Studio);
 * `small` is one rung of the canvas's ladder (`SMALL_WIDTHS`), taken straight from the page.
 */
export type ThumbKind = "whole" | "small";
/** The tallest a whole picture is taken, in CSS px of the board: past it the rest is cut. */
const WHOLE_MAX_H = 12_000;

/**
 * The narrowest a whole picture is taken. It is in every picture's file name (`thumbName`), so
 * changing it makes every picture on disk a miss.
 */
export const THUMB_WIDTH = 720;
/**
 * A whole picture is taken at up to twice the board's own size, so a board the canvas draws as its
 * picture stays sharp on a 2x screen up to life size (`canvas/pen/scene.ts` decodes it at the size
 * it is drawn). Capped at 2048 px wide and 16M pixels in all, and never below the card's width.
 */
export function wholeScale(board: Pick<Board, "w" | "h">): number {
	const w = Math.max(200, Math.round(board.w));
	const h = Math.max(150, Math.min(Math.round(board.h), WHOLE_MAX_H));
	return Math.max(THUMB_WIDTH / w, Math.min(2, 2048 / w, Math.sqrt(16_000_000 / (w * h))));
}
/**
 * A whole picture, as WebP at quality 88: at twice a board's size it looks the same as a JPEG at
 * that quality and is half the bytes (three boards at 2000 px wide: 141, 163 and 302 KB against
 * 263, 306 and 569). Lossless WebP was measured too, and came out a tenth larger than the JPEG.
 * Playwright writes only PNG and JPEG, so Chrome is asked directly, at `scale` image pixels per
 * CSS pixel (it does not apply the device scale to a clip itself); a page that cannot be asked (a
 * test's stand-in) gets a JPEG, which `pictureType` tells apart by its bytes.
 */
export async function wholeShot(page: Page, clip: { width: number; height: number }, scale: number): Promise<Buffer> {
	const context = typeof page.context === "function" ? page.context() : undefined;
	if (context && typeof context.newCDPSession === "function") {
		const cdp = await context.newCDPSession(page);
		try {
			const { data } = await cdp.send("Page.captureScreenshot", { format: "webp", quality: 88, clip: { x: 0, y: 0, width: clip.width, height: clip.height, scale }, captureBeyondViewport: true });
			return Buffer.from(data, "base64");
		} finally {
			await cdp.detach().catch(() => {});
		}
	}
	return page.screenshot({ type: "jpeg", quality: 88, clip: { x: 0, y: 0, width: clip.width, height: clip.height }, fullPage: true, animations: "disabled", timeout: 15_000 });
}

/** What a picture file holds, from its first bytes: WebP, or a JPEG from a test's stand-in page. */
export function pictureType(bytes: Uint8Array): "webp" | "jpeg" {
	return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 ? "webp" : "jpeg";
}

/**
 * What a picture is called on disk. The path is hashed: it has slashes and any script in it. A small
 * picture is its rung's copy of the whole one's name (`smallName`), at `width`.
 */
export function thumbName(path: string, rev: number, scheme: ThumbScheme, kind: ThumbKind = "whole", width = SMALL_TAKEN): string {
	const hash = createHash("sha1").update(path).digest("hex").slice(0, 16);
	const whole = `${hash}-${rev}-${scheme}-${THUMB_WIDTH}-whole-l${PICTURE_LOOK}.webp`;
	return kind === "small" ? smallName(whole, width) : whole;
}

/**
 * How boards are drawn, as far as their pictures go: raised when a change to the shipped `lib/`
 * changes every board's look, so every picture is a miss once and is taken again. 2: the board
 * fonts are shipped (`lib/type/`), where the server's Chrome had drawn Liberation Sans. 3: a whole
 * picture is taken at up to twice the board's size (`wholeScale`), where it was 720 px wide, and as
 * WebP (`wholeShot`). The app
 * puts the same number in each picture's address (`thumbUrl`), which the browser keeps a year.
 */
export const PICTURE_LOOK = 3;

/**
 * The canvas's picture ladder: the widths a card's picture is kept at, the rungs the canvas chooses
 * among by how wide it draws the card (`render/picture-ladder.ts`, `LADDER` in `render/device.ts`).
 * No other width is made: a request for one is refused (`keptWidth`).
 */
export const SMALL_WIDTHS: readonly number[] = [192, 480, 800];
/** A request's `w=` when it is a rung of the ladder; undefined for anything else. */
export function keptWidth(width: number): number | undefined {
	return SMALL_WIDTHS.includes(width) ? width : undefined;
}
/**
 * The rungs taken straight from the page (`ThumbKind` "small"): a screenshot at 480 px took 163 ms
 * where the whole one at twice the card's size took 1,522. Each rung below one is cut from the next
 * taken one up (192 from 480).
 */
export const TAKEN_WIDTHS: readonly number[] = [480, 800];
/** The rung the background takes every card at, and the one an older revision's height is read from. */
export const SMALL_TAKEN = 480;
/**
 * The rungs made for every card on a canvas ahead of being asked: the far ones, which every device
 * draws. 800 is taken the first time a canvas asks for it (a computer zoomed in near the live zoom),
 * and kept from then on.
 */
export const AHEAD_WIDTHS: readonly number[] = [192, 480];

/** A whole picture's smaller copy, beside it on disk. */
export function smallName(whole: string, width: number): string {
	return whole.replace(/-whole(-l\d+)?\.(webp|jpg)$/, (_m, look: string | undefined) => `-whole-w${width}${look ?? ""}.webp`);
}

/** Every rung of a card's pictures, in a scheme, whatever its revision. */
export function smallOf(path: string, scheme: ThumbScheme): RegExp {
	const hash = thumbName(path, 0, scheme).slice(0, 16);
	return new RegExp(`^${hash}-\\d+-${scheme}-\\d+-whole-w\\d+(-l\\d+)?\\.webp$`);
}

/** Every picture of this card in this scheme and kind, at any revision. */
export function pictureOf(path: string, scheme: ThumbScheme, kind: ThumbKind = "whole"): RegExp {
	if (kind === "small") return smallOf(path, scheme);
	const hash = thumbName(path, 0, scheme).slice(0, 16);
	return new RegExp(`^${hash}-\\d+-${scheme}-\\d+-whole(-l\\d+)?\\.(jpg|webp)$`);
}

/** A copy at a width the ladder no longer has (256, 512, 1024), or the old gallery's 4:3 JPEG: removed by the indexer. */
export const RETIRED = new RegExp(`-whole-w(?!(?:${SMALL_WIDTHS.join("|")})(?:-l\\d+)?\\.)\\d+(-l\\d+)?\\.(webp|astc(\\.br|\\.gz)?)$|^[0-9a-f]{16}-\\d+-(light|dark)(-\\d+)?(-l\\d+)?\\.jpg$`);

/** The window a card is laid out in, and the clip a picture of it takes: its width, and its height up to `WHOLE_MAX_H`. */
export function pageClip(card: Pick<Board, "w" | "h">): { width: number; height: number } {
	const width = Math.max(200, Math.round(card.w));
	return { width, height: Math.max(150, Math.min(Math.round(card.h), WHOLE_MAX_H)) };
}

/**
 * In the page: how tall the board's page is, the way `canvas/extent.ts` measures it (`documentHeight`).
 *
 * The body's own height, with the height and floor `board.js` gave it released for the read, so the
 * reading is the content's. The two measurements have to agree or the picture and the board are
 * different heights; the stated height is applied as a floor by the caller.
 */
export const MEASURE = `(() => {
	const body = document.body;
	if (!body) return 0;
	const held = body.style.height;
	const floor = body.style.minHeight;
	const display = body.style.display;
	body.style.height = "auto";
	body.style.minHeight = "0";
	// A child's margin collapsing through a plain block body is counted, as the canvas counts it.
	if (getComputedStyle(body).display === "block") body.style.display = "flow-root";
	// And the body's own margins (8 px on a page without board.css): the body's margin box, as the canvas takes it.
	const page = Math.max(body.scrollHeight, body.getBoundingClientRect().bottom + scrollY + (parseFloat(getComputedStyle(body).marginBottom) || 0));
	body.style.height = held;
	body.style.minHeight = floor;
	body.style.display = display;
	return Math.ceil(page);
})()`;

/** A WebP's size from its header, or undefined for anything else (a card's JPEG). */
export function webpSize(bytes: Uint8Array): { w: number; h: number } | undefined {
	const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
	if (bytes.length < 30 || tag(0) !== "RIFF" || tag(8) !== "WEBP") return undefined;
	const chunk = tag(12);
	if (chunk === "VP8X") return { w: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)), h: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) };
	if (chunk === "VP8L") {
		const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
		return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) };
	}
	if (chunk === "VP8 ") return { w: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, h: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff };
	return undefined;
}

/** A WebP's width from its header, or undefined for anything else (a card's JPEG). */
export function webpWidth(bytes: Uint8Array): number | undefined {
	const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
	if (bytes.length < 30 || tag(0) !== "RIFF" || tag(8) !== "WEBP") return undefined;
	const chunk = tag(12);
	if (chunk === "VP8X") return 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
	if (chunk === "VP8L") return 1 + (bytes[21]! | ((bytes[22]! & 0x3f) << 8));
	if (chunk === "VP8 ") return (bytes[26]! | (bytes[27]! << 8)) & 0x3fff;
	return undefined;
}

/**
 * Run in the server's Chrome: a picture, as base64, decoded at `width` pixels wide and encoded again
 * as WebP. `null` when it is no wider than that already.
 */
export const SHRINK = `async ([b64, width]) => {
	const text = atob(b64);
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
	const bitmap = await createImageBitmap(new Blob([bytes]), { resizeWidth: width, resizeQuality: "high" });
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	canvas.getContext("2d").drawImage(bitmap, 0, 0);
	bitmap.close();
	const out = new Uint8Array(await (await canvas.convertToBlob({ type: "image/webp", quality: 0.85 })).arrayBuffer());
	let binary = "";
	for (let i = 0; i < out.length; i += 0x8000) binary += String.fromCharCode(...out.subarray(i, i + 0x8000));
	return btoa(binary);
}`;
