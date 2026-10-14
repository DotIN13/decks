import { skillsDir, opencode2PluginDir } from "@decks/runtime";
import type { AgentCapabilities, AgentMode, AgentModel, AgentUsage, ModelOption, SlashCommand, ThinkingLevel } from "@decks/protocol";
import { DEFAULT_THINKING } from "@decks/protocol";
import type { AgentBackend, AgentBackendContext, ConversationPoint, IsolationContext } from "../../agents/backend.ts";
import { deckContext, isolationNote } from "../../agents/context.ts";
import { sentAs } from "../../agents/sent-as.ts";
import { helpText, mergeCommands, parseSlash } from "../../agents/slash.ts";
// The level vocabulary is Decks' own and the same for both opencodes, so it is read from there
// rather than copied: it maps Decks' scale onto whatever variant names a model declares.
import { rankedVariants, variantFor } from "../opencode/variants.ts";
import { connect, offerKeys, type Opencode2Client } from "./client.ts";
import { Opencode2Stream } from "./events.ts";
import { opencode2Manager, type Opencode2ServerHandle } from "./manager.ts";

/**
 * OpenCode 2 behind one Decks agent.
 *
 * The opencode 1 adaptor (`opencode/backend.ts`) stays as it is; this is the same product
 * written against OpenCode 2's server, which was rewritten. The shape is unchanged: **one
 * shared server for every OpenCode 2 agent** (`manager.ts`), and each agent is a session in it
 * plus a filtered view of the server's one event stream (`events.ts`).
 *
 * What moved, against opencode 1:
 *
 * - **The deck's briefing is a session instruction**, not a file named in the server's config:
 *   OpenCode 2 still accepts `instructions` in its config schema and does not read it. A session
 *   instruction (`session.instructions.entry.put`) is OpenCode 2's own way to give a session
 *   standing text, and it is per session, which isolated mode needs anyway.
 * - **The model and level are the session's**, set with `switchModel`, not riders on each
 *   prompt; so a change is sent only when it is one.
 * - **Isolated mode moves the session** (`session.move`) into the copy of the stage, since a
 *   prompt can no longer name its own directory, and moves it back when isolation ends.
 * - **A turn's end is `session.execution.*`**, which `events.ts` reads.
 * - **Permissions are `{ action, resource, effect }` rules on the session**, and `bash` is
 *   called `shell`. The session's rules come after the agent's and the last match wins, so the
 *   mode set here is the one that applies.
 */

/** OpenCode 2 asks before writes and commands, so three of Decks' four modes mean something. */
export const OPENCODE2_CAPABILITIES: AgentCapabilities = { modes: ["manual", "acceptEdits", "auto"] };

/** The `/` commands Decks interprets for an OpenCode 2 agent; the server's own are merged under these. */
export const OPENCODE2_COMMANDS: SlashCommand[] = [
	{ name: "cost", hint: "Open the usage panel: spend, tokens, context", source: "deck" },
	{ name: "models", hint: "Which models this OpenCode 2 install can reach", source: "deck" },
	{ name: "status", hint: "Model, mode, server and session", source: "deck" },
	{ name: "compact", hint: "Summarise the conversation so far", source: "deck" },
	{ name: "help", hint: "The commands Decks understands", source: "deck" },
];

/**
 * What Decks' modes mean to OpenCode 2, per action it asks about.
 *
 * `external_directory` is ruled on in every mode for the reason it is in opencode 1's table: a
 * request nobody answers is a turn that hangs, and with no rule OpenCode answers `ask`.
 */
const PERMISSIONS: Record<string, Record<string, "ask" | "allow">> = {
	manual: { edit: "ask", shell: "ask", webfetch: "ask", external_directory: "ask" },
	acceptEdits: { edit: "allow", shell: "ask", webfetch: "allow", external_directory: "allow" },
	auto: { edit: "allow", shell: "allow", webfetch: "allow", external_directory: "allow" },
};

function rulesOf(mode: AgentMode): Array<{ action: string; resource: string; effect: "ask" | "allow" }> {
	return Object.entries(PERMISSIONS[mode] ?? PERMISSIONS.acceptEdits!).map(([action, effect]) => ({ action, resource: "*", effect }));
}

