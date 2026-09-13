/** One item in a conversation — what a turn looks like once it is on the wire. */
export type ChatItem =
	| { kind: "user"; id: string; text: string; at: number; entryId?: string }
	| { kind: "assistant"; id: string; text: string; at: number; thinking?: string; streaming?: boolean }
	/**
	 * A tool call. `args` stays on the server: the browser has never read them — the chip's
	 * `title` is what they are for — and they were half of what a greeting weighed. `result`
	 * travels as a preview when it is long, and `full` is then how long the whole of it is;
	 * opening the chip asks for the rest with `chat.tool` (`agents/wire.ts`).
	 */
	| { kind: "tool"; id: string; name: string; title: string; args?: unknown; result?: string; full?: number; images?: number; state: "running" | "done" | "error" }
	| { kind: "notice"; id: string; level: "info" | "warn" | "error"; text: string; at: number };

/** The tool's own rendering hint: how the chip reads before you expand it. */
export interface ToolSummary {
	name: string;
	title: string;
}
