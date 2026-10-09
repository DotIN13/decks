import { CARD, isCard, MARKDOWN, MEDIA, type Op, type PenNode } from "@decks/pen";
import type { Tokens } from "marked";
import { cardMarked, sizedAlt, toObsidian, type WikiToken } from "./card-syntax.ts";

/**
 * A card as a frame of items (`@decks/pen`, `CARD`), and as the one piece of markdown it reads as.
 *
 * Each top-level block of the card's markdown is a child of its own: a heading, a paragraph, a list,
 * a callout or a table is a markdown text item; a picture alone on its line is pen's rectangle filled
 * with the image. Anything else a person drops in (a sticky note, a shape) is kept as it is and stands
 * in the markdown as a placeholder the editor shows and never types into.
 *
 * The editor works on the markdown (`cardMarkdown`) and hands it back (`cardChildren`), which reuses
 * the children it can: a block whose markdown did not change is the very same item, and one that did
 * keeps its id, so an edit to one line writes one item.
 */

/**
 * A card's words, gap and padding. The words are 16 px, set on each block so pen.dev shows them at
 * that size too; the gap between blocks is one size of them, as between paragraphs within a block, so
 * the card and its editor space the blocks alike.
 */
export const CARD_FONT = 16;
export const CARD_GAP = 16;
export const CARD_PAD = 20;
export const CARD_WIDTH = 320;
export const CARD_RADIUS = 12;

/** A new card, as the card tool makes it: a column holding one empty block. */
export function newCard(id: string, child: string): PenNode {
	return { type: "frame", id, name: "Card", layout: "vertical", gap: CARD_GAP, padding: CARD_PAD, cornerRadius: CARD_RADIUS, metadata: { type: CARD }, children: [markdownText(child, "")] } as PenNode;
}

/** One block of a card: pen's text, as wide as the card, its words markdown. */
export function markdownText(id: string, content: string): PenNode {
	return { type: "text", id, content, fontSize: CARD_FONT, textGrowth: "fixed-width", width: "fill_container", metadata: { type: MARKDOWN } } as PenNode;
}

/**
 * A file in the deck, as a piece: pen's own frame holding an icon and the file's name, marked
 * `metadata: { type: "decks.file", path }`, so pen.dev shows a chip and a card writes `![[path]]`.
 */
export const FILE = "decks.file";
export const isFile = (node: PenNode | undefined) => node?.type === "frame" && node.metadata?.type === FILE;
export function fileItem(path: string, fresh: () => string): PenNode {
	const name = path.split("/").pop() || path;
	return {
		type: "frame", id: fresh(), name, layout: "horizontal", gap: 8, padding: [8, 12], alignItems: "center", cornerRadius: 8, fill: "#8080801f",
		metadata: { type: FILE, path },
		children: [
			{ type: "icon", id: fresh(), library: "lucide", icon: /\.(mp4|mov|webm|mp3|wav|m4a|ogg)$/i.test(path) ? "file-video" : "file-text", width: 16, height: 16, fill: "#808080" },
			{ type: "text", id: fresh(), content: name, fontSize: 14, fill: "#808080" },
		],
	} as PenNode;
}

/** What a file card says it is, and the colour of its tile: by extension, as the file picker sorts files. */
export function fileKind(path: string): { label: string; icon: string; tone: string } {
	const extension = (path.split(".").pop() ?? "").toLowerCase();
	if (extension === "pdf") return { label: "PDF", icon: "file-text", tone: "#d92e3c" };
	if (extension === "svg") return { label: "SVG", icon: "file-image", tone: "#c46a00" };
	if (extension === "html" || extension === "htm") return { label: "Web page", icon: "globe", tone: "#2f6fde" };
	if (["xlsx", "xls", "ods", "numbers", "csv", "tsv"].includes(extension)) return { label: extension === "csv" || extension === "tsv" ? "Table" : "Spreadsheet", icon: "file-spreadsheet", tone: "#13895c" };
	if (["pptx", "ppt", "key", "odp"].includes(extension)) return { label: "Presentation", icon: "presentation", tone: "#c46a00" };
	if (["zip", "tar", "gz", "tgz", "7z", "rar"].includes(extension)) return { label: "Archive", icon: "file-archive", tone: "#6b7280" };
	return { label: extension ? extension.toUpperCase() : "File", icon: "file", tone: "#6b7280" };
}

