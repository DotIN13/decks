import { batch, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";

/** Whether a pen (an Apple Pencil) has touched this device, kept so it is known before the next stroke. */
const KEY = "decks.pencil";
const [pencil, setPencil] = createSignal(typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1");
let watching = false;
function watchPencil(): void {
	if (watching || typeof window === "undefined") return;
	watching = true;
	window.addEventListener(
		"pointerdown",
		(event) => {
			if (event.pointerType !== "pen" || pencil()) return;
			setPencil(true);
			try {
				localStorage.setItem(KEY, "1");
			} catch {
				/* private mode: known again at the next stroke */
			}
		},
		true,
	);
}
export { pencil };

const CATCH = "data-scribble-catch";
/** Whether focus went to a catcher: a field's blur handler asks, and waits for `onEnd` instead of finishing. */
export function isScribbleCatch(el: EventTarget | Element | null | undefined): boolean {
	return el instanceof Element && el.hasAttribute(CATCH);
}

/** The field's own words, as context for the handwriting. */
const wordsOf = (el: HTMLElement): string => (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : (el.textContent ?? "")).replace(/ /g, " ");

/** Words added at the end of a text field, as a person typing them would: the field's own `input` follows. */
function appendTo(el: HTMLElement, text: string): void {
	if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
		el.setRangeText(text, el.value.length, el.value.length, "end");
		el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
		return;
	}
	el.append(document.createTextNode(text));
	el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

/**
 * Pencil handwriting anywhere goes into one field.
 *
 * On an iPad, Scribble turns writing into text only in the field the stroke starts on, so writing
 * into a small field meant writing inside it, and a stroke anywhere else did whatever the page does
 * with a pen (on the canvas, a selection). While `target` has the cursor and a pencil has been used
 * on this device, this lays one invisible text field over `mount` (the canvas column, `.work`, unless
 * said), under the floating bars: Scribble writes into it, and every word it recognises is added to
 * the target as written.
 *
 * The catcher holds the target's words as well as the new ones, in a 1px strip along its top: emptied
 * after every word, Scribble had no sentence to continue and capitalised every word. A finger, which
 * is the canvas's, ends the writing, as does the cursor going anywhere but back to the target; then
 * `onEnd` runs, for a field that finishes on blur (a text item on the canvas commits there) and so
 * held back while the catcher had the cursor (`isScribbleCatch`).
 */
export type ScribbleCatchProps = {
	/** The field being written into: a textarea, an input or a contenteditable. */
	target: () => HTMLElement | undefined;
	/** Add words at its end; a textarea, an input or a plain contenteditable is done without it. */
	append?: (text: string) => void;
	/** Its words, as context; its value or text unless said. */
	context?: () => string;
	/** Writing is over, by a finger or the cursor going elsewhere. */
	onEnd?: () => void;
	/** What the catcher covers; `.work`, else the page. */
	mount?: () => Element | null | undefined;
	/** Its stacking inside `mount`: over the boards, under the floating bars. */
	z?: number;
};

export function ScribbleCatch(props: ScribbleCatchProps) {
	watchPencil();
	const [targetFocused, setTargetFocused] = createSignal(false);
	const [catching, setCatching] = createSignal(false);
	/** The catcher, and what it held when Scribble last wrote into it. */
	const st: CatchState = { catcher: undefined, sent: "" };
	/** The catcher has had the cursor since it last ended: only then is there writing to end. */
	let writing = false;

	const end = () => {
		if (!writing) return;
		writing = false;
		batch(() => {
			setCatching(false);
			setTargetFocused(false);
		});
		props.onEnd?.();
	};

	onMount(() => trackFocus(props.target, () => st.catcher, (target, catching) => batch(() => {
		setTargetFocused(target);
		setCatching(catching);
	})));

	const seed = () => seedCatch(st, props);
	const pass = () => passCatch(st, props);

	return (
		<Show when={pencil() && (targetFocused() || catching())}>
			<Portal mount={props.mount?.() ?? document.querySelector(".work") ?? document.body}>
				<textarea
					ref={(el) => {
						st.catcher = el;
						seed();
					}}
					{...{ [CATCH]: "" }}
					aria-label="Write here with the pencil; the words go into the field being edited"
					autocapitalize="sentences"
					spellcheck={false}
					style={catcherStyle(props.z)}
					onInput={(event) => {
						if (!(event as InputEvent).isComposing) pass();
					}}
					onCompositionEnd={pass}
					onPointerDown={(event) => {
						if (event.pointerType === "pen") return;
						// A finger is the canvas's: the next touch reaches it.
						event.preventDefault();
						pass();
						st.catcher?.blur();
						end();
					}}
					onFocus={() => {
						if (!writing) seed();
						writing = true;
					}}
					onBlur={() => {
						pass();
						setTimeout(() => {
							const target = props.target();
							// Back to the target (Escape) is still writing in it; anywhere else ends it.
							if (target && document.activeElement && target.contains(document.activeElement)) return;
							end();
						}, 0);
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							props.target()?.focus();
						}
					}}
				/>
			</Portal>
		</Show>
	);
}

/** The catcher's style: over the whole of `mount`, invisible, its words in a 1px strip along its top. */
function catcherStyle(z: number | undefined): Record<string, string> {
	return {
		position: "absolute",
		"z-index": String(z ?? 8),
		inset: "0",
		width: "100%",
		height: "100%",
		margin: "0",
		padding: "0",
		border: "0",
		outline: "0",
		resize: "none",
		background: "transparent",
		color: "transparent",
		"caret-color": "transparent",
		// 16px so Safari does not zoom on focus; 1px lines keep the context in a strip along the top.
		"font-size": "16px",
		"line-height": "1px",
		"user-select": "text",
		"-webkit-user-select": "text",
		"touch-action": "none",
	};
}

/**
 * Whether the target or the catcher has the cursor, read on every focus move; both together, since
 * set one at a time the catcher is unwanted for an instant and is taken away. A focusout is read
 * after the whole move, when the next field has the cursor.
 */
function trackFocus(target: () => HTMLElement | undefined, catcher: () => HTMLTextAreaElement | undefined, set: (target: boolean, catching: boolean) => void): void {
	const read = () => {
		const at = document.activeElement;
		const t = target();
		const c = catcher();
		set(!!t && !!at && t.contains(at), !!c && at === c);
	};
	const later = () => setTimeout(read, 0);
	document.addEventListener("focusin", read);
	document.addEventListener("focusout", later);
	read();
	onCleanup(() => {
		document.removeEventListener("focusin", read);
		document.removeEventListener("focusout", later);
	});
}

type CatchState = { catcher: HTMLTextAreaElement | undefined; sent: string };

/** The target's words as they are when the pencil starts, not when the catcher first appeared. */
function seedCatch(st: CatchState, props: ScribbleCatchProps): void {
	if (!st.catcher) return;
	const target = props.target();
	st.sent = props.context?.() ?? (target ? wordsOf(target) : "");
	st.catcher.value = st.sent;
}

/** What Scribble added after what the catcher already held, added to the target; an edit to earlier words stays the catcher's. */
function passCatch(st: CatchState, props: ScribbleCatchProps): void {
	if (!st.catcher) return;
	const now = st.catcher.value;
	if (now.startsWith(st.sent) && now.length > st.sent.length) {
		const text = now.slice(st.sent.length);
		const target = props.target();
		if (props.append) props.append(text);
		else if (target) appendTo(target, text);
	}
	st.sent = now;
}
