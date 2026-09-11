import type { AgentUsage } from "@decks/protocol";
import type { Translator } from "../agents/translator.ts";

/**
 * opencode's event stream, read into the transcript's terms.
 *
 * The counterpart of `pi/events.ts` and `claude/events.ts`, and the only file that reads
 * opencode's shapes. What a transcript *is* belongs to `agents/translator.ts` and is
 * shared — a fourth runtime must not become a fourth idea of what a reply looks like.
 *
 * Three things about this stream shape the code.
 *
 * **It is one stream for the whole server, not for one session.** Everything is tagged
 * with a `sessionID` and the server may hold more than one; a class rather than a function
 * so the filter is stated once, in the constructor, instead of at every branch.
 *
 * **Text arrives twice.** `message.part.delta` carries the increment and
 * `message.part.updated` carries the whole part again. Taking both would double every
 * reply, so the delta is authoritative and the finished part only fills in text that was
 * never streamed — which is what happens on a turn short enough to arrive in one piece.
 *
 * **A tool call is one part that changes status.** `pending` → `running` → `completed` or
 * `error`, each arriving as another `message.part.updated` for the same `callID`, so the
 * transitions are what to watch rather than distinct call and result frames.
 */
export class OpencodeStream {
	/** Text already delivered as deltas, by part id, so the finished part is not a repeat. */
	private streamed = new Map<string, number>();
	/**
	 * Which messages are the user's.
	 *
	 * opencode publishes the prompt back as parts of a user message, on the same stream and
	 * in the same shape as the reply — so without this the transcript opened every turn by
	 * saying the user's own words back to them in the assistant's voice. Learned from
	 * `message.updated`, which always arrives before the parts it is about.
	 */
	private mine = new Set<string>();
	/** Tool calls this stream has opened, so `completed` closes the one it belongs to. */
	private tools = new Set<string>();
	private replying = false;

	constructor(
		private readonly t: Translator,
		private readonly sessionId: string,
		private readonly hooks: {
			/** The turn ended. */
			idle(): void;
			usage(usage: AgentUsage): void;
			/** Which model actually answered, which is not always the one that was asked for. */
			model(provider: string, model: string): void;
			/**
			 * opencode is asking before acting, and will not act until it is answered. The
			 * answer belongs to the backend because only it knows the agent's mode; this
			 * stream only reports that a request arrived, and which one.
			 */
			permission(id: string, asked: string, title: string | undefined): void;
		},
	) {}

	handle(raw: unknown): void {
		const event = raw as { type?: string; properties?: Record<string, unknown> };
		const properties = event.properties ?? {};
		// Everything worth reading is tagged with a session; the rest is the server talking
		// about itself — plugins loading, catalogues refreshing — and is not this chat's.
		const session = properties.sessionID as string | undefined;
		if (session !== undefined && session !== this.sessionId) return;

		switch (event.type) {
			case "message.part.delta":
				return this.delta(properties as { partID?: string; field?: string; delta?: string });
			case "message.part.updated":
				return this.part(properties.part as Record<string, unknown> | undefined);
			case "message.updated":
				return this.message(properties.info as Record<string, unknown> | undefined);
			case "session.error":
				return this.error(properties.error);
			case "permission.updated":
				// opencode blocks the tool call until the request is answered, so this must
				// reach the backend rather than end as a notice — a request that is only
				// noticed is a request that hangs. The kind is `type` on this event, with
				// `permission` read as a fallback for the shape the newer API speaks.
				return this.asked(
					properties.id as string | undefined,
					(properties.type as string | undefined) ?? (properties.permission as string | undefined),
					properties.title as string | undefined,
				);
			case "session.idle":
				return this.finish();
			default:
				return;
		}
	}

	/**
	 * A permission request, handed on only when it names something to answer.
	 *
	 * A frame with no id cannot be replied to — opencode would be left waiting on a request
	 * that names nothing — so it is dropped rather than passed on as an unanswerable ask.
	 */
	private asked(id: string | undefined, kind: string | undefined, title: string | undefined): void {
		if (!id || !kind) return;
		this.hooks.permission(id, kind, title);
	}

