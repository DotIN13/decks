import { createSignal, onMount } from "solid-js";

/**
 * A flow or slides board, edited as its own source.
 *
 * One textarea, and that is the whole design. The alternative — a WYSIWYG over the rendered
 * markdown — dies on the round trip: serialising a DOM back to markdown reorders the file,
 * and these files are read back by agents, so a board that rewrites itself on every human
 * edit is a board the agent stops recognising. A textarea is exact by construction, because
 * the file *is* the text in the box.
 *
 * The same editor serves all three non-component formats: markdown, a plain HTML document,
 * and a deck. A deck is markdown too, so there is nothing to specialise.
 *
 * ### The gestures
 *
 * - ⌘S or blur commits.
 * - Escape abandons, and does not commit — which is the one thing a person needs to be able
 *   to rely on about an editor.
 * - Tab inserts a tab rather than leaving the field, because these are markdown files with
 *   nested lists in them and the browser's default here is a trap.
 *
 * Not reachable below half zoom, because that is where a board stops taking pointer events
 * at all — the double-click that opens this cannot happen down there.
 */
export function SourceEditor(props: {
	path: string;
	source: string;
	/** The board's own size, so the box is exactly the board it is standing in for. */
	w: number;
	h: number;
	onCommit: (text: string) => void;
	onCancel: () => void;
}) {
	const [text, setText] = createSignal(props.source);
	let area: HTMLTextAreaElement | undefined;

	/*
	 * `commit` guards against running twice.
	 *
	 * Escape moves the focus, which fires `blur`, which would commit the very edit Escape
	 * was abandoning — and ⌘S followed by a click away would write the same file twice and
	 * record two revisions of it.
	 */
	let settled = false;
	const commit = () => {
		if (settled) return;
		settled = true;
		props.onCommit(text());
	};
	const cancel = () => {
		if (settled) return;
		settled = true;
		props.onCancel();
	};

	onMount(() => {
		area?.focus();
		// The caret at the start rather than selecting everything: an editor that opens with
		// the whole file selected is one keystroke away from deleting it.
		area?.setSelectionRange(0, 0);
		/*
		 * And scrolled to the top, which focusing does not guarantee.
		 *
		 * It opened 51 pixels down — the first two lines of the file above the fold — because
		 * focusing a textarea scrolls to make the caret visible and the browser had not yet
		 * settled where that was. Set after the selection, so it is the last word.
		 */
		if (area) area.scrollTop = 0;
	});

	return (
		<div class="source-editor" style={{ width: `${props.w}px`, height: `${props.h}px` }}>
			<textarea
				ref={(element) => {
					area = element;
				}}
				class="source-area"
				spellcheck={false}
				value={text()}
				aria-label={`Source of ${props.path}`}
				onInput={(event) => setText(event.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					// Every key in here is the field's, including the ones the canvas wants:
					// a space is a space, and ⌘+ should not zoom the board out from under
					// the text you are typing into it.
					event.stopPropagation();
					if (event.key === "Escape") {
						event.preventDefault();
						cancel();
						return;
					}
					if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						commit();
						return;
					}
					if (event.key === "Tab") {
						event.preventDefault();
						const element = event.currentTarget;
						const at = element.selectionStart;
						const next = `${element.value.slice(0, at)}\t${element.value.slice(element.selectionEnd)}`;
						setText(next);
						element.value = next;
						element.setSelectionRange(at + 1, at + 1);
					}
				}}
			/>
			<div class="source-hint">
				<span>⌘S saves</span>
				<span>Esc discards</span>
			</div>
		</div>
	);
}
