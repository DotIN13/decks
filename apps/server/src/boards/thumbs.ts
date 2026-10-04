import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Board } from "@decks/protocol";

/**
 * A picture of a board, taken on the server, for the panel's thumbnails.
 *
 * The thumbnails used to show a picture only of a board this browser had already had open on
 * the canvas (`thumb-cache.ts` photographs a live frame), so on a deck of six hundred boards
 * it was six hundred grey tiles with a title on each. A picture nobody has to have opened the
 * board for has to be taken somewhere else, and the server is the one place that can reach
 * every board.
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
 *   nothing to do. A board costs a context (its pixel ratio is per context) and a page.
 * - **Two at a time.** A board is a document running `board.js`, KaTeX, Mermaid and whatever
 *   it imports; two is what keeps a four-core host answering its sockets.
 * - **Newest request first.** A gallery asks for a screenful at once and then the person
 *   scrolls: what they are looking at now is the last thing asked for. A request whose
 *   browser has gone away before its turn is dropped rather than drawn.
 * - **Kept on disk by `path`, `rev` and scheme**, so a picture is taken once per revision for
 *   everybody and survives a restart. `rev` is the content hashed, so an edited board misses
 *   and an untouched one never does; the pictures of a board's older revisions are removed
 *   when a newer one lands.
 *
 * - **Taken again when the board changes** (`changed`), so the picture is usually there before
 *   anybody asks. Settled for a moment first, because an agent writing a board makes a
 *   revision per write, and put at the back of the queue, because nobody is looking at it
 *   yet: a request from a browser always goes ahead of it. Only in the schemes somebody has
 *   asked for, this run or an earlier one, so a deck only ever seen in the dark is not
 *   pictured twice.
 *
 * When there is no Chromium on the machine the first launch fails, `available()` turns false
 * and every request is refused at once: the gallery falls back to what it did before.
 */

type Playwright = typeof import("playwright");
type Browser = import("playwright").Browser;
type Page = import("playwright").Page;

export type ThumbScheme = "light" | "dark";
/**
 * Which picture: `card` is the gallery's, cropped 4:3 from the top; `whole` is the whole board at
 * the same width, which is what the canvas draws in place of a board that has no document
 * (`canvas/pen/scene.ts`).
 */
export type ThumbKind = "card" | "whole";
/** The tallest a whole picture is taken, in CSS px of the board: past it the rest is cut. */
const WHOLE_MAX_H = 12_000;

/** How wide a picture is, in real pixels. A gallery card is ~220 CSS px; 640 read soft on a retina grid. */
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

/** What a picture file holds, from its first bytes: a whole picture is WebP, a card JPEG. */
export function pictureType(bytes: Uint8Array): "webp" | "jpeg" {
	return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 ? "webp" : "jpeg";
}

/** The gallery's card: `aspect-ratio: 4 / 3`, cropped from the board's top left. */
const ASPECT = 3 / 4;
const CONCURRENCY = 2;
const IDLE_MS = 60_000;
const READY_MS = 8_000;
/** How long a board has to stop changing before its picture is retaken. */
const SETTLE_MS = 1_500;

export interface ThumbHost {
	/** Where this server can be reached from its own machine: `http://127.0.0.1:4329`. */
	origin: () => string;
	/** `<deck>/.decks/thumbs`. */
	dir: string;
	/** How long a changed board is left to settle. For tests; `SETTLE_MS` otherwise. */
	settleMs?: number;
	/**
	 * A flow document's height, as the page laid it out (`measured` below), for the deck to keep.
	 *
	 * A flow board's height is its content's and the file cannot state it, so until a browser
	 * has shown one on the canvas the record carries a 240px placeholder: a preview
	 * showed the top 240px of a page and the picture was cut off the same way. The page that
	 * takes the picture has laid the document out, which is the one thing a measurement needs.
	 */
	measured?: (path: string, rev: number, h: number) => void;
}

interface Job {
	board: Board;
	scheme: ThumbScheme;
	file: string;
	kind: ThumbKind;
	/** Taken ahead of time, because the board changed, rather than because a browser asked. */
	ahead?: boolean;
	/** Everybody waiting on this one picture. */
	waiting: Array<{ resolve: (file: string) => void; reject: (error: Error) => void; gone: () => boolean }>;
}

/**
 * What a picture is called on disk. The path is hashed: it has slashes and any script in it. The
 * width is in the name so that a change to `THUMB_WIDTH` is a miss rather than a smaller picture
 * served for as long as the board stays unchanged.
 */
