/**
 * The wire the two gates sit in.
 *
 * `WebGate` listens on a loopback port and speaks Chrome DevTools Protocol to whatever
 * connects — a stock Playwright, a browser agent, anything that would talk to a Chrome. On
 * the other side it opens one socket to a real Chrome's debugger endpoint and forwards
 * every command through. Between the two it reads each command and holds the ones
 * `gate.ts` names: a press that would send something waits for a person to allow it, and a
 * command carrying text never arrives with the agent's own words in it.
 *
 * Three things make this a gate rather than a suggestion.
 *
 * - **It is in the wire, not in the agent's instructions.** The agent cannot talk past it,
 *   because it never sees the gate: it sees a browser endpoint, and its command either
 *   completes or fails.
 * - **A held command is answered, not dropped.** The agent's call gets an error naming what
 *   was refused, so its own loop learns the action did not happen instead of believing it did.
 * - **Commands are handled one at a time.** While a gate is open nothing else reaches the
 *   browser, so the agent cannot work around a question by trying a different route.
 *
 * The package knows nothing about who is asked. `hooks.allow` and `hooks.words` are
 * functions the caller hands in, and they may resolve however the caller likes — a person
 * pressing Allow on a board, another agent on its next turn, or a test.
 */

import { createServer, type Server } from "node:http";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { classify, clickProbe, clickTarget, fieldProbe, judgeClick, type CdpMessage } from "./gate.ts";

/** What the gate is asking, said so a person or another agent can answer it without the transcript. */
export interface GateQuestion {
	id: string;
	kind: "allow" | "words";
	/** The page it happened on, when the gate could read the title. */
	tab?: string;
	/** What the agent tried to do, in words: `click "Send" — it submits the form`. */
	action: string;
	/** For `words`: the field the agent was about to type into. */
	field?: string;
}

/** The two questions, as functions. Nothing else about the caller is known here. */
export interface GateHooks {
	/** Before anything is sent: whether to let it through. A rejection is a refusal. */
	allow(question: GateQuestion): Promise<boolean>;
	/** Instead of the agent's own words: the text to type. An empty answer refuses. */
	words(question: GateQuestion): Promise<string>;
}

/** One line for the run's transcript: what the gate did, not what the agent said it did. */
export interface GateEvent {
	at: number;
	kind: "passed" | "held" | "allowed" | "refused" | "typed" | "unread" | "closed";
	text: string;
}

export interface GateOptions {
	/** The real Chrome's debugger endpoint — the extension relay's loopback address. */
	upstream: string;
	hooks: GateHooks;
	/** How long a held command waits for an answer. A question nobody answers is a refusal. */
	timeoutMs?: number;
	/** How long reading the page may take. A page that does not answer is not a reason to stop the run. */
	probeMs?: number;
	onEvent?: (event: GateEvent) => void;
}

/** A held command waits this long, then is refused. */
const HELD_MS = 120_000;
/** Reading one element off the page is a round trip to a browser that is already answering commands. */
const PROBE_MS = 5_000;
/** Probe ids start here, so they cannot collide with the agent's own. */
const PROBE_BASE = 1_000_000;

export class WebGate {
	private readonly wss: WebSocketServer;
	private readonly hooks: GateHooks;
	private readonly timeoutMs: number;
	private readonly probeMs: number;
	private readonly onEvent: ((event: GateEvent) => void) | undefined;
	private client: WebSocket | undefined;
	private upstream: WebSocket | undefined;
	private readonly probes = new Map<number, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
	private nextProbe = PROBE_BASE;
	/** One command at a time, in order. A gate that is open is a queue that has stopped moving. */
	private chain: Promise<void> = Promise.resolve();
	/** The upstream handshake, so a command that arrives before it settles waits rather than failing. */
	private opening: Promise<void> = Promise.resolve();
	private closed = false;