/** How wide a file card is on the canvas, in stage pixels. */
export const FILE_CARD_W = 320;

/**
 * A file on the canvas as an item of its own, the way a file looks in a file browser: a picture of
 * it on top (a PDF's first page, an SVG, a web page as it opens), and under it a tile with its
 * kind's icon, its name and what it is. pen's own frames, rectangle, icon and text, marked as a
 * file (`FILE`), so pen.dev shows the same card, and a click opens the file (`Stage.tsx`).
 */
export function fileCard(path: string, fresh: () => string, facts: { preview?: string; w?: number; h?: number; pages?: number; title?: string; url?: (path: string) => string } = {}): PenNode {
	const name = path.split("/").pop() || path;
	const kind = fileKind(path);
	const sub = [kind.label, facts.pages ? `${facts.pages} ${facts.pages === 1 ? "page" : "pages"}` : "", facts.title && facts.title !== name ? facts.title : ""].filter(Boolean).join(", ");
	const tall = facts.w && facts.h ? Math.round(Math.min(420, (FILE_CARD_W * facts.h) / Math.max(1, facts.w))) : 0;
	return {
		type: "frame", id: fresh(), name, layout: "vertical", gap: 0, padding: 0, width: FILE_CARD_W, cornerRadius: 12, clip: true, fill: "#ffffff", stroke: "#0000001f", strokeWidth: 1,
		effect: { type: "shadow", shadowType: "outer", offset: { x: 0, y: 2 }, blur: 10, spread: 0, color: "#0000001a" },
		metadata: { type: FILE, path, ...(facts.preview ? { preview: facts.preview } : {}) },
		children: [
			...(facts.preview && tall ? [{ type: "rectangle", id: fresh(), name: "Preview", width: "fill_container", height: tall, fill: { type: "image", url: facts.url ? facts.url(facts.preview) : facts.preview, mode: "fill" } }] : []),
			{
				type: "frame", id: fresh(), name: "Label", layout: "horizontal", gap: 10, padding: [10, 12], alignItems: "center", width: "fill_container", ...(tall ? { stroke: "#00000014", strokeWidth: { top: 1 } } : {}),
				children: [
					{ type: "frame", id: fresh(), name: "Kind", width: 30, height: 30, cornerRadius: 7, fill: `${kind.tone}21`, layout: "horizontal", justifyContent: "center", alignItems: "center", children: [{ type: "icon", id: fresh(), library: "lucide", icon: kind.icon, width: 16, height: 16, fill: kind.tone }] },
					{
						type: "frame", id: fresh(), name: "Words", layout: "vertical", gap: 2, width: "fill_container",
						children: [
							{ type: "text", id: fresh(), content: name, fontSize: 14, fontWeight: "600", fill: "#1f2328", textGrowth: "fixed-width", width: "fill_container" },
							{ type: "text", id: fresh(), content: sub, fontSize: 12, fill: "#6b7280", textGrowth: "fixed-width", width: "fill_container" },
						],
					},
				],
			},
		],
	} as PenNode;
}

/**
 * An SVG shown live on the canvas, as itself, animations and all. In the stage file it is pen's own
 * rectangle filled with a picture of the file the server made, marked `decks.live-file` with the
 * file's deck path, so pen.dev and a zoomed-out canvas show the still, and the stage puts the real
 * image under a hole in the sheet where it is (`Stage.tsx`, file items). A web page is a board.
 */
export const LIVE_FILE = "decks.live-file";
export const isLiveFile = (node: PenNode | undefined) => node?.metadata?.type === LIVE_FILE;
/** How wide an SVG lands on the canvas. */
export const LIVE_SVG_W = 480;

