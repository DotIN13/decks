import type { Canvas, CanvasKit, Image, Paint, Paragraph, TypefaceFontProvider } from "canvaskit-wasm";
import type { TextStyle } from "@decks/pen";
import { highlight } from "./highlight.ts";
import type { Align, Alert, Block, Run } from "./markdown.ts";

/**
 * A card's markdown set on the canvas in the app's own hand (`markdown.ts` reads it).
 *
 * GitHub-flavoured in what it draws, Decks in how: the app's greys, hairlines and accent, light or
 * dark with the app (`index.css`), headings in Inter's semibold with no rules under them, a quote
 * behind a hairline bar, code on the app's tint in its monospace face, tables across the whole card
 * with a line under the header and between rows and nothing up the sides. Sizes are in units of the
 * card's font size: paragraphs at a line height of 1.5 with one size between blocks.
 *
 * A table wider than the card keeps its columns and scrolls sideways (`scrollers`): the offset is
 * the stage's to keep (`PenLayer.scrollBy`), and is handed in when the card is drawn.
 */

export interface MarkdownLayout {
	height: number;
	/** Every link's box from the layout's top-left, and the table it scrolls with, if any. */
	links: ReadonlyArray<{ x: number; y: number; w: number; h: number; href: string; scroller?: number }>;
	/** Each table too wide for the card: where it shows, and how wide it is. */
	scrollers: ReadonlyArray<{ x: number; y: number; w: number; h: number; content: number }>;
	/** Draw at `x y`; `scroll` gives each wide table's offset. */
	draw(canvas: Canvas, x: number, y: number, scroll?: (index: number) => number): void;
	delete(): void;
}

export interface MarkdownEnv {
	ck: CanvasKit;
	provider: TypefaceFontProvider;
	/** The families to try for a face, in order: it, then the fallbacks. */
	chain(family: string): string[];
	/** An image's picture once it has arrived; undefined asks for it. */
	image?(url: string): Image | undefined;
	mono: string;
	scheme: "light" | "dark";
}

/** The app's palette (`index.css`), light and dark. */
export const CARD_PALETTE = {
	light: { paper: "#ffffff", fg: "#161616", muted: "#5c5c5c", faint: "#808080", line: "#0000001a", strong: "#00000033", subtle: "#f2f2f2", code: "#0000000f", accent: "#3b5cf6", box: "#ffffff" },
	dark: { paper: "#242424", fg: "#fafafa", muted: "#aeaeae", faint: "#808080", line: "#ffffff1f", strong: "#ffffff3d", subtle: "#2e2e2e", code: "#ffffff14", accent: "#6f8bff", box: "#242424" },
} as const;
const ALERTS: Record<Alert, { light: string; dark: string; title: string }> = {
	note: { light: "#3b5cf6", dark: "#6f8bff", title: "Note" },
	tip: { light: "#2a9d52", dark: "#4cc97a", title: "Tip" },
	important: { light: "#7c4ddb", dark: "#a88bf0", title: "Important" },
	warning: { light: "#b7811b", dark: "#e7af36", title: "Warning" },
	caution: { light: "#d92e3c", dark: "#f06a74", title: "Caution" },
};
const HEADING_SIZE = [1.6, 1.3, 1.12, 1, 0.9, 0.85];

type Op =
	| { kind: "text"; p: Paragraph; x: number; y: number }
	| { kind: "box"; x: number; y: number; w: number; h: number; colour: string; r?: number }
	| { kind: "image"; image: Image; x: number; y: number; w: number; h: number }
	| { kind: "check"; x: number; y: number; size: number; checked: boolean }
	| { kind: "scroll"; index: number; x: number; y: number; w: number; h: number; content: number; ops: Op[] };

interface Frame {
	size: number;
	colour: string;
	weight: number;
	depth: number;
}

