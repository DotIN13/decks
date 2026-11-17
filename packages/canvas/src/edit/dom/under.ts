import type { Pt } from "../core/model.ts";
import { pickAt, pictureAt, type PickOptions } from "../core/pick.ts";
import { type Client, type PointerHost } from "./pointer.ts";

/** What `createUnder` reads of `createPointer` (`pointer.ts`). */
export interface UnderNeeds {
	readonly host: PointerHost;
}

/** What is under a press: the world point, the item picked there, a picture, and whether it landed on the drawing or the bare canvas. */
export function createUnder(d: UnderNeeds) {
	const worldAt = d.host.worldAt;

	const pickAtHere = (at: Pt, options?: PickOptions) => pickAt(d.host.scene, at, options);

	/**
	 * The board whose picture is under a point and that has no node of its own to take the press
	 * (below the live zoom, `rendered`): the last in file order, as the sheet draws it on top.
	 */
	const pictureUnder = (event: Client): string | undefined => {
		const at = worldAt(event);
		// The spatial index finds the few boards near the point; core decides among them, in paint order.
		return pictureAt(d.host.pagesNear(at), at, d.host.rendered());
	};

	/**
	 * A press on a drawn item's click shape (`render/engine.ts`, `attachHits`). Only items over a board have one, to take
	 * the press from the board's page; on bare canvas the press is the stage's and `pickAt` finds the item.
	 */
	const onDrawn = (target: EventTarget | null) => !!(target as Element | null)?.closest?.(".pen-hits");

	/** Bare canvas or something drawn on it: either way not a board, and the canvas's to handle. */
	const onCanvas = (target: EventTarget | null) => target === d.host.element() || onDrawn(target);

	return {
		worldAt,
		pictureUnder,
		pickAtHere,
		onDrawn,
		onCanvas,
	};
}
