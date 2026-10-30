import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Box } from "@decks/pen";
import { fontFiles, type FontNeed } from "../../../../packages/canvas/src/render/font-files.ts";
import { iconUrl, parseIcon } from "../../../../packages/canvas/src/render/icons.ts";
import { cardReader } from "../../../../packages/canvas/src/render/reader.ts";
import { serverText } from "./text.ts";

/**
 * A stage picture drawn without a browser: `stage-shot` (`packages/stage/crates/shot`), the stage
 * engine's own layout and painter on this machine's graphics card, kept running and spoken to one
 * JSON line at a time. The drawing is painted over the boards' current pictures (`.decks/thumbs`),
 * with a hole for each board, on the stage's paper.
 *
 * It asks for what only the app has, and this answers from the same places the page does: font
 * files from the server's font cache (`font-files.ts`, `text.ts`), a card's markdown read by the
 * app's reader, icons from their CDN (`icons.ts`), image fills from the deck or the web.
 *
 * Whenever it cannot draw the box as the person would see it, it says why rather than drawing
 * something else (`NativeOutcome.why`), and the caller takes the picture in Chromium
 * (`shots.ts`): a formula in the box, a picture or an icon it cannot load, a board with no picture
 * of its current revision, no binary built, no graphics card.
 */

export interface NativeBoard {
	path: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface NativeRequest {
	/** The `.pen` document, whole, as the page's engine is given it. */
	doc: unknown;
	/** The folder its image fills are read against: a `file:` URL, as `StagePens.frame` gives it. */
	base: string;
	boards: NativeBoard[];
	box: Box;
	/** Picture pixels a stage unit. */
	scale: number;
	width: number;
	height: number;
	scheme: "light" | "dark";
	format: "png" | "jpeg";
	/** Where to write the picture. */
	out: string;
	/** Who last wrote the drawing, as its placeholder frames are marked; none: the accent, no name. */
	writer?: { name?: string; color: string };
}

export type NativeOutcome = { ok: true; width: number; height: number; ms: Record<string, number> } | { ok: false; why: string };

export interface NativeHost {
	/**
	 * A board's picture of its current revision, at least `px` wide when there is one that size, or
	 * why there is none (and it is asked for, so a later shot has it).
	 */
	boardPicture: (path: string, scheme: "light" | "dark", px: number) => { file: string } | { why: string };
}

/** The stage's own paper (`--stage` in `apps/web/src/index.css`), straight RGB 0 to 1. */
// The canvas's paper as the harness shows it (`--stage`, v3: #f5f5f5 and #1e1e1e), so a picture matches the screen.
const PAPER = { light: [245 / 255, 245 / 255, 245 / 255], dark: [30 / 255, 30 / 255, 30 / 255] } as const;
/** Rounds of asking: fonts, then cards, then pictures and icons, with room to spare. */
const ROUNDS = 6;
/** How long one answer may take before the process is thought stuck and stopped. */
const ANSWER_MS = 30_000;
/** How long the process stays up with nothing asked of it. */
const IDLE_MS = 10 * 60_000;
const FETCH_MS = 10_000;

/** Where the binary is: `DECKS_STAGE_SHOT`, or this repository's release build. */
export function nativeBinary(): string | undefined {
	const named = process.env.DECKS_STAGE_SHOT;
	if (named) return existsSync(named) ? named : undefined;
	const built = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../packages/stage/target/release/stage-shot");
	return existsSync(built) ? built : undefined;
}

type Answer = { ok: boolean; error?: string; fontNeeds?: FontNeed[]; needs?: { cards: string[]; pictures: string[]; icons: string[]; math: string[] }; problems?: string[]; file?: string; width?: number; height?: number; ms?: Record<string, number> };

export class NativeShots {
	private child: ChildProcessWithoutNullStreams | undefined;
	private ready: Promise<void> | undefined;
	private waiting = new Map<number, { resolve: (answer: Answer) => void; reject: (error: Error) => void }>();
	private nextId = 1;
	private queue: Promise<unknown> = Promise.resolve();
	private idle: ReturnType<typeof setTimeout> | undefined;
	/** The font files this process has been handed already, by key; cards, pictures and icons it keeps itself and asks only for new ones. */
	private sentFonts = new Set<string>();
	/** The documents whose font needs were answered, by hash. */
	private fontsFor = new Set<string>();
	/** Why the process could not start, once it could not: not tried again until the binary changes. */
	private broken: { why: string; binary: string } | undefined;

	constructor(
		private host: NativeHost,
		private binary: () => string | undefined = nativeBinary,
	) {}

	/** Take one picture, or say why not. One at a time: the process draws one picture at once anyway. */
	take(request: NativeRequest): Promise<NativeOutcome> {
		const run = this.queue.then(() => this.takeNow(request));
		this.queue = run.catch(() => undefined);
		return run;
	}

