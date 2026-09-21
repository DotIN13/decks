import type { Canvas, Identity } from "@decks/protocol";
import Frame from "lucide-solid/icons/frame";
import Trash2 from "lucide-solid/icons/trash-2";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { Icon } from "../ui/icons.tsx";

/**
 * One canvas in the panel's Canvases tab: a door, with a × that asks twice.
 *
 * The same object as a board's row — `.board-row` inside `.board-act`, the current wash, the
 * arming — because the list above and below it is made of those, and a third row style in
 * one panel is how two lists come to nearly match. What is on it beyond the name: a dot for
 * a change you have not looked at (the same mark the shelf's card wears), the faces of who is
 * working there, and how many boards it holds.
 *
 * Pressing it opens the canvas and keeps the conversation: the room changes, the agent does
 * not. The × removes the *arrangement* only — the boards stay in the deck — which is why it
 * asks twice like a board's delete does and not three times like a file would deserve.
 */

/** How long an armed remove waits for the second press before forgetting it was asked. */
const ARMED_MS = 4000;

export function CanvasRow(props: {
	canvas: Canvas;
	/** The canvas on screen: washed, not ticked. */
	current?: boolean;
	identities?: Record<string, Identity>;
	onOpen: () => void;
	/** Remove the canvas. Absent means the row has no × on it. */
	onRemove?: () => void;
}) {
	const [armed, setArmed] = createSignal(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const disarm = () => {
		clearTimeout(timer);
		timer = undefined;
		setArmed(false);
	};
	const press = () => {
		if (!armed()) {
			setArmed(true);
			clearTimeout(timer);
			timer = setTimeout(disarm, ARMED_MS);
			return;
		}
		disarm();
		props.onRemove?.();
	};
	onCleanup(() => clearTimeout(timer));

	const news = () => props.canvas.changedAt > (props.canvas.openedAt ?? 0);
	const faces = () => props.canvas.agents.map((id) => props.identities?.[id]).filter((identity): identity is Identity => identity !== undefined);
	const count = () => props.canvas.boards.length;

	return (
		<div
			class="board-act"
			onPointerLeave={disarm}
			onFocusOut={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) disarm();
			}}
		>
			<button
				class="board-row canvas-row"
				type="button"
				data-row
				data-canvas-row={props.canvas.id}
				data-current={props.current ? "true" : undefined}
				aria-current={props.current ? "true" : undefined}
				title={props.current ? `${props.canvas.name} — the canvas you are on` : `Open ${props.canvas.name}`}
				onClick={props.onOpen}
				onKeyDown={(event) => {
					if (event.key === "Escape" && armed()) {
						event.preventDefault();
						event.stopPropagation();
						disarm();
						return;
					}
					if (!props.onRemove) return;
					if (event.key !== "Delete" && event.key !== "Backspace") return;
					event.preventDefault();
					event.stopPropagation();
					press();
				}}
			>
				<Icon of={Frame} size={13} class="flex-none text-faint" />
				<span class="nm">{props.canvas.name}</span>
				<Show when={news()}>
					<span class="dot" aria-label="Changed since you looked" />
				</Show>
				<Show when={faces().length > 0}>
					<span class="canvas-row-faces" aria-label={`Working here: ${faces().map((identity) => identity.name).join(", ")}`}>
						<For each={faces().slice(0, 4)}>{(identity) => <span class="canvas-row-face" style={{ "--face": identity.color }} title={identity.name} />}</For>
					</span>
				</Show>
				<span class="canvas-row-n tabular-nums" aria-label={`${count()} board${count() === 1 ? "" : "s"}`}>
					{count()}
				</span>
			</button>
			<Show when={props.onRemove}>
				<button
					class="board-del"
					type="button"
					data-armed={armed() ? "true" : undefined}
					title={armed() ? `Press again to remove ${props.canvas.name} — its boards stay in the deck` : `Remove ${props.canvas.name}. Its boards stay in the deck.`}
					aria-label={armed() ? `Remove ${props.canvas.name} — press again to confirm` : `Remove ${props.canvas.name}`}
					onClick={(event) => {
						event.stopPropagation();
						press();
					}}
					onKeyDown={(event) => {
						if (event.key !== "Escape" || !armed()) return;
						event.preventDefault();
						event.stopPropagation();
						disarm();
					}}
				>
					<Icon of={Trash2} size={12} />
				</button>
			</Show>
		</div>
	);
}
