import type { AgentCapabilities, AgentMode, AgentModel, AgentUsage, ModelOption, SlashCommand, ThinkingLevel } from "@decks/protocol";
import { DEFAULT_THINKING } from "@decks/protocol";
import type { AgentBackend, AgentBackendContext, ConversationPoint } from "../agents/backend.ts";
import { pairUserEntries, translatorTimeline } from "../agents/entries.ts";
import { deckSlash, mergeCommands, parseSlash, type DeckSlashFacts } from "../agents/slash.ts";
import { variantFor } from "./opencode/variants.ts";

/**
 * An agent that is one session on a server every agent of its runtime shares.
 *
 * opencode (`opencode/backend.ts`) and OpenCode 2 (`opencode2/backend.ts`) are the same product
 * against two servers that speak differently: one `serve` process for the deck
 * (`shared-server.ts`), a session per agent inside it, and a filtered view of the server's one
 * event stream. Everything that follows from that shape, rather than from either server's
 * calls, is here: what a dead server or a broken stream does to the chat, answering a permission
 * with the chat's mode, the deck's commands, the model list's defaults, and the session tree
 * (pairing, rewind, fork). Each subclass starts its session and says how its server is asked;
 * the two used to carry all of this twice, and the copies had begun to drift.
 */

/** What Decks' modes mean to the runtime, per permission it asks about. */
export type PermissionTable = Record<string, Record<string, "ask" | "allow">>;

/** A chat with no mode of its own asks before commands and allows edits. */
export const DEFAULT_MODE: AgentMode = "acceptEdits";

/** What a subclass tells the base about the shared server it claimed. */
interface ServerWatch {
	/** Told when the server dies under its agents; answers a function that stops telling. */
	onExit(listener: () => void): () => void;
	alive(): boolean;
}

/**
 * How one server is asked, and what a turn is on it: everything that differs between opencode
 * and OpenCode 2 apart from starting a session. A subclass gives these as one object rather
 * than as methods, so the class says what is shared and this list says what is not.
 */
export interface SessionCalls {
	/** The server's event stream, every agent's events in it. */
	subscribe(): Promise<AsyncIterable<unknown>>;
	/** One event off the stream, for this agent's view of it (`events.ts`). */
	onEvent(event: unknown): void;
	/** A person's message, as a turn. */
	say(text: string): Promise<void>;
	/** A command that is the runtime's own rather than the deck's. */
	runOwnCommand(name: string, args: string): Promise<void>;
	replyPermission(sessionId: string, requestId: string, allowed: boolean): Promise<unknown>;
	interrupt(sessionId: string): Promise<unknown>;
	compact(sessionId: string): Promise<unknown>;
	listCommands(): Promise<Array<{ name: string; description?: string }>>;
	/** The models the server offers, with the backend's `variants` filled in on the way. */
	listModels(): Promise<ModelOption[]>;
	/** A look at a fresh model list, before the first model becomes the default. */
	afterModelsListed?(): void;
	updatePermissions(sessionId: string, mode: AgentMode): Promise<unknown>;
	rename(sessionId: string, name: string): Promise<unknown>;
	/** The session's user messages a person typed, oldest first, with the text each was sent as. */
	userEntries(sessionId: string): Promise<Array<{ id: string; text: string }>>;
	/** Take the session back to just before a message, in place; throws when the server will not. */
	revert(sessionId: string, entryId: string): Promise<void>;
	/** A new session holding everything before a message. */
	fork(sessionId: string, entryId: string): Promise<string | undefined>;
}

export abstract class SharedServerBackend implements AgentBackend {
	abstract readonly capabilities: AgentCapabilities;
	/** What the person calls the runtime in its messages: `opencode`, `OpenCode 2`. */
	protected abstract readonly runtimeName: string;
	/** The `/` commands Decks interprets; the server's own are merged under these. */
	protected abstract readonly deckCommands: SlashCommand[];
	protected abstract readonly permissions: PermissionTable;
	/** The manager of the shared server, for its death and for reading a broken stream. */
	protected abstract readonly server: ServerWatch;
	/** What `/models` says when there are none, with how to sign a provider in. */
	protected abstract readonly noModels: string;
	/** The terminal command that signs a provider in, for the warning at start. */
	protected abstract readonly signIn: string;
	protected abstract readonly calls: SessionCalls;

	/** Where the shared server is, once it is up: the same URL for every agent. */
	protected url = "";
	protected sessionId: string | undefined;
	/**
	 * The backend has detached from the shared server: disposed, or the server died under it.
	 * Either way no tool call or prompt should pretend the conversation is alive.
	 */
	protected closed = false;
	protected streamingNow = false;

	protected currentModel: AgentModel | undefined;
	protected currentMode: AgentMode = DEFAULT_MODE;
	protected currentThinking: ThinkingLevel | undefined;
	protected available: ModelOption[] = [];
	/** The level-variants each model declared, keyed `provider/model` (`opencode/variants.ts`). */
	protected readonly variants = new Map<string, readonly ThinkingLevel[]>();
	protected lastUsage: AgentUsage | null = null;
	/** The deck's commands with the server's merged under them, once the server has listed its own. */
	private commandList: SlashCommand[] | undefined;
	private storedName: string | undefined;
	/** This agent's claim on the shared server; released when the agent goes. */
	private claim: { release(): void } | undefined;
	/** The manager's death listener for this agent; removed on dispose. */
	private unwatchDeath: (() => void) | undefined;

