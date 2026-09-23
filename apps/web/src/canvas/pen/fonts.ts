import type { CanvasKit, Image, Paragraph, TypefaceFontProvider } from "canvaskit-wasm";
import { isMarkdown, type MeasureText, type TextStyle } from "@decks/pen";
import { parseMarkdown } from "./markdown.ts";
import { layoutMarkdown, type MarkdownLayout } from "./markdown-layout.ts";

/** The face a card's `code` is set in. */
export const MONO_FAMILY = "JetBrains Mono";



/**
 * Fonts for the drawing, fetched when a text needs them.
 *
 * CanvasKit draws text with fonts it has been handed as bytes, not with the browser's, so a family
 * a `.pen` names has to be fetched. They come from Fontsource's CDN, which serves every Google
 * font as TrueType — the one format this CanvasKit build reads; WOFF2 fails silently, measuring
 * every string as zero wide.
 *
 * The fallback chain is the family asked for, then Inter (pen.dev's default), then Noto Sans SC for
 * Chinese and Japanese, the Noto symbol fonts for arrows and ticks, and Noto Color Emoji. Each is
 * fetched only when a text uses it. A family Fontsource does not have falls through to Inter.
 */

const CDN = "https://cdn.jsdelivr.net/fontsource/fonts";
const FALLBACK = "Inter";
const CJK_FAMILY = "Noto Sans SC";
const CJK = /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;
/** Arrows, ticks, stars and the other signs Inter does not draw. */
const SYMBOL_FAMILIES = ["Noto Sans Symbols 2", "Noto Sans Symbols"];
const SYMBOLS = /[\u2190-\u21ff\u2300-\u23ff\u2460-\u27bf\u2900-\u2bff]/;
const EMOJI_FAMILY = "Noto Color Emoji";
/** Added to a face's name for its extended-Latin file (`chain`). */
const EXT = " Ext";
const EMOJI = /\p{Extended_Pictographic}/u;

export interface FontNeed {
	family: string;
	weight: number;
	italic: boolean;
	text: string;
}

const fontsourceId = (family: string) => family.trim().toLowerCase().replace(/\s+/g, "-");
const roundWeight = (weight: number) => Math.min(900, Math.max(100, Math.round(weight / 100) * 100));

export class PenFonts {
	readonly provider: TypefaceFontProvider;
	/** Bumped when a font lands, so pictures drawn without it are redrawn. */
	generation = 0;
	private readonly settled = new Map<string, Promise<boolean>>();

	constructor(private readonly ck: CanvasKit) {
		this.provider = ck.TypefaceFontProvider.Make();
	}

	/**
	 * The families a paragraph asks for, in order. A face's extended-Latin letters are a file of
	 * their own under a name of their own (`EXT`), tried after the face: registered under the face's
	 * own name, the extended file was sometimes picked for plain words, and it has no digits or
	 * punctuation, so "10 s" came out in a symbol font and a full stop as a missing-glyph box.
	 */
	chain(family: string): string[] {
		return [...new Set([family, `${family}${EXT}`, FALLBACK, `${FALLBACK}${EXT}`, CJK_FAMILY, ...SYMBOL_FAMILIES, EMOJI_FAMILY])];
	}

