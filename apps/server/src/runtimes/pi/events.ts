import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { readToolResult, titleFor, type Translator } from "../../agents/translator.ts";

/**
 * Pi's event stream, read into the transcript's terms.
 *
 * Only the *reading* of Pi's shapes lives here. What a transcript is belongs to
 * `agents/translator.ts` and would be shared by any other agent backend.
 */
export function handlePiEvent(t: Translator, event: AgentSessionEvent): void {
	switch (event.type) {
		case "agent_start":
			t.setState("thinking");
			return;

		case "message_start": {
			if ((event.message as { role?: string }).role !== "assistant") return;
			t.startAssistant();
			return;
		}

		case "message_update": {
			const inner = event.assistantMessageEvent;
			if (inner.type === "text_delta") t.delta(inner.delta);
			else if (inner.type === "thinking_delta") t.thinking(inner.delta);
			return;
		}

		case "message_end": {
			const message = event.message as {
				role?: string;
				stopReason?: string;
				errorMessage?: string;
				customType?: string;
				content?: unknown;
				display?: boolean;
			};

			/*
			 * An extension reporting something with `pi.sendMessage({ display: true })`
			 * arrives as a message with role "custom". The TUI draws these through a
			 * registered renderer; here they are a notice in the column, which is the
			 * nearest honest thing and better than dropping them.
			 */
			if (message.role === "custom") {
				if (message.display !== true) return;
				const text = flatten(message.content);
				if (text.trim()) {
					t.endAssistant();
					t.notice("info", text.trim());
				}
				return;
			}

			if (message.role !== "assistant") return;
			t.endAssistant();
			if (message.stopReason === "error" && message.errorMessage) t.notice("error", message.errorMessage);
			return;
		}

		case "tool_execution_start":
			t.toolStart(event.toolCallId, event.toolName, titleFor(event.toolName, event.args), event.args);
			return;

		case "tool_execution_update": {
			const { text } = readToolResult(event.partialResult);
			if (text) t.toolUpdate(event.toolCallId, text);
			return;
		}

		case "tool_execution_end": {
			const { text, images } = readToolResult(event.result);
			t.toolEnd(event.toolCallId, text, event.isError, images);
			// Back to thinking rather than idle: the tool finished, the turn has not.
			t.setState("thinking");
			return;
		}

		case "agent_end":
		case "agent_settled":
			t.endAssistant();
			t.setState("idle");
			return;

		case "compaction_start":
			/*
			 * A compaction is **work with no agent run behind it**: Pi emits no `agent_start` and
			 * no `agent_end` for one, so this event is the only chance to say the agent is busy.
			 * The reason it matters is not the spinner on the row — nothing may be submitted
			 * while a compaction is in progress ("Cannot submit a prompt while compaction is in
			 * progress"), so an agent that looks idle here is an agent a queue will hand work to
			 * and Pi will refuse.
			 */
			t.setState("thinking");
			t.notice("info", "Compacting the conversation…");
			return;

		case "compaction_end":
			if (event.aborted) t.notice("warn", "Compaction was cancelled.");
			else if (event.errorMessage) t.notice("error", `Compaction failed: ${event.errorMessage}`);
			/*
			 * Said out loud, and the same words Claude's boundary gets: this is the end of the
			 * one operation whose only other trace is the usage reading dropping. Without it the
			 * transcript says "Compacting the conversation…" and then, as far as anyone reading
			 * can tell, never stops — which is the half of "the compact never ends" that is not
			 * about the state.
			 */
			else t.notice("info", "Compacted the conversation.");
			/*
			 * Unless Pi is about to run the turn the compaction was for: an overflow compaction
			 * continues the turn that hit the wall (`willRetry`), and taking the state down there
			 * would say idle for the moment before the turn resumes.
			 */
			if (!event.willRetry) t.setState("idle");
			return;

		case "auto_retry_start":
			t.notice("warn", `${event.errorMessage} Retrying (${event.attempt}/${event.maxAttempts}).`);
			return;

		default:
			return;
	}
}

/** Pi stores message content as a string or as content parts, depending on origin. */
function flatten(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : ""))
		.join("");
}
