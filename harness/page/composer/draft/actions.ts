import { onCleanup } from "solid-js";
import { DRAFT_MIME, draftText, normalize, parseDraft, serializeDraft, textDraft, type Draft, type DraftMention, type DraftNode } from "./model.ts";
import { withMention } from "./mention.ts";
import { closePillCard, pillNode, wirePills } from "../pill/card.ts";
import { adjacentMention, caretAfter, caretAtStart, caretOffset, draftFragment, mentionElement, nodeOf, readDraft, selectionDraft, selectionInside, writeDraft } from "./dom.ts";
import type { DraftFieldApi, DraftFieldProps } from "./view.tsx";

// What the draft field does: the handle the composer edits it through,
// and its own handlers for delete, drop, copy, cut, drag and paste.

/** The field's element and props, and how it reports a change back. */
export interface Field {
	el: () => HTMLDivElement | undefined;
	props: DraftFieldProps;
	/** Read the DOM back into the model, and report where the caret ended up. */
	sync: () => void;
}

// The handle the composer edits the field through.
/** The handle the composer edits the field through. */
export function fieldApi(f: Field): DraftFieldApi {
	const api: DraftFieldApi = {
		set: (draft) => setDraft(f, draft),
		insertMention: (node, back) => insertMention(f, node, back),
		append: (node) => append(f, node),
		appendWords: (text) => {
			const el = f.el();
			if (el && text) setDraft(f, normalize([...readDraft(el), { type: "text", text }]));
		},
		insertText: (text) => insertText(f, text),
		retitle: () => retitle(f),
		insertPill: (node) => (f.el() && selectionInside(f.el()!) ? insertMention(f, node, 0) : append(f, node)),
		remove: (node) => removePill(f, node),
		focus: () => focus(f),
	};
	return api;
}

/** Replace the whole draft. The caret moves only if the field already has it, so a switch never takes the keyboard. */
function setDraft(f: Field, draft: Draft): void {
	const el = f.el();
	if (!el) return;
	writeDraft(el, draft, f.props.describe);
	f.props.onDraft(normalize(draft));
	const last = el.lastChild;
	if (last && document.activeElement === el) caretAfter(last);
	f.props.onCaret(draftText(draft).length);
}

/** A mention at the caret, swallowing the `@query` before it, then a space so the sentence carries on. */
function insertMention(f: Field, node: Extract<DraftNode, { type: "mention" }>, back: number): void {
	const selection = window.getSelection();
	if (!f.el() || !selection || selection.rangeCount === 0) return;
	const range = selection.getRangeAt(0);
	if (back > 0 && range.startContainer.nodeType === Node.TEXT_NODE) range.setStart(range.startContainer, Math.max(0, range.startOffset - back));
	range.deleteContents();
	const pill = mentionElement(node, f.props.describe);
	const after = document.createTextNode(" ");
	range.insertNode(after);
	range.insertNode(pill);
	caretAfter(after);
	f.sync();
}

/** Something kept rather than typed goes at the end, spaced from what is there. */
function append(f: Field, node: DraftNode): void {
	const el = f.el();
	if (!el) return;
	const current = readDraft(el);
	const text = draftText(current);
	const spaced: Draft = text === "" || text.endsWith(" ") ? current : [...current, { type: "text", text: " " }];
	setDraft(f, normalize([...spaced, node, { type: "text", text: " " }]));
}

/** Plain words at the caret, one space either side and none doubled; at the end when the field lacks the caret. */
function insertText(f: Field, text: string): void {
	const el = f.el();
	if (!el) return;
	const current = readDraft(el);
	const whole = draftText(current);
	if (!selectionInside(el)) {
		const spaced = withMention(whole, whole.length, text);
		return setDraft(f, normalize([...current, { type: "text", text: spaced.text.slice(whole.length) }]));
	}
	const caret = caretOffset(el);
	const spaced = withMention(whole, caret, text);
	const range = window.getSelection()!.getRangeAt(0);
	range.deleteContents();
	const node = document.createTextNode(spaced.text.slice(caret, spaced.caret));
	range.insertNode(node);
	caretAfter(node);
	el.normalize();
	f.sync();
}

/** Take a pill out, with the space after it, so no double space is left behind. */
function removePill(f: Field, node: DraftMention): void {
	const el = f.el();
	if (!el) return;
	const pill = Array.from(el.children).find((child) => {
		const at = nodeOf(child);
		return at?.type === "mention" && at.kind === node.kind && at.id === node.id;
	});
	if (!pill) return;
	const next = pill.nextSibling;
	if (next?.nodeType === Node.TEXT_NODE && next.textContent?.startsWith(" ")) next.textContent = next.textContent.slice(1);
	pill.remove();
	f.sync();
}

