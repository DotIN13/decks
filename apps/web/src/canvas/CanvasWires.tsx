import type { Board, CanvasGroup, CanvasLink } from "@decks/protocol";
import { createMemo, For, Show } from "solid-js";
import { fence, route } from "./wires.ts";

/**
 * The arrows and dashed groups a canvas has, drawn under its boards.
 *
 * In the world's own coordinates, as the first child of `.world`, so the camera carries them
 * with the boards for free — a pan is the same matrix for both. The lines, the dashes and the
 * words are sized in `--unit` (one screen pixel in world coordinates), so a line is two pixels
 * wide and a label is 12px at any zoom, the way the boards' title bars are.
 *
 * Nothing here is a control. Drawing one is `stage.link` for an agent and the canvas frames for
 * a person; this only shows what the canvas says is there, which is why it never takes a
 * pointer event from the boards above it.
 */
export function CanvasWires(props: { boards: Board[]; links: CanvasLink[]; groups: CanvasGroup[]; zoom: number }) {
	const at = createMemo(() => new Map(props.boards.map((board) => [board.path, board])));
	const wires = createMemo(() =>
		props.links.flatMap((link) => {
			const from = at().get(link.from);
			const to = at().get(link.to);
			// An arrow to a board that is not on this canvas is not drawn: it comes back with the board.
			return from && to ? [{ link, wire: route(from, to) }] : [];
		}),
	);
	const fences = createMemo(() =>
		props.groups.flatMap((group) => {
			const members = group.boards.map((path) => at().get(path)).filter((board): board is Board => board !== undefined);
			const border = members.length > 1 ? fence(members) : undefined;
			return border ? [{ group, border }] : [];
		}),
	);

	return (
		<Show when={wires().length > 0 || fences().length > 0}>
			<svg class="canvas-wires" aria-hidden="true" style={{ "--zoom": String(props.zoom) }}>
				<For each={fences()}>
					{({ group, border }) => (
						<g class="canvas-fence">
							<rect x={border.x} y={border.y} width={border.w} height={border.h} rx={14 / props.zoom} />
							<text x={border.x + 14 / props.zoom} y={border.y - 8 / props.zoom}>
								{group.name}
							</text>
						</g>
					)}
				</For>
				<For each={wires()}>
					{({ link, wire }) => (
						<g class="canvas-wire">
							<path d={wire.d} />
							<path class="canvas-wire-head" d={head(wire.end, props.zoom)} />
							<Show when={link.label}>
								<text x={wire.label.x} y={wire.label.y}>
									{link.label}
								</text>
							</Show>
						</g>
					)}
				</For>
			</svg>
		</Show>
	);
}

/**
 * An arrowhead at the end of a line, pointing the way it travels.
 *
 * Ten screen pixels long at any zoom, like the line is two: the path is in world coordinates,
 * so its size is divided by the zoom rather than scaled by CSS, which SVG markers would not do.
 */
function head(end: { x: number; y: number; direction: "left" | "right" | "up" | "down" }, zoom: number): string {
	const { x, y } = end;
	const long = 10 / zoom;
	const half = 5.5 / zoom;
	switch (end.direction) {
		case "right":
			return `M${x},${y} m${-long},${-half} l${long},${half} l${-long},${half} z`;
		case "left":
			return `M${x},${y} m${long},${-half} l${-long},${half} l${long},${half} z`;
		case "down":
			return `M${x},${y} m${-half},${-long} l${half},${long} l${half},${-long} z`;
		case "up":
			return `M${x},${y} m${-half},${long} l${half},${-long} l${half},${long} z`;
	}
}
