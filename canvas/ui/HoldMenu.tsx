import { For, onCleanup, onMount, Show } from "solid-js";

/** One row of the hold menu. */
export interface HoldAction {
	label: string;
	run: () => void;
	danger?: boolean;
	/** A word at the right: where the action leads. */
	hint?: string;
}

/**
 * The menu a hold opens on a touch screen (`edit/dom/pointer.ts`, `touch-rules.ts` HOLD_MS), as iOS
 * opens one: at the finger, with a preview of what was held on top, and the item's actions as rows a
 * finger's height. Below the finger when there is room, else above it; gone at a press anywhere
 * else, at Escape, or when the view scrolls.
 */
export function HoldMenu(props: { at: { x: number; y: number }; preview?: string | undefined; actions: HoldAction[]; onClose: () => void }) {
	let element: HTMLDivElement | undefined;
	const WIDTH = 228;
	const place = () => {
		const rows = props.actions.length * 44 + (props.preview ? 52 : 0) + 12;
		const below = props.at.y + 16 + rows < innerHeight - 90;
		const left = Math.max(8, Math.min(props.at.x - WIDTH / 2, innerWidth - WIDTH - 8));
		return { left, top: below ? props.at.y + 16 : Math.max(8, props.at.y - 16 - rows), below };
	};
	onMount(() => {
		const away = (event: Event) => {
			if (element && event.target instanceof Node && element.contains(event.target)) return;
			props.onClose();
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") props.onClose();
		};
		// After this frame: the press that opened the menu is still on its way up.
		const soon = setTimeout(() => {
			window.addEventListener("pointerdown", away, true);
			window.addEventListener("scroll", props.onClose, true);
			window.addEventListener("keydown", key, true);
		}, 0);
		onCleanup(() => {
			clearTimeout(soon);
			window.removeEventListener("pointerdown", away, true);
			window.removeEventListener("scroll", props.onClose, true);
			window.removeEventListener("keydown", key, true);
		});
	});
	return (
		<div ref={element} class="hold-menu" role="menu" data-below={place().below ? "true" : undefined} style={{ left: `${place().left}px`, top: `${place().top}px`, width: `${WIDTH}px` }}>
			<Show when={props.preview}>{(words) => <div class="hold-preview">{words()}</div>}</Show>
			<For each={props.actions}>
				{(action) => (
					<button
						type="button"
						role="menuitem"
						class="hold-item"
						data-danger={action.danger ? "true" : undefined}
						onClick={() => {
							props.onClose();
							action.run();
						}}
					>
						<span>{action.label}</span>
						<Show when={action.hint}>{(hint) => <small>{hint()}</small>}</Show>
					</button>
				)}
			</For>
		</div>
	);
}
