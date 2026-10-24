import { batch, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";

/** Whether an Apple Pencil (any pen) has touched this device, kept so it is known before the first stroke. */
const KEY = "decks.pencil";
const [pencil, setPencil] = createSignal(typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1");

/**
 * Handwriting anywhere goes into the composer.
 *
 * On an iPad, Scribble turns Pencil writing into text only in the field the stroke starts on, so
 * writing a message meant writing inside the composer's two lines, and a stroke over the canvas
 * started a selection instead. While the composer has the cursor and a pencil has been used here,
 * this lays one invisible text field over the canvas, under the floating bars: Scribble writes
 * into it, and every word it recognises moves straight into the composer at its caret. A finger,
 * which is the canvas's, takes it away again, as does the composer losing the cursor to anything
 * else.
 */
export function ScribbleCatch(props: { field: () => HTMLElement | undefined; insert: (text: string) => void; focusField: () => void }) {
	const [fieldFocused, setFieldFocused] = createSignal(false);
	const [catching, setCatching] = createSignal(false);
	let catcher: HTMLTextAreaElement | undefined;

	onMount(() => {
		const onPointer = (event: PointerEvent) => {
			if (event.pointerType !== "pen" || pencil()) return;
			setPencil(true);
			try {
				localStorage.setItem(KEY, "1");
			} catch {
				/* private mode: known again at the next stroke */
			}
		};
		const onFocus = () => {
			const at = document.activeElement;
			const field = props.field();
			// Together: set one at a time, the catcher is unwanted for an instant between them and is taken away.
			batch(() => {
				setFieldFocused(!!field && !!at && field.contains(at));
				setCatching(!!catcher && at === catcher);
			});
		};
		// Read after the whole move: between the field's focusout and the catcher's focusin nothing has focus.
		const onFocusOut = () => setTimeout(onFocus, 0);
		window.addEventListener("pointerdown", onPointer, true);
		document.addEventListener("focusin", onFocus);
		document.addEventListener("focusout", onFocusOut);
		onCleanup(() => {
			window.removeEventListener("pointerdown", onPointer, true);
			document.removeEventListener("focusin", onFocus);
			document.removeEventListener("focusout", onFocusOut);
		});
	});

	/** Whatever Scribble put in the catcher, moved into the composer. */
	const pass = () => {
		if (!catcher || !catcher.value) return;
		const text = catcher.value;
		catcher.value = "";
		props.insert(text);
	};

	return (
		<Show when={pencil() && (fieldFocused() || catching())}>
			<Portal mount={document.querySelector(".work") ?? document.body}>
				<textarea
					ref={catcher}
					class="scribble-catch"
					aria-label="Write here with the pencil; the words go into the message"
					autocapitalize="sentences"
					spellcheck={false}
					onInput={(event) => {
						if (!(event as InputEvent).isComposing) pass();
					}}
					onCompositionEnd={pass}
					onPointerDown={(event) => {
						// A finger is the canvas's: let the next touch reach it, and give the cursor back.
						if (event.pointerType === "pen") return;
						event.preventDefault();
						batch(() => {
							setCatching(false);
							setFieldFocused(false);
						});
						catcher?.blur();
					}}
					onBlur={() => {
						pass();
						// Writing is done when the cursor goes anywhere but back to the composer.
						setTimeout(() => {
							const field = props.field();
							if (field && document.activeElement && field.contains(document.activeElement)) return;
							setCatching(false);
						}, 0);
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							props.focusField();
						}
					}}
				/>
			</Portal>
		</Show>
	);
}
