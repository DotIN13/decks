/**
 * Adding to the stage: an item made by a tool (a press, or a drag corner to corner, followed to its
 * lift: `create`), one made at a point (`makeAt`), the note a double-click or a double tap on bare
 * canvas makes (`noteAt`), an arrow drawn from an item's anchor (`fromAnchor`), and the insert
 * panel a shape or an icon is picked in (`InsertMenu`).
 *
 * What each pick does and what an arrow being drawn lights up are decided in `core/insert.ts`; the
 * ops are `core/ops.ts`'s. The dashed outline of what was drawn is kept until the sheet draws the
 * item it made (`presented`), or a moment and a half.
 */
import { sidePoint, type ArrowSide, type Op } from "@decks/pen";
import { Show } from "solid-js";
import { canvasHost } from "../../host.ts";
import { insertPanel, penIcon, penShape, setInsertPanel, setPenTool } from "../../state/pen-tools.ts";
import { newCard } from "../../pen/card-frame.ts";
import { Insert } from "../../pen/Insert.tsx";
import type { Box } from "../../pen/snap.ts";
import { joinAt as joinAtIn, newArrowEnds, type Join } from "../core/arrows.ts";
import { frameAt as frameAtIn } from "../core/drop.ts";
import { drawHints, insertPick, opensWords } from "../core/insert.ts";
import type { PenTool, Pt } from "../core/model.ts";
import { arrowInsertOp, drawnOp, makeAtOp, type MakeOptions, type NextId } from "../core/ops.ts";
import type { Outline } from "../core/overlay.ts";
import type { SceneQuery } from "../core/scene.ts";
import type { Editor } from "./controller.ts";
import type { TextEditing } from "./TextEditing.tsx";

/** A point on the screen, as a pointer or mouse event has it. */
type Client = { clientX: number; clientY: number };

export type InsertHost = {
	scene: SceneQuery;
	/** The camera's zoom: how near an arrow's end has to be to join something. */
	zoom: () => number;
	/** Where a screen point is on the stage, from the camera now. */
	worldAt: (event: Client) => Pt;
	edit: (ops: Op[]) => void;
	/** An id no item has. */
	freshId: () => string;
	/** Ids for several new items at once, none `also`. */
	idsBut: (also: string) => NextId;
	/** Follow a press to its lift (`dom/pointer.ts`, `follow`). */
	follow: (event: PointerEvent, move: (e: PointerEvent) => void, done: (moved: boolean, e: PointerEvent) => void) => void;
};

