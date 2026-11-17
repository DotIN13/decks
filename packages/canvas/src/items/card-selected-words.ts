/** Words selected in a card: what they say, the block they are in, and where they are on the screen. */
export interface SelectedWords {
	quote: string;
	component?: string;
	anchor: () => DOMRect | undefined;
}

/**
 * Hear a card's root for words selected in it, and say them (`onWords`, read at each time, so a card
 * nobody comments on reads nothing). A selection ends with a press let go, or a key with Shift: a
 * moment later, it is read.
 *
 * Only a press that began in this card: one that began elsewhere and ends here selected nothing in it.
 * A drag out of the comment box, which the page draws over the words it is on, is let go over the card
 * and heard here as a release alone; read then, the words still selected were offered again, and the
 * box began anew, shut and empty.
 */
export function listenForWords(root: ShadowRoot, onWords: () => ((words: SelectedWords) => void) | undefined): void {
	const readSoon = () => void setTimeout(() => readWords(root, onWords()), 0);
	root.addEventListener("pointerdown", () => (pressedIn = root));
	root.addEventListener("pointerup", () => pressedIn === root && readSoon());
	root.addEventListener("keyup", (event) => (event as KeyboardEvent).shiftKey && readSoon());
}

/** The root a press began in, until that press ends, wherever it ends: one press at a time, for every card of this document. */
let pressedIn: ShadowRoot | undefined;
if (typeof document !== "undefined") {
	// After every listener has heard the release, the root's own among them.
	const pressOver = () => void setTimeout(() => (pressedIn = undefined), 0);
	document.addEventListener("pointerup", pressOver, true);
	document.addEventListener("pointercancel", pressOver, true);
}

/**
 * The words selected in this card. A closed root hides its selection from the page's `getSelection()`,
 * which reports the host; `getComposedRanges`, handed the root, gives the range inside it.
 */
function readWords(root: ShadowRoot, say: ((words: SelectedWords) => void) | undefined): void {
	if (!say) return;
	const selection = document.getSelection() as (Selection & { getComposedRanges?: (...args: unknown[]) => StaticRange[] }) | null;
	// Not `isCollapsed`: seen from the page, a selection inside a shadow root is collapsed at its host.
	if (!selection || selection.rangeCount === 0 || typeof selection.getComposedRanges !== "function") return;
	let ranges: StaticRange[];
	try {
		ranges = selection.getComposedRanges({ shadowRoots: [root] });
	} catch {
		// Safari 17's form: the roots as arguments.
		ranges = selection.getComposedRanges(root);
	}
	const given = ranges[0];
	if (!given || given.collapsed || !root.contains(given.startContainer) || !root.contains(given.endContainer)) return;
	const range = document.createRange();
	range.setStart(given.startContainer, given.startOffset);
	range.setEnd(given.endContainer, given.endOffset);
	const quote = range.toString().replace(/\s+/g, " ").trim();
	if (!quote) return;
	const at = given.startContainer instanceof Element ? given.startContainer : given.startContainer.parentElement;
	const component = at?.closest("[data-id]")?.getAttribute("data-id") ?? undefined;
	say({ quote, ...(component ? { component } : {}), anchor: () => (range.collapsed ? undefined : range.getBoundingClientRect()) });
}
