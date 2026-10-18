/**
 * The editor on the page: its state (`core/model.ts`, `EditorState`) held in one signal, stepped
 * by `core/gesture.ts`, with what each step asks for done here — ops sent (`onPenEdit`), the
 * engine's preview, carry and settle said through the seam (`core/scene.ts`, `EngineSeam`), and
 * every other effect run by `dom/effects.ts`.
 *
 * Each part of the state is handed out as its own memo, so what reads the selection is not
 * touched by a pointer move that changes only the drag. The step keeps every part it does not
 * change as the same value, which is what lets a memo see that nothing changed.
 *
 * The selection is this editor's. `state/pen-tools.ts` reads and writes it through
 * `feedSelection`, so the drawing bar and the properties panel see the one selection the stage has.
 */
import { arrowEndItem, ids as penIds, isArrow, type MediaItem, type Op, type PenDocument } from "@decks/pen";
import { batch, createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import { feedSelection, keptSelection } from "../../../state/pen-tools.ts";
import { glideShift } from "../core/overlay.ts";
import { initialState, landBoardResize, pruneBoards, selectMade, shownDrag, step, withSelection, type GestureContext, type Input, type PointerInput } from "../core/gesture.ts";
import type { BoardBox, DraftBox, EditorState, Offset, PenTool, PointerKind, Pt, Rect, ResizeBox, SideHintBox } from "../core/model.ts";
import type { NextId } from "../core/ops.ts";
import type { TextSession } from "../core/text.ts";
import type { EngineSeam, SceneQuery } from "../core/scene.ts";
import { createEffects, type EffectHost } from "./effects.ts";

/** A board as the editor needs it from the app: where it is, its revision, and whether it is a slide deck. */
export type HostBoard = { path: string; x: number; y: number; w: number; h: number; rev: number; format?: string | undefined; title?: string | undefined };

export type EditorHost = {
	scene: SceneQuery;
	engine: EngineSeam;
	mode: () => EditorState["mode"];
	tool: () => PenTool;
	zoom: () => number;
	/** The window, in stage pixels. */
	view: () => Rect;
	nextIds: () => NextId;
	boards: () => readonly HostBoard[];
	onPenEdit: (ops: Op[]) => void;
	/** The page's side of the effects, but for the three the controller does itself. */
	effects: Omit<EffectHost, "settle" | "wake" | "awaitFrame" | "boards"> & { toggleMedia: (id: string, media: MediaItem) => void };
};

/** A pointer event as the editor takes it: at a stage point, with its keys, its kind and its time. */
export function pointerInput(event: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean; pointerType?: string }, at: Pt): PointerInput {
	const kind = event.pointerType;
	return {
		at,
		client: { x: event.clientX, y: event.clientY },
		mods: { shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, ctrl: event.ctrlKey },
		pointer: (kind === "touch" || kind === "pen" ? kind : "mouse") as PointerKind,
		time: performance.now(),
	};
}

