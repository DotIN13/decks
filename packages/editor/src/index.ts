/**
 * The surface: one function, and everything it cannot do alone is an argument.
 *
 *     const editor = createEditor(frame, {
 *       source,                       // the file's bytes
 *       base: "/api/board/boards/",   // so the board's own relative URLs resolve
 *       mode: () => "edit",           // a getter, so the app's signal drives it
 *       onOps: (patches) => send(patches),
 *       onSelect: (selection) => inspector.show(selection),
 *     });
 *
 * The package never opens a socket, never reads or writes a file, and never renders anything but the
 * board. That is the boundary in one sentence, and it is what makes the editor testable without the
 * app — `apps/web/editor.html` mounts it over a board and prints what it would have sent.
 *
 * ### The gate
 *
 * One attribute on the frame's own root, `data-decks-edit`, and every rule and listener hangs off it.
 * In browse nothing is set and nothing happens: the board behaves exactly as it does for a reader. In
 * edit a press resolves to a node and is outlined by an *outline* — which takes no space — so a board
 * being edited lays out identically to one being read. That is the same reason a handle is an
 * attribute rather than a wrapper: nothing about editing may move the page.
 */
import type { ComponentKind } from "@decks/board-kit";
import type { EditorOp } from "@decks/protocol";
import { nodeAt as nodeAtPath, pathOf as pathFor } from "./address.ts";
import { collectHandles, HANDLE_ATTRIBUTE } from "./handles.ts";
import type { TreeNode } from "./node.ts";
import { parseBoard, type Tree } from "./parse.ts";
import { attachGestures, insertAt } from "./gestures.ts";
import { describe, isProjection, type Selection } from "./select.ts";
import { serialize } from "./serialize.ts";
import { shapeOf } from "./shape.ts";

export type Mode = "browse" | "edit";

export interface EditorOptions {
	/** The board file's own bytes. */
	source: string;
	/** The URL the board's relative paths resolve against: `/api/board/<dir>/`. */
	base?: string;
	/** Which mode the frame is in. Read every time, so the app's signal drives it. */
	mode?: () => Mode;
	/** Where an edit would go. Called with the ops the editor produced, and with nothing else. */
	onOps?: (patches: unknown[]) => void;
	/** Called when the frame has rendered and the handles are collected. */
	onRendered?: () => void;
	/** Called when the board's own scripts have finished their first draw. */
	onReady?: () => void;
	/** Called whenever the selection changes: a node, or nothing. */
	onSelect?: (selection: Selection | undefined) => void;
}

/** What a press may be made on: an element, an event's target, or nothing to clear the selection. */
export type SelectionTarget = EventTarget | Node | null | undefined;

export interface Editor {
	/** The tree, for tests and for anything the app wants to ask about the document. */
	tree: Tree;
	/** Re-render from the same tree — after the frame's document was replaced, or on request. */
	render(): void;
	/** Swap the source and re-render. */
	setSource(source: string): void;
	/** The node a press landed on, by handle lookup. */
	nodeFromEvent(target: SelectionTarget): TreeNode | undefined;
	/** The path of a node, from the body. */
	pathOf(node: TreeNode): number[] | undefined;
	/** The document in the frame, once it has one. */
	document(): Document | undefined;
	/** The shape of what is rendered — the differential's subject. */
	shape(): string;
	/** What is selected, if anything. */
	selection(): Selection | undefined;
	/** Select a node by its element, or clear the selection with `undefined`. */
	select(target: SelectionTarget): Selection | undefined;
	/** Apply the mode to the frame now, rather than waiting for the next press. */
	setMode(): void;
	/** Put a new component in at a point in board pixels — what a palette button calls. */
	insert(kind: ComponentKind, at: { x: number; y: number }): EditorOp | undefined;
	destroy(): void;
}

const STYLE_ID = "decks-editor-style";

/**
 * The editor's own look, injected into the board's document.
 *
 * Outlines only: an outline takes no space, so the affordance cannot move the thing it points at.
 * `var(--b-accent, …)` is the board stylesheet's own token where it has one, and a hard fallback where
 * it does not — the editor draws inside somebody else's document and should look like a guest in it.
 */
const CSS = `
:root[data-decks-edit] [${HANDLE_ATTRIBUTE}]:not(body):not(html):not(head):hover {
	outline: 1px dashed var(--b-accent, #6b7280);
	outline-offset: 2px;
}
:root[data-decks-edit] [data-node-selected] {
	outline: 2px solid var(--b-accent, #2563eb);
	outline-offset: 2px;
}
:root[data-decks-edit] [data-node-selected][data-projection] {
	outline-style: dashed;
}
`;

