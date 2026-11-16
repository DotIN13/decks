import type { Infer } from "./schema.ts";
import type { ItemOp } from "./shapes.ts";

// One change two ways: pen.dev's own op ({ op, node, box }), which the canvas frame and an old
// client send, and the protocol's item op ({ op, item, at, size }), which item.batch takes.

type Op = Infer<typeof ItemOp>;
type Args = Record<string, unknown>;
type Box = { x1?: number; y1?: number; x2?: number; y2?: number };

/** One of pen.dev's ops (not sync.ts's PenOp, pen's diff edit). An item op's beside and below ride along as they are. */
export type PenDevOp = { op: string; id?: string; node?: Args; box?: Box; set?: Args; [key: string]: unknown };

const isObject = (value: unknown): value is Args => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): value is number => typeof value === "number";

// Pen to item.

/** A pen op as an item op; an item op, or anything else, stays as it is. */
export function itemOpOf(raw: unknown): unknown {
	if (!isObject(raw)) return raw;
	const { op, node, box, set, at, ...rest } = raw as Args & { box?: Box; set?: Args };
	const parts = boxParts(box);
	const place = { ...(parts.at ? { at: parts.at } : at !== undefined ? { at: pointOf(at) } : {}) };
	if (op === "insert" && isObject(node)) {
		// A whole box goes as item.box, which the canvas makes pen's own box (a frame's height a floor);
		// a corner alone goes as x and y.
		const whole = box && [box.x1, box.y1, box.x2, box.y2].every(num);
		const item: Args = whole ? { ...node, box: { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 } } : { ...node };
		if (!whole && parts.at) Object.assign(item, { x: parts.at.x, y: parts.at.y });
		return { op, item, ...rest };
	}
	if (op === "replace" && isObject(node)) return { op, item: node, ...rest };
	if (op === "update") {
		const merged = { ...(set ?? {}), ...parts.set };
		return { op, ...rest, ...(Object.keys(merged).length ? { set: merged } : {}), ...place, ...(parts.size ? { size: parts.size } : {}) };
	}
	if (op === "move" || op === "copy") return { op, ...rest, ...place };
	return raw;
}

/** A corner { x1, y1 } as a Point; a Point stays one. */
export function pointOf(at: unknown): unknown {
	if (!isObject(at) || !num(at.x1) || !num(at.y1)) return at;
	return { x: at.x1, y: at.y1 };
}

function boxParts(box: Box | undefined): { at?: { x: number; y: number }; size?: { w: number; h: number }; set: Args } {
	const set: Args = {};
	if (!box) return { set };
	const at = num(box.x1) && num(box.y1) ? { x: box.x1, y: box.y1 } : undefined;
	if (!at && num(box.x1)) set.x = box.x1;
	if (!at && num(box.y1)) set.y = box.y1;
	const w = num(box.x2) && num(box.x1) ? box.x2 - box.x1 : undefined;
	const h = num(box.y2) && num(box.y1) ? box.y2 - box.y1 : undefined;
	const size = w !== undefined || h !== undefined ? { ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) } : undefined;
	return { ...(at ? { at } : {}), ...(size ? { size: size as { w: number; h: number } } : {}), set };
}

// Item to pen.

/**
 * An item op as a pen op: the item as the node, a corner and a size as the box. A size with no
 * corner is pen's own width and height; beside and below stay as they are, for the server to place.
 */
export function penOpOf(op: Op): PenDevOp {
	switch (op.op) {
		case "insert": {
			const { item, at, ...rest } = op;
			const { box, ...node } = item as Args & { box?: Box };
			const corner = at ? { x1: at.x, y1: at.y } : undefined;
			const whole = isObject(box) ? box : corner;
			return { ...rest, op: "insert", node, ...(whole ? { box: whole } : {}) };
		}
		case "update": {
			const { at, size, set, ...rest } = op;
			const box: Box = at ? { x1: at.x, y1: at.y, ...(num(size?.w) ? { x2: at.x + size.w } : {}), ...(num(size?.h) ? { y2: at.y + size.h } : {}) } : {};
			const own = !at && size ? { ...(num(size.w) ? { width: size.w } : {}), ...(num(size.h) ? { height: size.h } : {}) } : {};
			const fields = { ...(set ?? {}), ...own };
			return { ...rest, op: "update", ...(Object.keys(fields).length ? { set: fields } : {}), ...(at ? { box } : {}) };
		}
		case "replace":
			return { op: "replace", id: op.id, node: op.item as Args };
		case "move":
		case "copy": {
			const { at, ...rest } = op;
			return { ...rest, ...(at ? { box: { x1: at.x, y1: at.y } } : {}) };
		}
		default:
			return { ...op };
	}
}
