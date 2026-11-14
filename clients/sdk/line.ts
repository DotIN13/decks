import { PROTOCOL_VERSION, type Caller, type Refusal } from "../../protocol/index.ts";
import { DecksError, type Answered } from "./http.ts";
import { socketUrl, type Heard } from "./socket.ts";

// A socket line kept open: hello, calls with their answers, events, and the
// asks a server relays to a host, each answered with one reply, and the
// harness events a host tells.

type Envelope = { ok: true; value: unknown; notes?: string[] } | { ok: false; error: Refusal; notes?: string[] };
export type Ask = { id: string; name: string; args: unknown; caller: Caller };
type Message = { type: string; id?: string; name?: string; args?: unknown; caller?: Caller; payload?: unknown; envelope?: Envelope };

export class Line {
	readonly caller: Promise<Caller>;
	readonly closed: Promise<void>;
	private socket: WebSocket;
	private next = 0;
	private waiting = new Map<string, (envelope: Envelope) => void>();
	private hearers = new Set<(event: Heard) => void>();
	private asked: (ask: Ask) => Promise<Envelope> = async () => ({ ok: false, error: { code: "unavailable", message: "This client answers no harness calls." } });

	constructor(url: string, token: string) {
		this.socket = new WebSocket(socketUrl(url));
		let greeted: (caller: Caller) => void = () => {};
		let refused: (error: Error) => void = () => {};
		this.caller = new Promise((resolve, reject) => ((greeted = resolve), (refused = reject)));
		this.closed = new Promise((resolve) => this.socket.addEventListener("close", () => resolve()));
		this.socket.addEventListener("close", (event) => refused(new DecksError({ code: "refused", message: `The socket closed: ${event.reason || event.code}.` })));
		this.socket.addEventListener("open", () => this.send({ type: "hello", token, protocol: PROTOCOL_VERSION }));
		this.socket.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data)) as Message;
			if (message.type === "hello" && message.caller) greeted(message.caller);
			if (message.type === "answer" && message.id) this.waiting.get(message.id)?.(message.envelope!);
			if (message.type === "event" && message.name) for (const hear of this.hearers) hear({ name: message.name, payload: message.payload });
			if (message.type === "ask" && message.id) void this.answer(message as Ask);
		});
	}

	private send(message: object): void {
		this.socket.send(JSON.stringify(message));
	}

	private async answer(ask: Ask): Promise<void> {
		this.send({ type: "reply", id: ask.id, envelope: await this.asked(ask) });
	}

	/** A call over the line, tied to this connection (as agent.host must be). */
	async call(name: string, args: unknown = {}): Promise<Answered> {
		await this.caller;
		const id = `c${++this.next}`;
		const envelope = await new Promise<Envelope>((resolve) => {
			this.waiting.set(id, resolve);
			this.send({ type: "call", id, name, args });
		});
		this.waiting.delete(id);
		if (!envelope.ok) throw new DecksError(envelope.error, envelope.notes ?? []);
		return { value: envelope.value, notes: envelope.notes ?? [] };
	}

	/** Hear events: watch() says which, on() hears them. */
	watch(events?: string[]): void {
		this.send({ type: "watch", ...(events ? { events } : {}) });
	}

	on(hear: (event: Heard) => void): () => void {
		this.hearers.add(hear);
		return () => this.hearers.delete(hear);
	}

	/** Send a harness event (chat.*, account.*, runtime.*) for the server to fan out. */
	tell(name: string, payload: unknown): void {
		this.send({ type: "tell", name, payload });
	}

	/** How this client answers what the server relays to it. */
	onAsk(answer: (ask: Ask) => Promise<Envelope>): void {
		this.asked = answer;
	}

	close(): void {
		this.socket.close();
	}
}
