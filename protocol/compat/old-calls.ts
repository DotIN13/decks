import type { AnyCall, Who } from "../call.ts";
import { CALL_BY_NAME } from "../calls/index.ts";
import { check } from "../validate.ts";
import * as penOps from "../pen-ops.ts";

// The calls before the rewrite, and how each becomes its new one: the name, the arguments in the old
// order, and the answer in the old shape. Read by compat's line and by the canvas frame for the cards
// already written in decks, which keep their old calls forever: this table carries no date.

type Args = Record<string, unknown>;
export type Refusal = { code: "not_found" | "refused" | "invalid"; message: string; hint?: string };
export type Turned = { name: string; args: Args; old: OldCall } | { refusal: Refusal };

const isObject = (value: unknown): value is Args => typeof value === "object" && value !== null && !Array.isArray(value);

// A card's call, old or new.

/**
 * A card's call as the new call it means, by its arguments' shape: a list is an old call; one object
 * the new call when its schema takes it, else the old one (an old canvas.delete acts on an item).
 * Only calls a card may make pass, and with here (the card's canvas), only on it.
 */
export function cardCall(name: string, raw: unknown, here?: string): { name: string; args: Args; back: (value: unknown) => unknown } | { refusal: Refusal } {
	const call = CALL_BY_NAME.get(name);
	const fresh = call && isObject(raw) && check(call.input, raw).length === 0;
	const turned: Turned = fresh ? { name, args: raw as Args, old: [name, "agents", name, []] } : turn(name, raw);
	if ("refusal" in turned) return turned;
	if (!mayCall(CALL_BY_NAME.get(turned.name), "card")) return { refusal: { code: "refused", message: `A card may not call ${turned.name}.` } };
	const canvas = turned.args.canvas;
	if (here !== undefined && canvas !== undefined && canvas !== here) return { refusal: { code: "refused", message: `A card acts on its own canvas, ${here}, not ${String(canvas)}.` } };
	return { name: turned.name, args: turned.args, back: (value) => (fresh ? value : answerBack(name, value)) };
}

const mayCall = (call: AnyCall | undefined, who: Who) => !!call && (call.who as readonly string[]).includes(who);

// The call in: an old name and its arguments, made into the new call.

