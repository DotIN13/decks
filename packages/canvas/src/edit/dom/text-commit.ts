import type { Accessor } from "solid-js";
import { indexOf, isCard, type PenNode } from "@decks/pen";
import { cardChildren, cardEdits, cardMarkdown, CARD_GAP, CARD_PAD, CARD_RADIUS } from "../../model/card-frame.ts";
import { commitOf, legacyCard, type TextSession } from "../core/text.ts";
import { type TextHost } from "./TextEditing.tsx";

/** What `createTextCommit` reads of `createTextEditing` (`TextEditing.tsx`). */
export interface TextCommitNeeds {
	readonly open: Accessor<TextSession | undefined>;
	readonly leaveGhost: () => void;
	readonly setOpen: (text: TextSession | undefined) => void;
	readonly host: TextHost;
	readonly unmuteNow: () => void;
	readonly dropTyped: () => void;
	typedValue: { id: string; value: string; } | undefined;
	readonly showTyped: () => void;
	readonly measurePictures: (markdown: string) => Promise<void>;
	readonly cardInner: (card: PenNode) => number;
	readonly pictureSize: (url: string) => { w: number; h: number; } | undefined;
}

/** Typing done: the words are saved as one edit, and the editor stays over them until the canvas has drawn them. */
export function createTextCommit(d: TextCommitNeeds) {
	const commitPenText = (value: string) => {
		const now = d.open();
		if (now) d.leaveGhost();
		d.setOpen(undefined);
		// Against the document the server has: the one drawn already has the typed words in it.
		const pen = d.host.pen();
		const node = now && pen ? indexOf(pen.doc).get(now.id)?.node : undefined;
		const was = now && node ? (now.card ? cardMarkdown(node.children ?? []) : node.content) : undefined;
		const commit = commitOf(now, value, was, d.host.editable());
		switch (commit.do) {
			case "close":
				return d.unmuteNow();
			case "vanish":
				d.unmuteNow();
				d.dropTyped();
				return d.host.edit(commit.ops);
			case "unchanged":
				d.unmuteNow();
				return d.dropTyped();
		}
		const session = now!;
		/*
		 * The words as typed are drawn at once, from a copy of the drawing (`showTyped`), and the canvas
		 * may draw them now: the editor's still copy stands over them until that frame is on screen. It
		 * used to wait for the server's answer to be drawn, and a card's words, which keep their ids in
		 * the answer, were left out for a frame after its copy had already shown them.
		 */
		d.typedValue = { id: session.id, value };
		d.showTyped();
		d.unmuteNow();
		if (commit.do === "update") {
			d.host.edit(commit.ops);
			return;
		}
		// A card is saved as edits to its blocks, each untouched block left alone. A note card from before
		// becomes a card frame here, in its place. Pictures are measured first, for their shape.
		void d.measurePictures(value).then(() => {
			const later = d.host.pen();
			const current = later ? indexOf(later.doc).get(session.id)?.node : undefined;
			const base = current ?? node;
			if (!base) return d.unmuteNow();
			const card = isCard(base) ? base : legacyCard(base, { gap: CARD_GAP, pad: CARD_PAD, radius: CARD_RADIUS });
			const children = cardChildren(value, card.children ?? [], { fresh: d.host.nextIds(), inner: d.cardInner(card), size: d.pictureSize });
			// A card's blocks are edited one by one, and only the ones that changed; a note card becomes a frame.
			const ops = isCard(base) ? cardEdits(base.id, base.children ?? [], children) : [{ op: "replace" as const, id: session.id, node: { ...card, children } }];
			if (!ops.length) return d.unmuteNow();
			d.host.edit(ops);
		});
	};

	return {
		commitPenText,
	};
}
