import { randomUUID } from "node:crypto";
import {
	forkSession,
	getSessionMessages,
	query,
	renameSession,
	type ModelInfo,
	type Options,
	type PermissionMode,
	type Query,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentCapabilities, AgentMode, AgentModel, AgentUsage, ModelOption, ThinkingLevel } from "@decks/protocol";
import type { AgentBackend, AgentBackendContext, ConversationPoint } from "../agents/backend.ts";
import { deckContext } from "../agents/context.ts";
import { claudeAvailability, claudeExecutable } from "./available.ts";
import { handleClaudeMessage, newStreamState } from "./events.ts";
import { qualifiedToolName, stageMcpServer } from "./tools.ts";

/**
 * Claude Code behind one Decks agent (DESIGN §6.2).
 *
 * One `query()` per agent, in streaming-input mode, held open for the agent's life rather
 * than one per turn. Streaming input is what makes `interrupt()`, `setModel()`,
 * `setPermissionMode()` and `getContextUsage()` available at all; a fresh query per message
 * would re-pay process start every turn and lose every one of them. The cost is a `claude`
 * child process per started agent, which is what `dispose` closes.
 *
 * What is *not* here: the transcript (`agents/translator.ts`, shared with Pi), and the
 * canvas tool's wording (`stage/tool.ts`, likewise).
 */

/** Anthropic is the only provider behind this backend. */
const PROVIDER = "anthropic";

/** Decks' mode names, and the CLI's. */
const CLI_MODE: Record<AgentMode, PermissionMode> = {
	manual: "default",
	acceptEdits: "acceptEdits",
	plan: "plan",
	auto: "auto",
};

export const CLAUDE_CAPABILITIES: AgentCapabilities = { modes: ["manual", "acceptEdits", "plan", "auto"] };

/**
 * Boards are the medium, so edits inside the deck proceed unasked.
 *
 * A confirm per board write would make the app unusable — writing boards is what the agent
 * is *for*. Everything the CLI judges riskier than an edit still comes through
 * `canUseTool`, which Decks answers with the dialog bridge.
 */
const DEFAULT_MODE: AgentMode = "acceptEdits";

export class ClaudeBackend implements AgentBackend {
	readonly capabilities = CLAUDE_CAPABILITIES;

	private session!: Query;
	/** Messages waiting to go into the open query. */
	private queue: SDKUserMessage[] = [];
	private wake: (() => void) | undefined;
	private closed = false;
	private streaming = false;
	private pump: Promise<void> | undefined;

	private sessionId: string | undefined;
	private currentMode: AgentMode = DEFAULT_MODE;
	private currentModel: string | undefined;
	private currentThinking: ThinkingLevel | undefined;
	private available: ModelInfo[] = [];
	/** Cached, because Decks reads usage synchronously and the CLI answers async. */
	private lastUsage: AgentUsage | null = null;
	private storedName: string | undefined;
	private title: string | undefined;

	private constructor(private readonly context: AgentBackendContext) {}

	static async create(context: AgentBackendContext): Promise<ClaudeBackend> {
		const availability = claudeAvailability();
		// Checked before starting, so the failure is a sentence about Claude Code rather
		// than the SDK's message about a platform package nobody asked for.
		if (!availability.available) throw new Error(availability.reason);
		const backend = new ClaudeBackend(context);
		await backend.startQuery(context.resumeRef);
		return backend;
	}

	// --- the open query --------------------------------------------------------------