const DEFAULT_MODE: AgentMode = "acceptEdits";

/** The keys of this agent's two session instructions. */
const BRIEFING = "decks";
const ISOLATION = "decks-isolation";

export class Opencode2Backend implements AgentBackend {
	readonly capabilities = OPENCODE2_CAPABILITIES;

	private url = "";
	private handle: Opencode2ServerHandle | undefined;
	private client!: Opencode2Client;
	private stream!: Opencode2Stream;
	private sessionId: string | undefined;
	private unwatchDeath: (() => void) | undefined;
	private events: AbortController | undefined;
	/** Detached from the server: disposed, or the server died under it. */
	private closed = false;
	private streamingNow = false;

	private currentModel: AgentModel | undefined;
	private currentMode: AgentMode = DEFAULT_MODE;
	private currentThinking: ThinkingLevel | undefined;
	/** The model and variant the session was last switched to, so a switch is sent only when it changes. */
	private applied = "";
	private available: ModelOption[] = [];
	/** Per `provider/model`: the levels its variants offer, and its context window. */
	private variants = new Map<string, readonly ThinkingLevel[]>();
	private windows = new Map<string, number>();
	private commandList: SlashCommand[] = OPENCODE2_COMMANDS;
	private storedName: string | undefined;
	private lastUsage: AgentUsage | null = null;
	/** Isolated mode, while it is on (`agents/isolation.ts`). */
	private isolation: IsolationContext | undefined;

	private constructor(private readonly context: AgentBackendContext) {}

	static async create(context: AgentBackendContext): Promise<Opencode2Backend> {
		const backend = new Opencode2Backend(context);
		await backend.start();
		return backend;
	}

	private get directory(): string {
		return this.context.deck.path;
	}

	private get location(): { location: { directory: string } } {
		return { location: { directory: this.directory } };
	}

	private async start(): Promise<void> {
		const { translator } = this.context;
		this.currentModel = this.context.model;
		this.currentThinking = this.context.model?.thinking;
		this.currentMode = this.context.mode ?? DEFAULT_MODE;

		const handle = await opencode2Manager.acquire({
			cwd: this.directory,
			stageUrl: `http://127.0.0.1:${this.context.port}/api/stage/eval`,
			config: { plugins: [opencode2PluginDir()], skills: [skillsDir()] },
		});
		this.handle = handle;
		this.url = handle.url;
		// The bridge learns the server's token before any tool call can arrive.
		this.context.stageBridge?.setServerToken(handle.secret, "opencode2");
		this.unwatchDeath = opencode2Manager.onExit(() => this.serverDied());
		this.client = connect(this.url, handle.secret);

		// Keys first, so the model list below already has them on a first start.
		const added = await offerKeys(this.client, this.url, this.directory);
		if (added.length > 0) this.context.notice("info", `OpenCode 2 now has your opencode 1 key for ${added.join(", ")}.`);

		await this.refreshModels();
		this.sessionId = await this.openSession();

		// The canvas tool's calls name this session; the bridge resolves that to this agent.
		this.context.stageBridge?.registerSession(this.sessionId, this.context.stageAgent.id, this.context.tool, "opencode2");
		await this.putInstruction(BRIEFING, this.briefing());
		if (this.context.isolation) await this.setIsolation(this.context.isolation);

		this.stream = new Opencode2Stream(translator, this.sessionId, {
			ended: () => {
				this.streamingNow = false;
				this.context.turnEnded?.();
			},
			usage: (reading) => this.read(reading),
			model: (provider, id) => (this.currentModel = { provider, model: id, thinking: this.currentThinking ?? DEFAULT_THINKING }),
			permission: (id, action, message) => void this.answerPermission(id, action, message),
		});
		void this.pump();
		void this.refreshCommands();
	}