	private constructor(
		private readonly server: Server,
		private readonly port: number,
		private readonly upstreamUrl: string,
		options: GateOptions,
	) {
		this.hooks = options.hooks;
		this.timeoutMs = options.timeoutMs ?? HELD_MS;
		this.probeMs = options.probeMs ?? PROBE_MS;
		this.onEvent = options.onEvent;
		this.wss = new WebSocketServer({ noServer: true });
		this.server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
			this.wss.handleUpgrade(request, socket, head, (ws) => this.accept(ws));
		});
	}

	/** Listen on loopback and return the endpoint a browser agent should attach to. */
	static async start(options: GateOptions): Promise<WebGate> {
		if (!options.upstream) throw new Error("WebGate needs an upstream debugger endpoint to forward to.");
		const server = createServer((_request, response) => {
			response.statusCode = 404;
			response.end();
		});
		const port = await new Promise<number>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (!address || typeof address === "string") reject(new Error("WebGate did not get a port"));
				else resolve(address.port);
			});
		});
		return new WebGate(server, port, options.upstream, options);
	}

	/** The endpoint to hand a browser agent, in the shape Playwright's `connectOverCDP` takes. */
	get cdpUrl(): string {
		return `ws://127.0.0.1:${this.port}/cdp`;
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		for (const [, probe] of this.probes) {
			clearTimeout(probe.timer);
			probe.resolve(undefined);
		}
		this.probes.clear();
		this.client?.close(1000, "the gate closed");
		this.upstream?.close(1000, "the gate closed");
		this.wss.close();
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
		this.event("closed", "the gate closed");
	}

	// --- the two sides -------------------------------------------------------------

	private accept(client: WebSocket): void {
		if (this.client) {
			client.close(1000, "Another client is already attached");
			return;
		}
		this.client = client;
		/*
		 * Upstream opens with the client, not at start: a Chrome's debugger endpoint accepts one
		 * client at a time, so a gate that held a socket open would take the tab from the person
		 * the moment the gate was made rather than the moment a run began.
		 */
		const upstream = new WebSocket(this.upstreamUrl);
		this.upstream = upstream;
		/*
		 * A client can send its first command before the browser's handshake settles — Playwright
		 * does — so the gate holds commands until the upstream is up rather than refusing them.
		 */
		this.opening = new Promise<void>((resolve) => {
			upstream.once("open", () => resolve());
			upstream.once("error", () => resolve());
			upstream.once("close", () => resolve());
		});
		upstream.on("message", (data) => this.fromUpstream(data));
		upstream.on("close", () => {
			if (this.upstream !== upstream) return;
			this.upstream = undefined;
			this.client?.close(1000, "the browser closed the connection");
		});
		upstream.on("error", () => upstream.close());
		client.on("message", (data) => this.enqueue(data));
		client.on("close", () => {
			if (this.client === client) this.client = undefined;
			upstream.close();
		});
		client.on("error", () => {});
	}

	/** One command at a time, in the order they arrived, so a held command really holds. */
	private enqueue(data: RawData): void {
		this.chain = this.chain.then(
			() => this.handle(data),
			() => this.handle(data),
		);
	}

	private async handle(data: RawData): Promise<void> {
		let message: CdpMessage;
		try {
			message = JSON.parse(data.toString()) as CdpMessage;
		} catch {
			return; // Not a CDP frame; there is nothing to judge.
		}
		if (!message.method || message.id === undefined) return this.forward(message);
		// The handshake first: a question about a page cannot be asked down a socket that is not up.
		await this.opening;
		const decision = classify(message);
		switch (decision.kind) {
			case "pass":
				return this.forward(message);
			case "text":
				return this.holdText(message, decision.text);
			case "allow":
				return this.holdAction(message, decision.action);
			case "click":
				return this.holdClick(message, decision.x, decision.y);
		}
	}

	/** A command carrying the agent's own words: the words are replaced before it goes. */
	private async holdText(message: CdpMessage, offered: string): Promise<void> {
		const [field, tab] = await Promise.all([this.field(message), this.tab(message)]);
		const question = this.question("words", `type into ${field}${tab ? ` on ${tab}` : ""}`, { field, tab });
		this.event("held", `held typing: the agent offered ${offered.length} characters`);
		const answer = await this.ask(question, () => this.hooks.words(question), "");
		if (!answer) {
			this.event("refused", `nothing was typed into ${field}`);
			return this.refuse(message, `nothing was typed: the words for ${field} did not come back`);
		}
		const params = { ...(message.params ?? {}), text: answer };
		this.event("typed", `${answer.length} characters went into ${field}`);
		this.forward({ ...message, params });
	}

	/** Enter, or a press the page said would send: the question goes out before the command does. */
	private async holdAction(message: CdpMessage, action: string): Promise<void> {
		const tab = await this.tab(message);
		const question = this.question("allow", action, { tab });
		this.event("held", `held: ${action}`);
		const allowed = await this.ask(question, () => this.hooks.allow(question), false);
		if (!allowed) {
			this.event("refused", `refused: ${action}`);
			return this.refuse(message, `refused by the person supervising this run: ${action}`);
		}
		this.event("allowed", `allowed: ${action}`);
		this.forward(message);
	}

	/**
	 * A press. The page is asked what is under the pointer before anything is decided, because
	 * whether a button sends something is not written on the button.
	 */
	private async holdClick(message: CdpMessage, x: number, y: number): Promise<void> {
		const target = clickTarget(await this.probe(message, clickProbe(x, y)));
		const decision = judgeClick(target, { x, y });
		if (decision.kind !== "allow") {
			if (!target) this.event("unread", `could not read the element at ${Math.round(x)},${Math.round(y)}; the press went through`);
			return this.forward(message);
		}
		return this.holdAction(message, decision.action);
	}

	// --- the questions -------------------------------------------------------------

	private question(kind: GateQuestion["kind"], action: string, extra: { field?: string; tab?: string } = {}): GateQuestion {
		return { id: randomUUID(), kind, action, ...(extra.field ? { field: extra.field } : {}), ...(extra.tab ? { tab: extra.tab } : {}) };
	}

	/**
	 * Ask, and wait. The answer arrives from outside this package, so the only thing it can do
	 * with a question nobody answers is refuse it — a gate that opened on a timeout would be a
	 * gate that opens on its own.
	 */
	private ask<T>(question: GateQuestion, answer: () => Promise<T>, refused: T): Promise<T> {
		return new Promise<T>((resolve) => {
			const timer = setTimeout(() => resolve(refused), this.timeoutMs);
			timer.unref?.();
			answer().then(
				(value) => {
					clearTimeout(timer);
					resolve(value);
				},
				() => {
					clearTimeout(timer);
					resolve(refused);
				},
			);
		});
	}

	/** The page's own title, for a question somebody has to read. */
	private async tab(message: CdpMessage): Promise<string | undefined> {
		const value = await this.probe(message, "document.title");
		return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : undefined;
	}

	/** What the field the agent was about to type into is called. */
	private async field(message: CdpMessage): Promise<string> {
		const value = await this.probe(message, fieldProbe());
		return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : "a field";
	}

	// --- the sockets ---------------------------------------------------------------

	/** One question to the page, answered by the same session the agent is driving. */
	private probe(message: CdpMessage, expression: string): Promise<unknown> {
		const upstream = this.upstream;
		if (!upstream || upstream.readyState !== WebSocket.OPEN) return Promise.resolve(undefined);
		const id = this.nextProbe++;
		const payload: CdpMessage = {
			id,
			method: "Runtime.evaluate",
			params: { expression, returnByValue: true },
			...(message.sessionId ? { sessionId: message.sessionId } : {}),
		};
		return new Promise<unknown>((resolve) => {
			const timer = setTimeout(() => {
				this.probes.delete(id);
				resolve(undefined);
			}, this.probeMs);
			timer.unref?.();
			this.probes.set(id, { resolve, timer });
			upstream.send(JSON.stringify(payload));
		});
	}

	private fromUpstream(data: RawData): void {
		let message: CdpMessage;
		try {
			message = JSON.parse(data.toString()) as CdpMessage;
		} catch {
			return;
		}
		// A probe is the gate's own question, so its answer belongs here and not to the agent.
		if (message.id !== undefined && message.id >= PROBE_BASE) {
			const probe = this.probes.get(message.id);
			if (!probe) return;
			this.probes.delete(message.id);
			clearTimeout(probe.timer);
			const result = message.result as { result?: { value?: unknown } } | undefined;
			probe.resolve(message.error ? undefined : result?.result?.value);
			return;
		}
		this.toClient(message);
	}

	private forward(message: CdpMessage): void {
		const upstream = this.upstream;
		if (!upstream || upstream.readyState !== WebSocket.OPEN) return this.refuse(message, "the browser is not connected");
		upstream.send(JSON.stringify(message));
	}

	/** A held command the gate did not let through: the agent is told, so its own loop learns. */
	private refuse(message: CdpMessage, why: string): void {
		this.toClient({
			...(message.id === undefined ? {} : { id: message.id }),
			...(message.sessionId ? { sessionId: message.sessionId } : {}),
			error: { code: -32000, message: why },
		});
	}

	private toClient(message: CdpMessage): void {
		if (this.client?.readyState === WebSocket.OPEN) this.client.send(JSON.stringify(message));
	}

	private event(kind: GateEvent["kind"], text: string): void {
		this.onEvent?.({ at: Date.now(), kind, text });
	}
}
