import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { brotliCompress, gzip, constants as zlib } from "node:zlib";

/**
 * Compression of a card's pictures: every size for the GPU (`LEVELS`, run in the server's Chrome and
 * encoded by `astc.ts`), and the compressed file squeezed for the wire (brotli or gzip).
 */

/**
 * Every size of a picture for the GPU (`compressed`): its first a multiple of 16 pixels each way, so
 * it and two halvings below it are whole 4 × 4 blocks (the canvas shrinks a picture to them), then
 * each half the one before down to one pixel. RGBA, premultiplied, rows from the top.
 */
export const LEVELS = `async (b64) => {
	const text = atob(b64);
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
	const source = await createImageBitmap(new Blob([bytes]));
	const round = (n) => Math.max(16, Math.round(n / 16) * 16);
	let width = round(source.width), height = round(source.height);
	let bitmap = await createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
	source.close();
	const sizes = [];
	const parts = [];
	for (;;) {
		const canvas = new OffscreenCanvas(width, height);
		const g = canvas.getContext("2d");
		g.drawImage(bitmap, 0, 0);
		const px = g.getImageData(0, 0, width, height).data;
		for (let i = 0; i < px.length; i += 4) {
			const a = px[i + 3] / 255;
			px[i] = Math.round(px[i] * a); px[i + 1] = Math.round(px[i + 1] * a); px[i + 2] = Math.round(px[i + 2] * a);
		}
		sizes.push([width, height]);
		parts.push(px);
		if (width === 1 && height === 1) break;
		width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
		const next = await createImageBitmap(bitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
		bitmap.close();
		bitmap = next;
	}
	bitmap.close();
	const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) { all.set(p, at); at += p.length; }
	let binary = "";
	for (let i = 0; i < all.length; i += 0x8000) binary += String.fromCharCode(...all.subarray(i, i + 0x8000));
	return { sizes, b64: btoa(binary) };
}`;

/** A picture's compressed sizes, beside it on disk (`astc.ts`). */
export function compressedName(picture: string): string {
	return picture.replace(/\.(webp|jpg)$/, ".astc");
}

/**
 * The compressed sizes squeezed for the wire, beside them: ASTC is a byte a pixel and blocks of plain
 * paper repeat, so brotli takes a board's file to a third or a half (480 px ones of 154 to 174 KB
 * went to 52 to 84 KB) and gzip nearly as far, and the browser undoes it as it reads. Still three to
 * five times its WebP (14 to 19 KB): ASTC saves the GPU's memory and the page's decoding, not network
 * bytes. Brotli (`.astc.br`) is made with the compressed file; gzip (`.astc.gz`), for a browser that
 * takes no brotli (Safari over plain http), the first time one asks.
 */
export type WireEncoding = "br" | "gzip";
export function wireName(packed: string, encoding: WireEncoding): string {
	return `${packed}.${encoding === "br" ? "br" : "gz"}`;
}
const squeeze = { br: promisify(brotliCompress), gzip: promisify(gzip) };
/** A compressed picture squeezed for the wire (`wireName`), made once and kept; undefined if it could not be. */
export async function squeezed(packed: string, encoding: WireEncoding): Promise<string | undefined> {
	const target = wireName(packed, encoding);
	if (existsSync(target)) return target;
	try {
		const bytes = readFileSync(packed);
		const out = encoding === "br" ? await squeeze.br(bytes, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: bytes.length } }) : await squeeze.gzip(bytes, { level: 9 });
		writeFileSync(target, out);
		return target;
	} catch {
		return undefined;
	}
}
/** The squeeze a request's `Accept-Encoding` takes, brotli first. */
export function wireEncoding(accept: string | undefined): WireEncoding | undefined {
	const takes = (name: string) => new RegExp(`(^|,)\\s*${name}\\s*(;\\s*q=(?!0(\\.0*)?\\s*(,|$))[\\d.]+)?\\s*(,|$)`, "i").test(accept ?? "");
	return takes("br") ? "br" : takes("gzip") ? "gzip" : undefined;
}
