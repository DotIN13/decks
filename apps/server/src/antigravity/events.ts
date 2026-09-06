import type { AgentUsage } from "@decks/protocol";
import type { Translator } from "../agents/translator.ts";

/**
 * The `agy` stream, read into the transcript's terms.
 *
 * The counterpart of `pi/events.ts`, `claude/events.ts` and `opencode/events.ts`, and the
 * only file that reads agy's shapes. What a transcript *is* belongs to
 * `agents/translator.ts` and is shared.
 *
 * The stream is one NDJSON line per event. Four things about it shape the code, each
 * learned from a live session rather than from a spec page:
 *
 * **`init` arrives with the first turn, not at spawn.** The CLI is a lazy process: it
 * says what it is running (model, workspace, permission posture) only once there is a
 * prompt to run. So the backend never waits for it at start; the conversation id it
 * carries is what `--conversation` resumes later.
 *
 * **Text arrives as `step_update` deltas.** An `agent_response` step goes `ACTIVE` with
 * one or more `text_delta` fragments, then `DONE` with any tail it had not carried (a
 * trailing newline, most often). Both states can carry deltas, so the delta is
 * authoritative and the step's `DONE` is where usage arrives, not where text does.
 *
 * **A tool call is two steps with one identity.** `step_type: "tool"` appears `ACTIVE`
 * (parameters, no result) then `DONE` or `ERROR` (result) at the same `step_index` —
 * there is no separate call and result frame. The parameters come back under
 * `tool_info.parameters` and the result under `tool_info.output` or `tool_info.error`.
 *
 * **The turn ends with exactly one `result`.** `response` is the turn's final text,
 * which the deltas already said, so it is *not* emitted again; `status`, `error` and
 * `usage` are the news. A permission soft-deny (a tool the CLI could not ask about)
 * comes back as `denied_actions` on the result.
 */
export interface AntigravityStep {
	step_index?: number;
	state?: string;
	step_type?: string;
	text_delta?: string;
	tool_name?: string;
	tool_info?: {
		name?: string;
		parameters?: unknown;
		output?: string;
		error?: { type?: string; message?: string };
	};
}

export interface AntigravityResult {
	status?: string;
	response?: string;
	error?: string;
	usage?: Record<string, unknown>;
	denied_actions?: Array<{ action?: string; display_name?: string }>;
	conversation_id?: string;
}

export class AntigravityStream {
	/** Tool steps this turn has opened, keyed by `step_index`, so `DONE` closes the one it belongs to. */
	private tools = new Set<number>();
	private replying = false;
	private conversational = false;

	constructor(
		private readonly t: Translator,
		private readonly hooks: {
			/** A turn ended: usage for the ring, and whether it ended cleanly. */
			idle(usage: AgentUsage, status: string): void;
			/** The conversation exists now — what `--conversation` can resume. */
			conversation(id: string): void;
		},
	) {}

	init(payload: { conversation_id?: string } | undefined): void {
		if (payload?.conversation_id) this.hooks.conversation(payload.conversation_id);
	}

	step(step: AntigravityStep | undefined): void {
		if (!step || typeof step.step_type !== "string") return;
		switch (step.step_type) {
			case "user_input":
				// The CLI echoes the prompt back. The transcript already has it — the shell
				// wrote it when the user pressed enter — and saying it again in the
				// assistant's stream would be the user hearing themselves.
				return;
			case "agent_response":
				return this.reply(step);
			case "tool":
				return this.tool(step);
			default:
				// `checkpoint`, `thought`, and whatever a newer CLI adds: nothing in the
				// column yet, and a stream that ignores it is safer than one that chokes.
				return;
		}
	}

	private reply(step: AntigravityStep): void {
		const delta = step.text_delta;
		if (!delta) return;
		this.replying = true;
		this.t.delta(delta);
	}

	private tool(step: AntigravityStep): void {
		const index = step.step_index;
		if (index === undefined) return;
		const name = step.tool_info?.name ?? step.tool_name ?? "tool";
		if (step.state === "ACTIVE") {
			if (this.tools.has(index)) return;
			this.tools.add(index);
			// A reply and a tool call are two things in the column, so the bubble closes
			// before the chip opens — the order every other adapter keeps.
			if (this.replying) this.t.endAssistant();
			this.replying = false;
			const parameters = (step.tool_info?.parameters ?? {}) as Record<string, unknown>;
			// The CLI's one lever is `call_mcp_tool`, so the chip names the tool *inside*
			// it — `call_mcp_tool · stage_eval` — or the model would read every canvas call
			// as the same mystery lever.
			const inside = step.tool_name === "call_mcp_tool" && typeof parameters.ToolName === "string" ? `call_mcp_tool · ${parameters.ToolName}` : name;
			this.t.toolStart(String(index), name, inside, parameters);
			return;
		}
		if (!this.tools.has(index)) return;
		this.tools.delete(index);
		const error = step.tool_info?.error;
		this.t.toolEnd(String(index), error?.message ?? step.tool_info?.output ?? "", Boolean(error), 0);
	}

	result(result: AntigravityResult | undefined): void {
		if (!result) return;
		const status = result.status ?? "";
		if (status === "ERROR") {
			// The CLI's own refusal — an unknown model, a conversation it cannot resume —
			// is one sentence, and it is the turn's only news.
			if (this.replying) this.t.endAssistant();
			this.replying = false;
			this.t.notice("error", result.error ?? "antigravity reported an error");
		}
		const denied = result.denied_actions;
		if (denied && denied.length > 0) {
			const names = denied
				.map((action) => action.display_name ?? action.action)
				.filter((name): name is string => Boolean(name))
				.join(", ");
			this.t.notice("warn", `Antigravity could not ask about ${names}; what could not run was declined.`);
		}
		if (this.replying) this.t.endAssistant();
		this.replying = false;
		this.tools.clear();
		this.t.setState("idle");
		this.hooks.idle(usageOf(result.usage), status);
	}
}

/**
 * The CLI's cumulative counters, into the three numbers the ring draws.
 *
 * `contextWindow` is deliberately 0 rather than a guess: agy reports what a session has
 * used and not what the model will take, and a made-up ceiling would draw a ring that
 * means nothing. A window of 0 is what the composer reads as "unknown", which is true.
 */
function usageOf(usage: Record<string, unknown> | undefined): AgentUsage {
	if (!usage) return { contextTokens: null, contextWindow: 0, cost: 0 };
	const total = (usage.total_tokens as number | undefined) ?? 0;
	return { contextTokens: total > 0 ? total : null, contextWindow: 0, cost: 0 };
}