import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { titleFor, type Translator } from "../agents/translator.ts";

/**
 * Claude's message stream, read into the transcript's terms.
 *
 * The counterpart of `pi/events.ts`, and the only file that reads the SDK's shapes. What a
 * transcript *is* belongs to `agents/translator.ts` and is shared.
 *
 * Two differences from Pi's stream shape the code:
 *
 * **Tool results arrive as user messages.** Claude replays a tool's result as a
 * `tool_result` block on a user-role message, so a call and its result are two frames of
 * different types tied by `tool_use_id` rather than a matched pair of events.
 *
 * **Assistant text arrives twice.** With `includePartialMessages` the deltas come as
 * `stream_event` frames *and* the finished text comes as an `assistant` message. Taking
 * both would double every reply, so the streamed path is authoritative and a complete
 * assistant message only fills in text that was never streamed — which is what happens on
 * a turn that produced no stream events at all.
 */

export interface ClaudeStreamState {
	/** Whether the current assistant message has had any streamed text. */
	streamed: boolean;
	/** Tool calls seen this turn, so a result can be matched to its name. */
	tools: Map<string, string>;
}

export function newStreamState(): ClaudeStreamState {
	return { streamed: false, tools: new Map() };
}

export function handleClaudeMessage(t: Translator, state: ClaudeStreamState, message: SDKMessage): void {
	switch (message.type) {
		case "system": {
			// `init` is the session announcing itself; nothing to show, and the backend
			// reads what it needs off the same frame. Compaction is a system frame too,
			// rather than a type of its own.
			if (message.subtype === "init") t.setState("thinking");
			else if (message.subtype === "compact_boundary") t.notice("info", "Compacted the conversation.");
			return;
		}

		case "stream_event": {
			const event = message.event as {
				type?: string;
				delta?: { type?: string; text?: string; thinking?: string };
				content_block?: { type?: string };
			};
			if (event.type === "message_start") {
				t.startAssistant();
				state.streamed = false;
				return;
			}
			if (event.type === "content_block_delta") {
				const delta = event.delta;
				if (delta?.type === "text_delta" && delta.text) {
					t.delta(delta.text);
					state.streamed = true;
				} else if (delta?.type === "thinking_delta" && delta.thinking) {
					t.thinking(delta.thinking);
				}
				return;
			}
			return;
		}

		case "assistant": {
			const content = (message.message as { content?: unknown }).content;
			if (!Array.isArray(content)) return;

			for (const block of content) {
				const part = block as { type?: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown };
				if (part.type === "text") {
					// Only if nothing streamed: otherwise this is the same text again.
					if (!state.streamed && part.text) {
						t.startAssistant();
						t.delta(part.text);
					}
				} else if (part.type === "thinking") {
					if (!state.streamed && part.thinking) t.thinking(part.thinking);
				} else if (part.type === "tool_use" && part.id && part.name) {
					// A tool call ends the visible reply that preceded it, the way Pi's
					// `tool_execution_start` does.
					t.endAssistant();
					state.streamed = false;
					state.tools.set(part.id, part.name);
					t.toolStart(part.id, part.name, titleFor(part.name, part.input), part.input);
				}
			}
			return;
		}

		case "user": {
			// A replayed tool result, which is how the SDK reports one.
			const content = (message.message as { content?: unknown }).content;
			if (!Array.isArray(content)) return;
			for (const block of content) {
				const part = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
				if (part.type !== "tool_result" || !part.tool_use_id) continue;
				const { text, images } = readClaudeToolResult(part.content);
				t.toolEnd(part.tool_use_id, text, Boolean(part.is_error), images);
				state.tools.delete(part.tool_use_id);
				// Back to thinking rather than idle: the tool finished, the turn has not.
				t.setState("thinking");
			}
			return;
		}

		case "result": {
			t.endAssistant();
			t.setState("idle");
			const result = message as { subtype?: string; is_error?: boolean; result?: unknown };
			if (result.subtype && result.subtype !== "success") {
				const detail = typeof result.result === "string" && result.result.trim() ? `: ${result.result.trim()}` : "";
				t.notice("error", `The turn ended as ${result.subtype}${detail}`);
			}
			return;
		}

		default:
			return;
	}
}

/**
 * The text and images in a tool result.
 *
 * Separate from the translator's `readToolResult` because the shapes differ: Pi hands back
 * a result object with a `content` array, while a `tool_result` block's `content` is either
 * that array or a bare string.
 */
export function readClaudeToolResult(content: unknown): { text: string; images: number } {
	if (typeof content === "string") return { text: content, images: 0 };
	if (!Array.isArray(content)) return { text: "", images: 0 };
	let text = "";
	let images = 0;
	for (const part of content) {
		const kind = (part as { type?: string })?.type;
		if (kind === "text") text += String((part as { text?: unknown }).text ?? "");
		else if (kind === "image") images += 1;
	}
	return { text, images };
}
