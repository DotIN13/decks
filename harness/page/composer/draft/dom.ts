import { draftText, normalize, type Draft, type DraftMention, type DraftNode } from "./model.ts";
import { pillElement, pillNode } from "../pill/card.ts";

// The field's DOM: a draft read from it and written into it, and where the caret is.

/** A mention, as the DOM holds it (`pill-card.ts`), with the host's `title` when it has no cards. */
export function mentionElement(node: DraftMention, describe?: (node: DraftMention) => string | undefined): HTMLElement {
	const span = pillElement(node);
	const words = describe?.(node);
	if (words) span.title = words;
	return span;
}

export function nodeOf(el: Element): DraftNode | null {
	return el instanceof HTMLElement ? pillNode(el) : null;
}

/** The model the DOM currently represents. */
export function readDraft(root: HTMLElement): Draft {
	const draft: Draft = [];
	for (const child of Array.from(root.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			draft.push({ type: "text", text: child.textContent ?? "" });
			continue;
		}
		if (!(child instanceof HTMLElement)) continue;
		if (child.tagName === "BR") {
			/*
			 * A trailing `<br>` is the browser's, not the user's. Every engine keeps one at the end of an
			 * editable box so the last line has a height to be clicked into, and it appears the moment a field
			 * is emptied.
			 */
			if (child === root.lastChild) continue;
			draft.push({ type: "text", text: "\n" });
			continue;
		}
		const mention = nodeOf(child);
		if (mention) {
			draft.push(mention);
			continue;
		}
		// Anything else, a stray element from a paste the browser normalised, // contributes its text and nothing more.
		draft.push({ type: "text", text: child.textContent ?? "" });
	}
	return normalize(draft);
}

/** A draft as DOM: mentions atomic, newlines as `<br>`, and nothing else. */
export function draftFragment(draft: Draft, describe?: (node: DraftMention) => string | undefined): DocumentFragment {
	const fragment = document.createDocumentFragment();
	for (const node of draft) {
		if (node.type === "mention") {
			fragment.appendChild(mentionElement(node, describe));
			continue;
		}
		for (const [index, line] of node.text.split("\n").entries()) {
			if (index > 0) fragment.appendChild(document.createElement("br"));
			if (line !== "") fragment.appendChild(document.createTextNode(line));
		}
	}
	return fragment;
}

/** Write a draft into the element. Only for changes the user did not type. */
export function writeDraft(root: HTMLElement, draft: Draft, describe?: (node: DraftMention) => string | undefined): void {
	root.replaceChildren(draftFragment(draft, describe));
}

/** How far into `draftText` the caret sits, counting a mention as its label. */
export function caretOffset(root: HTMLElement): number {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return draftText(readDraft(root)).length;
	const range = selection.getRangeAt(0).cloneRange();
	range.selectNodeContents(root);
	range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);

	let offset = 0;
	const walk = (parent: Node) => {
		for (const child of Array.from(parent.childNodes)) {
			if (!range.intersectsNode(child)) continue;
			const mention = child instanceof HTMLElement ? nodeOf(child) : null;
			if (mention) {
				offset += draftText([mention]).length;
				continue;
			}
			if (child.nodeType === Node.TEXT_NODE) {
				const end = selection.getRangeAt(0).endContainer === child ? selection.getRangeAt(0).endOffset : (child.textContent ?? "").length;
				offset += end;
				continue;
			}
			if (child instanceof HTMLElement && child.tagName === "BR") offset += 1;
		}
	};
	walk(root);
	return offset;
}

/** Put the caret straight after a node, in a text node it can live in. */
export function caretAfter(node: Node): void {
	const range = document.createRange();
	range.setStartAfter(node);
	range.collapse(true);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

/** The mention immediately before or after a collapsed caret, if any. */
export function adjacentMention(root: HTMLElement, side: "before" | "after"): HTMLElement | null {
	const selection = window.getSelection();
	if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	if (!root.contains(range.startContainer)) return null;

	const { startContainer: node, startOffset: offset } = range;

	/*
	 * The caret is rarely "on" a mention. It is at the end of the text node in
	 * front of it, or at the start of the one behind it, or between children of
	 * the root, so each of those has to be normalised to the same question.
	 */
	if (node.nodeType === Node.TEXT_NODE) {
		const text = node.textContent ?? "";
		if (side === "before" && offset !== 0) return null;
		if (side === "after" && offset !== text.length) return null;
		const sibling = side === "before" ? node.previousSibling : node.nextSibling;
		return sibling instanceof HTMLElement && nodeOf(sibling) ? sibling : null;
	}

	if (node === root) {
		const index = side === "before" ? offset - 1 : offset;
		const child = root.childNodes[index];
		return child instanceof HTMLElement && nodeOf(child) ? child : null;
	}

	return null;
}

/** Whether the selection is inside the field. */
export function selectionInside(el: HTMLElement): boolean {
	const selection = window.getSelection();
	return !!selection && selection.rangeCount > 0 && el.contains(selection.getRangeAt(0).startContainer);
}

/** Put the caret at the very start of the field. */
export function caretAtStart(el: HTMLElement): void {
	const range = document.createRange();
	range.setStart(el, 0);
	range.collapse(true);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

/** What is selected, as a draft, for the clipboard and for a drag. */
export function selectionDraft(): Draft | null {
	const selection = window.getSelection();
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
	const holder = document.createElement("div");
	holder.appendChild(selection.getRangeAt(0).cloneContents());
	return readDraft(holder);
}