	private async takeNow(request: NativeRequest): Promise<NativeOutcome> {
		const binary = this.binary();
		if (!binary) return { ok: false, why: "the native renderer is not built (cargo build --release -p stage-shot in packages/stage)" };
		if (this.broken?.binary === binary) return { ok: false, why: this.broken.why };
		const s = request.scale;
		const inBox = request.boards.filter((b) => b.x < request.box.x2 && b.x + b.w > request.box.x1 && b.y < request.box.y2 && b.y + b.h > request.box.y1);
		const boards: Array<{ x: number; y: number; w: number; h: number; picture: string }> = [];
		for (const board of inBox) {
			const found = this.host.boardPicture(board.path, request.scheme, board.w * s);
			if ("why" in found) return { ok: false, why: found.why };
			boards.push({ x: board.x, y: board.y, w: board.w, h: board.h, picture: found.file });
		}
		const docText = JSON.stringify(request.doc);
		const docHash = createHash("sha1").update(docText).digest("hex");
		const base = {
			doc: docText,
			dark: request.scheme === "dark",
			box: [request.box.x1, request.box.y1, request.box.x2, request.box.y2],
			scale: s,
			width: request.width,
			height: request.height,
			paper: PAPER[request.scheme],
			boards,
			out: request.out,
			format: request.format,
			quality: 90,
			...(request.writer ? { writer: request.writer } : {}),
		};
		try {
			await this.start(binary);
			let handover: Record<string, unknown> = {};
			// The fonts the stage's words need, as the page fetches them: once per document.
			if (!this.fontsFor.has(docHash)) {
				const answer = await this.ask({ ...base, fontNeeds: true });
				if (!answer.ok) return { ok: false, why: `the native renderer failed: ${answer.error}` };
				handover = { fonts: await this.fonts(answer.fontNeeds ?? []) };
				this.fontsFor.add(docHash);
			}
			for (let round = 0; round < ROUNDS; round++) {
				const answer = await this.ask({ ...base, ...handover });
				handover = {};
				if (!answer.ok) return { ok: false, why: `the native renderer failed: ${answer.error}` };
				if (answer.problems?.length) return { ok: false, why: `a picture in the box cannot be drawn here (${answer.problems.join("; ")})` };
				if (answer.file) return { ok: true, width: answer.width ?? 0, height: answer.height ?? 0, ms: answer.ms ?? {} };
				const needs = answer.needs ?? { cards: [], pictures: [], icons: [], math: [] };
				if (needs.math.length) return { ok: false, why: `the box has math (${needs.math.slice(0, 3).join(", ")}), which is typeset in the browser` };
				const read = cardReader(request.scheme);
				const cards = needs.cards.map((source) => ({ dark: request.scheme === "dark", source, blocks: read(source) }));
				const pictures: Array<{ url: string; path: string | null }> = [];
				for (const url of needs.pictures) {
					const path = await this.pictureFile(url, request.base);
					if (!path) return { ok: false, why: `an image in the box cannot be loaded (${url.slice(0, 120)})` };
					pictures.push({ url, path });
				}
				const icons: Array<{ key: string; shape: string | null }> = [];
				for (const key of needs.icons) {
					const shape = await this.icon(key);
					if (!shape) return { ok: false, why: `an icon in the box cannot be loaded (${key})` };
					icons.push({ key, shape });
				}
				if (!cards.length && !pictures.length && !icons.length) return { ok: false, why: "the native renderer asked for nothing it could be given" };
				handover = { cards, pictures, icons };
			}
			return { ok: false, why: "the native renderer kept asking for more" };
		} catch (error) {
			return { ok: false, why: `the native renderer failed: ${(error as Error).message}` };
		} finally {
			this.rest();
		}
	}

	/** The font files these needs come to, fetched into the server's cache, in the order the page adds them. */
	private async fonts(needs: FontNeed[]): Promise<Array<{ key: string; family: string; path: string; fallback: boolean }>> {
		const out: Array<{ key: string; family: string; path: string; fallback: boolean }> = [];
		for (const file of fontFiles(needs)) {
			if (this.sentFonts.has(file.key)) continue;
			const path = await serverText.fontPath(file);
			this.sentFonts.add(file.key);
			if (path) out.push({ key: file.key, family: file.family, path: path.path, fallback: path.fallback });
		}
		return out;
	}

