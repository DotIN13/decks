import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { CanvasEditor } from "../edit/dom/index.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";

/** What `createCardSizing` reads of `createItemsLayer` (`items-layer.tsx`), each read when it is used. */
export interface CardSizingNeeds {
	readonly editor: CanvasEditor;
	readonly props: CanvasViewProps;
}

export function createCardSizing(d: CardSizingNeeds) {
	/*
	 * Cards whose size just changed from outside a drag (`decks.canvas.fit`, an agent's `decks.canvas.update`, a write that
	 * measured taller): for `SIZE_MS` their box, title bar and outline ease to the new size rather
	 * than jump (`canvas.css`, `[data-sizing]`). A size the person drags is never eased: it follows
	 * the pointer, and the card takes it while `pageResize` still holds it, so nothing changes here.
	 */
	const SIZE_MS = 280;

	const [sizingPaths, setSizingPaths] = createSignal<ReadonlySet<string>>(new Set());

	const lastSizes = new Map<string, { size: string; since: number }>();

	/** A card that arrived this recently is still taking its measured height: it is not eased. */
	const SETTLE_MS = 2500;

	const sizingTimers = new Map<string, ReturnType<typeof setTimeout>>();

	createEffect(() => {
		const held = d.editor.resizingPage();
		const grew: string[] = [];
		for (const card of d.props.cards) {
			const size = `${card.w}x${card.h}`;
			const before = lastSizes.get(card.path);
			const now = performance.now();
			lastSizes.set(card.path, { size, since: before?.since ?? now });
			if (before !== undefined && before.size !== size && card.path !== held && now - before.since > SETTLE_MS) grew.push(card.path);
		}
		if (grew.length === 0) return;
		untrack(() => setSizingPaths(new Set([...sizingPaths(), ...grew])));
		for (const path of grew) {
			clearTimeout(sizingTimers.get(path));
			sizingTimers.set(
				path,
				setTimeout(() => {
					sizingTimers.delete(path);
					const next = new Set(sizingPaths());
					next.delete(path);
					setSizingPaths(next);
				}, SIZE_MS + 60),
			);
		}
	});

	onCleanup(() => {
		for (const timer of sizingTimers.values()) clearTimeout(timer);
	});

	return {
		sizingPaths,
	};
}
