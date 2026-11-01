/**
 * What the hand presses over the canvas, and the words the engine does not set: the eight handles,
 * the radius handle, a board's handles, an arrow's ends and bend, the four arrow anchors, a card
 * block's grip, and the size and gap labels. Elements in the world, in stage pixels, with every
 * screen size divided by the zoom so a handle answers as wide at 5% as at 400%. Children of `.world`
 * (a fragment, no wrapper): the stylesheet places them as `.world > .pen-…`.
 *
 * Everything else over the canvas (outlines, hover, kin, drop targets, slots, guides, drafts, side
 * hints) the engine paints with the drawing (`stage_paint::overlay`); a check reads it from
 * `__decksOverlayRects()` (`Stage.tsx`). What a press here does is the page's, passed in.
 */
import { ARROW_SIDES, type ArrowSide } from "@decks/pen";
import GripVertical from "lucide-solid/icons/grip-vertical";
import { For, Show, type Accessor, type JSX } from "solid-js";
import { anchorAt, pageHandleList, hitReach, handleAt, radiusInset, radiusShown } from "./places.ts";
import { HANDLES, type Handle, type Outline, type Overlay } from "../wire.ts";
import { HANDLE_DOT_PX, HANDLE_HIT_PX } from "./touch-rules.ts";
import { RULES } from "../../device/profile.ts";

/** Where an arrow anchor sits, in screen pixels: its centre this far out from the item's side, and this wide. */
export const ANCHOR_OUT = RULES.anchorOut;
export const ANCHOR_PX = RULES.anchorSize;
/** A resize handle's width, in screen pixels (`touch-rules.ts`): a 10 px dot under a finger, answering 44. */
export const HANDLE_PX = HANDLE_DOT_PX;

export type HitHandlers = {
	/** A press on a card block's grip. */
	onGrip: (event: PointerEvent, id: string) => void;
	/** A press on an arrow anchor: draws an arrow from that side of the item. */
	onAnchor: (event: PointerEvent, box: Outline, side: ArrowSide) => void;
	onArrowEnd: (event: PointerEvent, which: "from" | "to") => void;
	onArrowBend: (event: PointerEvent) => void;
	onHandle: (event: PointerEvent, handle: Handle) => void;
	onRadius: (event: PointerEvent) => void;
	onPageHandle: (event: PointerEvent, handle: Handle) => void;
};

