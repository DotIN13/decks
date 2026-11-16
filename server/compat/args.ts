// An old call made into its new one: the name, the arguments, and back the answer.
// Rule 3 of the README: a list in the old order, options spread, old shapes turned (by protocol's penOps).
import { CALL_BY_NAME, penOps } from "../../protocol/index.ts";
import { DROPPED, GOES, OLD_CALLS, type OldCall } from "./table.ts";

type Args = Record<string, unknown>;


export type Refusal = { code: "not_found" | "refused" | "invalid"; message: string; hint?: string };

export type Turned = { name: string; args: Args; old: OldCall } | { refusal: Refusal };

const BY_OLD = new Map(OLD_CALLS.map((row) => [row[0], row]));

const GONE = new Map(DROPPED.map((row) => [row[0], row[2]]));

const isObject = (value: unknown): value is Args => typeof value === "object" && value !== null && !Array.isArray(value);

/** The kernel's translator: an old name the protocol does not declare, as its new call. */
export function translate(name: string, args: unknown): { name: string; args: Args; back: (value: unknown) => unknown } | { refusal: Refusal } | undefined {
	const raw = isObject(args) && Array.isArray(args.args) ? args.args : args;
	const turned = turn(name, raw);
	if ("refusal" in turned) return BY_OLD.has(name) || GONE.has(name) ? turned : undefined;
	return { name: turned.name, args: turned.args, back: (value) => answerBack(name, value) };
}

// The call in: an old name and its arguments, made into the new call.

/** An old name and its arguments, as the new call, or the refusal it answers with. */
export function turn(old: string, raw: unknown, now = Date.now()): Turned {
	const gone = GONE.get(old);
	if (gone) return { refusal: { code: "not_found", message: `${old} is gone: ${gone}` } };
	const row = BY_OLD.get(old);
	if (!row) return { refusal: { code: "not_found", message: `There is no call ${old}, old or new.` } };
	if (now > Date.parse(GOES)) return { refusal: { code: "refused", message: `${old} stopped answering on ${GOES}. Call ${row[2]}.`, hint: row[2] } };
	const args = shaped(row[2], old, keyed(row[3], raw));
	// canvas.read with of read one item and what is in it: item.get now.
	if (old === "canvas.read" && typeof args.of === "string") {
		const { of, ...rest } = args;
		return { name: "item.get", args: { ...rest, id: of }, old: row };
	}
	return { name: row[2], args, old: row };
}

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

/** The old arguments of one call, made into the new call's shapes. */
function shaped(now: string, old: string, args: Args): Args {
	for (const key of ["at"]) if (key in args) args[key] = penOps.pointOf(args[key]);
	if (now === "item.batch" && Array.isArray(args.ops)) args.ops = args.ops.map(penOps.itemOpOf);
	if (now === "canvas.undo") return { ...(args.canvas ? { canvas: args.canvas } : {}), redo: args.direction === "redo" };
	if (old === "canvas.edit" && Array.isArray(args.ops)) args.ops = args.ops.map(penOps.itemOpOf);
	if (now === "file.url" && typeof args.file === "string") {
		if (args.path === undefined) args.path = args.file;
		delete args.file;
	}
	// Today's view.move took the camera as one object; the new call takes x, y and zoom.
	if (now === "view.move" && isObject(args.camera)) {
		const { camera, ...rest } = args;
		args = { ...rest, ...camera };
	}
	// Today's canvas.update took the change as one object; item.update takes its parts.
	if (now === "item.update" && isObject(args.change)) {
		const { change, ...rest } = args;
		args = { ...rest, ...change, ...(isObject(change.at) ? { at: penOps.pointOf(change.at) } : {}) };
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

/**
 * The line's name for an edit (line.call's edit), passed on as the new call's own edit argument where it
 * declares one, so the server names it in item.changed's made on every socket, not only on this line.
 */
export function withEdit(turned: { name: string; args: Args }, edit: unknown): { name: string; args: Args } {
	const declared = CALL_BY_NAME.get(turned.name)?.args;
	if (typeof edit !== "string" || !declared || !("edit" in declared)) return turned;
	return { ...turned, args: { ...turned.args, edit } };
}

// The answer back, in the shape the old call gave it.

/** A new answer as the old call expected it, where its shape changed. */
export function answerBack(old: string, value: unknown): unknown {
	if (old === "canvas.read" && Array.isArray(value)) return { items: value };
	if (old === "canvas.read" && isObject(value)) return { items: [value] };
	if (old === "canvas.space" && isObject(value) && typeof value.x === "number") return { x1: value.x, y1: value.y };
	if (old === "canvas.step" && isObject(value)) return { undo: Boolean(value.undo), redo: Boolean(value.redo) };
	// view.reload answered { reloaded }; view.camera the Camera itself; view.viewport the screen's { width, height }.
	if (old === "view.reload" && typeof value === "number") return { reloaded: value };
	if (old === "view.camera" && isObject(value) && "camera" in value) return value.camera;
	if (old === "view.viewport" && isObject(value)) {
		const screen = value.screen as { w?: number; h?: number } | undefined;
		return screen && typeof screen.w === "number" ? { width: screen.w, height: screen.h } : null;
	}
	// canvas.screenshot answered width and height; the new Screenshot has size { w, h }.
	if (old === "canvas.screenshot" && isObject(value) && isObject(value.size)) {
		const size = value.size as { w: number; h: number };
		return { ...value, width: size.w, height: size.h };
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
