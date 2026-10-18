/**
 * What the editor draws over the canvas (`core/overlay.ts`, `Overlay`), as elements in the world:
 * outlines, handles, hints, guides and drafts, in stage pixels, with every screen size divided by
 * the zoom so a handle is as big at 5% as at 400%. Children of `.world` (a fragment, no wrapper):
 * the stylesheet places them as `.world > .pen-…`.
 *
 * What a press on a handle does is the page's, passed in; this only draws.
 */
import { ARROW_SIDES, sidePoint, type ArrowSide } from "@decks/pen";
import GripVertical from "lucide-solid/icons/grip-vertical";
import { For, Index, Show, type Accessor, type JSX } from "solid-js";
import { anchorAt, boardHandleList, draftBox, draftCurve, handleAt, insertBox, radiusInset, radiusShown, type Outline, type Overlay } from "../core/overlay.ts";
import { HANDLES, type Handle } from "../core/resize.ts";

/** Handles are a screen size: a finger's on a touch screen, a pointer's otherwise. */
export const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
/** Where an arrow anchor sits, in screen pixels: its centre this far out from the item's side, and this wide. */
export const ANCHOR_OUT = 14;
export const ANCHOR_PX = COARSE ? 16 : 10;
/** A resize handle's width, in screen pixels. */
export const HANDLE_PX = COARSE ? 16 : 9;

export type OverlayHandlers = {
	/** A press on a card block's grip. */
	onGrip: (event: PointerEvent, id: string) => void;
	/** A press on an arrow anchor: draws an arrow from that side of the item. */
	onAnchor: (event: PointerEvent, box: Outline, side: ArrowSide) => void;
	onArrowEnd: (event: PointerEvent, which: "from" | "to") => void;
	onArrowBend: (event: PointerEvent) => void;
	onHandle: (event: PointerEvent, handle: Handle) => void;
	onRadius: (event: PointerEvent) => void;
	onBoardHandle: (event: PointerEvent, handle: Handle) => void;
};

