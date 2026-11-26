import { chipLink, chipTitle, deckLinkOf, deckLinkTo, itemLinkOf, itemLinkTo, LINK_CHIP, linkOpenOf, walk, withLinkOpen, type Op, type PenNode } from "@decks/pen";
import { canvasFolder } from "@decks/hub/layout";
import type { CanvasPens } from "./pens.ts";

/**
 * The links on every canvas, kept in step with a canvas they point at.
 *
 * A link chip keeps its target's address and shows its name (`@decks/pen`, `link.ts`), and both can
 * go stale when a canvas changes: called something else, its chips should say so; moved to another
 * folder (its first naming, a rename of the folder), the addresses of the canvas and of everything
 * kept in it change; deleted, a chip to it points at nothing and is dimmed. This follows each of
 * those, on every canvas that can be written, as edits like any other, so open pages see them. A
 * link in drawn words has only an address, which follows a move.
 */
export type CanvasChange = { did: "titled"; canvas: string; was: string; title: string } | { did: "moved"; from: string; to: string } | { did: "removed"; canvas: string };

/** How a chip whose target is gone is kept: there, and dimmed (`linkChip`, `gone`). */
const GONE = 0.45;

/** Whether an address names this canvas, or a card or a document kept in its folder. */
function within(address: string, canvas: string): "canvas" | "inside" | undefined {
	const link = deckLinkOf(address);
	if (!link) return undefined;
	if (link.kind === "canvas") return link.target === canvas ? "canvas" : undefined;
	if (link.kind === "item") return itemLinkOf(address)?.canvas === canvas ? "inside" : undefined;
	return link.kind !== "app" && link.target.startsWith(`${canvasFolder(canvas)}/`) ? "inside" : undefined;
}

/** An address as it is after a canvas moved from one folder to another; itself when it names nothing there. */
function moved(address: string, from: string, to: string): string {
	const link = deckLinkOf(address);
	const part = within(address, from);
	if (!link || !part) return address;
	const open = linkOpenOf(address);
	if (link.kind === "item") return itemLinkTo(to, itemLinkOf(address)!.id, open);
	return withLinkOpen(part === "canvas" ? deckLinkTo("canvas", to) : deckLinkTo(link.kind, `${canvasFolder(to)}/${link.target.slice(canvasFolder(from).length + 1)}`), open);
}

/** The edits one drawing needs for a change: none for most. */
export function editsFor(nodes: readonly PenNode[], change: CanvasChange): Op[] {
	const ops: Op[] = [];
	for (const node of walk(nodes)) {
		const to = chipLink(node);
		if (to) {
			if (change.did === "titled" && within(to, change.canvas) === "canvas" && chipTitle(node) === change.was) {
				// Its words follow, unless whoever placed it gave it words of their own.
				const words = (node.children ?? []).find((child) => child.type === "text");
				if (words) ops.push({ op: "update", id: words.id, set: { content: change.title } });
				ops.push({ op: "update", id: node.id, set: { name: change.title } });
			}
			if (change.did === "moved" && moved(to, change.from, change.to) !== to) ops.push({ op: "update", id: node.id, set: { metadata: { type: LINK_CHIP, to: moved(to, change.from, change.to) } } });
			if (change.did === "removed" && within(to, change.canvas) && node.opacity !== GONE) ops.push({ op: "update", id: node.id, set: { opacity: GONE } });
			continue;
		}
		// A link in drawn words: `](#canvas/<from>)`, `](#card/canvases/<from>/…)`.
		if (change.did === "moved" && node.type === "text" && typeof node.content === "string" && node.content.includes("](#")) {
			const content = node.content.replace(/\]\((#[a-z]+\/[^)\s]+)\)/g, (all, address: string) => `](${moved(address, change.from, change.to)})`);
			if (content !== node.content) ops.push({ op: "update", id: node.id, set: { content } });
		}
	}
	return ops;
}

/** Follow a canvas's change on every canvas's links. A canvas that cannot be written (a friend's, shared to view) or read is left as it is. */
export function linksFollow(pens: CanvasPens, change: CanvasChange): void {
	for (const name of pens.names()) {
		try {
			const entry = pens.get(name);
			if (entry.error) continue;
			const ops = editsFor(entry.doc.children ?? [], change);
			if (ops.length) pens.edit(name, ops);
		} catch {
			/* not this canvas's to change, or not readable: its links stay as they are */
		}
	}
}