	/**
	 * Open a query and start draining its messages.
	 *
	 * Called again by `rewindTo`, which is why it takes the session to resume: a rewind is
	 * a fork you stay in, so the same agent continues against a new session id.
	 */
	private async startQuery(resume?: string): Promise<void> {
		const { deck, translator, notice } = this.context;
		const executable = claudeExecutable();
		const state = newStreamState();

		const options: Options = {
			cwd: this.context.cwd,
			// The deck's description, the same text Pi gets as a context file. Appended to
			// Claude Code's own preset rather than replacing it: the built-in prompt is
			// what makes its file tools work well, and Decks has no business rewriting it.
			systemPrompt: {
				type: "preset",
				preset: "claude_code",
				append: [deckContext(deck, qualifiedToolName(this.context.tool)), "", ...this.context.tool.guidelines.map((line) => `- ${line}`)].join(
					"\n",
				),
			},
			mcpServers: { [stageServerName()]: stageMcpServer(this.context.tool) },
			// Pre-approved: the canvas tool is how the agent answers, and a confirm in
			// front of it would be a confirm in front of every reply.
			allowedTools: [qualifiedToolName(this.context.tool)],
			permissionMode: CLI_MODE[this.currentMode],
			includePartialMessages: true,
			canUseTool: (toolName, input) => this.ask(toolName, input),
			...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
			...(resume ? { resume } : {}),
			...(this.currentModel ? { model: this.currentModel } : {}),
			...(effortOf(this.currentThinking) ? { effort: effortOf(this.currentThinking) } : {}),
			stderr: (data: string) => {
				// The CLI's own diagnostics, which are usually about credentials.
				if (data.trim()) notice("warn", data.trim().split("\n").slice(-1)[0] ?? "");
			},
		};

		this.closed = false;
		this.session = query({ prompt: this.input(), options });

		// Drained in the background for the agent's life: this is the event loop.
		this.pump = (async () => {
			try {
				for await (const message of this.session) {
					if (message.type === "system" && message.subtype === "init") {
						this.sessionId = message.session_id;
					}
					if (message.type === "result") {
						this.streaming = false;
						void this.refreshUsage();
						/*
						 * Pair the transcript with the session file *here*, not where the
						 * shell does it.
						 *
						 * `prompt()` returns as soon as the message is queued — the turn
						 * runs on this stream — so the shell's post-prompt call happens
						 * before the CLI has written the message to its session file, and
						 * found nothing to pair. Every message after the first was left
						 * without an id, and a message with no id has no rewind, no fork
						 * and no board restore.
						 */
						void this.syncEntryIds().then(() => this.context.turnEnded?.());
					}
					handleClaudeMessage(translator, state, message);
				}
			} catch (error) {
				if (this.closed) return;
				this.streaming = false;
				translator.setState("idle");
				notice("error", `Claude stopped: ${(error as Error).message}`);
			}
		})();

		try {
			this.available = await this.session.supportedModels();
			const initial = this.available.find((model) => model.value === this.currentModel) ?? this.available[0];
			this.currentModel ??= initial?.value;
		} catch (error) {
			notice("warn", `Could not list Claude's models: ${(error as Error).message}`);
		}
	}

	/**
	 * The input side of the query: an async iterable the shell pushes into.
	 *
	 * A generator rather than a channel object because that is the shape `query()` takes.
	 * It parks on a promise when the queue is empty, so an idle agent costs nothing.
	 */
	private async *input(): AsyncGenerator<SDKUserMessage> {
		while (!this.closed) {
			const next = this.queue.shift();
			if (!next) {
				await new Promise<void>((resolve) => {
					this.wake = resolve;
				});
				continue;
			}
			yield next;
		}
	}

	private push(text: string): void {
		this.queue.push({
			type: "user",
			message: { role: "user", content: text },
			parent_tool_use_id: null,
			session_id: this.sessionId ?? "",
			// Stamped as a person typing: an unattributed message fails closed at the
			// CLI's trust gates.
			origin: { kind: "human" },
			uuid: randomUUID(),
		} as SDKUserMessage);
		this.wake?.();
		this.wake = undefined;
	}

