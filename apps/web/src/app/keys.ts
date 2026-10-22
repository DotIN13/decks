import { onCleanup, onMount } from "solid-js";

/**
 * The keyboard shortcut that belongs to the app rather than to a field: `⌘K`.
 *
 * It was in one `onMount` in `App.tsx` with the paste listener, the visual viewport, the
 * page-zoom block and the dock measurement — six unrelated wires in one closure.
 */
export function installKeys(deps: {
	/** Show the boards panel, and put the cursor in its search field. */
	openBoards(): void;
	/** A token that changes to say "search now" — `Date.now()`, for the field to key on. */
	find(at: number): void;
}) {
	onMount(() => {
		/*
		 * `⌘K` — which is what the full-screen board browser became.
		 *
		 * That modal covered the canvas you were looking at in order to help you find something
		 * on it. The panel's list is where it went — the whole deck, in three sections — so the
		 * shortcut opens the panel and puts the cursor in the search field: the same intent,
		 * without a sheet over the work. It used to have to pick a tab as well.
		 *
		 * The composer's placeholder has promised this since before there was anything behind
		 * it, which is the other reason it is here rather than on a list of things to do.
		 */
		const keys = (event: KeyboardEvent) => {
			if (event.key !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
			event.preventDefault();
			deps.openBoards();
			deps.find(Date.now());
		};
		window.addEventListener("keydown", keys);
		onCleanup(() => window.removeEventListener("keydown", keys));
	});
}
