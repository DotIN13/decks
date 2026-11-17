import type { PenNode } from "./types.ts";

/**
 * A link to something in the deck: a canvas, a card, a document or an app.
 *
 * It is written as the address the Decks window already gives a tab, after `#`: `#canvas/<name>`,
 * `#card/<path>`, `#doc/<path>`, `#app/<name>`, each part of a path its own (percent-encoded). In
 * drawn words it is a markdown link's address, `[the plan](#card/canvases/launch/cards/plan/index.html)`;
 * a card's own HTML has it as an `href`; and a **link chip** is a link as an item of its own: a small
 * frame, the kind's mark and the target's name, tagged `metadata: { type: "decks.link", to }`, which
 * pen.dev opens as the plain pill it is. Followed on a canvas, the address is the host's to read and
 * open (`@decks/canvas`, `CanvasHost.openAddress`).
 */

/** What a link can point at, and the word each goes by in an address. */
export type LinkKind = "canvas" | "card" | "document" | "app";
const WORDS: Record<LinkKind, string> = { canvas: "canvas", card: "card", document: "doc", app: "app" };

/** Whether a link's address is one in the deck's window: `#` and a kind's word, then what it names. */
export const isDeckLink = (href: string): boolean => /^#[a-z]+\/\S/.test(href.trim());

/** The address of something in the deck: `#canvas/launch-plan`, `#doc/docs/brief.md`. */
export const deckLinkTo = (kind: LinkKind, target: string): string => `#${WORDS[kind]}/${target.split("/").map(encodeURIComponent).join("/")}`;

/** What an address names, when it is one of the deck's: the kind, and the target as the deck names it. */
export function deckLinkOf(href: string): { kind: LinkKind; target: string } | undefined {
	const match = /^#([a-z]+)\/(\S.*)$/.exec(href.trim());
	const kind = match && (Object.keys(WORDS) as LinkKind[]).find((one) => WORDS[one] === match[1]);
	if (!match || !kind) return undefined;
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
const MARKS: Record<LinkKind, string> = { canvas: "layers", card: "file-text", document: "file", app: "app-window" };

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
