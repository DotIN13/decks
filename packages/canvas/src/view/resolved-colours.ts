import { createEffect } from "solid-js";
import { scheme } from "../base/theme.ts";
import { CanvasEngine } from "../render/engine.ts";
import { type CanvasViewProps } from "./CanvasView.tsx";

/** What `createResolvedColours` reads of `CanvasView` (`CanvasView.tsx`), each read when it is used. */
export interface ResolvedColoursNeeds {
	readonly props: CanvasViewProps;
	readonly penLayer: CanvasEngine;
}

export function createResolvedColours(d: ResolvedColoursNeeds) {
	/*
	 * Boards picked up with the drawing (`editor.pagePicks`): by a marquee, or Shift and a press on a
	 * title bar. They move with the selected items as one selection. The app's own selected board is
	 * a different thing — the one board whose page takes the keys — and a single press on a board is
	 * still only that.
	 */

	const resolvedColours = new Map<string, string>();

	/**
	 * A writer's colour as the sheet can paint it. A board with no writer's colour glows in
	 * `var(--canvas-accent)`, which a canvas does not understand: the 2D one drew it in its default
	 * black and Skia in nothing. So a `var()` is looked up here, on the page, in the current scheme.
	 */
	const resolveColour = (colour: string) => {
		const name = /^var\((--[\w-]+)/.exec(colour.trim())?.[1];
		if (!name) return colour;
		/* Kept per scheme: reading a computed style makes the page recalculate its styles first, and
		   the sheet's boards are re-sent on every move of a board drag, where that cost 8 ms a move. */
		const key = `${scheme()}|${name}`;
		const known = resolvedColours.get(key);
		if (known) return known;
		const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#3b5cf6";
		resolvedColours.set(key, value);
		return value;
	};

	/*
	 * The drawing's placeholder frames are drawn unfinished in its last writer's colour, with its name;
	 * with no writer known, in the accent and with no name.
	 */
	createEffect(() => {
		const writer = d.props.pen?.writer;
		const color = resolveColour(writer?.color ?? "var(--canvas-accent)");
		d.penLayer.previews.setWriter(writer?.name ? { name: writer.name, color } : { color });
	});

	return {
		resolveColour,
	};
}
