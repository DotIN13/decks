// The extension's wire: numbered commands down, answers and Chrome's events up.
// Rule 1 of the README. Knows nothing of tabs or calls.

import type { Peer } from "../kernel/types.ts";

/** A text line both ways: the kernel's Peer. */
export type Line = Peer;

type Waiting = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type Frame = { id?: number; method?: string; params?: unknown[]; result?: unknown; error?: unknown };

export const PING_MS = 20_000;
const ANSWER_MS = 30_000;

/** One extension's end of the line. */
export class ExtensionLine {
	private readonly waiting = new Map<number, Waiting>();
	private last = 0;
	private ended: string | undefined;
	private readonly ping: ReturnType<typeof setInterval>;
	onEvent?: (method: string, params: unknown[]) => void;
	onEnd?: (reason: string) => void;

	constructor(private readonly line: Line, pingMs = PING_MS) {
		line.onText((text) => this.receive(text));
		line.onClose(() => this.end("the extension disconnected"));
		this.ping = setInterval(() => void this.send("decks.ping", []).catch(() => {}), pingMs);
		this.ping.unref?.();
	}

	get open(): boolean {
		return this.ended === undefined;
	}

	/** Send a command and wait for its answer; an error answer rejects with its words. */
	send(method: string, params: unknown[], waitMs = ANSWER_MS): Promise<unknown> {
		if (this.ended) return Promise.reject(new Error(`The extension is gone: ${this.ended}.`));
		const id = ++this.last;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiting.delete(id);
				reject(new Error(`The extension did not answer ${method} in ${Math.round(waitMs / 1000)} s.`));
			}, waitMs);
			timer.unref?.();
			this.waiting.set(id, { resolve, reject, timer });
			this.line.send(JSON.stringify({ id, method, params }));
		});
	}

	/** Close the line; the reason is what the extension shows. */
	close(reason: string): void {
		if (this.ended) return;
		this.line.close(1000, reason);
		this.end(reason);
	}

	private receive(text: string): void {
		let frame: Frame;
		try {
			frame = JSON.parse(text) as Frame;
		} catch {
			return this.close("malformed JSON");
		}
		const waiting = frame.id !== undefined ? this.waiting.get(frame.id) : undefined;
		if (waiting && frame.id !== undefined) {
			this.waiting.delete(frame.id);
			clearTimeout(waiting.timer);
			if (frame.error !== undefined) waiting.reject(new Error(errorText(frame.error)));
			else waiting.resolve(frame.result);
			return;
		}
		if (typeof frame.method === "string") this.onEvent?.(frame.method, Array.isArray(frame.params) ? frame.params : []);
	}

	private end(reason: string): void {
		if (this.ended) return;
		this.ended = reason;
		clearInterval(this.ping);
		for (const one of this.waiting.values()) {
			clearTimeout(one.timer);
			one.reject(new Error(`The extension is gone: ${reason}.`));
		}
		this.waiting.clear();
		this.onEnd?.(reason);
	}
}

function errorText(error: unknown): string {
	if (typeof error === "string") return error;
	if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
	return "The extension answered with an error.";
}
