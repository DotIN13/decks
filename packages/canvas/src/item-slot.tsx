import type { Board } from "@decks/protocol";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { BoardView } from "./editor/index.ts";
import { CardSurface } from "./card-surface.tsx";
import { AppSurface, DocumentSurface } from "./item-surfaces.tsx";

const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
/** The band along a live item's edge that moves it, in screen pixels outside the border and inside it. */
const EDGE_OUT_PX = COARSE ? 16 : 8;
const EDGE_IN_PX = COARSE ? 6 : 4;

/**
 * What the stage hands the slot of one placed item (`Stage`'s `frame` prop): a card, a document, an
 * app, or an old board, which is drawn only as its picture.
 *
 * The stage decides where it is, whether it is awake and what its gestures do; the host adds what it
 * knows of the item's file (`ItemSlotExtras`).
 */
export interface StageBoardProps {
	board: Board;
	/** The camera's zoom: an edge band is sized in screen pixels. */
	zoom: number;
	/** Whether the item is awake: a card near the window, a document or an app (`Stage`'s `livePaths`). */
	mounted: boolean;
	/** Whether the item is on screen or within a window of it. */
	visible: boolean;
	selected: boolean;
	/**
	 * Its surface is showing, or has stopped showing. Until it says so the sheet keeps the item's
	 * picture over it, so a card never flashes empty on its way from a picture to its surface.
	 */
	onLive?: (live: boolean) => void;
	/** A drag carries this item's picture (`PenLayer.carry`): its surface waits, unseen, for the move to land. */
	carried?: boolean;
	onMove: (x: number, y: number) => void;
	/** The stage's editor, as far as this item goes (`editor/dom/pointer.ts`, `BoardView`). */
	view: BoardView;
	onOpen: () => void;
	/** How much room a card's content took, for `decks.canvas.fit`, with the revision it was measured at. */
	onExtent?: (extent: { rev: number; w: number; h: number; at?: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }) => void;
	/** A link on a card to another board or card of the deck: `true` once the host has opened it. */
	onOpenBoard?: (path: string, from: string) => boolean;
	/** The stage's fingers: a finger on the bar or the edge carries the item, and a second makes it a pinch. */
	gestures: { claimTouch(id: number): void; pinching(): boolean };
}

/** What a host adds to the slot: where a card's file is, and whether its scripts may run here. */
export interface ItemSlotExtras {
	/** A card's address (its `index.html`), or anything for a document or an app item. */
	page?: string | undefined;
	/** Raised by the host when the card's file changed where it comes from: it loads again. */
	reload?: number | undefined;
	/** False when a card's scripts may not run here: a friend's card, on a canvas shared with the person. */
	cardScripts?: boolean | undefined;
}

/**
 * One placed item on the stage: a card (`card-surface.tsx`), a document or an app (`item-surfaces.tsx`)
 * in its place while it is awake, its title above it to move it by, and the band along its edge.
 *
 * A board (`decks.board`) is drawn as its picture by the stage's sheet and nothing else: its slot has
 * the title and is pressed and moved as any item, but holds no page.
 */
