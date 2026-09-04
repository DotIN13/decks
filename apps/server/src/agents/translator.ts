import type { AgentState, ChatItem, ServerMessage } from "@decks/protocol";

/**
 * What a transcript *is*, in one place.
 *
 * Every agent gets one of these, and nothing else decides when a reply is
 * flushed, what a tool call is called, or how a notice reads. The Pi-specific
 * half — which of Pi's events mean "the assistant started talking" — lives in
 * `pi/events.ts`, so a second agent backend would reuse this and rewrite that.
 *
 * The transcript is kept in memory as well as sent, because a browser that
 * reconnects needs the conversation back and the runtime's session file is its
 * format, not ours. It is capped at the tail; `agents/store.ts` writes that tail
 * to disk so a chat survives a restart, and `load` is how it comes back.
 */
const KEEP = 500;

export class Translator {
	private readonly items: ChatItem[] = [];
	private streaming: { id: string; text: string; thinking: string } | undefined;
	private counter = 0;

	constructor(
		readonly agentId: string,
		private readonly emit: (message: ServerMessage) => void,
		/** The deck, so a tool call on a board reads as `boards/plan.html`. */
		private readonly deckPath?: string,
		/**
		 * The transcript reached a stable shape — persist it (`agents/store.ts`).
		 *
		 * Called where an item stops changing, not on every delta: a reply arrives a token
		 * at a time and `endAssistant` is the point at which it is worth writing down. The
		 * caller debounces anyway, so this is about not generating work rather than about
		 * correctness.
		 */
		private readonly onChange?: () => void,
	) {}

	/**
	 * Put a stored transcript back.
	 *
	 * The counterpart of `history()`, for an agent restored from disk before its runtime has
	 * been started.
	 *
	 * `counter` is moved past the highest number any restored id used, rather than by the
	 * number of items. Those are not the same: ids are minted per *item created*, and an
	 * assistant turn that only called tools is spliced out again (`endAssistant`), so a
	 * transcript of three items can have consumed five numbers. Counting items would then
	 * re-mint `u4` for a message that already exists under that id, and since the browser
	 * keys on ids, the new message would land on top of the old one.
	 */
	load(items: ChatItem[]): void {
		this.items.push(...items);
		for (const item of items) {
			const used = Number(/(\d+)$/.exec(item.id)?.[1] ?? 0);
			if (used > this.counter) this.counter = used;
		}
	}

	private id(prefix: string): string {
		return `${this.agentId}:${prefix}${++this.counter}`;
	}

	private push(item: ChatItem): ChatItem {
		this.items.push(item);
		if (this.items.length > KEEP) this.items.splice(0, this.items.length - KEEP);
		this.emit({ type: "chat.item", agentId: this.agentId, item });
		this.onChange?.();
		return item;
	}

	history(): ChatItem[] {
		// A copy: the caller is about to serialise it while an agent may still be
		// appending to ours.
		return [...this.items];
	}

	/**
	 * Cut the transcript back to just before a rewound message.
	 *
	 * Pi rebuilds its own history from the session tree; this is our copy, and if it
	 * is not cut too then the column shows a conversation the agent no longer
	 * remembers having.
	 *
	 * Matched on the *text* of the user message rather than on an id, because entry
	 * ids belong to Pi's tree and transcript item ids are ours — and `navigateTree`
	 * hands back exactly that text, which is the one thing both sides agree on. With
	 * no text (an older Pi, a message with none) it cuts at the last user message,
	 * which is where a rewind almost always goes.
	 */
	truncateToUserMessage(text: string | undefined): void {
		const needle = text?.trim();
		const index = needle
			? this.items.findIndex((item) => item.kind === "user" && item.text.trim() === needle)
			: this.items.map((item) => item.kind).lastIndexOf("user");
		if (index >= 0) this.items.splice(index);
		this.onChange?.();
		this.streaming = undefined;
	}

	/** The user's messages, oldest first, for pairing with the session's entries. */
	userMessages(): Array<Extract<ChatItem, { kind: "user" }>> {
		return this.items.filter((item): item is Extract<ChatItem, { kind: "user" }> => item.kind === "user");
	}

	/** What was asked most recently, for a turn that has to be sent again. */
	lastUserText(): string | undefined {
		return this.userMessages().at(-1)?.text;
	}

