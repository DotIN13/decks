import { baseTheme } from "@decks/pen";
import { fontFiles, isFallbackFamily, canvasFontNeeds, type FontFile, type FontNeed } from "../look/font-files.ts";
import { iconUrl, parseIcon } from "../look/icons.ts";
import type { CanvasEngine } from "./engine.ts";
import { fetchKept } from "@decks/frame";

type Font = { family: string; fallback: boolean; blob: Blob; bytes?: Uint8Array };

/**
 * The fonts and icons a drawing needs: each fetched once (`look/font-files.ts`, `look/icons.ts`) and
 * handed to both engines, the page's and the worker's, in the order the font chain names them. A
 * part of the engine (`engine.ts`), which it reaches through `of`.
 */
export class EngineFaces {
	constructor(private readonly of: CanvasEngine) {}

	private fontsAsked = new Set<string>();

	/** Fonts loaded, kept to give an engine started again after its device was lost. */
	/**
	 * The font files fetched, kept for an engine started again as the file (`blob`); `bytes` until
	 * both engines have them, then handed (transferred, not copied) to the worker.
	 */
	fonts: Font[] = [];

	iconsAsked = new Set<string>();

	/** Font files asked for and not yet given to the engines. */
	fontsPending = 0;

	/** Font files settled, by key: given to the engines, or not to be had. */
	fontsSettled = new Set<string>();

	private prefetched = false;

	fetchIcon(key: string): void {
		if (this.iconsAsked.has(key)) return;
		this.iconsAsked.add(key);
		const [library = "lucide", name = "", weight = "400"] = key.split("|");
		const url = iconUrl(library, name, Number(weight));
		if (!url) return;
		// Through the page when this is a frame and the page keeps it (`@decks/frame`, `kept.ts`): a frame has no cache of its own.
		void fetchKept(url)
			.then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
			.then((svg) => {
				const shape = parseIcon(svg, Number(weight));
				if (!shape || !this.of.page) return;
				const json = JSON.stringify(shape);
				this.of.page.putIcon(key, json);
				this.of.post({ type: "icon", key, shape: json });
				this.of.frames.draw();
			})
			.catch(() => {
				/* An icon that does not load is not drawn. */
			});
	}

	/** Fetch the font files the canvas's words need (`font-files.ts`), and hand each to both engines in the chain's order. */
	needFonts(): void {
		if (!this.of.page) return;
		// The words of what was laid out again since the last time: a change brings only its own.
		this.fetchFonts(fontFiles(JSON.parse(this.of.page.fontNeedsChanged()) as FontNeed[]));
	}

	/**
	 * Before the engine is up: the files the drawing's words name, read from the drawing here, so
	 * they are on their way while the engine loads and lays out rather than asked for after. What
	 * the engine's own reading (`needFonts`) finds besides is fetched then.
	 */
	prefetchFonts(): void {
		if (this.of.page || this.prefetched || !this.of.doc) return;
		this.prefetched = true;
		const doc = this.of.doc;
		const files = fontFiles(canvasFontNeeds(doc.children ?? [], doc, baseTheme(doc, this.of.scheme === "dark" ? "dark" : "light")));
		this.fetchFonts(files);
	}

	fetchFonts(wanted: readonly FontFile[]): void {
		const files = wanted.filter((file) => !this.fontsAsked.has(file.key));
		if (!files.length) return;
		for (const file of files) this.fontsAsked.add(file.key);
		this.fontsPending += files.length;
		// A worker still painting its first view waits for them (up to 300 ms) rather than paint it twice.
		if (this.of.worker) this.of.post({ type: "fontsDue" });
		void Promise.all(
			files.map(async (file) => {
				for (const url of [file.local, file.url, file.fallback].filter(Boolean) as string[]) {
					try {
						const response = await fetchKept(url);
						if (!response.ok) continue;
						const blob = await response.blob();
						return { file, blob, bytes: new Uint8Array(await blob.arrayBuffer()) };
					} catch {
						/* the next address */
					}
				}
				return undefined;
			}),
		).then((loaded) => {
			this.fontsPending -= files.length;
			for (const file of files) this.fontsSettled.add(file.key);
			// Kept first: an engine started (or started again) is given them from here.
			const fonts: Font[] = loaded.filter((one) => one !== undefined).map((one) => ({ family: one.file.family, blob: one.blob, bytes: one.bytes, fallback: isFallbackFamily(one.file.family) }));
			this.fonts.push(...fonts);
			if (!this.of.page || this.of.disposed) return;
			this.giveFonts(fonts, true);
			this.postFonts(fonts);
		});
	}

	/**
	 * Fonts to the page's engine, in the order the chain lists them (so fallbacks are tried in the
	 * app's order), laid out once for all of them; `show` lays the canvas out and draws.
	 */
	giveFonts(fonts: readonly Font[], show: boolean): void {
		if (!this.of.page || !fonts.length) return;
		for (const { family, bytes, fallback } of fonts) if (bytes) this.of.page.addFont(family, bytes, fallback, true);
		this.of.page.layOut();
		this.of.layout.wordsGeneration++;
		if (!show) return;
		this.of.layout.laidOut();
		this.of.frames.draw();
	}

	/**
	 * The same fonts to the worker, in one message (none, when every file failed: it hears how many
	 * are still due): it lays out and paints once for all of them. Their bytes are transferred, not
	 * copied (the page's engine has copied them already); the files are kept.
	 */
	postFonts(fonts: readonly Font[]): void {
		const sent = fonts.filter((font): font is Font & { bytes: Uint8Array } => !!font.bytes);
		this.of.post({ type: "fonts", fonts: sent.map(({ family, bytes, fallback }) => ({ name: family, bytes, fallback })), due: this.fontsPending }, sent.map((font) => font.bytes.buffer as ArrayBuffer));
		for (const font of sent) delete (font as Font).bytes;
	}
}
