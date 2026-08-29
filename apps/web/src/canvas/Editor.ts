import type { BoardPatch, ComponentKind, Rect } from "@decks/protocol";

/**
 * The user's half of a board: select, drag, resize, retype, delete, insert.
 *
 * This is ordinary app code operating on `frame.contentDocument`, which is the
 * point of serving boards same-origin (DESIGN §4). Two consequences worth naming:
 *
 * 1. **Coordinates are free.** A pointer event inside the frame arrives in the
 *    frame's own pixels, which *are* board coordinates — the stage's zoom is a CSS
 *    transform on an ancestor and does not touch the frame's coordinate system. No
 *    camera maths anywhere in this file.
 * 2. **The affordances live in the board's DOM.** Handles and the selection outline
 *    are elements appended to the board document and marked `data-decks-ui`, never
 *    written to the file: patches are declarative, so the overlay cannot leak into
 *    what is saved.
 *
 * The gesture mutates the DOM immediately and sends a patch when it ends. The file
 * is the artifact — the optimistic mutation is a preview of a write, and a refused
 * write re-reads the frame.
 */

export type Tool = "select" | ComponentKind;

/**
 * The grid every placement snaps to, exported because the drop path snaps to it too
 * (`file-drop.ts`). A file dropped on a board has to line up with the components
 * placed by hand beside it, and two definitions of "the grid" is one too many.
 */
export const GRID = 8;
const MIN_SIZE = 40;

export interface EditorHost {
	tool(): Tool;
	/** Back to select after an insert: a palette that stays armed inserts by accident. */
	resetTool(): void;
	selected(): { path: string; id: string } | undefined;
	select(selection: { path: string; id: string } | undefined): void;
	/**
	 * Tell me when the selection changes, wherever it changed from.
	 *
	 * The overlay is plain DOM inside somebody else's document, so it cannot observe
	 * the app's state on its own — and without this it only redrew during a drag: a
	 * plain click selected a component with nothing to show for it, and selecting on
	 * one board left the outline sitting on another.
	 */
	onSelectionChange(listener: () => void): () => void;
	patch(path: string, patches: BoardPatch[]): void;
	undo(path: string): void;
	/** Ask for a file to embed; resolves to a board-relative or absolute path. */
	pickFile(): Promise<string | undefined>;
	notice(text: string): void;
	/** Whether editing is on at all — below a certain zoom the frame is inert. */
	enabled(): boolean;
}

export const snap = (value: number) => Math.round(value / GRID) * GRID;

