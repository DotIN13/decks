/**
 * The port between a page and a frame: one `MessagePort`, three envelopes, the same for every kind of
 * frame. An end sends events, makes calls and waits for their replies, and answers the other end's;
 * what the words are is the kind's (`@decks/canvas`, `frame/protocol.ts`, is the canvas's).
 */

/** The three envelopes, both ways: an event expects nothing back, a call exactly one reply. */
type Message =
	| { t: "event"; name: string; data?: unknown }
	| { t: "call"; id: number; name: string; data?: unknown }
	| { t: "reply"; id: number; ok: true; value?: unknown }
	| { t: "reply"; id: number; ok: false; error: string; code?: ReplyCode };

/** Why a call was refused, for a caller that decides by it. */
type ReplyCode = "refused" | "not-for-cards" | "asked-no" | "offline" | "gone";

/** A call refused, with why: what a promise from `call` rejects with. */
export class CallRefused extends Error {
	constructor(
		message: string,
		readonly code?: ReplyCode,
	) {
		super(message);
		this.name = "CallRefused";
	}
}

type Handler = (data: unknown) => unknown;

/**
 * One end of the port: send events, make calls and wait for their replies, and answer the other
 * side's. Typed by what this end sends (`Out`, `OutCalls`) and hears (`In`, `InCalls`).
 */
export interface Peer<Out, OutCalls extends Record<string, { data: unknown; value: unknown }>, In, InCalls extends Record<string, { data: unknown; value: unknown }>> {
	emit<K extends keyof Out & string>(name: K, data: Out[K]): void;
	call<K extends keyof OutCalls & string>(name: K, data: OutCalls[K]["data"], transfer?: Transferable[]): Promise<OutCalls[K]["value"]>;
	on<K extends keyof In & string>(name: K, handler: (data: In[K]) => void): void;
	answer<K extends keyof InCalls & string>(name: K, handler: (data: InCalls[K]["data"]) => InCalls[K]["value"] | Promise<InCalls[K]["value"]>): void;
	close(): void;
}

/**
 * Post a message, as a plain copy when it is not one already: a host's state is often a Solid store,
 * whose proxies the structured clone refuses. A copy through JSON is what crosses then.
 */
function post(port: MessagePort, message: Message, transfer: Transferable[] = []): void {
	try {
		port.postMessage(message, transfer);
	} catch (error) {
		if (!(error instanceof DOMException) || error.name !== "DataCloneError" || transfer.length) throw error;
		port.postMessage(JSON.parse(JSON.stringify(message)) as Message);
	}
}

export function peer<Out, OutCalls extends Record<string, { data: unknown; value: unknown }>, In, InCalls extends Record<string, { data: unknown; value: unknown }>>(port: MessagePort): Peer<Out, OutCalls, In, InCalls> {
	let next = 1;
	const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	const listeners = new Map<string, Handler[]>();
	/*
	 * Events that came before anything listened for them: the frame starts listening only once it has
	 * its drawing, and what the page said meanwhile (its dock, its agents) is not lost but handed over
	 * when the first listener for it comes. A few of each are kept.
	 */
	const early = new Map<string, unknown[]>();
	const answers = new Map<string, Handler>();
	port.onmessage = (event: MessageEvent<Message>) => {
		const message = event.data;
		if (!message || typeof message !== "object") return;
		if (message.t === "event") {
			const handlers = listeners.get(message.name);
			if (handlers?.length) for (const handler of handlers) handler(message.data);
			else early.set(message.name, [...(early.get(message.name) ?? []), message.data].slice(-20));
		}
		else if (message.t === "reply") {
			const one = waiting.get(message.id);
			if (!one) return;
			waiting.delete(message.id);
			if (message.ok) one.resolve(message.value);
			else one.reject(new CallRefused(message.error, message.code));
		} else if (message.t === "call") {
			const handler = answers.get(message.name);
			const reply = (out: Message) => post(port, out);
			if (!handler) return reply({ t: "reply", id: message.id, ok: false, error: `Nothing here answers ${message.name}.`, code: "refused" });
			Promise.resolve()
				.then(() => handler(message.data))
				.then(
					(value) => reply({ t: "reply", id: message.id, ok: true, value }),
					(error: unknown) => reply({ t: "reply", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error), ...(error instanceof CallRefused && error.code ? { code: error.code } : {}) }),
				);
		}
	};
	return {
		emit: (name, data) => post(port, { t: "event", name, data } satisfies Message),
		call: (name, data, transfer) =>
			new Promise((resolve, reject) => {
				const id = next++;
				waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
				post(port, { t: "call", id, name, data } satisfies Message, transfer ?? []);
			}),
		on: (name, handler) => {
			const list = listeners.get(name) ?? [];
			list.push(handler as Handler);
			listeners.set(name, list);
			const waiting = early.get(name);
			if (waiting) {
				early.delete(name);
				for (const data of waiting) (handler as Handler)(data);
			}
		},
		answer: (name, handler) => void answers.set(name, handler as Handler),
		close: () => {
			for (const one of waiting.values()) one.reject(new CallRefused("The canvas went away.", "gone"));
			waiting.clear();
			port.close();
		},
	};
}