	/**
	 * Whether the current turn has done anything yet.
	 *
	 * Asked before re-sending a turn that a rate limit refused (`claude/backend.ts`): a turn
	 * that had not started is safe to try again on another account, and one that had already
	 * called tools is not, because Decks agents write boards and a replayed turn could write
	 * the same one twice.
	 *
	 * "Anything" is anything after the newest user message — a tool call, or words the agent
	 * had already said. Read from the transcript rather than counted separately, because the
	 * transcript is what actually happened and a counter is a second thing to keep in step.
	 */
	turnTouchedAnything(): boolean {
		const from = this.items.map((item) => item.kind).lastIndexOf("user");
		if (from < 0) return this.items.length > 0;
		return this.items.slice(from + 1).some((item) => {
			if (item.kind === "tool") return true;
			// An assistant bubble exists with empty text between a turn starting and its first
			// token, so an empty one is not evidence that anything was said.
			return item.kind === "assistant" && item.text.trim().length > 0;
		});
	}

	/**
	 * Note which session entry a user message became.
	 *
	 * The id is what a rewind, a fork and a board restore are all addressed to, so
	 * until this happens a message has no actions on it. Re-emitted rather than quietly
	 * mutated, because the browser is holding its own copy.
	 */
	tagUser(itemId: string, entryId: string): void {
		const item = this.items.find((candidate) => candidate.id === itemId);
		if (!item || item.kind !== "user" || item.entryId === entryId) return;
		item.entryId = entryId;
		this.emit({ type: "chat.item", agentId: this.agentId, item });
		// Persisted, because this is what a restored message needs to be rewindable at all.
		this.onChange?.();
	}

	/** The last thing said, for the chat list's preview line. */
	lastLine(): { text: string; at: number } | undefined {
		for (let index = this.items.length - 1; index >= 0; index--) {
			const item = this.items[index]!;
			if (item.kind === "user" || item.kind === "assistant") {
				const text = item.text.replace(/\s+/g, " ").trim();
				if (text) return { text, at: item.at };
			}
		}
		return undefined;
	}

	/** The agent's last reply, which is what a delegating parent is waiting for. */
	lastAssistantText(): string {
		for (let index = this.items.length - 1; index >= 0; index--) {
			const item = this.items[index]!;
			if (item.kind === "assistant" && item.text.trim()) return item.text.trim();
		}
		return "";
	}

	setState(state: AgentState): void {
		this.emit({ type: "agent.state", id: this.agentId, state });
	}

	user(text: string): ChatItem {
		return this.push({ kind: "user", id: this.id("u"), text, at: Date.now() });
	}

	// --- the assistant ------------------------------------------------------------

	/**
	 * Deltas are sent as deltas and accumulated here.
	 *
	 * The browser needs the increment to render smoothly; a reconnecting browser
	 * needs the whole thing. Both come from the same accumulation, so a refresh
	 * mid-reply shows the reply so far rather than nothing.
	 */
	startAssistant(): void {
		if (this.streaming) this.endAssistant();
		const item: ChatItem = { kind: "assistant", id: this.id("a"), text: "", at: Date.now(), streaming: true };
		this.streaming = { id: item.id, text: "", thinking: "" };
		this.items.push(item);
		this.emit({ type: "chat.item", agentId: this.agentId, item });
		this.setState("streaming");
	}

	delta(text: string): void {
		if (!this.streaming) this.startAssistant();
		const active = this.streaming!;
		active.text += text;
		this.sync(active.id, { text: active.text });
		this.emit({ type: "chat.delta", agentId: this.agentId, itemId: active.id, delta: text, field: "text" });
	}

	thinking(text: string): void {
		if (!this.streaming) this.startAssistant();
		const active = this.streaming!;
		active.thinking += text;
		this.sync(active.id, { thinking: active.thinking });
		this.emit({ type: "chat.delta", agentId: this.agentId, itemId: active.id, delta: text, field: "thinking" });
	}

	endAssistant(): void {
		const active = this.streaming;
		this.streaming = undefined;
		if (!active) return;
		this.sync(active.id, { streaming: false });
		// An assistant turn that said nothing at all — it only called tools — is
		// not a bubble. Dropping it keeps the column readable.
		if (!active.text.trim() && !active.thinking.trim()) {
			const index = this.items.findIndex((item) => item.id === active.id);
			if (index !== -1) this.items.splice(index, 1);
		}
		this.emit({ type: "chat.item", agentId: this.agentId, item: this.itemOf(active.id) ?? { kind: "assistant", id: active.id, text: active.text, at: Date.now(), streaming: false } });
		this.onChange?.();
	}

