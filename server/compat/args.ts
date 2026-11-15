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
		// A whole box goes as item.box, which the canvas makes pen's own box (a frame's height a floor);
		// a corner alone goes as x and y.
		const whole = box && [box.x1, box.y1, box.x2, box.y2].every((n) => typeof n === "number");
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

/** The old arguments of one call, made into the new call's shapes. */
function shaped(now: string, old: string, args: Args): Args {
	for (const key of ["at"]) if (key in args) args[key] = point(args[key]);
	if (now === "item.batch" && Array.isArray(args.ops)) args.ops = args.ops.map(itemOp);
	if (now === "canvas.undo") return { ...(args.canvas ? { canvas: args.canvas } : {}), redo: args.direction === "redo" };
	if (old === "canvas.edit" && Array.isArray(args.ops)) args.ops = args.ops.map(itemOp);
	if (now === "file.url" && typeof args.file === "string" && args.path === undefined) args.path = args.file;
	// Today's canvas.update took the change as one object; item.update takes its parts.
	if (now === "item.update" && isObject(args.change)) {
		const { change, ...rest } = args;
		args = { ...rest, ...change, ...(isObject(change.at) ? { at: point(change.at) } : {}) };
	}
	// Today's agent.update and agent.set took the change as patch; the new call calls it change.
	if (now === "agent.update" && args.patch !== undefined && args.change === undefined) {
		args.change = args.patch;
		delete args.patch;
	}
	// An agent was named by id in today's person calls; the new agent and chat calls take agent.
	if (/^(agent|chat)\./.test(now) && args.id !== undefined && args.agent === undefined) {
		args.agent = args.id;
		delete args.id;
	}
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
	// view.reload answered { reloaded }; view.camera the Camera itself; view.viewport the screen's { width, height }.
	if (old === "view.reload" && typeof value === "number") return { reloaded: value };
	if (old === "view.camera" && isObject(value) && "camera" in value) return value.camera;
	if (old === "view.viewport" && isObject(value)) {
		const screen = value.screen as { w?: number; h?: number } | undefined;
		return screen && typeof screen.w === "number" ? { width: screen.w, height: screen.h } : null;
	}
	// canvas.insert answered the pen node, whose name was an app's or card's title.
	if (old === "canvas.insert" && isObject(value) && typeof value.title === "string" && value.name === undefined) return { ...value, name: value.title };
	// canvas.fit answered the card's measured size; card.fit answers its Placement, the size in its box.
	if (old === "canvas.fit" && isObject(value) && isObject(value.box)) {
		const b = value.box as { x1: number; y1: number; x2: number; y2: number };
		return { ...value, w: b.x2 - b.x1, h: b.y2 - b.y1 };
	}
	// canvas.export answered { file }; the new call answers a File, its path in path.
	if (old === "canvas.export" && isObject(value) && typeof value.path === "string") return { ...value, file: value.path };
	// apps.create answered the item that shows the app and the command that places it.
	if ((old === "apps.create" || old === "apps.clone") && isObject(value) && typeof value.name === "string") {
		const item = { type: "app", app: value.name };
		return { ...value, item, next: `decks canvas insert '${JSON.stringify(item)}'` };
	}
	return value;
}

/** The kernel's translator: an old name the protocol does not declare, as its new call. */
export function translate(name: string, args: unknown): { name: string; args: Args; back: (value: unknown) => unknown } | { refusal: Refusal } | undefined {
	const raw = isObject(args) && Array.isArray(args.args) ? args.args : args;
	const turned = turn(name, raw);
	if ("refusal" in turned) return BY_OLD.has(name) || GONE.has(name) ? turned : undefined;
	return { name: turned.name, args: turned.args, back: (value) => answerBack(name, value) };
}
