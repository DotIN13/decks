import { onCleanup, onMount } from "solid-js";

/** The app's own keyboard shortcut, `⌘K`: it opens the panel with the cursor in its search field. */
export function installKeys(deps: {
	/** Show the panel, and put the cursor in its search field. */
	openPanel(): void;
	/** A token that changes to say "search now" — `Date.now()`, for the field to key on. */
	find(at: number): void;
}) {
	onMount(() => {
		const keys = (event: KeyboardEvent) => {
			if (event.key !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
			event.preventDefault();
			deps.openPanel();
			deps.find(Date.now());
		};
		window.addEventListener("keydown", keys);
		onCleanup(() => window.removeEventListener("keydown", keys));
	});
}
