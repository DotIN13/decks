import { type JSX } from "solid-js";
import { inline, list, piece, url } from "./editor/inline.ts";
import { block, blockKind, build, cut } from "./editor/model.ts";
import { serialise, topOf } from "./editor/markup.ts";
import { appendWords, changed, commit, onClick, onDblClick, onFocusOut, onInput, onPaste, travel } from "./editor/actions.ts";
import { EditorView, closeMenus, hideMarks, lineSlot, placeBar, showBar, textSlot, toggleMenu } from "./editor/view.tsx";
import { insertBlock, restyle, setBlock, style } from "./editor/style.ts";
import { endDrag, local, mountEditor, onKeyDown, onPointerDown, onPointerMove } from "./editor/actions-press.ts";
import { binder, type DrawnElement, type EditorCtx } from "./editor/ctx.ts";

/**
 * The editor over a card (`CanvasView.tsx`): its words as they read, typed into in place, and written back
 * as the card's markdown (`card-syntax.ts`).
 *
 * Words style themselves as they are typed (`**bold**`, `==mark==`, `# ` at the start of a line), a
 * selection gets a bar of styles, an agent's suggestion waits for ✓ or ✕, and a picture, a file or a
 * `[[link]]` is a piece that drags: a whole-line piece between lines, an in-line one into a sentence,
 * with a ghost beside the pointer and a mark where it will land.
 *
 * A card can hold more than this editor can show as it reads: a table, raw HTML, a link definition.
 * Those stay as their markdown in a grey box, and a double click opens it as text. And a block that
 * was not touched is written back exactly as it was read: each top-level block keeps its source
 * (`data-raw`) until something in it changes, so an edit to one line never rewrites the rest.
 */

export interface CardEditorProps {
	value: string;
	/** Where the deck's files are, for the card's pictures. */
	base: string;
	/** A new empty line before this block, the caret in it: a double-click in a gap of the card. */
	insertAt?: number;
	/** Where the caret goes, a screen point: a double-click on the card's words. */
	caretAt?: { x: number; y: number };
	/** Items in the card the editor keeps but cannot type into, by id: what to call each (`card-frame.ts`). */
	held?: Record<string, string>;
	/** The camera's zoom: the editor is drawn in the stage's units, its style bar in the screen's. */
	zoom: number;
	class?: string;
	style: JSX.CSSProperties;
	onInput(markdown: string): void;
	onCommit(markdown: string): void;
	/** Escape: with the words as they are now, for a card just made, which keeps them. */
	onCancel(markdown: string): void;
}

export function CardEditor(props: CardEditorProps) {
	/*
	 * Its state and each part's functions bound to it, which the parts call each other by, in one
	 * literal: a field left out does not compile. The elements are filled by the view's refs as it is
	 * drawn (`EditorView`), so they alone are read only once it is: in mountEditor's onMount and after.
	 */
	const by = binder(() => cx);
	const state: Omit<EditorCtx, DrawnElement> = {
		props,
		lead: "",
		trail: "",
		done: false,
		frame: undefined,
		past: [],
		future: [],
		wanted: false,
		selecting: false,
		settleBar: undefined,
		dragging: undefined,
		ghost: undefined,
		press: undefined,
		target: undefined,
		url: by(url),
		piece: by(piece),
		inline: by(inline),
		list: by(list),
		block: by(block),
		build: by(build),
		serialise: by(serialise),
		topOf: by(topOf),
		onInput: by(onInput),
		changed: by(changed),
		travel: by(travel),
		onPaste: by(onPaste),
		placeBar: by(placeBar),
		showBar: by(showBar),
		toggleMenu: by(toggleMenu),
		closeMenus: by(closeMenus),
		insertBlock: by(insertBlock),
		cut: by(cut),
		restyle: by(restyle),
		style: by(style),
		blockKind: by(blockKind),
		setBlock: by(setBlock),
		onClick: by(onClick),
		onDblClick: by(onDblClick),
		local: by(local),
		hideMarks: by(hideMarks),
		lineSlot: by(lineSlot),
		textSlot: by(textSlot),
		onPointerDown: by(onPointerDown),
		onPointerMove: by(onPointerMove),
		endDrag: by(endDrag),
		commit: by(commit),
		onKeyDown: by(onKeyDown),
		onFocusOut: by(onFocusOut),
		appendWords: by(appendWords),
	};
	const cx = state as EditorCtx;
	mountEditor(cx);
	return EditorView(cx);
}
