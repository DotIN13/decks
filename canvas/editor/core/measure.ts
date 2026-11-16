// Alt's distances: the lines from the selection to the item under the pointer, each with its length.
import type { Rect } from "./model.ts";
import { type Distances, type MeasureLine } from "./overlay.ts";

/**
 * Alt's distances: in edit mode, with something selected, Alt held and the pointer over another
 * item or board (`over`, its box as drawn), and no press in hand. From the box round the selection.
 */
export function distances(input: { editing: boolean; alt: boolean; busy: boolean; selection?: Rect | undefined; over?: Rect | undefined }): Distances | undefined {
	const { selection, over } = input;
	if (!input.editing || !input.alt || input.busy || !selection || !over) return undefined;
	return { from: { x: selection.x, y: selection.y, w: selection.w, h: selection.h }, to: { x: over.x, y: over.y, w: over.w, h: over.h }, lines: measure(selection, over) };
}

/**
 * The distances from `a`, the selection, to `b`, the hovered item, as Alt shows them: apart on an axis,
 * the gap level with `a`'s middle (and `b`'s edge carried out dashed when it misses); inside on an axis,
 * the gaps either side; overlapping, nothing. Each line says its length in whole pixels.
 */
export function measure(a: Rect, b: Rect): MeasureLine[] {
	const out: MeasureLine[] = [];
	const across = (x1: number, x2: number, y: number) => {
		if (x2 - x1 > 0.005) out.push({ x1, y1: y, x2, y2: y, label: String(Math.round(x2 - x1)) });
	};
	const down = (y1: number, y2: number, x: number) => {
		if (y2 - y1 > 0.005) out.push({ x1: x, y1, x2: x, y2, label: String(Math.round(y2 - y1)) });
	};
	const ay = a.y + a.h / 2;
	const ax = a.x + a.w / 2;
	if (a.x + a.w <= b.x || b.x + b.w <= a.x) {
		const right = a.x + a.w <= b.x;
		across(right ? a.x + a.w : b.x + b.w, right ? b.x : a.x, ay);
		if (ay < b.y || ay > b.y + b.h) {
			const ex = right ? b.x : b.x + b.w;
			out.push({ x1: ex, y1: ay, x2: ex, y2: ay < b.y ? b.y : b.y + b.h, dashed: true });
		}
	} else if (b.x <= a.x && b.x + b.w >= a.x + a.w) {
		across(b.x, a.x, ay);
		across(a.x + a.w, b.x + b.w, ay);
	}
	if (a.y + a.h <= b.y || b.y + b.h <= a.y) {
		const below = a.y + a.h <= b.y;
		down(below ? a.y + a.h : b.y + b.h, below ? b.y : a.y, ax);
		if (ax < b.x || ax > b.x + b.w) {
			const ey = below ? b.y : b.y + b.h;
			out.push({ x1: ax, y1: ey, x2: ax < b.x ? b.x : b.x + b.w, y2: ey, dashed: true });
		}
	} else if (b.y <= a.y && b.y + b.h >= a.y + a.h) {
		down(b.y, a.y, ax);
		down(a.y + a.h, b.y + b.h, ax);
	}
	return out;
}
