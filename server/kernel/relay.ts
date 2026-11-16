import { randomUUID } from "node:crypto";
import { refusal, type Caller, type Envelope } from "../../protocol/index.ts";
import type { Answerer } from "./types.ts";

// Harness calls: a declared call no feature handles goes to the connected
// host the answerer names, as an ask on its socket, and its reply comes back
// as is. No host, a host gone, or 30 s: unavailable.

type Pending = { client: string; done(envelope: Envelope<unknown>): void; timer: NodeJS.Timeout };
const WAIT_MS = 30_000;


export class Relay {
	private answerer: Answerer | undefined;
	private sockets = new Map<string, (message: unknown) => void>();
	private pending = new Map<string, Pending>();

	constructor(private waitMs = WAIT_MS) {}

	/** Given once, by the feature that keeps the hosts' offers. */
	answer(answerer: Answerer): void {
		if (this.answerer) throw new Error("Only one feature may say which host answers a call.");
		this.answerer = answerer;
	}

	/** A socket that can be sent requests; its pending requests fail when it goes. */
	connect(client: string, send: (message: unknown) => void): () => void {
		this.sockets.set(client, send);
		return () => {
			this.sockets.delete(client);
			for (const [id, one] of this.pending) if (one.client === client) this.finish(id, refusal("unavailable", "The harness that was answering went away before it replied."));
		};
	}

	forward(name: string, args: unknown, caller: Caller): Promise<Envelope<unknown>> {
		const client = this.answerer?.(name, caller);
		const send = client ? this.sockets.get(client) : undefined;
		if (!client || !send) return Promise.resolve(refusal("unavailable", `No harness is connected to answer ${name}: start the Decks harness.`, "agent.host"));
		const id = randomUUID();
		return new Promise((done) => {
			const timer = setTimeout(() => this.finish(id, refusal("unavailable", `The harness did not answer ${name} in ${Math.round(this.waitMs / 1000)} s.`)), this.waitMs);
			this.pending.set(id, { client, done, timer });
			send({ type: "ask", id, name, args, caller });
		});
	}

	/** The host's reply to a request it was sent; anything else is ignored. */
	reply(client: string, id: string, envelope: Envelope<unknown>): void {
		if (this.pending.get(id)?.client === client) this.finish(id, envelope);
	}

	private finish(id: string, envelope: Envelope<unknown>): void {
		const one = this.pending.get(id);
		if (!one) return;
		this.pending.delete(id);
		clearTimeout(one.timer);
		one.done(envelope);
	}
}
