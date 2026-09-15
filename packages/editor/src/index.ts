/**
 * The surface: one function, and everything it cannot do alone is an argument.
 *
 *     const editor = createEditor(frame, {
 *       source,                       // the file's bytes
 *       base: "/api/board/boards/",   // so the board's own relative URLs resolve
 *       mode: () => "edit",           // a getter, so the app's signal drives it
 *       onOps: (patches) => send(patches),
 *     });
 *
 * The package never opens a socket, never reads or writes a file, and never renders anything but the
 * board. That is the boundary in one sentence, and it is what makes the editor testable without the
 * app — `apps/web/editor.html` mounts it over a board and prints the ops instead of sending them.
 *
 * What it does here, in this first phase: render the tree into the frame, collect the handles back,
 * and answer questions about what is where. The gestures — a press resolving to a node, drag, resize,
 * reorder, the palette, the caret, and the eight ops they produce — are the phases after this one,
 * and the mode gate they will hang off is already here.
 */
import { nodeAt as nodeAtPath, pathOf as pathFor } from "./address.ts";
import { collectHandles } from "./handles.ts";
import type { TreeNode } from "./node.ts";
import { parseBoard, type Tree } from "./parse.ts";
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
}

export interface Editor {
	/** The tree, for tests and for anything the app wants to ask about the document. */
	tree: Tree;
	/** Re-render from the same tree — after the frame's document was replaced, or on request. */
	render(): void;
	/** Swap the source and re-render. */
	setSource(source: string): void;
	/** The node a press landed on, by handle lookup. */
	nodeFromEvent(target: EventTarget | null): TreeNode | undefined;
	/** The path of a node, from the body. */
	pathOf(node: TreeNode): number[] | undefined;
	/** The document in the frame, once it has one. */
	document(): Document | undefined;
	/** The shape of what is rendered — the differential's subject. */
	shape(): string;
	destroy(): void;
}

export function createEditor(frame: HTMLIFrameElement, options: EditorOptions): Editor {
	let tree = parseBoard(options.source);
	let rendered: Document | undefined;
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
	 *   the head's `<style>` was gone and the body's `<script>` had been hoisted into the head — a
	 *   document one text node and one tag away from the file, which the differential caught and a
	 *   person would not have.
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
		nodeFromEvent(target) {
			const element = (target as Element | null)?.closest?.("[data-node]");
			const handle = element?.getAttribute("data-node");
			if (!handle) return undefined;
			let found: TreeNode | undefined;
			const walk = (node: TreeNode) => {
				if (found) return;
				if (node.handle === handle) found = node;
				for (const part of node.parts) if (part.kind === "element") walk(part.node);
			};
			walk(tree.root);
			return found;
		},
		pathOf(node) {
			return pathFor(tree.root, node);
		},
		document() {
			return rendered;
		},
		shape() {
			return rendered ? shapeOf(rendered) : "";
		},
		destroy() {
			frame.removeAttribute("srcdoc");
			frame.contentDocument?.open();
			frame.contentDocument?.write("");
			frame.contentDocument?.close();
		},
	};
}

export { parseBoard, serialize, shapeOf, nodeAtPath, pathFor, collectHandles };
export type { TreeNode };
export { elementParts, bodyOf } from "./node.ts";
export { assignHandles, HANDLE_ATTRIBUTE } from "./handles.ts";