	/**
	 * The session this chat continues, or a new one.
	 *
	 * OpenCode 2 keeps sessions in its database across server restarts, so a chat that was
	 * resting, or a fork opened as a new chat, carries on in the session it names (`resumeRef`).
	 * Its permissions are set to this chat's mode again, and its model to the chat's, since
	 * either may have changed while it rested. One that is gone starts the chat afresh, as a
	 * missing pi session file does.
	 */
	private async openSession(): Promise<string> {
		const model = this.wantedModel();
		const resume = this.context.resumeRef;
		if (resume) {
			const found = (await this.client.session.get({ sessionID: resume } as never).catch(() => undefined)) as { id?: string } | undefined;
			if (found?.id) {
				await this.client.session.update({ sessionID: found.id, permissions: rulesOf(this.currentMode) } as never).catch(() => undefined);
				this.sessionId = found.id;
				await this.applyModel().catch(() => undefined);
				return found.id;
			}
			this.context.notice("warn", "OpenCode 2 no longer has this conversation, so the chat starts a new one.");
		}
		const session = (await this.client.session.create({
			title: "Decks",
			location: { directory: this.directory },
			...(model ? { model } : {}),
			permissions: rulesOf(this.currentMode),
		} as never)) as { id?: string };
		if (!session.id) throw new Error("OpenCode 2 started but would not open a session.");
		if (model) this.applied = keyOf(model);
		return session.id;
	}

	/** The deck's description and the guidelines, as every runtime gets them. */
	private briefing(): string {
		const { deck, tool } = this.context;
		return [deckContext(deck, tool.name, { web: tool.webShared() }), "", ...tool.guidelines.map((line) => `- ${line}`)].join("\n");
	}

	private async putInstruction(key: string, value: string): Promise<void> {
		if (!this.sessionId) return;
		await this.client.session.instructions.entry
			.put({ sessionID: this.sessionId, key, value } as never)
			.catch((error: Error) => this.context.notice("warn", `OpenCode 2 would not take the deck's instructions: ${error.message}`));
	}

	private serverDied(): void {
		if (this.closed) return;
		this.closed = true;
		this.streamingNow = false;
		this.context.stageBridge?.unregisterSession(this.sessionId);
		this.sessionId = undefined;
		this.context.translator.setState("idle");
		this.context.notice("error", "OpenCode 2 exited. This chat needs restarting.");
	}

	private async pump(): Promise<void> {
		this.events = new AbortController();
		try {
			for await (const event of this.client.event.subscribe({ signal: this.events.signal } as never)) {
				if (this.closed) return;
				this.stream.handle(event);
			}
		} catch (error) {
			if (this.closed) return;
			this.streamingNow = false;
			this.context.translator.setState("idle");
			if (opencode2Manager.alive()) this.context.notice("error", `OpenCode 2's event stream stopped: ${(error as Error).message}`);
		}
	}

	// --- the conversation ---------------------------------------------------------------

	/**
	 * Answer a permission request with this agent's mode: allowed once, or refused and said.
	 * Never `always`: in OpenCode 2 a saved answer is the project's, so it would reach every
	 * other agent on the deck.
	 */
	private async answerPermission(id: string, action: string, message: string | undefined): Promise<void> {
		if (!this.sessionId) return;
		const allowed = PERMISSIONS[this.currentMode]?.[action] === "allow";
		await this.client.permission
			.reply({ sessionID: this.sessionId, requestID: id, decision: allowed ? "once" : "reject" } as never)
			.catch(() => undefined);
		if (!allowed) this.context.notice("info", `Refused to ${message ?? action}: ${this.currentMode} mode asks first, and there is no one to ask.`);
	}

	get isStreaming(): boolean {
		return this.streamingNow;
	}

	async prompt(text: string): Promise<void> {
		const command = parseSlash(text);
		if (command) {
			await this.runSlash(command.name, command.args);
			return;
		}
		await this.send(text);
	}

	private async send(text: string): Promise<void> {
		if (!this.sessionId) throw new Error("This OpenCode 2 chat is not connected any more. Start it again.");
		await this.applyModel();
		/*
		 * Mid-turn input steers, as it does on pi: the person is correcting what they watch. Input
		 * to an idle chat is queued instead, because a steer jumps the queue, and the queue may hold
		 * a move into or out of isolated mode that this prompt has to come after.
		 */
		const delivery = this.streamingNow ? "steer" : "queue";
		this.streamingNow = true;
		this.context.translator.setState("thinking");
		await this.client.session.prompt({ sessionID: this.sessionId, text, delivery } as never);
	}

