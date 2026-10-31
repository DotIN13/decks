import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, gzip, constants as zlib } from "node:zlib";
import type { Board } from "@decks/protocol";
import { compress, encoder, type Level } from "./astc.ts";

/**
 * Pictures of cards, taken on the server: what the canvas draws for a card that is not live (zoomed
 * out, or far from the screen), what a native stage screenshot lays out, and what an export carries.
 * A card is a page of its own, and the server is the one place that can reach every card without
 * anybody having opened it.
 *
 * **Chromium, through the Playwright this app already depends on.** Obscura
 * (github.com/h4ckf0r0day/obscura) was tried first, because it was asked for and because a
 * 30MB Rust browser that needs no Chromium is an attractive thing. Measured on the example
 * deck, on this arm64 host, v0.2.2: the same 120–620ms a board as Chromium, because the time
 * is the board's own scripts and not the browser; and pictures that are wrong in ways a
 * thumbnail cannot hide. `color-mix()` and translucent colours paint black, so the grid and
 * every card border are solid black; KaTeX's exponents land beside the line; words overprint
 * ("deessp", "1,0002 m"); and one board in five never reached `__boardReady` and held the
 * page for thirty seconds (`import.meta` in a worker). Its download is also two binaries of
 * 100MB, which is what Chromium's headless shell costs. It is its own layout and paint
 * engine, and a picture of a board has to be the board.
 *
 * ### Asynchronous, and what that means here
 *
 * - **One browser, started when the first picture is wanted** and closed after a minute with
 *   nothing to do. A card costs a context (its pixel ratio is per context) and a page.
 * - **Two at a time.** A card is a document running its scripts, KaTeX, Mermaid and whatever
 *   it imports; two is what keeps a four-core host answering its sockets.
 * - **Newest request first.** A canvas asks for a screenful at once: what the person is looking
 *   at now is the last thing asked for. A request whose browser has gone away before its turn is
 *   dropped rather than drawn.
 * - **Kept on disk by `path`, `rev` and scheme**, so a picture is taken once per revision for
 *   everybody and survives a restart. `rev` is the content hashed, so an edited card misses
 *   and an untouched one never does; the pictures of a card's older revisions are removed
 *   when a newer one lands.
 * - **Taken again when the card changes** (`changed`), so the picture is usually there before
 *   anybody asks. Settled for a moment first, because an agent writing a card makes a
 *   revision per write, and put at the back of the queue, because nobody is looking at it
 *   yet: a request from a browser always goes ahead of it. Only in the schemes somebody has
 *   asked for, this run or an earlier one, so a deck only ever seen in the dark is not
 *   pictured twice.
 *
 * When there is no Chromium on the machine the first launch fails, `available()` turns false
 * and every request is refused at once.
 */

type Playwright = typeof import("playwright");
type Browser = import("playwright").Browser;
type Page = import("playwright").Page;
type BrowserContext = import("playwright").BrowserContext;

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

/** The shortest window a card is laid out in, as a share of its width: a card that sizes itself by the window has room. */
const WINDOW_ASPECT = 3 / 4;
const CONCURRENCY = 2;
const IDLE_MS = 60_000;
const READY_MS = 8_000;
/** How long a background picture waits for a board to say it is ready (`take`). */
const AHEAD_READY_MS = 3_000;
/** How long a board has to stop changing before its picture is retaken. */
const SETTLE_MS = 1_500;

export interface ThumbHost {
	/** Where this server can be reached from its own machine: `http://127.0.0.1:4329`. */
	origin: () => string;
	/** `<deck>/.decks/thumbs`. */
	dir: string;
	/** How long a changed board is left to settle. For tests; `SETTLE_MS` otherwise. */
	settleMs?: number;
	/** Every board in the deck, for the indexer (`index`) to keep pictures of. */
	boards?: () => Board[];
	/** The cards on any canvas: the only ones the indexer keeps pictures of, since nothing else draws them. */
	placed?: () => ReadonlySet<string>;
	/**
	 * The harness's own pass for what its Chromium reads of it (`auth/passes.ts`): none of the pages it
	 * draws carries anyone's token, so every GET this browser makes of the harness's `/api/` is given
	 * this, made fresh each time. The other addresses the harness is reached at, `extraOrigins` (Vite's, in development).
	 */
	reader?: () => string;
	extraOrigins?: () => string[];
}

/** How far the indexer has got (`ThumbService.progress`), for the app's ⋯ menu. */
export interface PictureProgress {
	/** Cards on a canvas times the schemes pictures are kept in. */
	total: number;
	/** Of those, the ones with their far rungs (`AHEAD_WIDTHS`) of the current revision. */
	ready: number;
	/** The indexer is sweeping, or pictures are being taken or copied. */
	working: boolean;
	/** Pictures this sweep could not take: a board that would not draw. */
	failed: number;
}

/** Boards the indexer works on at once; the browser takes two pictures at a time in all (`CONCURRENCY`). */
const INDEXERS = 2;

