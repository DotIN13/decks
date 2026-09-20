import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Board } from "@decks/protocol";

/**
 * A picture of a board, taken on the server, for the dashboard's gallery.
 *
 * The gallery used to show a picture only of a board this browser had already had open on
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

export type ThumbScheme = "light" | "dark";

/** How wide a picture is, in real pixels. A gallery card is ~220 CSS px; 640 read soft on a retina grid. */
export const THUMB_WIDTH = 720;
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
	 * has shown one on the canvas the record carries a 240px placeholder: the dashboard's preview
	 * showed the top 240px of a page and the picture was cut off the same way. The page that
	 * takes the picture has laid the document out, which is the one thing a measurement needs.
	 */
	measured?: (path: string, rev: number, h: number) => void;
}

interface Job {
	board: Board;
	scheme: ThumbScheme;
	file: string;
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
export function thumbName(path: string, rev: number, scheme: ThumbScheme): string {
	return `${createHash("sha1").update(path).digest("hex").slice(0, 16)}-${rev}-${scheme}-${THUMB_WIDTH}.jpg`;
}

/** Every picture of this board in this scheme, at any revision and width. */
function pictureOf(path: string, scheme: ThumbScheme): RegExp {
	return new RegExp(`^${thumbName(path, 0, scheme).slice(0, 16)}-\\d+-${scheme}(-\\d+)?\\.jpg$`);
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
 * In the page: how far down the board reaches, the way `canvas/extent.ts` measures it.
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
	if (document.body.classList.contains("flow")) {
		const held = document.body.style.height;
		document.body.style.height = "auto";
		const page = document.body.scrollHeight;
		document.body.style.height = held;
		if (page > h) h = page;
	}
	return Math.ceil(h);
})()`;

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
	/** The schemes anybody has asked for. Read off the disk the first time, so it survives a restart. */
	private schemes: Set<ThumbScheme> | undefined;

	constructor(private host: ThumbHost, private launch: () => Promise<Browser> = launchChromium) {}

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
	get(board: Board, scheme: ThumbScheme, gone: () => boolean = () => false): Promise<string> {
		this.wanted().add(scheme);
		return this.ask(board, scheme, gone, false);
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
			for (const scheme of this.wanted()) this.ask(board, scheme, () => false, true).catch(() => {});
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

	private wanted(): Set<ThumbScheme> {
		if (this.schemes) return this.schemes;
		this.schemes = new Set();
		try {
			for (const name of readdirSync(this.host.dir)) {
				if (/-light(-\d+)?\.jpg$/.test(name)) this.schemes.add("light");
				else if (/-dark(-\d+)?\.jpg$/.test(name)) this.schemes.add("dark");
			}
		} catch {
			/* nothing taken yet: nothing is wanted until somebody asks */
		}
		return this.schemes;
	}

	private ask(board: Board, scheme: ThumbScheme, gone: () => boolean, ahead: boolean): Promise<string> {
		const file = join(this.host.dir, thumbName(board.path, board.rev, scheme));
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
			const job: Job = { board, scheme, file, waiting: [{ resolve, reject, gone }] };
			this.byFile.set(file, job);
			/*
			 * A picture taken ahead of time goes to the back, which is the front of the array:
			 * the next job is popped off the end. And it replaces one still waiting for an
			 * older revision of the same board, which nobody will ever ask for.
			 */
			if (ahead) {
				const any = pictureOf(board.path, scheme);
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
			this.browser ??= this.launch();
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
		const context = await browser.newContext({
			viewport: { width: full.width, height: full.height },
			deviceScaleFactor: full.scale,
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
			let clip = thumbClip(job.board);
			if (job.board.format === "flow") {
				const measured = await page.evaluate<number>(MEASURE).catch(() => 0);
				if (measured > 0) {
					clip = thumbClip({ w: job.board.w, h: measured });
					this.host.measured?.(job.board.path, job.board.rev, measured);
				}
			}
			const shot = await page.screenshot({
				type: "jpeg",
				quality: 82,
				clip: { x: 0, y: 0, width: clip.width, height: clip.height },
				animations: "disabled",
				timeout: 15_000,
			});
			mkdirSync(this.host.dir, { recursive: true });
			writeFileSync(job.file, shot);
			this.forgetOlder(job);
		} finally {
			await context.close().catch(() => {});
		}
	}

	/** A board's earlier revisions, in this scheme: nobody will ask for them again. */
	private forgetOlder(job: Job): void {
		const mine = thumbName(job.board.path, job.board.rev, job.scheme);
		const any = pictureOf(job.board.path, job.scheme);
		try {
			for (const name of readdirSync(this.host.dir)) {
				if (name !== mine && any.test(name)) rmSync(join(this.host.dir, name), { force: true });
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
			this.browser ??= this.launch();
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

	private rest(): void {
		clearTimeout(this.idle);
		this.idle = setTimeout(() => void this.close(), IDLE_MS);
		this.idle.unref?.();
	}

	private async close(): Promise<void> {
		const browser = this.browser;
		this.browser = undefined;
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