export function layoutMarkdown(env: MarkdownEnv, blocks: readonly Block[], style: TextStyle, width: number, align = "left"): MarkdownLayout {
	const { ck } = env;
	const C = CARD_PALETTE[env.scheme];
	const root: Op[] = [];
	/** Where ops go: the card, or the wide table being set. */
	let ops = root;
	let scroller: number | undefined;
	const links: Array<{ x: number; y: number; w: number; h: number; href: string; scroller?: number }> = [];
	const scrollers: Array<{ x: number; y: number; w: number; h: number; content: number }> = [];
	const paint = (hex: string) => {
		const n = parseInt(hex.slice(1), 16);
		const a = hex.length > 7 ? (n & 0xff) / 255 : 1;
		const rgb = hex.length > 7 ? n >>> 8 : n;
		return ck.Color4f(((rgb >> 16) & 0xff) / 255, ((rgb >> 8) & 0xff) / 255, (rgb & 0xff) / 255, a);
	};

	/** Runs set as one paragraph, laid out at `w`; its links are noted once it is placed. */
	const para = (runs: readonly Run[], f: Frame, w: number, options: { lineHeight?: number; align?: Align | string; size?: number; weight?: number } = {}) => {
		const size = options.size ?? f.size;
		const weight = options.weight ?? f.weight;
		const base = {
			color: paint(f.colour),
			fontFamilies: env.chain(style.fontFamily),
			fontSize: size,
			fontStyle: { weight: { value: weight }, slant: ck.FontSlant.Upright },
			letterSpacing: style.letterSpacing,
			heightMultiplier: style.lineHeight ?? options.lineHeight ?? 1.5,
			halfLeading: true,
		};
		const a = options.align ?? align;
		const paragraphStyle = new ck.ParagraphStyle({ textAlign: a === "center" ? ck.TextAlign.Center : a === "right" ? ck.TextAlign.Right : ck.TextAlign.Left, textStyle: base });
		const builder = ck.ParagraphBuilder.MakeFromFontProvider(paragraphStyle, env.provider);
		const ranges: Array<{ start: number; end: number; href: string }> = [];
		let at = 0;
		for (const run of runs.length ? runs : [{ text: " " }]) {
			const text = run.image ? `🖼 ${run.image.alt || "image"}` : run.text;
			builder.pushStyle(
				new ck.TextStyle({
					...base,
					color: paint(run.link || run.sup ? C.accent : run.image ? C.muted : f.colour),
					fontFamilies: env.chain(run.code ? env.mono : style.fontFamily),
					fontSize: run.sup ? size * 0.75 : run.code ? size * 0.88 : size,
					fontStyle: { weight: { value: run.bold ? Math.max(600, weight + 200) : weight }, slant: run.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright },
					...(run.strike ? { decoration: ck.LineThroughDecoration, decorationColor: paint(f.colour) } : {}),
					...(run.link ? { decoration: ck.UnderlineDecoration, decorationColor: paint(`${C.accent}66`) } : {}),
					...(run.code ? { backgroundColor: paint(C.code) } : {}),
				}),
			);
			builder.addText(text);
			builder.pop();
			if (run.link) ranges.push({ start: at, end: at + text.length, href: run.link });
			at += text.length;
		}
		const p = builder.build();
		builder.delete();
		p.layout(Math.max(1, w));
		const place = (x: number, y: number) => {
			ops.push({ kind: "text", p, x, y });
			for (const range of ranges) {
				for (const item of p.getRectsForRange(range.start, range.end, ck.RectHeightStyle.Tight, ck.RectWidthStyle.Tight) as unknown as Array<{ rect?: Float32Array } | Float32Array>) {
					const r = ("rect" in item && item.rect ? item.rect : item) as Float32Array;
					links.push({ x: x + r[0]!, y: y + r[1]!, w: r[2]! - r[0]!, h: r[3]! - r[1]!, href: range.href, ...(scroller !== undefined ? { scroller } : {}) });
				}
			}
			return p.getHeight();
		};
		return { p, place };
	};

	const roman = (n: number) => {
		const table: Array<[number, string]> = [[10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
		let out = "";
		for (const [value, letters] of table) while (n >= value) (out += letters), (n -= value);
		return out;
	};
	const marker = (ordered: boolean, n: number, depth: number) => {
		if (!ordered) return ["•", "◦", "▪"][Math.min(depth, 2)]!;
		if (depth === 0) return `${n}.`;
		if (depth === 1) return `${roman(n)}.`;
		return `${String.fromCharCode(96 + (((n - 1) % 26) + 1))}.`;
	};

	/** A list of blocks from `y`, `w` wide at `x`; answers where it ends. */
	const stack = (list: readonly Block[], x: number, y: number, w: number, f: Frame, gap: number): number => {
		list.forEach((block, i) => {
			if (i > 0) y += block.kind === "heading" ? Math.max(gap, f.size * 1.25) : gap;
			y = one(block, x, y, w, f);
		});
		return y;
	};

	const one = (block: Block, x: number, y: number, w: number, f: Frame): number => {
		switch (block.kind) {
			case "heading": {
				const size = f.size * HEADING_SIZE[block.level - 1]!;
				return y + para(block.runs, { ...f, colour: block.level >= 5 ? C.muted : f.colour }, w, { size, weight: 600, lineHeight: 1.3 }).place(x, y);
			}
			case "paragraph":
				return y + para(block.runs, f, w).place(x, y);
			case "image": {
				const image = env.image?.(block.url);
				if (image && image.width() > 0) {
					const iw = Math.min(w, image.width());
					const ih = (iw * image.height()) / image.width();
					ops.push({ kind: "image", image, x, y, w: iw, h: ih });
					return y + ih;
				}
				// Not here yet, or not reachable: its words, where it will be.
				const h = f.size * 3;
				ops.push({ kind: "box", x, y, w, h, colour: C.subtle, r: 8 });
				const words = para([{ text: `🖼 ${block.alt || block.url}` }], { ...f, colour: C.muted }, w - f.size * 2, { align: "center", size: f.size * 0.875 });
				words.place(x + f.size, y + (h - words.p.getHeight()) / 2);
				return y + h;
			}
			case "list": {
				const indent = f.size * 1.6;
				block.items.forEach((item, i) => {
					if (i > 0) y += block.loose ? f.size : f.size * 0.2;
					const top = y;
					if (item.checked !== undefined) {
						const size = f.size * 0.85;
						ops.push({ kind: "check", x: x + indent - size - f.size * 0.45, y: top + (f.size * 1.5 - size) / 2, size, checked: item.checked });
					} else {
						para([{ text: marker(block.ordered, block.start + i, f.depth) }], { ...f, colour: C.muted }, indent - f.size * 0.4, { align: "right" }).place(x, top);
					}
					y = stack(item.blocks, x + indent, y, w - indent, { ...f, depth: f.depth + 1 }, block.loose ? f.size : 0);
				});
				return y;
			}
			case "quote": {
				const bar = 2;
				const alert = block.alert ? ALERTS[block.alert] : undefined;
				const accent = alert?.[env.scheme];
				const pad = alert ? f.size * 0.4 : 0;
				const inset = bar + f.size * 0.9;
				const top = y;
				y += pad;
				if (alert) {
					y += para([{ text: alert.title }], { ...f, colour: accent! }, w - inset, { weight: 600 }).place(x + inset, y);
					if (block.blocks.length) y += f.size * 0.3;
				}
				y = stack(block.blocks, x + inset, y, w - inset, { ...f, colour: alert ? f.colour : C.muted }, f.size);
				y += pad;
				ops.push({ kind: "box", x, y: top, w: bar, h: Math.max(1, y - top), colour: accent ?? C.strong, r: 1 });
				return y;
			}
			case "code": {
				const pad = f.size * 0.85;
				const coloured = colouredCode(highlight(block.text.replace(/\n$/, ""), block.lang, env.scheme), f.size * 0.88, w - pad * 2);
				const h = coloured.getHeight() + pad * 2;
				ops.push({ kind: "box", x, y, w, h, colour: C.subtle, r: 8 }, { kind: "text", p: coloured, x: x + pad, y: y + pad });
				return y + h;
			}
			case "table":
				return table(block, x, y, w, f);
			case "rule":
				ops.push({ kind: "box", x, y: y + f.size * 0.5, w, h: 1, colour: C.line });
				return y + f.size + 1;
			case "footnotes": {
				ops.push({ kind: "box", x, y, w, h: 1, colour: C.line });
				y += f.size * 0.75;
				const small = { ...f, size: f.size * 0.875, colour: C.muted };
				const indent = small.size * 1.6;
				block.items.forEach((item, i) => {
					if (i > 0) y += small.size * 0.2;
					para([{ text: `${item.number}.` }], small, indent - small.size * 0.4, { align: "right" }).place(x, y);
					y = stack(item.blocks, x + indent, y, w - indent, small, 0);
				});
				return y;
			}
		}
	};

	/** Code set in the monospace face, each run in its colour. */
	const colouredCode = (runs: ReturnType<typeof highlight>, size: number, w: number): Paragraph => {
		const base = { color: paint(C.fg), fontFamilies: env.chain(env.mono), fontSize: size, heightMultiplier: 1.5, halfLeading: true };
		const builder = ck.ParagraphBuilder.MakeFromFontProvider(new ck.ParagraphStyle({ textAlign: ck.TextAlign.Left, textStyle: base }), env.provider);
		for (const run of runs.length ? runs : [{ text: " " }]) {
			builder.pushStyle(new ck.TextStyle({ ...base, color: paint(run.colour ?? C.fg), fontStyle: { weight: { value: run.bold ? 700 : 400 }, slant: run.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright } }));
			builder.addText(run.text || " ");
			builder.pop();
		}
		const p = builder.build();
		builder.delete();
		p.layout(Math.max(1, w));
		return p;
	};

	/**
	 * A table, as wide as the card: its columns share the width in proportion to what they hold, a
	 * line under the header and a hairline between rows, none up the sides. Wider than the card, the
	 * columns keep the width their words need and the table scrolls sideways inside the card's edge.
	 */
	const table = (block: Extract<Block, { kind: "table" }>, x: number, y: number, w: number, f: Frame): number => {
		const padX = f.size * 0.75;
		const padY = f.size * 0.45;
		const rows = [block.header, ...block.rows];
		const columns = Math.max(...rows.map((row) => row.length));
		// The outer edges sit flush with the card's words: no padding outside the first and last column.
		const left = (c: number) => (c === 0 ? 0 : padX);
		const pads = (c: number) => left(c) + (c === columns - 1 ? 0 : padX);
		const header = { ...f, colour: C.muted };
		const cellOptions = (r: number, c: number) => ({ weight: r === 0 ? 600 : f.weight, size: r === 0 ? f.size * 0.9 : f.size, align: block.align[c] ?? "left" });
		const natural = Array.from({ length: columns }, (_, c) =>
			Math.max(
				f.size * 2 + pads(c),
				...rows.map((row, r) => {
					const probe = para(row[c] ?? [], r === 0 ? header : f, 1e5, cellOptions(r, c));
					const width = Math.ceil(probe.p.getMaxIntrinsicWidth()) + 1;
					probe.p.delete();
					// A long cell wraps rather than make its column wider than about two thirds of a card.
					return Math.min(width, Math.max(f.size * 16, w * 0.66)) + pads(c);
				}),
			),
		);
		const total = natural.reduce((sum, value) => sum + value, 0);
		const widths = total < w ? natural.map((value) => (value * w) / total) : natural;
		const content = Math.max(w, widths.reduce((sum, value) => sum + value, 0));
		const scrolls = content > w + 0.5;
		const outer = ops;
		const own: Op[] = [];
		const index = scrollers.length;
		if (scrolls) {
			ops = own;
			scroller = index;
		}
		const top = y;
		rows.forEach((row, r) => {
			const cells = widths.map((cw, c) => para(row[c] ?? [], r === 0 ? header : f, cw - pads(c), cellOptions(r, c)));
			const h = Math.max(...cells.map((cell) => cell.p.getHeight())) + padY * 2;
			let cx = x;
			cells.forEach((cell, c) => {
				cell.place(cx + left(c), y + padY);
				cx += widths[c]!;
			});
			y += h;
			// A line under the header and a hairline between rows; none after the last.
			if (r < rows.length - 1) ops.push({ kind: "box", x, y: y - 0.5, w: content, h: 1, colour: r === 0 ? C.strong : C.line });
		});
		if (scrolls) {
			ops = outer;
			scroller = undefined;
			// Room under a wide table for the bar that says it scrolls.
			const bar = f.size * 0.6;
			scrollers.push({ x, y: top, w, h: y - top + bar, content });
			ops.push({ kind: "scroll", index, x, y: top, w, h: y - top + bar, content, ops: own });
			y += bar;
		}
		return y;
	};

	const height = stack(blocks, 0, 0, width, { size: style.fontSize, colour: C.fg, weight: style.fontWeight, depth: 0 }, style.fontSize);

	const drawOps = (canvas: Canvas, list: readonly Op[], x: number, y: number, fill: Paint, scroll: (index: number) => number) => {
		for (const op of list) {
			switch (op.kind) {
				case "text":
					canvas.drawParagraph(op.p, x + op.x, y + op.y);
					break;
				case "box":
					fill.setStyle(ck.PaintStyle.Fill);
					fill.setColor(paint(op.colour));
					canvas.drawRRect(ck.RRectXY(ck.XYWHRect(x + op.x, y + op.y, op.w, op.h), op.r ?? 0, op.r ?? 0), fill);
					break;
				case "image":
					canvas.drawImageRect(op.image, ck.XYWHRect(0, 0, op.image.width(), op.image.height()), ck.XYWHRect(x + op.x, y + op.y, op.w, op.h), fill);
					break;
				case "scroll": {
					const max = op.content - op.w;
					const offset = Math.max(0, Math.min(max, scroll(op.index)));
					canvas.save();
					canvas.clipRect(ck.XYWHRect(x + op.x, y + op.y, op.w, op.h), ck.ClipOp.Intersect, true);
					drawOps(canvas, op.ops, x - offset, y, fill, scroll);
					canvas.restore();
					// The bar: how much of the table shows, and where along it the view is.
					const thumb = Math.max(24, (op.w / op.content) * op.w);
					const at = max > 0 ? (offset / max) * (op.w - thumb) : 0;
					fill.setStyle(ck.PaintStyle.Fill);
					fill.setColor(paint(C.line));
					canvas.drawRRect(ck.RRectXY(ck.XYWHRect(x + op.x, y + op.y + op.h - 3, op.w, 3), 1.5, 1.5), fill);
					fill.setColor(paint(C.faint));
					canvas.drawRRect(ck.RRectXY(ck.XYWHRect(x + op.x + at, y + op.y + op.h - 3, thumb, 3), 1.5, 1.5), fill);
					break;
				}
				case "check": {
					const rect = ck.RRectXY(ck.XYWHRect(x + op.x, y + op.y, op.size, op.size), op.size * 0.25, op.size * 0.25);
					fill.setStyle(ck.PaintStyle.Fill);
					fill.setColor(paint(op.checked ? C.accent : C.box));
					canvas.drawRRect(rect, fill);
					if (!op.checked) {
						fill.setStyle(ck.PaintStyle.Stroke);
						fill.setStrokeWidth(1);
						fill.setColor(paint(C.strong));
						canvas.drawRRect(rect, fill);
					} else {
						const s = op.size;
						const builder = new ck.PathBuilder();
						builder.moveTo(x + op.x + s * 0.26, y + op.y + s * 0.52);
						builder.lineTo(x + op.x + s * 0.43, y + op.y + s * 0.69);
						builder.lineTo(x + op.x + s * 0.75, y + op.y + s * 0.33);
						const path = builder.detachAndDelete();
						fill.setStyle(ck.PaintStyle.Stroke);
						fill.setColor(paint("#ffffff"));
						fill.setStrokeWidth(s * 0.14);
						fill.setStrokeCap(ck.StrokeCap.Round);
						fill.setStrokeJoin(ck.StrokeJoin.Round);
						canvas.drawPath(path, fill);
						path.delete();
					}
					break;
				}
			}
		}
	};

	const allText = (list: readonly Op[]): Paragraph[] => list.flatMap((op) => (op.kind === "text" ? [op.p] : op.kind === "scroll" ? allText(op.ops) : []));
	return {
		height,
		links,
		scrollers,
		draw(canvas, x, y, scroll = () => 0) {
			const fill = new ck.Paint();
			fill.setAntiAlias(true);
			drawOps(canvas, root, x, y, fill, scroll);
			fill.delete();
		},
		delete() {
			for (const p of allText(root)) p.delete();
		},
	};
}