export function OverlayLayer(
	props: OverlayHandlers & {
		overlay: Accessor<Overlay>;
		zoom: number;
		/** Whether a board is growing to its content, which its outline says. */
		sizing: (path: string) => boolean;
		/** Drawn between the item's handles and the radius handle: the one media player, laid over its item. */
		children?: JSX.Element;
	},
) {
	const o = () => props.overlay();
	return (
		<>
			<Index each={o().outlines}>
				{(box) => (
					<div
						class="pen-selection"
						data-board={box().role === "board" ? "true" : undefined}
						data-sizing={box().role === "board" && props.sizing(box().id.slice(6)) ? "true" : undefined}
						data-round={box().round ? "true" : undefined}
						style={{
							left: `${box().x}px`,
							top: `${box().y}px`,
							width: `${box().w}px`,
							height: `${box().h}px`,
							"box-shadow": `0 0 0 ${1.5 / props.zoom}px var(--color-accent)`,
						}}
					/>
				)}
			</Index>
			<Show when={o().grip}>
				{(grip) => (
					<div
						class="pen-grip"
						title="Drag to move this block"
						// Hidden, not unmounted, while anything is carried or sized: a drag begun on the grip keeps the element it captured the pointer on.
						data-hidden={o().gripHidden ? "true" : undefined}
						style={{
							// Drawn at screen size and scaled to the world, so the dots stay centred on their background at any zoom.
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
			<Show when={o().hover}>
				{(box) => (
					<div
						class="pen-hover"
						data-board={box().board ? "true" : undefined}
						data-round={box().round ? "true" : undefined}
						style={{
							left: `${box().x}px`,
							top: `${box().y}px`,
							width: `${box().w}px`,
							height: `${box().h}px`,
							"box-shadow": `0 0 0 ${1.5 / props.zoom}px var(--color-accent)`,
						}}
					/>
				)}
			</Show>
			<For each={o().joins}>
				{(box) => (
					<div
						class="pen-join"
						style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, "box-shadow": `0 0 0 ${2 / props.zoom}px var(--color-accent)` }}
					/>
				)}
			</For>
			{/*
			 * What a live drag would drop into: the frame under the pointer, in the same outline an
			 * arrow's end uses to say what it would join. The one thing that makes the gesture
			 * legible — without it, whether an item joined a frame is only knowable after letting go.
			 */}
			<Show when={o().drop}>
				{(box) => (
					<div
						class="pen-join"
						data-drop="frame"
						style={{ left: `${box().x}px`, top: `${box().y}px`, width: `${box().w}px`, height: `${box().h}px`, "box-shadow": `0 0 0 ${2 / props.zoom}px var(--color-accent)` }}
					/>
				)}
			</Show>
			{/* And where in it: the boundary between two of its children that the drop would take. */}
			<Show when={o().insert}>
				{(line) => {
					const at = () => insertBox(line(), 3 / props.zoom);
					return <div class="pen-insert" style={{ left: `${at().x}px`, top: `${at().y}px`, width: `${at().w}px`, height: `${at().h}px` }} />;
				}}
			</Show>
			<For each={o().sides}>
				{(hint) => (
					<For each={ARROW_SIDES}>
						{(side) => {
							const [x, y] = sidePoint(hint.box, side);
							const size = () => (hint.side === side ? 12 : 8) / props.zoom;
							return <div class="pen-side" data-on={hint.side === side ? "true" : undefined} style={{ left: `${x - size() / 2}px`, top: `${y - size() / 2}px`, width: `${size()}px`, height: `${size()}px`, "border-width": `${1.5 / props.zoom}px` }} />;
						}}
					</For>
				)}
			</For>
			{/*
				The four places an arrow can leave a selected item from, just outside the middle of each
				side: a drag from one draws an arrow that keeps to that side.
			*/}
			<Show when={o().anchors}>
				{(box) => (
					<For each={ARROW_SIDES}>
						{(side) => {
							const size = () => ANCHOR_PX / props.zoom;
							const at = () => anchorAt(box(), side, ANCHOR_OUT / props.zoom);
							return (
								<div
									class="pen-anchor"
									data-side={side}
									title="Drag to draw an arrow from this side"
									style={{ left: `${at().x - size() / 2}px`, top: `${at().y - size() / 2}px`, width: `${size()}px`, height: `${size()}px`, "border-width": `${1.5 / props.zoom}px` }}
									onPointerDown={(event) => props.onAnchor(event, box(), side)}
								/>
							);
						}}
					</For>
				)}
			</Show>
			<Show when={o().guides.length > 0}>
				<svg class="pen-guides" width="1" height="1" overflow="visible" aria-hidden="true">
					<For each={o().guides}>
						{(guide) => (
							<>
								<line x1={guide.x1} y1={guide.y1} x2={guide.x2} y2={guide.y2} data-kind={guide.kind} stroke-width={1 / props.zoom} />
								<Show when={guide.kind === "gap"}>
									{(() => {
										const tick = 4 / props.zoom;
										const across = guide.y1 === guide.y2;
										return (
											<>
												<line x1={across ? guide.x1 : guide.x1 - tick} y1={across ? guide.y1 - tick : guide.y1} x2={across ? guide.x1 : guide.x1 + tick} y2={across ? guide.y1 + tick : guide.y1} data-kind="gap" stroke-width={1 / props.zoom} />
												<line x1={across ? guide.x2 : guide.x2 - tick} y1={across ? guide.y2 - tick : guide.y2} x2={across ? guide.x2 : guide.x2 + tick} y2={across ? guide.y2 + tick : guide.y2} data-kind="gap" stroke-width={1 / props.zoom} />
											</>
										);
									})()}
								</Show>
							</>
						)}
					</For>
				</svg>
			</Show>
			<Show when={o().arrow}>
				{(ends) => (
					<For each={["from", "to"] as const}>
						{(which) => {
							// A finger needs a bigger end than a mouse does, as the box handles get (`HANDLE_PX`).
							const size = () => (COARSE ? 18 : 11) / props.zoom;
							// A joined end is a diamond, which slides along the side it joins; a free end is a dot.
							const joined = () => !!(which === "from" ? ends().fromJoin : ends().toJoin);
							return (
								<div
									class="pen-handle"
									data-end={which}
									data-joined={joined() ? "true" : undefined}
									title={joined() ? "Slide along the side, or drag off to join something else; double-click for the middle" : "Drag onto something to join it"}
									style={{
										left: `${ends()[which].x - size() / 2}px`,
										top: `${ends()[which].y - size() / 2}px`,
										width: `${size()}px`,
										height: `${size()}px`,
										"border-radius": joined() ? `${2 / props.zoom}px` : "50%",
										transform: joined() ? "rotate(45deg)" : undefined,
										"border-width": `${1.5 / props.zoom}px`,
									}}
									onPointerDown={(event) => props.onArrowEnd(event, which)}
								/>
							);
						}}
					</For>
				)}
			</Show>
			<Show when={o().arrow?.middle}>
				{(middle) => {
					const size = () => (COARSE ? 18 : 12) / props.zoom;
					return (
						<div
							class="pen-handle"
							data-bend={o().arrow?.route}
							title="Drag to bend the arrow; double-click for its automatic route"
							style={{
								left: `${middle().x - size() / 2}px`,
								top: `${middle().y - size() / 2}px`,
								width: `${size()}px`,
								height: `${size()}px`,
								"border-radius": "50%",
								"border-width": `${1.5 / props.zoom}px`,
								"box-shadow": o().arrow?.bent ? `inset 0 0 0 ${2.5 / props.zoom}px var(--color-accent)` : undefined,
							}}
							onPointerDown={(event) => props.onArrowBend(event)}
						/>
					);
				}}
			</Show>
			<Show when={o().route}>
				{(route) => (
					<svg class="pen-draft-line" style={{ left: "0px", top: "0px" }} width="1" height="1" overflow="visible">
						<path transform={`translate(${route().x} ${route().y})`} d={route().d} fill="none" stroke="var(--color-accent)" stroke-width={2 / props.zoom} stroke-dasharray={`${6 / props.zoom}`} />
					</svg>
				)}
			</Show>
			<Show when={o().endDraft}>
				{(line) => (
					<svg class="pen-draft-line" style={{ left: "0px", top: "0px" }} width="1" height="1" overflow="visible">
						<line x1={line().x1} y1={line().y1} x2={line().x2} y2={line().y2} stroke="var(--color-accent)" stroke-width={2 / props.zoom} stroke-dasharray={`${6 / props.zoom}`} />
					</svg>
				)}
			</Show>
			<Show when={o().handles}>
				{(box) => (
					<For each={HANDLES}>
						{(handle) => {
							const size = () => HANDLE_PX / props.zoom;
							const at = () => handleAt(box(), handle, size());
							return (
								<div
									class="pen-handle"
									data-handle={handle}
									style={{ left: `${at().x}px`, top: `${at().y}px`, width: `${size()}px`, height: `${size()}px`, "border-width": `${1.5 / props.zoom}px` }}
									onPointerDown={(event) => props.onHandle(event, handle)}
								/>
							);
						}}
					</For>
				)}
			</Show>
			{props.children}
			<Show when={o().radius}>
				{(box) => {
					const size = () => HANDLE_PX / props.zoom;
					// Clear of the corner handle itself, and never past the middle of the shape.
					const inset = () => radiusInset(radiusShown(box(), o().radiusDrag), size(), box().most);
					return (
						<div
							class="pen-handle"
							data-handle="radius"
							title="Drag to round the corners"
							style={{ left: `${box().x + inset() - size() / 2}px`, top: `${box().y + inset() - size() / 2}px`, width: `${size()}px`, height: `${size()}px`, "border-width": `${1.5 / props.zoom}px` }}
							onPointerDown={(event) => props.onRadius(event)}
						/>
					);
				}}
			</Show>
			<Show when={o().boardHandles}>
				{(box) => (
					<For each={boardHandleList(box().slides)}>
						{(handle) => {
							const size = () => HANDLE_PX / props.zoom;
							const at = () => handleAt(box(), handle, size());
							return (
								<div
									class="pen-handle"
									data-handle={handle}
									data-board={box().path}
									style={{ left: `${at().x}px`, top: `${at().y}px`, width: `${size()}px`, height: `${size()}px`, "border-width": `${1.5 / props.zoom}px` }}
									onPointerDown={(event) => props.onBoardHandle(event, handle)}
								/>
							);
						}}
					</For>
				)}
			</Show>
			<Show when={o().draft}>
				{(draft) => (
					<Show
						when={draft().tool !== "arrow"}
						fallback={
							<svg class="pen-draft-line" style={{ left: "0px", top: "0px" }} width="1" height="1" overflow="visible">
								{/* The curve a new arrow is drawn with (`route: "curved"`), between the two points. */}
								<path d={draftCurve(draft())} fill="none" stroke="var(--color-accent)" stroke-width={2 / props.zoom} stroke-dasharray={`${6 / props.zoom}`} />
							</svg>
						}
					>
						{(() => {
							const box = () => draftBox(draft());
							return (
								<div
									class="pen-draft"
									data-tool={draft().tool}
									style={{ left: `${box().x}px`, top: `${box().y}px`, width: `${box().w}px`, height: `${box().h}px`, "border-width": `${1.5 / props.zoom}px` }}
								/>
							);
						})()}
					</Show>
				)}
			</Show>
		</>
	);
}