	protected constructor(protected readonly context: AgentBackendContext) {}

	// --- the shared server ---------------------------------------------------------------

	/** Hold a claim on the shared server and hear about its death. */
	protected hold(claim: { url: string; release(): void }): void {
		this.claim = claim;
		this.url = claim.url;
		// A server that dies is every agent's problem at once. This agent gets told the moment the
		// process exits, rather than whenever its own stream happens to notice.
		this.unwatchDeath = this.server.onExit(() => this.serverDied());
	}

	/**
	 * The shared server died under this agent.
	 *
	 * The manager told every agent at once, and this agent's reaction is the same as it would have
	 * been to its own process dying: the session is unregistered so a stale id is refused, the
	 * chat stops pretending it is live, and the reason is said where the person is looking.
	 * Restarting the server does not revive this conversation; the chat needs restarting, exactly
	 * as the notice says.
	 */
	private serverDied(): void {
		if (this.closed) return;
		this.closed = true;
		this.streamingNow = false;
		this.context.canvasBridge?.unregisterSession(this.sessionId);
		this.sessionId = undefined;
		this.context.translator.setState("idle");
		this.context.notice("error", `${this.runtimeName} exited. This chat needs restarting.`);
	}

	protected async pump(): Promise<void> {
		try {
			for await (const event of await this.calls.subscribe()) {
				if (this.closed) return;
				this.calls.onEvent(event);
			}
		} catch (error) {
			if (this.closed) return;
			this.streamingNow = false;
			this.context.translator.setState("idle");
			// The stream stops for two reasons, and one of them already has a speaker: a server that
			// died is announced by `serverDied`, so this notice is only for the stream that broke
			// while the server is standing.
			if (this.server.alive()) this.context.notice("error", `${this.runtimeName}'s event stream stopped: ${(error as Error).message}`);
		}
	}

	// --- the conversation ----------------------------------------------------------------

	/**
	 * Answer a permission request with this agent's mode.
	 *
	 * The server holds the tool call until somebody replies, so a request that is only noticed is
	 * a request that hangs: an agent told to look at a screenshot it had written to `/tmp` sat on
	 * `external_directory` until the request was answered by hand. There is no dialog here, so the
	 * mode is the answer: what the mode allows is allowed once, and what it leaves to the person is
	 * refused, and said out loud rather than left as a silence that reads like a stall. Never
	 * "always": a saved answer can reach every other agent on the deck.
	 */
	protected async answerPermission(id: string, asked: string, title: string | undefined): Promise<void> {
		if (!this.sessionId) return;
		const allowed = this.permissions[this.currentMode]?.[asked] === "allow";
		await this.calls.replyPermission(this.sessionId, id, allowed).catch(() => undefined);
		if (!allowed) this.context.notice("info", `Refused to ${title ?? asked}: ${this.currentMode} mode asks first, and there is no one to ask.`);
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
		await this.calls.say(text);
	}

	/**
	 * The variant the current level maps onto for the current model, or nothing.
	 *
	 * Undefined before a level has been chosen, and undefined for a model whose variants offer no
	 * level; see `variants.ts` for why those are the same answer.
	 */
	protected currentVariant(): ThinkingLevel | undefined {
		if (this.currentThinking === undefined || !this.currentModel) return undefined;
		return variantFor(this.currentThinking, this.variants.get(`${this.currentModel.provider}/${this.currentModel.model}`));
	}

	async abort(): Promise<void> {
		this.streamingNow = false;
		if (this.sessionId) await this.calls.interrupt(this.sessionId).catch(() => undefined);
		this.context.translator.setState("idle");
	}

	commands(): SlashCommand[] {
		return this.commandList ?? this.deckCommands;
	}

	protected async refreshCommands(): Promise<void> {
		try {
			const runtime: SlashCommand[] = (await this.calls.listCommands()).map((command) => ({
				name: command.name,
				...(command.description ? { hint: command.description } : {}),
				source: "runtime" as const,
			}));
			this.commandList = mergeCommands(this.deckCommands, runtime);
			this.context.commandsChanged?.();
		} catch {
			/* a server too old to list commands is a shorter menu, not a broken agent */
		}
	}

	/** What `/status`, `/models` and `/help` say. */
	private slashFacts(): DeckSlashFacts {
		return {
			runtime: this.runtimeName,
			commands: () => this.commands(),
			status: () => {
				const level = this.currentVariant();
				return [
					`model ${this.currentModel ? `${this.currentModel.provider}/${this.currentModel.model}` : "default"}`,
					`mode ${this.currentMode}`,
					level ? `level ${level}` : undefined,
					this.url,
					`session ${this.sessionId ?? "none"}`,
				];
			},
			models: () => (this.available.length === 0 ? this.noModels : this.available.map((option) => `${option.provider}/${option.model}: ${option.label}`).join("\n")),
		};
	}

