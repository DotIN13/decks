import { skillsDir, opencode2PluginDir } from "@decks/runtime";
import type { AgentCapabilities, AgentMode, SlashCommand, ThinkingLevel } from "@decks/protocol";
import { DEFAULT_THINKING } from "@decks/protocol";
import type { AgentBackendContext } from "../../agents/backend.ts";
import { agentBriefing } from "../../agents/context.ts";
// The level vocabulary is Decks' own and the same for both opencodes, so it is read from there
// rather than copied: it maps Decks' scale onto whatever variant names a model declares.
import { rankedVariants } from "../opencode/variants.ts";
import { connect, offerKeys, type Opencode2Client } from "./client.ts";
import { Opencode2Stream } from "./events.ts";
import { opencode2Manager } from "./manager.ts";
import { DEFAULT_MODE, SharedServerBackend, type PermissionTable, type SessionCalls } from "../shared-server-backend.ts";

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
 *   standing text, and it is per session.
 * - **The model and level are the session's**, set with `switchModel`, not riders on each
 *   prompt; so a change is sent only when it is one.
 * - **A turn's end is `session.execution.*`**, which `events.ts` reads.
 * - **Permissions are `{ action, resource, effect }` rules on the session**, and `bash` is
 *   called `shell`. The session's rules come after the agent's and the last match wins, so the
 *   mode set here is the one that applies.
 */

/**
 * OpenCode 2 asks before writes and commands, so three of Decks' four modes mean something. A
 * message mid-turn steers it (`delivery: "steer"`).
 */
export const OPENCODE2_CAPABILITIES: AgentCapabilities = { modes: ["manual", "acceptEdits", "auto"], steers: "now" };

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
const PERMISSIONS: PermissionTable = {
	manual: { edit: "ask", shell: "ask", webfetch: "ask", external_directory: "ask" },
	acceptEdits: { edit: "allow", shell: "ask", webfetch: "allow", external_directory: "allow" },
	auto: { edit: "allow", shell: "allow", webfetch: "allow", external_directory: "allow" },
};

function rulesOf(mode: AgentMode): Array<{ action: string; resource: string; effect: "ask" | "allow" }> {
	return Object.entries(PERMISSIONS[mode] ?? PERMISSIONS.acceptEdits!).map(([action, effect]) => ({ action, resource: "*", effect }));
}

/** The key of this agent's session instruction. */
const BRIEFING = "decks";

export class Opencode2Backend extends SharedServerBackend {
	readonly capabilities = OPENCODE2_CAPABILITIES;
	protected readonly runtimeName = "OpenCode 2";
	protected readonly deckCommands = OPENCODE2_COMMANDS;
	protected readonly permissions = PERMISSIONS;
	protected readonly server = opencode2Manager;
	protected readonly noModels = "No models. Sign a provider in with `opencode2 auth`, then start a new chat.";
	protected readonly signIn = "opencode2 auth";

	private client!: Opencode2Client;
	private stream!: Opencode2Stream;
	private events: AbortController | undefined;
	/** The model and variant the session was last switched to, so a switch is sent only when it changes. */
	private applied = "";
	/** Per `provider/model`: its context window. */
	private windows = new Map<string, number>();

