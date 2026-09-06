import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { AgentCapabilities, AgentMode, AgentModel, AgentUsage, ModelOption, SlashCommand, ThinkingLevel } from "@decks/protocol";
import type { AgentBackend, AgentBackendContext, ConversationPoint } from "../agents/backend.ts";
import { deckContext } from "../agents/context.ts";
import { helpText, mergeCommands, parseSlash } from "../agents/slash.ts";
import { DEFAULT_THINKING } from "@decks/protocol";
import { OpencodeStream } from "./events.ts";
import { rankedVariants, variantFor } from "./variants.ts";
import { opencodeManager, type OpencodeServerHandle } from "./manager.ts";

/**
 * opencode behind one Decks agent (DESIGN §6.1).
 *
 * opencode is an HTTP server with an SSE event stream, but — unlike pi and Claude — the
 * server is not this agent's: **all opencode agents on the deck share one `opencode
 * serve`** (`opencode/manager.ts`), and this backend is a *session and a subscription*
 * inside it. `session.create` opens a conversation on the shared server,
 * `event.subscribe` is the stream every reply, tool call and status change arrives on,
 * and `events.ts` turns those into the same transcript pi and Claude write.
 *
 * Three decisions are worth stating before the code.
 *
 * **The canvas tool is a file, not a closure.** opencode loads `tools/<name>.ts` from the
 * directory `OPENCODE_CONFIG_DIR` names, and Decks points that at `runtime/opencode/`,
 * which it ships. The tool body runs inside opencode's own Bun runtime and calls back over
 * HTTP — with the shared server's token and the session id opencode itself handed it, so
 * the bridge can say which agent is calling (`stage/bridge.ts`) — and it is a real tool
 * call in the transcript, drawn the way pi's and Claude's are, rather than a shell
 * command.
 *
 * **Nothing per agent lives in the server's config.** When each agent had its own
 * process, `OPENCODE_CONFIG_CONTENT` could carry that agent's model, mode and briefing on
 * the spawn. One shared server has no per-agent environment, so each of those moves to
 * where it can be per agent: the model rides on every prompt (it already did), the
 * permission mode is written onto *this session* — see `setMode`, and the deck briefing is
 * the one thing every agent on a deck genuinely shares, so it stays server-wide.
 *
 * The one honest caveat is the mode. opencode's SDK types only admit a title on
 * `session.update`, and a mode really is config-shaped in its core — so this was
 * investigated rather than assumed: opencode's own handler for `PATCH /session/{id}`
 * accepts a `permission` ruleset, the session stores it, and the session's rules are
 * evaluated *after* the config's and win (a `findLast` over the concatenation). Verified
 * against a live 1.18.29 server, not just read from the source. The cast below is the
 * SDK's type catching up with a server that grew a field its generator never saw.
 */

/** opencode asks before writes and commands, so three of Decks' four modes mean something. */
export const OPENCODE_CAPABILITIES: AgentCapabilities = { modes: ["manual", "acceptEdits", "auto"] };

/**
 * The `/` commands Decks interprets for an opencode agent.
 *
 * opencode has its own, which arrive from `command.list` once the server is up and are
 * merged under these. These five are the deck's in the sense the merge means: the ones
 * wired to something here rather than answered over there.
 */
export const OPENCODE_COMMANDS: SlashCommand[] = [
	{ name: "cost", hint: "Open the usage panel: spend, tokens, context", source: "deck" },
	{ name: "models", hint: "Which models this opencode install can reach", source: "deck" },
	{ name: "status", hint: "Model, mode, server and session", source: "deck" },
	{ name: "compact", hint: "Summarise the conversation so far", source: "deck" },
	{ name: "help", hint: "The commands Decks understands", source: "deck" },
];

/**
 * What Decks' modes mean to opencode.
 *
 * opencode's permission model is a set of per-tool answers rather than one mode word, so
 * the mapping is written out rather than guessed at each call site. `plan` is absent from
 * the capabilities above on purpose: opencode has a plan *agent* rather than a plan
 * permission, and offering a word for something that behaves differently is worse than not
 * offering it.
 */
