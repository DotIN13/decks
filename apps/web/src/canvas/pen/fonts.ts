import type { CanvasKit, Image, Paragraph, TypefaceFontProvider } from "canvaskit-wasm";
import { isMarkdown, isMarkdownText, type MeasureText, type TextStyle } from "@decks/pen";
import { parseMarkdown } from "./markdown.ts";
import { layoutMarkdown, type MarkdownLayout } from "./markdown-layout.ts";
import { FALLBACK_FAMILY, FONT_CDN, fontChain, fontFiles, fontsourceId, MONO_FAMILY, roundWeight, type FontNeed } from "./font-files.ts";

export { fontChain, MONO_FAMILY, type FontNeed } from "./font-files.ts";

/**
 * Fonts for the drawing, fetched when a text needs them (`font-files.ts` says which).
 *
 * CanvasKit draws text with fonts it has been handed as bytes, not with the browser's, so a family
 * a `.pen` names has to be fetched, as TrueType: the one format this CanvasKit build reads; WOFF2
 * fails silently, measuring every string as zero wide.
 */

export class PenFonts {
	/** CanvasKit's font provider; none when the engine draws everything and CanvasKit is never loaded. */
	readonly provider: TypefaceFontProvider;
	/** Bumped when a font lands, so pictures drawn without it are redrawn. */
	generation = 0;
	private readonly settled = new Map<string, Promise<boolean>>();
	/** Every font file handed to CanvasKit, and its size: each is copied into the wasm heap, which never shrinks. */
	readonly loaded: Array<{ url: string; bytes: number }> = [];
	/**
	 * The files themselves, in the order CanvasKit got them, kept only while `keepFiles` is on: the
	 * engine's own text measure (`@decks/engine/scene`) is handed each, and lets go of it once it has.
	 */
	keepFiles = false;
	readonly files: Array<{ family: string; bytes: ArrayBuffer | undefined }> = [];

	/**
	 * Without CanvasKit (`ck` undefined) the fonts are only fetched and kept as files for the engine
	 * (`keepFiles`): `paragraph`, `markdown` and `measure` then have nothing to set words with and must
	 * not be called.
	 */
	constructor(private readonly ck?: CanvasKit) {
		this.provider = (ck ? ck.TypefaceFontProvider.Make() : undefined) as TypefaceFontProvider;
	}

	/**
	 * The families a paragraph asks for, in order. A face's extended-Latin letters are a file of
	 * their own under a name of their own (`EXT`), tried after the face: registered under the face's
	 * own name, the extended file was sometimes picked for plain words, and it has no digits or
	 * punctuation, so "10 s" came out in a symbol font and a full stop as a missing-glyph box.
	 */
	chain(family: string): string[] {
		return fontChain(family);
	}

	/** Fetch whatever these texts need; true when anything new arrived. */
	async need(needs: readonly FontNeed[]): Promise<boolean> {
		const wanted = fontFiles(needs).map((font) => [font.key, font] as const);
		const results = await Promise.all(
			[...wanted].map(([key, font]) => {
				let settled = this.settled.get(key);
				if (!settled) {
					settled = this.load(font.family, font.url, font.fallback);
					this.settled.set(key, settled);
				}
				return settled;
			}),
		);
		const fresh = results.some(Boolean);
		return fresh;
	}

	private async load(family: string, url: string, fallback?: string): Promise<boolean> {
		for (const source of fallback ? [url, fallback] : [url]) {
			try {
				const response = await fetch(source);
				if (!response.ok) continue;
				const bytes = await response.arrayBuffer();
				this.provider?.registerFont(bytes, family);
				if (this.keepFiles) this.files.push({ family, bytes });
				this.loaded.push({ url: source.slice(source.lastIndexOf("/fonts/") + 7), bytes: bytes.byteLength });
				this.generation++;
				return true;
			} catch {
				/* offline, or a family the CDN does not have: the chain falls through to Inter */
			}
		}
		return false;
	}

	/** A laid-out paragraph in this style, which the caller deletes. */
	paragraph(text: string, style: TextStyle, options: { color?: Float32Array; align?: string; width: number; underline?: boolean; strike?: boolean; oneLine?: boolean; shadows?: Array<{ color: Float32Array; offset: [number, number]; blurRadius: number }> }): Paragraph {
		const ck = this.ck!;
		const align = options.align === "center" ? ck.TextAlign.Center : options.align === "right" ? ck.TextAlign.Right : options.align === "justify" ? ck.TextAlign.Justify : ck.TextAlign.Left;
		const decoration = (options.underline ? ck.UnderlineDecoration : 0) | (options.strike ? ck.LineThroughDecoration : 0);
		const paragraphStyle = new ck.ParagraphStyle({
			textAlign: align,
			// A label that must stay on its line, a file's name: cut with an ellipsis rather than wrapped.
			...(options.oneLine ? { maxLines: 1, ellipsis: "…" } : {}),
			textStyle: {
				color: options.color ?? ck.BLACK,
				fontFamilies: this.chain(style.fontFamily),
				fontSize: style.fontSize,
				fontStyle: { weight: { value: roundWeight(style.fontWeight) }, slant: style.fontStyle === "italic" ? ck.FontSlant.Italic : ck.FontSlant.Upright },
				letterSpacing: style.letterSpacing,
				...(style.lineHeight !== undefined ? { heightMultiplier: style.lineHeight, halfLeading: true } : {}),
				...(decoration ? { decoration, decorationColor: options.color ?? ck.BLACK } : {}),
				...(options.shadows?.length ? { shadows: options.shadows } : {}),
			},
		});
		const builder = ck.ParagraphBuilder.MakeFromFontProvider(paragraphStyle, this.provider);
		builder.addText(text);
		const paragraph = builder.build();
		builder.delete();
		paragraph.layout(Math.max(1, options.width));
		return paragraph;
	}

