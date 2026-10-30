/**
 * What a press, a hover or a tap on the stage starts, decided: given what it landed on, the tool
 * in hand, whether the drawing can be edited, and what is pressing (a mouse, a pen or a finger).
 * `dom/pointer.ts` asks here and does what it says; the gestures themselves are `gesture.ts`'s.
 *
 * Nothing here reads the page. What is under the press is said by the page as facts, the costly
 * ones (`onItem`, `picture`) as questions asked only when the answer matters, as the page asked
 * them before they were decided here.
 */
import type { PenTool, PointerKind, Pt } from "./model.ts";

/** Before a press moves this far on the screen, it has not moved: `follow` holds its first step back. */
export const DRAG_SLOP_PX = 3;
/** A finger that has gone this far on the screen is a pan or a carry, not a tap. */
export const TAP_SLOP_PX = 10;
/** A finger held longer than this before it lifts is not a tap. */
export const TAP_MS = 600;
/** A second tap on the same item within this long: a double tap, which opens its words. */
export const SECOND_TAP_MS = 400;
/** Two taps on bare canvas this close in time and on the screen: the canvas menu, as a double-click is. */
export const BARE_TAP_MS = 350;
export const BARE_TAP_PX = 30;
/** A double-click this soon after the camera was dragged is the end of a pan, not a double-click. */
export const PANNED_MS = 400;
/** A double-click this soon after a tool made an item is that click's second press. */
export const MADE_MS = 500;

/** Where a press landed: the bare stage, a drawn item's click shape over a board, or anything else (a board, a handle, chrome). */
export type PressTarget = "stage" | "drawn" | "other";

/** What the page knows about a press as it lands. */
export type PressFacts = {
	pointer: PointerKind;
	/** `PointerEvent.button`: 0 the main one, 1 the middle. */
	button: number;
	target: PressTarget;
	/** Whether the drawing can be edited here at all (`Stage`'s `onPenEdit`). */
	editable: boolean;
	/** The draw tool is out: ink has the stage. */
	drawing: boolean;
	tool: PenTool;
	/** Space is held: a drag pans. */
	space: boolean;
	/** Fingers already on the glass before this one. */
	fingers: number;
	/** Whether something drawn is under the press (`pick.ts`, `pickAt`). Asked only when it decides. */
	onItem: () => boolean;
	/** The board whose picture, with no node of its own, is under the press. Asked only when it decides. */
	picture: () => string | undefined;
};

/** What a press does. */
export type PressAction =
	/** A tool is armed: it makes its item, from this press. */
	| { do: "make" }
	/** The select tool on the drawing or bare canvas: what is under the press is picked up, or a marquee drawn. */
	| { do: "press" }
	/** A mouse or a pen on a board's picture: it is carried as its node would be (`carry`), or only selected. */
	| { do: "picture"; path: string; carry: boolean }
	/**
	 * A finger: the board whose picture it landed on is selected, the finger goes to the stage's pool
	 * (a pan, a pinch), and then, with no picture, it follows the drawing's tap and carry
	 * (`drawing`) or a tap that lets go of the selection (`deselect`).
	 */
	| { do: "touch"; picture?: string; then?: "drawing" | "deselect" }
	/** The camera is dragged: with the middle button, Space, or on bare canvas, which lets the selected board go (`deselect`). */
	| { do: "pan"; deselect: boolean; middle: boolean }
	/** Not the stage's: a board's own press. */
	| { do: "nothing" };

/** Bare canvas or something drawn on it: either way not a board, and the canvas's to handle. */
const onCanvas = (target: PressTarget) => target === "stage" || target === "drawn";

