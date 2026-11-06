import type { Page, Camera } from "@decks/protocol";
import { createEffect, createSignal, on, onCleanup, onMount, Show, untrack } from "solid-js";
import { toScreen, type Viewport } from "../camera/camera.ts";
import { canvasBox } from "../camera/insets.ts";
import { COARSE } from "../edit/dom/touch-rules.ts";
import { setPropsOpen } from "../edit/pen-tools.ts";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import { canvasHost, openInTab } from "../host.ts";
import { Icon } from "@decks/ui";
import Copy from "lucide-solid/icons/copy";
import ExternalLink from "lucide-solid/icons/external-link";
import Trash from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import MessageSquarePlus from "lucide-solid/icons/message-square-plus";
import Scan from "lucide-solid/icons/scan";
import Shapes from "lucide-solid/icons/shapes";
import LayoutTemplate from "lucide-solid/icons/layout-template";
import Send from "lucide-solid/icons/send";
import Ellipsis from "lucide-solid/icons/ellipsis";
import ImageDown from "lucide-solid/icons/image-down";
import FileDown from "lucide-solid/icons/file-down";
import Link from "lucide-solid/icons/link";

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
 * actions (a new tab, hide) are not offered. A card's pill is Fit, New tab, Comment, ✕ (let it go)
 * and ⋯, a menu of Export as PNG or PDF, Copy path and Delete (off the canvas, its folder kept).
 */
