import { indexOf, isCard, type PenDocument, type PenNode } from "@decks/pen";
import { cardChildren } from "../../model/card-frame.ts";
import { type TextHost } from "./TextEditing.tsx";

/** What `createTypedPreview` reads of `createTextEditing` (`TextEditing.tsx`). */
export interface TypedPreviewNeeds {
	readonly doc: () => PenDocument | undefined;
	readonly cardInner: (card: PenNode) => number;
	readonly pictureSize: (url: string) => { w: number; h: number; } | undefined;
	readonly host: TextHost;
}

/** What is being typed, drawn on the canvas once a frame, so an item grows with its words before they are saved. */
export function createTypedPreview(d: TypedPreviewNeeds) {
	/**
	 * The drawing laid out with the words being typed, so what holds them grows as they are typed:
	 * a card round its title, a note round its words. A copy of the document with the one item's
	 * words changed, drawn in place of the real one until the server answers with the real edit.
	 * Once a frame at most.
	 */
	let typedFrame: number | undefined;

	let typedValue: { id: string; value: string } | undefined;

	const previewTyped = (id: string, value: string) => {
		typedValue = { id, value };
		typedFrame ??= requestAnimationFrame(() => showTyped());
	};

	/** The typed words drawn now, not at the next frame: what putting the editor away draws in its place. */
	const showTyped = () => {
		{
			if (typedFrame !== undefined) cancelAnimationFrame(typedFrame);
			typedFrame = undefined;
			const current = d.doc();
			if (!current || !typedValue) return;
			const copy = structuredClone(current);
			const found = indexOf(copy).get(typedValue.id);
			if (!found) return;
			if (isCard(found.node)) {
				// The card grows as its blocks are typed: stand-in ids, swapped for real ones when it is saved.
				let n = 0;
				found.node.children = cardChildren(typedValue.value, found.node.children ?? [], { fresh: () => `typing-${n++}`, inner: d.cardInner(found.node), size: d.pictureSize });
			} else found.node.content = typedValue.value;
			d.host.engine.showDoc(copy, d.host.pen()?.base ?? "");
		}
	};

	/** Back to the document as the server has it, for an edit taken back with Escape. */
	const dropTyped = () => {
		if (typedFrame !== undefined) cancelAnimationFrame(typedFrame);
		typedFrame = undefined;
		typedValue = undefined;
		d.host.engine.showDoc(d.host.pen()?.doc, d.host.pen()?.base ?? "");
	};

	return {
		get typedFrame() {
			return typedFrame;
		},
		set typedFrame(next) {
			typedFrame = next;
		},
		dropTyped,
		get typedValue() {
			return typedValue;
		},
		set typedValue(next) {
			typedValue = next;
		},
		showTyped,
		previewTyped,
	};
}
