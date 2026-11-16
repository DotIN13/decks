import { createSignal } from "solid-js";
import { call } from "./line.ts";
import { on } from "./line.ts";
import type { canvasItems } from "@decks/canvas/tools";

// The drawing of the canvas on screen, as the panel's layers and the pills
// read it: item.list, read again when item.changed names that canvas. The
// frame keeps its own copy for drawing; this one is only read.

type Node = Record<string, unknown> & { id?: string; type: string; children?: Node[] };
/** The drawing, as the canvas library reads one. */
export type PenDoc = NonNullable<Parameters<typeof canvasItems>[0]>;
type CanvasPen = { canvas: string; rev: number; doc: PenDoc; base: string; by?: string; made?: string[]; edits?: { from: PenDoc; edits: readonly unknown[] } };

const [pens, setPens] = createSignal<Record<string, CanvasPen>>({});
export { pens };

/** Which canvas is watched, and a read waiting to run. Not drawn. */
const watching = { canvas: undefined as string | undefined, soon: undefined as number | undefined, stop: undefined as (() => void) | undefined };

/** Keep the drawing of this canvas, and stop keeping the last one. */
export function watchCanvas(canvas: string | undefined): void {
	if (canvas === watching.canvas) return;
	watching.canvas = canvas;
	watching.stop ??= on("item.changed", (event) => {
		if (event.canvas === watching.canvas) rewatch();
	});
	if (canvas) void read(canvas);
}

/** Read the watched drawing again, soon: several changes in a row are one read. */
export function rewatch(canvas?: string): void {
	const name = canvas ?? watching.canvas;
	if (!name || name !== watching.canvas) return;
	if (watching.soon !== undefined) clearTimeout(watching.soon);
	watching.soon = window.setTimeout(() => {
		watching.soon = undefined;
		void read(name);
	}, 120);
}

async function read(canvas: string): Promise<void> {
	const [items, about] = await Promise.all([call<Node[]>("item.list", { canvas }), call<{ rev?: number }>("canvas.get", { canvas })]);
	if (!items.ok || watching.canvas !== canvas) return;
	const doc = { version: "2.6", children: items.value.map(nodeOf) } as unknown as PenDoc;
	setPens({ ...pens(), [canvas]: { canvas, rev: about.ok ? (about.value.rev ?? 0) : 0, doc, base: `/api/t/` } });
}

/** An item as a pen.dev node: its box as x, y, width and height, inside and out; a card's title as its name. */
export function nodeOf(item: Node): Node {
	const { box, children, ...rest } = item as Node & { box?: { x1: number; y1: number; x2: number; y2: number } };
	const place = box ? { x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 } : {};
	const name = typeof rest.name !== "string" && typeof rest.title === "string" ? { name: rest.title } : {};
	return { ...rest, ...name, ...place, ...(children ? { children: children.map(nodeOf) } : {}) };
}

export function resetPens(): void {
	setPens({});
	watching.canvas = undefined;
}