const PERMISSIONS: Record<string, Record<string, "ask" | "allow">> = {
	manual: { edit: "ask", bash: "ask", webfetch: "ask" },
	acceptEdits: { edit: "allow", bash: "ask", webfetch: "allow" },
	auto: { edit: "allow", bash: "allow", webfetch: "allow" },
};

/**
 * A mode as opencode's `permission.updated` rule speaks it.
 *
 * `PERMISSIONS` is indexed by mode and read by hand at `setMode`; opencode's own types
 * want a ruleset of `{ permission, pattern, action }` triples, and the two shapes are
 * kept apart here rather than conflated at every call site.
 */
function rulesetOf(mode: AgentMode): Array<{ permission: string; pattern: string; action: "ask" | "allow" }> {
	return Object.entries(PERMISSIONS[mode] ?? PERMISSIONS.acceptEdits!).map(([permission, action]) => ({ permission, pattern: "*", action }));
}

const DEFAULT_MODE: AgentMode = "acceptEdits";

export class OpencodeBackend implements AgentBackend {
	readonly capabilities = OPENCODE_CAPABILITIES;

	/** Where the shared server is, once it is up — the same URL for every agent. */
	private url = "";
	/** This agent's claim on the shared server; released when the agent goes. */
	private handle: OpencodeServerHandle | undefined;
	private client!: OpencodeClient;
	private stream!: OpencodeStream;
	private sessionId: string | undefined;
	/** The manager's death listener for this agent; removed on dispose. */
	private unwatchDeath: (() => void) | undefined;
	/**
	 * The backend has detached from the shared server: disposed, or the server died under
	 * it. Either way no tool call or prompt should pretend the conversation is alive.
	 */
	private closed = false;
	private streamingNow = false;

	private currentModel: AgentModel | undefined;
	private currentMode: AgentMode = DEFAULT_MODE;
	private currentThinking: ThinkingLevel | undefined;
	private available: ModelOption[] = [];
	/** The level-variants each model declared, keyed `provider/model` — see `refreshModels`. */
	private variants = new Map<string, readonly ThinkingLevel[]>();
	private commandList: SlashCommand[] = OPENCODE_COMMANDS;
	private storedName: string | undefined;
	private lastUsage: AgentUsage | null = null;

	private constructor(private readonly context: AgentBackendContext) {}

	static async create(context: AgentBackendContext): Promise<OpencodeBackend> {
		const backend = new OpencodeBackend(context);
		await backend.start();
		return backend;
	}

	private async start(): Promise<void> {
		const { deck, translator } = this.context;
		this.currentModel = this.context.model;
		this.currentThinking = this.context.model?.thinking;
		this.currentMode = this.context.mode ?? DEFAULT_MODE;

		// The shared server, brought up by whoever was first and counted for this agent.
		// The briefing file is written first so the server's config can name it: the
		// instructions are a *path*, and opencode re-reads the file it points at on every
		// turn (`session/instruction.ts`), so one deck's briefing staying current as the
		// words change is the server's own doing.
		const handle = await opencodeManager.acquire({
			cwd: deck.path,
			stageUrl: `http://127.0.0.1:${this.context.port}/api/stage/eval`,
			config: { instructions: [this.briefingFile()] },
		});
		this.handle = handle;
		this.url = handle.url;
		const { token } = handle;
		// The server's token, told to the bridge before any tool call can arrive: a call
		// from this process is trusted because it carries the token the process holds, and
		// the bridge has to recognise it to trust it.
		this.context.stageBridge?.setServerToken(token);
		// A server that dies is every agent's problem at once. This agent gets told the
		// moment the process exits, rather than whenever its own stream happens to notice.
		this.unwatchDeath = opencodeManager.onExit(() => this.serverDied());

		this.client = createOpencodeClient({ baseUrl: this.url, directory: deck.path });

		// One session per agent, opened on the mode the chat was left in. The permission
		// rides on the session — see the module comment for why that is not a fiction —
		// and the model does not: it rides on every prompt below.
		const session = await this.client.session.create({
			body: {
				title: "Decks",
				permission: rulesetOf(this.currentMode),
			} as never,
		});
		this.sessionId = session.data?.id;
		if (!this.sessionId) throw new Error("opencode started but would not open a session.");

		// The canvas tool's calls name this session; the bridge resolves that to this
		// agent. Registered before the conversation can run a single turn.
		this.context.stageBridge?.registerSession(this.sessionId, this.context.stageAgent.id, this.context.tool);

		this.stream = new OpencodeStream(translator, this.sessionId, {
			idle: () => {
				this.streamingNow = false;
				this.context.turnEnded?.();
			},
			usage: (usage) => (this.lastUsage = usage),
			model: (provider, model) => (this.currentModel = { provider, model, thinking: this.currentThinking ?? DEFAULT_THINKING }),
		});
		void this.pump();

		await this.refreshModels();
		void this.refreshCommands();
	}

