import type { BoardPatch, ComponentKind, Rect } from "@decks/protocol";
import { cameraMovedSince } from "./pan-signal.ts";

/**
 * The user's half of a board: select, drag, resize, retype, delete, insert, connect.
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
	/**
	 * Ask for a file to embed; resolves to a board-relative or absolute path.
	 *
	 * The board is passed so the picker can also *add* a file — a photo from the phone
	 * that is not in the deck yet — and hand back a path written the way that board
	 * addresses its siblings.
	 */
	pickFile(board?: string): Promise<string | undefined>;
	notice(text: string): void;
	/** Whether editing is on at all — below a certain zoom the frame is inert. */
	enabled(): boolean;
	/**
	 * Bring a box on this board into the part of the screen a person can see.
	 *
	 * For the on-screen keyboard, which is the only thing that has ever needed it: a
	 * text run is tapped, the keyboard takes half the screen, and the words being typed
	 * are behind it. The box is in board coordinates — this file has no camera maths in
	 * it (§6.5) and is not about to start — so the caller converts and moves the camera.
	 */
	reveal(path: string, box: { x: number; y: number; w: number; h: number }): void;
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

		/*
		 * A 12px square is a mouse target. Asked of the input device rather than of the
		 * screen — a tablet with a trackpad keeps the small one — and only the box grows:
		 * the handle is positioned by its centre (a negative margin of half its size), so
		 * the corner it marks stays exactly where the component's corner is.
		 */
		@media (pointer: coarse) {
			.decks-handle { width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 6px; }
		}

		/*
		 * A connector covers the whole board and takes no clicks (board.css), which is
		 * right for every other purpose and left an arrow the one component that could
		 * not be selected. The svg still takes none; its own lines take them — a child
		 * may turn pointer events back on under a parent that turned them off — so the
		 * target is the arrow itself rather than a board-sized rectangle over
		 * everything else. board.js draws each connector twice for this: the line you
		 * see, and an invisible 10px copy of it that is the thing you can actually hit.
		 *
		 * Selected, it says so by thickening and taking the accent: an outline around a
		 * board-sized element would frame the whole board, and the resize handle it
		 * would otherwise get belongs to a box with a size.
		 */
		svg.link > path, svg.link > text { pointer-events: stroke; }
		svg.link.decks-editing { outline: none; }
		svg.link.decks-editing > path { stroke: var(--b-accent, #3b5cf6); stroke-width: 3; }
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

	/**
	 * Ask board.js to redraw the connectors.
	 *
	 * A component that moved, changed shape or went away changes where the arrows into
	 * it land, and the runtime exposes `redraw` for exactly this (`window.__board`).
	 * Its own ResizeObserver catches most of it; a removal is the case it cannot see,
	 * because the element is gone before anything measures it.
	 */
	const redraw = () => (win as Window & { __board?: { redraw?: () => void } }).__board?.redraw?.();

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
		// A connector has no box of its own — `offsetWidth` on an SVG element is not
		// even a number — so there is nothing to put a resize handle on.
		if (element.tagName.toLowerCase() === "svg") {
			handle.style.display = "none";
			return;
		}
		const box = rectOf(element);
		handle.style.display = "block";
		handle.style.left = `${box.left + box.width}px`;
		handle.style.top = `${box.top + box.height}px`;
	};

	// --- inserting ------------------------------------------------------------------

	const insert = async (kind: ComponentKind, at: { x: number; y: number }) => {
		let embed: string | undefined;
		if (kind === "embed" || kind === "image") {
			embed = await host.pickFile(path);
			if (!embed) {
				host.resetTool();
				return;
			}
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

	/**
	 * An arrow, drawn by clicking its two ends.
	 *
	 * A connector is not a box you place: it is a relation between two components, so
	 * there is nothing to drag out and nowhere to put it. The first click names the
	 * start and holds it; the second sends the insert. Both ends go as ordinary
	 * attributes (`data-from`, `data-to`), which is also what an agent writes.
	 *
	 * The palette used to answer this tool with a notice promising a gesture that did
	 * not exist ("select one, then shift-click another").
	 */
	let from: string | undefined;
	const connect = (target: EventTarget | null) => {
		const element = componentAt(target);
		if (!element) {
			host.notice(from ? "Click the component it should point at." : "Click the component the arrow starts from.");
			return;
		}
		if (element.tagName.toLowerCase() === "svg") {
			// board.js routes a link from the boxes it names, and an arrow has no box.
			host.notice("An arrow points at a component, not at another arrow.");
			return;
		}
		const id = element.dataset.id!;
		if (!from) {
			from = id;
			host.select({ path, id });
			host.notice(`From ${id} — now click where it points.`);
			return;
		}
		if (from === id) {
			host.notice("An arrow needs two different components.");
			return;
		}
		host.patch(path, [
			{ op: "insert", kind: "arrow", id: "", at: { left: 0, top: 0 }, attrs: { "data-from": from, "data-to": id } },
		]);
		from = undefined;
		host.resetTool();
	};

	// --- dragging and resizing --------------------------------------------------------

	let gesture:
		| { kind: "move"; element: HTMLElement; from: { x: number; y: number }; origin: Rect }
		| { kind: "resize"; element: HTMLElement; from: { x: number; y: number }; origin: Rect }
		| undefined;

	/**
	 * A finger that has landed and not yet said what it meant.
	 *
	 * **The touch rule, in one place: a finger moves the canvas unless it is on
	 * something already selected.** A desktop tells a drag from a pan apart by which
	 * button is down and whether space is held; a finger has neither, and the two
	 * gestures it has to distinguish are the two you least want confused — "read this
	 * board" and "rearrange it". So selecting is a tap and only a tap, and dragging is
	 * available on the second gesture, when the thing under the finger is the thing the
	 * outline is already around. Nothing is ever picked up by accident, a pan across a
	 * board never changes the selection, and the price is one extra tap before a move.
	 *
	 * Two things disqualify a tap, and it takes both. **Distance** catches a gesture that
	 * moved something — dragging the selected component, scrolling an embed — and is
	 * measured in board pixels like everything else here. It cannot catch a *pan*: a pan
	 * drags the board along under the finger, so in the board's own coordinates the finger
	 * has barely moved (60 screen pixels of pan measured 8). That one is answered by the
	 * other side saying so — `pan-signal.ts`, and its comment is where the reasoning is.
	 */
	let tap:
		| {
				at: { x: number; y: number };
				/** When it landed, so a camera move during the gesture can be noticed. */
				since: number;
				/** The same point in board coordinates, which is where an insert would land. */
				on: { x: number; y: number };
				moved: number;
				target: EventTarget | null;
				onSelection: boolean;
		  }
		| undefined;
	const TAP_SLOP = 10;

	/**
	 * Put a gesture back and forget it, without patching anything.
	 *
	 * For the second finger: a pinch that began as a one-finger drag would otherwise
	 * leave the component wherever the first finger had dragged it to, as an edit nobody
	 * asked for on the way to zooming out.
	 */
	const abortGesture = () => {
		const active = gesture;
		gesture = undefined;
		if (!active) return;
		active.element.style.left = `${active.origin.left}px`;
		active.element.style.top = `${active.origin.top}px`;
		if (active.kind === "resize") {
			active.element.style.width = `${active.origin.width}px`;
			active.element.style.height = `${active.origin.height}px`;
		}
		placeHandle();
		redraw();
	};

	on("pointerdown", (event) => {
		if (!host.enabled()) return;

		if (event.pointerType === "touch" && !event.isPrimary) {
			// A second finger is the canvas asking for a pinch (`frame-gestures.ts`), and
			// it beats whatever one finger had started.
			abortGesture();
			tap = undefined;
			return;
		}

		const tool = host.tool();
		const touched = event.pointerType === "touch";
		/*
		 * With a tool armed, a finger still has to be allowed to pan.
		 *
		 * A mouse can hold a tool and travel without pressing anything; a finger cannot,
		 * so inserting on the way down meant arming "sticky" and then being unable to
		 * move the canvas to the place you wanted the sticky. The tool is therefore
		 * resolved when the finger lifts, by the same slop that separates a tap from a
		 * pan — see `endTap`.
		 */
		if (touched && tool !== "select") {
			tap = {
				at: { x: event.clientX, y: event.clientY },
				since: performance.now(),
				on: { x: event.clientX + win.scrollX, y: event.clientY + win.scrollY },
				moved: 0,
				target: event.target,
				onSelection: false,
			};
			return;
		}

		if (tool === "arrow") {
			event.preventDefault();
			connect(event.target);
			return;
		}
		// Half-drawn arrows do not survive picking up another tool: coming back to the
		// arrow later and having the first click finish a connector from wherever you
		// were ten minutes ago is a component nobody asked for.
		from = undefined;
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

		if (touched) {
			const selection = host.selected();
			const onSelection = Boolean(element && selection?.path === path && selection.id === element.dataset.id);
			tap = {
				at: { x: event.clientX, y: event.clientY },
				since: performance.now(),
				on: { x: event.clientX + win.scrollX, y: event.clientY + win.scrollY },
				moved: 0,
				target: event.target,
				onSelection,
			};
			/*
			 * Deliberately no `preventDefault` and no gesture unless this component is
			 * already the selection: the default is how the frame's own touch handler
			 * learns the canvas may pan (it reads `defaultPrevented` on this event), and
			 * what makes a drag across a board a pan rather than a rearrangement.
			 */
			if (!element || !onSelection || element.isContentEditable || editing) return;
			event.preventDefault();
			gesture = { kind: "move", element, from: { x: event.clientX, y: event.clientY }, origin: rectOf(element) };
			return;
		}

		if (!element) {
			host.select(undefined);
			return;
		}

		host.select({ path, id: element.dataset.id! });
		/*
		 * A text edit in progress owns its own pointer events; dragging the box you are
		 * typing in is not a gesture anyone means. Asked of the element being edited and
		 * not of the component, because since a card's heading is editable on its own the
		 * component around it is *not* the contenteditable — and a click into the heading
		 * was picking the card up and dropping the caret wherever the drag ended.
		 */
		if (element.isContentEditable || editing?.element.contains(event.target as Node)) return;
		event.preventDefault();
		gesture = { kind: "move", element, from: { x: event.clientX, y: event.clientY }, origin: rectOf(element) };
	});

	on("pointermove", (event) => {
		if (tap) tap.moved = Math.max(tap.moved, Math.hypot(event.clientX - tap.at.x, event.clientY - tap.at.y));
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
	/**
	 * What a tap turned out to mean, once the finger is off the glass.
	 *
	 * Resolved here rather than on the way down because a finger that landed on a
	 * component may still have been a pan, and the only difference between the two is
	 * how far it travelled. In order: a tap on nothing clears the selection, a tap on a
	 * component selects it, and a tap on the component *already* selected starts typing
	 * over the run of text under the finger — which is the touch half of §6.5's
	 * double-click, and the only gesture here that is not also a mouse gesture.
	 */
	const endTap = (event: PointerEvent) => {
		const finished = tap;
		tap = undefined;
		if (!finished || event.pointerType !== "touch" || finished.moved > TAP_SLOP) return;
		// The gesture turned out to be the canvas moving, which is not a tap on anything.
		if (cameraMovedSince(doc, finished.since)) return;
		if (!host.enabled()) return;

		// An armed tool has been waiting for the finger to lift, so that the same finger
		// could have panned instead.
		const tool = host.tool();
		if (tool === "arrow") {
			// `from` deliberately survives: the arrow tool is two taps, and the first one
			// is the thing the second one needs.
			connect(finished.target);
			return;
		}
		if (tool !== "select") {
			from = undefined;
			void insert(tool, finished.on);
			return;
		}

		const element = componentAt(finished.target);
		if (!element) {
			if (!editing) host.select(undefined);
			return;
		}
		if (!finished.onSelection) {
			host.select({ path, id: element.dataset.id! });
			return;
		}
		if (editing?.element.contains(finished.target as Node)) return;
		beginEditing(finished.target, false);
	};

	on("pointerup", (event) => {
		endGesture();
		endTap(event);
	});
	on("pointercancel", (event) => {
		tap = undefined;
		endGesture();
		void event;
	});

	// --- typing -------------------------------------------------------------------------

	/**
	 * `id` and `at` together are the address the patch carries: the component, and the
	 * indices of the element children walked into to reach the run being typed.
	 */
	let editing: { element: HTMLElement; id: string; at: number[]; before: string } | undefined;

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
		host.patch(path, [
			{ op: "text", id: active.id, text, ...(active.at.length > 0 ? { path: active.at } : {}) },
		]);
	};

	/**
	 * Which run of text a double-click means, and how the file names it.
	 *
	 * A card is a heading and a paragraph, and "retype the card" is not an edit anyone
	 * wants — the old rule (the whole component, or a notice) meant a card was the one
	 * shape a user could not touch, which is most of what an agent writes. So the
	 * target is the element that was clicked, addressed relative to the component by
	 * the indices of the element children on the way down. `[0]` is the heading.
	 *
	 * Indices, and not a selector or a name like "heading", because the browser can
	 * compute one from the element under the pointer and parse5 can resolve it against
	 * the file with no selector engine and no shared vocabulary to drift.
	 */
	const runAt = (target: EventTarget | null): { component: HTMLElement; element: HTMLElement; at: number[] } | undefined => {
		const component = componentAt(target);
		const element = target as HTMLElement | null;
		if (!component || !element) return undefined;
		const at: number[] = [];
		let cursor: HTMLElement = element;
		while (cursor !== component) {
			const parent: HTMLElement | null = cursor.parentElement;
			if (!parent) return undefined;
			at.unshift([...parent.children].indexOf(cursor));
			cursor = parent;
		}
		return { component, element, at };
	};

	/**
	 * Whether `board.js` owns what is inside a component.
	 *
	 * An embed, a `[data-md]` panel, a diagram and a connector are all *rendered*: the
	 * DOM on screen is not the shape the file has, so the indices above would address
	 * something that does not exist there and the patch would be refused after the
	 * optimistic edit had already happened. Refused up front instead, with the reason.
	 */
	const rendered = (element: HTMLElement) =>
		element.dataset.embed !== undefined ||
		element.dataset.md !== undefined ||
		element.dataset.mermaid !== undefined ||
		element.tagName.toLowerCase() === "svg";

	/**
	 * Start typing over a run of text, however the user asked for it.
	 *
	 * Two gestures reach here. A double-click, which is what a mouse has always done —
	 * and a second tap on a component that is already selected, because a double-tap is
	 * not available on a touchscreen: it is the browser's zoom gesture, and even with
	 * that suppressed it is a poor thing to ask of a finger over a 14px line of text.
	 * "Tap to select, tap again to edit" is the idiom every phone already teaches, and
	 * it falls out of the selection rule below rather than being a second mechanism.
	 */
	const beginEditing = (target: EventTarget | null, mouse: boolean): boolean => {
		if (!host.enabled()) return false;
		const run = runAt(target);
		if (!run) return false;
		if (rendered(run.component)) {
			host.notice("The board draws that from a file — change what it points at, or ask the agent.");
			return false;
		}
		// A run of plain text, and nothing else: the server refuses to flatten markup,
		// so offering to edit a paragraph with a link in it would be offering a refusal.
		if (run.element.children.length > 0) {
			// Only worth saying to somebody who aimed: a tap on a card's padding is not a
			// failed attempt to retype it, it is the tap that selected the card.
			if (mouse) host.notice("Double-click the line you want to retype.");
			return false;
		}
		editing = { element: run.element, id: run.component.dataset.id!, at: run.at, before: run.element.textContent ?? "" };
		run.element.contentEditable = "true";
		run.element.focus();
		const range = doc.createRange();
		range.selectNodeContents(run.element);
		win.getSelection()?.removeAllRanges();
		win.getSelection()?.addRange(range);
		/*
		 * Focusing a `contenteditable` on a phone raises the keyboard over the bottom
		 * half of the screen, which is where the thing being typed usually is. The box
		 * asked for is the component rather than the run, so the heading of a card stays
		 * visible with the card it belongs to.
		 */
		const box = rectOf(run.component);
		host.reveal(path, { x: box.left, y: box.top, w: box.width ?? 0, h: box.height ?? 0 });
		return true;
	};

	on("dblclick", (event) => {
		if (beginEditing(event.target, true)) event.preventDefault();
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
			/*
			 * Taken off the screen as well as out of the file. The frame is pinned to the
			 * revision it loaded so a user's own edit does not reload it (§7) — which
			 * assumes the editor has already made the change to the DOM. This one had not:
			 * the patch removed the component from the file and it stayed on screen until
			 * something else reloaded the frame.
			 */
			doc.querySelector(`[data-id="${cssEscape(selection.id)}"]`)?.remove();
			redraw();
			host.patch(path, [{ op: "remove", id: selection.id }]);
			host.select(undefined);
			return;
		}

		// A copy of what is selected, offset, keeping whatever markup it is made of. The
		// copy exists only in the file until the frame reloads, which is why `patches.ts`
		// has this op unpin the frame.
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
			event.preventDefault();
			host.patch(path, [{ op: "duplicate", id: selection.id }]);
			return;
		}

		// Paint order is document order, so this is a move within the body.
		if (event.key === "[" || event.key === "]") {
			event.preventDefault();
			const element = doc.querySelector(`[data-id="${cssEscape(selection.id)}"]`);
			if (element) {
				if (event.key === "]") doc.body.appendChild(element);
				else doc.body.insertBefore(element, doc.body.firstElementChild);
			}
			host.patch(path, [{ op: "order", id: selection.id, to: event.key === "]" ? "front" : "back" }]);
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