export function createEditor(host: EditorHost) {
	/*
	 * The selection the last stage left (`state/pen-tools.ts`, `keptSelection`): a stage mounted
	 * again starts with what was selected, as it did when the selection was the page's own signal.
	 */
	const [state, setState] = createSignal<EditorState>(withSelection(initialState(untrack(host.mode), untrack(host.tool)), { items: keptSelection() }));
	const read = () => untrack(state);
	const commit = (next: EditorState) => {
		if (next !== read()) setState(next);
	};

	/** Resize steps waiting for the frame the sheet paints them in (`EngineSeam.mark`, `shows`). */
	const frames: Array<{ mark: number; resize: ResizeBox }> = [];
	/** What waits for the next frame the sheet shows: a deleted item's outline goes with the item. */
	const afterFrame: Array<{ mark: number; run: () => void }> = [];
	const timers = new Set<ReturnType<typeof setTimeout>>();
	onCleanup(() => {
		for (const timer of timers) clearTimeout(timer);
	});
	/** The drawing generation: one more for every new drawing the engine draws. */
	let generation = 0;
	let lastDrawn: PenDocument | undefined;

	const effects = createEffects({
		...host.effects,
		boards: host.boards,
		settle: (landing) => host.engine.settle(landing),
		wake: (at) => {
			const timer = setTimeout(() => {
				timers.delete(timer);
				dispatch({ type: "tick", time: at });
			}, Math.max(0, at - performance.now()));
			timers.add(timer);
		},
		awaitFrame: (resize) => frames.push({ mark: host.engine.mark(), resize }),
	});

	const context = (): GestureContext => ({
		zoom: host.zoom(),
		view: host.view(),
		generation,
		nextIds: host.nextIds,
		boardRev: (path) => untrack(host.boards).find((board) => board.path === path)?.rev ?? 0,
		linkAt: (point) => host.engine.linkAt(point),
		overComposer: effects.overComposer,
	});

	/**
	 * One input stepped. The state is in place before anything is said to the engine or the page,
	 * so an engine that answers at once (a preview is laid out, and `drawn` comes, in the same call)
	 * steps from the state this step left.
	 */
	const dispatch = (input: Input) => {
		const result = step(read(), input, host.scene, untrack(context));
		batch(() => commit(result.state));
		if (result.preview !== undefined) host.engine.preview(result.preview ?? undefined);
		if (result.ops.length) host.onPenEdit(result.ops);
		for (const effect of result.effects) effects.run(effect);
		// A resize let go of has no step left to wait for.
		if (!read().resize) frames.length = 0;
	};
	const update = (change: (now: EditorState) => EditorState) => commit(change(read()));

	// The mode and the tool are the app's and the drawing bar's: the state keeps a copy for the step to read.
	createEffect(() => {
		const mode = host.mode();
		const tool = host.tool();
		update((now) => (now.mode === mode && now.tool === tool ? now : { ...now, mode, tool }));
	});
	// Boards picked up that are no longer on the canvas are let go.
	createEffect(() => {
		const present = new Set(host.boards().map((board) => board.path));
		update((now) => pruneBoards(now, present));
	});

	const part = <T>(pick: (now: EditorState) => T): Accessor<T> => createMemo(() => pick(state()));
	const items = part((now) => now.selection.items);
	const boardPicks = part((now) => now.selection.boards);
	const boardResize = part((now) => now.boardResize);
	const boardDrag = part((now) => now.boardDrag);
	const ownDrag = part((now) => now.ownDrag);

	/*
	 * A board size let go of is held until the board is at it (`landBoardResize`): asked again
	 * whenever the boards change, and once as it is let go.
	 */
	createEffect(() => {
		const held = boardResize();
		if (!held?.released) return;
		const board = host.boards().find((candidate) => candidate.path === held.path);
		update((now) => landBoardResize(now, board ? { path: board.path, x: board.x, y: board.y, w: board.w, h: board.h, rev: board.rev, ...(board.format === "slides" ? { slides: true } : {}) } : undefined));
	});
	/** The boards a drag carries and how far, for the carried layer; only boards that are pages, drawn as pictures there. */
	createEffect(() => {
		const drag = boardDrag();
		const held = ownDrag();
		const board = held ? host.boards().find((one) => one.path === held.path) : undefined;
		const moving = drag ? { paths: drag.paths, dx: drag.dx, dy: drag.dy } : held && board ? { paths: [held.path], dx: held.x - board.x, dy: held.y - board.y } : undefined;
		// The boards' pictures are the engine's, and go with the drag there.
		host.engine.carry(moving?.paths ?? [], moving ?? { dx: 0, dy: 0 });
	});

	/** Whether an arrow on the drawing ends on this board. */
	const arrowEndsOn = (path: string) => {
		for (const { node } of host.scene.items()) {
			if (!isArrow(node)) continue;
			const ends = (node.metadata ?? {}) as { from?: unknown; to?: unknown };
			if (arrowEndItem(ends.from) === path || arrowEndItem(ends.to) === path) return true;
		}
		return false;
	};
	const ZERO: Offset = { dx: 0, dy: 0 };
	const shown = part(shownDrag);
	const shownResize = part((now) => now.shownResize);
	/** A drop's glide in hand, each frame of it as the engine draws it (`stage/engine.ts`, `onGlide`). */
	const [glide, setGlide] = createSignal<ReadonlyMap<string, Offset> | undefined>(undefined, { equals: false });

	const select = (next: readonly string[] | ((now: readonly string[]) => readonly string[])) => update((now) => withSelection(now, { items: typeof next === "function" ? next(now.selection.items) : next }));
	onCleanup(feedSelection({ items, select: (next) => select(next) }));

	return {
		state,
		items,
		boardPicks,
		hoverItem: part((now) => now.hover.item),
		hoverBoard: part((now) => now.hover.board),
		hoverPicture: part((now) => now.hover.picture),
		hoverBlock: part((now) => now.hover.block),
		overLink: part((now) => now.hover.link),
		/** Alt is held over the stage: the distances from the selection to what is hovered. */
		altHeld: part((now) => !!now.hover.alt),
		gesture: part((now) => now.gesture),
		drag: part((now) => now.drag),
		shownDrag: shown,
		boardDrag,
		ownDrag,
		resize: part((now) => now.resize),
		shownResize,
		boardResize,
		radius: part((now) => now.radius),
		marquee: part((now) => now.marquee),
		guides: part((now) => now.guides),
		dropInto: part((now) => now.drop.into),
		dropSlot: part((now) => now.drop.slot),
		dropNear: part((now) => now.drop.near),
		joins: part((now) => now.joins),
		sides: part((now) => now.sides),
		draft: part((now) => now.draft),
		endDraft: part((now) => now.endDraft),
		route: part((now) => now.route),
		/** The words open for typing (`dom/TextEditing.tsx`), and the item they are. */
		text: part((now) => now.text),
		typing: part((now) => now.text?.id),

		/** A board is being moved or sized: title bars and news glows step aside until it lands. */
		carrying: createMemo(() => !!boardDrag() || !!boardResize() || !!ownDrag()),
		/** The boards a gesture holds, which keep their nodes wherever the camera goes. */
		heldBoards: (): readonly string[] => {
			const sized = boardResize()?.path;
			return [...(boardDrag()?.paths ?? []), ...(sized === undefined ? [] : [sized])];
		},
		/** The board whose size is being dragged, if one is. */
		resizingBoard: () => boardResize()?.path,
		/**
		 * The board size the sheet should draw, while one is dragged: a board shown as a picture
		 * (not `live`) is drawn by the sheet, and one an arrow ends on is followed by the arrow. A
		 * live board's page is drawn over the sheet at the new box, so the sheet keeps it where it was.
		 */
		sheetResize: (live: (path: string) => boolean) => {
			const held = boardResize();
			return held && (!live(held.path) || untrack(() => arrowEndsOn(held.path))) ? held : undefined;
		},
		/** A drop's glide in hand: how far each gliding item is still drawn from where it lands. */
		glide,
		/** Each frame of a drop's glide, from the engine; undefined when it ends. */
		setGlide: (shifts: ReadonlyMap<string, Offset> | undefined) => setGlide(shifts),
		/** How far a drawn item is carried, as the canvas shows it: the drag's, when it is selected, and any glide it lands with. */
		itemShift: (id: string): Offset => {
			const drag = items().includes(id) ? shown() : ZERO;
			const gliding = glideShift(glide(), host.scene, id);
			return gliding.dx || gliding.dy ? { dx: drag.dx + gliding.dx, dy: drag.dy + gliding.dy } : drag;
		},
		/** The box a drawn item is being resized to, as the sheet has drawn it. */
		itemResize: (id: string): ResizeBox | undefined => {
			const resized = shownResize();
			return resized?.id === id ? resized : undefined;
		},

		/** Step one input; true when it left a gesture in hand, for the page to follow the pointer. */
		input: (input: Input): boolean => {
			dispatch(input);
			return !!read().gesture;
		},
		select,
		pickBoards: (next: readonly string[] | ((now: readonly string[]) => readonly string[])) => update((now) => withSelection(now, { boards: typeof next === "function" ? next(now.selection.boards) : next })),
		/** Select what was just asked for, which the drawing does not have until the server answers. */
		selectMade: (made: readonly string[]) => update((now) => selectMade(now, made)),
		hover: (next: Partial<EditorState["hover"]>) =>
			update((now) => ((Object.keys(next) as Array<keyof EditorState["hover"]>).every((key) => now.hover[key] === next[key]) ? now : { ...now, hover: { ...now.hover, ...next } })),
		setOwnDrag: (at: EditorState["ownDrag"]) => update((now) => (now.ownDrag === at ? now : { ...now, ownDrag: at })),
		setText: (text: TextSession | undefined) => update((now) => (now.text === text ? now : { ...now, text })),
		setDraft: (draft: DraftBox | undefined) => update((now) => (now.draft === draft ? now : { ...now, draft })),
		setHints: (hints: { joins?: readonly Rect[]; sides?: readonly SideHintBox[] }) => update((now) => ({ ...now, ...(hints.joins ? { joins: hints.joins } : {}), ...(hints.sides ? { sides: hints.sides } : {}) })),

		/**
		 * The engine laid the drawing out (`drawnDoc`), the page having `current`: a new drawing is
		 * one more generation, and the one that answers a gesture puts its preview down.
		 */
		drawn: (drawnDoc: PenDocument | undefined, current: PenDocument | undefined) => {
			const fresh = drawnDoc !== lastDrawn;
			lastDrawn = drawnDoc;
			if (fresh) generation++;
			const doc = drawnDoc ?? current;
			dispatch({ type: "drawn", fresh, current: fresh && drawnDoc === current, present: doc ? penIds(doc) : new Set<string>() });
		},
		/** The sheet put a frame on screen: the resize steps it painted are what the outline follows. */
		presented: () => {
			let painted: ResizeBox | undefined;
			while (frames.length && host.engine.shows(frames[0]!.mark)) painted = frames.shift()!.resize;
			if (painted && read().resize) dispatch({ type: "frame", resize: painted });
			for (let k = afterFrame.length - 1; k >= 0; k--) {
				const wait = afterFrame[k]!;
				if (!host.engine.shows(wait.mark)) continue;
				afterFrame.splice(k, 1);
				wait.run();
			}
		},
		/** Run this once the sheet shows a frame painted after `mark` (`EngineSeam.mark`). */
		afterFrame: (mark: number, run: () => void) => afterFrame.push({ mark, run }),
		carryPending: (pending: boolean) => dispatch({ type: "carry-pending", pending }),
		openLink: effects.openLink,
	};
}

export type Editor = ReturnType<typeof createEditor>;
export type { BoardBox };
