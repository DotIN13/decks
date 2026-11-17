import { h, ZW } from "./card-words.ts";
import type { CardEditorProps } from "./card-editor-props.ts";

/** What `placeFirstCaret` reads of the editor (`CardEditor.tsx`). */
export interface PlaceFirstCaretNeeds {
	readonly ed: HTMLDivElement;
	readonly props: CardEditorProps;
	readonly caretInto: (el: Element, all: boolean) => void;
	readonly sel: () => Selection;
}

/** Where the caret starts when the editor opens: in a new line, where the double-click landed, or at the end. */
export function placeFirstCaret(d: PlaceFirstCaretNeeds) {
	requestAnimationFrame(() => {
		d.ed.focus({ preventScroll: true });
		// A double-click in a gap: a new line there, empty until something is typed in it.
		if (d.props.insertAt !== undefined) {
			const line = h("p");
			line.append(document.createTextNode(ZW));
			const before = d.ed.children[Math.max(0, Math.min(d.props.insertAt, d.ed.children.length))] ?? null;
			const lone = d.ed.children.length === 1 && !d.ed.firstElementChild!.textContent!.replace(/\u200b/g, "").trim() ? (d.ed.firstElementChild as HTMLElement) : undefined;
			if (lone) d.caretInto(lone, false);
			else {
				d.ed.insertBefore(line, before);
				d.caretInto(line, false);
				const r = d.sel().getRangeAt(0);
				r.setStart(line.firstChild!, 1);
				r.collapse(true);
			}
			return;
		}
		// A double-click on the words: the caret where it landed.
		const point = d.props.caretAt;
		const there = point ? (document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(point.x, point.y) : null;
		if (there && d.ed.contains(there.startContainer) && !(there.startContainer.parentElement?.closest("[contenteditable=false]"))) {
			d.sel().removeAllRanges();
			d.sel().addRange(there);
			return;
		}
		// The caret at the end of the last block's words, inside it, so typing continues that block.
		let end: Node = d.ed;
		while (end.lastChild && end.lastChild.nodeType === 1 && (end.lastChild as HTMLElement).getAttribute("contenteditable") !== "false") end = end.lastChild;
		const r = document.createRange();
		r.selectNodeContents(end);
		r.collapse(false);
		d.sel().removeAllRanges();
		d.sel().addRange(r);
	});

}
