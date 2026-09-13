import { onCleanup, onMount } from "solid-js";
import { dialog } from "../state/deck.ts";
import { component, setComponent } from "../state/selection.ts";

/**
 * The two keyboard shortcuts that belong to the app rather than to a field.
 *
 * Both were in one `onMount` in `App.tsx` with the paste listener, the visual viewport, the
 * page-zoom block and the dock measurement — six unrelated wires in one closure, of which
 * two are about keys.
 *
 * The rules they enforce are about *priority*, and that is why they are stated together:
 * a shortcut that fires while somebody is typing is a shortcut that eats a keystroke, so
 * both check what has focus and both give way.
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

	/*
	 * Escape lets the selection go, from anywhere.
	 *
	 * It always did — inside the board's own document, where `Editor` listens (§6.5). That is
	 * the one place the key was *never* pressed: selecting a component opens the inspector, and
	 * the next thing a hand does is reach for it, which moves focus out of the iframe. From
	 * then on the keypress arrived here, where nothing was listening, and the only way out of a
	 * selection was the inspector's own ×.
	 *
	 * Two things own Escape ahead of this and keep it. A **field** — the composer clears its
	 * draft, an inspector input reverts — because the selection is still there to let go of
	 * afterwards, and losing a draft you were trying to keep is the worse outcome. A
	 * **dialog**, because a question waiting for an answer is more urgent than a selection, and
	 * answering it is what the key is for while one is up.
	 */
	onMount(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (!component()) return;
			if (dialog()) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest?.("input, textarea, select, [contenteditable]")) return;
			event.preventDefault();
			setComponent(undefined);
		};
		window.addEventListener("keydown", onKeyDown);
		onCleanup(() => window.removeEventListener("keydown", onKeyDown));
	});
}