	// --- tools --------------------------------------------------------------------

	toolStart(callId: string, name: string, title: string, args: unknown): void {
		title = this.deckPath ? title.split(`${this.deckPath}/`).join("") : title;
		this.push({ kind: "tool", id: `${this.agentId}:t:${callId}`, name, title, args, state: "running" });
		this.setState("tool");
	}

	toolUpdate(callId: string, text: string): void {
		this.patchTool(callId, { result: text });
	}

	toolEnd(callId: string, text: string, isError: boolean, images: number): void {
		this.patchTool(callId, { result: text, images, state: isError ? "error" : "done" });
		this.onChange?.();
	}

	notice(level: "info" | "warn" | "error", text: string): void {
		this.push({ kind: "notice", id: this.id("n"), level, text, at: Date.now() });
	}

	// --- keeping the two copies in step -------------------------------------------

	private itemOf(id: string): ChatItem | undefined {
		return this.items.find((item) => item.id === id);
	}

	private sync(id: string, patch: Partial<Extract<ChatItem, { kind: "assistant" }>>): void {
		const item = this.itemOf(id);
		if (item?.kind === "assistant") Object.assign(item, patch);
	}

	private patchTool(callId: string, patch: Partial<Extract<ChatItem, { kind: "tool" }>>): void {
		const id = `${this.agentId}:t:${callId}`;
		const item = this.itemOf(id);
		if (!item || item.kind !== "tool") return;
		Object.assign(item, patch);
		this.emit({ type: "chat.item", agentId: this.agentId, item });
	}
}

/**
 * What a tool call is *about*, in one phrase.
 *
 * The name alone says nothing — six `edit` chips in a row are six identical rows —
 * and the arguments in full are too much, so each tool contributes the one argument
 * that identifies it. The name is not repeated here: the chip prints it separately,
 * and "read read boards/plan.html" is what happens when both do it.
 *
 * Unknown tools (an extension's, an MCP server's) fall back to the first short
 * string they were given, which is right more often than not.
 */
export function titleFor(name: string, args: unknown): string {
	const a = (args ?? {}) as Record<string, unknown>;
	/*
	 * `mcp__<server>__<tool>` is one tool with a routing prefix on it, and the switch below
	 * cares about the tool.
	 *
	 * Decks' own `stage_eval` arrives as `mcp__decks__stage_eval`, matched nothing, and fell
	 * to the default — which looks for any string argument under 120 characters and finds
	 * none, because the argument is a program. So the row that says what the agent just did
	 * to your canvas was the one row in the conversation with nothing in its description.
	 */
	const tool = /^mcp__[^_]+(?:_[^_]+)*__(.+)$/.exec(name)?.[1] ?? name;
	const first = (...keys: string[]) => {
		for (const key of keys) {
			const value = a[key];
			if (typeof value === "string" && value.trim()) return value.trim();
		}
		return undefined;
	};

	switch (tool) {
		case "read":
		case "write":
		case "edit":
			return first("path", "file") ?? "";
		case "bash":
		case "powershell":
			return truncate(first("command", "cmd") ?? "", 72);
		case "grep":
			return truncate([first("pattern", "query"), first("path", "glob")].filter(Boolean).join("  "), 72);
		case "find":
		case "ls":
			return first("path", "glob", "pattern") ?? "";
		case "stage_eval":
			return truncate((first("code") ?? "").split("\n").find((line) => line.trim()) ?? "", 72);
		default: {
			const hint = Object.values(a).find((value) => typeof value === "string" && value.length < 120);
			return hint ? truncate(String(hint), 60) : "";
		}
	}
}

function truncate(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Tool results are content parts; the transcript wants text and a picture count. */
export function readToolResult(result: unknown): { text: string; images: number } {
	const content = (result as { content?: unknown })?.content;
	if (!Array.isArray(content)) return { text: typeof result === "string" ? result : "", images: 0 };
	let text = "";
	let images = 0;
	for (const part of content) {
		const kind = (part as { type?: string })?.type;
		if (kind === "text") text += String((part as { text?: unknown }).text ?? "");
		else if (kind === "image") images++;
	}
	return { text, images };
}