	/**
	 * The deck's description, written where opencode can read it.
	 *
	 * opencode's `instructions` are file paths, not prose, so the briefing every other
	 * runtime gets as a string has to become a file. It goes in the deck, hidden, because a
	 * temp file is a thing the agent is holding that the user cannot look at.
	 */
	private briefingFile(): string {
		const { deck, tool } = this.context;
		const path = resolve(deck.path, ".decks-agent.md");
		const text = [deckContext(deck, tool.name), "", ...tool.guidelines.map((line) => `- ${line}`)].join("\n");
		try {
			/*
			 * Only when it has changed, which is not an optimisation.
			 *
			 * The deck is watched, and a write to anything that is not a board makes every
			 * board on the canvas reload — a cost the watcher's own comment calls "cheap,
			 * and rare". Writing this unconditionally would make it once per agent start,
			 * which is neither: the user would watch the canvas blink every time a chat
			 * woke up. One file per deck, written when the words actually differ.
			 */
			if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text, "utf8");
		} catch {
			/* an unwritable deck is a thinner briefing, not a dead agent */
		}
		return path;
	}

	/**
	 * The shared server died under this agent.
	 *
	 * The manager told every agent at once — that is the point of the listener — and this
	 * agent's reaction is the same as it would have been to its own process dying: the
	 * session is unregistered so a stale id is refused, the chat stops pretending it is
	 * live, and the reason is said where the person is looking. Restarting the server
	 * does not revive this conversation — the chat needs restarting, exactly as the notice
	 * says.
	 */
	private serverDied(): void {
		if (this.closed) return;
		this.closed = true;
		this.streamingNow = false;
		this.context.stageBridge?.unregisterSession(this.sessionId);
		this.sessionId = undefined;
		this.context.translator.setState("idle");
		this.context.notice("error", "opencode exited. This chat needs restarting.");
	}

	private async pump(): Promise<void> {
		try {
			const events = await this.client.event.subscribe();
			for await (const event of events.stream as AsyncIterable<unknown>) {
				if (this.closed) return;
				this.stream.handle(event);
			}
		} catch (error) {
			if (this.closed) return;
			this.streamingNow = false;
			this.context.translator.setState("idle");
			// The stream stops for two reasons, and one of them already has a speaker: a
			// server that died is announced by `serverDied`, so this notice is only for the
			// stream that broke while the server is standing.
			if (opencodeManager.alive()) this.context.notice("error", `opencode's event stream stopped: ${(error as Error).message}`);
		}
	}

	// --- the conversation -------------------------------------------------------------

	get isStreaming(): boolean {
		return this.streamingNow;
	}

	async prompt(text: string): Promise<void> {
		const command = parseSlash(text);
		if (command) {
			await this.runSlash(command.name, command.args);
			return;
		}
		this.streamingNow = true;
		this.context.translator.setState("thinking");
		await this.send(text);
	}

	private async send(text: string): Promise<void> {
		const model = this.currentModel;
		const variant = this.currentVariant();
		await this.client.session.promptAsync({
			path: { id: this.sessionId! },
			body: {
				...(model ? { model: { providerID: model.provider, modelID: model.model } } : {}),
				// The level, as the variant this model offers — the server's `PromptInput`
				// takes it top-level and resolves it with `withVariant` (the generated
				// type has not caught up; the cast is the same gap `setMode` documents).
				// `undefined` says no level was asked, so opencode keeps its own default.
				...(variant ? { variant } : {}),
				parts: [{ type: "text", text }],
			},
		});
	}

	/**
	 * The variant the current level maps onto for the current model, or nothing.
	 *
	 * Undefined before a level has been chosen, and undefined for a model whose variants
	 * offer no level — see `variants.ts` for why those are the same answer.
	 */
	private currentVariant(): ThinkingLevel | undefined {
		if (this.currentThinking === undefined || !this.currentModel) return undefined;
		return variantFor(this.currentThinking, this.variants.get(`${this.currentModel.provider}/${this.currentModel.model}`));
	}

	async abort(): Promise<void> {
		this.streamingNow = false;
		if (this.sessionId) await this.client.session.abort({ path: { id: this.sessionId } }).catch(() => undefined);
		this.context.translator.setState("idle");
	}

	commands(): SlashCommand[] {
		return this.commandList;
	}

	private async refreshCommands(): Promise<void> {
		try {
			const answered = await this.client.command.list();
			const declared = (answered.data ?? []) as Array<{ name: string; description?: string }>;
			const runtime: SlashCommand[] = declared.map((command) => ({
				name: command.name,
				...(command.description ? { hint: command.description } : {}),
				source: "runtime" as const,
			}));
			this.commandList = mergeCommands(OPENCODE_COMMANDS, runtime);
			this.context.commandsChanged?.();
		} catch {
			/* a server too old to list commands is a shorter menu, not a broken agent */
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
						? "No models. Sign a provider in with `opencode auth login` in a terminal, then start a new chat."
						: this.available.map((option) => `${option.provider}/${option.model} — ${option.label}`).join("\n"),
				);
				return;
			case "status":
				notice(
					"info",
					`opencode · model ${this.currentModel ? `${this.currentModel.provider}/${this.currentModel.model}` : "default"} · mode ${this.currentMode} · ${this.currentVariant() ? `variant ${this.currentVariant()} · ` : ""}${this.url} · session ${this.sessionId ?? "none"}`,
				);
				return;
			case "compact":
				this.streamingNow = true;
				await this.client.session
					.summarize({ path: { id: this.sessionId! }, body: {} as never })
					.catch((error: Error) => notice("warn", `Could not summarise: ${error.message}`));
				return;
			case "help":
				notice("info", helpText(this.commands()));
				return;
			default:
				// opencode's own. Handed over as a prompt, which is how its core parses a
				// command out of one — the same bargain the pi backend makes.
				this.streamingNow = true;
				this.context.translator.setState("thinking");
				await this.send(`/${name}${args ? ` ${args}` : ""}`);
		}
	}

	// --- models and modes -------------------------------------------------------------

	model(): AgentModel | undefined {
		return this.currentModel;
	}

	async models(): Promise<ModelOption[]> {
		if (this.available.length === 0) await this.refreshModels();
		return this.available;
	}

	private async refreshModels(): Promise<void> {
		try {
			const answered = await this.client.config.providers();
			// The typed fields stop at the catalogue's old shape; the wire carries more —
			// notably `capabilities.reasoning` and the model's declared `variants` — and
			// both are read here rather than guessed. opencode resolves a reasoning level
			// as a **variant** the model declares (`variants.ts`), so a model whose list
			// has nothing on Decks' scale offers no level, whatever its capabilities say.
			const providers = (answered.data?.providers ?? []) as Array<{
				id: string;
				models: Record<string, { id: string; name?: string; capabilities?: { reasoning?: boolean }; variants?: Record<string, unknown> }>;
			}>;
			this.available = providers.flatMap((provider) =>
				Object.values(provider.models).map((model) => {
					const variants = rankedVariants(Object.keys(model.variants ?? {}));
					this.variants.set(`${provider.id}/${model.id}`, variants);
					return {
						provider: provider.id,
						model: model.id,
						label: model.name ?? model.id,
						// The control is worth offering only when there is something to
						// choose: a model that reasons but declares no variant that is a
						// level (a custom "fast" preset, or none at all) has no answer
						// to "how hard".
						reasoning: model.capabilities?.reasoning === true && variants.length > 0,
					};
				}),
			);
			if (!this.currentModel && this.available[0]) {
				this.currentModel = { provider: this.available[0].provider, model: this.available[0].model, thinking: DEFAULT_THINKING };
			}
			if (this.available.length === 0) {
				this.context.notice("warn", "opencode has no models available. Sign a provider in with `opencode auth login`, then start a new chat.");
			}
		} catch (error) {
			this.context.notice("warn", `Could not list opencode's models: ${(error as Error).message}`);
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

	async setMode(mode: AgentMode): Promise<void> {
		this.currentMode = mode;
		/*
		 * Written onto *this session*, not the server — which is exactly what the shared
		 * process changed. `config.update` with a permission was the per-process answer,
		 * and on one shared server it would change every opencode agent's posture at once,
		 * so it is gone. `PATCH /session/{id}` accepts the same ruleset and stores it on
		 * the session, where it is evaluated after the config's and wins; the session the
		 * chat is already holding keeps it, so nothing has to restart.
		 *
		 * The SDK's generated type for the update body only knows `title` — the field was
		 * read from opencode's own source and verified against a live 1.18.29 server, and
		 * the cast is that gap. A server that refuses says so once: the chat keeps
		 * answering, on the posture it already had, which is safer than pretending.
		 */
		if (this.sessionId) {
			await this.client.session
				.update({
					path: { id: this.sessionId },
					body: { permission: rulesetOf(mode) } as never,
				})
				.catch(() => this.context.notice("warn", "opencode would not change its permissions, so this chat keeps the mode it had."));
		}
	}

	usage(): AgentUsage | null {
		return this.lastUsage;
	}

	// --- identity and the session tree --------------------------------------------------

	name(): string | undefined {
		return this.storedName;
	}

	setName(name: string): void {
		this.storedName = name;
		if (this.sessionId) void this.client.session.update({ path: { id: this.sessionId }, body: { title: name } }).catch(() => undefined);
	}

	sessionRef(): string | undefined {
		return this.sessionId;
	}

	/**
	 * No time machine yet, and it is declared rather than stubbed to throw.
	 *
	 * opencode has `fork` and `revert`, so this is a *not yet* rather than a *cannot*. But a
	 * rewind in Decks also restores the boards to the revision they were at, which needs
	 * every user message paired with an id the server will still recognise afterwards. Until
	 * that pairing is real, an empty timeline is the honest answer: the messages offer no
	 * rewind rather than offering one that half works.
	 */
	timeline(): ConversationPoint[] {
		return [];
	}

	async syncEntryIds(): Promise<void> {}

	revisionsAt(): Record<string, string> {
		return {};
	}

	async rewindTo(): Promise<{ cancelled: boolean }> {
		return { cancelled: true };
	}

	async forkFrom(): Promise<string | undefined> {
		return undefined;
	}

	dispose(): void {
		this.closed = true;
		this.unwatchDeath?.();
		this.unwatchDeath = undefined;
		// The session stops answering the moment the agent goes: a tool call that arrives
		// on its tail is refused rather than run against a chat that is being torn down.
		this.context.stageBridge?.unregisterSession(this.sessionId);
		// The server itself is not this agent's to kill: the manager counts and the last
		// one out stops it. Released even when the server already died under this agent —
		// a claim against a dead server is a no-op by the time it surfaces.
		const handle = this.handle;
		this.handle = undefined;
		handle?.release();
	}
}