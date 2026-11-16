import { onCleanup, onMount } from "solid-js";

/**
 * The view you are in when the page goes away.
 *
 * Views are parked when you switch conversations, which covers everything except the one you
 * were in when the tab was closed or reloaded — and that is exactly the conversation a reload
 * is about, so without this the camera would come back for every chat but the one you left.
 *
 * `pagehide` rather than `beforeunload`: it fires on a reload, on a navigate, and when a phone
 * puts the page away, which is where `beforeunload` famously does not.
 */
export function parkOnLeaving(park: () => void): void {
	onMount(() => {
		const away = () => park();
		addEventListener("pagehide", away);
		onCleanup(() => removeEventListener("pagehide", away));
	});
}

/* The pencil is the hand in use from its first press until a finger or a mouse presses: the page is
   then unselectable (`shell.css`), so a stroke never becomes a text selection. Set in the capture
   phase, before Safari starts a selection from the same press. */
export function watchPencil(): void {
	onMount(() => {
		const press = (event: PointerEvent) => {
			const pen = event.pointerType === "pen";
			if (pen === document.documentElement.hasAttribute("data-pen")) return;
			document.documentElement.toggleAttribute("data-pen", pen);
			if (pen) getSelection()?.removeAllRanges();
		};
		window.addEventListener("pointerdown", press, true);
		onCleanup(() => window.removeEventListener("pointerdown", press, true));
	});
}