export function createInsertMenu(editor: Editor, text: TextEditing, host: InsertHost) {
	const worldAt = host.worldAt;
	/** When a tool last made an item, so the second press of a double-click does not make a note as well. */
	let penMadeAt = 0;

	/** What a tool makes, besides the tool (`editor/core/ops.ts`): the shape and icon picked, and ids for what it holds, never `id`. */
	const makeOptions = (id: string): MakeOptions => ({ shape: penShape(), icon: penIcon(), nextId: host.idsBut(id), card: newCard });

	/** What an arrow's end joins at a point (`editor/core/arrows.ts`), at the camera's zoom. */
	const joinAt = (point: Pt, not?: string): Join | undefined => joinAtIn(host.scene, point, { zoom: host.zoom(), not });

	/**
	 * The innermost frame under a point. An item drawn inside a free-standing frame belongs to it,
	 * which is the plain call; `stacking` also takes the frames that arrange their children, which
	 * is what a drop asks for. A library shape is a frame with a layout too, and never either.
	 */
	const frameAt = (point: Pt, stacking = false) => frameAtIn(host.scene, point, stacking);

	/*
	 * The dashed outline of what was drawn, kept on screen until the sheet shows the item it made: the
	 * item is drawn only once the server has answered, and taking the outline away at the release left
	 * the spot empty for two or three frames.
	 */
	let draftFor: string | undefined;
	const keepDraftFor = (id: string) => {
		draftFor = id;
		setTimeout(() => {
			if (draftFor !== id) return;
			draftFor = undefined;
			editor.setDraft(undefined);
		}, 1500);
	};
	const penCreate = (event: PointerEvent, tool: Exclude<PenTool, "select">, at: Pt, from?: { name: string; box: Box; side?: ArrowSide }) => {
		// A new drawing: the outline still standing in for the last item is not this one's to take away.
		draftFor = undefined;
		editor.setDraft({ tool, x1: at.x, y1: at.y, x2: at.x, y2: at.y });
		// An arrow lights up what each of its ends would join, from the first press to the release.
		const startJoin = tool === "arrow" ? (from ?? joinAt(at)) : undefined;
		if (startJoin) editor.setHints({ joins: [startJoin.box] });
		host.follow(
			event,
			(e) => {
				const now = worldAt(e);
				editor.setDraft({ tool, x1: at.x, y1: at.y, x2: now.x, y2: now.y });
				if (tool === "arrow") editor.setHints(drawHints(startJoin, joinAt(now)));
			},
			(moved, e) => {
				editor.setHints({ joins: [], sides: [] });
				setPenTool("select");
				penMadeAt = performance.now();
				const end = worldAt(e);
				const id = host.freshId();
				if (tool === "arrow") {
					/*
					 * Each end joins what it was let go on, and follows it from then on; an end on bare
					 * canvas is a point there. A click with no drag makes an arrow only between two things.
					 */
					const made = newArrowEnds(startJoin, joinAt(end), at, end, moved);
					if (!made) return void editor.setDraft(undefined);
					const { from, to } = made;
					host.edit([arrowInsertOp(id, from, to)]);
					keepDraftFor(id);
					editor.selectMade([id]);
					return;
				}
				if (!moved) {
					editor.setDraft(undefined);
					return penMakeAt(tool, at);
				}
				const parent = frameAt(at);
				// The box dragged out, at least 8 each way (`editor/core/ops.ts` `drawnOp`).
				const { op, node, box } = drawnOp(tool, id, at, end, { ...makeOptions(id), ...(parent ? { parent } : {}) });
				host.edit([op]);
				// Words open an editor over the spot at once; anything else keeps its dashed outline until it is drawn.
				if (opensWords(tool)) editor.setDraft(undefined);
				else keepDraftFor(id);
				editor.selectMade([id]);
				if (opensWords(tool)) text.openPenText({ id, node, box }, true);
			},
		);
	};

	/**
	 * One item of a tool, at its own size, at a stage point: a click with a tool armed, and a pick
	 * from the canvas menu. Words open for typing at once.
	 */
	const penMakeAt = (tool: Exclude<PenTool, "select" | "arrow">, at: Pt, centred = false) => {
		penMadeAt = performance.now();
		const id = host.freshId();
		// From the insert panel, the item is put with its middle where it is put; from a click, its corner (`editor/core/ops.ts`).
		const parent = frameAt(at);
		const { op, node, box } = makeAtOp(tool, id, at, { ...makeOptions(id), centred, ...(parent ? { parent } : {}) });
		host.edit([op]);
		editor.selectMade([id]);
		if (opensWords(tool)) text.openPenText({ id, node, box }, true);
	};

	/** A press on one of an item's anchors (`OverlayLayer`): an arrow drawn from that side of it. */
	const fromAnchor = (event: PointerEvent, box: Outline, side: ArrowSide) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const start = sidePoint(box, side);
		penCreate(event, "arrow", { x: start[0], y: start[1] }, { name: box.id, box: { x: box.x, y: box.y, w: box.w, h: box.h }, side });
	};

	/**
	 * A note at a screen point, open for typing: a double-click or a double tap on bare canvas. The
	 * same note the Note tool makes with a click there (`penMakeAt`), its corner at the point. Not
	 * on a canvas that can only be read (one opened from a file).
	 */
	const noteAt = (event: Client) => {
		if (!canvasHost().canWrite()) return;
		penMakeAt("note", worldAt(event));
	};

	/** A pick in the insert panel: put where it was opened for, or else armed for the next press. */
	const insertPicked = (tool: "shape" | "icon") => {
		const open = insertPanel();
		setInsertPanel(undefined);
		// Another icon for one already drawn: the same place, size and colour, a new name.
		const pick = insertPick(open, tool, penIcon());
		if (pick.do === "update") host.edit(pick.ops);
		else if (pick.do === "make") penMakeAt(tool, pick.at, true);
		else setPenTool(tool);
	};
	return {
		create: penCreate,
		makeAt: penMakeAt,
		fromAnchor,
		/** When a tool last made an item. */
		madeAt: () => penMadeAt,
		noteAt,
		insertPicked,
		/** The sheet put a frame on screen: the dashed outline goes once the item it stood in for is drawn. */
		presented: () => {
			if (draftFor && host.scene.item(draftFor)) {
				draftFor = undefined;
				editor.setDraft(undefined);
			}
		},
	};
}
export type InsertMenuApi = ReturnType<typeof createInsertMenu>;

/** The insert panel a shape or an icon is picked in, while it is open. */
export function InsertMenu(props: { menu: InsertMenuApi }) {
	return <Show when={insertPanel()}>{(open) => <Insert open={open()} onPick={props.menu.insertPicked} onClose={() => setInsertPanel(undefined)} />}</Show>;
}
