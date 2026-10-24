import type { Board, Camera } from "@decks/protocol";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { toScreen, type Viewport } from "./camera/camera.ts";
import { canvasBox } from "./camera/insets.ts";
import { canvasHost } from "./host.ts";
import { Icon } from "@decks/ui";
import Copy from "lucide-solid/icons/copy";
import ExternalLink from "lucide-solid/icons/external-link";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import Trash from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import MessageSquarePlus from "lucide-solid/icons/message-square-plus";
import Scan from "lucide-solid/icons/scan";
import Ellipsis from "lucide-solid/icons/ellipsis";

/** The gap between the pill and the board's edge, in screen pixels. */
const GAP = 10;

/**
 * A board's title bar, now that boards have none: a small pill over the selected board, as a phone
 * shows over selected text, on every device. Selecting a board — a click or a tap on it — shows it:
 * the actions the bar had, with the bar's own icons, on the comment popup's card, so it follows the theme. It sits over the board's top
 * edge or under its bottom one, never on the board, taking the one clear of other boards and items
 * and on the screen, and hides while the camera or the board moves.
 *
 * The same pill sits over drawn items — a shape, a card, a frame, or several — with what makes sense
 * for them: zoom to it, comment, duplicate, properties and delete. Without `board`, the board's own
 * actions (a new tab, hide) are not offered.
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
	onHide?: () => void;
	/** Comment on the whole board: the popup a selection gets, opened by the pill. */
	onComment?: () => void;
	/** For drawn items: copy them, show their properties, take them off the canvas. */
	onDuplicate?: () => void;
	onProperties?: () => void;
	onDelete?: () => void;
	/** The host's own menu for what the pill is on, opened under this button (its box on screen). */
	onMore?: (anchor: DOMRect) => void;
	/** Out of sight while something moves. */
	hidden?: boolean;
	/** The gap to the edge, in screen pixels, when something sits there the pill must leave clear (an item's arrow handles). */
	gap?: number;
	/** The other boards and items on the canvas, in its coordinates: the pill takes the slot that covers none of them. */
	obstacles?: () => ReadonlyArray<{ x: number; y: number; w: number; h: number }>;
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
		const gap = props.gap ?? GAP;
		/*
		 * Whether chrome floating over the canvas (the composer, a toolbar, a float) is where a slot would
		 * be: the room above leaves out only what is docked, and a pill under the composer cannot be pressed.
		 */
		const underChrome = (slot: { from: number; to: number }) => {
			const stage = element?.parentElement?.getBoundingClientRect();
			if (!stage || typeof document === "undefined") return false;
			const y = stage.top + (slot.from + slot.to) / 2;
			return [x - half + 8, x, x + half - 8].some((at) => {
				const hit = document.elementFromPoint(stage.left + at, y);
				return !!hit && !hit.closest(".stage");
			});
		};
		/*
		 * Two slots only, over the top edge and under the bottom one: the pill never sits on what it is
		 * for. Of the two, the one inside the room that covers no other board or item; else the one
		 * inside the room that covers less of them; and with neither edge in the room (a board filling
		 * the screen) there is no pill until the camera leaves it some.
		 */
		const slots = [
			{ y: top.y - gap, from: top.y - gap - tall(), to: top.y - gap, below: false },
			{ y: bottom.y + gap, from: bottom.y + gap, to: bottom.y + gap + tall(), below: true },
		].filter((slot) => slot.from >= room.y + 4 && slot.to <= room.y + room.height - 4 && !underChrome(slot));
		if (!slots.length) return { x, y: top.y - gap, below: false, arrow, out: true };
		const others = props.obstacles?.() ?? [];
		const covered = (slot: { from: number; to: number }) => {
			const x1 = x - half;
			const x2 = x + half;
			let area = 0;
			for (const other of others) {
				const a = toScreen(camera, view, { x: other.x, y: other.y });
				const b = toScreen(camera, view, { x: other.x + other.w, y: other.y + other.h });
				const w = Math.min(x2, b.x) - Math.max(x1, a.x);
				const h = Math.min(slot.to, b.y) - Math.max(slot.from, a.y);
				if (w > 0 && h > 0) area += w * h;
			}
			return area;
		};
		const best = slots.map((slot) => ({ slot, area: covered(slot) })).reduce((p, q) => (q.area < p.area ? q : p));
		return { x, y: best.slot.y, below: best.slot.below, arrow, out: false };
	};
	const stop = (event: Event) => event.stopPropagation();
	return (
		<div
			ref={element}
			class="board-callout"
			role="menu"
			aria-label={props.label}
			data-below={place().below ? "true" : undefined}
			data-hidden={props.hidden || place().out ? "true" : undefined}
			style={{ left: `${place().x}px`, top: `${place().y}px`, ...(place().arrow !== undefined ? { "--arrow": `${place().arrow}px` } : {}) }}
			onPointerDown={stop}
			onClick={stop}
		>
			<button type="button" role="menuitem" class="icon-button" aria-label={props.board ? "Fit" : "Zoom to it"} title={props.board ? "Fit the board to the screen" : "Zoom to it"} onClick={() => props.onOpen()}>
				<Icon of={Scan} size={16} />
			</button>
			<Show when={props.board && !props.board.live ? props.board : undefined}>
				{(board) => (
				<a role="menuitem" class="icon-button" aria-label="New tab" title="Open in a new tab" href={canvasHost().fileUrl(board().path)} target="_blank" rel="noopener">
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
			<Show when={props.onMore}>
				<button type="button" role="menuitem" class="icon-button" aria-label="More" title="More" onClick={(e) => props.onMore?.(e.currentTarget.getBoundingClientRect())}>
					<Icon of={Ellipsis} size={16} />
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