export function liveFileItem(path: string, fresh: () => string, facts: { still?: string; w?: number; h?: number; url: (deckPath: string) => string }): PenNode {
	const name = path.split("/").pop() || path;
	const metadata = { type: LIVE_FILE, kind: "svg", file: path, ...(facts.still ? { still: facts.still } : {}) };
	const w = LIVE_SVG_W;
	const h = facts.w && facts.h ? Math.round((w * facts.h) / Math.max(1, facts.w)) : w;
	return { type: "rectangle", id: fresh(), name, width: w, height: h, ...(facts.still ? { fill: { type: "image", url: facts.url(facts.still), mode: "fill" } } : {}), metadata } as PenNode;
}

const PLACEHOLDER = /^<!--decks:item (\S+)-->$/;
const placeholder = (id: string) => `<!--decks:item ${id}-->`;

/** A child's markdown: its words, a picture as Obsidian writes one, anything else as a placeholder. */
export function childMarkdown(node: PenNode): string {
	if (node.type === "text" && typeof node.content === "string") return node.content;
	// A file, or a film or a sound, is embedded as Obsidian embeds one.
	if (isFile(node) && typeof node.metadata?.path === "string") return `![[${node.metadata.path}]]`;
	if (node.metadata?.type === MEDIA && typeof node.metadata.file === "string") return `![[${node.metadata.file}]]`;
	const fill = node.type === "rectangle" ? (node.fill as { type?: string; url?: string } | undefined) : undefined;
	if (fill?.type === "image" && fill.url) {
		const width = typeof node.width === "number" ? `|${Math.round(node.width)}` : "";
		return `![${String(node.name ?? "").replace(/[[\]|]/g, "")}${width}](${fill.url})`;
	}
	return placeholder(node.id);
}

/** The card as one piece of markdown, its blocks a blank line apart. */
export function cardMarkdown(children: readonly PenNode[]): string {
	return children
		.map(childMarkdown)
		.filter((text) => text.trim())
		.join("\n\n");
}

export interface ChildrenOptions {
	/** A fresh id that no item on the stage has. */
	fresh(): string;
	/** A picture's own size, when it is known. */
	size?(url: string): { w: number; h: number } | undefined;
	/** How wide the card's words are: a picture is never wider. */
	inner: number;
}

/**
 * The children a card's markdown stands for, reusing `previous` where it can: the same item for a
 * block that did not change, the same id for one that did, a fresh one for a block that is new.
 */
export function cardChildren(markdown: string, previous: readonly PenNode[], options: ChildrenOptions): PenNode[] {
	const blocks = cardMarked()
		.lexer(markdown)
		.filter((token) => token.type !== "space")
		.map((token) => ({ token, raw: token.raw.replace(/\n+$/, "") }))
		.filter((block) => block.raw.trim());
	const byId = new Map(previous.map((node) => [node.id, node]));
	const byMarkdown = new Map<string, PenNode[]>();
	for (const node of previous) {
		const key = childMarkdown(node);
		byMarkdown.set(key, [...(byMarkdown.get(key) ?? []), node]);
	}
	const used = new Set<string>();
	const take = (node: PenNode | undefined) => {
		if (!node || used.has(node.id)) return undefined;
		used.add(node.id);
		return node;
	};
	// First every block that is exactly as it was: the item itself, untouched.
	const kept = blocks.map((block) => {
		const held = PLACEHOLDER.exec(block.raw);
		if (held) return take(byId.get(held[1]!));
		return take(byMarkdown.get(block.raw)?.find((node) => !used.has(node.id)));
	});
	// Then the changed ones take the ids of the texts that are gone, in order; the rest are new.
	const spare = previous.filter((node) => node.type === "text" && !used.has(node.id));
	return blocks.flatMap((block, i) => {
		if (kept[i]) return [kept[i]!];
		if (PLACEHOLDER.test(block.raw)) return []; // an item that is no longer on the stage
		const file = fileOf(block.token as Tokens.Paragraph);
		if (file) return [fileItem(file, options.fresh)];
		const picture = pictureOf(block.token as Tokens.Paragraph);
		if (picture) {
			const natural = options.size?.(picture.url);
			const w = Math.max(24, Math.min(options.inner, picture.width ?? natural?.w ?? options.inner));
			const h = Math.round(natural ? (w * natural.h) / Math.max(1, natural.w) : w * 0.5625);
			return [{ type: "rectangle", id: options.fresh(), name: picture.alt, cornerRadius: 6, width: Math.round(w), height: h, fill: { type: "image", url: picture.url, mode: "fill" } } as PenNode];
		}
		const reuse = spare.shift();
		if (reuse) used.add(reuse.id);
		return [reuse ? { ...reuse, content: block.raw } : markdownText(options.fresh(), block.raw)];
	});
}