export function attachEditor(frame: HTMLIFrameElement, path: string, host: EditorHost): () => void {
	const doc = frame.contentDocument;
	const win = frame.contentWindow;
	if (!doc || !win) return () => {};

	const cleanups: Array<() => void> = [];
	const on = <K extends keyof DocumentEventMap>(
		type: K,
		handler: (event: DocumentEventMap[K]) => void,
		options?: AddEventListenerOptions,
	) => {
		doc.addEventListener(type, handler as EventListener, options);
		cleanups.push(() => doc.removeEventListener(type, handler as EventListener, options));
	};

	// The overlay's own styles, in the board's document, marked so nothing mistakes
	// them for content.
	const style = doc.createElement("style");
	style.dataset.decksUi = "true";
	style.textContent = `
		[data-decks-ui] { position: absolute; z-index: 2147483000; }
		.decks-handle {
			width: 12px; height: 12px; margin: -6px 0 0 -6px;
			border: 2px solid var(--b-bg, #fff); border-radius: 3px;
			background: var(--b-accent, #3b5cf6); cursor: nwse-resize;
			box-shadow: 0 1px 3px rgb(0 0 0 / 30%);
		}
		.decks-editing { outline: 2px solid var(--b-accent, #3b5cf6); outline-offset: 2px; }
	`;
	doc.head.appendChild(style);
	cleanups.push(() => style.remove());

	const handle = doc.createElement("div");
	handle.className = "decks-handle";
	handle.dataset.decksUi = "true";
	handle.style.display = "none";
	doc.body.appendChild(handle);
	cleanups.push(() => handle.remove());

	const componentAt = (target: EventTarget | null): HTMLElement | undefined => {
		const element = target as HTMLElement | null;
		if (!element || element.dataset?.decksUi) return undefined;
		const owner = element.closest?.("[data-id]") as HTMLElement | null;
		// Only direct children of the board are components; a heading inside a card
		// belongs to the card.
		return owner && owner.parentElement === doc.body ? owner : undefined;
	};

	const rectOf = (element: HTMLElement) => ({
		left: element.offsetLeft,
		top: element.offsetTop,
		width: element.offsetWidth,
		height: element.offsetHeight,
	});

	const placeHandle = () => {
		const selection = host.selected();
		const element = selection?.path === path ? (doc.querySelector(`[data-id="${cssEscape(selection.id)}"]`) as HTMLElement | null) : null;
		for (const marked of doc.querySelectorAll(".decks-editing")) marked.classList.remove("decks-editing");
		if (!element || !host.enabled()) {
			handle.style.display = "none";
			return;
		}
		element.classList.add("decks-editing");
		const box = rectOf(element);
		handle.style.display = "block";
		handle.style.left = `${box.left + box.width}px`;
		handle.style.top = `${box.top + box.height}px`;
	};

	// --- inserting ------------------------------------------------------------------

	const insert = async (kind: ComponentKind, at: { x: number; y: number }) => {
		let embed: string | undefined;
		if (kind === "embed" || kind === "image") {
			embed = await host.pickFile();
			if (!embed) {
				host.resetTool();
				return;
			}
		}
		if (kind === "arrow") {
			host.notice("Arrows are drawn between two components — select one, then shift-click another.");
			host.resetTool();
			return;
		}
		const size: Partial<Rect> =
			kind === "sticky"
				? { width: 220 }
				: kind === "text"
					? { width: 320 }
					: kind === "embed" || kind === "image"
						? { width: 420, height: 320 }
						: { width: 360 };
		host.patch(path, [
			{
				op: "insert",
				kind,
				// The server mints the id; this one is a placeholder it replaces.
				id: "",
				at: { left: snap(at.x), top: snap(at.y), ...size },
				...(embed ? { embed } : {}),
			},
		]);
		host.resetTool();
	};

	// --- dragging and resizing --------------------------------------------------------

	let gesture:
		| { kind: "move"; element: HTMLElement; from: { x: number; y: number }; origin: Rect }
		| { kind: "resize"; element: HTMLElement; from: { x: number; y: number }; origin: Rect }
		| undefined;

	on("pointerdown", (event) => {
		if (!host.enabled()) return;

		const tool = host.tool();
		if (tool !== "select") {
			event.preventDefault();
			void insert(tool, { x: event.clientX + win.scrollX, y: event.clientY + win.scrollY });
			return;
		}

		if (event.target === handle) {
			const selection = host.selected();
			const element = selection && (doc.querySelector(`[data-id="${cssEscape(selection.id)}"]`) as HTMLElement | null);
			if (!element) return;
			event.preventDefault();
			gesture = { kind: "resize", element, from: { x: event.clientX, y: event.clientY }, origin: rectOf(element) };
			return;
		}

		const element = componentAt(event.target);
		if (!element) {
			host.select(undefined);
			return;
		}

		host.select({ path, id: element.dataset.id! });
		// A text edit in progress owns its own pointer events; dragging the box you
		// are typing in is not a gesture anyone means.
		if (element.isContentEditable) return;
		event.preventDefault();
		gesture = { kind: "move", element, from: { x: event.clientX, y: event.clientY }, origin: rectOf(element) };
	});

	on("pointermove", (event) => {
		if (!gesture) return;
		const dx = event.clientX - gesture.from.x;
		const dy = event.clientY - gesture.from.y;
		if (gesture.kind === "move") {
			gesture.element.style.left = `${snap(gesture.origin.left + dx)}px`;
			gesture.element.style.top = `${snap(gesture.origin.top + dy)}px`;
		} else {
			gesture.element.style.width = `${Math.max(MIN_SIZE, snap((gesture.origin.width ?? 0) + dx))}px`;
			gesture.element.style.height = `${Math.max(MIN_SIZE, snap((gesture.origin.height ?? 0) + dy))}px`;
		}
		placeHandle();
	});

	const endGesture = () => {
		const active = gesture;
		gesture = undefined;
		if (!active) return;
		const box = rectOf(active.element);
		const id = active.element.dataset.id;
		if (!id) return;

		if (active.kind === "move") {
			if (box.left === active.origin.left && box.top === active.origin.top) return;
			host.patch(path, [{ op: "update", id, style: { left: box.left, top: box.top } }]);
		} else {
			if (box.width === active.origin.width && box.height === active.origin.height) return;
			host.patch(path, [{ op: "update", id, style: { width: box.width, height: box.height } }]);
		}
	};
	on("pointerup", endGesture);
	on("pointercancel", endGesture);

	// --- typing -------------------------------------------------------------------------

	let editing: { element: HTMLElement; before: string } | undefined;

	const stopEditing = (commit: boolean) => {
		const active = editing;
		editing = undefined;
		if (!active) return;
		active.element.contentEditable = "false";
		const text = active.element.textContent ?? "";
		if (!commit || text === active.before) {
			active.element.textContent = active.before;
			return;
		}
		host.patch(path, [{ op: "text", id: active.element.dataset.id!, text }]);
	};

	on("dblclick", (event) => {
		if (!host.enabled()) return;
		const element = componentAt(event.target);
		if (!element) return;
		// Only a component whose content is plain text: the server refuses to flatten
		// markup, so offering to edit a card full of it would be offering a refusal.
		if (element.children.length > 0) {
			host.notice("That component contains markup — ask the agent to change it.");
			return;
		}
		event.preventDefault();
		editing = { element, before: element.textContent ?? "" };
		element.contentEditable = "true";
		element.focus();
		const range = doc.createRange();
		range.selectNodeContents(element);
		win.getSelection()?.removeAllRanges();
		win.getSelection()?.addRange(range);
	});

	on("focusout", () => stopEditing(true));

	on("keydown", (event) => {
		if (editing) {
			if (event.key === "Escape") {
				event.preventDefault();
				stopEditing(false);
			}
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				stopEditing(true);
			}
			return;
		}

		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
			event.preventDefault();
			host.undo(path);
			return;
		}

		const selection = host.selected();
		if (!selection || selection.path !== path) return;

		if (event.key === "Backspace" || event.key === "Delete") {
			event.preventDefault();
			host.patch(path, [{ op: "remove", id: selection.id }]);
			host.select(undefined);
			return;
		}

		if (event.key === "Escape") {
			host.select(undefined);
			return;
		}

		// Nudge: the same 8px the drags snap to, or 1px with shift for the last word.
		const step = event.shiftKey ? 1 : GRID;
		const delta =
			event.key === "ArrowLeft"
				? { x: -step, y: 0 }
				: event.key === "ArrowRight"
					? { x: step, y: 0 }
					: event.key === "ArrowUp"
						? { x: 0, y: -step }
						: event.key === "ArrowDown"
							? { x: 0, y: step }
							: undefined;
		if (!delta) return;
		event.preventDefault();
		const element = doc.querySelector(`[data-id="${cssEscape(selection.id)}"]`) as HTMLElement | null;
		if (!element) return;
		const box = rectOf(element);
		element.style.left = `${box.left + delta.x}px`;
		element.style.top = `${box.top + delta.y}px`;
		placeHandle();
		host.patch(path, [{ op: "update", id: selection.id, style: { left: box.left + delta.x, top: box.top + delta.y } }]);
	});

	/*
	 * The overlay follows the layout: a card that grew a line of text moves its own
	 * bottom-right corner, and the handle has to go with it. Observed through the
	 * frame's own constructor so the callback fires in the frame's rendering
	 * lifecycle rather than the app's.
	 */
	const FrameResizeObserver = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
	if (FrameResizeObserver) {
		const observer = new FrameResizeObserver(() => placeHandle());
		observer.observe(doc.body);
		cleanups.push(() => observer.disconnect());
	}

	cleanups.push(host.onSelectionChange(() => placeHandle()));
	placeHandle();

	return () => {
		stopEditing(false);
		for (const cleanup of cleanups.reverse()) cleanup();
	};
}

function cssEscape(value: string): string {
	return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}
