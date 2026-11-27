import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { m } from "@decks/i18n";
import { CardSurface } from "./card-surface.tsx";
import { AppSurface, DocumentSurface } from "./item-surfaces.tsx";
import { surfaceState } from "./awake.ts";
import { openAppTab } from "../base/host.ts";
import { APP_BAR } from "../render/types.ts";
import { COARSE } from "../edit/core/touch-rules.ts";
import { createFingerDrag } from "./finger-drag.ts";
import type { ItemSlotExtras, ItemSlotProps } from "./item-slot-props.ts";

/** The band along a live item's edge that moves it, in screen pixels outside the border and inside it. */
const EDGE_OUT_PX = COARSE ? 16 : 8;
const EDGE_IN_PX = COARSE ? 6 : 4;

/**
 * The three lights on an app window's bar, as buttons. The engine paints the lights themselves, in every
 * state (`engine.rs`, `paint_window`: 12 units across, 20 apart, the first 14 from the window's left
 * edge, in the middle of the bar); these sit over them, each a 20-unit square round its light, and
 * draw only the mark a Mac shows in a light while the pointer is over the three. Red closes the window
 * (it leaves the canvas, and the app stays in the deck), yellow collapses it to a link to the app where
 * it stood, green opens the app in a tab. Red and yellow change the canvas, so they are absent where
 * the person may not; their lights are still painted, and press nothing. A press on one is never the
 * bar's: it neither selects nor drags the window.
 */
function AppLights(props: { board: ItemSlotProps["board"]; onClose?: (() => void) | undefined; onCollapse?: (() => void) | undefined }) {
	const mine = (event: Event) => event.stopPropagation();
	const light = (kind: "close" | "collapse" | "open", label: string, title: string, mark: string, press: (event: MouseEvent) => void) => (
		<button type="button" class="app-light" data-light={kind} aria-label={label} title={title} onPointerDown={mine} onDblClick={mine} onClick={(event) => { event.stopPropagation(); press(event); }}>
			<svg viewBox="0 0 12 12" aria-hidden="true">
				<path d={mark} />
			</svg>
		</button>
	);
	return (
		<div class="app-lights" style={{ height: `${APP_BAR}px` }}>
			<Show when={props.onClose}>{light("close", m.canvas_props_close(), m.canvas_app_close_title(), "M3.6 3.6 8.4 8.4M8.4 3.6 3.6 8.4", () => props.onClose?.())}</Show>
			<Show when={props.onCollapse}>{light("collapse", m.canvas_app_collapse(), m.canvas_app_collapse_title(), "M2.8 6H9.2", () => props.onCollapse?.())}</Show>
			{light("open", m.canvas_app_open_tab(), m.canvas_app_open_tab(), "M4.4 3.2H8.8V7.6M8.8 3.2 3.2 8.8", (event) => props.board.app && openAppTab(props.board.app, event.metaKey || event.ctrlKey))}
		</div>
	);
}

/**
 * One placed item on the stage: a card (`card-surface.tsx`), a document or an app (`item-surfaces.tsx`)
 * in its place while it is awake, its title above it to move it by, and the band along its edge.
 */
