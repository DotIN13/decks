import { indexOf, isCard, isMarkdown, makeLabel, shapeLabel, type PenDocument, type PenNode } from "@decks/pen";
import { cardMarkdown, heldLabels } from "../../model/card-frame.ts";
import { dropSlot } from "../core/drop.ts";
import type { Pt, Rect } from "../core/model.ts";
import type { Picked } from "../core/pick.ts";
import { fileOf, labelBox, textLook, type TextLook, type TextSession } from "../core/text.ts";
import type { Editor } from "./controller.ts";
import { openInTab } from "../../base/host.ts";
import { type TextHost } from "./TextEditing.tsx";

/** What `createTextOpen` reads of `createTextEditing` (`TextEditing.tsx`). */
export interface TextOpenNeeds {
	readonly doc: () => PenDocument | undefined;
	readonly host: TextHost;
	readonly editor: Editor;
	readonly cardOf: (id: string) => PenNode | undefined;
	readonly setOpen: (text: TextSession | undefined) => void;
	readonly textLookOf: (node: PenNode, placed: Parameters<typeof textLook>[2]) => TextLook;
	readonly cardLook: (card: PenNode) => TextLook;
}

/** Opening words for typing: a text or a note, a shape's words, a card or one block of it, a file's own editor. */
export function createTextOpen(d: TextOpenNeeds) {
	/**
	 * Type a shape's words: its own, or a new text made inside it, centred and as wide as the shape,
	 * which goes again if nothing is typed (`commitPenText`, `fresh`).
	 */
	const openShapeWords = (id: string) => {
		const current = d.doc();
		const frame = current ? indexOf(current).get(id)?.node : undefined;
		const box = d.host.scene.item(id)?.box;
		if (!frame || !box) return;
		d.editor.select([id]);
		const label = shapeLabel(frame);
		if (label) {
			const placed = d.host.scene.item(label.id);
			openPenText({ id: label.id, node: label, box: placed?.box ?? box });
			return;
		}
		const labelId = d.host.freshId();
		const node = makeLabel(labelId);
		d.host.edit([{ op: "insert", parent: id, node }]);
		openPenText({ id: labelId, node, box: labelBox(box) }, true);
	};

	const openPenText = (given: Picked, fresh?: boolean) => {
		// The item as the server has it now: what the canvas last drew can be a save behind.
		const pen = d.host.pen();
		const now = pen ? indexOf(pen.doc).get(given.id)?.node : undefined;
		const hit = now ? { ...given, node: now } : given;
		// A card, or one of its blocks: the whole card is typed into, as one piece of markdown.
		const card = isCard(hit.node) ? hit.node : d.cardOf(hit.id);
		if (card) return openCard(card, hit.box, fresh);
		const node = hit.node;
		const placed = d.host.scene.item(hit.id);
		const box = placed?.box ?? hit.box;
		d.host.engine.muteText(new Set([hit.id]));
		d.setOpen({ id: hit.id, box: { ...box }, value: typeof node.content === "string" ? node.content : "", style: d.textLookOf(placed?.node ?? node, placed), kind: node.type, ...(fresh ? { fresh } : {}), ...(isMarkdown(node) ? { legacy: true as const } : {}) });
	};

	/** A file's chip, or its icon or name: the file opens in a tab of its own. Answers whether it was one. */
	const openFileOf = (id: string): boolean => {
		// The chip itself, or anything inside it: a file card's picture, tile, name.
		const file = fileOf(d.doc(), id);
		if (!file) return false;
		d.editor.select([file.id]);
		openInTab(new URL(file.metadata.path, new URL(d.host.pen()?.base || "/", location.origin)).href);
		return true;
	};

	const openCard = (card: PenNode, at: Rect, fresh?: boolean, where?: { insertAt?: number; caretAt?: Pt }) => {
		const placed = d.host.scene.item(card.id);
		const kids = card.children ?? [];
		d.editor.select([card.id]);
		d.host.engine.muteText(new Set(kids.filter((child) => child.type === "text").map((child) => child.id)));
		d.setOpen({ id: card.id, box: { ...(placed?.box ?? at) }, value: cardMarkdown(kids), style: d.cardLook(card), card: true, held: heldLabels(kids), ...(fresh ? { fresh } : {}), ...where });
	};

	/**
	 * A double-click or a double tap on a card: on its words, the card opens with the caret there; in a
	 * gap, between blocks or in its padding, a new empty line is made there to type into. Answers
	 * whether it was a card. The canvas menu is for empty canvas only.
	 */
	const openCardAt = (hit: Picked, at: Pt, client: Pt): boolean => {
		const card = isCard(hit.node) ? hit.node : d.cardOf(hit.id);
		if (!card) return false;
		const pen = d.host.pen();
		const current = (pen ? indexOf(pen.doc).get(card.id)?.node : undefined) ?? card;
		const box = d.host.scene.item(card.id)?.box ?? hit.box;
		if (hit.node.id === card.id) openCard(current, box, false, { insertAt: dropSlot(d.host.scene, card.id, at, [])?.index ?? (current.children ?? []).length });
		else openCard(current, box, false, { caretAt: client });
		return true;
	};

	return {
		openPenText,
		openShapeWords,
		openCardAt,
		openFileOf,
	};
}
