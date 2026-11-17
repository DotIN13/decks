import { createSignal, onCleanup, onMount } from "solid-js";
import { type InsertPanel } from "../edit/pen-tools.ts";
import { onDismiss } from "@decks/ui";

/** What `createInsertPlace` reads of `Insert` (`Insert.tsx`). */
export interface InsertPlaceNeeds {
	readonly panel: HTMLDivElement | undefined;
	readonly props: { open: InsertPanel; onPick: (tool: "shape" | "icon") => void; onClose: () => void; };
}

/** Where the insert panel sits: beside the tool column, and inside the screen. */
export function createInsertPlace(d: InsertPlaceNeeds) {
	/*
	 * Where it sits: beside the tool column, or at the point it was opened for, kept on screen.
	 */
	const [place, setPlace] = createSignal<{ left: number; top: number }>({ left: 64, top: 80 });

	const position = () => {
		const width = 288;
		const height = d.panel?.offsetHeight ?? 460;
		if (d.props.open.client) {
			const left = Math.max(8, Math.min(d.props.open.client.x - 20, window.innerWidth - width - 8));
			const top = Math.max(8, Math.min(d.props.open.client.y + 12, window.innerHeight - height - 8));
			return setPlace({ left, top });
		}
		const tools = document.querySelector(".pen-tools")?.getBoundingClientRect();
		const left = tools ? tools.right + 8 : 64;
		const top = Math.max(8, Math.min(tools ? tools.top : 80, window.innerHeight - height - 8));
		setPlace({ left, top });
	};

	onMount(() => {
		position();
		requestAnimationFrame(position);
		window.addEventListener("resize", position);
		const away = (event: PointerEvent) => {
			const target = event.target as Element | null;
			if (d.panel?.contains(target) || target?.closest?.("[data-insert-button]")) return;
			d.props.onClose();
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") d.props.onClose();
		};
		window.addEventListener("pointerdown", away, true);
		window.addEventListener("keydown", key);
		const stopDismiss = onDismiss(() => d.props.onClose());
		onCleanup(() => {
			stopDismiss();
			window.removeEventListener("resize", position);
			window.removeEventListener("pointerdown", away, true);
			window.removeEventListener("keydown", key);
		});
	});

	return {
		place,
	};
}
