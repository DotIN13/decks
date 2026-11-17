import { isScribbleCatch } from "@decks/ui";
import { type Style } from "./card-styles.ts";
import { h } from "./card-words.ts";
import type { CardEditorProps } from "./card-editor-props.ts";

/** What `createCardKeys` reads of the editor (`CardEditor.tsx`). */
export interface CardKeysNeeds {
	readonly sel: () => Selection;
	done: boolean;
	readonly props: CardEditorProps;
	readonly serialise: () => string;
	readonly ed: HTMLDivElement;
	readonly changed: () => void;
	readonly travel: (back: boolean) => void;
	readonly restyle: (styles: Style[], value: string | null) => void;
	readonly dragging: HTMLElement | undefined;
	readonly endDrag: (cancel: boolean) => void;
	readonly wrap: HTMLDivElement;
}

/** Keys in the card, and its way out: commit, cancel, the caret put somewhere, words appended by dictation. */
export function createCardKeys(d: CardKeysNeeds) {
	/** The caret in an element: at its start, or with all of its words selected. */
	function caretInto(el: Element, all: boolean) {
		const r = document.createRange();
		r.selectNodeContents(el);
		if (!all) r.collapse(true);
		d.sel().removeAllRanges();
		d.sel().addRange(r);
	}

	/* ---------- in and out ---------- */

	function commit() {
		if (d.done) return;
		d.done = true;
		d.props.onCommit(d.serialise());
	}

	function onKeyDown(event: KeyboardEvent) {
		/*
		 * Home and End move the caret to the line's start and end, Shift extending the selection. On a Mac
		 * they scroll the nearest scroll area instead, which is now the stage (`camera/scroll-area.ts`):
		 * Home in a card sent the canvas some 110,000 units up. The note editor does the same itself.
		 */
		if ((event.key === "Home" || event.key === "End") && !event.metaKey && !event.ctrlKey && !event.altKey) {
			event.preventDefault();
			const selection = d.sel() as Selection & { modify?: (alter: string, direction: string, granularity: string) => void };
			selection.modify?.(event.shiftKey ? "extend" : "move", event.key === "Home" ? "backward" : "forward", "lineboundary");
			return;
		}
		const at = d.sel().anchorNode;
		const here = at ? (at.nodeType === 1 ? (at as Element) : at.parentElement) : null;
		// In a callout's title, Enter goes on to its first line.
		const chead = here?.closest(".pce-chead");
		if (event.key === "Enter" && chead && d.ed.contains(chead)) {
			event.preventDefault();
			const next = chead.nextElementSibling ?? chead.parentElement!.appendChild(h("p"));
			caretInto(next, false);
			return;
		}
		// In a table, Enter goes down a column (adding a row past the last), Tab across the cells.
		const cell = here?.closest("td, th") as HTMLTableCellElement | null;
		if (cell && d.ed.contains(cell) && ((event.key === "Enter" && !event.metaKey && !event.ctrlKey) || event.key === "Tab")) {
			event.preventDefault();
			const table = cell.closest("table")!;
			const rows = [...table.querySelectorAll("tr")];
			const row = cell.parentElement as HTMLTableRowElement;
			const r = rows.indexOf(row);
			const c = [...row.children].indexOf(cell);
			let target: Element | undefined;
			if (event.key === "Tab") {
				const flat = rows.flatMap((one) => [...one.children]);
				target = flat[flat.indexOf(cell) + (event.shiftKey ? -1 : 1)];
			} else {
				if (r === rows.length - 1) {
					const fresh = h("tr");
					for (let i = 0; i < row.children.length; i++) fresh.append(h("td"));
					table.querySelector("tbody")!.append(fresh);
					rows.push(fresh);
				}
				target = rows[r + 1]!.children[c];
			}
			if (target) caretInto(target, true);
			return d.changed();
		}
		const mod = event.metaKey || event.ctrlKey;
		// The card keeps its own history, since the browser's cannot follow what the toolbar does.
		if (mod && event.key.toLowerCase() === "z") {
			event.preventDefault();
			return d.travel(!event.shiftKey);
		}
		if (mod && event.key.toLowerCase() === "y") {
			event.preventDefault();
			return d.travel(false);
		}
		// ⌘B, ⌘I, ⌘U, ⌘E and ⌘⇧X go through the card's own styles, as the toolbar's buttons do.
		const keyed: Record<string, Style> = { b: "bold", i: "italic", u: "underline", x: "strike", e: "code" };
		const want = mod && keyed[event.key.toLowerCase()];
		if (want && (want !== "strike" || event.shiftKey) && !d.sel().isCollapsed) {
			event.preventDefault();
			d.restyle([want], "on");
			return d.changed();
		}
		if (event.key === "Escape") {
			event.preventDefault();
			if (d.dragging) return d.endDrag(true);
			d.done = true;
			d.props.onCancel(d.serialise());
		} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			commit();
		}
	}

	function onFocusOut(event: FocusEvent) {
		if (event.relatedTarget instanceof Node && d.wrap.contains(event.relatedTarget)) return;
		// The pencil writing over the canvas (`ScribbleCatch`): the card stays open until it is done.
		if (isScribbleCatch(event.relatedTarget)) return;
		// A press on the style bar or a piece keeps the focus where it was.
		setTimeout(() => {
			if (!d.done && !d.wrap.contains(document.activeElement) && !isScribbleCatch(document.activeElement)) commit();
		}, 0);
	}

	/** Handwritten words, at the end of the card's last line, as typing them there would put them. */
	function appendWords(text: string) {
		// The last line with words: the editor keeps an empty paragraph at the foot, which is not where writing goes on.
		const blocks = [...d.ed.children].filter((one) => (one as HTMLElement).getAttribute("contenteditable") !== "false");
		let end: Node = [...blocks].reverse().find((one) => (one.textContent ?? "").trim() !== "") ?? blocks[0] ?? d.ed;
		while (end.lastChild && end.lastChild.nodeType === 1 && (end.lastChild as HTMLElement).getAttribute("contenteditable") !== "false") end = end.lastChild;
		(end as Element).append(document.createTextNode(text));
		d.changed();
	}

	return {
		caretInto,
		onKeyDown,
		onFocusOut,
		appendWords,
		commit,
	};
}
