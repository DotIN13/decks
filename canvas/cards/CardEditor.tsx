import { type JSX } from "solid-js";
import { inline, list, piece, url } from "./editor/inline.ts";
import { block, blockKind, build, cut } from "./editor/model.ts";
import { serialise, topOf } from "./editor/markup.ts";
import { appendWords, changed, commit, onClick, onDblClick, onFocusOut, onInput, onPaste, travel } from "./editor/actions.ts";
import { EditorView, closeMenus, hideMarks, lineSlot, placeBar, showBar, textSlot, toggleMenu } from "./editor/view.tsx";
import { insertBlock, restyle, setBlock, style } from "./editor/style.ts";
import { endDrag, local, mountEditor, onKeyDown, onPointerDown, onPointerMove } from "./editor/actions-press.ts";
import { bind, type EditorCtx } from "./editor/ctx.ts";

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
	// Its state first, then each part's functions bound to it, which the parts call each other by.
	const cx = { props, lead: "", trail: "", done: false, past: [], future: [], wanted: false, selecting: false } as unknown as EditorCtx;
	cx.url = bind(cx, url);
	cx.piece = bind(cx, piece);
	cx.inline = bind(cx, inline);
	cx.list = bind(cx, list);
	cx.block = bind(cx, block);
	cx.build = bind(cx, build);
	cx.serialise = bind(cx, serialise);
	cx.topOf = bind(cx, topOf);
	cx.onInput = bind(cx, onInput);
	cx.changed = bind(cx, changed);
	cx.travel = bind(cx, travel);
	cx.onPaste = bind(cx, onPaste);
	cx.placeBar = bind(cx, placeBar);
	cx.showBar = bind(cx, showBar);
	cx.toggleMenu = bind(cx, toggleMenu);
	cx.closeMenus = bind(cx, closeMenus);
	cx.insertBlock = bind(cx, insertBlock);
	cx.cut = bind(cx, cut);
	cx.restyle = bind(cx, restyle);
	cx.style = bind(cx, style);
	cx.blockKind = bind(cx, blockKind);
	cx.setBlock = bind(cx, setBlock);
	cx.onClick = bind(cx, onClick);
	cx.onDblClick = bind(cx, onDblClick);
	cx.local = bind(cx, local);
	cx.hideMarks = bind(cx, hideMarks);
	cx.lineSlot = bind(cx, lineSlot);
	cx.textSlot = bind(cx, textSlot);
	cx.onPointerDown = bind(cx, onPointerDown);
	cx.onPointerMove = bind(cx, onPointerMove);
	cx.endDrag = bind(cx, endDrag);
	cx.commit = bind(cx, commit);
	cx.onKeyDown = bind(cx, onKeyDown);
	cx.onFocusOut = bind(cx, onFocusOut);
	cx.appendWords = bind(cx, appendWords);
	mountEditor(cx);
	return EditorView(cx);
}
