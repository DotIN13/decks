import { createEffect, createRoot, on, untrack, type Accessor } from "solid-js";
import { drawing, inkColor, inkTool, inkWidth, setDrawing, setInkColor, setInkTool, setInkWidth } from "../../edit/ink.ts";
import { handTool, penArrowStyle, penBoxes, penIcon, penLive, penSelection, penShape, penTool, penTyping, setHandTool, setPenArrowStyle, setPenBoxes, setPenIcon, setPenLive, setPenSelection, setPenShape, setPenTool, setPenTyping } from "../../edit/pen-tools.ts";

/**
 * The tools' state, shared by the app's chrome and the canvas, kept the same on both sides of the
 * frame. It is module state of this package (`state/pen-tools.ts`, `state/ink.ts`): the app's tool
 * column, ink bar and properties panel set it in the page, and the stage reads and sets it in the
 * frame, where the package is loaded again. Each side says what changed on its side; what it was just
 * told it does not say back.
 */
const SHARED: Record<string, [Accessor<unknown>, (value: never) => void]> = {
	tool: [penTool, setPenTool],
	hand: [handTool, setHandTool],
	shape: [penShape, setPenShape],
	icon: [penIcon, setPenIcon],
	arrow: [penArrowStyle, setPenArrowStyle],
	typing: [penTyping, setPenTyping],
	selection: [penSelection, setPenSelection],
	live: [penLive, setPenLive],
	boxes: [penBoxes, setPenBoxes],
	ink: [drawing, setDrawing],
	inkTool: [inkTool, setInkTool],
	inkColor: [inkColor, setInkColor],
	inkWidth: [inkWidth, setInkWidth],
};

/** The same value, as far as what crosses the port can tell. */
const same = (a: unknown, b: unknown) => {
	if (a === b) return true;
	if (a instanceof Map && b instanceof Map) return a.size === b.size && [...a].every(([key, value]) => JSON.stringify(b.get(key)) === JSON.stringify(value));
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
};

/**
 * Keep the tools' state in step with the other side: `send` a patch of what changed here, and apply
 * the other side's patches as they come (`receive`). Answers what stops it.
 */
export function syncTools(send: (patch: Record<string, unknown>) => void, receive: (apply: (patch: Record<string, unknown>) => void) => void): () => void {
	const told = new Map<string, unknown>();
	receive((patch) => {
		for (const [key, value] of Object.entries(patch)) {
			const pair = SHARED[key];
			if (!pair) continue;
			told.set(key, value);
			if (!same(untrack(pair[0]), value)) (pair[1] as (value: unknown) => void)(value);
		}
	});
	return createRoot((done) => {
		for (const [key, [read]] of Object.entries(SHARED)) {
			createEffect(
				on(read, (value) => {
					if (told.has(key) && same(told.get(key), value)) return;
					told.delete(key);
					send({ [key]: value });
				}, { defer: true }),
			);
		}
		return done;
	});
}

/** All of it as it is now, for a side that has just started. */
export function toolsNow(): Record<string, unknown> {
	return Object.fromEntries(Object.entries(SHARED).map(([key, [read]]) => [key, untrack(read)]));
}
