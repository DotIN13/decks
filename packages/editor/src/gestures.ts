/**
 * The gestures: each one is a pointer or a key, and each one ends in one of the eight ops.
 *
 * Nothing here knows what kind of board it is standing on. A node that carries `left`/`top` is one you
 * can drag and resize; a node that does not is one you can only move among its siblings — and that is the
 * whole of the distinction between a "component" and a "block", which used to be two vocabularies and a
 * fork in every gesture. It is now a style attribute.
 *
 * Three things every gesture here shares, and they are the design rather than an implementation detail:
 *
 * - **The edit happens in the frame first.** A drag moves the element under the pointer and *then* emits
 *   the op, so what a person sees while dragging is what they will see afterwards. The op is how the file
 *   catches up, not how the screen does.
 * - **The tree is updated with the preview.** The node's own attributes are rewritten as the element is,
 *   so the next gesture starts from what is on screen and a re-render is not a step backwards. This is the
 *   only place the editor writes to its own tree, and it is why a drag needs no round trip.
 * - **The op carries only what changed.** `left` and `top` for a drag, `width` and `height` for a resize —
 *   because the server merges the declarations it is given into the ones already in the file, and every
 *   declaration it is *not* given comes out exactly as it went in. A drag is therefore a one-line diff.
 */
import { COMPONENTS, PALETTE, type ComponentKind } from "@decks/board-kit";
import type { EditorOp } from "@decks/protocol";
import { nodeAt, pathOf } from "./address.ts";
import { bodyOf, elementParts, type TreeNode } from "./node.ts";
import { ops, rectOf } from "./ops.ts";
import { describe, isProjection, type Selection } from "./select.ts";

/** What a palette offers: the kinds `board-kit` says can be placed, with their labels and sizes. */
export const paletteOf = (): readonly (typeof PALETTE)[number][] => PALETTE;

/** The grid a drag snaps to, in board pixels. The same 8 the app has always used. */
export const GRID = 8;
/** How close to an edge a press has to be to mean "resize" rather than "drag". */
const EDGE = 8;

/**
 * Snap to the grid — and never to negative zero.
 *
 * `Math.round(-0.375) * 8` is `-0`, which is equal to `0` under `===` and not under `Object.is`, and would
 * print as `-0px` nowhere and confuse a comparison somewhere. One addition, and it is a number.
 */
export const snap = (value: number): number => Math.round(value / GRID) * GRID + 0;

export interface GestureHost {
	/** Whether the frame is in edit mode *now*. */
	editing(): boolean;
	/** The tree's root. */
	root(): TreeNode;
	document(): Document | undefined;
	selection(): Selection | undefined;
	nodeFromEvent(target: EventTarget | null): TreeNode | undefined;
	/** Hand an op to whoever is listening. */
	emit(op: EditorOp): void;
	/** Re-outline after a preview changed what "selected" looks like. */
	remark(): void;
	/** Put a newly inserted node's markup in the frame, so the palette's press has something to show. */
	rendered(): void;
}

/** The style an element's `style` attribute holds, as pairs — the tree's copy, not the file's. */
function styleOf(node: TreeNode): Record<string, string> {
	const text = node.attrs.find(([name]) => name === "style")?.[1] ?? "";
	const out: Record<string, string> = {};
	for (const piece of text.split(";")) {
		const [name, value] = piece.split(":").map((part) => part.trim());
		if (name && value) out[name] = value;
	}
	return out;
}

/** Write declarations onto the tree node, keeping the order the file has and adding at the end. */
function setStyle(node: TreeNode, changes: Record<string, string>): void {
	const style = { ...styleOf(node), ...changes };
	const text = Object.entries(style)
		.map(([name, value]) => `${name}: ${value}`)
		.join("; ");
	const existing = node.attrs.findIndex(([name]) => name === "style");
	if (existing === -1) node.attrs.push(["style", text]);
	else node.attrs[existing] = ["style", text];
}

/** A name nothing in the board is using yet: `sticky`, `sticky-2`, … */
function freshId(root: TreeNode, kind: string): string {
	const taken = new Set<string>();
	const walk = (node: TreeNode) => {
		const id = node.attrs.find(([name]) => name === "data-id")?.[1];
		if (id) taken.add(id);
		for (const part of node.parts) if (part.kind === "element") walk(part.node);
	};
	walk(root);
	if (!taken.has(kind)) return kind;
	for (let n = 2; ; n++) if (!taken.has(`${kind}-${n}`)) return `${kind}-${n}`;
}

/**
 * The markup a new component is made of.
 *
 * Composed here rather than asked of the server, because the palette is a client thing and the server's
 * job is to decide whether markup may enter a file — which it does on the way in. `board-kit` is the
 * catalogue both sides agree on, so the class, the size and the placeholder words come from one list.
 */
export function markupFor(root: TreeNode, kind: ComponentKind, at: { x: number; y: number }): string {
	const spec = COMPONENTS.find((candidate) => candidate.kind === kind) ?? COMPONENTS[0]!;
	const id = freshId(root, spec.kind);
	const width = `width: ${spec.size.width}px`;
	const height = spec.size.height ? `; height: ${spec.size.height}px` : "";
	const style = `left: ${snap(at.x)}px; top: ${snap(at.y)}px; ${width}${height}`;
	const words = spec.text ?? "";
	return `<div class="${spec.className}" data-id="${id}" style="${style}">${words}</div>`;
}

