// Today's line at /compat/v1/socket: line.hello with a token first, then line.call with old
// names, canvas.watch, and the old events down. Rules 2 to 5 of the README.
import type { Caller } from "../../protocol/index.ts";
import type { Deck, Peer, Route, SocketDoor, Stop } from "../kernel/index.ts";
import { answerBack, turn } from "./args.ts";
import { docHeard } from "./docs.ts";
import { HEARD, told } from "./events.ts";
import { pagesOf, readDrawing, type News } from "./drawing.ts";

export const LINE_PATH = "/compat/v1/socket";

const QUIET = new Set(["canvas.unwatch"]);

export const POINTER_MS = 50;

type Said = Record<string, unknown>;

type Pointer = { last: number; timer?: ReturnType<typeof setTimeout>; value: unknown; canvas: string };

type Edit = { name: string; canvas?: string; at?: number; answered?: Promise<void> };

/**
 * edits: the frame's names for its edits not yet told back as made, each with its canvas and, once
 * answered, the revision the canvas had then (at), which has the edit. sent: this line's messages in order.
 */
type State = { caller?: Caller; token?: string; watched: Map<string, Stop>; docs?: Set<string>; edits: Edit[]; pointer?: Pointer; sent?: Promise<unknown> };

/** What a line's helpers share: its state, the kernel's socket parts, the deck, its sender and its client. */
type LineParts = { state: State; door: SocketDoor; deck: () => Deck; send: (m: Said) => void; client: ReturnType<SocketDoor["client"]>; url: () => string | undefined };

/** The canvas a caller is bound to: a frame's pass names one; the person's token none. */
export const boundTo = (caller: Caller): string | undefined => (/(^|~)frame-/.test(caller.id) ? caller.canvas : undefined);

// The line: a socket that says hello, then calls in the old names.

export function lineRoute(deck: () => Deck, url: () => string | undefined = () => undefined): Route {
	return {
		method: "GET",
		prefix: LINE_PATH,
		upgrade(_req, socket, _head, door) {
			const peer = door.accept();
			if (!peer) return void socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
			openLine(peer, door, deck, url);
		},
	};
}