	/** The model and level the chat asks for, as OpenCode 2 names them. */
	private wantedModel(): { id: string; providerID: string; variant?: string } | undefined {
		const model = this.currentModel;
		if (!model) return undefined;
		const variant = this.currentVariant();
		return { id: model.model, providerID: model.provider, ...(variant ? { variant } : {}) };
	}

	/** Switch the session's model only when the wanted one differs from what it has. */
	private async applyModel(): Promise<void> {
		const model = this.wantedModel();
		if (!model || !this.sessionId || keyOf(model) === this.applied) return;
		await this.client.session.switchModel({ sessionID: this.sessionId, model } as never);
		this.applied = keyOf(model);
	}

	private currentVariant(): ThinkingLevel | undefined {
		if (this.currentThinking === undefined || !this.currentModel) return undefined;
		return variantFor(this.currentThinking, this.variants.get(`${this.currentModel.provider}/${this.currentModel.model}`));
	}

	async abort(): Promise<void> {
		this.streamingNow = false;
		if (this.sessionId) await this.client.session.interrupt({ sessionID: this.sessionId } as never).catch(() => undefined);
		this.context.translator.setState("idle");
	}

	commands(): SlashCommand[] {
		return this.commandList;
	}

	private async refreshCommands(): Promise<void> {
		try {
			const answered = (await this.client.command.list(this.location as never)) as unknown as { data?: Array<{ name: string; description?: string }> };
			const runtime: SlashCommand[] = (answered.data ?? []).map((command) => ({
				name: command.name,
				...(command.description ? { hint: command.description } : {}),
				source: "runtime" as const,
			}));
			this.commandList = mergeCommands(OPENCODE2_COMMANDS, runtime);
			this.context.commandsChanged?.();
		} catch {
			/* a shorter menu, not a broken agent */
		}
	}

	private async runSlash(name: string, args: string): Promise<void> {
		const { notice } = this.context;
		switch (name) {
			case "cost":
				this.context.showUsage?.();
				return;
			case "models":
				notice(
					"info",
					this.available.length === 0
						? "No models. Sign a provider in with `opencode2 auth`, then start a new chat."
						: this.available.map((option) => `${option.provider}/${option.model}: ${option.label}`).join("\n"),
				);
				return;
			case "status": {
				const variant = this.currentVariant();
				notice(
					"info",
					`OpenCode 2, model ${this.currentModel ? `${this.currentModel.provider}/${this.currentModel.model}` : "default"}, mode ${this.currentMode}${variant ? `, level ${variant}` : ""}, ${this.url}, session ${this.sessionId ?? "none"}`,
				);
				return;
			}
			case "compact":
				if (!this.sessionId) return;
				this.streamingNow = true;
				await this.client.session.compact({ sessionID: this.sessionId } as never).catch((error: Error) => {
					this.streamingNow = false;
					notice("warn", `Could not summarise: ${error.message}`);
				});
				return;
			case "help":
				notice("info", helpText(this.commands()));
				return;
			default:
				// OpenCode 2's own command, run as one: a prompt starting with `/` is not parsed
				// into a command by the v2 server.
				if (!this.sessionId) return;
				await this.applyModel();
				this.streamingNow = true;
				this.context.translator.setState("thinking");
				await this.client.session.command({ sessionID: this.sessionId, name, text: args } as never).catch((error: Error) => {
					this.streamingNow = false;
					this.context.translator.setState("idle");
					notice("warn", `OpenCode 2 would not run /${name}: ${error.message}`);
				});
		}
	}

	// --- models and modes ---------------------------------------------------------------

	model(): AgentModel | undefined {
		return this.currentModel;
	}

	async models(): Promise<ModelOption[]> {
		if (this.available.length === 0) await this.refreshModels();
		return this.available;
	}