	/**
	 * The CLI asking whether it may do something.
	 *
	 * Routed to the browser through the bridge Pi's extensions already use, because a
	 * question nobody can answer is a session that stalls. The bridge guarantees a single
	 * resolution and falls back to the caller's default when a question is abandoned —
	 * which here is *deny*, since the alternative is an unattended command.
	 */
	private async ask(toolName: string, input: Record<string, unknown>): Promise<
		{ behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }
	> {
		const detail = describe(input);
		// The bridge's own fallback for a confirm is `false`, which is the answer this
		// wants: an abandoned question denies rather than waves a command through.
		const allowed = await this.context.bridge
			.context()
			.confirm(`Claude wants to run ${toolName}`, detail ? `${detail}\n\nAllow it?` : "Allow it?");
		return allowed ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "The user denied this." };
	}

	// --- the conversation -------------------------------------------------------------

	async prompt(text: string): Promise<void> {
		this.streaming = true;
		this.context.translator.setState("thinking");
		this.push(text);
	}

	async abort(): Promise<void> {
		try {
			await this.session.interrupt();
		} finally {
			this.streaming = false;
		}
	}

	get isStreaming(): boolean {
		return this.streaming;
	}

	// --- the model ---------------------------------------------------------------------

	model(): AgentModel | undefined {
		if (!this.currentModel) return undefined;
		return { provider: PROVIDER, model: this.currentModel, thinking: this.currentThinking ?? "medium" };
	}

	async setModel(provider: string, model: string, thinking?: ThinkingLevel): Promise<void> {
		if (provider !== PROVIDER) throw new Error(`This agent runs on Claude Code, which has no ${provider} models.`);
		await this.session.setModel(model);
		this.currentModel = model;
		if (thinking) this.setThinking(thinking);
	}

	setThinking(level: ThinkingLevel): void {
		this.currentThinking = level;
		const effort = effortOf(level);
		// Fire-and-forget: the shell wants the level recorded now, and a failed apply
		// leaves the previous one in force rather than a wrong one.
		if (effort) void this.session.applyFlagSettings({ effortLevel: effort });
	}

	async models(): Promise<ModelOption[]> {
		return this.available.map((model) => ({
			provider: PROVIDER,
			model: model.value,
			label: model.displayName || model.value,
			reasoning: Boolean(model.supportsEffort),
		}));
	}

	usage(): AgentUsage | null {
		return this.lastUsage;
	}

	/** Read after each turn, because Decks' `usage()` is synchronous and this is not. */
	private async refreshUsage(): Promise<void> {
		try {
			const usage = await this.session.getContextUsage();
			this.lastUsage = {
				contextTokens: usage.totalTokens,
				contextWindow: usage.maxTokens,
				// The CLI reports cost through `/usage`, which is a separate and
				// experimental call; nothing here would be more honest than zero.
				cost: this.lastUsage?.cost ?? 0,
			};
		} catch {
			/* a query that has ended has no usage, which is not an error worth raising */
		}
	}

	// --- modes -------------------------------------------------------------------------

	mode(): AgentMode | undefined {
		return this.currentMode;
	}

	async setMode(mode: AgentMode): Promise<void> {
		this.currentMode = mode;
		await this.session.setPermissionMode(CLI_MODE[mode]);
	}

	// --- identity ----------------------------------------------------------------------

	name(): string | undefined {
		return this.storedName;
	}

	setName(name: string): void {
		this.storedName = name;
		this.title = name;
		// Written to Claude's own session file so the CLI shows the same thing, and
		// fire-and-forget for the same reason as `setThinking`.
		if (this.sessionId) {
			void renameSession(this.sessionId, name, { dir: this.context.cwd }).catch((error: unknown) => {
				this.context.translator.notice("warn", `Could not rename the Claude session: ${(error as Error).message}`);
			});
		}
	}

	// --- the session tree ----------------------------------------------------------------

	/**
	 * Tag each user message with the session message it became.
	 *
	 * The same shape as Pi's, and for the same reason: the ids are what a rewind, a fork
	 * and a board restore are addressed to. Walked from the end because the transcript in
	 * memory is a capped tail, so the two sequences share a *suffix* — pairing from the
	 * start would line the oldest message up against one from the middle.
	 *
	 * Stops at the first disagreement, which costs one message its rewind affordance and
	 * is the right way to be wrong.
	 */
	async syncEntryIds(): Promise<void> {
		if (!this.sessionId) return;
		let messages: Awaited<ReturnType<typeof getSessionMessages>>;
		try {
			messages = await getSessionMessages(this.sessionId, { dir: this.context.cwd });
		} catch {
			return;
		}
		/*
		 * Only messages a person typed.
		 *
		 * Claude replays a tool's result as a *user-role* message, so `type === "user"` is
		 * not the same question as "did somebody say this". Pairing from the end without
		 * this filter lines the newest transcript message up against the newest tool
		 * result, the texts disagree, and the walk stops before tagging anything — which
		 * left the second message onwards with no rewind, fork or restore.
		 */
		const entries = messages.filter((message) => message.type === "user" && isTyped(message.message));
		const items = this.context.translator.userMessages();


		for (let offset = 1; offset <= Math.min(entries.length, items.length); offset += 1) {
			const entry = entries[entries.length - offset];
			const item = items[items.length - offset];
			if (!entry || !item) break;
			if (item.entryId === entry.uuid) continue;
			if (!contentStartsWith(entry.message, item.text)) break;
			this.context.translator.tagUser(item.id, entry.uuid);
		}
	}

	/**
	 * The points worth returning to, dated from the transcript.
	 *
	 * Claude's `SessionMessage` carries no timestamp, and Decks does not need the SDK to
	 * supply one: the transcript already knows when each message was sent, and
	 * `syncEntryIds` has paired them with their session ids. So this is the same list, read
	 * from the side that has both halves.
	 */
	timeline(): ConversationPoint[] {
		return this.context.translator
			.userMessages()
			.filter((item) => item.entryId)
			.map((item) => ({ id: item.entryId as string, at: item.at }));
	}

	/**
	 * Nothing recorded, on purpose.
	 *
	 * Pi writes a `board-rev` entry per write, which names the exact revision a board was
	 * at. Claude has no custom-entry API, and `App.boardsAt` already falls back to the
	 * revision store's own timestamps — the same answer, except where two writes share a
	 * second. An empty map is how that fallback is asked for.
	 */
	revisionsAt(): Record<string, string> {
		return {};
	}

	/**
	 * Go back to just before a message.
	 *
	 * Claude cannot walk a session tree in place, but it can copy one up to a point — so a
	 * rewind is a fork you stay in: the history up to that message becomes a new session,
	 * and this agent's query is reopened against it. The abandoned path stays on disk under
	 * the old id, which is the same bargain Pi's `navigateTree` makes.
	 */
	async rewindTo(entryId: string): Promise<{ cancelled: boolean; editorText?: string }> {
		if (this.streaming) throw new Error("Stop Claude before rewinding.");
		const forked = await this.forkFrom(entryId);
		if (!forked) return { cancelled: true };

		const text = this.context.translator.userMessages().find((item) => item.entryId === entryId)?.text;
		const previous = this.session;
		this.closed = true;
		this.wake?.();
		this.queue = [];
		await this.startQuery(forked);
		this.sessionId = forked;
		try {
			await previous.return(undefined);
		} catch {
			/* a query that has already ended is not a problem worth raising */
		}
		if (this.currentMode !== DEFAULT_MODE) await this.setMode(this.currentMode);
		return { cancelled: false, ...(text ? { editorText: text } : {}) };
	}

	/**
	 * The same point, as a session of its own.
	 *
	 * `forkSession` copies the transcript into a new session id, so the fork is resumable
	 * exactly like any other session and the original is untouched. `upToMessageId` is
	 * *inclusive* and Decks forks from *before* a message — so the new chat opens with it
	 * unasked — which means cutting at the message before ours.
	 */
	/**
	 * The session id to resume (`AgentBackend.sessionRef`).
	 *
	 * Reassigned by `rewindTo`, which forks and stays in the new session — so this is the
	 * live branch rather than the one the agent started on.
	 */
	sessionRef(): string | undefined {
		return this.sessionId;
	}

	async forkFrom(entryId: string): Promise<string | undefined> {
		if (!this.sessionId) return undefined;
		let messages: Awaited<ReturnType<typeof getSessionMessages>>;
		try {
			messages = await getSessionMessages(this.sessionId, { dir: this.context.cwd });
		} catch {
			return undefined;
		}
		const index = messages.findIndex((message) => message.uuid === entryId);
		// Forking from the very first message is just a new chat, which is what
		// `undefined` becomes upstream.
		if (index <= 0) return undefined;
		const cut = messages[index - 1];
		if (!cut) return undefined;
		const forked = await forkSession(this.sessionId, {
			dir: this.context.cwd,
			upToMessageId: cut.uuid,
			...(this.title ? { title: `${this.title} (fork)` } : {}),
		});
		return forked.sessionId;
	}

	dispose(): void {
		this.closed = true;
		this.wake?.();
		this.wake = undefined;
		this.queue = [];
		void this.session?.return(undefined).catch(() => {
			/* already gone */
		});
		void this.pump;
	}
}

