import type { Canvas, CanvasKit, Paragraph, TypefaceFontProvider } from "canvaskit-wasm";
import { isMarkdown, type MeasureText, type TextStyle } from "@decks/pen";
import { parseMarkdown, type Run } from "./markdown.ts";

/** The face a card's `code` is set in. */
export const MONO_FAMILY = "JetBrains Mono";

/** A card's markdown, laid out: paragraphs and shapes at offsets from its top-left, and its height. */
export interface MarkdownLayout {
	height: number;
	draw(canvas: Canvas, x: number, y: number): void;
	delete(): void;
}

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

	/**
	 * A card's words read as markdown (`markdown.ts`) and set block by block: a heading larger and
	 * bold, a list item behind its marker and indented by its depth, a quote behind a bar, code in a
	 * monospace face on a tint, a rule as a line. Each block is its own paragraph, stacked downwards.
	 */
	markdown(text: string, style: TextStyle, options: { color: Float32Array; width: number; align?: string }): MarkdownLayout {
		const ck = this.ck;
		const s = style.fontSize;
		const width = Math.max(1, options.width);
		const muted = Float32Array.of(options.color[0]!, options.color[1]!, options.color[2]!, (options.color[3] ?? 1) * 0.65);
		const linkColor = ck.Color4f(0.15, 0.39, 0.92, 1);
		const tint = ck.Color4f(0, 0, 0, 0.06);
		const paragraphs: Array<{ p: Paragraph; x: number; y: number }> = [];
		const shapes: Array<{ x: number; y: number; w: number; h: number; color: Float32Array; r: number }> = [];
		const textStyle = (run: Partial<Run>, size: number, weight: number, color: Float32Array) => ({
			color: run.link ? linkColor : color,
			fontFamilies: this.chain(run.code ? MONO_FAMILY : style.fontFamily),
			fontSize: run.code ? size * 0.9 : size,
			fontStyle: { weight: { value: roundWeight(run.bold ? Math.max(700, weight) : weight) }, slant: run.italic || style.fontStyle === "italic" ? ck.FontSlant.Italic : ck.FontSlant.Upright },
			letterSpacing: style.letterSpacing,
			...(style.lineHeight !== undefined ? { heightMultiplier: style.lineHeight, halfLeading: true } : {}),
			...(run.link ? { decoration: ck.UnderlineDecoration, decorationColor: linkColor } : {}),
			...(run.code ? { backgroundColor: tint } : {}),
		});
		const set = (runs: readonly Partial<Run>[], size: number, weight: number, color: Float32Array, w: number, align = options.align) => {
			const paragraphStyle = new ck.ParagraphStyle({
				textAlign: align === "center" ? ck.TextAlign.Center : align === "right" ? ck.TextAlign.Right : ck.TextAlign.Left,
				textStyle: textStyle({}, size, weight, color),
			});
			const builder = ck.ParagraphBuilder.MakeFromFontProvider(paragraphStyle, this.provider);
			for (const run of runs.length ? runs : [{ text: " " }]) {
				builder.pushStyle(new ck.TextStyle(textStyle(run, size, weight, color)));
				builder.addText(run.text ?? "");
				builder.pop();
			}
			const paragraph = builder.build();
			builder.delete();
			paragraph.layout(Math.max(1, w));
			return paragraph;
		};
		let y = 0;
		let previous: string | undefined;
		for (const block of parseMarkdown(text)) {
			// The room between two blocks: a little inside a list, more above a heading.
			const gap = previous === undefined ? 0 : block.kind === "heading" ? s * 0.8 : block.kind === "item" && previous === "item" ? s * 0.25 : s * 0.6;
			y += gap;
			previous = block.kind;
			switch (block.kind) {
				case "heading": {
					const size = s * ([1.5, 1.25, 1.1][block.level - 1] ?? 1);
					const p = set(block.runs, size, block.level === 3 ? 600 : 700, options.color, width);
					paragraphs.push({ p, x: 0, y });
					y += p.getHeight();
					break;
				}
				case "paragraph": {
					const p = set(block.runs, s, style.fontWeight, options.color, width);
					paragraphs.push({ p, x: 0, y });
					y += p.getHeight();
					break;
				}
				case "item": {
					const indent = block.depth * s * 1.2;
					const marker = block.checked !== undefined ? (block.checked ? "☑" : "☐") : block.ordered ? `${block.number}.` : block.depth % 2 ? "◦" : "•";
					const gutter = block.ordered ? s * (block.number >= 10 ? 1.7 : 1.3) : s * 1.1;
					const mark = set([{ text: marker }], s, style.fontWeight, block.checked === undefined ? options.color : muted, gutter, "left");
					const p = set(block.runs, s, style.fontWeight, block.checked ? muted : options.color, width - indent - gutter, "left");
					paragraphs.push({ p: mark, x: indent, y }, { p, x: indent + gutter, y });
					y += p.getHeight();
					break;
				}
				case "quote": {
					const p = set(block.runs, s, style.fontWeight, muted, width - s, "left");
					shapes.push({ x: 0, y, w: 3, h: p.getHeight(), color: ck.Color4f(0, 0, 0, 0.18), r: 1.5 });
					paragraphs.push({ p, x: s, y });
					y += p.getHeight();
					break;
				}
				case "code": {
					const pad = s * 0.5;
					const p = set([{ text: block.text || " ", code: true }], s, 400, options.color, width - pad * 2, "left");
					shapes.push({ x: 0, y, w: width, h: p.getHeight() + pad * 2, color: tint, r: 4 });
					paragraphs.push({ p, x: pad, y: y + pad });
					y += p.getHeight() + pad * 2;
					break;
				}
				case "rule":
					shapes.push({ x: 0, y: y + s * 0.3, w: width, h: 1, color: ck.Color4f(0, 0, 0, 0.15), r: 0 });
					y += s * 0.6;
					break;
			}
		}
		return {
			height: y,
			draw: (canvas, x, top) => {
				const paint = new ck.Paint();
				paint.setAntiAlias(true);
				for (const shape of shapes) {
					paint.setColor(shape.color);
					canvas.drawRRect(ck.RRectXY(ck.XYWHRect(x + shape.x, top + shape.y, shape.w, shape.h), shape.r, shape.r), paint);
				}
				paint.delete();
				for (const { p, x: dx, y: dy } of paragraphs) canvas.drawParagraph(p, x + dx, top + dy);
			},
			delete: () => {
				for (const { p } of paragraphs) p.delete();
			},
		};
	}

	/** The measure `@decks/pen`'s layout takes, with this browser's fonts. A card's markdown is measured as it is drawn. */
	readonly measure: MeasureText = (text, style, maxWidth, node) => {
		if (node && isMarkdown(node)) {
			const md = this.markdown(text, style, { color: this.ck.BLACK, width: maxWidth ?? 240 });
			const h = md.height;
			md.delete();
			return { w: maxWidth ?? 240, h };
		}
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
