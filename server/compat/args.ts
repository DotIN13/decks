import { DROPPED, GOES, OLD_CALLS, type OldCall } from "./table.ts";

// An old call made into its new one: the name, the arguments, and back the answer.
// Rule 3 of the README: a list in the old order, options spread, old shapes turned.

type Args = Record<string, unknown>;
type Box = { x1?: number; y1?: number; x2?: number; y2?: number };
export type Refusal = { code: "not_found" | "refused" | "invalid"; message: string; hint?: string };
export type Turned = { name: string; args: Args; old: OldCall } | { refusal: Refusal };

const BY_OLD = new Map(OLD_CALLS.map((row) => [row[0], row]));
const GONE = new Map(DROPPED.map((row) => [row[0], row[2]]));
const isObject = (value: unknown): value is Args => typeof value === "object" && value !== null && !Array.isArray(value);

/** A list in the old order, or an object already keyed, as the new call's arguments. */
export function keyed(params: readonly string[], raw: unknown): Args {
	if (isObject(raw)) return { ...raw };
	const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
	const out: Args = {};
	params.forEach((param, i) => {
		const value = list[i];
		if (param === "...") Object.assign(out, isObject(value) ? value : {});
		else if (value !== undefined) out[param] = value;
	});
	return out;
}

/** A corner { x1, y1 } as a Point; a Point stays one. */
export function point(at: unknown): unknown {
	if (!isObject(at) || typeof at.x1 !== "number" || typeof at.y1 !== "number") return at;
	return { x: at.x1, y: at.y1 };
}

function boxParts(box: Box | undefined): { at?: { x: number; y: number }; size?: { w: number; h: number }; set: Args } {
	const set: Args = {};
	if (!box) return { set };
	const at = typeof box.x1 === "number" && typeof box.y1 === "number" ? { x: box.x1, y: box.y1 } : undefined;
	if (!at && typeof box.x1 === "number") set.x = box.x1;
	if (!at && typeof box.y1 === "number") set.y = box.y1;
	const w = typeof box.x2 === "number" && typeof box.x1 === "number" ? box.x2 - box.x1 : undefined;
	const h = typeof box.y2 === "number" && typeof box.y1 === "number" ? box.y2 - box.y1 : undefined;
	const size = w !== undefined || h !== undefined ? { ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) } : undefined;
	return { ...(at ? { at } : {}), ...(size ? { size: size as { w: number; h: number } } : {}), set };
}

/** One of pen.dev's own ops ({ op, node, box }) as an item op; an item op stays one. */
export function itemOp(raw: unknown): unknown {
	if (!isObject(raw)) return raw;
	const { op, node, box, set, at, ...rest } = raw as Args & { box?: Box; set?: Args };
	const parts = boxParts(box);
	const place = { ...(parts.at ? { at: parts.at } : at !== undefined ? { at: point(at) } : {}) };
	if (op === "insert" && isObject(node)) {
		const item: Args = { ...node };
		if (parts.at) Object.assign(item, { x: parts.at.x, y: parts.at.y });
		if (parts.size?.w !== undefined) item.width = parts.size.w;
		if (parts.size?.h !== undefined) item.height = parts.size.h;
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

/** The old arguments of one call, made into the new call's shapes. */
function shaped(now: string, old: string, args: Args): Args {
	for (const key of ["at"]) if (key in args) args[key] = point(args[key]);
	if (now === "item.batch" && Array.isArray(args.ops)) args.ops = args.ops.map(itemOp);
	if (now === "canvas.undo") return { ...(args.canvas ? { canvas: args.canvas } : {}), redo: args.direction === "redo" };
	if (old === "canvas.edit" && Array.isArray(args.ops)) args.ops = args.ops.map(itemOp);
	if (now === "file.url" && typeof args.file === "string" && args.path === undefined) args.path = args.file;
	return args;
}

/** An old name and its arguments, as the new call, or the refusal it answers with. */
export function turn(old: string, raw: unknown, now = Date.now()): Turned {
	const gone = GONE.get(old);
	if (gone) return { refusal: { code: "not_found", message: `${old} is gone: ${gone}` } };
	const row = BY_OLD.get(old);
	if (!row) return { refusal: { code: "not_found", message: `There is no call ${old}, old or new.` } };
	if (now > Date.parse(GOES)) return { refusal: { code: "refused", message: `${old} stopped answering on ${GOES}. Call ${row[2]}.`, hint: row[2] } };
	return { name: row[2], args: shaped(row[2], old, keyed(row[3], raw)), old: row };
}

/** A new answer as the old call expected it, where its shape changed. */
export function answerBack(old: string, value: unknown): unknown {
	if (old === "canvas.read" && Array.isArray(value)) return { items: value };
	if (old === "canvas.space" && isObject(value) && typeof value.x === "number") return { x1: value.x, y1: value.y };
	if (old === "canvas.step" && isObject(value)) return { undo: Boolean(value.undo), redo: Boolean(value.redo) };
	return value;
}