	/** An image fill's file on this machine: the deck's own, or fetched from the web into a cache. */
	private async pictureFile(url: string, base: string): Promise<string | undefined> {
		try {
			const at = new URL(url, base);
			if (at.protocol === "file:") {
				const path = fileURLToPath(at);
				return existsSync(path) ? path : undefined;
			}
			const dir = join(tmpdir(), "decks-native-shots");
			mkdirSync(dir, { recursive: true });
			const kept = join(dir, createHash("sha1").update(at.href).digest("hex"));
			if (existsSync(kept)) return kept;
			let bytes: Uint8Array;
			if (at.protocol === "data:") {
				const comma = at.href.indexOf(",");
				const head = at.href.slice(5, comma);
				const body = at.href.slice(comma + 1);
				bytes = head.endsWith(";base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body));
			} else if (at.protocol === "http:" || at.protocol === "https:") {
				const response = await fetch(at, { signal: AbortSignal.timeout(FETCH_MS) });
				if (!response.ok) return undefined;
				bytes = new Uint8Array(await response.arrayBuffer());
			} else return undefined;
			writeFileSync(kept, bytes);
			return kept;
		} catch {
			return undefined;
		}
	}

	/** An icon's shapes as the page reads them (`parseIcon`), by its key `library|name|weight`. */
	private async icon(key: string): Promise<string | undefined> {
		const [library = "lucide", name = "", weight = "400"] = key.split("|");
		const url = iconUrl(library, name, Number(weight));
		if (!url) return undefined;
		try {
			const dir = join(tmpdir(), "decks-native-shots");
			const kept = join(dir, `icon-${createHash("sha1").update(url).digest("hex")}.svg`);
			let svg: string;
			if (existsSync(kept)) svg = readFileSync(kept, "utf8");
			else {
				const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
				if (!response.ok) return undefined;
				svg = await response.text();
				mkdirSync(dir, { recursive: true });
				writeFileSync(kept, svg);
			}
			const shape = parseIcon(svg, Number(weight));
			return shape ? JSON.stringify(shape) : undefined;
		} catch {
			return undefined;
		}
	}

	private start(binary: string): Promise<void> {
		if (this.child && this.ready) return this.ready;
		const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
		this.child = child;
		this.sentFonts = new Set();
		this.fontsFor.clear();
		let buffered = "";
		let started: ((value: void) => void) | undefined;
		let failed: ((error: Error) => void) | undefined;
		this.ready = new Promise<void>((resolve, reject) => {
			started = resolve;
			failed = reject;
		});
		const stop = (why: string) => {
			if (this.child !== child) return;
			this.child = undefined;
			this.ready = undefined;
			failed?.(new Error(why));
			for (const one of this.waiting.values()) one.reject(new Error(why));
			this.waiting.clear();
		};
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			buffered += chunk;
			for (let at = buffered.indexOf("\n"); at >= 0; at = buffered.indexOf("\n")) {
				const line = buffered.slice(0, at);
				buffered = buffered.slice(at + 1);
				let message: (Answer & { id?: number; ready?: boolean }) | undefined;
				try {
					message = JSON.parse(line);
				} catch {
					continue;
				}
				if (message?.ready === true) started?.();
				else if (message?.ready === false) {
					this.broken = { why: `the native renderer cannot draw on this machine: ${message.error}`, binary };
					stop(this.broken.why);
				} else if (typeof message?.id === "number") {
					const one = this.waiting.get(message.id);
					this.waiting.delete(message.id);
					one?.resolve(message);
				}
			}
		});
		child.stderr.on("data", () => {
			/* wgpu's warnings: not answers */
		});
		child.on("error", (error) => {
			this.broken = { why: `the native renderer would not start: ${error.message}`, binary };
			stop(this.broken.why);
		});
		child.on("exit", (code, signal) => stop(`the native renderer stopped (${signal ?? code})`));
		return this.ready;
	}

	private ask(message: Record<string, unknown>): Promise<Answer> {
		const child = this.child;
		if (!child) return Promise.reject(new Error("the native renderer is not running"));
		const id = this.nextId++;
		return new Promise<Answer>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiting.delete(id);
				reject(new Error(`no answer in ${ANSWER_MS / 1000} s`));
				// Stuck: this process is stopped, and the next picture starts another.
				child.kill("SIGKILL");
			}, ANSWER_MS);
			this.waiting.set(id, {
				resolve: (answer) => {
					clearTimeout(timer);
					resolve(answer);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			child.stdin.write(`${JSON.stringify({ ...message, id })}\n`);
		});
	}

	/** Stopped after a while with nothing to draw: it holds a graphics device and the fonts. */
	private rest(): void {
		clearTimeout(this.idle);
		this.idle = setTimeout(() => this.stop(), IDLE_MS);
		this.idle.unref?.();
	}

	stop(): void {
		clearTimeout(this.idle);
		const child = this.child;
		this.child = undefined;
		this.ready = undefined;
		child?.stdin.end();
		child?.kill();
	}

	/** Whether the process is up now: a picture taken now is a warm one. */
	warm(): boolean {
		return !!this.child;
	}
}
