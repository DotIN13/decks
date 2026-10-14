import type { Translator } from "../../agents/translator.ts";

/**
 * OpenCode 2's event stream, read into the transcript's terms.
 *
 * The counterpart of `opencode/events.ts` for opencode 1, and the only file that reads OpenCode
 * 2's event shapes. What a transcript is belongs to `agents/translator.ts`.
 *
 * What is different from opencode 1, and shapes the code:
 *
 * - **Payloads are under `data`**, not `properties`, and the stream is still one for the whole
 *   server, so everything is filtered by `data.sessionID` here, once.
 * - **Text has no part id.** A run of text or reasoning is named by its assistant message and an
 *   `ordinal`, and `*.ended` repeats the whole run; only what the deltas missed is said again.
 * - **A tool call is a sequence of events**, not one part that changes status:
 *   `tool.input.started` (the only one with the tool's name), `tool.called` (the input),
 *   then `tool.success` or `tool.failed`.
 * - **The prompt is not echoed back as text.** It arrives as `session.inbox.*`, so there is no
 *   user message to filter out.
 * - **A turn ends with `session.execution.succeeded`, `failed` or `interrupted`.** There is no
 *   `session.idle`. But not every execution is a turn: moving a session to another folder runs
 *   as an execution of its own, with no model step in it, and that one ends nothing.
 */
export interface Opencode2StreamHooks {
	/** The turn ended, however it ended. */
	ended(outcome: "succeeded" | "failed" | "interrupted"): void;
	/**
	 * A reading: the context in use after a step (`context`), or the session's cost so far
	 * (`cost`). Each event carries one of them; the other is left out, not zeroed.
	 */
	usage(reading: { context?: number | null; cost?: number }): void;
	/** Which model and level actually answered. */
	model(provider: string, model: string, variant: string | undefined): void;
	/** OpenCode 2 is asking before acting, and waits until it is answered. */
	permission(id: string, action: string, message: string | undefined): void;
}

interface Tokens {
	input?: number;
	output?: number;
	reasoning?: number;
	cache?: { read?: number; write?: number };
}

export class Opencode2Stream {
	/** Characters already said, per run of text, so the closing event is not a repeat. */
	private said = new Map<string, number>();
	/** Tool names, by call id, from the one event that carries them. */
	private names = new Map<string, string>();
	/** Tool calls that are open, with when they opened. */
	private open = new Map<string, number>();
	private replying = false;
	/** An error was already said this turn: a failed step is followed by a failed execution. */
	private errored = false;
	/** What the running execution has done: a model step, or a move of the session. */
	private stepped = false;
	private moved = false;

	constructor(
		private readonly t: Translator,
		private readonly sessionId: string,
		private readonly hooks: Opencode2StreamHooks,
	) {}

	handle(raw: unknown): void {
		const event = raw as { type?: string; data?: Record<string, unknown> };
		const data = event.data ?? {};
		// Only this chat's: everything a chat says carries its session id, and what does not is
		// the server talking about itself (plugins, catalogues, the project).
		if (data.sessionID !== this.sessionId) return;

		switch (event.type) {
			case "session.text.delta":
				return this.say(data, "text");
			case "session.reasoning.delta":
				return this.say(data, "reasoning");
			case "session.text.ended":
				return this.close(data, "text");
			case "session.reasoning.ended":
				return this.close(data, "reasoning");
			case "session.tool.input.started":
				if (typeof data.id === "string" && typeof data.name === "string") this.names.set(data.id, data.name);
				return;
			case "session.tool.called":
				return this.called(data);
			case "session.tool.success":
				return this.toolEnded(data.id, text(data.content), false, images(data.content));
			case "session.tool.failed":
				return this.toolEnded(data.id, (data.error as { message?: string } | undefined)?.message ?? "failed", true);
			case "session.execution.started":
				this.stepped = false;
				this.moved = false;
				return;
			case "session.moved":
				this.moved = true;
				return;
			case "session.step.started": {
				this.stepped = true;
				const model = data.model as { id?: string; providerID?: string; variant?: string } | undefined;
				if (model?.id && model.providerID) this.hooks.model(model.providerID, model.id, model.variant);
				return;
			}
			// A step's tokens are the size of that request, which is the context in use. The
			// session's running totals are not, so from those only the cost is read.
			case "session.step.ended":
				return this.hooks.usage({ context: contextOf(data.tokens as Tokens | undefined) });
			case "session.usage.updated":
				return typeof data.cost === "number" ? this.hooks.usage({ cost: data.cost }) : undefined;
			case "session.step.failed":
				return this.failed(data.error);
			case "session.retry.scheduled": {
				const error = data.error as { message?: string } | undefined;
				return this.t.notice("warn", `Retrying${error?.message ? `: ${error.message}` : ""}`);
			}
			case "permission.asked":
				if (typeof data.id === "string" && typeof data.action === "string") {
					this.hooks.permission(data.id, data.action, typeof data.message === "string" ? data.message : undefined);
				}
				return;
			case "session.execution.succeeded":
				// A move that ran as its own execution: the agent's turn, if any, is still ahead.
				if (this.moved && !this.stepped) return;
				return this.finish("succeeded");
			case "session.execution.failed":
				if (!this.errored) this.failed(data.error);
				return this.finish("failed");
			case "session.execution.interrupted":
				return this.finish("interrupted");
			default:
				return;
		}
	}