interface Job {
	board: Board;
	scheme: ThumbScheme;
	file: string;
	kind: ThumbKind;
	/** A small picture's width (`TAKEN_WIDTHS`). */
	width?: number;
	/** Taken ahead of time, because the board changed, rather than because a browser asked. */
	ahead?: boolean;
	/** Everybody waiting on this one picture. */
	waiting: Array<{ resolve: (file: string) => void; reject: (error: Error) => void; gone: () => boolean }>;
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
function smallOf(path: string, scheme: ThumbScheme): RegExp {
	const hash = thumbName(path, 0, scheme).slice(0, 16);
	return new RegExp(`^${hash}-\\d+-${scheme}-\\d+-whole-w\\d+(-l\\d+)?\\.webp$`);
}

/** Every picture of this card in this scheme and kind, at any revision. */
function pictureOf(path: string, scheme: ThumbScheme, kind: ThumbKind = "whole"): RegExp {
	if (kind === "small") return smallOf(path, scheme);
	const hash = thumbName(path, 0, scheme).slice(0, 16);
	return new RegExp(`^${hash}-\\d+-${scheme}-\\d+-whole(-l\\d+)?\\.(jpg|webp)$`);
}

/** A copy at a width the ladder no longer has (256, 512, 1024), or the old gallery's 4:3 JPEG: removed by the indexer. */
const RETIRED = new RegExp(`-whole-w(?!(?:${SMALL_WIDTHS.join("|")})(?:-l\\d+)?\\.)\\d+(-l\\d+)?\\.(webp|astc(\\.br|\\.gz)?)$|^[0-9a-f]{16}-\\d+-(light|dark)(-\\d+)?(-l\\d+)?\\.jpg$`);

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
const MEASURE = `(() => {
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

/**
 * Run in the server's Chrome: a picture, as base64, decoded at `width` pixels wide and encoded again
 * as WebP. `null` when it is no wider than that already.
 */
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

/** Tabs that make smaller copies at once: each decodes and encodes on its own thread. */
const RESIZERS = 3;
/**
 * The longest a picture, or a copy, may take before its tab is closed and it counts as failed.
 * Taking a picture and making copies share the service's count of work in hand (`running`), which
 * lets two at a time through: two that never ended stopped every picture after them, and the
 * indexer with them, with nothing in the log.
 */
const TAKE_MS = 45_000;
const RESIZE_MS = 20_000;

const SHRINK = `async ([b64, width]) => {
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

/**
 * Every size of a picture for the GPU (`compressed`): its first a multiple of 16 pixels each way, so
 * it and two halvings below it are whole 4 × 4 blocks (the canvas shrinks a picture to them), then
 * each half the one before down to one pixel. RGBA, premultiplied, rows from the top.
 */
const LEVELS = `async (b64) => {
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

export class ThumbService {
	private browser: Promise<Browser> | undefined;
	private idle: ReturnType<typeof setTimeout> | undefined;
	private running = 0;
	/** Waiting jobs, newest last; the next one taken is the last. */
	private queue: Job[] = [];
	private byFile = new Map<string, Job>();
	private broken: string | undefined;
	/** Boards that changed and are being left to settle, by path. */
	private settling = new Map<string, ReturnType<typeof setTimeout>>();
	/** The schemes and kinds anybody has asked for, as `light` or `light/whole`. Read off the disk the first time, so it survives a restart. */
	private schemes: Set<string> | undefined;
	/** Pages that make smaller copies of pictures (`smaller`), on the current browser, taken in turn. */
	private resizer: { browser: Browser; pages: Promise<Page>[]; next: number } | undefined;
	/** Smaller copies being made, by the file they will be. */
	private shrinking = new Map<string, Promise<string | Buffer>>();

	constructor(private host: ThumbHost, private launch: () => Promise<Browser> = launchChromium) {}

	/**
	 * The browser, started when there is none. One that goes away (it crashed, or was killed) is
	 * forgotten, so the next picture starts another: kept, it answered every request after with
	 * "browser has been closed" until the server restarted, and the canvas had no pictures.
	 */
	private started(): Promise<Browser> {
		const reader = this.host.reader;
		const launched = reader ? this.launch().then((browser) => withOwnReads(browser, () => [this.host.origin(), ...(this.host.extraOrigins?.() ?? [])], reader)) : this.launch();
		void launched.then(
			(browser) =>
				(browser as Partial<Pick<Browser, "on">>).on?.("disconnected", () => {
					if (this.browser === launched) this.browser = undefined;
					if (this.resizer?.browser === browser) this.resizer = undefined;
					if (this.tabs?.browser === browser) this.tabs = undefined;
				}),
			() => {},
		);
		return launched;
	}

	/**
	 * A whole picture at `width` pixels wide, made from the whole one by the server's Chrome, and
	 * kept beside it when `keep` (a stand-in is not). The whole one when it is that narrow already.
	 * The copy is WebP at quality 85; made once, it is a file like any other picture.
	 */
	async smaller(file: string, width: number, keep = true, target = smallName(file, width)): Promise<string | Buffer> {
		if (keep && existsSync(target)) return target;
		const known = this.shrinking.get(target);
		if (known) return known;
		const bytes = readFileSync(file);
		// No wider than that already, or not a WebP: the picture itself, kept under the copy's name so it is not missing.
		if ((webpWidth(bytes) ?? 0) <= width) {
			if (!keep) return file;
			copyFileSync(file, target);
			return target;
		}
		const making = this.borrow(async (browser) => {
			if (this.resizer?.browser !== browser) this.resizer = { browser, pages: [], next: 0 };
			const turn = this.resizer.next++ % RESIZERS;
			// A context each, so each tab is its own renderer and decodes on its own thread.
			const opening = (this.resizer.pages[turn] ??= browser.newContext().then((context) => context.newPage()));
			const page = await opening;
			const watchdog = setTimeout(() => {
				console.log(`[decks] card pictures: a ${width} px copy of ${file} took longer than ${RESIZE_MS / 1000} s and was given up`);
				if (this.resizer?.pages[turn] === opening) delete this.resizer.pages[turn];
				void page.context().close().catch(() => {});
			}, RESIZE_MS);
			const out = await page
				.evaluate<string | null>(`(${SHRINK})(${JSON.stringify([bytes.toString("base64"), width])})`)
				.finally(() => clearTimeout(watchdog));
			if (out === null) return file;
			const small = Buffer.from(out, "base64");
			if (!keep) return small;
			mkdirSync(this.host.dir, { recursive: true });
			writeFileSync(target, small);
			return target;
		}).finally(() => this.shrinking.delete(target));
		this.shrinking.set(target, making);
		return making;
	}

	/** Compressed pictures being made, by the file they will be. */
	private compressing = new Map<string, Promise<string | undefined>>();

	/** Whether a canvas has asked for compressed pictures (`wantCompressed`), or this server kept some before. */
	private packedWanted: boolean | undefined;
	/** A canvas asked for a picture compressed (`astc=1`): from now on every copy is compressed as it is made, in the background. */
	wantCompressed(): void {
		this.packedWanted = true;
	}
	private compressedWanted(): boolean {
		if (!encoder()) return false;
		return (this.packedWanted ??= this.listDir().some((name) => name.endsWith(".astc")));
	}

	/**
	 * A card's far rungs (`AHEAD_WIDTHS`), and, once a canvas takes them, their compressed sizes, made
	 * now if missing: the first request for a compressed picture finds it on disk instead of waiting
	 * for the encoder (about 80 ms a 480 px card, 40 to 100 a 192, with the server's Chrome up).
	 */
	private async ahead(board: Board, scheme: ThumbScheme): Promise<void> {
		const files: string[] = [];
		for (const width of [...AHEAD_WIDTHS].reverse()) files.push(await this.picture(board, scheme, width, () => false, true));
		if (!this.compressedWanted()) return;
		for (const file of files) if (!(await this.compressed(file))) throw new Error(`${file} could not be compressed`);
	}

	/**
	 * What a picture just taken gives the ladder, in the background: a rung taken from the page gives
	 * itself and the rungs cut from it (192 from 480); a whole picture gives every rung. Each is
	 * compressed when a canvas takes them.
	 */
	private async copiesOf(job: Job, whole: string): Promise<void> {
		const taken = job.kind === "small" ? job.width! : Number.POSITIVE_INFINITY;
		const from = (width: number) => TAKEN_WIDTHS.find((one) => one >= width);
		for (const width of SMALL_WIDTHS) {
			if (job.kind === "small" && width !== taken && (TAKEN_WIDTHS.includes(width) || from(width) !== taken)) continue;
			const copy = width === taken ? job.file : await this.smaller(job.file, width, true, smallName(whole, width));
			if (typeof copy === "string" && this.compressedWanted()) await this.compressed(copy);
		}
	}

	/**
	 * A picture's every size compressed for the GPU (`astc.ts`), made once from its WebP by the
	 * server's Chrome (the sizes) and `astcenc` (the blocks), and kept beside it. Undefined when this
	 * machine has no encoder or the making failed: the canvas is sent the WebP.
	 */
	async compressed(file: string): Promise<string | undefined> {
		const target = compressedName(file);
		if (existsSync(target)) return target;
		if (!encoder()) return undefined;
		const known = this.compressing.get(target);
		if (known) return known;
		const bytes = readFileSync(file);
		const making = this.borrow(async (browser) => {
			if (this.resizer?.browser !== browser) this.resizer = { browser, pages: [], next: 0 };
			const turn = this.resizer.next++ % RESIZERS;
			const opening = (this.resizer.pages[turn] ??= browser.newContext().then((context) => context.newPage()));
			const page = await opening;
			const out = await page.evaluate<{ sizes: [number, number][]; b64: string }>(`(${LEVELS})(${JSON.stringify(bytes.toString("base64"))})`);
			const all = Buffer.from(out.b64, "base64");
			let at = 0;
			const levels: Level[] = out.sizes.map(([width, height]) => {
				const rgba = all.subarray(at, at + width * height * 4);
				at += width * height * 4;
				return { width, height, rgba };
			});
			const packed = await compress(levels);
			mkdirSync(this.host.dir, { recursive: true });
			writeFileSync(target, packed);
			await squeezed(target, "br");
			return target;
		})
			.catch((error: unknown) => {
				console.log(`[decks] card pictures: compressing ${file} failed: ${String(error).slice(0, 200)}`);
				return undefined;
			})
			.finally(() => this.compressing.delete(target));
		this.compressing.set(target, making);
		return making;
	}

	/**
	 * Keep the far rungs of every card on a canvas, in every scheme the canvas has asked for, taking
	 * whatever is missing in the background: once `after` ms from the server's start, and again when a
	 * new scheme is first asked for. Cards that change later are retaken by `changed`. Pictures
	 * somebody is waiting on go first: the indexer's are asked for as `ahead`, a few at a time, and a
	 * browser's request jumps the queue (`ask`). Each sweep first removes copies at widths the ladder
	 * no longer has (`RETIRED`).
	 *
	 * Without it a canvas nobody had zoomed out on had no pictures, and each was taken while the first
	 * person to look waited, two at a time: half a minute for 400 cards.
	 */
	indexLater(after = 10_000): void {
		const timer = setTimeout(() => void this.index(), after);
		timer.unref?.();
	}

	private sweeping = false;
	private sweepAgain = false;
	private failures = new Set<string>();

	async index(): Promise<void> {
		if (!this.host.boards) return;
		if (this.sweeping) {
			this.sweepAgain = true;
			return;
		}
		this.sweeping = true;
		this.failures.clear();
		this.dropRetired();
		try {
			do {
				this.sweepAgain = false;
				const todo = this.missing(new Set(this.listDir()));
				const work = async () => {
					for (let next = todo.shift(); next && !this.broken; next = todo.shift()) {
						const { board, scheme } = next;
						try {
							// The sizes a canvas draws when zoomed out; the whole picture is taken when a board is asked for at it.
							await this.ahead(board, scheme);
						} catch {
							this.failures.add(`${board.path}:${scheme}`);
						}
					}
				};
				await Promise.all(Array.from({ length: INDEXERS }, work));
			} while (this.sweepAgain && !this.broken);
		} finally {
			this.sweeping = false;
		}
	}

	/** Copies at widths the ladder no longer has, and the old gallery's pictures: nothing asks for them. */
	private dropRetired(): void {
		for (const name of this.listDir()) if (RETIRED.test(name)) rmSync(join(this.host.dir, name), { force: true });
	}

	/** The cards the indexer keeps pictures of: those on a canvas (`placed`), or every one when the host does not say. */
	private indexed(): Board[] {
		const all = this.host.boards?.() ?? [];
		const placed = this.host.placed?.();
		return placed ? all.filter((board) => placed.has(board.path)) : all;
	}

	/** How many cards have every picture they should, and whether more are being made. */
	progress(): PictureProgress {
		const have = new Set(this.listDir());
		const total = this.indexed().length * this.indexSchemes().length;
		const missing = this.missing(have).length;
		return {
			total,
			ready: total - missing,
			working: this.sweeping || this.running > 0 || this.queue.length > 0 || this.shrinking.size > 0,
			failed: this.failures.size,
		};
	}

	/** Pictures are kept in the schemes the canvas has asked for whole pictures in, and in light before any. */
	private indexSchemes(): ThumbScheme[] {
		const schemes = [...this.wanted()].filter((one) => one.endsWith("/whole")).map((one) => one.split("/")[0] as ThumbScheme);
		if (schemes.length === 0) return ["light"];
		// The scheme asked for last first: it is the one somebody is looking at.
		return schemes.sort((a, b) => Number(b === this.lastScheme) - Number(a === this.lastScheme));
	}
	/** The scheme of the last whole picture a browser asked for. */
	private lastScheme: ThumbScheme | undefined;

	/** The cards and schemes without one of their far rungs (`AHEAD_WIDTHS`) of the current revision. */
	private missing(have: Set<string>): Array<{ board: Board; scheme: ThumbScheme }> {
		const out: Array<{ board: Board; scheme: ThumbScheme }> = [];
		const boards = this.indexed();
		for (const scheme of this.indexSchemes()) {
			for (const board of boards) {
				const whole = thumbName(board.path, board.rev, scheme, "whole");
				const packed = this.compressedWanted();
				if (AHEAD_WIDTHS.every((width) => have.has(smallName(whole, width)) && (!packed || have.has(compressedName(smallName(whole, width)))))) continue;
				// A picture this sweep could not take is not missing again until the board changes.
				if (this.failures.has(`${board.path}:${scheme}`) && !this.sweeping) continue;
				out.push({ board, scheme });
			}
		}
		return out;
	}

	private listDir(): string[] {
		try {
			return readdirSync(this.host.dir);
		} catch {
			return [];
		}
	}

	/** False once a launch has failed: there is no browser here and asking again will not find one. */
	available(): boolean {
		return this.broken === undefined;
	}

	/**
	 * The picture's file, taken now if nobody has taken it.
	 *
	 * `gone` is asked when the job's turn comes: a request whose browser has left is not worth
	 * a page. Rejects when there is no Chromium, or the board would not draw.
	 */
	/** A card's whole picture, taken now if nobody has taken it. */
	get(board: Board, scheme: ThumbScheme, gone: () => boolean = () => false): Promise<string> {
		this.asked(scheme);
		return this.ask(board, scheme, gone, false, "whole");
	}

	/** A browser asked for a picture in this scheme: the indexer keeps that scheme from now on, starting now if it is new. */
	asked(scheme: ThumbScheme): void {
		this.lastScheme = scheme;
		const want = `${scheme}/whole`;
		if (this.wanted().has(want)) return;
		this.wanted().add(want);
		// The first picture in a scheme: every card will want one in it.
		this.indexLater(2_000);
	}

	/**
	 * A card's picture at a size, made if it is missing: `"whole"`, or a rung's width (`SMALL_WIDTHS`).
	 * A rung is cut from the whole picture when there is one; a taken rung (`TAKEN_WIDTHS`) is
	 * otherwise taken straight from the page, and any other is cut from the next taken one up.
	 * `ahead` is the background's: a browser's request is taken before it.
	 */
	async picture(board: Board, scheme: ThumbScheme, size: "whole" | number, gone: () => boolean = () => false, ahead = false): Promise<string> {
		const whole = join(this.host.dir, thumbName(board.path, board.rev, scheme, "whole"));
		if (size === "whole") return this.ask(board, scheme, gone, ahead, "whole");
		const target = smallName(whole, size);
		if (existsSync(target)) return target;
		let source: string;
		if (existsSync(whole)) source = whole;
		else if (TAKEN_WIDTHS.includes(size)) return this.ask(board, scheme, gone, ahead, "small", size);
		else source = await this.picture(board, scheme, TAKEN_WIDTHS.find((one) => one >= size) ?? SMALL_TAKEN, gone, ahead);
		const made = await this.smaller(source, size, true, target);
		return typeof made === "string" ? made : target;
	}

	/**
	 * What to show for a board at a size right now: the picture itself when it is on disk (`exact`),
	 * otherwise the nearest one there is of this revision (the smallest at least that size, or else
	 * the largest), otherwise the same from the newest earlier revision, and undefined when the board
	 * has no picture at all in this scheme. The caller asks for the real one behind it (`picture`).
	 *
	 * Without it a board with no current picture was blank on the canvas until the server's Chrome,
	 * two pages at a time, reached it: zooming out over dozens of boards after a look change was a
	 * screen of empty rectangles filling in over a minute.
	 */
	nearest(board: Board, scheme: ThumbScheme, size: "whole" | number): { file: string; exact: boolean } | undefined {
		const want = size === "whole" ? Number.POSITIVE_INFINITY : size;
		const whole = thumbName(board.path, board.rev, scheme, "whole");
		const exact = size === "whole" ? whole : smallName(whole, size);
		const wholes = pictureOf(board.path, scheme, "whole");
		const copies = smallOf(board.path, scheme);
		const found: Array<{ name: string; rev: string; width: number }> = [];
		for (const name of this.listDir()) {
			if (name === exact) return { file: join(this.host.dir, name), exact: true };
			const copy = copies.test(name);
			if (!copy && !wholes.test(name)) continue;
			const width = copy ? Number(/-whole-w(\d+)/.exec(name)?.[1] ?? 0) : Number.POSITIVE_INFINITY;
			found.push({ name, rev: name.split("-")[1] ?? "", width });
		}
		if (found.length === 0) return undefined;
		const current = whole.slice(0, whole.indexOf("-whole")).replace(/-\d+$/, "");
		// This revision in this look, or else the revision whose picture was written last.
		let pool = found.filter((one) => one.name.startsWith(current) && one.name.includes(`-l${PICTURE_LOOK}.`));
		if (pool.length === 0) {
			const at = (one: { name: string }) => {
				try {
					return statSync(join(this.host.dir, one.name)).mtimeMs;
				} catch {
					return 0;
				}
			};
			const newest = found.reduce((a, b) => (at(b) > at(a) ? b : a));
			pool = found.filter((one) => one.rev === newest.rev);
		}
		const atLeast = pool.filter((one) => one.width >= want).sort((a, b) => a.width - b.width)[0];
		const pick = atLeast ?? pool.sort((a, b) => b.width - a.width)[0]!;
		return { file: join(this.host.dir, pick.name), exact: false };
	}

	/**
	 * A board changed: retake its picture once it has stopped changing.
	 *
	 * Called for every `board.changed`, which includes changes that are not to the file (who
	 * wrote it, when it was last seen). Those cost one `existsSync`, because the revision is the
	 * same and so is the picture's name.
	 */
	changed(board: Board): void {
		if (this.broken) return;
		clearTimeout(this.settling.get(board.path));
		const timer = setTimeout(() => {
			this.settling.delete(board.path);
			// Retaken as its far rungs; the whole one, and 800, when somebody asks for them.
			for (const want of this.wanted()) void this.ahead(board, want.split("/")[0] as ThumbScheme).catch(() => {});
		}, this.host.settleMs ?? SETTLE_MS);
		timer.unref?.();
		this.settling.set(board.path, timer);
	}

	/** A card is gone: so are its pictures, and any wait to retake one. */
	forget(path: string): void {
		clearTimeout(this.settling.get(path));
		this.settling.delete(path);
		const prefix = thumbName(path, 0, "light").slice(0, 17);
		try {
			for (const name of readdirSync(this.host.dir)) if (name.startsWith(prefix)) rmSync(join(this.host.dir, name), { force: true });
		} catch {
			/* no directory is no pictures */
		}
	}

	private wanted(): Set<string> {
		if (this.schemes) return this.schemes;
		this.schemes = new Set();
		try {
			for (const name of readdirSync(this.host.dir)) {
				const found = /-(light|dark)-\d+-whole/.exec(name);
				if (found) this.schemes.add(`${found[1]}/whole`);
			}
		} catch {
			/* nothing taken yet: nothing is wanted until somebody asks */
		}
		return this.schemes;
	}

	private ask(board: Board, scheme: ThumbScheme, gone: () => boolean, ahead: boolean, kind: ThumbKind, width = SMALL_TAKEN): Promise<string> {
		const file = join(this.host.dir, thumbName(board.path, board.rev, scheme, kind, width));
		if (existsSync(file)) return Promise.resolve(file);
		if (this.broken) return Promise.reject(new Error(this.broken));
		return new Promise((resolve, reject) => {
			const known = this.byFile.get(file);
			if (known) {
				known.waiting.push({ resolve, reject, gone });
				// Asked for again by a browser: it is what somebody is looking at now.
				const at = this.queue.indexOf(known);
				if (at >= 0 && !ahead) {
					known.ahead = false;
					this.queue.push(...this.queue.splice(at, 1));
				}
				return;
			}
			const job: Job = { board, scheme, kind, file, waiting: [{ resolve, reject, gone }], ...(kind === "small" ? { width } : {}) };
			this.byFile.set(file, job);
			/*
			 * A picture taken ahead of time goes to the back, which is the front of the array:
			 * the next job is popped off the end. And it replaces one still waiting for an
			 * older revision of the same board, which nobody will ever ask for.
			 */
			if (ahead) {
				const any = pictureOf(board.path, scheme, kind);
				this.queue = this.queue.filter((one) => {
					const name = one.file.slice(this.host.dir.length + 1);
					const stale = any.test(name) && one.board.rev !== board.rev && one.ahead === true;
					if (stale) {
						this.byFile.delete(one.file);
						for (const w of one.waiting) w.reject(new Error("a newer revision replaced it"));
					}
					return !stale;
				});
				job.ahead = true;
				this.queue.unshift(job);
			} else this.queue.push(job);
			this.pump();
		});
	}

	private pump(): void {
		while (this.running < CONCURRENCY && this.queue.length > 0) {
			const job = this.queue.pop()!;
			if (job.waiting.every((one) => one.gone())) {
				this.byFile.delete(job.file);
				for (const one of job.waiting) one.reject(new Error("nobody is waiting for it"));
				continue;
			}
			this.running++;
			void this.take(job)
				.then(
					() => job.waiting.forEach((one) => one.resolve(job.file)),
					(error: Error) => job.waiting.forEach((one) => one.reject(error)),
				)
				.finally(() => {
					this.byFile.delete(job.file);
					this.running--;
					this.pump();
					if (this.running === 0 && this.queue.length === 0) this.rest();
				});
		}
	}

	private async take(job: Job): Promise<void> {
		clearTimeout(this.idle);
		let browser: Browser;
		try {
			this.browser ??= this.started();
			browser = await this.browser;
		} catch (error) {
			this.browser = undefined;
			this.broken = `No Chromium to take board pictures with: ${(error as Error).message.split("\n")[0]}`;
			// Everything still queued is waiting on the same missing browser.
			for (const waiting of this.queue.splice(0)) {
				this.byFile.delete(waiting.file);
				for (const one of waiting.waiting) one.reject(new Error(this.broken));
			}
			throw new Error(this.broken);
		}
		// Laid out at the card's own height, as the canvas lays it out, in a window no shorter than three quarters of its width.
		const clip = pageClip(job.board);
		const tall = Math.max(clip.height, Math.round(clip.width * WINDOW_ASPECT));
		/*
		 * The background's small pictures reuse a tab (`lease`): a fresh one per picture was an eighth
		 * of the time each took. Everything else gets its own, at the scale it is drawn at.
		 */
		const lease = job.ahead && job.kind === "small" ? await this.lease(browser, job.scheme) : undefined;
		const context =
			lease?.context ??
			(await browser.newContext({
				viewport: { width: clip.width, height: tall },
				deviceScaleFactor: job.kind === "whole" ? wholeScale({ w: job.board.w, h: tall }) : 1,
				colorScheme: job.scheme,
				reducedMotion: "reduce",
			}));
		let given = false;
		// A page that never finishes (a script that never stops, a screenshot that never comes) is closed, which ends every call on it.
		const watchdog = setTimeout(() => {
			given = true;
			console.log(`[decks] card pictures: ${job.board.path} took longer than ${TAKE_MS / 1000} s and was given up`);
			void context.close().catch(() => {});
		}, TAKE_MS);
		try {
			const page = lease?.page ?? (await context.newPage());
			if (lease) await page.setViewportSize({ width: clip.width, height: tall });
			const url = `${this.host.origin()}/api/board/${job.board.path.split("/").map(encodeURIComponent).join("/")}`;
			await page.goto(url, { waitUntil: "load", timeout: 20_000 });
			/*
			 * `board.js` sets this after fonts, markdown, maths and diagrams. A board that never says
			 * so is drawn as it stands: a late picture beats none. The background waits less for one:
			 * two such boards were an eighth of a sweep's time.
			 */
			await page.waitForFunction("window.__boardReady === true", undefined, { timeout: job.ahead ? AHEAD_READY_MS : READY_MS }).catch(() => {});
			let shotClip = clip;
			const measured = await page.evaluate<number>(MEASURE).catch(() => 0);
			// Never below what the card says it is: a picture cropped under its box would be a different card from the one on the canvas.
			const h = Math.max(measured, job.board.h);
			if (measured > 0 && h !== job.board.h) shotClip = pageClip({ w: job.board.w, h });
			const shot = await wholeShot(page, shotClip, job.kind === "whole" ? wholeScale({ w: job.board.w, h: tall }) : Math.min(2, job.width! / shotClip.width));
			mkdirSync(this.host.dir, { recursive: true });
			writeFileSync(job.file, shot);
			this.forgetOlder(job);
			// The rungs cut from it now, while the browser is up, so a canvas zoomed out never waits for one.
			const whole = join(this.host.dir, thumbName(job.board.path, job.board.rev, job.scheme, "whole"));
			void this.copiesOf(job, whole).catch(() => {});
		} finally {
			clearTimeout(watchdog);
			if (lease && !given) this.release(lease);
			else await context.close().catch(() => {});
		}
	}

	/** Tabs kept for the background's small pictures, by scheme, on the browser they belong to. */
	private tabs: { browser: Browser; free: Map<ThumbScheme, Array<{ context: BrowserContext; page: Page; scheme: ThumbScheme }>> } | undefined;

	private async lease(browser: Browser, scheme: ThumbScheme): Promise<{ context: BrowserContext; page: Page; scheme: ThumbScheme }> {
		if (this.tabs?.browser !== browser) this.tabs = { browser, free: new Map() };
		const kept = this.tabs.free.get(scheme)?.pop();
		if (kept) return kept;
		const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: "reduce" });
		return { context, page: await context.newPage(), scheme };
	}

	private release(tab: { context: BrowserContext; page: Page; scheme: ThumbScheme }): void {
		const free = this.tabs?.free;
		if (!free) {
			void tab.context.close().catch(() => {});
			return;
		}
		const list = free.get(tab.scheme) ?? [];
		list.push(tab);
		free.set(tab.scheme, list);
	}

	/** A card's earlier revisions, in this scheme: nobody will ask for them again. */
	private forgetOlder(job: Job): void {
		const mine = thumbName(job.board.path, job.board.rev, job.scheme, job.kind, job.width);
		const thisRev = `${mine.split("-")[0]}-${job.board.rev}-`;
		const wholes = pictureOf(job.board.path, job.scheme, "whole");
		// A picture replaces the rungs of earlier revisions; its own revision's stay.
		const small = smallOf(job.board.path, job.scheme);
		// And their compressed sizes (`compressedName`), which no stand-in ever is.
		const packed = new RegExp(small.source.replace("\\.webp$", "\\.astc(\\.br|\\.gz)?$"));
		try {
			for (const name of readdirSync(this.host.dir)) {
				if (job.kind === "whole" && name !== mine && wholes.test(name)) rmSync(join(this.host.dir, name), { force: true });
				else if ((small.test(name) || packed.test(name)) && !name.startsWith(thisRev)) rmSync(join(this.host.dir, name), { force: true });
			}
		} catch {
			/* a directory that cannot be listed keeps its old pictures, which costs bytes and nothing else */
		}
	}

	/**
	 * Press every control on a board and say which views break it.
	 *
	 * A board that keeps its depth behind tabs and rows has views its writer never looked at:
	 * `decks.canvas.fit` measures the board as it rests, and a screenshot is of the resting view too. The
	 * first board checked this way had a tab whose text was squeezed into a 24px column and ran
	 * to 3,460px, and nothing had said so. This loads the board in the same headless browser
	 * the pictures use, presses each control in turn, and measures after each press: the height,
	 * anything wider than the board, and any script error. Nothing is returned for a view that
	 * is fine, and nothing at all when there is no Chromium, because this is advice.
	 */
	async views(board: Board): Promise<BoardViews | undefined> {
		if (this.broken) return undefined;
		clearTimeout(this.idle);
		let browser: Browser;
		try {
			this.browser ??= this.started();
			browser = await this.browser;
		} catch {
			this.browser = undefined;
			return undefined;
		}
		this.running += 1;
		const context = await browser.newContext({ viewport: { width: Math.max(320, Math.round(board.w)), height: 800 }, reducedMotion: "reduce" });
		try {
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message.split("\n")[0] ?? ""));
			await page.goto(`${this.host.origin()}/api/board/${board.path.split("/").map(encodeURIComponent).join("/")}`, { waitUntil: "load", timeout: READY_MS });
			await page.waitForFunction("window.__boardReady === true", undefined, { timeout: READY_MS }).catch(() => {});
			const pressed = (await page.evaluate(PRESS_EVERY_CONTROL)) as { controls: number; opening: number; views: BoardViews["views"] };
			return { controls: pressed.controls, opening: pressed.opening, views: pressed.views, errors: errors.slice(0, 3) };
		} catch {
			return undefined;
		} finally {
			await context.close().catch(() => {});
			this.running -= 1;
			this.pump();
			if (this.running === 0 && this.queue.length === 0) this.rest();
		}
	}

	/**
	 * The same browser, lent for something other than a board picture: a stage screenshot
	 * (`stage/shots.ts`). Counted as running, so it is not closed under the borrower, and rested
	 * afterwards like any other use. Throws the sentence the pictures use when there is no Chromium.
	 */
	async borrow<T>(use: (browser: Browser) => Promise<T>): Promise<T> {
		if (this.broken) throw new Error(this.broken);
		clearTimeout(this.idle);
		let browser: Browser;
		try {
			this.browser ??= this.started();
			browser = await this.browser;
		} catch (error) {
			this.browser = undefined;
			this.broken = `No Chromium to take pictures with: ${(error as Error).message.split("\n")[0]}`;
			throw new Error(this.broken);
		}
		this.running += 1;
		try {
			return await use(browser);
		} finally {
			this.running -= 1;
			// What waited for this slot goes now: a picture's copies or its compressed sizes held both
			// slots as the last job ended, and nothing started the queue again, so every board after
			// it waited for ever.
			this.pump();
			if (this.running === 0 && this.queue.length === 0) this.rest();
		}
	}

	private rest(): void {
		clearTimeout(this.idle);
		this.idle = setTimeout(() => void this.close(), IDLE_MS);
		this.idle.unref?.();
	}

	private async close(): Promise<void> {
		const browser = this.browser;
		this.browser = undefined;
		this.resizer = undefined;
		this.tabs = undefined;
		await browser?.then((one) => one.close()).catch(() => {});
	}

	dispose(): void {
		clearTimeout(this.idle);
		for (const timer of this.settling.values()) clearTimeout(timer);
		this.settling.clear();
		for (const job of this.queue.splice(0)) for (const one of job.waiting) one.reject(new Error("the server is closing"));
		this.byFile.clear();
		void this.close();
	}
}

/** What pressing a board's controls found: how many there are, and the views that go wrong. */
export interface BoardViews {
	controls: number;
	/** How tall the board is in the view it opens on, which is the view its height was measured in. */
	opening: number;
	/** One entry per press that left the board too tall or too wide; `label` is the control's own words. */
	views: Array<{ label: string; h: number; overflowX: number }>;
	errors: string[];
}

/**
 * Runs in the page. Every visible control, twelve at most, pressed in document order; after
 * each press the far bottom of the body's children and the horizontal spill are read. A control
 * that carries code is left alone: it does something rather than show something.
 *
 * A view is reported when it spills sideways, when it runs past one screen (0.8 of the board's
 * width), **or when it is taller than the board it is on**. That last one is the case this
 * check was missing: a board's height is measured in the view it opens on, so a tab 125px
 * taller than its board has its last lines cut and no number anywhere was over a limit —
 * 667px on a 542px board passed a test written against the width.
 */
const PRESS_EVERY_CONTROL = `(async () => {
	// Not a control that carries code (\`data-eval\`): it acts rather than opens a view, and pressing it
	// would run its code as the board, which asks the person to allow it each time a board is fitted.
	const controls = [...document.querySelectorAll("button, summary, [role=tab], [data-tab], select")].filter((el) => el.getBoundingClientRect().width > 0 && !el.closest("[data-eval]"));
	const bottom = () => { let b = 0; for (const el of document.querySelectorAll("body > *")) { const r = el.getBoundingClientRect(); if (r.width && r.height) b = Math.max(b, r.bottom + scrollY); } return Math.round(b); };
	const opening = bottom();
	const limit = Math.min(document.documentElement.clientWidth * 0.8, opening + 2);
	const views = [];
	for (const el of controls.slice(0, 12)) {
		try { el.click(); } catch {}
		await new Promise((r) => setTimeout(r, 80));
		const h = bottom(), overflowX = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
		if (h > limit || overflowX > 2) views.push({ label: (el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40), h, overflowX });
	}
	return { controls: controls.length, opening, views };
})()`;

/**
 * WebGPU, which headless Chromium has only when asked: the stage's engine draws with it in a stage
 * picture (`stage/shots.ts`). On a Mac through Metal; elsewhere SwiftShader stands in for a card.
 */
const WEBGPU = ["--enable-unsafe-webgpu", ...(process.platform === "darwin" ? ["--use-angle=metal"] : ["--enable-unsafe-swiftshader"])];

/**
 * A browser whose every new context gives the harness's own GETs of its `/api/` (`origins`) the
 * harness's own pass (`auth/passes.ts`), unless the request already says who it is. Only GETs and
 * HEADs, and only to the harness: a page's script may not call verbs on it, and nothing goes elsewhere.
 */
export function withOwnReads(browser: Browser, origins: () => string[], pass: () => string): Browser {
	const plain = browser.newContext.bind(browser);
	browser.newContext = async (...args: Parameters<Browser["newContext"]>) => {
		const context = await plain(...args);
		await context.route(
			(url) => url.pathname.startsWith("/api/") && origins().includes(url.origin),
			(route) => {
				const request = route.request();
				const headers = request.headers();
				if ((request.method() !== "GET" && request.method() !== "HEAD") || headers.authorization) return route.continue();
				return route.continue({ headers: { ...headers, authorization: `Bearer ${pass()}` } });
			},
		);
		return context;
	};
	return browser;
}

async function launchChromium(): Promise<Browser> {
	const playwright: Playwright = await import("playwright");
	return playwright.chromium.launch({ args: WEBGPU });
}
