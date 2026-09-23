import type { Canvas, CanvasKit, Image, Paragraph, TypefaceFontProvider } from "canvaskit-wasm";
import type { TextStyle } from "@decks/pen";
import { highlight } from "./highlight.ts";
import type { Align, Alert, Block, Run } from "./markdown.ts";

/**
 * A card's markdown set on the canvas the way GitHub sets it (`markdown.ts` reads it).
 *
 * GitHub's own measures, in units of the card's font size: paragraphs at a line height of 1.5 with
 * one size between blocks, headings from 2 down to 0.85 with a rule under the first two, lists
 * indented by two sizes with •, ◦ and ▪ or 1., i. and a., quotes behind a bar, code on a tint in a
 * monospace face and GitHub's colours, tables with ruled cells and every other row tinted, images
 * as wide as the card allows. Each block is its own paragraph, placed downwards; the result can be
 * drawn anywhere and says where its links are, so a press on one can follow it.
 */

export interface MarkdownLayout {
	height: number;
	/** Every link's box, from the layout's top-left corner. */
	links: ReadonlyArray<{ x: number; y: number; w: number; h: number; href: string }>;
	draw(canvas: Canvas, x: number, y: number): void;
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
}

const GH = { fg: "#1f2328", muted: "#59636e", border: "#d1d9e0", subtle: "#f6f8fa", link: "#0969da", code: "#818b981f" };
const ALERTS: Record<Alert, { colour: string; title: string }> = {
	note: { colour: "#0969da", title: "Note" },
	tip: { colour: "#1a7f37", title: "Tip" },
	important: { colour: "#8250df", title: "Important" },
	warning: { colour: "#9a6700", title: "Warning" },
	caution: { colour: "#d1242f", title: "Caution" },
};
const HEADING_SIZE = [2, 1.5, 1.25, 1, 0.875, 0.85];

type Op =
	| { kind: "text"; p: Paragraph; x: number; y: number }
	| { kind: "box"; x: number; y: number; w: number; h: number; colour: string; r?: number; line?: boolean }
	| { kind: "image"; image: Image; x: number; y: number; w: number; h: number }
	| { kind: "check"; x: number; y: number; size: number; checked: boolean };

interface Frame {
	size: number;
	colour: string;
	weight: number;
	depth: number;
}