/** What a press on the stage starts. */
export function decidePress(facts: PressFacts): PressAction {
	const { target, tool } = facts;
	/*
	 * A finger is its own gesture set, asked of the event rather than of the screen: a laptop with
	 * a touchscreen has both, and each pointer means what it means.
	 */
	if (facts.pointer === "touch") {
		// The drawing's, for the first finger only: a second is a pinch.
		const pen = facts.editable && !facts.drawing && facts.fingers === 0 && onCanvas(target);
		if (pen && tool !== "select") return { do: "make" };
		const onDrawn = () => target === "drawn" || (target === "stage" && facts.onItem());
		// A finger on a board's picture picks the board, and may still pan or pinch, as on its node.
		const picture = target === "stage" && facts.fingers === 0 && !(pen && onDrawn()) ? facts.picture() : undefined;
		if (picture) return { do: "touch", picture };
		if (pen && onDrawn()) return { do: "touch", then: "drawing" };
		if (pen) return { do: "touch", then: "deselect" };
		return { do: "touch" };
	}
	/*
	 * A press on a board's picture, where the board has no node (below the live zoom): picked up and
	 * moved as a press on its node does, unless a tool is armed or something drawn is over it.
	 */
	if (facts.button === 0 && target === "stage" && !facts.space && !facts.drawing && (!facts.editable || tool === "select") && !facts.onItem()) {
		const picture = facts.picture();
		if (picture) return { do: "picture", path: picture, carry: facts.editable };
	}
	if (facts.editable && !facts.drawing && facts.button === 0 && onCanvas(target) && !facts.space) return tool !== "select" ? { do: "make" } : { do: "press" };
	const middle = facts.button === 1;
	// A press on a drawn item while browsing is a press on the canvas: it pans, and a board lets go.
	const empty = facts.button === 0 && onCanvas(target);
	if (!middle && !empty && !(facts.space && facts.button === 0)) return { do: "nothing" };
	return { do: "pan", deselect: empty, middle };
}

/** What the page knows about a pointer moving over the stage with nothing in hand. */
export type HoverFacts = {
	pointer: PointerKind;
	editable: boolean;
	/**
	 * Edit mode. Browsing, nothing answers the pointer before a press but a link's hand: no outline
	 * round what is under it, no grip on a card's block, no distances.
	 */
	editing: boolean;
	drawing: boolean;
	/** Over a card block's grip. */
	onGrip: boolean;
	/** `PointerEvent.buttons`: 0 with none held. */
	buttons: number;
	tool: PenTool;
	target: PressTarget;
};

/**
 * What a hover does: nothing (a finger, a stage that cannot be edited, the pen out, or a grip,
 * which keeps itself and its block), clear what is lit (a button held, a tool armed, off the
 * canvas; the grip's block too when no button is held), or follow the pointer, once a frame:
 * for what it lights (`outlines`, edit mode) or, browsing, only for a link's hand and a card block's grip.
 */
export type HoverAction = { do: "none" } | { do: "clear"; block: boolean } | { do: "track"; outlines: boolean };

export function decideHover(facts: HoverFacts): HoverAction {
	if (facts.pointer === "touch" || !facts.editable || facts.drawing) return { do: "none" };
	if (facts.onGrip) return { do: "none" };
	if (facts.buttons !== 0 || facts.tool !== "select" || !onCanvas(facts.target)) return { do: "clear", block: facts.buttons === 0 };
	return { do: "track", outlines: facts.editing };
}

/** A tap on a drawn item before this one. */
export type LastTap = { id: string; at: number };

/** Whether a tap on `id` at `now` is the second of a double tap on it. */
export const isSecondTap = (last: LastTap | undefined, id: string, now: number): boolean => !!last && last.id === id && now - last.at < SECOND_TAP_MS;

/** A tap on bare canvas before this one, on the screen. */
export type BareTap = Pt & { at: number };

/** Whether a tap on bare canvas at `point` (on the screen) and `now` is the second of two close together. */
export const isBareSecondTap = (last: BareTap | undefined, point: Pt, now: number): boolean => !!last && now - last.at < BARE_TAP_MS && Math.hypot(point.x - last.x, point.y - last.y) < BARE_TAP_PX;
