/**
 * The editor on the page. The editor itself is the engine's (`crates/editor`, reached through the
 * seam's `editorStep`, `crates/web/src/editing.rs`): each input goes to it, and it answers with the
 * ops to send (`onPenEdit`), the preview to show (said to the engine here, which tells its worker what
 * is lifted), the effects for the page (`dom/effects.ts`) and its state, which is kept here in one
 * signal in the shape `core/model.ts` names (`EditorState`), so every reader on the page reads it as
 * before. What the page alone knows stays here: the hover, the words open, a board's own drag, a draft.
 *
 * Each part of the state is handed out as its own memo, so what reads the selection is not
 * touched by a pointer move that changes only the drag. The step keeps every part it does not
 * change as the same value, which is what lets a memo see that nothing changed.
 *
 * The selection is this editor's. `state/pen-tools.ts` reads and writes it through
 * `feedSelection`, so the drawing bar and the properties panel see the one selection the stage has.
 */
import { arrowEndItem, ids as penIds, isArrow, mediaOf, type MediaItem, type Op, type PenDocument } from "@decks/pen";
import { batch, createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import { feedSelection, keptSelection } from "../pen-tools.ts";
import { glideShift } from "./places.ts";
import { initialState, shownDrag, withSelection } from "../model.ts";
import type { Effect, Input, NextId, PointerInput } from "../wire.ts";
import type { PageBox, DraftBox, EditorState, Offset, PenTool, PointerKind, Pt, Rect, ResizeBox, SideHintBox } from "../model.ts";
import type { TextSession } from "../text.ts";
import type { EngineSeam, SceneQuery } from "../scene.ts";
import { createEffects, type EffectHost } from "./effects.ts";
import { PROFILE } from "../../device/profile.ts";

/** A board as the editor needs it from the app: where it is and its revision. */
export type HostPage = { path: string; x: number; y: number; w: number; h: number; rev: number; title?: string | undefined };

export type EditorHost = {
	scene: SceneQuery;
	engine: EngineSeam;
	mode: () => EditorState["mode"];
	tool: () => PenTool;
	zoom: () => number;
	/** The window, in stage pixels. */
	view: () => Rect;
	nextIds: () => NextId;
	boards: () => readonly HostPage[];
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
		// The engine paints a resize in the frame its step is in: there is nothing to wait for.
		awaitFrame: () => {},
	});

	/** The page's frame for the engine's editor: the camera, the drawing's generation, the boards' revisions, the composer. */
	const frameFor = (input?: Input) => {
		const view = host.view();
		const now = read();
		// What the gesture carries, which for a board picked up alone is not the selection.
		const carried = now.gesture as { ids?: string[]; boards?: string[] } | undefined;
		const over = input && input.type === "release" ? effects.overComposer(input.client, carried?.ids ?? now.selection.items, carried?.boards ?? now.selection.boards) : false;
		return { zoom: host.zoom(), view, generation, revs: Object.fromEntries(untrack(host.boards).map((board) => [board.path, board.rev])), overComposer: over };
	};

	/**
	 * The engine's editor's state, taken into the page's: everything but what the page keeps itself (the
	 * hover, the words open, a board's own drag, a draft, the hints of an arrow being drawn), and each part
	 * kept as the same value when it has not changed, so a memo on it is not touched.
	 */
	const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
	const take = (now: EditorState, from: Record<string, unknown>): EditorState => {
		const keep = <K extends keyof EditorState>(key: K, value: unknown) => (same(now[key], value) ? now[key] : (value as EditorState[K]));
		const next: EditorState = {
			...now,
			selection: keep("selection", from.selection),
			gesture: keep("gesture", from.gesture ?? undefined),
			drag: keep("drag", from.drag),
			pageDrag: keep("pageDrag", from.pageDrag),
			resize: keep("resize", from.resize),
			shownResize: keep("shownResize", from.shownResize),
			pageResize: keep("pageResize", from.pageResize),
			radius: keep("radius", from.radius),
			marquee: keep("marquee", from.marquee),
			guides: keep("guides", from.guides ?? []),
			drop: keep("drop", from.drop ?? {}),
			endDraft: keep("endDraft", from.endDraft),
			route: keep("route", from.route),
			carryPending: !!from.carryPending,
			settling: keep("settling", from.settling ?? []),
		};
		// The joins and sides an arrow's end is near are the engine's while it is carried; the page's while an arrow is drawn.
		if (Array.isArray(from.joins) && (from.joins.length || (Array.isArray(from.sides) && from.sides.length) || now.gesture)) {
			next.joins = keep("joins", from.joins);
			next.sides = keep("sides", from.sides);
		}
		const changed = (Object.keys(next) as Array<keyof EditorState>).some((key) => next[key] !== now[key]);
		return changed ? next : now;
	};

	/** The selection the engine's editor has not heard yet: the page's, before the engine had loaded. */
	let unsynced = true;
	const sync = () => {
		if (!unsynced || !host.engine.editorReady()) return;
		unsynced = false;
		host.engine.editorCall("form", { form: PROFILE.form });
		const now = read();
		host.engine.editorCall("mode", { mode: now.mode, tool: now.tool });
		const state = host.engine.editorCall<Record<string, unknown>>("select", { items: now.selection.items, boards: now.selection.boards });
		if (state) commit(take(now, state));
	};
	/** A call to the engine's editor that answers with its state, taken in. */
	const callState = (name: string, args: unknown) => {
		sync();
		const state = host.engine.editorCall<Record<string, unknown>>(name, args);
		if (state && !("error" in state)) batch(() => commit(take(read(), state)));
		return !!state;
	};

	/** An effect as the page runs it: a settle's landing as a map, a film's or a sound's as its own. */
	const effectOf = (raw: Record<string, unknown> & { do: string }): Effect | undefined => {
		if (raw.do === "settle") return Array.isArray(raw.landing) && raw.landing.length ? { do: "settle", landing: new Map((raw.landing as Array<{ id: string; x: number; y: number; w: number; h: number }>).map((one) => [one.id, { x: one.x, y: one.y, w: one.w, h: one.h }])) } : { do: "settle" };
		if (raw.do === "media") {
			const media = mediaOf(host.scene.node(String(raw.id)));
			return media ? { do: "media", id: String(raw.id), media } : undefined;
		}
		return raw as unknown as Effect;
	};

	/**
	 * One input, to the engine's editor. Its state is taken in before anything is said to the engine or
	 * the page, so an engine that answers at once (a preview laid out, and `drawn` comes, in the same call)
	 * steps from the state this step left.
	 */
	const dispatch = (input: Input) => {
		sync();
		const wire = input.type === "drawn" ? { ...input, present: [...input.present] } : input;
		const answer = host.engine.editorStep(wire, frameFor(input));
		if (!answer) return;
		batch(() => commit(take(read(), answer.state)));
		if ("preview" in answer) host.engine.preview(answer.preview ? new Map(answer.preview) : undefined);
		const said = answer.effects.map(effectOf).filter((one): one is Effect => !!one);
		/*
		 * A drop's landing is said before its edit is sent: a host that applies the edit itself (a
		 * mounted canvas, Studio) answers with the new drawing in the same call, and the engine glides
		 * only what it was told would land. Sent first, the drawing came before the landing and nothing
		 * glided. The rest go after, as before.
		 */
		for (const effect of said) if (effect.do === "settle") effects.run(effect);
		if (answer.ops.length) host.onPenEdit(answer.ops as Op[]);
		for (const effect of said) if (effect.do !== "settle") effects.run(effect);
	};
	const update = (change: (now: EditorState) => EditorState) => commit(change(read()));

	// The mode and the tool are the app's and the drawing bar's: the state keeps a copy for the step to read.
	createEffect(() => {
		const mode = host.mode();
		const tool = host.tool();
		update((now) => (now.mode === mode && now.tool === tool ? now : { ...now, mode, tool }));
		untrack(() => callState("mode", { mode, tool }));
	});
	/*
	 * The boards as they are now, to the engine's editor: boards picked up that are no longer on the
	 * canvas are let go, a board size let go of is let go once the board is at it, and boards a drag let
	 * go of are put down once they are where the move asked.
	 */
	createEffect(() => {
		const boards = host.boards().map((board) => ({ path: board.path, x: board.x, y: board.y, w: board.w, h: board.h, rev: board.rev }));
		untrack(() => callState("land", { boards }));
	});

	const part = <T>(pick: (now: EditorState) => T): Accessor<T> => createMemo(() => pick(state()));
	const items = part((now) => now.selection.items);
	const pagePicks = part((now) => now.selection.boards);
	const pageResize = part((now) => now.pageResize);
	const pageDrag = part((now) => now.pageDrag);
	const ownDrag = part((now) => now.ownDrag);

	/** The boards a drag carries and how far, for the carried layer; only boards that are pages, drawn as pictures there. */
	createEffect(() => {
		const drag = pageDrag();
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

	/** A new selection, said to the engine's editor; before the engine has loaded, kept here and said once it has. */
	const select = (next: readonly string[] | ((now: readonly string[]) => readonly string[])) => {
		const items = typeof next === "function" ? next(read().selection.items) : next;
		if (!callState("select", { items })) update((now) => withSelection(now, { items }));
	};
	onCleanup(feedSelection({ items, select: (next) => select(next) }));

	return {
		state,
		items,
		pagePicks,
		hoverItem: part((now) => now.hover.item),
		hoverPage: part((now) => now.hover.board),
		hoverPicture: part((now) => now.hover.picture),
		hoverBlock: part((now) => now.hover.block),
		overLink: part((now) => now.hover.link),
		/** Alt is held over the stage: the distances from the selection to what is hovered. */
		altHeld: part((now) => !!now.hover.alt),
		gesture: part((now) => now.gesture),
		drag: part((now) => now.drag),
		shownDrag: shown,
		pageDrag,
		ownDrag,
		resize: part((now) => now.resize),
		shownResize,
		pageResize,
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
		carrying: createMemo(() => !!pageDrag() || !!pageResize() || !!ownDrag()),
		/** The boards a gesture holds, which keep their nodes wherever the camera goes. */
		heldPages: (): readonly string[] => {
			const sized = pageResize()?.path;
			return [...(pageDrag()?.paths ?? []), ...(sized === undefined ? [] : [sized])];
		},
		/** The board whose size is being dragged, if one is. */
		resizingPage: () => pageResize()?.path,
		/**
		 * The board size the sheet should draw, while one is dragged: a board shown as a picture
		 * (not `live`) is drawn by the sheet, and one an arrow ends on is followed by the arrow. A
		 * live board's page is drawn over the sheet at the new box, so the sheet keeps it where it was.
		 */
		sheetResize: (live: (path: string) => boolean) => {
			const held = pageResize();
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
		/**
		 * One of the engine's editor's other answers, by name (`crates/web/src/editing_wire.rs`, `call`): a pick,
		 * a drop slot, the ops for a move, a make or a delete, a key. At the camera's zoom, which a press's reach is on.
		 */
		call: <T = unknown>(name: string, args: Record<string, unknown> = {}): T | undefined => {
			sync();
			return host.engine.editorCall<T>(name, { zoom: host.zoom(), ...args });
		},
		input: (input: Input): boolean => {
			dispatch(input);
			return !!read().gesture;
		},
		select,
		pickPages: (next: readonly string[] | ((now: readonly string[]) => readonly string[])) => {
			const boards = typeof next === "function" ? next(read().selection.boards) : next;
			if (!callState("select", { boards })) update((now) => withSelection(now, { boards }));
		},
		/** Select what was just asked for, which the drawing does not have until the server answers. */
		selectMade: (made: readonly string[]) => {
			if (!callState("select", { made })) update((now) => withSelection(now, { items: made }));
		},
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
export type { PageBox };