	/** How this server is asked (`SharedServerBackend`): its own calls, and its own turns. */
	protected readonly calls: SessionCalls = {
		subscribe: async () => {
			this.events = new AbortController();
			return this.client.event.subscribe({ signal: this.events.signal } as never) as AsyncIterable<unknown>;
		},
		onEvent: (event) => this.stream.handle(event),
		say: (text) => this.send(text),
		runOwnCommand: async (name, args) => {
			// OpenCode 2's own command, run as one: a prompt starting with `/` is not parsed
			// into a command by the v2 server.
			if (!this.sessionId) return;
			await this.applyModel();
			this.streamingNow = true;
			this.context.translator.setState("thinking");
			await this.client.session.command({ sessionID: this.sessionId, name, text: args } as never).catch((error: Error) => {
				this.streamingNow = false;
				this.context.translator.setState("idle");
				this.context.notice("warn", `OpenCode 2 would not run /${name}: ${error.message}`);
			});
		},
		replyPermission: (sessionId, requestId, allowed) => this.client.permission.reply({ sessionID: sessionId, requestID: requestId, decision: allowed ? "once" : "reject" } as never),
		interrupt: (sessionId) => this.client.session.interrupt({ sessionID: sessionId } as never),
		compact: (sessionId) => this.client.session.compact({ sessionID: sessionId } as never),
		listCommands: async () => {
			const answered = (await this.client.command.list(this.location as never)) as unknown as { data?: Array<{ name: string; description?: string }> };
			return answered.data ?? [];
		},
		listModels: async () => {
			const answered = (await this.client.model.list(this.location as never)) as unknown as {
				data?: Array<{ id: string; providerID: string; name?: string; enabled?: boolean; variants?: Array<{ id: string }>; limit?: { context?: number } }>;
			};
			const models = (answered.data ?? []).filter((model) => model.enabled !== false);
			return models.map((model) => {
				const key = `${model.providerID}/${model.id}`;
				// A level is offered only when the model's variants include one on Decks' scale;
				// OpenCode 2 no longer says "reasoning" on a model, so the variants are the answer.
				const levels = rankedVariants((model.variants ?? []).map((variant) => variant.id));
				this.variants.set(key, levels);
				if (model.limit?.context) this.windows.set(key, model.limit.context);
				return { provider: model.providerID, model: model.id, label: model.name ?? model.id, reasoning: levels.length > 0 };
			});
		},
		afterModelsListed: () => {
			// A chat restored onto a model that no longer exists starts on the first one there is,
			// and says so, rather than failing its first prompt.
			const wanted = this.currentModel;
			if (wanted && !this.available.some((option) => option.provider === wanted.provider && option.model === wanted.model)) {
				if (this.available.length > 0) this.context.notice("warn", `${wanted.provider}/${wanted.model} is not available in OpenCode 2, so this chat uses another model.`);
				this.currentModel = undefined;
			}
		},
		updatePermissions: (sessionId, mode) => this.client.session.update({ sessionID: sessionId, permissions: rulesOf(mode) } as never),
		rename: (sessionId, name) => this.client.session.update({ sessionID: sessionId, title: name } as never),
		userEntries: async (sessionId) => {
			// The newest 200, which is OpenCode 2's ceiling for one page (it refuses more) and more
			// than the transcript's tail holds; asked newest first and turned round, since the walk
			// below needs the end of the list and not its start.
			const answered = (await this.client.message.list({ sessionID: sessionId, type: "user", order: "desc", limit: 200 } as never)) as unknown as {
				data?: Array<{ id: string; payload?: { text?: string }; text?: string }>;
			};
			return (answered.data ?? []).map((message) => ({ id: message.id, text: message.payload?.text ?? message.text ?? "" })).reverse();
		},
		/**
		 * OpenCode 2 reverts a session to a message in two steps, staged and then committed, and the
		 * session keeps its id. Files are left alone (`files: false`): Decks restores the cards from
		 * its own revisions, and OpenCode undoing the same files from its snapshots would be a second
		 * writer racing the first.
		 */
		revert: async (sessionId, entryId) => {
			await this.client.session.revert.stage({ sessionID: sessionId, messageID: entryId, files: false } as never);
			await this.client.session.revert.commit({ sessionID: sessionId } as never);
		},
		fork: async (sessionId, entryId) => {
			const forked = (await this.client.session.fork({ sessionID: sessionId, before: entryId } as never)) as { id?: string } | undefined;
			return forked?.id;
		},
	};

	private constructor(context: AgentBackendContext) {
		super(context);
	}

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
			decksUrl: `http://127.0.0.1:${this.context.port}/api/canvas/eval`,
			decksPort: this.context.port,
			config: { plugins: [opencode2PluginDir()], skills: [skillsDir()] },
		});
		this.hold(handle);
		// The bridge learns the server's token before any tool call can arrive.
		this.context.canvasBridge?.setServerToken(handle.secret, "opencode2");
		this.client = connect(this.url, handle.secret);

		// Keys first, so the model list below already has them on a first start.
		const added = await offerKeys(this.client, this.url, this.directory);
		if (added.length > 0) this.context.notice("info", `OpenCode 2 now has your opencode 1 key for ${added.join(", ")}.`);

		await this.refreshModels();
		this.sessionId = await this.openSession();

		// A `decks` command and the Google Docs tools name this session; the bridge resolves that to this agent.
		this.context.canvasBridge?.registerSession(this.sessionId, this.context.toolAgent.id, "opencode2");
		await this.putInstruction(BRIEFING, this.briefing());

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
		return agentBriefing(this.context.deck, this.context);
	}

	private async putInstruction(key: string, value: string): Promise<void> {
		if (!this.sessionId) return;
		await this.client.session.instructions.entry
			.put({ sessionID: this.sessionId, key, value } as never)
			.catch((error: Error) => this.context.notice("warn", `OpenCode 2 would not take the deck's instructions: ${error.message}`));
	}

	// --- the conversation ---------------------------------------------------------------

	/** Allowed once or refused (`SharedServerBackend.answerPermission`); in OpenCode 2 a saved answer is the project's. */

	private async send(text: string): Promise<void> {
		if (!this.sessionId) throw new Error("This OpenCode 2 chat is not connected any more. Start it again.");
		await this.applyModel();
		/*
		 * Mid-turn input steers, as it does on pi: the person is correcting what they watch. Input
		 * to an idle chat is queued instead, because a steer jumps the queue.
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

	// --- models and modes ---------------------------------------------------------------

	override async setModel(provider: string, model: string, thinking?: ThinkingLevel): Promise<void> {
		await super.setModel(provider, model, thinking);
		// Sent now rather than with the next prompt, so the picker and the session agree at once.
		if (!this.streamingNow) await this.applyModel().catch((error: Error) => this.context.notice("warn", `OpenCode 2 would not switch model: ${error.message}`));
	}

	/** On this session only: a saved or server-wide rule would change every agent's posture. */

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

	// --- identity and the session tree ----------------------------------------

	override dispose(): void {
		super.dispose();
		this.events?.abort();
	}
}

function keyOf(model: { id: string; providerID: string; variant?: string }): string {
	return `${model.providerID}/${model.id}/${model.variant ?? ""}`;
}
