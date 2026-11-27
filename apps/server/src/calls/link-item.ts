import { chipLink, chipTitle, deckLinkOf, deckLinkTo, itemLinkOf, itemLinkTo, linkChip, linkOpenFor, withLinkOpen, walk, type LinkKind, type LinkOpen, type PenNode } from "@decks/pen";
import { cardOf } from "../canvas/pens.ts";
import type { VerbContext } from "./context.ts";
import { tabFor } from "./view.ts";

/**
 * A link chip between a caller and the canvas file.
 *
 * A caller places `{ type: "link", to, open? }`, where `to` is what `decks view open` takes (a
 * canvas's name or title, a card's or a document's path, an app's name), an item's id on the canvas
 * being written, or an address itself (`#canvas/<name>`, `#item/<canvas>/<id>`); `open` is how it
 * opens when followed, `"canvas"` (the view flies to it) or `"tab"`. It reads back as
 * `{ type: "link", to, open, title }`, `open` as it will be followed. The file keeps a small frame,
 * the kind's mark and the target's name, tagged `decks.link` (`@decks/pen`, `linkChip`), with the
 * opening in its address (`?open=`), which pen.dev opens as the pill it is.
 */

/** The longest name a chip shows: a card's title is a sentence, and a chip is a chip. */
const NAME = 60;
const short = (title: string): string => (title.length > NAME ? `${title.slice(0, NAME - 1).trimEnd()}…` : title);

/** One item on a canvas as a link names it: its canvas, its id and the words a chip shows for it. */
export type FoundItem = { canvas: string; id: string; title: string };

/** Finds an item by id on a canvas (`canvas` left out: the canvas being written). */
export type ItemFinder = (canvas: string | undefined, id: string) => FoundItem | undefined;

/** The words a chip to an item shows: its name, its words, a card's title, else its id. */
function itemTitle(node: PenNode): string {
	if (typeof node.name === "string" && node.name.trim()) return node.name.trim();
	if (typeof node.content === "string" && node.content.trim()) return node.content.trim().split("\n")[0]!.replace(/^#+\s*/, "");
	const words = [...walk(node.children ?? [])].find((one) => one.type === "text" && typeof one.content === "string" && one.content.trim());
	if (words) return String(words.content).trim().split("\n")[0]!;
	return cardOf(node) ?? node.id;
}

/** An item finder over the canvases a server keeps: the item with that id anywhere in the canvas's drawing. */
export function itemFinder(ctx: VerbContext, here: () => string | undefined): ItemFinder {
	return (canvas, id) => {
		const name = canvas ?? here();
		const pens = ctx.service.pens;
		if (!name || !pens || !pens.has(name)) return undefined;
		const node = [...walk(pens.get(name).doc.children)].find((one) => one.id === id);
		return node ? { canvas: name, id, title: itemTitle(node) } : undefined;
	};
}

/** What a link's `to` names in the deck: found, or for an address whose target is not there, kept as it is and marked gone. */
function targetOf(ctx: VerbContext, to: string, find: ItemFinder): { kind: LinkKind; target: string; title: string; address: string; gone?: true } {
	const at = deckLinkOf(to);
	if (at?.kind === "item") {
		const item = itemLinkOf(to)!;
		const found = find(item.canvas, item.id);
		if (found) return { kind: "item", target: at.target, title: found.title, address: itemLinkTo(found.canvas, found.id) };
		return { kind: "item", target: at.target, title: item.id, address: itemLinkTo(item.canvas, item.id), gone: true };
	}
	if (!at) {
		try {
			const tab = tabFor(ctx, to);
			return { ...tab, address: deckLinkTo(tab.kind, tab.target) };
		} catch (error) {
			// Not a canvas, a card, a document or an app: an item on the canvas being written, by its id.
			const found = find(undefined, to);
			if (found) return { kind: "item", target: `${found.canvas}/${found.id}`, title: found.title, address: itemLinkTo(found.canvas, found.id) };
			throw new Error(`${error instanceof Error ? error.message : String(error)} Nor is it an item's id on this canvas; an item on another canvas is "#item/<canvas>/<id>".`);
		}
	}
	try {
		const tab = tabFor(ctx, at.target, at.kind);
		return { ...tab, address: deckLinkTo(tab.kind, tab.target) };
	} catch {
		// An address read back and written again after its target went: the chip stays, dimmed, rather than the edit failing.
		const last = at.target.split("/").filter((part) => part && part !== "index.html").pop() ?? at.target;
		return { ...at, title: last, address: withLinkOpen(to, undefined), gone: true };
	}
}

/** A caller's `{ type: "link", to, open?, title? }` as the frame the canvas file keeps. What else it gives (an id, a place) is kept. */
export function linkFromItem(ctx: VerbContext, item: Record<string, unknown>, find: ItemFinder = () => undefined): Record<string, unknown> {
	const { type: _type, to, title, open, children: _children, box: _box, clipped: _clipped, ...others } = item;
	const asked = typeof to === "string" ? to.trim() : "";
	if (!asked) throw new Error('A link names what it opens: { type: "link", to: "<a canvas\'s name or title, a card\'s or a document\'s path, an app\'s name, or an item\'s id>" }.');
	if (open !== undefined && open !== null && open !== "canvas" && open !== "tab") throw new Error('open is how the link opens when it is followed: "canvas" (the view flies to it) or "tab" (a tab of its own).');
	const found = targetOf(ctx, asked, find);
	// An app goes by its title on a chip, where a tab and an address have its name.
	const own = found.kind === "app" && !found.gone && ctx.service.apps ? ctx.service.apps.state(found.target).title || found.title : found.title;
	const named = typeof title === "string" && title.trim() ? title.trim() : own;
	const address = withLinkOpen(found.address, (open as LinkOpen | null | undefined) ?? undefined);
	return { ...linkChip({ to: address, kind: found.kind, title: short(named), ...(found.gone ? { gone: true } : {}) }), ...others };
}

/** A link chip in the file as a caller reads it, `{ type: "link", to, open, title }` with its id and place; nothing for any other node. */
export function linkToItem(node: Record<string, unknown>): Record<string, unknown> | undefined {
	const to = chipLink(node);
	if (!to) return undefined;
	const { type: _type, metadata: _metadata, children: _children, name: _name, layout: _layout, alignItems: _alignItems, gap: _gap, padding: _padding, cornerRadius: _cornerRadius, fill: _fill, stroke: _stroke, strokeWidth: _strokeWidth, ...rest } = node;
	return { type: "link", ...rest, to: withLinkOpen(to, undefined), open: linkOpenFor(to), title: chipTitle(node as never) };
}