export function ItemSlot(props: ItemSlotProps & ItemSlotExtras) {
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
		// A finger on a sleeping item's surface, as on its bar: it selects, drags, or pinches with a second.
		if (event.pointerType === "touch") return fingerDrag(event);
		if (props.view.press(event)) return;
		props.view.select();
	};
	const { fingerDrag } = createFingerDrag({
		props,
	});
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
	createEffect(() => say(awake() && shown() && !props.asleep));
	onCleanup(() => say(false));
	return (
		<div
			class="card-node plain-card"
			data-path={props.board.path}
			data-selected={props.selected}
			data-state={surfaceState({ live: awake() && !props.asleep, kept: !!props.kept, leaving: !!props.asleep && !props.kept, shown: shown() })}
			data-inert={!shown() || props.asleep}
			data-asleep={props.asleep && props.covered ? "" : undefined}
			data-covered={props.covered ? "" : undefined}
			data-carried={props.carried ? "" : undefined}
			data-active={props.active ? "" : undefined}
			data-outlined={props.board.outlined ? "" : undefined}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
			style={{
				left: `${at().x}px`,
				top: `${at().y}px`,
				transform: shift(),
				width: `${size().w}px`,
				height: `${size().h}px`,
				// Its item's own corners, as the drawing's hole for it has them (`model/drawing.ts`, `cardFrame`).
				...(props.board.corners ? { "--canvas-item-corners": props.board.corners.map((r) => `${r}px`).join(" ") } : {}),
			}}
		>
			<div class="shade" aria-hidden="true" />
			{/* An app's name is on the window bar the engine paints, which is also what it is dragged by (`app-grip`). */}
			<Show when={props.visible && props.board.item !== "app"}>
				<div class="plain-card-bar" title={props.board.path} onPointerDown={grip} onDblClick={() => props.onOpen()}>
					{props.board.title}
				</div>
			</Show>
			<Show when={props.board.item === "app"}>
				<div class="app-grip" title={props.board.title} style={{ height: `${APP_BAR}px` }} onPointerDown={grip} onDblClick={() => props.onOpen()} />
				<AppLights board={props.board} onClose={props.onClose} onCollapse={props.onCollapse} />
			</Show>
			{/* The band along the edge of an awake item: a press inside it is the item's own, so this moves it. */}
			<Show when={shown() && !props.asleep && (hovered() || props.selected)}>
				<For each={["n", "s", "w", "e"] as const}>{(side) => <div class="card-edge" data-side={side} style={edgeBand(side)} onPointerDown={grip} />}</For>
			</Show>
			{/* Always shown while they are off: it says why the card sits still, and turns them on. */}
			<Show when={props.onScriptsOn && props.board.card}>
				<button type="button" class="card-scripts-off" title={m.canvas_card_scripts_off_title()} onPointerDown={(event) => event.stopPropagation()} onClick={() => props.onScriptsOn?.()}>
					{m.canvas_card_scripts_off()}
				</button>
			</Show>
			<div class="surface" style={{ width: `${size().w}px`, height: `${size().h}px` }} onPointerDown={(event) => (!shown() || props.asleep) && press(event)}>
				<Show when={awake() && props.board.card}>
					<CardSurface
						page={props.page!}
						path={props.board.path}
						trusted={props.cardScripts !== false && !props.board.path.startsWith("shared/")}
						rev={props.board.rev}
						sized={props.board.sized}
						reload={props.reload}
						size={size}
						selected={props.selected}
						awake={!props.asleep}
						onSelect={() => props.view.select()}
						onAddPress={(event, on) => props.view.press(event, on)}
						onOpenPage={(path) => props.onOpenPage?.(path, props.board.path)}
						onExtent={props.onExtent ? (extent) => props.onExtent?.({ rev: props.board.rev, ...extent }) : undefined}
						onShown={() => setShown(true)}
						{...(props.onWords ? { onWords: props.onWords } : {})}
					/>
				</Show>
				{/* A document or an app item: no file of its own, drawn here (`item-surfaces.tsx`). */}
				<Show when={awake() && props.board.item === "document"}>
					<DocumentSurface file={props.board.file ?? ""} selected={props.selected} onSelect={() => props.view.select()} ref={() => setShown(true)} />
				</Show>
				<Show when={awake() && props.board.item === "app"}>
					<AppSurface app={props.board.app ?? ""} path={props.board.path} visible={props.visible} selected={COARSE ? !!props.active : props.selected} onSelect={() => props.view.select()} ref={() => setShown(true)} />
				</Show>
			</div>
			{/* On a touch screen the page is covered until the item is activated: the cover selects, drags, pinches, and a second tap lifts it (`active`). */}
			<Show when={COARSE && awake() && shown() && !props.asleep && !props.active}>
				<div class="touch-cover" onPointerDown={grip} />
			</Show>
		</div>
	);
}
