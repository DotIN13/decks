import type { BoardPatch, ComponentKind, Rect } from "@decks/protocol";
import { cameraMovedSince } from "./pan-signal.ts";

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
 *
 * Typing is two surfaces on purpose (§6.5). A run of plain text is typed *in place*,
 * because that path already preserves the file's own whitespace and produces a one-line
 * diff. A `[data-md]` or `[data-mermaid]` component is typed in a textarea over it,
 * because what is on screen there was drawn from words that are no longer in the
 * document at all — the source comes back from `board.js`, and goes back to it.
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
		 * The source editor. Monospace because this is markdown or Mermaid source, where a
		 * leading space is a list item and four of them are a code block — a proportional
		 * face hides the one thing its author has to be able to see. Soft wrapping is left
		 * on: a long paragraph in a narrow panel would otherwise run off to the right with
		 * no way to follow it, and a wrapped line is still one line in the file.
		 */
		.decks-source {
			box-sizing: border-box;
			padding: 8px;
			font: 12px/1.55 var(--b-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
			color: var(--b-fg, #161616);
			background: var(--b-bg, #fff);
			border: 2px solid var(--b-accent, #3b5cf6);
			border-radius: var(--b-radius, 6px);
			box-shadow: 0 6px 24px rgb(0 0 0 / 25%);
			white-space: pre-wrap;
			tab-size: 2;
			resize: none;
		}

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
		 * An editable run says so under the cursor. (No backticks in here: this is a
		 * template literal, and one would end it.)
		 *
		 * Kept from the other line of this branch, where the attribute was an optional
		 * hint over inferred editability. It is a better affordance under this rule than
		 * it was under that one: there, an underline could appear on a run the two hard
		 * rules would then refuse — a leaf whose content is markup, a heading a
		 * [data-md] only rendered — and promise something that would not happen. Here an
		 * element carrying a data-edit is exactly an editable one, so the underline
		 * cannot lie.
		 *
		 * The false exclusion is not a seal. Nothing is sealed any more; the value is
		 * simply refused as an address (see patch.ts retype), so it must not be offered.
		 *
		 * Only on hover, and only an underline: the point is to answer "can I type here"
		 * at the moment somebody wonders, not to draw boxes over a finished board. It
		 * needs no zoom guard — below INTERACT_ZOOM the frame takes no pointer events, so
		 * nothing in it can be hovered.
		 */
		[data-edit]:not([data-edit="false"]):hover {
			text-decoration: underline dotted var(--b-faint, #9aa0aa);
			text-underline-offset: 3px;
			cursor: text;
		}
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
		/*
		 * Every measurement in this file is `offsetLeft`/`offsetWidth`, which belong to
		 * `HTMLElement` — an `SVGElement` has neither, so a top-level `<svg>` reads as
		 * `undefined` and there is nothing to hang a handle off. The authoring skill
		 * therefore has a hand-drawn diagram sit *inside* a box component, which is what
		 * makes it draggable and resizable like anything else.
		 */
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
	};

	on("pointerdown", (event) => {
		if (!host.enabled()) return;

		/*
		 * A press inside whatever is being typed into belongs to it. Checked before
		 * anything else because the source editor is a *sibling* of the component rather
		 * than part of it: `componentAt` sees a `data-decks-ui` element and answers
		 * nothing, which the branches below would read as "clear the selection".
		 */
		if (editingOwns(event.target)) return;

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
		if (element.isContentEditable || editingOwns(event.target)) return;
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
		if (tool !== "select") {
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
		if (editingOwns(finished.target)) return;
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
	 * What is being typed into, and how the patch will name it.
	 *
	 * `edit` is the whole address: the `data-edit` its author wrote on the run, unique
	 * within the board, and the same string on both sides of the wire (§6.5). It
	 * replaced a path of child indices, which the browser computed and the server
	 * resolved — two derivations of one thing, which agreed only for components whose
	 * DOM shape was the file's.
	 *
	 * Two shapes, because there are two surfaces. A `run` is typed in place. A `source`
	 * is the whole of a `[data-md]` or `[data-mermaid]` component, typed in a textarea
	 * over it, and carries the `indent` its lines were stripped of so they can be put
	 * back exactly where the file had them.
	 */
	let editing:
		| { kind: "run"; element: HTMLElement; edit: string; before: string }
		| { kind: "source"; element: HTMLElement; area: HTMLTextAreaElement; edit: string; before: string; indent: string }
		| undefined;

	/** Whether a node is inside whatever is being typed into — including the textarea. */
	const editingOwns = (node: EventTarget | null): boolean => {
		if (!editing || !node) return false;
		const surface = editing.kind === "run" ? editing.element : editing.area;
		return surface.contains(node as Node);
	};

	/** `board.js`'s side of a rendered component: the source it drew from, and a re-draw. */
	const runtime = () =>
		(
			win as Window & {
				__board?: { source?: (element: Element) => string; redraw?: (element: Element, source: string) => Promise<void> };
			}
		).__board;

	const stopEditing = (commit: boolean) => {
		const active = editing;
		editing = undefined;
		if (!active) return;

		if (active.kind === "run") {
			active.element.contentEditable = "false";
			const text = active.element.textContent ?? "";
			if (!commit || text === active.before) {
				active.element.textContent = active.before;
				return;
			}
			host.patch(path, [{ op: "text", edit: active.edit, text }]);
			return;
		}

		const typed = active.area.value;
		active.area.remove();
		if (!commit || typed === active.before) return;
		/*
		 * Indented back into the shape the file had it in, which is what keeps a change
		 * to one line of a panel a change to one line of the file. The server trims the
		 * first line's indent and the last line's newline off again, because those are
		 * the whitespace it is already keeping around the run.
		 */
		const source = redent(typed, active.indent);
		/*
		 * Drawn again here rather than by reloading the frame. The frame is pinned to the
		 * revision it loaded so a user's own edit does not reload the board they are
		 * working on (§7), and that pin assumes the editor has already made the change on
		 * screen — for a rendered component only `board.js` can.
		 */
		void runtime()?.redraw?.(active.element, source);
		host.patch(path, [{ op: "text", edit: active.edit, text: source }]);
	};

	/**
	 * Open the source of a rendered component in a textarea over it.
	 *
	 * The unit is the whole source and not a rendered block, because a rendered block is
	 * not a thing the file has: `board.js` was handed `## The sequence` and drew an
	 * `<h2>`, and there is no byte range in the file that corresponds to the `<h2>`. One
	 * editor holding what the author actually wrote is both simpler and the only version
	 * that can add a line.
	 */
	const openSource = (element: HTMLElement, edit: string, mouse: boolean): boolean => {
		const raw = runtime()?.source?.(element);
		if (raw === undefined) {
			// Only reachable before `board.js` has mounted, or in a board that loaded an
			// older copy of it — `lib/` is re-synced on every open (§2.1), so this is a
			// message about timing rather than about versions.
			if (mouse) host.notice("That component has not finished loading yet.");
			return false;
		}
		const { text, indent } = undent(raw);
		const area = doc.createElement("textarea");
		area.className = "decks-source";
		area.dataset.decksUi = "true";
		area.spellcheck = false;
		area.value = text;
		const box = rectOf(element);
		area.style.left = `${box.left}px`;
		area.style.top = `${box.top}px`;
		area.style.width = `${box.width}px`;
		// A panel is sized to the drawing, and a diagram is usually taller as source than
		// it is as a picture — so the editor may need more room than the component has.
		area.style.height = `${Math.max(box.height ?? 0, 180)}px`;
		doc.body.appendChild(area);
		area.focus();
		area.setSelectionRange(text.length, text.length);
		editing = { kind: "source", element, area, edit, before: text, indent };
		// The editor's own box, not the component's: on a phone the keyboard takes the
		// bottom half of the screen and the thing being typed is what has to stay in view.
		host.reveal(path, { x: box.left, y: box.top, w: box.width ?? 0, h: Math.max(box.height ?? 0, 180) });
		return true;
	};

	/**
	 * The name an element carries, or `undefined` if it has none to carry.
	 *
	 * `"false"` is reserved and is never an address. The other line of this branch had
	 * `data-edit="false"` seal an element and its subtree, over editability that was
	 * otherwise inferred; that seal is discarded, because under this rule nothing is
	 * editable unless it was named and so omitting the name already *is* the seal.
	 *
	 * The value is still refused rather than left undocumented, and this is the reason.
	 * An author who read that other guidance would write `data-edit="false"` meaning to
	 * turn editing off, and with the name *as* the address it would do the exact
	 * opposite: mint an editable run called `false` that anybody can double-click. The
	 * server refuses the same value (`retype` in patch.ts), so the reservation holds
	 * whether or not it was this UI that sent the patch.
	 */
	const nameOf = (element: HTMLElement): string | undefined => {
		const name = element.dataset.edit;
		return name === undefined || name === "false" ? undefined : name;
	};

	/**
	 * Start typing over something, however the user asked for it.
	 *
	 * Two gestures reach here. A double-click, which is what a mouse has always done —
	 * and a second tap on a component that is already selected, because a double-tap is
	 * not available on a touchscreen: it is the browser's zoom gesture, and even with
	 * that suppressed it is a poor thing to ask of a finger over a 14px line of text.
	 * "Tap to select, tap again to edit" is the idiom every phone already teaches, and
	 * it falls out of the selection rule rather than being a second mechanism.
	 *
	 * What is editable is what the file says is: an element carrying a `data-edit`, or a
	 * rendered component whose source is one. A board written before that convention has
	 * no retypeable text and is told so, which is the accepted price of an address that
	 * cannot be computed from the DOM.
	 */
	const beginEditing = (target: EventTarget | null, mouse: boolean): boolean => {
		if (!host.enabled()) return false;
		const component = componentAt(target);
		const clicked = target as HTMLElement | null;
		if (!component || !clicked?.closest) return false;
		// Whatever was being typed into is finished with first, and committed: switching
		// runs is not a way to throw an edit away.
		if (editing && !editingOwns(clicked)) stopEditing(true);

		/*
		 * A rendered component is asked about before the element under the pointer is,
		 * because the element under the pointer is something `board.js` drew and its own
		 * attributes say nothing about the file.
		 */
		const drawn = clicked.closest("[data-md], [data-mermaid]") as HTMLElement | null;
		if (drawn && component.contains(drawn)) {
			const named = nameOf(drawn);
			if (!named) {
				if (mouse) host.notice("That panel's source has no name in the file — ask the agent for a data-edit on it.");
				return false;
			}
			return openSource(drawn, named, mouse);
		}

		if (component.dataset.embed !== undefined) {
			host.notice("The board draws that from a file — change what it points at, or ask the agent.");
			return false;
		}
		/*
		 * A top-level `<svg>` cannot be edited for the reason it cannot be dragged: the
		 * reveal below asks for `rectOf(component)`, and an `SVGElement` has no
		 * `offsetLeft` to give it. The authoring skill says to put a drawing inside a box,
		 * which makes all of this work as normal.
		 */
		if (component.tagName.toLowerCase() === "svg") return false;

		/*
		 * A word inside a drawing, asked before whether it is named, because the answer is
		 * the same either way: `contentEditable` is `HTMLElement`'s and an `<svg>`'s own
		 * `<text>` is not one. Assigning the property on it is silently a no-op — no
		 * attribute is set and `isContentEditable` stays undefined — so this used to leave
		 * the editor in an editing state over an element nobody could type into, escapable
		 * only with Escape. Reachable because the authoring skill tells an agent to draw a
		 * diagram inside a box component, whose own tag says nothing about what is under it.
		 */
		if (clicked.closest("svg")) {
			if (mouse) host.notice("That word is placed by the drawing's own coordinates — ask the agent to change it.");
			return false;
		}

		const run = clicked.closest("[data-edit]") as HTMLElement | null;
		if (!run || !component.contains(run)) {
			// Only worth saying to somebody who aimed: a tap on a card's padding is not a
			// failed attempt to retype it, it is the tap that selected the card.
			if (mouse) host.notice("Nothing here is named as editable — ask the agent for a data-edit on it.");
			return false;
		}
		// A run of plain text, and nothing else: the server refuses to flatten markup, so
		// offering to edit a paragraph with a link in it would be offering a refusal.
		if (run.children.length > 0) {
			if (mouse) host.notice("That run has markup inside it — the words themselves need naming, not the paragraph.");
			return false;
		}
		// Said plainly rather than folded into the notice above, because the two are
		// different mistakes: that one is an author who named the wrong element, this is
		// one who wrote the reserved value meaning to seal. Not resolved by looking further
		// up for a real name either — an author who wrote `false` here was aiming at *this*
		// element, and quietly retyping its parent instead is the worse answer.
		const name = nameOf(run);
		if (name === undefined) {
			if (mouse) host.notice('data-edit="false" is not a name — ask the agent to drop the attribute instead.');
			return false;
		}
		const before = run.textContent ?? "";
		run.contentEditable = "true";
		run.focus();
		/*
		 * Assigned after focusing, not before. Moving focus out of a `contenteditable`
		 * fires `focusout` synchronously, and this handler commits on `focusout` — so a
		 * state set first would be committed by the very act of starting to edit.
		 */
		editing = { kind: "run", element: run, edit: name, before };
		const range = doc.createRange();
		range.selectNodeContents(run);
		win.getSelection()?.removeAllRanges();
		win.getSelection()?.addRange(range);
		/*
		 * Focusing a `contenteditable` on a phone raises the keyboard over the bottom
		 * half of the screen, which is where the thing being typed usually is. The box
		 * asked for is the component rather than the run, so the heading of a card stays
		 * visible with the card it belongs to.
		 */
		const box = rectOf(component);
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

/**
 * Whether a key or a paste belongs to something the user is typing into.
 *
 * Both of the other files that listen inside a board's document need this, and both had
 * it wrong the same way: they asked `isContentEditable`, which is true of a run being
 * retyped and false of the source editor's `<textarea>`. So the palette's own letters
 * were taken out of a Mermaid source as it was typed — `## What lands` arrived in the
 * file as `##Whaland` — and the space bar panned the canvas mid-word. Exported from here
 * because this is the file that puts those surfaces on the screen, which is the same
 * reason `GRID` lives here.
 */
export function typingInto(target: EventTarget | null): boolean {
	const element = target as HTMLElement | null;
	if (!element) return false;
	return Boolean(element.isContentEditable) || element.tagName === "TEXTAREA" || element.tagName === "INPUT";
}

/**
 * A block of inline source as its author would want to type it, and the indentation
 * taken off it.
 *
 * Markdown inside a board is indented to line up with the HTML around it, and every one
 * of those spaces means something to a markdown parser — four of them are a code block —
 * so `board.js` strips the common indent before parsing and the editor shows what the
 * parser saw. Handing over the raw bytes instead would open an editor whose every line
 * begins with three tabs, and inside which the author cannot tell their own indentation
 * from the file's.
 *
 * The indent comes back on commit (`redent`). Without that half, a panel's source drifts
 * to column zero on its first edit: it still *renders* the same, since the parser
 * dedents anyway, but every line of the block turns up in the diff and the file stops
 * looking like something a person wrote.
 */
export function undent(raw: string): { text: string; indent: string } {
	const lines = raw.split("\n");
	// The blank first and last lines are the file's, not the author's: they are the
	// newline after the opening tag and the one before the closing one, and the server
	// keeps that whitespace itself.
	while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
	while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();

	const indents = lines.filter((line) => line.trim() !== "").map((line) => /^[ \t]*/.exec(line)![0]);
	// The longest prefix every line shares, character by character rather than by
	// counting: a file indented with tabs and one indented with spaces are both normal,
	// and a count would let the two be mixed back together.
	const indent = indents.reduce((shared, own) => {
		let index = 0;
		while (index < shared.length && index < own.length && shared[index] === own[index]) index += 1;
		return shared.slice(0, index);
	}, indents[0] ?? "");

	const text = lines.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trimStart())).join("\n");
	return { text, indent };
}

/** The other half: back into the file's shape, so a line nobody touched is untouched. */
export function redent(text: string, indent: string): string {
	// A blank line stays empty rather than becoming trailing whitespace — which is what
	// the file already has, and what an editor would strip anyway.
	return text
		.split("\n")
		.map((line) => (line.trim() === "" ? "" : `${indent}${line}`))
		.join("\n");
}

function cssEscape(value: string): string {
	return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}
