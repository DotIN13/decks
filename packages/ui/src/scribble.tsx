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
export function ScribbleCatch(props: {
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
}) {
	watchPencil();
	const [targetFocused, setTargetFocused] = createSignal(false);
	const [catching, setCatching] = createSignal(false);
	let catcher: HTMLTextAreaElement | undefined;
	let sent = "";
	/** The catcher has had the cursor since it last ended: only then is there writing to end. */
	let writing = false;

	/*
	 * Writing over: the catcher goes, always, and `onEnd` runs if there was writing to end. It used to
	 * stay when nothing had been written yet, so with the field focused and no pencil stroke made, every
	 * finger landed on it and was swallowed: the canvas would not pan or pinch.
	 */
	const end = () => {
		const was = writing;
		writing = false;
		batch(() => {
			setCatching(false);
			setTargetFocused(false);
		});
		if (was) props.onEnd?.();
	};

	onMount(() => {
		const read = () => {
			const at = document.activeElement;
			const target = props.target();
			// Together: set one at a time, the catcher is unwanted for an instant between them and is taken away.
			batch(() => {
				setTargetFocused(!!target && !!at && target.contains(at));
				setCatching(!!catcher && at === catcher);
			});
		};
		// Read after the whole move: between one field's focusout and the next one's focusin nothing has focus.
		const later = () => setTimeout(read, 0);
		document.addEventListener("focusin", read);
		document.addEventListener("focusout", later);
		read();
		onCleanup(() => {
			document.removeEventListener("focusin", read);
			document.removeEventListener("focusout", later);
		});
	});

	/** The target's words as they are when the pencil starts, not when the catcher first appeared. */
	const seed = () => {
		if (!catcher) return;
		const target = props.target();
		sent = props.context?.() ?? (target ? wordsOf(target) : "");
		catcher.value = sent;
	};
	/** What Scribble added after what the catcher already held, added to the target. */
	const pass = () => {
		if (!catcher) return;
		const now = catcher.value;
		// An edit to earlier words (a scratch-out) is the catcher's only: the target keeps its own.
		if (now.startsWith(sent) && now.length > sent.length) {
			const text = now.slice(sent.length);
			const target = props.target();
			if (props.append) props.append(text);
			else if (target) appendTo(target, text);
		}
		sent = now;
	};

	return (
		<Show when={pencil() && (targetFocused() || catching())}>
			<Portal mount={props.mount?.() ?? document.querySelector(".work") ?? document.body}>
				<textarea
					ref={(el) => {
						catcher = el;
						seed();
					}}
					{...{ [CATCH]: "" }}
					aria-label="Write here with the pencil; the words go into the field being edited"
					autocapitalize="sentences"
					spellcheck={false}
					style={{
						position: "absolute",
						"z-index": String(props.z ?? 8),
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
					}}
					onInput={(event) => {
						if (!(event as InputEvent).isComposing) pass();
					}}
					onCompositionEnd={pass}
					onPointerDown={(event) => {
						if (event.pointerType === "pen") return;
						// A finger is the canvas's: the next touch reaches it.
						event.preventDefault();
						pass();
						catcher?.blur();
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