	private async refreshModels(): Promise<void> {
		try {
			const answered = (await this.client.model.list(this.location as never)) as unknown as {
				data?: Array<{ id: string; providerID: string; name?: string; enabled?: boolean; variants?: Array<{ id: string }>; limit?: { context?: number } }>;
			};
			const models = (answered.data ?? []).filter((model) => model.enabled !== false);
			this.available = models.map((model) => {
				const key = `${model.providerID}/${model.id}`;
				// A level is offered only when the model's variants include one on Decks' scale;
				// OpenCode 2 no longer says "reasoning" on a model, so the variants are the answer.
				const levels = rankedVariants((model.variants ?? []).map((variant) => variant.id));
				this.variants.set(key, levels);
				if (model.limit?.context) this.windows.set(key, model.limit.context);
				return { provider: model.providerID, model: model.id, label: model.name ?? model.id, reasoning: levels.length > 0 };
			});
			// A chat restored onto a model that no longer exists starts on the first one there is,
			// and says so, rather than failing its first prompt.
			const wanted = this.currentModel;
			if (wanted && !this.available.some((option) => option.provider === wanted.provider && option.model === wanted.model)) {
				if (this.available.length > 0) this.context.notice("warn", `${wanted.provider}/${wanted.model} is not available in OpenCode 2, so this chat uses another model.`);
				this.currentModel = undefined;
			}
			if (!this.currentModel && this.available[0]) {
				this.currentModel = { provider: this.available[0].provider, model: this.available[0].model, thinking: DEFAULT_THINKING };
			}
			if (this.available.length === 0) {
				this.context.notice("warn", "OpenCode 2 has no models available. Sign a provider in with `opencode2 auth`, then start a new chat.");
			}
		} catch (error) {
			this.context.notice("warn", `Could not list OpenCode 2's models: ${(error as Error).message}`);
		}
	}

	async setModel(provider: string, model: string, thinking?: ThinkingLevel): Promise<void> {
		this.currentThinking = thinking ?? this.currentThinking;
		this.currentModel = { provider, model, thinking: this.currentThinking ?? DEFAULT_THINKING };
		// Sent now rather than with the next prompt, so the picker and the session agree at once.
		if (!this.streamingNow) await this.applyModel().catch((error: Error) => this.context.notice("warn", `OpenCode 2 would not switch model: ${error.message}`));
	}

	setThinking(level: ThinkingLevel): void {
		this.currentThinking = level;
		if (this.currentModel) this.currentModel = { ...this.currentModel, thinking: level };
	}

	mode(): AgentMode | undefined {
		return this.currentMode;
	}

	async setMode(mode: AgentMode): Promise<void> {
		this.currentMode = mode;
		// On this session only: a saved or server-wide rule would change every agent's posture.
		if (this.sessionId) {
			await this.client.session
				.update({ sessionID: this.sessionId, permissions: rulesOf(mode) } as never)
				.catch(() => this.context.notice("warn", "OpenCode 2 would not change its permissions, so this chat keeps the mode it had."));
		}
	}

	private read(reading: { context?: number | null; cost?: number }): void {
		const model = this.currentModel;
		const window = model ? (this.windows.get(`${model.provider}/${model.model}`) ?? 0) : 0;
		const last = this.lastUsage;
		this.lastUsage = {
			contextTokens: reading.context !== undefined ? reading.context : (last?.contextTokens ?? null),
			contextWindow: window,
			cost: reading.cost ?? last?.cost ?? 0,
		};
	}

	usage(): AgentUsage | null {
		return this.lastUsage;
	}

	// --- identity, isolation and the session tree ----------------------------------------

	name(): string | undefined {
		return this.storedName;
	}

	setName(name: string): void {
		this.storedName = name;
		if (this.sessionId) void this.client.session.update({ sessionID: this.sessionId, title: name } as never).catch(() => undefined);
	}

	sessionRef(): string | undefined {
		return this.sessionId;
	}

	/**
	 * Isolation on or off, in place: the session moves into the copy of the stage (or back to the
	 * deck), and the isolation note is a second session instruction beside the briefing.
	 */
	async setIsolation(isolation: IsolationContext | undefined): Promise<void> {
		const was = this.isolation;
		this.isolation = isolation;
		if (!this.sessionId) return;
		const to = isolation?.dir ?? this.directory;
		if ((was?.dir ?? this.directory) !== to) {
			await this.client.session
				.move({ sessionID: this.sessionId, directory: to, delivery: "queue" } as never)
				.catch((error: Error) => this.context.notice("warn", `OpenCode 2 would not move the chat: ${error.message}`));
		}
		if (isolation) await this.putInstruction(ISOLATION, isolationNote(isolation, this.context.stageAgent.inPlay()));
		else await this.client.session.instructions.entry.remove({ sessionID: this.sessionId, key: ISOLATION } as never).catch(() => undefined);
	}