/** A paragraph that is only `![[a file]]` that is not a picture: the file's path. */
function fileOf(token: Tokens.Paragraph): string | undefined {
	if (token.type !== "paragraph") return undefined;
	const real = (token.tokens ?? []).filter((t) => !(t.type === "text" && !t.raw.trim()));
	const only = real.length === 1 && real[0]!.type === "wiki" ? (real[0] as WikiToken) : undefined;
	return only?.embed && !/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(only.target) ? only.target : undefined;
}

/** A paragraph that is only a picture: `![alt|240](url)`, or `![[photo.png|240]]`. */
function pictureOf(token: Tokens.Paragraph): { url: string; alt: string; width?: number } | undefined {
	if (token.type !== "paragraph") return undefined;
	const real = (token.tokens ?? []).filter((t) => !(t.type === "text" && !t.raw.trim()));
	if (real.length !== 1) return undefined;
	const only = real[0]!;
	if (only.type === "image") {
		const image = only as Tokens.Image;
		const { alt, width } = sizedAlt(image.text);
		return { url: image.href, alt, ...(width ? { width } : {}) };
	}
	if (only.type === "wiki" && (only as WikiToken).embed && /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test((only as WikiToken).target)) {
		const wiki = only as WikiToken;
		return { url: wiki.target, alt: wiki.alias ?? wiki.target, ...(wiki.width ? { width: wiki.width } : {}) };
	}
	return undefined;
}

/** The labels the editor shows for items it keeps but cannot type into. */
export function heldLabels(children: readonly PenNode[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const node of children) if (PLACEHOLDER.test(childMarkdown(node))) out[node.id] = String(node.name ?? node.type);
	return out;
}

/**
 * The edits that take a card's children from `before` to `after`, one item at a time: what went is
 * deleted, what is new is inserted where it goes, what moved is moved, and a block whose words
 * changed is updated. A block that did not change is not named at all.
 */
export function cardEdits(card: string, before: readonly PenNode[], after: readonly PenNode[]): Op[] {
	const kept = new Set(after.map((node) => node.id));
	const ops: Op[] = before.filter((node) => !kept.has(node.id)).map((node) => ({ op: "delete", id: node.id }));
	const order = before.filter((node) => kept.has(node.id)).map((node) => node.id);
	const was = new Map(before.map((node) => [node.id, node]));
	after.forEach((node, index) => {
		if (order[index] === node.id) return;
		const at = order.indexOf(node.id);
		if (at >= 0) {
			order.splice(at, 1);
			ops.push({ op: "move", id: node.id, parent: card, index });
		} else ops.push({ op: "insert", parent: card, index, node });
		order.splice(index, 0, node.id);
	});
	for (const node of after) {
		const old = was.get(node.id);
		if (old && old !== node && old.content !== node.content) ops.push({ op: "update", id: node.id, set: { content: node.content } });
	}
	return ops;
}

/**
 * A card as an Obsidian note: its blocks as one .md, with our two additions taken out (`toObsidian`):
 * coloured words lose their colour, an open suggestion goes out as the words it would replace. An item
 * that is not words or a picture has nothing to be in a note, and is left out.
 */
export function obsidianNote(node: PenNode): string {
	const md = isCard(node)
		? (node.children ?? [])
				.map(childMarkdown)
				.filter((text) => text.trim() && !PLACEHOLDER.test(text))
				.join("\n\n")
		: typeof node.content === "string"
			? node.content
			: "";
	return `${toObsidian(md).trim()}\n`;
}
