import type { PenNode } from "./types.ts";

/**
 * A link to something in the deck: a canvas, a card, a document, an app, or any one item on a canvas.
 *
 * It is written as the address the Decks window already gives a tab, after `#`: `#canvas/<name>`,
 * `#card/<path>`, `#doc/<path>`, `#app/<name>`, each part of a path its own (percent-encoded). In
 * drawn words it is a markdown link's address, `[the plan](#card/canvases/launch/cards/plan/index.html)`;
 * a card's own HTML has it as an `href`; and a **link chip** is a link as an item of its own: a small
 * frame, the kind's mark and the target's name, tagged `metadata: { type: "decks.link", to }`, which
 * pen.dev opens as the plain pill it is. Followed on a canvas, the address is the host's to read and
 * open (`@decks/canvas`, `CanvasHost.openAddress`).
 */

/**
 * What a link can point at, and the word each goes by in an address. An `item` is any one thing on
 * a canvas, drawn or a card or an app, by the canvas and its id: `#item/<canvas>/<id>`, the canvas
 * one part even when its name has a slash in it (a shared canvas's), so it is read with `itemLinkOf`.
 */
export type LinkKind = "canvas" | "card" | "document" | "app" | "item";
const WORDS: Record<LinkKind, string> = { canvas: "canvas", card: "card", document: "doc", app: "app", item: "item" };

/**
 * How a link opens when it is followed: on the canvas, the view flying to what it names (on its own
 * canvas when that is another), or in a tab of its own. Kept in the address after `?open=`, so a
 * chip, a link in words and a card's `href` all carry it; with none, `linkOpenFor` says.
 */
export type LinkOpen = "canvas" | "tab";

/** Whether a link's address is one in the deck's window: `#` and a kind's word, then what it names. */
export const isDeckLink = (href: string): boolean => /^#[a-z]+\/\S/.test(href.trim());

/** An address without its `?open=` part. */
const bare = (href: string): string => href.trim().replace(/\?open=[a-z]+$/, "");

/** The address of something in the deck: `#canvas/launch-plan`, `#doc/docs/brief.md`; with `open`, how it opens. */
export const deckLinkTo = (kind: LinkKind, target: string, open?: LinkOpen): string => `#${WORDS[kind]}/${target.split("/").map(encodeURIComponent).join("/")}${open ? `?open=${open}` : ""}`;

/** The address of one item on a canvas: `#item/<canvas>/<id>`. */
export const itemLinkTo = (canvas: string, id: string, open?: LinkOpen): string => `#item/${encodeURIComponent(canvas)}/${encodeURIComponent(id)}${open ? `?open=${open}` : ""}`;

/** The canvas and the id an item's address names. */
export function itemLinkOf(href: string): { canvas: string; id: string } | undefined {
	const match = /^#item\/([^/\s]+)\/(\S+)$/.exec(bare(href));
	if (!match) return undefined;
	try {
		return { canvas: decodeURIComponent(match[1]!), id: decodeURIComponent(match[2]!) };
	} catch {
		return undefined;
	}
}

/** How an address says it opens (`?open=canvas` or `?open=tab`), or nothing when it does not say. */
export function linkOpenOf(href: string): LinkOpen | undefined {
	const match = /\?open=(canvas|tab)$/.exec(href.trim());
	return match ? (match[1] as LinkOpen) : undefined;
}

/** An address with how it opens set, or taken off (`undefined`). */
export const withLinkOpen = (href: string, open: LinkOpen | undefined): string => `${bare(href)}${open ? `?open=${open}` : ""}`;

/**
 * How a link opens: what its address says, else by what it names. A card or a drawn item is on a
 * canvas, so on the canvas; a canvas, a document or an app is a whole of its own, so in a tab.
 */
export function linkOpenFor(href: string): LinkOpen {
	const said = linkOpenOf(href);
	if (said) return said;
	const kind = deckLinkOf(href)?.kind;
	return kind === "item" || kind === "card" ? "canvas" : "tab";
}

/** What an address names, when it is one of the deck's: the kind, and the target as the deck names it (an item's as `<canvas>/<id>`; `itemLinkOf` splits it). */
export function deckLinkOf(href: string): { kind: LinkKind; target: string } | undefined {
	const match = /^#([a-z]+)\/(\S.*)$/.exec(bare(href));
	const kind = match && (Object.keys(WORDS) as LinkKind[]).find((one) => WORDS[one] === match[1]);
	if (!match || !kind) return undefined;
	if (kind === "item") {
		const item = itemLinkOf(href);
		return item ? { kind, target: `${item.canvas}/${item.id}` } : undefined;
	}
	try {
		return { kind, target: match[2]!.split("/").map(decodeURIComponent).join("/") };
	} catch {
		return undefined;
	}
}

/** The tag of a link chip. */
export const LINK_CHIP = "decks.link";

/** The address a link chip points at, when the node is one. */
export function chipLink(node: { metadata?: unknown } | undefined): string | undefined {
	const meta = node?.metadata as { type?: unknown; to?: unknown } | undefined;
	return meta?.type === LINK_CHIP && typeof meta.to === "string" && isDeckLink(meta.to) ? meta.to : undefined;
}

/** The name a chip shows: its words, the one text among its children. */
export function chipTitle(node: PenNode): string {
	const words = (node.children ?? []).find((child) => child.type === "text");
	return typeof words?.content === "string" ? words.content : typeof node.name === "string" ? node.name : "";
}

/** Each kind's mark on a chip, by its name in Lucide: the marks the row of tabs has. */
const MARKS: Record<LinkKind, string> = { canvas: "layers", card: "file-text", document: "file", app: "app-window", item: "crosshair" };

/**
 * A link chip, as the canvas file keeps it: a pill with the kind's mark, the target's name, and a
 * small arrow that says it goes somewhere. Its colours are Decks's adaptive ones, so it reads in
 * light and dark. `gone` is how one whose target is no longer in the deck is kept: dimmed.
 */
export function linkChip(link: { to: string; kind: LinkKind; title: string; gone?: boolean }): Record<string, unknown> {
	return {
		type: "frame",
		name: link.title,
		layout: "horizontal",
		alignItems: "center",
		gap: 8,
		padding: [8, 12],
		cornerRadius: 10,
		fill: "$decks-surface",
		stroke: "$decks-line-subtle",
		strokeWidth: 1,
		...(link.gone ? { opacity: 0.45 } : {}),
		metadata: { type: LINK_CHIP, to: link.to },
		children: [
			{ type: "icon", library: "lucide", icon: MARKS[link.kind], width: 18, height: 18, fill: "$decks-text-muted" },
			{ type: "text", content: link.title, fontSize: 16, fontWeight: "500", fill: "$decks-text" },
			{ type: "icon", library: "lucide", icon: "arrow-up-right", width: 14, height: 14, fill: "$decks-text-muted" },
		],
	};
}