export function layoutMarkdown(env: MarkdownEnv, blocks: readonly Block[], style: TextStyle, width: number, align = "left"): MarkdownLayout {
	const { ck } = env;
	const ops: Op[] = [];
	const links: Array<{ x: number; y: number; w: number; h: number; href: string }> = [];
	const paint = (hex: string) => {
		const n = parseInt(hex.slice(1), 16);
		const a = hex.length > 7 ? (n & 0xff) / 255 : 1;
		const rgb = hex.length > 7 ? n >>> 8 : n;
		return ck.Color4f(((rgb >> 16) & 0xff) / 255, ((rgb >> 8) & 0xff) / 255, (rgb & 0xff) / 255, a);
	};

	/** Runs set as one paragraph, laid out at `w`; its links are noted once it is placed. */
	const para = (runs: readonly Run[], f: Frame, w: number, options: { lineHeight?: number; align?: Align | string; size?: number; weight?: number; mono?: boolean } = {}) => {
		const size = options.size ?? f.size;
		const lineHeight = style.lineHeight ?? options.lineHeight ?? 1.5;
		const base = {
			color: paint(f.colour),
			fontFamilies: env.chain(options.mono ? env.mono : style.fontFamily),
			fontSize: size,
			fontStyle: { weight: { value: options.weight ?? f.weight }, slant: ck.FontSlant.Upright },
			letterSpacing: options.mono ? 0 : style.letterSpacing,
			heightMultiplier: lineHeight,
			halfLeading: true,
		};
		const a = options.align ?? align;
		const paragraphStyle = new ck.ParagraphStyle({ textAlign: a === "center" ? ck.TextAlign.Center : a === "right" ? ck.TextAlign.Right : ck.TextAlign.Left, textStyle: base });
		const builder = ck.ParagraphBuilder.MakeFromFontProvider(paragraphStyle, env.provider);
		const ranges: Array<{ start: number; end: number; href: string }> = [];
		let at = 0;
		for (const run of runs.length ? runs : [{ text: " " }]) {
			const text = run.image ? `🖼 ${run.image.alt || "image"}` : run.text;
			const code = run.code || options.mono;
			builder.pushStyle(
				new ck.TextStyle({
					...base,
					color: paint(run.link || run.sup ? GH.link : run.image ? GH.muted : f.colour),
					fontFamilies: env.chain(code ? env.mono : style.fontFamily),
					fontSize: run.sup ? size * 0.75 : run.code && !options.mono ? size * 0.85 : size,
					fontStyle: { weight: { value: run.bold ? Math.max(600, (options.weight ?? f.weight) + 200) : (options.weight ?? f.weight) }, slant: run.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright },
					...(run.strike ? { decoration: ck.LineThroughDecoration, decorationColor: paint(f.colour) } : {}),
					...(run.code && !options.mono ? { backgroundColor: paint(GH.code) } : {}),
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
					links.push({ x: x + r[0]!, y: y + r[1]!, w: r[2]! - r[0]!, h: r[3]! - r[1]!, href: range.href });
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
			if (i > 0) y += block.kind === "heading" ? Math.max(gap, f.size * 1.5) : gap;
			y = one(block, x, y, w, f);
		});
		return y;
	};

	const one = (block: Block, x: number, y: number, w: number, f: Frame): number => {
		switch (block.kind) {
			case "heading": {
				const size = f.size * HEADING_SIZE[block.level - 1]!;
				y += para(block.runs, { ...f, colour: block.level === 6 ? GH.muted : f.colour }, w, { size, weight: 600, lineHeight: 1.25 }).place(x, y);
				if (block.level <= 2) {
					y += size * 0.3;
					ops.push({ kind: "box", x, y, w, h: 1, colour: GH.border });
					y += 1;
				}
				return y;
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
				ops.push({ kind: "box", x, y, w, h, colour: GH.subtle, r: 6 });
				const words = para([{ text: `🖼 ${block.alt || block.url}` }], { ...f, colour: GH.muted }, w - f.size * 2, { align: "center", size: f.size * 0.875 });
				words.place(x + f.size, y + (h - words.p.getHeight()) / 2);
				return y + h;
			}
			case "list": {
				const indent = f.size * 2;
				block.items.forEach((item, i) => {
					if (i > 0) y += block.loose ? f.size : f.size * 0.25;
					const top = y;
					const inner = { ...f, depth: f.depth + 1 };
					if (item.checked !== undefined) {
						const size = f.size * 0.9;
						ops.push({ kind: "check", x: x + indent - size - f.size * 0.45, y: top + (f.size * 1.5 - size) / 2, size, checked: item.checked });
					} else {
						const mark = para([{ text: marker(block.ordered, block.start + i, f.depth) }], f, indent - f.size * 0.4, { align: "right" });
						mark.place(x, top);
					}
					y = stack(item.blocks, x + indent, y, w - indent, inner, block.loose ? f.size : 0);
				});
				return y;
			}
			case "quote": {
				const bar = f.size * 0.25;
				const alert = block.alert ? ALERTS[block.alert] : undefined;
				const pad = alert ? f.size * 0.5 : 0;
				const top = y;
				y += pad;
				const inner = { ...f, colour: alert ? f.colour : GH.muted };
				if (alert) {
					y += para([{ text: alert.title }], { ...f, colour: alert.colour }, w - bar - f.size, { weight: 600 }).place(x + bar + f.size, y);
					if (block.blocks.length) y += f.size * 0.5;
				}
				y = stack(block.blocks, x + bar + f.size, y, w - bar - f.size, inner, f.size);
				y += pad;
				ops.push({ kind: "box", x, y: top, w: bar, h: Math.max(1, y - top), colour: alert?.colour ?? GH.border });
				return y;
			}
			case "code": {
				const pad = f.size;
				const size = f.size * 0.85;
				const runs = highlight(block.text.replace(/\n$/, ""), block.lang);
				const coloured = colouredCode(runs, size, w - pad * 2);
				const h = coloured.getHeight() + pad * 2;
				ops.push({ kind: "box", x, y, w, h, colour: GH.subtle, r: 6 }, { kind: "text", p: coloured, x: x + pad, y: y + pad });
				return y + h;
			}
			case "table":
				return table(block, x, y, w, f);
			case "rule": {
				const h = f.size * 0.25;
				y += f.size * 0.5;
				ops.push({ kind: "box", x, y, w, h, colour: GH.border });
				return y + h + f.size * 0.5;
			}
			case "footnotes": {
				ops.push({ kind: "box", x, y, w, h: 1, colour: GH.border });
				y += f.size;
				const small = { ...f, size: f.size * 0.875, colour: GH.muted };
				const indent = small.size * 2;
				block.items.forEach((item, i) => {
					if (i > 0) y += small.size * 0.25;
					para([{ text: `${item.number}.` }], small, indent - small.size * 0.4, { align: "right" }).place(x, y);
					y = stack(item.blocks, x + indent, y, w - indent, small, 0);
				});
				return y;
			}
		}
	};

	/** Code set in the monospace face, each run in its colour from GitHub's theme. */
	const colouredCode = (runs: ReturnType<typeof highlight>, size: number, w: number): Paragraph => {
		const base = { color: paint(GH.fg), fontFamilies: env.chain(env.mono), fontSize: size, heightMultiplier: 1.45, halfLeading: true };
		const builder = ck.ParagraphBuilder.MakeFromFontProvider(new ck.ParagraphStyle({ textAlign: ck.TextAlign.Left, textStyle: base }), env.provider);
		for (const run of runs.length ? runs : [{ text: " " }]) {
			builder.pushStyle(new ck.TextStyle({ ...base, color: paint(run.colour ?? GH.fg), fontStyle: { weight: { value: run.bold ? 700 : 400 }, slant: run.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright } }));
			builder.addText(run.text || " ");
			builder.pop();
		}
		const p = builder.build();
		builder.delete();
		p.layout(Math.max(1, w));
		return p;
	};

	/**
	 * A table: each column as wide as its widest cell when the card has the room, and shrunk in
	 * proportion when it does not, never below a few words; cells wrap, and a row is as tall as its
	 * tallest cell. Ruled like GitHub's, with the header bold and every other row tinted.
	 */
	const table = (block: Extract<Block, { kind: "table" }>, x: number, y: number, w: number, f: Frame): number => {
		const padX = f.size * 0.8;
		const padY = f.size * 0.4;
		const rows = [block.header, ...block.rows];
		const columns = Math.max(...rows.map((row) => row.length));
		const natural = Array.from({ length: columns }, (_, c) =>
			Math.max(
				f.size * 2,
				...rows.map((row, r) => {
					const probe = para(row[c] ?? [], f, 1e5, { weight: r === 0 ? 600 : f.weight });
					const width = Math.ceil(probe.p.getMaxIntrinsicWidth());
					probe.p.delete();
					return width + padX * 2;
				}),
			),
		);
		const total = natural.reduce((sum, value) => sum + value, 0);
		const floor = f.size * 4;
		let widths = natural;
		if (total > w) {
			widths = natural.map((value) => Math.max(Math.min(value, floor), (value * w) / total));
			const over = widths.reduce((sum, value) => sum + value, 0) / w;
			widths = widths.map((value) => value / over);
		}
		const tableW = widths.reduce((sum, value) => sum + value, 0);
		const lines: Op[] = [];
		rows.forEach((row, r) => {
			const cells = widths.map((cw, c) => para(row[c] ?? [], f, cw - padX * 2, { weight: r === 0 ? 600 : f.weight, align: block.align[c] ?? "left" }));
			const h = Math.max(...cells.map((cell) => cell.p.getHeight())) + padY * 2;
			if (r > 0 && r % 2 === 0) ops.push({ kind: "box", x, y, w: tableW, h, colour: GH.subtle });
			let cx = x;
			cells.forEach((cell, c) => {
				cell.place(cx + padX, y + padY);
				lines.push({ kind: "box", x: cx, y, w: widths[c]!, h, colour: GH.border, line: true });
				cx += widths[c]!;
			});
			y += h;
		});
		ops.push(...lines);
		return y;
	};

	const height = stack(blocks, 0, 0, width, { size: style.fontSize, colour: GH.fg, weight: style.fontWeight, depth: 0 }, style.fontSize);
	return {
		height,
		links,
		draw(canvas, x, y) {
			const fill = new ck.Paint();
			fill.setAntiAlias(true);
			for (const op of ops) {
				switch (op.kind) {
					case "text":
						canvas.drawParagraph(op.p, x + op.x, y + op.y);
						break;
					case "box":
						fill.setColor(paint(op.colour));
						fill.setStyle(op.line ? ck.PaintStyle.Stroke : ck.PaintStyle.Fill);
						fill.setStrokeWidth(1);
						if (op.line) canvas.drawRect(ck.XYWHRect(x + op.x + 0.5, y + op.y + 0.5, op.w, op.h), fill);
						else canvas.drawRRect(ck.RRectXY(ck.XYWHRect(x + op.x, y + op.y, op.w, op.h), op.r ?? 0, op.r ?? 0), fill);
						break;
					case "image":
						canvas.drawImageRect(op.image, ck.XYWHRect(0, 0, op.image.width(), op.image.height()), ck.XYWHRect(x + op.x, y + op.y, op.w, op.h), fill);
						break;
					case "check": {
						const rect = ck.RRectXY(ck.XYWHRect(x + op.x, y + op.y, op.size, op.size), op.size * 0.2, op.size * 0.2);
						fill.setStyle(ck.PaintStyle.Fill);
						fill.setColor(paint(op.checked ? GH.link : "#ffffff"));
						canvas.drawRRect(rect, fill);
						fill.setStyle(ck.PaintStyle.Stroke);
						fill.setStrokeWidth(1);
						fill.setColor(paint(op.checked ? GH.link : "#818b98"));
						canvas.drawRRect(rect, fill);
						if (op.checked) {
							const s = op.size;
							const builder = new ck.PathBuilder();
							builder.moveTo(x + op.x + s * 0.25, y + op.y + s * 0.52);
							builder.lineTo(x + op.x + s * 0.43, y + op.y + s * 0.7);
							builder.lineTo(x + op.x + s * 0.77, y + op.y + s * 0.32);
							const path = builder.detachAndDelete();
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
			fill.delete();
		},
		delete() {
			for (const op of ops) if (op.kind === "text") op.p.delete();
		},
	};
}