function openLine(peer: Peer, door: SocketDoor, deck: () => Deck, url: () => string | undefined): void {
	const client = door.client();
	const state: State = { watched: new Map(), edits: [] };
	const send = (message: Said) => peer.send(JSON.stringify(message));
	const timer = setTimeout(() => !state.caller && peer.close(4401, "Say hello with a token first."), 5_000);
	peer.onClose(() => {
		clearTimeout(timer);
		clearTimeout(state.pointer?.timer);
		for (const stop of state.watched.values()) stop();
		client.end();
	});
	peer.onText((text) => {
		let message: Said;
		try {
			message = JSON.parse(text) as Said;
		} catch {
			return send({ type: "harness.error", text: "Unreadable message." });
		}
		void heard(message).catch((error: Error) => send({ type: "harness.error", text: error.message }));
	});
	const parts: LineParts = { state, door, deck, send, client, url };
	const watch = (canvas: string, since?: unknown, whole?: unknown) => watchOn(parts, canvas, since, whole);

	async function heard(message: Said): Promise<void> {
		if (!state.caller) return hello(message);
		if (message.type === "line.call") return call(message);
		if (message.type === "canvas.watch") return watch(String(message.canvas ?? ""), message.since, message.whole);
		if (message.type === "canvas.unwatch") state.watched.get(String(message.canvas))?.();
		if (message.type === "presence.set") return screen(parts, message);
		if (message.type === "card.seen") return seen(parts, String(message.path ?? ""));
		if (message.type === "card.extent") return extent(parts, message);
		if (message.type === "view.answered") return answered(parts, message);
		if (String(message.type).startsWith("doc.")) return docHeard(parts, message);
		if (QUIET.has(String(message.type)) || message.type === "line.token") return;
		send({ type: "harness.notice", level: "warn", text: `The line does not know ${String(message.type)}.` });
	}

	async function hello(message: Said): Promise<void> {
		const caller = message.type === "line.hello" ? door.resolve(String(message.token ?? "")) : undefined;
		if (!caller) return peer.close(4401, "That token does not open the line.");
		clearTimeout(timer);
		state.caller = caller;
		state.token = String(message.token);
		const canvas = boundTo(caller);
		send({ type: "line.hello", who: canvas ? "canvas" : caller.kind, ...(canvas ? { canvas, role: "edit" } : {}) });
		for (const one of Array.isArray(message.watch) ? (message.watch as Said[]) : []) await watch(String(one.canvas ?? ""), one.since, one.whole);
	}

	async function call(message: Said): Promise<void> {
		const id = String(message.id);
		const caller = state.caller!;
		const turned = turn(String(message.verb ?? ""), message.args);
		if ("refusal" in turned) return send({ type: "call.answered", id, ok: false, error: turned.refusal.message });
		const bound = boundTo(caller);
		if (bound && turned.args.canvas !== undefined && turned.args.canvas !== bound) {
			return send({ type: "call.answered", id, ok: false, error: `This line is ${bound}'s: it calls on no other canvas.` });
		}
		if (bound && turned.args.canvas === undefined) turned.args.canvas = bound;
		const edit: Edit | undefined = typeof message.edit === "string" ? { name: message.edit, ...(typeof turned.args.canvas === "string" ? { canvas: turned.args.canvas } : {}) } : undefined;
		let answer = () => {};
		if (edit) (edit.answered = new Promise<void>((done) => (answer = done))), state.edits.push(edit);
		const envelope = await door.call(turned.name, turned.args, caller, client);
		// A change is announced after its write lands, so an older one may come first: the edit is made at
		// the revision the canvas has once it is answered (that one has it), never on an announcement before.
		if (edit && envelope.ok && edit.canvas) {
			const got = await door.call("canvas.get", { canvas: edit.canvas }, caller, client);
			edit.at = got.ok ? ((got.value as { rev?: number }).rev ?? 0) : 0;
		}
		if (edit && (!envelope.ok || !edit.canvas)) state.edits.splice(state.edits.indexOf(edit), 1);
		answer();
		if (envelope.ok) return send({ type: "call.answered", id, ok: true, value: answerBack(turned.old[0], envelope.value), ...(envelope.notes.length ? { notes: envelope.notes } : {}) });
		send({ type: "call.answered", id, ok: false, error: envelope.error.message, ...(envelope.notes.length ? { notes: envelope.notes } : {}) });
	}
}

// A watched canvas: its changes told as today's events, the line's own edits named as made.

/** Hear one canvas from now on, and send it whole when the line holds another revision. */
async function watchOn(w: LineParts, canvas: string, since: unknown, whole: unknown): Promise<void> {
	const caller = w.state.caller!;
	const bound = boundTo(caller);
	if (!canvas) return;
	if (bound && bound !== canvas) return w.send({ type: "harness.error", text: `This line is ${bound}'s: it hears no other canvas.` });
	const got = await w.door.call("canvas.get", { canvas }, caller, w.client as never);
	if (!got.ok) return w.send({ type: "harness.error", text: `There is no canvas called ${canvas}.` });
	const base = filesBase(w.state, canvas);
	const drawing = (name: string) => readDrawing(w.deck(), name, base);
	const cardPage = async (path: string) => {
		const read = await drawing(canvas);
		const news = (await w.door.call("card.get", { card: path }, caller, w.client as never)) as { ok: boolean; value?: News };
		const pages = read ? pagesOf(canvas, read.doc as { children?: [] }, true, new Map(news.ok && news.value ? [[path, news.value]] : [])) : [];
		return pages.find((page) => page.path === path);
	};
	w.state.watched.get(canvas)?.();
	w.state.watched.set(canvas, w.door.subscribe({ caller, client: w.client.id, events: HEARD, canvas }, (event) => {
		// The frame shows its own edits until a drawing says it has them: this line's change names them as made.
		// Told in the order heard, each once the edits in flight now are answered, so their revisions are known.
		const inFlight = Promise.all(w.state.edits.map((e) => e.answered));
		w.state.sent = (w.state.sent ?? Promise.resolve())
			.then(() => inFlight)
			.then(() => told(event.name, madeIn(w.state, canvas, event), drawing, cardPage))
			.then((said) => said && w.send(said), () => undefined);
	}));
	const rev = (got.value as { rev?: number }).rev ?? 0;
	if (whole === true || (typeof since === "number" && since !== rev)) {
		const read = await drawing(canvas);
		if (read) w.send({ type: "canvas.changed", canvas, rev, doc: read.doc, base: read.base });
	}
}

