import { quoteOf } from "./comments.ts";
import { commentDirty, commenting, setCommenting } from "../state/comments.ts";
import { drawing } from "../state/ink.ts";
import { mode } from "../state/selection.ts";

/**
 * Selecting words in a board, while browsing, offers a comment on them.
 *
 * A board is a document of its own, so its selection is its own too: this listens inside the
 * frame and, once a selection has settled with the pointer up, says what was selected and
 * where (`state/comments.ts`), and the app draws the popup over it. A selection that collapses
 * says so as well, which is how a click elsewhere on the board puts the popup away.
 *
 * Only while browsing with the pen down. In edit mode a selection is somebody retyping a run
 * of words, and with the draw tool on the sheet over the board takes the press.
 */
export function attachCommentSelect(frame: HTMLIFrameElement, path: string): () => void {
	const doc = frame.contentDocument;
	if (!doc) return () => {};
	let down = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const settle = () => {
		timer = undefined;
		// A comment half typed stays where it is, whatever the selection does meanwhile.
		if (down || commentDirty()) return;
		const selection = doc.getSelection();
		const text = selection && !selection.isCollapsed ? quoteOf(selection.toString()) : "";
		if (!selection || text === "" || mode() !== "browse" || drawing()) {
			if (commenting()?.frame === frame) setCommenting(undefined);
			return;
		}
		const range = selection.getRangeAt(0).cloneRange();
		const holder = range.commonAncestorContainer;
		const element = holder.nodeType === 1 ? (holder as Element) : holder.parentElement;
		// Words being typed into a field of the board's own are not words to comment on.
		if (element?.closest("input, textarea, [contenteditable='true']")) return;
		const component = element?.closest("[data-id]")?.getAttribute("data-id") ?? undefined;
		setCommenting({ path, quote: text, frame, range, ...(component ? { component } : {}) });
	};
	const later = () => {
		clearTimeout(timer);
		timer = setTimeout(settle, 160);
	};
	const onDown = () => {
		down = true;
	};
	const onUp = () => {
		down = false;
		later();
	};

	doc.addEventListener("selectionchange", later);
	doc.addEventListener("pointerdown", onDown, true);
	doc.addEventListener("pointerup", onUp, true);
	doc.addEventListener("pointercancel", onUp, true);
	return () => {
		clearTimeout(timer);
		doc.removeEventListener("selectionchange", later);
		doc.removeEventListener("pointerdown", onDown, true);
		doc.removeEventListener("pointerup", onUp, true);
		doc.removeEventListener("pointercancel", onUp, true);
		if (commenting()?.frame === frame) setCommenting(undefined);
		forgetMarks(doc);
	};
}

// --- the words a waiting comment is about, marked on the board -------------------------

/*
 * The CSS Custom Highlight API paints ranges without touching the DOM, which is the only kind
 * of mark a comment may leave: the board's file, and the document the editor reads, stay as
 * they were. The ranges live as long as the frame's document does; after a reload the comment
 * is still over the input bar and the wash is gone, which is honest about what a range is.
 */
const NAME = "decks-comment";
const marks = new Map<string, { doc: Document; range: Range }>();

function paint(doc: Document): void {
	const view = doc.defaultView as (Window & typeof globalThis) | null;
	const registry = (view?.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
	const Highlight = (view as unknown as { Highlight?: new (...ranges: Range[]) => unknown } | null)?.Highlight;
	if (!registry || !Highlight) return;
	const ranges = [...marks.values()].filter((mark) => mark.doc === doc).map((mark) => mark.range);
	if (ranges.length === 0) {
		registry.delete(NAME);
		return;
	}
	if (!doc.querySelector("style[data-decks-comment]")) {
		const style = doc.createElement("style");
		style.setAttribute("data-decks-comment", "");
		style.textContent = `::highlight(${NAME}) { background-color: rgba(242, 178, 0, 0.35); }`;
		doc.head?.append(style);
	}
	registry.set(NAME, new Highlight(...ranges));
}

export function markComment(id: string, range: Range): void {
	const doc = range.startContainer.ownerDocument;
	if (!doc) return;
	marks.set(id, { doc, range });
	paint(doc);
}

/** These comments are sent or removed: their words stop being marked. */
export function unmarkComments(ids: string[]): void {
	const docs = new Set<Document>();
	for (const id of ids) {
		const mark = marks.get(id);
		if (mark && marks.delete(id)) docs.add(mark.doc);
	}
	for (const doc of docs) paint(doc);
}

function forgetMarks(doc: Document): void {
	for (const [id, mark] of marks) if (mark.doc === doc) marks.delete(id);
}