export function HitLayer(
	props: HitHandlers & {
		overlay: Accessor<Overlay>;
		zoom: number;
		/** Drawn between the item's handles and the radius handle: the one media player, laid over its item. */
		children?: JSX.Element;
	},
) {
	const o = () => props.overlay();
	/**
	 * A handle at its screen size, `px` square, centred on a point in the world and scaled by the zoom
	 * from there, as the block grip is. Sized and placed in world units instead, a 10px handle was 6.67
	 * units across at 150%, and the browser snapped its edges unevenly; this way it is the same
	 * whole-pixel square at every zoom.
	 */
	const knob = (x: number, y: number, px: number, after = "") => ({
		left: `${x}px`,
		top: `${y}px`,
		width: `${px}px`,
		height: `${px}px`,
		"transform-origin": "0 0",
		// A turn (a joined arrow end's diamond) goes before the shift to the middle, so it turns about the point itself.
		transform: `scale(${1 / props.zoom})${after} translate(-50%, -50%)`,
	});
	/** Handles round a box, each answering its reach (`--hit`): an item's eight, or a board's. */
	const handlesRound = (box: Accessor<Outline>, list: readonly Handle[], press: (event: PointerEvent, handle: Handle) => void, page?: Accessor<string>) => (
		<For each={list}>
			{(handle) => {
				const size = () => HANDLE_PX / props.zoom;
				const at = () => handleAt(box(), handle, size());
				return (
					<div
						class="pen-handle"
						data-handle={handle}
						data-page={page?.()}
						style={{ ...knob(at().x + size() / 2, at().y + size() / 2, HANDLE_PX), "--hit": `${(hitReach(size(), props.zoom, HANDLE_HIT_PX) + 1.5 / props.zoom) * props.zoom}px` }}
						onPointerDown={(event) => press(event, handle)}
					/>
				);
			}}
		</For>
	);
	/** The selection's box when it is big enough to say its size. */
	const sized = () => {
		const frame = o().selectionFrame;
		return frame && (frame.w > 10 || frame.h > 10) ? frame : undefined;
	};
	/** The labelled lines: a gap that says its size (the reading gap between two boards), and Alt's distances. */
	const tags = () => [...o().guides.filter((guide) => guide.label).map((guide) => ({ ...guide, gap: true })), ...(o().distances?.lines.filter((line) => line.label) ?? [])];
	return (
		<>
			{/* The selection's size in pixels, under it: below the arrow anchor when one shows there. */}
			<Show when={sized()}>
				{(frame) => (
					<div
						class="pen-size"
						style={{
							left: `${frame().x + frame().w / 2}px`,
							top: `${frame().y + frame().h + (o().anchors ? ANCHOR_OUT + ANCHOR_PX / 2 + 6 : 8) / props.zoom}px`,
							transform: `scale(${1 / props.zoom}) translateX(-50%)`,
						}}
					>
						{frame().label}
					</div>
				)}
			</Show>
			<Show when={o().grip}>
				{(grip) => (
					<div
						class="pen-grip"
						title="Drag to move this block"
						// Hidden, not unmounted, while anything is carried or sized: a drag begun on the grip keeps the element it captured the pointer on.
						data-hidden={o().gripHidden ? "true" : undefined}
						style={{
							left: `${grip().x - 19 / props.zoom}px`,
							top: `${grip().y - 12 / props.zoom}px`,
							transform: `scale(${1 / props.zoom})`,
						}}
						onPointerDown={(event) => props.onGrip(event, grip().id)}
					>
						<GripVertical size={16} />
					</div>
				)}
			</Show>
			{/* The four places an arrow can leave a selected item from, just outside the middle of each side. */}
			<Show when={o().anchors}>
				{(box) => (
					<For each={ARROW_SIDES}>
						{(side) => {
							const at = () => anchorAt(box(), side, ANCHOR_OUT / props.zoom);
							return (
								<div
									class="pen-anchor"
									data-side={side}
									title="Drag to draw an arrow from this side"
									style={knob(at().x, at().y, ANCHOR_PX)}
									onPointerDown={(event) => props.onAnchor(event, box(), side)}
								/>
							);
						}}
					</For>
				)}
			</Show>
			<For each={tags()}>
				{(line) => (
					<div class="pen-measure-tag" data-guide={"gap" in line ? "gap" : undefined} style={{ left: `${(line.x1 + line.x2) / 2}px`, top: `${(line.y1 + line.y2) / 2}px`, transform: `scale(${1 / props.zoom}) translate(-50%, -50%)` }}>
						{line.label}
					</div>
				)}
			</For>
			<Show when={o().arrow}>
				{(ends) => (
					<For each={["from", "to"] as const}>
						{(which) => {
							// A joined end is a diamond, which slides along the side it joins; a free end is a dot.
							const joined = () => !!(which === "from" ? ends().fromJoin : ends().toJoin);
							return (
								<div
									class="pen-handle"
									data-end={which}
									data-joined={joined() ? "true" : undefined}
									title={joined() ? "Slide along the side, or drag off to join something else; double-click for the middle" : "Drag onto something to join it"}
									style={{ ...knob(ends()[which].x, ends()[which].y, RULES.arrowEnd, joined() ? " rotate(45deg)" : ""), "border-radius": joined() ? "2px" : "50%" }}
									onPointerDown={(event) => props.onArrowEnd(event, which)}
								/>
							);
						}}
					</For>
				)}
			</Show>
			<Show when={o().arrow?.middle}>
				{(middle) => (
					<div
						class="pen-handle"
						data-bend={o().arrow?.route}
						title="Drag to bend the arrow; double-click for its automatic route"
						style={{ ...knob(middle().x, middle().y, RULES.arrowBend), "border-radius": "50%" }}
						onPointerDown={(event) => props.onArrowBend(event)}
					/>
				)}
			</Show>
			<Show when={o().handles}>{(box) => handlesRound(box, HANDLES, props.onHandle)}</Show>
			{props.children}
			<Show when={o().radius}>
				{(box) => {
					const size = () => HANDLE_PX / props.zoom;
					// Clear of the corner handle itself, and never past the middle of the shape.
					const inset = () => radiusInset(radiusShown(box(), o().radiusDrag), size(), box().most);
					return <div class="pen-handle" data-handle="radius" title="Drag to round the corners" style={knob(box().x + inset(), box().y + inset(), HANDLE_PX)} onPointerDown={(event) => props.onRadius(event)} />;
				}}
			</Show>
			<Show when={o().pageHandles}>{(box) => handlesRound(box, pageHandleList(), props.onPageHandle, () => box().path)}</Show>
		</>
	);
}
