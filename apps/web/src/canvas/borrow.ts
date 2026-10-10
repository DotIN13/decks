/**
 * The canvas's own page of a board, lent to a view that shows the board on its own.
 *
 * The focus view and the present overlay used to load the board a second time, so a page came
 * up as if just opened: scrolled to the top, a PDF drawn again, a form emptied, a deck back on
 * its first slide. And the canvas's copy was dropped while they were up, so going back lost it
 * too. A page keeps its state only while its frame is never taken out of the document, and
 * `moveBefore` is the one way to put a frame somewhere else without doing that: the same
 * document, still running, in the new place. Where a browser does not have it, or the canvas has
 * no page for the board yet, nothing is lent and the view loads its own copy as before.
 *
 * What is lent is the `<iframe>` alone. Its `BoardFrame` stays on the canvas, still owning the
 * frame's address, its wiring and its link and code handlers, so the page behaves as it does on
 * the canvas; only where it is drawn changes, and the view sizes it.
 */
type Movable = Element & { moveBefore(node: Node, before: Node | null): void };

const canMove = (element: Element): element is Movable => typeof (element as Partial<Movable>).moveBefore === "function";

/** The canvas's frame for this board, if it has one with a document in it. */
export function canvasFrame(path: string): HTMLIFrameElement | undefined {
	const frame = document.querySelector<HTMLIFrameElement>(`.world iframe[data-path="${CSS.escape(path)}"]`);
	return frame?.contentDocument ? frame : undefined;
}

/**
 * Move the canvas's frame for `path` into `into`, and answer how to put it back; nothing when it
 * cannot be lent. Putting it back restores the frame's own `style` and takes off the attributes a
 * view wrote on it (`data-focus-*`), so the canvas gets its page exactly as it was laid out there.
 */
export function lendFrame(path: string, into: HTMLElement): { frame: HTMLIFrameElement; give: () => void } | undefined {
	const frame = canvasFrame(path);
	if (!frame || !canMove(into)) return undefined;
	const home = frame.parentElement;
	if (!home || !canMove(home)) return undefined;
	const next = frame.nextSibling;
	const style = frame.getAttribute("style");
	into.moveBefore(frame, null);
	let given = false;
	return {
		frame,
		give: () => {
			if (given) return;
			given = true;
			for (const name of [...frame.getAttributeNames()]) if (name.startsWith("data-focus")) frame.removeAttribute(name);
			if (style === null) frame.removeAttribute("style");
			else frame.setAttribute("style", style);
			// The canvas may have dropped the board meanwhile, and then the frame goes with the view.
			if (!home.isConnected || !frame.isConnected) return;
			home.moveBefore(frame, next && next.parentNode === home ? next : null);
		},
	};
}