function stageServerName(): string {
	// Kept as a call rather than an import of the constant so the two files cannot
	// disagree about it silently.
	return "decks";
}

/**
 * Decks' thinking levels and Claude's effort levels are nearly the same list.
 *
 * `off` and `minimal` have no effort counterpart — the CLI's lowest is `low` — so they map
 * to nothing rather than to a level that would spend more than was asked for.
 */
function effortOf(level: ThinkingLevel | undefined): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
	switch (level) {
		case "low":
		case "medium":
		case "high":
		case "xhigh":
		case "max":
			return level;
		default:
			return undefined;
	}
}

/**
 * Whether a user-role message is something a person typed.
 *
 * A tool result rides on a user message as a `tool_result` block, and a synthetic message
 * can carry no text at all. Either way it is not a point in the conversation you can
 * return to.
 */
function isTyped(message: unknown): boolean {
	const content = (message as { content?: unknown } | undefined)?.content;
	if (typeof content === "string") return content.trim().length > 0;
	if (!Array.isArray(content)) return false;
	if (content.some((part) => (part as { type?: string })?.type === "tool_result")) return false;
	return content.some((part) => (part as { type?: string })?.type === "text");
}

/** Whether a session message's content begins with the text that was displayed. */
function contentStartsWith(message: unknown, shown: string): boolean {
	const content = (message as { content?: unknown } | undefined)?.content;
	const text =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content
						.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : ""))
						.join("")
				: "";
	return text.trimStart().startsWith(shown.trimStart());
}

/** A one-line description of what a tool was asked to do, for the confirm dialog. */
function describe(input: Record<string, unknown>): string {
	for (const key of ["command", "file_path", "path", "pattern", "url"]) {
		const value = input[key];
		if (typeof value === "string" && value.trim()) return `${key}: ${value.trim().slice(0, 300)}`;
	}
	return "";
}
