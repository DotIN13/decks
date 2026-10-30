import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { estimateText, isMarkdown, isMarkdownText, type MeasureText } from "@decks/pen";
import { fileURLToPath } from "node:url";
import { initSync, TextMeasure } from "@decks/stage";
import { fontFiles, isFallbackFamily, textNeeds, type FontFile } from "../../../../packages/canvas/src/render/font-files.ts";
import { cardReader, mathTypesetter } from "../../../../packages/canvas/src/render/reader.ts";

/**
 * Words measured on the server as the page measures them: the same Rust text crate as the page's
 * engine (`@decks/stage`, `TextMeasure`), the same font files (`font-files.ts` lists them), and a
 * card's markdown read by the same reader. So a box an agent reads back from an edit is the box the page draws,
 * not an estimate a few pixels off.
 *
 * Font files are fetched from the CDN once and kept on disk, so a file this server has seen is there
 * at once after a restart. Words that need a file still on its way are measured by the estimate,
 * and measured again when it lands (`onFonts`). With no network, every file the server
 * has never seen stays missing, and the page's own fallback rule applies: a missing file is skipped.
 */

/** Where fetched font files are kept; `DECKS_FONT_CACHE` moves it. */
const CACHE = process.env.DECKS_FONT_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "decks", "fonts");

/** The engine's module, loaded from its file once: the page's own build, run here without a graphics card. */
function loadText(): Promise<TextMeasure> {
	return Promise.resolve().then(() => {
		initSync({ module: readFileSync(fileURLToPath(new URL("stage_web_bg.wasm", import.meta.resolve("@decks/stage")))) });
		const engine = new TextMeasure();
		engine.setMarkdownReader(cardReader("light"));
		engine.setMath(mathTypesetter());
		return engine;
	});
}

class ServerText {
	private engine: TextMeasure | undefined;
	private starting: Promise<void> | undefined;
	/** Each file by its key: true once handed to the engine, false when it could not be had, a promise while on its way. */
	private readonly files = new Map<string, boolean | Promise<void>>();
	private readonly listeners = new Set<() => void>();

	/** Load the engine; until it has, every measure is the estimate. */
	start(): Promise<void> {
		this.starting ??= loadText()
			.then((engine) => {
				this.engine = engine;
				this.changed();
			})
			.catch((error: unknown) => console.warn(`[text] the Rust text engine did not load, so words are estimated: ${error instanceof Error ? error.message : String(error)}`));
		return this.starting;
	}