	private key(data: Record<string, unknown>, kind: string): string {
		return `${String(data.assistantMessageID)}/${kind}/${String(data.ordinal ?? 0)}`;
	}

	private say(data: Record<string, unknown>, kind: "text" | "reasoning"): void {
		const delta = data.delta;
		if (typeof delta !== "string" || !delta) return;
		const key = this.key(data, kind);
		this.said.set(key, (this.said.get(key) ?? 0) + delta.length);
		this.replying = true;
		if (kind === "reasoning") this.t.thinking(delta);
		else this.t.delta(delta);
	}

	/** The whole run, at its end: only what the deltas did not already say. */
	private close(data: Record<string, unknown>, kind: "text" | "reasoning"): void {
		const whole = typeof data.text === "string" ? data.text : "";
		const key = this.key(data, kind);
		const already = this.said.get(key) ?? 0;
		if (whole.length <= already) return;
		this.said.set(key, whole.length);
		this.replying = true;
		const rest = whole.slice(already);
		if (kind === "reasoning") this.t.thinking(rest);
		else this.t.delta(rest);
	}

	private called(data: Record<string, unknown>): void {
		const id = data.id;
		if (typeof id !== "string" || this.open.has(id)) return;
		const name = this.names.get(id) ?? "tool";
		this.open.set(id, Date.now());
		// A reply and a tool call are two things in the column: the bubble closes first.
		this.t.endAssistant();
		this.replying = false;
		this.t.toolStart(id, name, name, data.input ?? {});
	}

	/** `images` is how many pictures the result carried, which the chip counts; never a duration. */
	private toolEnded(id: unknown, output: string, isError: boolean, images = 0): void {
		if (typeof id !== "string") return;
		const opened = this.open.get(id);
		// A result for a call that never opened (it failed while its input was still arriving)
		// still gets its chip, so the failure is visible.
		if (opened === undefined) this.called({ id, input: {} });
		this.open.delete(id);
		this.t.toolEnd(id, output, isError, images);
	}

	private failed(error: unknown): void {
		const message = (error as { message?: string } | undefined)?.message ?? "OpenCode 2 reported an error";
		this.t.endAssistant();
		this.replying = false;
		this.errored = true;
		this.t.notice("error", message);
	}

	private finish(outcome: "succeeded" | "failed" | "interrupted"): void {
		if (this.replying) this.t.endAssistant();
		this.replying = false;
		// Calls left open by an interrupted turn are closed rather than left spinning.
		for (const id of [...this.open.keys()]) this.toolEnded(id, "Interrupted", true);
		this.said.clear();
		this.names.clear();
		this.errored = false;
		this.t.setState("idle");
		this.hooks.ended(outcome);
	}
}

/** A tool's result as one string: its text parts, joined. */
function text(content: unknown): string {
	if (!Array.isArray(content)) return typeof content === "string" ? content : "";
	return content
		.map((part) => (part && typeof part === "object" && (part as { type?: string }).type === "text" ? String((part as { text?: unknown }).text ?? "") : ""))
		.filter(Boolean)
		.join("\n");
}

/** The pictures in a tool's result: an image part, or any part whose media type is an image. */
function images(content: unknown): number {
	if (!Array.isArray(content)) return 0;
	return content.filter((part) => {
		if (!part || typeof part !== "object") return false;
		const { type, mime, mediaType } = part as { type?: string; mime?: string; mediaType?: string };
		return type === "image" || /^image\//.test(mime ?? mediaType ?? "");
	}).length;
}

/** Tokens in the model's context after a step: what it read, including the cache, and wrote. */
function contextOf(tokens: Tokens | undefined): number | null {
	if (!tokens) return null;
	const used = (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
	return used > 0 ? used : null;
}