export function PageCallout(props: {
	board?: Page;
	/** What the pill sits over, on the stage: the board's box, or the drawn items' together. */
	box: { x: number; y: number; w: number; h: number };
	/** What a screen reader calls it. */
	label: string;
	camera: Camera;
	view: Viewport;
	/** Fit the item to the screen. New tab is the host's to open (`openInTab`): inside the canvas frame a link opens none, the sandbox allows no popup, so the page opens it. */
	onOpen: () => void;
	onHide?: () => void;
	/** A card's pill: let the card go (✕), as a press on bare canvas does. */
	onClose?: () => void;
	/** A card's pill, in its ⋯ menu: a picture of the card to download, and its path to the clipboard. */
	onExport?: (format: "png" | "pdf") => void;
	onCopyPath?: () => void;
	/** Comment on the whole board: the popup a selection gets, opened by the pill. */
	onComment?: () => void;
	/** For drawn items: copy them, take them off the canvas. */
	onDuplicate?: () => void;
	onDelete?: () => void;
	/**
	 * Ink selected, and an agent to hand it to: redraw it as a drawing, make a board of it, or send it as it
	 * is, for the agent to read and act on (a command written by hand is carried out). First, in words.
	 */
	ink?: { agent: string; onDrawing: () => void; onCard: () => void; onSend: () => void };
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
		// Under a finger the pill goes below whenever below is on screen: never over what the hand holds, and the same place every time.
		if (COARSE) return { below: slots.some((slot) => slot.below), sure: true };
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
	/*
	 * Chosen once the box has stopped changing, not at every step it moves: choosing reads the page's
	 * layout (the stage's rect, elementFromPoint for each slot), which at every step of a drag or a
	 * glide cost more than the drawing did. The edge it had rides with the box meanwhile; out of
	 * sight (hidden while something moves) it is chosen when it shows again.
	 */
	let chooseSoon: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(chooseSoon));
	createEffect(
		on([() => props.box.x, () => props.box.y, () => props.box.w, () => props.box.h, width, tall], (_now, was) => {
			clearTimeout(chooseSoon);
			if (untrack(() => props.hidden)) return setSide((one) => ({ ...one, sure: false }));
			// The first time, at once: the pill has nowhere to be yet.
			if (was === undefined || !untrack(side).sure) return setSide(untrack(choose));
			// Placed once on touch: a change of the item's size does not send it to the other edge, so it never hops.
			if (COARSE) return;
			chooseSoon = setTimeout(() => setSide(untrack(choose)), 80);
		}),
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
	/*
	 * A card's ⋯ menu: what is done less often, under the pill, gone at a press anywhere else, at Escape,
	 * or when the pill hides for a movement.
	 */
	const [more, setMore] = createSignal(false);
	createEffect(on(() => props.hidden, (hidden) => hidden && setMore(false)));
	createEffect(() => {
		if (!more()) return;
		const away = (event: Event) => {
			if (element && event.target instanceof Node && element.contains(event.target)) return;
			setMore(false);
		};
		const key = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			setMore(false);
		};
		window.addEventListener("pointerdown", away, true);
		window.addEventListener("keydown", key, true);
		onCleanup(() => {
			window.removeEventListener("pointerdown", away, true);
			window.removeEventListener("keydown", key, true);
		});
	});
	const pick = (run?: () => void) => () => {
		setMore(false);
		run?.();
	};
	const card = () => !!props.board && !!props.onClose;
	// Hide first: it takes the card off at once, as an edit of yours; Delete waits for the harness to answer. Both keep its folder.
	const remove = () => props.onHide ?? props.onDelete;
	return (
		<div
			ref={element}
			class="card-callout"
			role="menu"
			aria-label={props.label}
			data-below={place().below ? "true" : undefined}
			data-hidden={props.hidden ? "true" : undefined}
			style={{ left: `${place().x}px`, top: `${place().y}px`, ...(place().arrow !== undefined ? { "--arrow": `${place().arrow}px` } : {}) }}
			onPointerDown={stop}
			onClick={stop}
		>
			<Show when={props.ink}>
				{(ink) => (
					<>
						<button type="button" role="menuitem" class="callout-word" title={`${ink().agent} redraws it as shapes, words and arrows you can edit`} onClick={() => ink().onDrawing()}>
							<Icon of={Shapes} size={15} />
							Make a drawing
						</button>
						<button type="button" role="menuitem" class="callout-word" title={`${ink().agent} builds a card from it, in its place`} onClick={() => ink().onCard()}>
							<Icon of={LayoutTemplate} size={15} />
							Make a card
						</button>
						<button type="button" role="menuitem" class="callout-word callout-ask" title={`${ink().agent} reads it and acts on it: what you wrote there is what it does`} onClick={() => ink().onSend()}>
							<Icon of={Send} size={15} />
							Send to {ink().agent}
						</button>
						<span class="callout-rule" aria-hidden="true" />
					</>
				)}
			</Show>
			<button type="button" role="menuitem" class="icon-button" aria-label={props.board ? "Fit" : "Zoom to it"} title={props.board ? "Fit the card to the screen" : "Zoom to it"} onClick={() => props.onOpen()}>
				<Icon of={Scan} size={16} />
			</button>
			<Show when={props.board && !props.board.live ? props.board : undefined}>
				{(board) => (
				<a role="menuitem" class="icon-button" aria-label="New tab" title="Open in a new tab" href={board().item === "app" && board().app ? "#" : canvasHost().fileUrl(board().path)} target="_blank" rel="noopener" onClick={(event) => { event.preventDefault(); if (board().item === "app" && board().app) canvasHost().apps?.open(board().app!); else openInTab(canvasHost().fileUrl(board().path)); }}>
					<Icon of={ExternalLink} size={16} />
				</a>
				)}
			</Show>
			{/* On a touch screen the properties drawer opens from here, not with every selection (`Properties.tsx`). */}
			<Show when={COARSE && !props.board && !props.ink}>
				<button type="button" role="menuitem" class="icon-button" aria-label="Properties" title="Properties" onClick={() => setPropsOpen(true)}>
					<Icon of={SlidersHorizontal} size={16} />
				</button>
			</Show>
			<Show when={props.onComment}>
				<button type="button" role="menuitem" class="icon-button" aria-label="Comment" title={props.board ? "Comment on this card" : "Comment on this"} onClick={() => props.onComment?.()}>
					<Icon of={MessageSquarePlus} size={16} />
				</button>
			</Show>
			<Show when={props.onDuplicate}>
				<button type="button" role="menuitem" class="icon-button" aria-label="Duplicate" title="Duplicate" onClick={() => props.onDuplicate?.()}>
					<Icon of={Copy} size={16} />
				</button>
			</Show>
			<Show
				when={card()}
				fallback={
					<>
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
					</>
				}
			>
				{/* A card's pill: Fit, New tab, Comment, then ✕ to let it go and ⋯ for the rest. */}
				<button type="button" role="menuitem" class="icon-button" aria-label="Close" title="Deselect the card" onClick={() => props.onClose?.()}>
					<Icon of={X} size={17} />
				</button>
				<span class="callout-rule" aria-hidden="true" />
				<button type="button" role="menuitem" class="icon-button" aria-label="More" title="More" aria-haspopup="menu" aria-expanded={more()} data-on={more() ? "true" : undefined} onClick={() => setMore((open) => !open)}>
					<Icon of={Ellipsis} size={17} />
				</button>
				<Show when={more()}>
					<div class="callout-more" role="menu" aria-label="More card actions">
						<Show when={props.onExport}>
							<button type="button" role="menuitem" class="callout-more-item" aria-label="Export as PNG" onClick={pick(() => props.onExport?.("png"))}>
								<Icon of={ImageDown} size={15} />
								Export as PNG
							</button>
							<button type="button" role="menuitem" class="callout-more-item" aria-label="Export as PDF" onClick={pick(() => props.onExport?.("pdf"))}>
								<Icon of={FileDown} size={15} />
								Export as PDF
							</button>
						</Show>
						<Show when={props.onCopyPath}>
							<button type="button" role="menuitem" class="callout-more-item" aria-label="Copy path" onClick={pick(props.onCopyPath)}>
								<Icon of={Link} size={15} />
								Copy path
							</button>
						</Show>
						<Show when={remove()}>
							<span class="callout-more-rule" aria-hidden="true" />
							<button type="button" role="menuitem" class="callout-more-item callout-more-danger" aria-label="Delete" title="Take the card off the canvas; its folder stays in the deck" onClick={pick(remove())}>
								<Icon of={Trash} size={15} />
								Delete
							</button>
						</Show>
					</div>
				</Show>
			</Show>
		</div>
	);
}