	/** Fetch whatever these texts need; true when anything new arrived. */
	async need(needs: readonly FontNeed[]): Promise<boolean> {
		const wanted = new Map<string, { family: string; url: string; fallback?: string }>();
		const want = (family: string, subset: string, weight: number, italic: boolean) => {
			const id = fontsourceId(family);
			const style = italic ? "italic" : "normal";
			const key = `${id}/${subset}/${weight}/${style}`;
			const name = subset === "latin-ext" ? `${family}${EXT}` : family;
			if (!wanted.has(key)) wanted.set(key, { family: name, url: `${CDN}/${id}@latest/${subset}-${weight}-${style}.ttf`, ...(weight !== 400 || italic ? { fallback: `${CDN}/${id}@latest/${subset}-400-normal.ttf` } : {}) });
		};
		want(FALLBACK, "latin", 400, false);
		for (const need of needs) {
			const weight = roundWeight(need.weight);
			for (const family of new Set([need.family, FALLBACK])) {
				want(family, "latin", weight, need.italic);
				// Letters past plain Latin that are still Latin: ā, ł, ő, ș, ẞ and the rest.
				if (/[\u0100-\u024f\u1e00-\u1eff]/.test(need.text)) want(family, "latin-ext", weight, need.italic);
			}
			if (CJK.test(need.text)) want(CJK_FAMILY, "chinese-simplified", weight >= 600 ? 700 : 400, false);
			if (SYMBOLS.test(need.text)) for (const family of SYMBOL_FAMILIES) want(family, "symbols", 400, false);
			if ([...need.text].some((ch) => EMOJI.test(ch) && !SYMBOLS.test(ch))) want(EMOJI_FAMILY, "emoji", 400, false);
		}
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
				this.provider.registerFont(await response.arrayBuffer(), family);
				this.generation++;
				return true;
			} catch {
				/* offline, or a family the CDN does not have: the chain falls through to Inter */
			}
		}
		return false;
	}

	/** A laid-out paragraph in this style, which the caller deletes. */
	paragraph(text: string, style: TextStyle, options: { color?: Float32Array; align?: string; width: number; underline?: boolean; strike?: boolean }): Paragraph {
		const ck = this.ck;
		const align = options.align === "center" ? ck.TextAlign.Center : options.align === "right" ? ck.TextAlign.Right : options.align === "justify" ? ck.TextAlign.Justify : ck.TextAlign.Left;
		const decoration = (options.underline ? ck.UnderlineDecoration : 0) | (options.strike ? ck.LineThroughDecoration : 0);
		const paragraphStyle = new ck.ParagraphStyle({
			textAlign: align,
			textStyle: {
				color: options.color ?? ck.BLACK,
				fontFamilies: this.chain(style.fontFamily),
				fontSize: style.fontSize,
				fontStyle: { weight: { value: roundWeight(style.fontWeight) }, slant: style.fontStyle === "italic" ? ck.FontSlant.Italic : ck.FontSlant.Upright },
				letterSpacing: style.letterSpacing,
				...(style.lineHeight !== undefined ? { heightMultiplier: style.lineHeight, halfLeading: true } : {}),
				...(decoration ? { decoration, decorationColor: options.color ?? ck.BLACK } : {}),
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
	private readonly cards = new Map<string, MarkdownLayout>();

	/**
	 * A card's words read as GitHub-flavoured markdown (`markdown.ts`) and set as GitHub sets them
	 * (`markdown-layout.ts`). Kept, since the same card is measured, drawn and asked where its links
	 * are, and laid out again only when its words, its width, a font or an image changes. The caller
	 * does not delete what it is given.
	 */
	markdown(text: string, style: TextStyle, options: { width: number; align?: string }): MarkdownLayout {
		const key = JSON.stringify([this.generation, this.imageVersion, Math.round(options.width * 10), options.align ?? "left", style, text]);
		const known = this.cards.get(key);
		if (known) {
			this.cards.delete(key);
			this.cards.set(key, known);
			return known;
		}
		const made = layoutMarkdown({ ck: this.ck, provider: this.provider, chain: (family) => this.chain(family), image: (url) => this.images?.(url), mono: MONO_FAMILY }, parseMarkdown(text), style, Math.max(1, options.width), options.align);
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
		if (node && isMarkdown(node)) return { w: maxWidth ?? 240, h: this.markdown(text, style, { width: maxWidth ?? 240, align: node.textAlign ?? "left" }).height };
		const paragraph = this.paragraph(text || " ", style, { width: maxWidth ?? 1e6 });
		const w = maxWidth === undefined ? Math.ceil(paragraph.getMaxIntrinsicWidth()) : Math.min(maxWidth, Math.ceil(paragraph.getLongestLine()));
		const h = paragraph.getHeight();
		paragraph.delete();
		return { w, h };
	};
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
					const font = new FontFace(`Pen ${name}`, `url(${CDN}/${id}@latest/latin-${w}-${style}.woff2)`, { weight: String(w), style });
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
	face(FALLBACK);
	return `"Pen ${family}", "Pen ${FALLBACK}", system-ui, sans-serif`;
}
