import type { Offset, Pt, Rect } from "../edit/core/model.ts";

/** What the editor reads of a board, and says back about it: all a board's frame (`PageFrame`) knows of the editor. */
export type PageView = {
	/** How far a drag of the selection carries this board, while it does. */
	shift: () => Offset | undefined;
	/** The box the stage's handles are asking for, drawn before the file has it. */
	resized: () => Rect | undefined;
	/** The pointer came onto the board or its title bar, or left both: the hover outline. */
	hover: (on: boolean) => void;
	/**
	 * A mouse or pen press on the title bar or the edge, offered to the editor first: it moves the
	 * board with the rest of a selection and snaps it. True means it took the drag. `on` is the element
	 * that follows the drag, when the press was heard somewhere that is not one (a card's own root).
	 */
	press: (event: PointerEvent, on?: HTMLElement) => boolean;
	/** A drag of the board's own (a finger on its edge): where it is carried, `null` when it ends. */
	dragging: (at: Pt | null) => void;
	/** A press on the board: it is selected, alone unless it is part of the selection already. */
	select: () => void;
};
