import { existsSync } from "node:fs";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { AgentCapabilities, AgentModel, AgentUsage, ModelOption, SlashCommand, ThinkingLevel } from "@decks/protocol";
import type { AgentBackend, AgentBackendContext, ConversationPoint } from "../agents/backend.ts";
import { parseSlash } from "../agents/slash.ts";
import { decksStage } from "./extension.ts";
import { deckContext, skillsDir } from "../agents/context.ts";
import { handlePiEvent } from "./events.ts";

/**
 * Pi behind one Decks agent.
 *
 * Everything Pi owns — history, context, compaction, tool execution, the session
 * tree — stays inside `AgentSession`. This supplies the environment around it: the
 * deck as cwd, the deck's description as a context file, Decks' own skills, and a
 * dialog surface so an installed extension can ask the user something.
 *
 * What is *not* here: the transcript (that is `agents/translator.ts`, shared), and
 * any permission gate (that is an extension's job — DESIGN §6.8).
 */
/** Pi has no notion of asking first: that is an extension's business (§6.8). */
export const PI_CAPABILITIES: AgentCapabilities = { modes: [] };

/**
 * The `/` commands Decks interprets for a pi agent.
 *
 * The things pi keeps in its TUI, which a headless session here has no other way to
 * say. Anything else is handed through to pi's core, which parses extension
 * commands, `/skill:name` and prompt templates of its own (§6.8).
 */
export const PI_COMMANDS: SlashCommand[] = [
	{ name: "compact", hint: "Condense the conversation", arg: "[notes]" },
	{ name: "session", hint: "Session file, id and what is in it" },
	{ name: "cost", hint: "How much this session has spent" },
	{ name: "name", hint: "Rename this agent", arg: "<name>" },
	{ name: "help", hint: "The commands Decks understands" },
];

export class PiBackend implements AgentBackend {
	readonly capabilities = PI_CAPABILITIES;

	private session!: AgentSession;
	private modelRuntime!: ModelRuntime;
	private unsubscribe: (() => void) | undefined;

	private constructor(private readonly context: AgentBackendContext) {}

	static async create(context: AgentBackendContext): Promise<PiBackend> {
		const backend = new PiBackend(context);
		await backend.init();
		return backend;
	}