	/** An image's picture once it has arrived, for a card's `![…](…)`: the layer's own image cache. */
	images: ((url: string) => Image | undefined) | undefined;
	/** Bumped when an image arrives, so a card laid out without it is laid out again. */
	imageVersion = 0;
	/** The app's light or dark, which a card's colours follow (`markdown-layout.ts`). */
	scheme: "light" | "dark" = "light";
	private readonly cards = new Map<string, MarkdownLayout>();

	/**
	 * A card's words read as Obsidian's markdown (`markdown.ts`) and set as GitHub sets them
	 * (`markdown-layout.ts`). Kept, since the same card is measured, drawn and asked where its links
	 * are, and laid out again only when its words, its width, a font or an image changes. The caller
	 * does not delete what it is given.
	 */
	markdown(text: string, style: TextStyle, options: { width: number; align?: string }): MarkdownLayout {
		const key = JSON.stringify([this.generation, this.imageVersion, this.scheme, Math.round(options.width * 10), options.align ?? "left", style, text]);
		const known = this.cards.get(key);
		if (known) {
			this.cards.delete(key);
			this.cards.set(key, known);
			return known;
		}
		const made = layoutMarkdown({ ck: this.ck!, provider: this.provider, chain: (family) => this.chain(family), image: (url) => this.images?.(url), mono: MONO_FAMILY, scheme: this.scheme }, parseMarkdown(text), style, Math.max(1, options.width), options.align);
		this.cards.set(key, made);
		// The least recently used go, beyond what a stage of cards needs at once.
		while (this.cards.size > 64) {
			const [oldest, layout] = this.cards.entries().next().value as [string, MarkdownLayout];
			this.cards.delete(oldest);
			layout.delete();
		}
		return made;
	}

	/** The measure `@decks/pen`'s layout takes, with this browser's fonts. A card's markdown is measured as it is drawn. */
	readonly measure: MeasureText = (text, style, maxWidth, node) => {
		if (node && (isMarkdown(node) || isMarkdownText(node))) return { w: maxWidth ?? 240, h: this.markdown(text, style, { width: maxWidth ?? 240, align: node.textAlign ?? "left" }).height };
		/*
		 * Kept, as a card's layout is: a layout of the drawing measures every text in it, and a step
		 * of a resize lays the whole drawing out again to place one item. Setting each paragraph
		 * anew was most of that layout on a stage of notes.
		 */
		const key = JSON.stringify([this.generation, maxWidth === undefined ? -1 : Math.round(maxWidth * 10), style, text]);
		const known = this.sizes.get(key);
		if (known) return known;
		const paragraph = this.paragraph(text || " ", style, { width: maxWidth ?? 1e6 });
		const w = maxWidth === undefined ? Math.ceil(paragraph.getMaxIntrinsicWidth()) : Math.min(maxWidth, Math.ceil(paragraph.getLongestLine()));
		const h = paragraph.getHeight();
		paragraph.delete();
		const size = { w, h };
		if (this.sizes.size >= 4096) this.sizes.delete(this.sizes.keys().next().value!);
		this.sizes.set(key, size);
		return size;
	};
	/** Plain text measured, by font generation, width, style and words (`measure`). */
	private readonly sizes = new Map<string, { w: number; h: number }>();
}

/**
 * The same font files the canvas draws with, for the page's own text: the editor that types over a
 * drawn item has to set its words exactly where the canvas set them, and a system font in its place
 * wraps and spaces them differently. Registered under a name of their own ("Pen Inter"), so the
 * app's interface fonts are never touched, and fetched once per family, weight and style.
 */
const pageFonts = new Map<string, Promise<void>>();
export function pageFont(family: string, weight: number, italic: boolean): string {
	const face = (name: string) => {
		const w = roundWeight(weight);
		const style = italic ? "italic" : "normal";
		const key = `${name}/${w}/${style}`;
		if (!pageFonts.has(key)) {
			const id = fontsourceId(name);
			const load = async () => {
				{
					const font = new FontFace(`Pen ${name}`, `url(${FONT_CDN}/${id}@latest/latin-${w}-${style}.woff2)`, { weight: String(w), style });
					try {
						document.fonts.add(await font.load());
					} catch {
						/* a family the CDN does not have: the next name in the list is used */
					}
				}
			};
			pageFonts.set(key, load());
		}
	};
	face(family);
	face(FALLBACK_FAMILY);
	return `"Pen ${family}", "Pen ${FALLBACK_FAMILY}", system-ui, sans-serif`;
}
