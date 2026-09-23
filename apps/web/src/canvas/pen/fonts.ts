import type { CanvasKit, Paragraph, TypefaceFontProvider } from "canvaskit-wasm";
import type { MeasureText, TextStyle } from "@decks/pen";

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

	/** The families a paragraph asks for, in order. */
	chain(family: string): string[] {
		return [...new Set([family, FALLBACK, CJK_FAMILY, ...SYMBOL_FAMILIES, EMOJI_FAMILY])];
	}

	/** Fetch whatever these texts need; true when anything new arrived. */
	async need(needs: readonly FontNeed[]): Promise<boolean> {
		const wanted = new Map<string, { family: string; url: string; fallback?: string }>();
		const want = (family: string, subset: string, weight: number, italic: boolean) => {
			const id = fontsourceId(family);
			const style = italic ? "italic" : "normal";
			const key = `${id}/${subset}/${weight}/${style}`;
			if (!wanted.has(key)) wanted.set(key, { family, url: `${CDN}/${id}@latest/${subset}-${weight}-${style}.ttf`, ...(weight !== 400 || italic ? { fallback: `${CDN}/${id}@latest/${subset}-400-normal.ttf` } : {}) });
		};
		want(FALLBACK, "latin", 400, false);
		for (const need of needs) {
			const weight = roundWeight(need.weight);
			for (const family of new Set([need.family, FALLBACK])) {
				want(family, "latin", weight, need.italic);
				if (/[^\u0000-ɏ]/.test(need.text)) want(family, "latin-ext", weight, need.italic);
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

	/** The measure `@decks/pen`'s layout takes, with this browser's fonts. */
	readonly measure: MeasureText = (text, style, maxWidth) => {
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
