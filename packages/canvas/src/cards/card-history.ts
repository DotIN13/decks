import type { CardEditorProps } from "./card-editor-props.ts";

/** What `createCardHistory` reads of the editor (`CardEditor.tsx`). */
export interface CardHistoryNeeds {
	readonly done: boolean;
	readonly serialise: () => string;
	readonly props: CardEditorProps;
	readonly showBar: () => void;
	readonly build: (md: string) => void;
	readonly ed: HTMLDivElement;
	readonly caretInto: (el: Element, all: boolean) => void;
	readonly sel: () => Selection;
}

/** What the card said after each change, for undo and redo, and telling the canvas of a change once a frame. */
export function createCardHistory(d: CardHistoryNeeds) {
	let frame: number | undefined;

	/** What the card said after each change, for undo; what was undone, for redo. */
	const past: string[] = [];

	const future: string[] = [];

	function changed() {
		frame ??= requestAnimationFrame(() => {
			frame = undefined;
			if (d.done) return;
			const now = d.serialise();
			if (past.at(-1) !== now) {
				past.push(now);
				if (past.length > 200) past.shift();
				future.length = 0;
			}
			d.props.onInput(now);
		});
		d.showBar();
	}

	function travel(back: boolean) {
		const from = back ? past : future;
		const to = back ? future : past;
		if (back ? from.length < 2 : !from.length) return;
		const moved = from.pop()!;
		to.push(moved);
		const md = back ? past.at(-1)! : moved;
		d.build(md);
		let end: Node = d.ed;
		while (end.lastChild && end.lastChild.nodeType === 1 && (end.lastChild as HTMLElement).getAttribute("contenteditable") !== "false") end = end.lastChild;
		d.caretInto(end as Element, false);
		const r = d.sel().getRangeAt(0);
		r.selectNodeContents(end);
		r.collapse(false);
		d.props.onInput(md);
		d.showBar();
	}

	return {
		changed,
		travel,
		past,
		get frame() {
			return frame;
		},
		set frame(next) {
			frame = next;
		},
	};
}
