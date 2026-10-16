import type { Board, Camera } from "@decks/protocol";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { toScreen, type Viewport } from "../camera/camera.ts";
import { canvasBox } from "../camera/insets.ts";
import { deckFileUrl } from "../lib/api.ts";
import { Icon } from "../ui/icons.tsx";
import Copy from "lucide-solid/icons/copy";
import ExternalLink from "lucide-solid/icons/external-link";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import Trash from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import MessageSquarePlus from "lucide-solid/icons/message-square-plus";
import Maximize from "lucide-solid/icons/maximize-2";
import Presentation from "lucide-solid/icons/presentation";
import Scan from "lucide-solid/icons/scan";

/** The gap between the pill and the board's edge, in screen pixels. */
const GAP = 10;

/**
 * A board's title bar, now that boards have none: a small pill over the selected board, as a phone
 * shows over selected text, on every device. Selecting a board — a click or a tap on it — shows it:
 * the actions the bar had, with the bar's own icons, on the comment popup's card, so it follows the theme. It sits over the board's top
 * edge, or under the board when that edge is off the screen or under the toolbars, and hides while
 * the camera or the board moves.
 *
 * The same pill sits over drawn items — a shape, a card, a frame, or several — with what makes sense
 * for them: zoom to it, comment, duplicate, properties and delete. Without `board`, the board's own
 * actions (focus, present, a new tab, hide) are not offered.
 */
export function BoardCallout(props: {
	board?: Board;
	/** What the pill sits over, on the stage: the board's box, or the drawn items' together. */
	box: { x: number; y: number; w: number; h: number };
	/** What a screen reader calls it. */
	label: string;
	camera: Camera;
	view: Viewport;
	onOpen: () => void;
	onFocus?: () => void;
	onPresent?: () => void;
	onHide?: () => void;
	/** Comment on the whole board: the popup a selection gets, opened by the pill. */
	onComment?: () => void;
	/** For drawn items: copy them, show their properties, take them off the canvas. */
	onDuplicate?: () => void;
	onProperties?: () => void;
	onDelete?: () => void;
	/** Out of sight while something moves. */
	hidden?: boolean;
}) {
	/* The menu's own width, measured, so it is kept on the screen whole and its arrow still points at the board. */
	const [width, setWidth] = createSignal(0);
	let element: HTMLDivElement | undefined;
	onMount(() => {
		if (!element) return;
		const observer = new ResizeObserver(() => {
			setWidth(element?.offsetWidth ?? 0);
			setTall(element?.offsetHeight || 40);
		});
		observer.observe(element);
		onCleanup(() => observer.disconnect());
	});
	/* The pill's own height, measured: it goes above the board only if it fits there whole. */
	const [tall, setTall] = createSignal(40);
	const place = () => {
		const { box: board, camera, view } = props;
		// The room the chrome leaves: the pill never sits under a toolbar, a panel or the composer.
		const room = canvasBox(view);
		const top = toScreen(camera, view, { x: board.x + board.w / 2, y: board.y });
		const bottom = toScreen(camera, view, { x: board.x + board.w / 2, y: board.y + board.h });
		// The board's middle, on screen, is where the arrow points; the menu is centred on it unless that would cut it off.
		// Too narrow for it (a phone, with its chrome): the whole window, which it fits.
		const fits = room.width - 16 >= width();
		const left = fits ? room.x + 8 : 4;
		const right = fits ? room.x + room.width - 8 : view.width - 4;
		const aim = Math.min(right - 12, Math.max(left + 12, top.x));
		const half = width() / 2;
		const x = half > 0 && right - left > width() ? Math.min(right - half, Math.max(left + half, aim)) : aim;
		const arrow = half > 0 ? Math.min(width() - 18, Math.max(18, aim - (x - half))) : undefined;
		const gap = GAP;
		if (top.y - gap - tall() >= room.y + 4) return { x, y: top.y - GAP, below: false, arrow };
		if (bottom.y + gap + tall() <= room.y + room.height - 4) return { x, y: bottom.y + GAP, below: true, arrow };
		// Both edges out of the room: the board fills it, so the pill sits at the top of what is free.
		return { x, y: room.y + 10, below: true, arrow };
	};
	const stop = (event: Event) => event.stopPropagation();
	return (
		<div
			ref={element}
			class="board-callout"
			role="menu"
			aria-label={props.label}
			data-below={place().below ? "true" : undefined}
			data-hidden={props.hidden ? "true" : undefined}
			style={{ left: `${place().x}px`, top: `${place().y}px`, ...(place().arrow !== undefined ? { "--arrow": `${place().arrow}px` } : {}) }}
			onPointerDown={stop}
			onClick={stop}
		>
			<button type="button" role="menuitem" class="icon-button" aria-label={props.board ? "Fit" : "Zoom to it"} title={props.board ? "Fit the board to the screen" : "Zoom to it"} onClick={() => props.onOpen()}>
				<Icon of={Scan} size={16} />
			</button>
			<Show when={props.onFocus}>
				<button type="button" role="menuitem" class="icon-button" aria-label="Focus" title="Focus on this board" onClick={() => props.onFocus?.()}>
					<Icon of={Maximize} size={16} />
				</button>
			</Show>
			<Show when={props.onPresent && props.board && !props.board.live}>
				<button
					type="button"
					role="menuitem"
					class="icon-button"
					aria-label={props.board?.format === "slides" ? "Present" : "Fullscreen"}
					title={props.board?.format === "slides" ? "Present the slides" : "Fullscreen"}
					onClick={() => props.onPresent?.()}
				>
					<Show when={props.board?.format === "slides"} fallback={<Icon of={Presentation} size={16} />}>
						<span class="callout-word">Present</span>
					</Show>
				</button>
			</Show>
			<Show when={props.board && !props.board.live ? props.board : undefined}>
				{(board) => (
				<a role="menuitem" class="icon-button" aria-label="New tab" title="Open in a new tab" href={deckFileUrl(board().path)} target="_blank" rel="noopener">
					<Icon of={ExternalLink} size={16} />
				</a>
				)}
			</Show>
			<Show when={props.onComment}>
				<button type="button" role="menuitem" class="icon-button" aria-label="Comment" title={props.board ? "Comment on this board" : "Comment on this"} onClick={() => props.onComment?.()}>
					<Icon of={MessageSquarePlus} size={16} />
				</button>
			</Show>
			<Show when={props.onDuplicate}>
				<button type="button" role="menuitem" class="icon-button" aria-label="Duplicate" title="Duplicate" onClick={() => props.onDuplicate?.()}>
					<Icon of={Copy} size={16} />
				</button>
			</Show>
			<Show when={props.onProperties}>
				<button type="button" role="menuitem" class="icon-button" aria-label="Properties" title="Properties" onClick={() => props.onProperties?.()}>
					<Icon of={SlidersHorizontal} size={16} />
				</button>
			</Show>
			<Show when={props.onDelete}>
				<span class="callout-rule" aria-hidden="true" />
				<button type="button" role="menuitem" class="icon-button callout-danger" aria-label="Delete" title="Delete" onClick={() => props.onDelete?.()}>
					<Icon of={Trash} size={16} />
				</button>
			</Show>
			<Show when={props.onHide}>
				<span class="callout-rule" aria-hidden="true" />
				<button type="button" role="menuitem" class="icon-button" aria-label="Hide" title="Hide from the canvas" onClick={() => props.onHide?.()}>
					<Icon of={X} size={17} />
				</button>
			</Show>
		</div>
	);
}