	private async init(): Promise<void> {
		const { cwd, deck, translator, bridge, notice, tool } = this.context;
		const agentDir = getAgentDir();

		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			// Pi finds the user's own skills itself; these are the two that come with
			// Decks and describe this environment.
			additionalSkillPaths: [skillsDir()],
			// Visible in the startup list on purpose: `stage_eval` is a tool the agent
			// has, and where it came from should not be a mystery.
			// Built here rather than found on disk: Pi hands a factory only `ExtensionAPI`,
			// so an extension on disk could not reach the canvas (§6.3).
			extensionFactories: [decksStage({ tool, agent: this.context.stageAgent })],
			/*
			 * The deck's description goes in as a context file, once. Pi owns it from
			 * there — re-injecting it every turn would be a second, competing source of
			 * truth about a deck the agent can simply look at.
			 */
			agentsFilesOverride: (base) => ({
				agentsFiles: [...base.agentsFiles, { path: `${deck.path} (deck)`, content: deckContext(deck, tool.name) }],
			}),
		});
		await loader.reload();

		this.modelRuntime = await ModelRuntime.create();

		const { session, modelFallbackMessage } = await createAgentSession({
			cwd,
			agentDir,
			modelRuntime: this.modelRuntime,
			resourceLoader: loader,
			// A fork opens the file it was branched into; everything else starts fresh.
			sessionManager: this.context.resumeRef ? SessionManager.open(this.context.resumeRef) : SessionManager.create(cwd),
		});
		this.session = session;
		if (modelFallbackMessage) notice("warn", modelFallbackMessage);

		this.unsubscribe = session.subscribe((event) => handlePiEvent(translator, event));

		/*
		 * `mode: "rpc"` is the honest label: like Pi's own RPC mode, this serialises
		 * the extension UI surface to a remote client instead of drawing a terminal.
		 * It also makes `ctx.hasUI` true, which is what an extension checks before it
		 * offers a dialog — and a permission extension that cannot ask is a
		 * permission extension that denies everything.
		 */
		await session.bindExtensions({
			mode: "rpc",
			uiContext: bridge.context() as never,
			abortHandler: () => void session.abort(),
			onError: (error) => notice("error", formatExtensionError(error)),
		});
	}

	// --- the conversation ---------------------------------------------------------

	async prompt(text: string): Promise<void> {
		/*
		 * A prompt that starts with `/` is a command here. A few are the deck's own —
		 * the things pi keeps in its TUI, which a headless session has no other way to
		 * say — and everything else is handed through untouched: pi's core already
		 * parses extension commands, `/skill:name` and prompt templates out of prompts,
		 * and that surface is its business, not ours.
		 */
		const command = parseSlash(text);
		if (command) {
			await this.runSlash(command.name, command.args);
			return;
		}
		// Mid-stream input steers rather than queues: the user is watching the thing
		// they are correcting, and "wait until it finishes" is rarely what they meant.
		if (this.session.isStreaming) await this.session.prompt(text, { streamingBehavior: "steer" });
		else await this.session.prompt(text);
	}

	/** What typing `/` completes to, for the composer's menu. */
	commands(): SlashCommand[] {
		return PI_COMMANDS;
	}

	private async runSlash(name: string, args: string): Promise<void> {
		const { notice } = this.context;
		switch (name) {
			case "compact":
				await this.session.compact(args || undefined);
				return;
			case "session": {
				const branch = this.session?.sessionManager.getBranch() ?? [];
				notice(
					"info",
					`Session ${this.session?.sessionName ?? this.session?.sessionId ?? ""} · ${this.sessionRef() ?? "no file yet"} · ${branch.length} entries`,
				);
				return;
			}
			case "cost":
				await this.usageModal();
				return;
			case "name": {
				if (!args.trim()) {
					notice("warn", "Usage: /name <name> — rename this agent.");
					return;
				}
				this.setName(args.trim());
				notice("info", `Renamed to ${args.trim()}.`);
				return;
			}
			case "help":
				notice(
					"info",
					this.commands().map((command) => `/${command.name}${command.arg ? ` ${command.arg}` : ""} — ${command.hint ?? ""}`).join("\n") || "No commands.",
				);
				return;
			default:
				notice("warn", `Unknown command /${name}. Try /help.`);
		}
	}

	async abort(): Promise<void> {
		await this.session.abort();
	}

	get isStreaming(): boolean {
		return this.session?.isStreaming ?? false;
	}

	// --- the model ----------------------------------------------------------------

	model(): AgentModel | undefined {
		const model = this.session?.model;
		if (!model) return undefined;
		return { provider: model.provider, model: model.id, thinking: this.session.thinkingLevel as ThinkingLevel };
	}

	async setModel(provider: string, model: string, thinking?: ThinkingLevel): Promise<void> {
		const resolved = this.modelRuntime.getModel(provider, model);
		if (!resolved) throw new Error(`Model ${provider}/${model} is not available`);
		await this.session.setModel(resolved);
		if (thinking) this.session.setThinkingLevel(thinking as never);
	}

	setThinking(level: ThinkingLevel): void {
		this.session.setThinkingLevel(level as never);
	}

	/** Only models with working credentials: a picker of things that fail is a trap. */
	async models(): Promise<ModelOption[]> {
		const available = await this.modelRuntime.getAvailable();
		return available
			.map((model) => ({
				provider: model.provider,
				model: model.id,
				label: model.name || model.id,
				reasoning: model.reasoning === true,
			}))
			.sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label));
	}

	/**
	 * Pi offers context usage as a reading rather than an event, so it is sampled at
	 * the moments that move it. `contextTokens` is null until a reply comes back,
	 * which is a real state — right after compaction — and not an error.
	 */
	usage(): AgentUsage | null {
		const usage = this.session?.getContextUsage();
		if (!usage) return null;
		const record = usage as { tokens?: number | null; contextWindow?: number; cost?: number };
		return {
			contextTokens: record.tokens ?? null,
			contextWindow: record.contextWindow ?? this.session.model?.contextWindow ?? 0,
			cost: this.session.getSessionStats().cost,
		};
	}

	/** The session's usage, in a modal the browser shows. */
	async usageModal(): Promise<void> {
		const usage = this.usage();
		const model = this.session?.model;
		const tokens = usage?.contextTokens ?? null;
		const window = usage?.contextWindow ?? 0;
		await this.context.bridge.usage("Pi session", [
			{
				label: "Context",
				value:
					window > 0
						? `${Math.round(((tokens ?? 0) / window) * 100)}% (${tokens ?? "?"} / ${window} tokens)`
						: tokens === null
							? "—"
							: `${tokens} tokens`,
			},
			{ label: "Cost", value: `$${(usage?.cost ?? 0).toFixed(4)}` },
			{ label: "Model", value: model ? `${model.provider}/${model.id}` : "—" },
			{ label: "Session", value: this.session?.sessionName ?? this.session?.sessionId ?? "—" },
		]);
	}

	// --- identity ------------------------------------------------------------------

	name(): string | undefined {
		return this.session?.sessionName || undefined;
	}

	setName(name: string): void {
		// Pi's own session name, so it survives a resume and the CLI shows the same
		// thing. Decks reads it back rather than keeping a copy.
		this.session.setSessionName(name);
	}

	// --- the session tree ------------------------------------------------------------

	/**
	 * Tag each user message with the Pi entry it became.
	 *
	 * Pi does not announce this — `entry_appended` fires only for entries an *extension*
	 * appended, never for ordinary messages. What it does offer is the branch, and the
	 * user messages on it are the same sequence, in the same order, as the user items in
	 * the transcript.
	 *
	 * Walked from the end: the transcript in memory is a capped tail
	 * (`KEEP` in `agents/translator.ts`), so the two sequences share a *suffix*, not a
	 * prefix — pairing from the start would line the oldest entry up against a message
	 * from the middle of the conversation. Checked as it goes, and stopping at the first
	 * disagreement: a missing id costs one message its rewind affordance, which is the
	 * right way to be wrong. (The algorithm is Picone's, at
	 * `picone/apps/server/src/pi/backend.ts:503`.)
	 */
	async syncEntryIds(): Promise<void> {
		const entries = (this.session?.sessionManager.getBranch() ?? []).filter(
			(entry): entry is typeof entry & { message: { role: string; content: unknown } } =>
				entry.type === "message" && (entry as { message?: { role?: string } }).message?.role === "user",
		);
		const items = this.context.translator.userMessages();

		for (let offset = 1; offset <= Math.min(entries.length, items.length); offset++) {
			const entry = entries[entries.length - offset];
			const item = items[items.length - offset];
			if (!entry || !item) break;
			if (item.entryId === entry.id) continue;
			// The entry holds the model-facing text, which can have more appended to it
			// than was displayed, so the test is that it *starts with* what we showed.
			if (!entryStartsWith(entry.message.content, item.text)) break;
			this.context.translator.tagUser(item.id, entry.id);
		}
	}

	/**
	 * The user's messages on the current branch, oldest first.
	 *
	 * Only user messages, because those are what `navigateTree` accepts. Used to date a
	 * point so `App.boardsAt` can ask the revision store what the boards looked like
	 * then; nothing draws this any more.
	 */
	timeline(): ConversationPoint[] {
		const points: ConversationPoint[] = [];
		for (const entry of this.session?.sessionManager.getBranch() ?? []) {
			if (entry.type !== "message") continue;
			if ((entry.message as { role?: string }).role !== "user") continue;
			const at = Date.parse(entry.timestamp) || undefined;
			points.push({ id: entry.id, ...(at ? { at } : {}) });
		}
		return points;
	}

	/**
	 * What each board looked like at that point, from the `board-rev` entries.
	 *
	 * Walks the branch forwards and keeps the last revision seen per board before the
	 * given entry — so a board written three turns ago and untouched since resolves to
	 * that older version, which is the whole point.
	 */
	revisionsAt(entryId: string): Record<string, string> {
		const at: Record<string, string> = {};
		for (const entry of this.session?.sessionManager.getBranch() ?? []) {
			if (entry.type === "custom" && entry.customType === "board-rev") {
				const data = entry.data as { path?: unknown; sha?: unknown } | undefined;
				if (typeof data?.path === "string" && typeof data.sha === "string") at[data.path] = data.sha;
			}
			if (entry.id === entryId) break;
		}
		return at;
	}

	/**
	 * `navigateTree` on a user message sets the leaf to that message's parent, hands
	 * back its text, and rebuilds the agent's messages from the new branch. Nothing is
	 * deleted — the abandoned path is still in the file, reachable by its own leaf.
	 */
	async rewindTo(entryId: string): Promise<{ cancelled: boolean; editorText?: string }> {
		const result = await this.session.navigateTree(entryId);
		return { cancelled: Boolean(result.cancelled), ...(result.editorText ? { editorText: result.editorText } : {}) };
	}

	/**
	 * Write the path up to an entry into a new session file, for a new chat to open.
	 *
	 * `createBranchedSession` also *switches the manager it is called on* to the new
	 * file, which would hijack this session — so it runs on a throwaway manager opened
	 * on the same path and only the filename is kept. (Picone found this one first.)
	 */
	/** The session file this conversation is being written to (`AgentBackend.sessionRef`). */
	sessionRef(): string | undefined {
		return this.session?.sessionManager.getSessionFile() ?? undefined;
	}

	async forkFrom(entryId: string): Promise<string | undefined> {
		const entry = this.session.sessionManager.getEntry(entryId);
		// Fork *before* the message, so the new chat opens with it unasked.
		const upTo = entry?.parentId;
		const source = this.session.sessionManager.getSessionFile();
		if (!upTo || !source) return undefined;
		const scratch = SessionManager.open(source);
		const file = scratch.createBranchedSession(upTo);
		// Pi defers writing a branch that holds no assistant reply, so the path it
		// returns may not exist yet. A fork from the first message is just a new chat.
		return file && existsSync(file) ? file : undefined;
	}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.session?.dispose();
	}
}

/**
 * Whether a session entry's content begins with the text that was displayed.
 *
 * Pi stores message content as a string or as content parts; both shapes turn up
 * depending on how the message was built.
 */
function entryStartsWith(content: unknown, shown: string): boolean {
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

/** Pi reports extension failures as a structured record, not a string. */
function formatExtensionError(error: unknown): string {
	if (typeof error === "string") return `Extension error: ${error}`;
	if (error instanceof Error) return `Extension error: ${error.message}`;
	if (error && typeof error === "object") {
		const { extensionPath, event, error: detail } = error as Record<string, unknown>;
		const where = [extensionPath, event].filter(Boolean).join(" · ");
		const message = detail instanceof Error ? detail.message : typeof detail === "string" ? detail : undefined;
		return `Extension error${where ? ` (${where})` : ""}: ${message ?? JSON.stringify(detail ?? error)}`;
	}
	return `Extension error: ${String(error)}`;
}