export function ItemSlot(props: StageBoardProps & ItemSlotExtras) {
	const at = createMemo(() => {
		const resized = props.view.resized();
		return { x: resized?.x ?? props.board.x, y: resized?.y ?? props.board.y };
	});
	const size = () => {
		const resized = props.view.resized();
		return { w: resized?.w ?? props.board.w, h: resized?.h ?? props.board.h };
	};
	const shift = () => {
		const by = props.view.shift();
		return by ? `translate(${by.dx}px, ${by.dy}px)` : undefined;
	};
	/** A press on the item, its bar or its edge: the editor takes it as a move of the selection, or it selects the item. */
	const press = (event: PointerEvent) => {
		if (event.button !== 0) return;
		if (event.pointerType !== "touch" && props.view.press(event)) return;
		props.view.select();
	};
	/*
	 * A finger on the bar or the edge moves the item, and a second finger turns it into a pinch: the
	 * stage counts the finger too (`claimTouch` keeps it from scrolling the stage). The item is carried
	 * while the finger moves (`view.dragging`) and moved once, on the lift.
	 */
	const fingerDrag = (event: PointerEvent) => {
		if (event.button !== 0) return;
		props.gestures.claimTouch(event.pointerId);
		event.preventDefault();
		props.view.select();
		const from = { x: event.clientX, y: event.clientY };
		const origin = { x: props.board.x, y: props.board.y };
		const scale = props.zoom || 1;
		let to: { x: number; y: number } | undefined;
		let over = false;
		const move = (next: PointerEvent) => {
			if (next.pointerId !== event.pointerId) return;
			if (props.gestures.pinching()) return finish(true);
			to = { x: origin.x + (next.clientX - from.x) / scale, y: origin.y + (next.clientY - from.y) / scale };
			props.view.dragging(to);
		};
		const finish = (abandon = false) => {
			if (over) return;
			over = true;
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", end);
			window.removeEventListener("pointercancel", end);
			props.view.dragging(null);
			if (!abandon && to) props.onMove(Math.round(to.x), Math.round(to.y));
		};
		const end = (done: PointerEvent) => done.pointerId === event.pointerId && finish();
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", end);
		window.addEventListener("pointercancel", end);
	};
	/** The bar and the edge: a mouse or pen press as `press`, a finger as `fingerDrag`. */
	const grip = (event: PointerEvent) => (event.pointerType === "touch" ? fingerDrag(event) : press(event));
	/** Awake, and something the slot draws: a board has nothing here but its title. */
	const awake = createMemo(() => props.mounted && props.page !== undefined && (!!props.board.card || !!props.board.item));
	const [hovered, setHovered] = createSignal(false);
	createEffect(() => props.view.hover(hovered()));
	/** Its surface has been made: it takes the pointer, and the edge band moves it. */
	const [shown, setShown] = createSignal(false);
	createEffect(() => {
		if (!awake()) setShown(false);
	});

	/** Where an edge band sits, in board units: `EDGE_OUT_PX` outside the border and `EDGE_IN_PX` in. */
	const edgeBand = (side: "n" | "s" | "w" | "e") => {
		const out = EDGE_OUT_PX / props.zoom;
		const band = (EDGE_OUT_PX + EDGE_IN_PX) / props.zoom;
		const along = side === "n" || side === "s";
		return {
			left: side === "e" ? `calc(100% + ${out}px - ${band}px)` : `${-out}px`,
			top: side === "s" ? `calc(100% + ${out}px - ${band}px)` : `${-out}px`,
			width: along ? `calc(100% + ${2 * out}px)` : `${band}px`,
			height: along ? `${band}px` : `calc(100% + ${2 * out}px)`,
		};
	};

	/* The sheet draws the item's picture until its surface says it is showing, and again once it is gone. */
	let said = false;
	const say = (on: boolean) => {
		if (on === said) return;
		said = on;
		props.onLive?.(on);
	};
	createEffect(() => say(awake() && shown()));
	onCleanup(() => say(false));
	return (
		<div
			class="board-node plain-board"
			data-path={props.board.path}
			data-selected={props.selected}
			data-inert={!shown()}
			data-carried={props.carried ? "" : undefined}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
			style={{
				left: `${at().x}px`,
				top: `${at().y}px`,
				transform: shift(),
				width: `${size().w}px`,
				height: `${size().h}px`,
			}}
		>
			<div class="shade" aria-hidden="true" />
			<Show when={props.visible}>
				<div class="plain-board-bar" title={props.board.path} onPointerDown={grip} onDblClick={() => props.onOpen()}>
					{props.board.title}
				</div>
			</Show>
			{/* The band along the edge of an awake item: a press inside it is the item's own, so this moves it. */}
			<Show when={shown() && (hovered() || props.selected)}>
				<For each={["n", "s", "w", "e"] as const}>{(side) => <div class="board-edge" data-side={side} style={edgeBand(side)} onPointerDown={grip} />}</For>
			</Show>
			<div class="surface" style={{ width: `${size().w}px`, height: `${size().h}px` }} onPointerDown={(event) => !shown() && press(event)}>
				<Show when={awake() && props.board.card}>
					<CardSurface
						page={props.page!}
						path={props.board.path}
						trusted={props.cardScripts !== false && !props.board.path.startsWith("shared/")}
						rev={props.board.rev}
						reload={props.reload}
						size={size}
						selected={props.selected}
						onSelect={() => props.view.select()}
						onOpenBoard={(path) => props.onOpenBoard?.(path, props.board.path)}
						onExtent={props.onExtent ? (extent) => props.onExtent?.({ rev: props.board.rev, ...extent }) : undefined}
						onShown={() => setShown(true)}
					/>
				</Show>
				{/* A document or an app item: no file of its own, drawn here (`item-surfaces.tsx`). */}
				<Show when={awake() && props.board.item === "document"}>
					<DocumentSurface file={props.board.file ?? ""} selected={props.selected} onSelect={() => props.view.select()} ref={() => setShown(true)} />
				</Show>
				<Show when={awake() && props.board.item === "app"}>
					<AppSurface app={props.board.app ?? ""} selected={props.selected} onSelect={() => props.view.select()} ref={() => setShown(true)} />
				</Show>
			</div>
		</div>
	);
}