	private async runSlash(name: string, args: string): Promise<void> {
		if (name === "compact") {
			// No session, nothing to summarise; and a failed summary must not leave the chat busy.
			if (!this.sessionId) return;
			this.streamingNow = true;
			await this.calls.compact(this.sessionId).catch((error: Error) => {
				this.streamingNow = false;
				this.context.notice("warn", `Could not summarise: ${error.message}`);
			});
			return;
		}
		// `/cost`, `/models`, `/status` and `/help` are the deck's, answered as on every runtime (`agents/slash.ts`).
		if (await deckSlash(name, this.context, this.slashFacts())) return;
		await this.calls.runOwnCommand(name, args);
	}

	// --- models and modes ----------------------------------------------------------------

	model(): AgentModel | undefined {
		return this.currentModel;
	}

	async models(): Promise<ModelOption[]> {
		if (this.available.length === 0) await this.refreshModels();
		return this.available;
	}

	protected async refreshModels(): Promise<void> {
		try {
			this.available = await this.calls.listModels();
			this.calls.afterModelsListed?.();
			if (!this.currentModel && this.available[0]) {
				this.currentModel = { provider: this.available[0].provider, model: this.available[0].model, thinking: DEFAULT_THINKING };
			}
			if (this.available.length === 0) {
				this.context.notice("warn", `${this.runtimeName} has no models available. Sign a provider in with \`${this.signIn}\`, then start a new chat.`);
			}
		} catch (error) {
			this.context.notice("warn", `Could not list ${this.runtimeName}'s models: ${(error as Error).message}`);
		}
	}

	async setModel(provider: string, model: string, thinking?: ThinkingLevel): Promise<void> {
		this.currentThinking = thinking ?? this.currentThinking;
		this.currentModel = { provider, model, thinking: this.currentThinking ?? DEFAULT_THINKING };
	}

	setThinking(level: ThinkingLevel): void {
		this.currentThinking = level;
		if (this.currentModel) this.currentModel = { ...this.currentModel, thinking: level };
	}

	mode(): AgentMode | undefined {
		return this.currentMode;
	}

	/**
	 * Written onto *this session*, never the server: on one shared server a server-wide rule
	 * would change every agent's posture at once. A server that refuses says so once, and the
	 * chat keeps answering on the posture it already had, which is safer than pretending.
	 */
	async setMode(mode: AgentMode): Promise<void> {
		this.currentMode = mode;
		if (this.sessionId) {
			await this.calls.updatePermissions(this.sessionId, mode).catch(() =>
				this.context.notice("warn", `${this.runtimeName} would not change its permissions, so this chat keeps the mode it had.`),
			);
		}
	}

	usage(): AgentUsage | null {
		return this.lastUsage;
	}

	// --- identity and the session tree ---------------------------------------------------

	name(): string | undefined {
		return this.storedName;
	}

	setName(name: string): void {
		this.storedName = name;
		if (this.sessionId) void this.calls.rename(this.sessionId, name).catch(() => undefined);
	}

	sessionRef(): string | undefined {
		return this.sessionId;
	}

	/** Tag each user message in the transcript with the session message it became (`agents/entries.ts`). */
	async syncEntryIds(): Promise<void> {
		if (!this.sessionId) return;
		let entries: Array<{ id: string; text: string }>;
		try {
			entries = await this.calls.userEntries(this.sessionId);
		} catch {
			return;
		}
		pairUserEntries(
			this.context.translator,
			entries.map((entry) => ({ id: entry.id, content: entry.text })),
		);
	}

	/** The points worth returning to: the user's messages that `syncEntryIds` paired. */
	timeline(): ConversationPoint[] {
		return translatorTimeline(this.context.translator);
	}

	/**
	 * Go back to just before a message, in place: the session keeps its id and the chat its place
	 * on the shared server. The cards are left to Decks' own revisions, as on every runtime.
	 */
	async rewindTo(entryId: string): Promise<{ cancelled: boolean; editorText?: string }> {
		if (!this.sessionId) return { cancelled: true };
		if (this.streamingNow) throw new Error(`Stop ${this.runtimeName} before rewinding.`);
		const text = this.context.translator.userMessages().find((item) => item.entryId === entryId)?.text;
		try {
			await this.calls.revert(this.sessionId, entryId);
		} catch (error) {
			this.context.notice("warn", `${this.runtimeName} would not rewind: ${(error as Error).message}`);
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
		return this.calls.fork(this.sessionId, entryId).catch(() => undefined);
	}

	dispose(): void {
		this.closed = true;
		this.unwatchDeath?.();
		this.unwatchDeath = undefined;
		// The session stops answering the moment the agent goes: a tool call that arrives on its
		// tail is refused rather than run against a chat that is being torn down.
		this.context.canvasBridge?.unregisterSession(this.sessionId);
		// The server itself is not this agent's to kill: the manager counts and the last one out
		// stops it. Released even when the server already died under this agent; a claim against a
		// dead server is a no-op by the time it surfaces.
		const claim = this.claim;
		this.claim = undefined;
		claim?.release();
	}
}
