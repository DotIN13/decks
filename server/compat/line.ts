import type { Caller } from "../../protocol/index.ts";
import type { Deck, Peer, Route, SocketDoor, Stop } from "../kernel/index.ts";
import { answerBack, turn } from "./args.ts";
import { HEARD, told } from "./events.ts";
import { readDrawing } from "./drawing.ts";

// Today's line at /compat/v1/socket: line.hello with a token first, then line.call with old
// names, canvas.watch, and the old events down. Rules 2 to 5 of the README.

export const LINE_PATH = "/compat/v1/socket";
const QUIET = new Set(["card.seen", "card.extent", "presence.set", "view.answered", "canvas.unwatch"]);

type Said = Record<string, unknown>;
type State = { caller?: Caller; token?: string; watched: Map<string, Stop> };

/** The canvas a caller is bound to: a frame's pass names one; the person's token none. */
export const boundTo = (caller: Caller): string | undefined => (/(^|~)frame-/.test(caller.id) ? caller.canvas : undefined);

export function lineRoute(deck: () => Deck): Route {
	return {
		method: "GET",
		prefix: LINE_PATH,
		upgrade(_req, socket, _head, door) {
			const peer = door.accept();
			if (!peer) return void socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
			openLine(peer, door, deck);
		},
	};
}

function openLine(peer: Peer, door: SocketDoor, deck: () => Deck): void {
	const client = door.client();
	const state: State = { watched: new Map() };
	const send = (message: Said) => peer.send(JSON.stringify(message));
	const timer = setTimeout(() => !state.caller && peer.close(4401, "Say hello with a token first."), 5_000);
	peer.onClose(() => {
		clearTimeout(timer);
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
	const watch = (canvas: string, since?: unknown, whole?: unknown) => watchOn({ state, door, deck, send, client }, canvas, since, whole);

	async function heard(message: Said): Promise<void> {
		if (!state.caller) return hello(message);
		if (message.type === "line.call") return call(message);
		if (message.type === "canvas.watch") return watch(String(message.canvas ?? ""), message.since, message.whole);
		if (message.type === "canvas.unwatch") state.watched.get(String(message.canvas))?.();
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
		const envelope = await door.call(turned.name, turned.args, caller, client);
		if (envelope.ok) return send({ type: "call.answered", id, ok: true, value: answerBack(turned.old[0], envelope.value), ...(envelope.notes.length ? { notes: envelope.notes } : {}) });
		send({ type: "call.answered", id, ok: false, error: envelope.error.message, ...(envelope.notes.length ? { notes: envelope.notes } : {}) });
	}
}

type Watching = { state: State; door: SocketDoor; deck: () => Deck; send: (m: Said) => void; client: { id: string } };

/** Hear one canvas from now on, and send it whole when the line holds another revision. */
async function watchOn(w: Watching, canvas: string, since: unknown, whole: unknown): Promise<void> {
	const caller = w.state.caller!;
	const bound = boundTo(caller);
	if (!canvas) return;
	if (bound && bound !== canvas) return w.send({ type: "harness.error", text: `This line is ${bound}'s: it hears no other canvas.` });
	const got = await w.door.call("canvas.get", { canvas }, caller, w.client as never);
	if (!got.ok) return w.send({ type: "harness.error", text: `There is no canvas called ${canvas}.` });
	const base = filesBase(w.state, canvas);
	const drawing = (name: string) => readDrawing(w.deck(), name, base);
	w.state.watched.get(canvas)?.();
	w.state.watched.set(canvas, w.door.subscribe({ caller, client: w.client.id, events: HEARD, canvas }, (event) => {
		void told(event.name, event.payload, drawing).then((said) => said && w.send(said));
	}));
	const rev = (got.value as { rev?: number }).rev ?? 0;
	if (whole === true || (typeof since === "number" && since !== rev)) {
		const read = await drawing(canvas);
		if (read) w.send({ type: "canvas.changed", canvas, rev, doc: read.doc, base: read.base });
	}
}

/** Where a canvas's files are read on this line's pass, as the frame feature serves them. */
function filesBase(state: State, canvas: string): string {
	return state.token ? `/api/t/${state.token}/card/canvases/${canvas}/` : `/files/canvases/${canvas}/`;
}
