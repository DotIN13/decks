import { chipLink, chipTitle, deckLinkOf, deckLinkTo, linkChip, type LinkKind } from "@decks/pen";
import type { VerbContext } from "./context.ts";
import { tabFor } from "./view.ts";

/**
 * A link chip between a caller and the canvas file.
 *
 * A caller places `{ type: "link", to }`, where `to` is what `decks view open` takes (a canvas's name
 * or title, a card's or a document's path, an app's name) or the address itself (`#canvas/<name>`),
 * and reads it back as `{ type: "link", to: "#canvas/<name>", title }`. The file keeps a small frame,
 * the kind's mark and the target's name, tagged `decks.link` (`@decks/pen`, `linkChip`), which pen.dev
 * opens as the pill it is.
 */

/** The longest name a chip shows: a card's title is a sentence, and a chip is a chip. */
const NAME = 60;
const short = (title: string): string => (title.length > NAME ? `${title.slice(0, NAME - 1).trimEnd()}…` : title);

/** What a link's `to` names in the deck: found, or for an address whose target is not there, kept as it is and marked gone. */
function targetOf(ctx: VerbContext, to: string): { kind: LinkKind; target: string; title: string; gone?: true } {
	const at = deckLinkOf(to);
	if (!at) return tabFor(ctx, to);
	try {
		return tabFor(ctx, at.target, at.kind);
	} catch {
		// An address read back and written again after its target went: the chip stays, dimmed, rather than the edit failing.
		const last = at.target.split("/").filter((part) => part && part !== "index.html").pop() ?? at.target;
		return { ...at, title: last, gone: true };
	}
}

/** A caller's `{ type: "link", to, title? }` as the frame the canvas file keeps. What else it gives (an id, a place) is kept. */
export function linkFromItem(ctx: VerbContext, item: Record<string, unknown>): Record<string, unknown> {
	const { type: _type, to, title, children: _children, box: _box, clipped: _clipped, ...others } = item;
	const asked = typeof to === "string" ? to.trim() : "";
	if (!asked) throw new Error('A link names what it opens: { type: "link", to: "<a canvas\'s name or title, a card\'s or a document\'s path, or an app\'s name>" }, as decks view open takes it.');
	const found = targetOf(ctx, asked);
	// An app goes by its title on a chip, where a tab and an address have its name.
	const own = found.kind === "app" && !found.gone && ctx.service.apps ? ctx.service.apps.state(found.target).title || found.title : found.title;
	const named = typeof title === "string" && title.trim() ? title.trim() : own;
	return { ...linkChip({ to: deckLinkTo(found.kind, found.target), kind: found.kind, title: short(named), ...(found.gone ? { gone: true } : {}) }), ...others };
}

/** A link chip in the file as a caller reads it, `{ type: "link", to, title }` with its id and place; nothing for any other node. */
export function linkToItem(node: Record<string, unknown>): Record<string, unknown> | undefined {
	const to = chipLink(node);
	if (!to) return undefined;
	const { type: _type, metadata: _metadata, children: _children, name: _name, layout: _layout, alignItems: _alignItems, gap: _gap, padding: _padding, cornerRadius: _cornerRadius, fill: _fill, stroke: _stroke, strokeWidth: _strokeWidth, ...rest } = node;
	return { type: "link", ...rest, to, title: chipTitle(node as never) };
}
