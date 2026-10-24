import type { Board, Camera } from "@decks/protocol";
import { createEffect, createSignal, on, onCleanup, onMount, Show, untrack } from "solid-js";
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
 * and on the screen, and stays there as the camera moves (hidden while it does).
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
	/** Where the selection's top and bottom middles are on screen, with the camera as it is now. */
	const edges = () => {
		const { box, camera, view } = props;
		return {
			top: toScreen(camera, view, { x: box.x + box.w / 2, y: box.y }),
			bottom: toScreen(camera, view, { x: box.x + box.w / 2, y: box.y + box.h }),
		};
	};
	/*
	 * Which edge the pill is on, chosen when the selection appears and again only when what it is on
	 * moves or changes size: never as the camera moves, so a pan carries the pill with its edge, off
	 * the screen with it, rather than sending it looking for room. Of the two edges, the one whose
	 * slot is on screen, clear of floating chrome and covering no other board or item; else the one
	 * covering less of them. With neither on screen when it was chosen (the camera on its way to the
	 * selection), it is chosen again once the camera has stopped.
	 */
	const choose = (): { below: boolean; sure: boolean } => {
		const { camera, view } = props;
		const room = canvasBox(view);
		const { top, bottom } = edges();
		const x = top.x;
		const half = width() / 2;
		const gap = props.gap ?? GAP;
		const stage = element?.parentElement?.getBoundingClientRect();
		// Chrome floating over the canvas (the composer, a toolbar, a float): the room leaves out only what is docked.
		const underChrome = (slot: { from: number; to: number }) => {
			if (!stage || typeof document === "undefined") return false;
			const y = stage.top + (slot.from + slot.to) / 2;
			return [x - half + 8, x, x + half - 8].some((at) => {
				const hit = document.elementFromPoint(stage.left + at, y);
				return !!hit && !hit.closest(".stage");
			});
		};
		const slots = [
			{ from: top.y - gap - tall(), to: top.y - gap, below: false },
			{ from: bottom.y + gap, to: bottom.y + gap + tall(), below: true },
		].filter((slot) => slot.from >= room.y + 4 && slot.to <= room.y + room.height - 4 && !underChrome(slot));
		if (!slots.length) return { below: false, sure: false };
		const others = props.obstacles?.() ?? [];
		const covered = (slot: { from: number; to: number }) => {
			let area = 0;
			for (const other of others) {
				const a = toScreen(camera, view, { x: other.x, y: other.y });
				const b = toScreen(camera, view, { x: other.x + other.w, y: other.y + other.h });
				const w = Math.min(x + half, b.x) - Math.max(x - half, a.x);
				const h = Math.min(slot.to, b.y) - Math.max(slot.from, a.y);
				if (w > 0 && h > 0) area += w * h;
			}
			return area;
		};
		const best = slots.map((slot) => ({ slot, area: covered(slot) })).reduce((p, q) => (q.area < p.area ? q : p));
		return { below: best.slot.below, sure: true };
	};
	const [side, setSide] = createSignal<{ below: boolean; sure: boolean }>({ below: false, sure: false });
	createEffect(
		on([() => props.box.x, () => props.box.y, () => props.box.w, () => props.box.h, width, tall], () => setSide(untrack(choose))),
	);
	createEffect(
		on(
			() => props.hidden,
			(hidden) => {
				if (!hidden && !untrack(side).sure) setSide(untrack(choose));
			},
		),
	);
	const place = () => {
		const { top, bottom } = edges();
		const gap = props.gap ?? GAP;
		const below = side().below;
		// Centred on what it is for, wherever that is: its arrow points at the middle.
		return { x: top.x, y: below ? bottom.y + gap : top.y - gap, below, arrow: width() > 0 ? width() / 2 : undefined };
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