/** Attach every gesture to the frame. Returns the undo, for `destroy`. */
export function attachGestures(host: GestureHost): () => void {
	const frame = host.document()?.defaultView;
	if (!frame) return () => {};

	/** A gesture in progress: a drag, a resize, or nothing. */
	let live:
		| {
				node: TreeNode;
				element: HTMLElement;
				from: { x: number; y: number };
				start: { left: number; top: number; width: number; height: number };
				resizing: boolean;
				moved: boolean;
		  }
		| undefined;

	const number = (value: string | undefined): number => Number.parseFloat(value ?? "0") || 0;

	function down(event: PointerEvent): void {
		if (!host.editing() || live) return;
		const target = event.target as Element | null;
		// A caret wins: while a run is being typed into, a press belongs to the text.
		if ((target as HTMLElement | null)?.isContentEditable) return;
		const node = host.nodeFromEvent(target);
		if (!node || isProjection(node)) return;
		const rect = rectOf(node);
		if (rect.left === undefined) return;

		const element = node.element as HTMLElement | undefined;
		if (!element) return;
		const box = element.getBoundingClientRect();
		const resizing = event.clientX > box.right - EDGE || event.clientY > box.bottom - EDGE;
		live = {
			node,
			element,
			from: { x: event.clientX, y: event.clientY },
			start: {
				left: Number.parseFloat(rect.left),
				top: number(rect.top),
				width: number(rect.width) || box.width,
				height: number(rect.height) || box.height,
			},
			resizing,
			moved: false,
		};
		element.setPointerCapture?.(event.pointerId);
	}

	function move(event: PointerEvent): void {
		if (!live) return;
		const dx = event.clientX - live.from.x;
		const dy = event.clientY - live.from.y;
		if (!live.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
		live.moved = true;

		/*
		 * The preview: the element moves, and the tree's own attributes move with it.
		 *
		 * The tree has to keep up — a re-render draws from it, and the next gesture measures the node
		 * rather than the DOM. This is the only place the editor writes to its tree, and it is what makes a
		 * drag need no round trip: what you see is already what the file is about to be.
		 */
		const changes: Record<string, string> = live.resizing
			? {
					width: `${Math.max(GRID, snap(live.start.width + dx))}px`,
					height: `${Math.max(GRID, snap(live.start.height + dy))}px`,
				}
			: { left: `${snap(live.start.left + dx)}px`, top: `${snap(live.start.top + dy)}px` };
		for (const [name, value] of Object.entries(changes)) live.element.style.setProperty(name, value);
		setStyle(live.node, changes);
		host.remark();
	}

	function up(event: PointerEvent): void {
		const gesture = live;
		live = undefined;
		if (!gesture || !gesture.moved) return;
		gesture.element.releasePointerCapture?.(event.pointerId);

		/*
		 * And then the op — carrying only what the gesture changed, which is what keeps the diff to one
		 * line: the server merges declarations into the ones already in the file.
		 */
		const rect = rectOf(gesture.node);
		const style: Record<string, string> = {};
		if (gesture.resizing) {
			if (rect.width) style.width = rect.width;
			if (rect.height) style.height = rect.height;
		} else {
			if (rect.left) style.left = rect.left;
			if (rect.top) style.top = rect.top;
		}
		const op = ops.set(host.root(), gesture.node, { style });
		if (op) host.emit(op);
	}

	function key(event: KeyboardEvent): void {
		if (!host.editing()) return;
		const inside = (event.target as HTMLElement | null)?.isContentEditable;
		const selected = host.selection();
		if (!selected) return;

		if (event.key === "Backspace" || event.key === "Delete") {
			if (inside) return;
			const op = ops.remove(host.root(), selected.node);
			if (op) {
				event.preventDefault();
				host.emit(op);
			}
			return;
		}
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
			event.preventDefault();
			const placed = rectOf(selected.node).left !== undefined;
			const op = ops.duplicate(host.root(), selected.node, placed ? { offset: { x: 16, y: 16 } } : {});
			if (op) host.emit(op);
		}
	}

	const doc = host.document();
	doc?.addEventListener("pointerdown", down, true);
	doc?.addEventListener("pointermove", move, true);
	doc?.addEventListener("pointerup", up, true);
	doc?.addEventListener("keydown", key, true);

	return () => {
		doc?.removeEventListener("pointerdown", down, true);
		doc?.removeEventListener("pointermove", move, true);
		doc?.removeEventListener("pointerup", up, true);
		doc?.removeEventListener("keydown", key, true);
	};
}

/**
 * Put a new component in, at a point in board pixels.
 *
 * The palette's entry point, and the one gesture with no preview: a new element is not a change to
 * something on screen, so the frame is left to draw it when the write comes back. Where it goes is the end
 * of the body — a new component is a new *child* of the board, and every path counts from there.
 */
export function insertAt(host: Pick<GestureHost, "root" | "emit">, kind: ComponentKind, at: { x: number; y: number }): EditorOp | undefined {
	const root = host.root();
	const body = bodyOf(root);
	if (!body) return undefined;
	const index = elementParts(body).length;
	const op = ops.insert(root, body, index, markupFor(root, kind, at));
	if (op) host.emit(op);
	return op;
}

/** Exported for the tests: the address of a node, or nothing when it has none. */
export function addressOf(root: TreeNode, node: TreeNode): number[] | undefined {
	return pathOf(root, node) ?? (nodeAt(root, describe(node, root)?.path ?? []) ? pathOf(root, node) : undefined);
}