	private delta(properties: { partID?: string; field?: string; delta?: string; messageID?: string }): void {
		const text = properties.delta;
		if (!text) return;
		if (properties.messageID && this.mine.has(properties.messageID)) return;
		const key = properties.partID ?? "";
		this.streamed.set(key, (this.streamed.get(key) ?? 0) + text.length);
		this.replying = true;
		if (properties.field === "reasoning") this.t.thinking(text);
		else this.t.delta(text);
	}

	private part(part: Record<string, unknown> | undefined): void {
		if (!part) return;
		// The prompt, coming back. Not the assistant talking, whatever it looks like.
		if (this.mine.has(part.messageID as string)) return;
		const type = part.type as string | undefined;
		if (type === "text" || type === "reasoning") {
			// A synthetic part is opencode's own scaffolding — a summary, a continuation
			// marker — and belongs in the transcript no more than the prompt echo does.
			if (part.synthetic === true || part.ignored === true) return;
			/*
			 * Only what the deltas missed. A part that streamed is already in the transcript
			 * character by character; a part that did not — a short reply, a synthetic one —
			 * arrives whole and here is where it gets said.
			 */
			const already = this.streamed.get(part.id as string) ?? 0;
			const whole = (part.text as string | undefined) ?? "";
			if (whole.length <= already) return;
			const rest = whole.slice(already);
			this.streamed.set(part.id as string, whole.length);
			this.replying = true;
			if (type === "reasoning") this.t.thinking(rest);
			else this.t.delta(rest);
			return;
		}
		if (type !== "tool") return;
		const callId = (part.callID as string | undefined) ?? (part.id as string);
		const name = (part.tool as string | undefined) ?? "tool";
		const state = (part.state ?? {}) as { status?: string; input?: unknown; title?: string; output?: string; error?: string };
		if (state.status === "running" || state.status === "pending") {
			if (this.tools.has(callId)) return;
			this.tools.add(callId);
			// A reply and a tool call are two things in the column, so the bubble is closed
			// before the chip opens — the same order `claude/events.ts` keeps.
			this.t.endAssistant();
			this.replying = false;
			this.t.toolStart(callId, name, state.title ?? name, state.input ?? {});
			return;
		}
		if (state.status === "completed") {
			this.tools.add(callId);
			this.t.toolEnd(callId, state.output ?? "", false, 0);
			return;
		}
		if (state.status === "error") {
			this.tools.add(callId);
			this.t.toolEnd(callId, state.error ?? "failed", true, 0);
		}
	}

	private message(info: Record<string, unknown> | undefined): void {
		if (!info) return;
		if (info.role === "user") {
			this.mine.add(info.id as string);
			return;
		}
		if (info.role !== "assistant") return;
		const model = info.modelID as string | undefined;
		const provider = info.providerID as string | undefined;
		if (model && provider) this.hooks.model(provider, model);
		const tokens = info.tokens as { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } | undefined;
		if (!tokens) return;
		const used = (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
		this.hooks.usage({
			contextTokens: used > 0 ? used : null,
			// opencode does not publish the window with the message; the picker's catalogue
			// has it, and a nought here would draw a full ring rather than an unknown one.
			contextWindow: 0,
			cost: (info.cost as number | undefined) ?? 0,
		});
	}

	private error(error: unknown): void {
		const named = error as { name?: string; data?: { message?: string } } | undefined;
		const message = named?.data?.message ?? named?.name ?? "opencode reported an error";
		this.t.endAssistant();
		this.replying = false;
		this.t.notice("error", message);
	}

	private finish(): void {
		if (this.replying) this.t.endAssistant();
		this.replying = false;
		this.streamed.clear();
		this.tools.clear();
		// `mine` deliberately survives the turn: a browser reconnecting mid-conversation
		// replays old parts, and a user message whose role has been forgotten reads as the
		// assistant again.
		this.t.setState("idle");
		this.hooks.idle();
	}
}