/** An old name and its arguments, as the new call, or the refusal it answers with. goes, for a program's call only: the day old names stop. */
export function turn(old: string, raw: unknown, goes?: { day: string; now?: number }): Turned {
	const gone = GONE.get(old);
	if (gone) return { refusal: { code: "not_found", message: `${old} is gone: ${gone}` } };
	const row = BY_OLD.get(old);
	if (!row) return { refusal: { code: "not_found", message: `There is no call ${old}, old or new.` } };
	if (goes && (goes.now ?? Date.now()) > Date.parse(goes.day)) return { refusal: { code: "refused", message: `${old} stopped answering on ${goes.day}. Call ${row[2]}.`, hint: row[2] } };
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
	// Today's agent.send, queue and get named the agent as name, and send and queue took the message
	// as one object (an old board's boards are a card's cards); the new calls take agent and its parts.
	if (/^agent\.(send|queue|get)$/.test(now) && args.name !== undefined && args.agent === undefined) {
		const { name, message, work, ...rest } = args;
		const body = isObject(message) ? message : isObject(work) ? work : {};
		const { boards, ...parts } = body as Args;
		const cards = [...(Array.isArray(parts.cards) ? parts.cards : []), ...(Array.isArray(boards) ? boards : [])];
		args = { ...rest, agent: name, ...parts, ...(cards.length ? { cards } : {}) };
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

// The table.

/** Each row: the old name, its old table, the new name, and its old arguments in order ("..." spreads an options object). */
export type OldCall = readonly [old: string, from: "agents" | "person", now: string, params: readonly string[]];

export const OLD_CALLS: readonly OldCall[] = [
	["deck.get", "person", "deck.get", []],
	["now", "agents", "deck.now", []],
	["pair.code", "agents", "deck.pair", []],
	["harness.revoke", "person", "deck.revoke", ["id"]],
	["harness.configure", "person", "deck.update", ["settings"]],
	["canvas.copyShared", "agents", "canvas.copy", ["..."]],
	["canvas.create", "agents", "canvas.create", ["title"]],
	["canvas.export", "agents", "canvas.export", ["of","..."]],
	["here", "agents", "canvas.here", []],
	["canvas.list", "agents", "canvas.list", []],
	["canvas.remove", "person", "canvas.delete", ["canvas"]],
	["canvas.screenshot", "agents", "canvas.screenshot", ["..."]],
	["canvas.step", "agents", "canvas.undo", ["direction","..."]],
	["canvas.rename", "agents", "canvas.update", ["title","..."]],
	["canvas.batch", "agents", "item.batch", ["ops","..."]],
	["canvas.edit", "person", "item.batch", ["ops","..."]],
	["canvas.clip", "agents", "item.clip", ["ids","..."]],
	["canvas.copy", "agents", "item.copy", ["id","..."]],
	["canvas.insert", "agents", "item.insert", ["item","..."]],
	["card.play", "person", "item.insert", ["card","..."]],
	["doc.place", "person", "item.insert", ["..."]],
	["canvas.read", "agents", "item.list", ["..."]],
	["canvas.move", "agents", "item.move", ["id","..."]],
	["card.move", "person", "item.move", ["card","at","..."]],
	["canvas.paste", "agents", "item.paste", ["clip","..."]],
	["canvas.delete", "agents", "item.delete", ["id","..."]],
	["card.hide", "person", "item.delete", ["card","..."]],
	["canvas.replace", "agents", "item.replace", ["id","item","..."]],
	["canvas.space", "agents", "item.space", ["size","..."]],
	["canvas.update", "agents", "item.update", ["id","change","..."]],
	["card.resize", "person", "item.update", ["card","size","..."]],
	["canvas.variables", "agents", "item.variables", ["set","..."]],
	["agent.claim", "agents", "card.claim", ["cards"]],
	["card.create", "agents", "card.create", ["..."]],
	["canvas.fit", "agents", "card.fit", ["card","..."]],
	["card.get", "agents", "card.get", ["card"]],
	["card.canvases", "agents", "card.get", ["card"]],
	["card.list", "agents", "card.list", []],
	["card.url", "agents", "card.url", ["card"]],
	["card.delete", "person", "file.delete", ["card"]],
	["file.url", "agents", "file.url", ["file"]],
	["frame.create", "agents", "frame.create", ["path","item"]],
	["canvas.save", "agents", "frame.save", ["id","frame","..."]],
	["apps.build", "agents", "app.build", ["name"]],
	["apps.check", "agents", "app.check", ["name"]],
	["apps.clone", "agents", "app.clone", ["url","..."]],
	["apps.create", "agents", "app.create", ["name","..."]],
	["apps.status", "agents", "app.get", ["name"]],
	["apps.repo", "agents", "app.get", ["name"]],
	["apps.list", "agents", "app.list", []],
	["apps.logs", "agents", "app.logs", ["name","..."]],
	["apps.delete", "agents", "app.delete", ["name"]],
	["apps.restart", "agents", "app.restart", ["name"]],
	["apps.run", "agents", "app.run", ["name"]],
	["apps.stop", "agents", "app.stop", ["name"]],
	["apps.seen", "person", "app.update", ["name"]],
	["ports", "agents", "port.list", ["change"]],
	["agent.create", "agents", "agent.create", ["spec"]],
	["agent.add", "person", "agent.create", ["spec"]],
	["agent.get", "agents", "agent.get", ["name"]],
	["agent.inbox", "agents", "agent.inbox", []],
	["agent.list", "agents", "agent.list", ["..."]],
	["agent.me", "agents", "agent.me", []],
	["agent.queue", "agents", "agent.queue", ["name","work"]],
	["agent.remove", "person", "agent.delete", ["id"]],
	["agent.send", "agents", "agent.send", ["name","message"]],
	["agent.update", "agents", "agent.update", ["patch"]],
	["agent.set", "person", "agent.update", ["id","patch"]],
	["view.cursor", "agents", "view.cursor", ["card","at"]],
	["view.focus", "agents", "view.focus", ["target","..."]],
	["view.camera", "agents", "view.get", []],
	["view.viewport", "agents", "view.get", []],
	["view.goto", "agents", "view.goto", ["canvas"]],
	["view.move", "agents", "view.move", ["camera"]],
	["view.remember", "person", "view.move", ["camera","..."]],
	["view.reload", "agents", "view.reload", ["..."]],
	["web.answer", "person", "tab.answer", ["id","ok"]],
	["web.click", "agents", "tab.click", ["what"]],
	["web.fill", "agents", "tab.fill", ["field","text"]],
	["web.open", "agents", "tab.open", ["url"]],
	["web.pairing", "agents", "tab.pair", []],
	["web.repair", "agents", "tab.pair", []],
	["web.press", "agents", "tab.press", ["key"]],
	["web.read", "agents", "tab.read", []],
	["web.screenshot", "agents", "tab.screenshot", ["..."]],
	["web.select", "agents", "tab.select", ["field","option"]],
	["web.status", "agents", "tab.status", []],
	["web.stop", "agents", "tab.stop", []],
	["web.submit", "agents", "tab.submit", ["what","..."]],
	["studio.connect", "agents", "studio.connect", ["url","key"]],
	["studio.disconnect", "agents", "studio.disconnect", []],
	["harness.unpair", "person", "studio.disconnect", []],
	["studio.status", "agents", "studio.status", []],
	["account.googleCode", "person", "google.connect", ["url"]],
	["account.googleSignOut", "person", "google.disconnect", []],
	["account.google", "person", "google.status", []],
	["chat.abort", "person", "chat.abort", ["id"]],
	["agent.answer", "person", "chat.answer", ["answer"]],
	["agent.focus", "person", "chat.focus", ["id"]],
	["chat.fork", "person", "chat.fork", ["id","entry"]],
	["chat.tool", "person", "chat.get", ["id","item"]],
	["chat.open", "person", "chat.list", ["id"]],
	["chat.earlier", "person", "chat.list", ["id","page"]],
	["chat.preview", "person", "chat.preview", ["id","entry"]],
	["chat.queue", "person", "chat.queue", ["id","change"]],
	["agent.reset", "person", "chat.delete", ["id"]],
	["chat.restore", "person", "chat.restore", ["id","entry"]],
	["chat.rewind", "person", "chat.rewind", ["id","entry"]],
	["chat.send", "person", "chat.send", ["id","message"]],
	["account.add", "person", "account.create", []],
	["account.list", "person", "account.list", ["..."]],
	["account.forget", "person", "account.delete", ["id"]],
	["agent.report", "person", "account.report", ["id"]],
	["account.use", "person", "account.use", ["id","agent"]],
	["agent.dialogs", "person", "runtime.get", ["id"]],
	["agent.settings", "person", "runtime.get", ["id","..."]],
	["harness.get", "person", "runtime.get", []],
];

/** Old calls with no new name: each answers with why. */
export const DROPPED: readonly (readonly [old: string, from: "agents" | "person", why: string])[] = [
	["canvas.file", "agents", "canvas.get's `file` field says where the drawing is."],
	["apps.item", "agents", "The item is { type: app, app: <name> }, written straight into item.insert."],
	["deck.open", "person", "A server serves one deck, chosen when it starts; another deck is another server."],
];

const BY_OLD = new Map(OLD_CALLS.map((row) => [row[0], row]));
const GONE = new Map(DROPPED.map((row) => [row[0], row[2]]));

/** Whether a name is an old call or a dropped one. */
export const isOld = (name: string): boolean => BY_OLD.has(name) || GONE.has(name);
