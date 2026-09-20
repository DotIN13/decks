import type { Camera } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import { joinPlaces } from "../deck/place.ts";
import type { CanvasStore } from "./store.ts";

/**
 * What a frame from the browser acts on: the canvas it is looking at, or the chat it is in.
 *
 * Three verbs are all the board frames need — what is up, put these up, move this one — and
 * an agent has had them since stages existed. A canvas somebody opened with nobody's
 * conversation behind it needs the same three, so this is them for a canvas, with the same
 * placement rule an agent uses (`deck/place.ts`) so a board added by hand lands where one
 * added by an agent would.
 */
export interface StageTarget {
	readonly inPlay: readonly string[];
	setInPlay(paths: string[], options?: { place?: boolean }): void;
	setPosition(path: string, x: number, y: number): void;
}

export function canvasStage(options: {
	canvases: CanvasStore;
	deck: Deck;
	id: string;
	/** Where the person adding a board is looking, so it arrives in front of them. */
	camera: () => Camera | undefined;
	/** The canvas changed: tell every agent on it, and send the arrangement. */
	changed: () => void;
}): StageTarget {
	const { canvases, deck, id } = options;
	return {
		get inPlay() {
			return canvases.boards(id);
		},
		setInPlay(paths, { place = false } = {}) {
			const wanted = paths.filter((path, index) => paths.indexOf(path) === index);
			if (place) {
				const spots = joinPlaces({
					wanted,
					playing: canvases.boards(id),
					places: canvases.places(id),
					size: (path) => {
						const board = deck.board(path);
						return board ? { w: board.w, h: board.h } : undefined;
					},
					camera: options.camera(),
				});
				for (const [path, spot] of Object.entries(spots)) canvases.place(id, path, spot.x, spot.y);
			}
			canvases.setBoards(id, wanted);
			options.changed();
		},
		setPosition(path, x, y) {
			if (canvases.place(id, path, x, y)) options.changed();
		},
	};
}
