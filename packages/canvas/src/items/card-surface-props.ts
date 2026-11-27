/** What `CardSurface` is given (`card-surface.tsx`). */
export interface CardSurfaceProps {
	page: string;
	path: string;
	trusted: boolean;
	rev: number;
	/** The revision is of a change of size alone: the card keeps the document it has (`Page.sized`). */
	sized?: true | undefined;
	reload?: number | undefined;
	size: () => { w: number; h: number };
	selected: boolean;
	/** False while the card is asleep but kept, ready to wake (`CardContext.awake`); awake unless said. */
	awake?: boolean;
	onSelect: () => void;
	/**
	 * A mouse or pen press with Shift (or ⌘) inside the card, offered to the editor as a press on the
	 * card's edge is (`PageView.press`): it adds the card to the selection, or takes it out, rather
	 * than picking it alone. True when the editor took it.
	 */
	onAddPress?: ((event: PointerEvent, on: HTMLElement) => boolean) | undefined;
	onShown: () => void;
	/** Open a card the card links to, beside it (`CanvasView`'s `onOpenPage`), by its deck path. */
	onOpenPage?: ((path: string) => void) | undefined;
	/** The card's content height, for `decks.canvas.fit` (`card-reading.ts`): its file's height stays the floor. */
	onExtent?: ((extent: { w: number; h: number; at: number; page: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }) => void) | undefined;
	/** Words selected in the card, when a press or a key ends a selection: what to quote, the block they are in, and where they are. */
	onWords?: ((words: { quote: string; component?: string; anchor: () => DOMRect | undefined }) => void) | undefined;
}