/** An element, tested structurally: a frame's nodes are another realm's `Element`. */
function asElement(target: SelectionTarget): Element | undefined {
	const node = target as Node | null | undefined;
	if (!node || node.nodeType !== 1) return undefined;
	return node as Element;
}

export function createEditor(frame: HTMLIFrameElement, options: EditorOptions): Editor {
	let tree = parseBoard(options.source);
	let rendered: Document | undefined;
	let selection: Selection | undefined;
	let ready = false;

	/*
	 * The document goes in whole, through `srcdoc`.
	 *
	 * Three mechanisms were tried and two of them are wrong:
	 *
	 * - **`innerHTML` on a body** — the browser then never fires `DOMContentLoaded`, and `board.js`
	 *   starts on that event, so the panels are never drawn.
	 * - **`document.open()/write()/close()`** — correct in principle and a race in practice: written
	 *   while the frame is still on its initial `about:blank`, the parser merges our document into the
	 *   one it has already begun, and the merge is silent. Measured, on the first board the check ran:
	 *   the head's `<style>` was gone and the body's `<script>` had been hoisted into the head — one tag
	 *   and one text node away from the file, which the differential caught and a person would not have.
	 * - **`srcdoc`** — what this does. The browser parses a complete document, in a fresh parser, with
	 *   its own head, and fires the events a board's script expects. The one thing it does not give is
	 *   the board's URL — an srcdoc document resolves relative URLs against its parent — which is
	 *   exactly what `serialize`'s injected `<base>` is for.
	 *
	 * So rendering is asynchronous by construction: the handles can only be collected once the frame
	 * has parsed what we wrote, which is what `load` means.
	 */
	function render(): void {
		ready = false;
		rendered = undefined;
		frame.srcdoc = serialize(tree, { base: options.base });
	}

	frame.addEventListener("load", () => {
		const doc = frame.contentDocument;
		if (!doc || !doc.body) return;
		rendered = doc;
		collectHandles(tree.root, doc);
		dress(doc);
		reselection();
		options.onRendered?.();

		/*
		 * And the board's script says when it has drawn.
		 *
		 * `board.js` keeps `window.__boardReady` false then true around each draw and dispatches
		 * `board:ready` once — a flag to wait on rather than a timeout to guess at, which is the only
		 * honest way to know a panel is drawn rather than pending.
		 */
		const win = frame.contentWindow as (Window & { __boardReady?: boolean }) | null;
		if (!win) return;
		const done = () => {
			ready = true;
			options.onReady?.();
		};
		if (win.__boardReady) done();
		else doc.addEventListener("board:ready", done, { once: true });
	});

	/** Whether the frame is in edit mode *now*: the getter is authoritative, the attribute is a memo. */
	function editing(): boolean {
		return (options.mode?.() ?? "edit") === "edit";
	}

	/** Apply the mode to the frame's root. Called on every press as well as by `setMode`. */
	function applyMode(doc: Document | undefined = rendered): void {
		const root = doc?.documentElement;
		if (!root) return;
		if (editing()) root.setAttribute("data-decks-edit", "");
		else root.removeAttribute("data-decks-edit");
	}

	/** The attribute and the stylesheet, re-applied on every document the editor renders. */
	function dress(doc: Document): void {
		if (!doc.head) return;
		let style = doc.getElementById(STYLE_ID);
		if (!style) {
			style = doc.createElement("style");
			style.id = STYLE_ID;
			doc.head.append(style);
		}
		style.textContent = CSS;
		applyMode(doc);
		mark();
	}

	/** The selected element carries the attribute the stylesheet outlines. */
	function mark(): void {
		for (const element of rendered?.querySelectorAll("[data-node-selected], [data-projection]") ?? []) {
			element.removeAttribute("data-node-selected");
			element.removeAttribute("data-projection");
		}
		const element = selection?.node.element;
		if (!element) return;
		element.setAttribute("data-node-selected", "");
		if (isProjection(selection!.node)) element.setAttribute("data-projection", "");
	}

	/** The node whose handle is on this element, or on the nearest ancestor that has one. */
	function nodeFromElement(element: Element): TreeNode | undefined {
		const handled = (element.closest?.(`[${HANDLE_ATTRIBUTE}]`) as Element | null) ?? element;
		const handle = handled.getAttribute(HANDLE_ATTRIBUTE);
		if (handle === null) return undefined;
		let found: TreeNode | undefined;
		const walk = (node: TreeNode) => {
			if (found) return;
			if (node.handle === handle) found = node;
			for (const part of node.parts) if (part.kind === "element") walk(part.node);
		};
		walk(tree.root);
		return found;
	}

	function nodeFromEvent(target: SelectionTarget): TreeNode | undefined {
		const element = asElement(target);
		return element ? nodeFromElement(element) : undefined;
	}

	/** Select what a press landed on — or nothing, which is what a press on empty space means. */
	function select(target: SelectionTarget): Selection | undefined {
		if (!editing()) return undefined;
		const node = nodeFromEvent(target);
		selection = node ? describe(node, tree.root) : undefined;
		mark();
		options.onSelect?.(selection);
		return selection;
	}

	/** A selection outlives a re-render: the frame is replaced, and what was being worked on should not vanish with it. */
	function reselection(): void {
		const path = selection?.path;
		if (!path) return;
		const node = nodeAtPath(tree.root, path);
		selection = node ? describe(node, tree.root) : undefined;
		mark();
		options.onSelect?.(selection);
	}

	/** The gestures, attached once the frame has a document to attach them to. */
	let detachGestures: (() => void) | undefined;

	/*
	 * Two listeners, both gated, both in the capture phase so they see a press before the board does.
	 *
	 * - **`pointerdown` selects and does not stop the event**, because a press inside a board is also how
	 *   the *canvas* knows which board is being worked on — that rule is the app's, and it holds in
	 *   either mode.
	 * - **`click` is stopped when there is a selection**, so that editing a board does not follow a link
	 *   in it. Selecting is not a visit.
	 */
	frame.addEventListener("load", () => {
		const doc = frame.contentDocument;
		if (!doc) return;
		doc.addEventListener(
			"pointerdown",
			(event) => {
				applyMode(doc);
				if (!editing()) return;
				select(event.target as Element);
			},
			true,
		);
		doc.addEventListener(
			"click",
			(event) => {
				if (!editing() || !selection) return;
				event.preventDefault();
				event.stopPropagation();
			},
			true,
		);

		// And the gestures: drag, resize, delete, duplicate — each ending in one of the eight ops.
		detachGestures?.();
		detachGestures = attachGestures({
			editing,
			root: () => tree.root,
			document: () => rendered,
			selection: () => selection,
			nodeFromEvent,
			emit: (op) => options.onOps?.([op]),
			remark: () => mark(),
			rendered: () => undefined,
		});
	});

	render();

	return {
		get tree() {
			return tree;
		},
		render,
		setSource(source: string) {
			tree = parseBoard(source);
			render();
		},
		nodeFromEvent,
		pathOf(node) {
			return pathFor(tree.root, node);
		},
		document() {
			return rendered;
		},
		shape() {
			return rendered ? shapeOf(rendered) : "";
		},
		selection() {
			return selection;
		},
		select,
		setMode() {
			applyMode();
		},
		insert(kind, at) {
			return insertAt({ root: () => tree.root, emit: (op) => options.onOps?.([op]) }, kind, at);
		},
		destroy() {
			detachGestures?.();
			rendered = undefined;
			selection = undefined;
			frame.removeAttribute("srcdoc");
		},
	};
}

export { parseBoard, serialize, shapeOf, nodeAtPath, pathFor, collectHandles };
export { describe, isProjection, kindOf, sourceOf, selectable, STRUCTURAL, PROJECTION_ATTRIBUTES } from "./select.ts";
export { ops, wordsOf, rectOf, addressOf } from "./ops.ts";
export { GRID, snap, markupFor, insertAt, paletteOf, insertBreak, normaliseRun, flattenBlocks } from "./gestures.ts";
export type { GestureHost } from "./gestures.ts";
export type { Op, SetOp, TextOp, InsertOp, RemoveOp, MoveOp, ReplaceOp, DuplicateOp, SourceOp } from "./ops.ts";
export type { ComponentKind } from "@decks/board-kit";
export type { Selection, SelectionKind } from "./select.ts";
export type { TreeNode };
export { elementParts, bodyOf } from "./node.ts";
export { assignHandles, HANDLE_ATTRIBUTE } from "./handles.ts";
