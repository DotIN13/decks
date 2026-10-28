import type { Board } from "@decks/protocol";
import type { BoardView } from "./editor/index.ts";
import type { FrameGestureHost } from "./frame-host.ts";
import type { RendererChoice } from "./lib/renderer.ts";
import type { PictureHost } from "./picture.ts";

/**
 * What the stage hands the component that draws one board (`Stage`'s `frame` prop).
 *
 * The stage decides where a board is, whether it has a page now, whether it sleeps, and what its
 * gestures do; the host draws it. The Decks app draws a board with `board/BoardFrame.tsx` — a
 * same-origin page with its own editor, live chats and file drops, which it adds itself — and a
 * host with less (`mount.tsx`'s default, a frame at the board's address or its picture) draws it
 * with less. Everything here is the stage's; nothing here is about the app.
 */
export interface StageBoardProps {
	board: Board;
	/**
	 * The camera's zoom, which is all a board needs of the camera: a pan never reaches a board (the world's
	 * one transform moves its page), so it is not handed one, and its code runs only when the zoom changes.
	 */
	zoom: number;
	/** Whether the board has a document: on screen, or off it for less than a moment (`Stage`). */
	mounted: boolean;
	/** Whether the board is on screen or within a viewport of it. */
	visible: boolean;
	selected: boolean;
	/** The board's size just changed from outside a drag: its box eases to it (`Stage`'s `sizingPaths`). */
	sizing?: boolean;
	/**
	 * The board is news — an agent named it and the person has not read it — drawn as a glow in
	 * this colour (the writer's) until it is read. Absent for a board that is not news.
	 */
	news?: string;
	/**
	 * The board's document is showing, or has stopped showing: ready by its own word
	 * (`__boardReady`), or three seconds after it loaded, whichever is first. Until then the stage
	 * keeps the board's picture over it (`pen/scene.ts`), so a board never flashes white on its way
	 * from a picture to a page.
	 */
	onLive?: (live: boolean) => void;
	/**
	 * A drag carries this board's picture (`PenLayer.carry`): the page stays where it was picked up,
	 * hidden, until the move lands and the sheet draws the board in its new place.
	 */
	carried?: boolean;
	/** The board was read on the canvas: zoomed in on, mostly on screen, at rest (`glow.ts`). */
	onRead?: () => void;
	onMove: (x: number, y: number) => void;
	/**
	 * The stage's editor, as far as this board goes (`canvas/editor`, `boardView`): a press that
	 * selects the board (`select`); a mouse or pen press on the title bar or an edge, offered to the
	 * editor first, which moves the board with the rest of a selection and snaps it (`press`, true
	 * when it took the drag); the pointer coming onto the board or its bar or leaving both, for the
	 * hover outline (`hover`); a drag of the board's own, a finger on its edge, where the board is
	 * carried and null when it ends, so the outline goes with it and the pill and handles hide
	 * (`dragging`); how far a drag of the selection carries the board until the move is sent
	 * (`shift`); and the box the stage's handles are asking for (`resized`).
	 */
	view: BoardView;
	/**
	 * The board dragged to a new size, in board units.
	 *
	 * Sent on release rather than while dragging: a board's size is a number in its own file,
	 * and the frame showing it is the file. So the drag previews the *box* — the node is drawn
	 * at the size being asked for, with the document still at its old one inside it — and the
	 * write happens once, at the end, which is also what makes one gesture one revision.
	 *
	 * A board sends both dimensions — a height is a floor in its `<meta>` tag, which the content
	 * raises when it needs to (`wire/boards.ts` decides where they go, not this file).
	 */
	onResize?: (size: { w: number; h: number }) => void;
	onOpen: () => void;
	/**
	 * How much room this board's content took, once the document had finished mounting.
	 *
	 * Sent up rather than kept here because the frame is the only place a board is laid
	 * out, and the server is where the question gets asked (`decks.canvas.fit`, and `clipped` on
	 * `decks.canvas.read()`). Reported once per load, with the revision it was measured at.
	 */
	onExtent?: (extent: { rev: number; w: number; h: number; at?: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }) => void;
	/** Take this board off the canvas. It stays in the agent's context. */
	onHide?: () => void;
	/**
	 * Comment on words selected in the board's page: the words, the block they are in, and where
	 * they are on screen. A host's page from another origin says what is selected (`board.js`).
	 */
	onCommentWords?: (words: { quote: string; component?: string; anchor: () => DOMRect | undefined }) => void;
	/** Canvas gestures that start inside the frame and belong to the stage. */
	gestures: FrameGestureHost;
	/**
	 * A link **on** this board that points at another board (`board/board-links.ts`).
	 *
	 * `true` when the deck had that board and it is now on the canvas. A return value rather
	 * than two callbacks because only the app knows the deck; `false` is a path this deck does
	 * not hold, which the app has already said out loud.
	 */
	onOpenBoard?: (path: string, from: string) => boolean;
	/**
	 * How this board is put on the stage (`lib/renderer.ts`): a document in a box, a
	 * document drawn into a canvas of its own, or a picture on the stage's one canvas.
	 */
	renderer: RendererChoice;
	/**
	 * Whether the camera's scale is moving right now. A canvas renderer draws nothing while
	 * it is — the picture is stretched — and draws once, at the new size, when it stops.
	 */
	scaling: boolean;
	/**
	 * Whether the camera is moving at all, scale or position. A pan makes Chrome report
	 * every drawable as changed; a draw then is work thrown away at the next step.
	 */
	moving: boolean;
	/** The stage's side of the canvas renderer: the redraw queue (`picture.ts`). */
	pictures: PictureHost;
}