/** An item.changed naming the line's edits that its revision has, which leave the list; any other event as it is. */
function madeIn(state: State, canvas: string, event: { name: string; payload: Record<string, unknown> }): Record<string, unknown> {
	const rev = event.payload.rev;
	if (event.name !== "item.changed" || typeof rev !== "number") return event.payload;
	const made = state.edits.filter((e) => e.canvas === canvas && e.at !== undefined && e.at <= rev);
	if (!made.length) return event.payload;
	state.edits = state.edits.filter((e) => !made.includes(e));
	return { ...event.payload, made: made.map((e) => e.name) };
}

/** Where a canvas's files are read on this line's pass, as the frame feature serves them. */
function filesBase(state: State, canvas: string): string {
	return state.token ? `/api/t/${state.token}/card/canvases/${canvas}/` : `/files/canvases/${canvas}/`;
}

// What the frame says: where it points and looks, a card seen, a card's height, an answer.

/** The frame said where it points, what it picked or where it looks: view.update; a camera also makes it a screen that can shoot. */
async function screen(L: LineParts, message: Said): Promise<void> {
	const canvas = String(message.canvas ?? "");
	const fields = Object.fromEntries(["pointer", "selection", "camera"].filter((k) => k in message).map((k) => [k, message[k]]));
	if (Object.keys(fields).length === 1 && "pointer" in fields) return pointerSoon(L, canvas, fields.pointer);
	if (Object.keys(fields).length) await L.door.call("view.update", { ...fields, canvas }, L.state.caller!, L.client);
	const camera = message.camera as { x?: number; y?: number; zoom?: number } | null | undefined;
	if (!camera || typeof camera.x !== "number" || typeof camera.y !== "number" || typeof camera.zoom !== "number") return;
	await L.door.call("view.move", { x: camera.x, y: camera.y, zoom: camera.zoom, canvas, device: "frame" }, L.state.caller!, L.client);
}

/**
 * A pointer alone is said at most once each POINTER_MS, the last one winning: the frame says
 * every move, and each would wake every other screen of the canvas while the person draws.
 */
function pointerSoon(L: LineParts, canvas: string, pointer: unknown): void {
	const p = L.state.pointer ?? { last: 0, timer: undefined, value: undefined, canvas };
	L.state.pointer = p;
	Object.assign(p, { value: pointer, canvas });
	if (p.timer) return;
	const say = () => {
		p.timer = undefined;
		p.last = Date.now();
		void L.door.call("view.update", { pointer: p.value, canvas: p.canvas }, L.state.caller!, L.client);
	};
	const wait = POINTER_MS - (Date.now() - p.last);
	if (wait <= 0) return say();
	p.timer = setTimeout(say, wait);
}

/** The person read a card: recorded, and the frame told the card's page again, its dot gone. */
async function seen(L: LineParts, path: string): Promise<void> {
	const answer = await L.door.call("card.seen", { card: path }, L.state.caller!, L.client);
	const canvas = boundTo(L.state.caller!) ?? [...L.state.watched.keys()][0];
	if (!answer.ok || !canvas) return;
	const read = await readDrawing(L.deck(), canvas, "");
	const page = read ? pagesOf(canvas, read.doc as { children?: [] }, true, new Map([[path, answer.value as News]])).find((one) => one.path === path) : undefined;
	if (page) L.send({ type: "card.changed", path, rev: 0, card: page });
}

/** A card's measured height, kept by server/pictures (card.fit answers from it), as the line's caller. */
async function extent(L: LineParts, message: Said): Promise<void> {
	const base = L.url();
	if (!base || !L.state.token) return;
	const { type: _type, ...body } = message;
	await fetch(`${base}/pictures/extent`, { method: "POST", headers: { authorization: `Bearer ${L.state.token}`, "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
}

/** The frame's answer to a picture: a shot as the value, or why it could not as the error. */
async function answered(L: LineParts, message: Said): Promise<void> {
	const value = message.value as { how?: string; why?: string } | undefined;
	const error = typeof message.error === "string" ? message.error : value?.how === "none" ? (value.why ?? "the frame could not draw the card") : undefined;
	await L.door.call("view.answer", { id: String(message.id), ...(error ? { error } : { value }) }, L.state.caller!, L.client);
}