	/**
	 * Tag each user message in the transcript with the OpenCode 2 message it became.
	 *
	 * The same walk as pi's and Claude's: from the end, because the transcript in memory is a
	 * capped tail and the two lists share a suffix, and stopping at the first message whose text
	 * disagrees, which costs one message its rewind and is the right way to be wrong.
	 */
	async syncEntryIds(): Promise<void> {
		if (!this.sessionId) return;
		let entries: Array<{ id: string; text: string }>;
		try {
			// The newest 200, which is OpenCode 2's ceiling for one page (it refuses more) and more
			// than the transcript's tail holds; asked newest first and turned round, since the walk
			// below needs the end of the list and not its start.
			const answered = (await this.client.message.list({ sessionID: this.sessionId, type: "user", order: "desc", limit: 200 } as never)) as unknown as {
				data?: Array<{ id: string; payload?: { text?: string }; text?: string }>;
			};
			entries = (answered.data ?? []).map((message) => ({ id: message.id, text: message.payload?.text ?? message.text ?? "" })).reverse();
		} catch {
			return;
		}
		const items = this.context.translator.userMessages();
		for (let offset = 1; offset <= Math.min(entries.length, items.length); offset += 1) {
			const entry = entries[entries.length - offset];
			const item = items[items.length - offset];
			if (!entry || !item) break;
			if (item.entryId === entry.id) continue;
			if (!sentAs(entry.text, item.text)) break;
			this.context.translator.tagUser(item.id, entry.id);
		}
	}

	/** The points worth returning to: the user's messages that `syncEntryIds` paired. */
	timeline(): ConversationPoint[] {
		return this.context.translator
			.userMessages()
			.filter((item) => item.entryId)
			.map((item) => ({ id: item.entryId as string, at: item.at }));
	}

	/**
	 * Nothing recorded, as for Claude: OpenCode 2 has no entry Decks can write a board revision
	 * into, and `App.boardsAt` falls back to the revision store's own times, which is how an
	 * empty map asks for it.
	 */
	revisionsAt(): Record<string, string> {
		return {};
	}

	/**
	 * Go back to just before a message, in place.
	 *
	 * OpenCode 2 reverts a session to a message in two steps, staged and then committed, and the
	 * session keeps its id. Files are left alone (`files: false`): Decks restores the boards from
	 * its own revisions, and OpenCode undoing the same files from its snapshots would be a second
	 * writer racing the first.
	 */
	async rewindTo(entryId: string): Promise<{ cancelled: boolean; editorText?: string }> {
		if (!this.sessionId) return { cancelled: true };
		if (this.streamingNow) throw new Error("Stop OpenCode 2 before rewinding.");
		const text = this.context.translator.userMessages().find((item) => item.entryId === entryId)?.text;
		try {
			await this.client.session.revert.stage({ sessionID: this.sessionId, messageID: entryId, files: false } as never);
			await this.client.session.revert.commit({ sessionID: this.sessionId } as never);
		} catch (error) {
			this.context.notice("warn", `OpenCode 2 would not rewind: ${(error as Error).message}`);
			return { cancelled: true };
		}
		return { cancelled: false, ...(text ? { editorText: text } : {}) };
	}

	/**
	 * Everything before a message, as a session of its own for a new chat to open. Before it, so
	 * the new chat opens with that message still unasked, as on pi and Claude.
	 */
	async forkFrom(entryId: string): Promise<string | undefined> {
		if (!this.sessionId) return undefined;
		const forked = (await this.client.session.fork({ sessionID: this.sessionId, before: entryId } as never).catch(() => undefined)) as { id?: string } | undefined;
		return forked?.id;
	}

	dispose(): void {
		this.closed = true;
		this.events?.abort();
		this.unwatchDeath?.();
		this.unwatchDeath = undefined;
		this.context.stageBridge?.unregisterSession(this.sessionId);
		const handle = this.handle;
		this.handle = undefined;
		handle?.release();
	}
}

function keyOf(model: { id: string; providerID: string; variant?: string }): string {
	return `${model.providerID}/${model.id}/${model.variant ?? ""}`;
}