/** Focus at the end of what is there, unless the caret was already inside; asked before focusing. */
function focus(f: Field): void {
	const el = f.el();
	if (!el) return;
	const inside = document.activeElement === el && selectionInside(el);
	el.focus();
	if (!inside && el.lastChild) caretAfter(el.lastChild);
}

/** Redraw the pills' hover words, after what they describe has changed. */
function retitle(f: Field): void {
	const el = f.el();
	if (!el || !f.props.describe) return;
	for (const child of Array.from(el.children)) {
		const node = nodeOf(child);
		if (node?.type === "mention") (child as HTMLElement).title = f.props.describe(node) ?? "";
	}
}

// The field's own handlers.
/** The field's own handlers: delete, drop, copy, cut, drag out and paste, and its pills' cards. */
export function wireField(f: Field, el: HTMLElement): void {
	const onBeforeInput = (event: InputEvent) => beforeInput(f, el, event);
	const onCopy = (event: ClipboardEvent) => {
		const draft = selectionDraft();
		if (!draft || !event.clipboardData) return;
		event.preventDefault();
		carry(event.clipboardData, draft);
		if (event.type === "cut") {
			window.getSelection()?.deleteFromDocument();
			f.sync();
		}
	};
	// Cleared first, or the browser adds the markup as text/html and a pill arrives elsewhere as a box.
	const onDragStart = (event: DragEvent) => {
		const draft = selectionDraft();
		if (!draft || !event.dataTransfer) return;
		event.dataTransfer.clearData();
		carry(event.dataTransfer, draft);
	};
	// Plain `@notes.md` from elsewhere stays words: which file it meant is not recoverable.
	const onPaste = (event: ClipboardEvent) => {
		if (!event.clipboardData) return;
		event.preventDefault();
		const files = [...event.clipboardData.files];
		if (files.length && f.props.onPasteFiles) return f.props.onPasteFiles(files);
		insertAtSelection(f, parseDraft(event.clipboardData.getData(DRAFT_MIME)) ?? textDraft(event.clipboardData.getData("text/plain")));
	};
	const on: Array<[string, EventListener]> = [["beforeinput", onBeforeInput as EventListener], ["copy", onCopy as EventListener], ["cut", onCopy as EventListener], ["dragstart", onDragStart as EventListener], ["paste", onPaste as EventListener]];
	const unwire = wirePills(el, () => f.props.pills, (pill) => pillNode(pill));
	for (const [name, hear] of on) el.addEventListener(name, hear);
	onCleanup(() => {
		unwire();
		closePillCard();
		for (const [name, hear] of on) el.removeEventListener(name, hear);
	});
}

/** Before the browser deletes into a mention, the whole pill goes instead: any delete, from any keyboard. */
function beforeInput(f: Field, el: HTMLElement, event: InputEvent): void {
	if (event.inputType === "insertFromDrop") return dropInto(f, el, event);
	const backward = event.inputType === "deleteContentBackward";
	if (!backward && event.inputType !== "deleteContentForward") return;
	const pill = adjacentMention(el, backward ? "before" : "after");
	if (!pill) return;
	event.preventDefault();
	const anchor = pill.previousSibling;
	pill.remove();
	if (anchor) caretAfter(anchor);
	else caretAtStart(el);
	f.sync();
}

/** A drop lands where it landed, and only our own payload rebuilds mentions. */
function dropInto(f: Field, el: HTMLElement, event: InputEvent): void {
	const data = event.dataTransfer;
	if (!data) return;
	event.preventDefault();
	const target = event.getTargetRanges()[0];
	if (target && el.contains(target.startContainer)) {
		const range = document.createRange();
		range.setStart(target.startContainer, target.startOffset);
		range.setEnd(target.endContainer, target.endOffset);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}
	insertAtSelection(f, parseDraft(data.getData(DRAFT_MIME)) ?? textDraft(data.getData("text/plain")));
}

/** Put a draft where the selection is, mentions intact: paste and drop. */
function insertAtSelection(f: Field, nodes: Draft): void {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return;
	const range = selection.getRangeAt(0);
	range.deleteContents();
	const fragment = draftFragment(nodes, f.props.describe);
	const last = fragment.lastChild;
	range.insertNode(fragment);
	if (last) caretAfter(last);
	f.sync();
}

/** Copy, cut and drag carry two flavours: our draft, which keeps pills whole, and plain words. */
function carry(target: DataTransfer, draft: Draft): void {
	target.setData("text/plain", draftText(draft));
	target.setData(DRAFT_MIME, serializeDraft(draft));
}