export function thumbName(path: string, rev: number, scheme: ThumbScheme, kind: ThumbKind = "card"): string {
	const hash = createHash("sha1").update(path).digest("hex").slice(0, 16);
	return `${hash}-${rev}-${scheme}-${THUMB_WIDTH}${kind === "whole" ? "-whole" : ""}-l${PICTURE_LOOK}.${kind === "whole" ? "webp" : "jpg"}`;
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

/** Every picture of this board in this scheme and kind, at any revision and width. */
/**
 * The widths a whole picture is also kept at (`ThumbService.smaller`). A zoomed-out canvas draws a
 * board a few dozen pixels wide, and the whole picture, up to 2048 px and 289 KB on average, made a
 * first look at 400 boards a download of 118 MB; at 192 px the same look is a few hundred kilobytes.
 */
export const SMALL_WIDTHS: readonly number[] = [192, 480];

/** A whole picture's smaller copy, beside it on disk. */
export function smallName(whole: string, width: number): string {
	return whole.replace(/-whole(-l\d+)?\.(webp|jpg)$/, (_m, look: string | undefined) => `-whole-w${width}${look ?? ""}.webp`);
}

/** Every smaller copy of a board's whole pictures, in a scheme, whatever its revision. */
function smallOf(path: string, scheme: ThumbScheme): RegExp {
	const hash = thumbName(path, 0, scheme).slice(0, 16);
	return new RegExp(`^${hash}-\\d+-${scheme}-\\d+-whole-w\\d+(-l\\d+)?\\.webp$`);
}

function pictureOf(path: string, scheme: ThumbScheme, kind: ThumbKind = "card"): RegExp {
	const hash = thumbName(path, 0, scheme).slice(0, 16);
	return kind === "whole" ? new RegExp(`^${hash}-\\d+-${scheme}-\\d+-whole(-l\\d+)?\\.(jpg|webp)$`) : new RegExp(`^${hash}-\\d+-${scheme}(-\\d+)?(-l\\d+)?\\.jpg$`);
}

/**
 * The part of a board a card shows: its full width, and as much height as 4:3 allows.
 *
 * `h` is the board's own height for a component board and a slide, and what the page measured
 * for a flow document, whose record may still be carrying the placeholder.
 */
export function thumbClip(board: Pick<Board, "w" | "h">): { width: number; height: number; scale: number } {
	const width = Math.max(200, Math.round(board.w));
	const height = Math.max(150, Math.min(Math.round(board.h), Math.round(width * ASPECT)));
	return { width, height, scale: THUMB_WIDTH / width };
}

/**
 * In the page: how far down the board reaches, the way `board/extent.ts` measures it.
 *
 * The components, and for a flow board the whole document — a page keeps its margins on the
 * body, and a margin can collapse out of the last block, so both sit below every `[data-id]`
 * there is. The two measurements have to agree or the picture and the board are different
 * heights; the reasoning is in `extent.ts`, and this is its twin.
 */
const MEASURE = `(() => {
	let h = 0;
	for (const el of document.querySelectorAll("body > [data-id]")) {
		const r = el.getBoundingClientRect();
		if (r.width > 0 && r.height > 0 && r.bottom > h) h = r.bottom;
	}
	if (h === 0) return 0;
	const held = document.body.style.height;
	const floor = document.body.style.minHeight;
	document.body.style.height = "auto";
	document.body.style.minHeight = "0";
	const page = document.body.scrollHeight;
	document.body.style.height = held;
	document.body.style.minHeight = floor;
	if (page > h) h = page;
	return Math.ceil(h);
})()`;

/**
 * Run in the server's Chrome: a picture, as base64, decoded at `width` pixels wide and encoded again
 * as WebP. `null` when it is no wider than that already.
 */
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
		const launched = this.launch();
		void launched.then(
			(browser) =>
				(browser as Partial<Pick<Browser, "on">>).on?.("disconnected", () => {
					if (this.browser === launched) this.browser = undefined;
					if (this.resizer?.browser === browser) this.resizer = undefined;
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
	async smaller(file: string, width: number, keep = true): Promise<string | Buffer> {
		const target = smallName(file, width);
		if (keep && existsSync(target)) return target;
		const known = this.shrinking.get(target);
		if (known) return known;
		const bytes = readFileSync(file);
		// No wider than that already, or not a WebP: the picture itself.
		if ((webpWidth(bytes) ?? 0) <= width) return file;
		const making = this.borrow(async (browser) => {
			if (this.resizer?.browser !== browser) this.resizer = { browser, pages: [], next: 0 };
			const turn = this.resizer.next++ % RESIZERS;
			// A context each, so each tab is its own renderer and decodes on its own thread.
			const page = await (this.resizer.pages[turn] ??= browser.newContext().then((context) => context.newPage()));
			const out = await page.evaluate<string | null>(`(${SHRINK})(${JSON.stringify([bytes.toString("base64"), width])})`);
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

	/**
	 * Make the smaller copies every whole picture on disk is missing, a few at a time, once the
	 * server has been up `after` ms: pictures taken before copies existed would otherwise each be
	 * made while a canvas waits, which for 400 boards was half a minute of one first look.
	 */
	backfillLater(after = 10_000): void {
		const timer = setTimeout(() => void this.backfill(), after);
		timer.unref?.();
	}

	private async backfill(): Promise<void> {
		let names: string[];
		try {
			names = readdirSync(this.host.dir);
		} catch {
			return;
		}
		const have = new Set(names);
		const look = new RegExp(`-whole-l${PICTURE_LOOK}\\.webp$`);
		const todo: Array<[string, number]> = [];
		for (const name of names) {
			if (!look.test(name)) continue;
			for (const width of SMALL_WIDTHS) if (!have.has(smallName(name, width))) todo.push([join(this.host.dir, name), width]);
		}
		if (todo.length === 0) return;
		const work = async () => {
			for (let next = todo.shift(); next && !this.broken; next = todo.shift()) await this.smaller(next[0], next[1]).catch(() => {});
		};
		await Promise.all(Array.from({ length: RESIZERS }, work));
		console.log(`[decks] board pictures: made ${SMALL_WIDTHS.join(" and ")} px copies where they were missing`);
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
	get(board: Board, scheme: ThumbScheme, gone: () => boolean = () => false, kind: ThumbKind = "card"): Promise<string> {
		this.wanted().add(kind === "card" ? scheme : `${scheme}/${kind}`);
		return this.ask(board, scheme, gone, false, kind);
	}

	/**
	 * Something to show while the picture is being taken: the newest older picture of this board,
	 * in this scheme and kind (an earlier revision, or one from before a `PICTURE_LOOK` change),
	 * with the real one asked for behind it. Undefined when the real one is already on disk or
	 * there is nothing older, and the caller waits for the picture as before.
	 *
	 * Without it a board with no current picture was blank on the canvas until the server's Chrome,
	 * two pages at a time, reached it: zooming out over dozens of boards after a look change was a
	 * screen of empty rectangles filling in over a minute.
	 */
	standIn(board: Board, scheme: ThumbScheme, kind: ThumbKind = "card"): string | undefined {
		if (existsSync(join(this.host.dir, thumbName(board.path, board.rev, scheme, kind)))) return undefined;
		const any = pictureOf(board.path, scheme, kind);
		let best: { file: string; at: number } | undefined;
		try {
			for (const name of readdirSync(this.host.dir)) {
				if (!any.test(name)) continue;
				const file = join(this.host.dir, name);
				const at = statSync(file).mtimeMs;
				if (!best || at > best.at) best = { file, at };
			}
		} catch {
			return undefined;
		}
		if (!best) return undefined;
		this.get(board, scheme, () => false, kind).catch(() => {});
		return best.file;
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
			for (const want of this.wanted()) {
				const [scheme, kind] = want.split("/") as [ThumbScheme, ThumbKind | undefined];
				this.ask(board, scheme, () => false, true, kind ?? "card").catch(() => {});
			}
		}, this.host.settleMs ?? SETTLE_MS);
		timer.unref?.();
		this.settling.set(board.path, timer);
	}

	/** A board is gone: so are its pictures, and any wait to retake one. */
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
				const found = /-(light|dark)(-\d+)?(?:-(whole))?(?:-l\d+)?\.(?:jpg|webp)$/.exec(name);
				if (found) this.schemes.add(found[3] ? `${found[1]}/${found[3]}` : found[1]!);
			}
		} catch {
			/* nothing taken yet: nothing is wanted until somebody asks */
		}
		return this.schemes;
	}

	private ask(board: Board, scheme: ThumbScheme, gone: () => boolean, ahead: boolean, kind: ThumbKind = "card"): Promise<string> {
		const file = join(this.host.dir, thumbName(board.path, board.rev, scheme, kind));
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
			const job: Job = { board, scheme, kind, file, waiting: [{ resolve, reject, gone }] };
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
		/*
		 * The viewport is the tallest the picture can be, not the board's height: a flow document
		 * whose record still says 240px would otherwise be laid out in a 240px window and measured
		 * as one.
		 */
		const full = thumbClip({ w: job.board.w, h: Number.MAX_SAFE_INTEGER });
		// A whole picture is laid out at the board's own height, as the canvas lays it out.
		const tall = job.kind === "whole" ? Math.max(full.height, Math.min(Math.round(job.board.h), WHOLE_MAX_H)) : full.height;
		const context = await browser.newContext({
			viewport: { width: full.width, height: tall },
			deviceScaleFactor: job.kind === "whole" ? wholeScale({ w: job.board.w, h: tall }) : full.scale,
			colorScheme: job.scheme,
			reducedMotion: "reduce",
		});
		try {
			const page = await context.newPage();
			const url = `${this.host.origin()}/api/board/${job.board.path.split("/").map(encodeURIComponent).join("/")}`;
			await page.goto(url, { waitUntil: "load", timeout: 20_000 });
			// `board.js` sets this after fonts, markdown, maths and diagrams. A board that never
			// says so is drawn as it stands: a late picture beats none.
			await page.waitForFunction("window.__boardReady === true", undefined, { timeout: READY_MS }).catch(() => {});
			const clipOf = (b: Pick<Board, "w" | "h">) => (job.kind === "whole" ? { ...thumbClip(b), height: Math.max(150, Math.min(Math.round(b.h), WHOLE_MAX_H)) } : thumbClip(b));
			let clip = clipOf(job.board);
			if (job.board.format !== "slides") {
				const measured = await page.evaluate<number>(MEASURE).catch(() => 0);
				// Never below what the board says it is: a stated height is a floor everywhere
				// else (`deck/loader.ts`), and a picture cropped under it would be a different
				// board from the one on the canvas.
				const h = Math.max(measured, job.board.h);
				if (measured > 0 && h !== job.board.h) {
					clip = clipOf({ w: job.board.w, h });
					this.host.measured?.(job.board.path, job.board.rev, h);
				}
			}
			const shot =
				job.kind === "whole"
					? await wholeShot(page, clip, wholeScale({ w: job.board.w, h: tall }))
					: await page.screenshot({ type: "jpeg", quality: 82, clip: { x: 0, y: 0, width: clip.width, height: clip.height }, animations: "disabled", timeout: 15_000 });
			mkdirSync(this.host.dir, { recursive: true });
			writeFileSync(job.file, shot);
			this.forgetOlder(job);
			// Its smaller copies now, while the browser is up, so a canvas zoomed out never waits for one.
			if (job.kind === "whole") for (const width of SMALL_WIDTHS) void this.smaller(job.file, width).catch(() => {});
		} finally {
			await context.close().catch(() => {});
		}
	}

	/** A board's earlier revisions, in this scheme: nobody will ask for them again. */
	private forgetOlder(job: Job): void {
		const mine = thumbName(job.board.path, job.board.rev, job.scheme, job.kind);
		const any = pictureOf(job.board.path, job.scheme, job.kind);
		const small = job.kind === "whole" ? smallOf(job.board.path, job.scheme) : undefined;
		try {
			for (const name of readdirSync(this.host.dir)) {
				if (name !== mine && any.test(name)) rmSync(join(this.host.dir, name), { force: true });
				// The smaller copies of an earlier revision: this one's are made again from the new picture.
				else if (small?.test(name)) rmSync(join(this.host.dir, name), { force: true });
			}
		} catch {
			/* a directory that cannot be listed keeps its old pictures, which costs bytes and nothing else */
		}
	}

	/**
	 * Press every control on a board and say which views break it.
	 *
	 * A board that keeps its depth behind tabs and rows has views its writer never looked at:
	 * `fit` measures the board as it rests, and a screenshot is of the resting view too. The
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
 * each press the far bottom of the body's children and the horizontal spill are read.
 *
 * A view is reported when it spills sideways, when it runs past one screen (0.8 of the board's
 * width), **or when it is taller than the board it is on**. That last one is the case this
 * check was missing: a board's height is measured in the view it opens on, so a tab 125px
 * taller than its board has its last lines cut and no number anywhere was over a limit —
 * 667px on a 542px board passed a test written against the width.
 */
const PRESS_EVERY_CONTROL = `(async () => {
	const controls = [...document.querySelectorAll("button, summary, [role=tab], [data-tab], select")].filter((el) => el.getBoundingClientRect().width > 0);
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

async function launchChromium(): Promise<Browser> {
	const playwright: Playwright = await import("playwright");
	return playwright.chromium.launch();
}
