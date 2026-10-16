import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { estimateText, isMarkdown, isMarkdownText, type MeasureText } from "@decks/pen";
import { loadText, type TextEngine } from "@decks/engine/text";
import { encodeCard } from "../../../web/src/canvas/pen/card-wire.ts";
import { fontChain, fontFiles, MONO_FAMILY, textNeeds, type FontFile } from "../../../web/src/canvas/pen/font-files.ts";
import { formulaText, handFormulas } from "../../../web/src/canvas/pen/math.ts";

/**
 * Words measured on the server as the page measures them: the same C++ text as the page's engine
 * (`@decks/engine/text`), the same font files (`font-files.ts` lists them), and a card's markdown
 * encoded by the same code. So a box an agent reads back from an edit is the box the page draws,
 * not an estimate a few pixels off.
 *
 * Font files are fetched from the CDN once and kept on disk, so a file this server has seen is there
 * at once after a restart. Words that need a file still on its way are measured by the estimate,
 * and measured again when it lands (`onFonts`). With no network, every file the server
 * has never seen stays missing, and the page's own fallback rule applies: a missing file is skipped.
 */

/** Where fetched font files are kept; `DECKS_FONT_CACHE` moves it. */
const CACHE = process.env.DECKS_FONT_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "decks", "fonts");

/** A card's pictures are not known here: the page also measures a card without a picture until it arrives. */
const noPicture = () => undefined;

class ServerText {
	private engine: TextEngine | undefined;
	private starting: Promise<void> | undefined;
	/** Each file by its key: true once handed to the engine, false when it could not be had, a promise while on its way. */
	private readonly files = new Map<string, boolean | Promise<void>>();
	private readonly listeners = new Set<() => void>();
	private plain: MeasureText | undefined;

	/** Load the engine; until it has, every measure is the estimate. */
	start(): Promise<void> {
		this.starting ??= loadText()
			.then((engine) => {
				this.engine = engine;
				this.plain = engine.measure(fontChain);
				this.changed();
			})
			.catch((error: unknown) => console.warn(`[text] the C++ text engine did not load, so words are estimated: ${error instanceof Error ? error.message : String(error)}`));
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
	 * `PenFonts.measure` measures them; a card's markdown is encoded as the page encodes it and laid out
	 * by `cpp/card.cpp`.
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
		let size: { w: number; h: number };
		if (markdown) {
			const w = maxWidth ?? 240;
			const wire = encodeCard(text, style, { chain: fontChain, mono: MONO_FAMILY, scheme: "light", image: noPicture }, align);
			// A card's formulas, as the page's scene is handed them (`math.ts`).
			handFormulas(new TextDecoder().decode(wire.pool), this.engine);
			size = { w, h: this.engine.card(wire.numbers, wire.pool, Math.max(1, w)) };
		} else {
			const shown = formulaText(text);
			handFormulas(shown, this.engine);
			size = this.plain!(shown, style, maxWidth);
		}
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

	private register(file: FontFile, bytes: Uint8Array | false): void {
		if (bytes === false) {
			this.files.set(file.key, false);
			return;
		}
		this.engine!.font(bytes, file.family);
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