	/** Called when a font lands or the engine starts, so layouts made with the estimate can be made again. */
	onFonts(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * The measure `@decks/pen`'s layout takes: the engine's for words whose font files are all here, and
	 * the estimate for words still waiting on one, which is sent for. Plain words are measured as
	 * the page's engine measures them, and a card's markdown is laid out as its cards are.
	 */
	readonly measure: MeasureText = (text, style, maxWidth, node) => {
		if (!this.engine) {
			void this.start();
			return estimateText(text, style, maxWidth, node);
		}
		const markdown = !!node && (isMarkdown(node) || isMarkdownText(node));
		const align = markdown ? (node!.textAlign ?? "left") : "";
		/*
		 * Kept, as the page keeps them: one edit lays the drawing out more than once, and setting every
		 * text anew made the largest stage's layout ten times the estimate's.
		 */
		const key = JSON.stringify([this.generation, markdown, align, maxWidth === undefined ? -1 : Math.round(maxWidth * 10), style, text]);
		const known = this.sizes.get(key);
		if (known) return known;
		let ready = true;
		for (const file of fontFiles(textNeeds(text, style, markdown))) if (!this.have(file)) ready = false;
		if (!ready) return estimateText(text, style, maxWidth, node);
		const [w = 0, h = 0] = this.engine.measure(text, JSON.stringify(style), markdown ? (maxWidth ?? 240) : (maxWidth ?? -1), markdown, align);
		const size = { w, h };
		if (this.sizes.size >= 8192) this.sizes.delete(this.sizes.keys().next().value!);
		// Measured with the files there were: a file that lands later starts a new generation, and so new sizes.
		this.sizes.set(JSON.stringify([this.generation, markdown, align, maxWidth === undefined ? -1 : Math.round(maxWidth * 10), style, text]), size);
		return size;
	};
	/** Sizes measured, by font generation, kind, width, style and words. */
	private readonly sizes = new Map<string, { w: number; h: number }>();
	/** Bumped when a font file is handed to the engine. */
	private generation = 0;

	/** Whether a file is settled, from memory or the disk at once; one not yet here is sent for. */
	private have(file: FontFile): boolean {
		const state = this.files.get(file.key);
		if (state === true || state === false) return true;
		if (state) return false;
		const cached = this.cached(file.key);
		if (cached !== undefined) {
			this.register(file, cached);
			return true;
		}
		this.files.set(
			file.key,
			this.fetch(file).then((bytes) => {
				if (bytes) {
					this.store(file.key, bytes);
					this.register(file, bytes);
				} else {
					// Not on the CDN is remembered on disk; no network is only for this run.
					if (bytes === false) this.store(file.key, false);
					this.files.set(file.key, false);
				}
				this.changed();
			}),
		);
		return false;
	}

	/**
	 * A font file on this machine's disk, fetched into the cache first if it is not there, for a
	 * reader that wants a path rather than bytes (`native-shots.ts`); undefined when it cannot be had.
	 */
	async fontPath(file: FontFile): Promise<{ path: string; fallback: boolean } | undefined> {
		const path = join(CACHE, `${file.key.replaceAll("/", "_")}.ttf`);
		const at = { path, fallback: isFallbackFamily(file.family) };
		if (existsSync(path)) return at;
		if (existsSync(`${path}.missing`)) return undefined;
		const bytes = await this.fetch(file);
		if (bytes === null) return undefined;
		this.store(file.key, bytes);
		return bytes === false ? undefined : at;
	}

	private register(file: FontFile, bytes: Uint8Array | false): void {
		if (bytes === false) {
			this.files.set(file.key, false);
			return;
		}
		this.engine!.addFont(file.family, bytes, isFallbackFamily(file.family));
		this.files.set(file.key, true);
		this.generation++;
	}

	/** The file's bytes from the disk; `false` when it is known not to exist on the CDN; undefined when never fetched. */
	private cached(key: string): Uint8Array | false | undefined {
		const path = join(CACHE, `${key.replaceAll("/", "_")}.ttf`);
		if (existsSync(`${path}.missing`)) return false;
		if (!existsSync(path)) return undefined;
		try {
			return new Uint8Array(readFileSync(path));
		} catch {
			return undefined;
		}
	}

	private store(key: string, bytes: Uint8Array | false): void {
		try {
			mkdirSync(CACHE, { recursive: true });
			const path = join(CACHE, `${key.replaceAll("/", "_")}.ttf`);
			if (bytes === false) writeFileSync(`${path}.missing`, "");
			else writeFileSync(path, bytes);
		} catch {
			/* a cache that cannot be written only means fetching again after a restart */
		}
	}

	/** The file, its fallback if it fails, or `false` when the CDN has neither; null when the network failed (tried again after a restart). */
	private async fetch(file: FontFile): Promise<Uint8Array | false | null> {
		let reached = false;
		for (const source of file.fallback ? [file.url, file.fallback] : [file.url]) {
			try {
				const response = await fetch(source, { signal: AbortSignal.timeout(20_000) });
				reached = true;
				if (response.ok) return new Uint8Array(await response.arrayBuffer());
			} catch {
				/* offline, or slow */
			}
		}
		return reached ? false : null;
	}

	private changed(): void {
		for (const listener of this.listeners) listener();
	}
}

export const serverText = new ServerText();
