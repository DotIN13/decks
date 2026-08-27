import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { readToolResult, titleFor, type Translator } from "../agents/translator.ts";

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
			t.notice("info", "Compacting the conversation…");
			return;

		case "compaction_end":
			if (event.aborted) t.notice("warn", "Compaction was cancelled.");
			else if (event.errorMessage) t.notice("error", `Compaction failed: ${event.errorMessage}`);
			return;

		case "auto_retry_start":
			t.notice("warn", `${event.errorMessage} — retrying (${event.attempt}/${event.maxAttempts}).`);
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
