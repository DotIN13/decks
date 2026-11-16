// The one state the card editor's parts share: the component's props, its elements,
// what it remembers between events, and its functions bound to that state.
import type { CardEditorProps } from "../CardEditor.tsx";
import type * as inline from "./inline.ts";
import type * as model from "./model.ts";
import type * as markup from "./markup.ts";
import type * as selection from "./selection.ts";
import type * as actions from "./actions.ts";
import type * as view from "./view.tsx";
import type * as style from "./style.ts";
import type * as actionsPress from "./actions-press.ts";

/** A part's function, as the others call it: with the state already given. */
type Bound<F> = F extends (cx: EditorCtx, ...args: infer A) => infer R ? (...args: A) => R : never;

/** The elements the view's refs fill as it is drawn: the only fields read only once it is. */
export type DrawnElement = "wrap" | "ed" | "bar" | "caret" | "tools" | "line";

export interface EditorCtx {
	props: CardEditorProps;
	wrap: HTMLDivElement;
	ed: HTMLDivElement;
	bar: HTMLDivElement;
	caret: HTMLDivElement;
	tools: HTMLDivElement;
	line: HTMLDivElement;
	/** Whitespace before the first block, kept as it was. */
	lead: string;
	trail: string;
	done: boolean;
	frame: number | undefined;
	/** What the card said after each change, for undo; what was undone, for redo. */
	past: string[];
	future: string[];
	/** The bar is wanted: words are selected in the editor, and no piece is being dragged. */
	wanted: boolean;
	/**
	 * A pointer is selecting words. The bar shows once a selection stops changing, not while it is
	 * being made: a pointer's when it lifts, the keyboard's after a short pause (`SELECTION_PAUSE_MS`).
	 */
	selecting: boolean;
	settleBar: ReturnType<typeof setTimeout> | undefined;
	dragging: HTMLElement | undefined;
	ghost: HTMLElement | undefined;
	press: { it: HTMLElement; x: number; y: number; id: number } | undefined;
	target: { kind: "line"; before: Element | null } | { kind: "text"; range: Range } | undefined;
	url: Bound<typeof inline.url>;
	piece: Bound<typeof inline.piece>;
	inline: Bound<typeof inline.inline>;
	list: Bound<typeof inline.list>;
	block: Bound<typeof model.block>;
	build: Bound<typeof model.build>;
	serialise: Bound<typeof markup.serialise>;
	topOf: Bound<typeof selection.topOf>;
	onInput: Bound<typeof actions.onInput>;
	changed: Bound<typeof actions.changed>;
	travel: Bound<typeof actions.travel>;
	onPaste: Bound<typeof actions.onPaste>;
	placeBar: Bound<typeof view.placeBar>;
	showBar: Bound<typeof view.showBar>;
	toggleMenu: Bound<typeof view.toggleMenu>;
	closeMenus: Bound<typeof view.closeMenus>;
	insertBlock: Bound<typeof style.insertBlock>;
	cut: Bound<typeof style.cut>;
	restyle: Bound<typeof style.restyle>;
	style: Bound<typeof style.style>;
	blockKind: Bound<typeof style.blockKind>;
	setBlock: Bound<typeof style.setBlock>;
	onClick: Bound<typeof actions.onClick>;
	onDblClick: Bound<typeof actions.onDblClick>;
	local: Bound<typeof view.local>;
	hideMarks: Bound<typeof view.hideMarks>;
	lineSlot: Bound<typeof view.lineSlot>;
	textSlot: Bound<typeof view.textSlot>;
	onPointerDown: Bound<typeof actionsPress.onPointerDown>;
	onPointerMove: Bound<typeof actionsPress.onPointerMove>;
	endDrag: Bound<typeof actionsPress.endDrag>;
	commit: Bound<typeof actions.commit>;
	onKeyDown: Bound<typeof actionsPress.onKeyDown>;
	onFocusOut: Bound<typeof actions.onFocusOut>;
	appendWords: Bound<typeof actions.appendWords>;
}

/** A part's function with the state given, for the others to call: the state is read when it is called, so it may be made after. */
export function binder(cx: () => EditorCtx) {
	return <A extends unknown[], R>(f: (cx: EditorCtx, ...args: A) => R) => (...args: A): R => f(cx(), ...args);
}
