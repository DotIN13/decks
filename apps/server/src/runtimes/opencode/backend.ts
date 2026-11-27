import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { AgentCapabilities, AgentMode, ModelOption, SlashCommand } from "@decks/protocol";
import type { AgentBackendContext } from "../../agents/backend.ts";
import { agentBriefing } from "../../agents/context.ts";
import { DEFAULT_THINKING } from "@decks/protocol";
import { OpencodeStream } from "./events.ts";
import { rankedVariants } from "./variants.ts";
import { opencodeManager } from "./manager.ts";
import { DEFAULT_MODE, SharedServerBackend, type PermissionTable, type SessionCalls } from "../shared-server-backend.ts";

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
 * **The canvas is the `decks` command, and a session names its agent.** opencode loads its
 * tools and plugins from the directory `OPENCODE_CONFIG_DIR` names, and Decks points that at
 * `runtime/opencode/`, which it ships: the Google Docs tools, and a plugin that puts the session
 * in each shell command's environment (`DECKS_SESSION`), so a `decks` command reaches the agent
 * the bridge registered that session to (`canvas/bridge.ts`).
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

/**
 * opencode asks before writes and commands, so three of Decks' four modes mean something.
 *
 * A message mid-turn is taken at the turn's next step: `prompt_async` saves the message and joins
 * the session's running loop (`SessionPrompt.loop` -> `ensureRunning`), which reads the newest
 * user message before every step and does not stop until it has answered it.
 */
export const OPENCODE_CAPABILITIES: AgentCapabilities = { modes: ["manual", "acceptEdits", "auto"], steers: "next-step" };

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
const PERMISSIONS: PermissionTable = {
	manual: { edit: "ask", bash: "ask", webfetch: "ask", external_directory: "ask" },
	acceptEdits: { edit: "allow", bash: "ask", webfetch: "allow", external_directory: "allow" },
	auto: { edit: "allow", bash: "allow", webfetch: "allow", external_directory: "allow" },
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

export class OpencodeBackend extends SharedServerBackend {
	readonly capabilities = OPENCODE_CAPABILITIES;
	protected readonly runtimeName = "opencode";
	protected readonly deckCommands = OPENCODE_COMMANDS;
	protected readonly permissions = PERMISSIONS;
	protected readonly server = opencodeManager;
	protected readonly noModels = "No models. Sign a provider in with `opencode auth login` in a terminal, then start a new chat.";
	protected readonly signIn = "opencode auth login";

	private client!: OpencodeClient;
	private stream!: OpencodeStream;

	/** How this server is asked (`SharedServerBackend`): its own calls, and its own turns. */
	protected readonly calls: SessionCalls = {
		subscribe: async () => {
			const events = await this.client.event.subscribe();
			return events.stream as AsyncIterable<unknown>;
		},
		onEvent: (event) => this.stream.handle(event),
		say: async (text) => {
			this.streamingNow = true;
			this.context.translator.setState("thinking");
			await this.send(text);
		},
		runOwnCommand: async (name, args) => {
			// opencode's own. Handed over as a prompt, which is how its core parses a
			// command out of one — the same bargain the pi backend makes.
			this.streamingNow = true;
			this.context.translator.setState("thinking");
			await this.send(`/${name}${args ? ` ${args}` : ""}`);
		},
		/*
		 * Answered with the chat's mode (`SharedServerBackend.answerPermission`). `external_directory`
		 * is a rule in `PERMISSIONS` because with no rule it falls through to opencode's `ask` in
		 * every mode, and a request nobody answers is a turn that hangs.
		 */
		replyPermission: (sessionId, requestId, allowed) => {
			return this.client.postSessionIdPermissionsPermissionId({
				path: { id: sessionId, permissionID: requestId },
				body: { response: allowed ? "once" : "reject" },
			});
		},
		interrupt: (sessionId) => this.client.session.abort({ path: { id: sessionId } }),
		compact: (sessionId) => this.client.session.summarize({ path: { id: sessionId }, body: {} as never }),
		listCommands: async () => {
			const answered = await this.client.command.list();
			return (answered.data ?? []) as Array<{ name: string; description?: string }>;
		},
		listModels: async () => {
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
			return providers.flatMap((provider) =>
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
						...(model.capabilities?.reasoning === true && variants.length > 0 ? { levels: variants } : {}),
					};
				}),
			);
		},
		updatePermissions: (sessionId, mode) => {
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
			 * the cast is that gap.
			 */
			return this.client.session.update({ path: { id: sessionId }, body: { permission: rulesetOf(mode) } as never });
		},
		rename: (sessionId, name) => this.client.session.update({ path: { id: sessionId }, body: { title: name } }),
		/**
		 * The session's user messages. One thing is opencode's own: a revert is pending until the next
		 * prompt, and the reverted messages are still listed until then, so everything from the revert
		 * point on is left out, or the walk would stop on the first of them and pair nothing.
		 */
		userEntries: async (sessionId) => {
			const [session, listed] = await Promise.all([
				this.client.session.get({ path: { id: sessionId } }),
				this.client.session.messages({ path: { id: sessionId } }),
			]);
			const reverted = session.data?.revert?.messageID;
			const entries: Array<{ id: string; text: string }> = [];
			for (const message of listed.data ?? []) {
				if (reverted && message.info.id === reverted) break;
				if (message.info.role !== "user") continue;
				const text = message.parts
					.filter((part) => part.type === "text" && !(part as { synthetic?: boolean }).synthetic)
					.map((part) => (part as { text: string }).text)
					.join("");
				entries.push({ id: message.info.id, text });
			}
			return entries;
		},
		/**
		 * opencode's revert marks the session and drops the marked messages when the next prompt
		 * arrives, so the session keeps its id and the chat its place on the shared server. It also
		 * undoes file edits from its own snapshots, but only in a git project: a deck is not one, so
		 * the boards are left to Decks' own revisions, as on every other runtime.
		 */
		revert: async (sessionId, entryId) => {
			const answered = await this.client.session.revert({ path: { id: sessionId }, body: { messageID: entryId } });
			if (answered.error) throw new Error(JSON.stringify(answered.error).slice(0, 200));
		},
		/**
		 * opencode's fork copies the messages before the one named, so the new chat opens with that message
		 * still unasked, as on the other runtimes.
		 */
		fork: async (sessionId, entryId) => {
			const forked = await this.client.session.fork({ path: { id: sessionId }, body: { messageID: entryId } });
			return forked?.data?.id;
		},
	};

	private constructor(context: AgentBackendContext) {
		super(context);
	}

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
		// turn, so one deck's briefing staying current as the
		// words change is the server's own doing.
		const handle = await opencodeManager.acquire({
			cwd: deck.path,
			stageUrl: `http://127.0.0.1:${this.context.port}/api/stage/eval`,
			decksPort: this.context.port,
			config: { instructions: [this.briefingFile()] },
		});
		this.hold(handle);
		const { token } = handle;
		// The server's token, told to the bridge before any tool call can arrive: a call
		// from this process is trusted because it carries the token the process holds, and
		// the bridge has to recognise it to trust it.
		this.context.stageBridge?.setServerToken(token);

		this.client = createOpencodeClient({ baseUrl: this.url, directory: deck.path });

		this.sessionId = await this.openSession();

		// A `decks` command and the Google Docs tools name this session; the bridge resolves that to this
		// agent. Registered before the conversation can run a single turn.
		this.context.stageBridge?.registerSession(this.sessionId, this.context.stageAgent.id);

		this.stream = new OpencodeStream(translator, this.sessionId, {
			idle: () => {
				this.streamingNow = false;
				this.context.turnEnded?.();
			},
			usage: (usage) => (this.lastUsage = usage),
			model: (provider, model) => (this.currentModel = { provider, model, thinking: this.currentThinking ?? DEFAULT_THINKING }),
			permission: (id, asked, title) => void this.answerPermission(id, asked, title),
		});
		void this.pump();

		await this.refreshModels();
		void this.refreshCommands();
	}

	/**
	 * The session this chat talks in: the one it names, or a new one.
	 *
	 * A chat that was resting, or a fork opened as a new chat, carries on in the session it
	 * names (`resumeRef`), on the shared server that keeps every session in its own database. A
	 * new session is opened on the mode the chat was left in. The permission rides on the
	 * session either way (see the module comment for why that is not a fiction), and the model
	 * does not: it rides on every prompt.
	 */
	private async openSession(): Promise<string> {
		const resume = this.context.resumeRef;
		if (resume) {
			const found = await this.client.session.get({ path: { id: resume } }).catch(() => undefined);
			if (found?.data?.id) {
				await this.client.session.update({ path: { id: found.data.id }, body: { permission: rulesetOf(this.currentMode) } as never }).catch(() => undefined);
				return found.data.id;
			}
			this.context.notice("warn", "opencode no longer has this conversation, so the chat starts a new one.");
		}
		const session = await this.client.session.create({
			body: {
				title: "Decks",
				permission: rulesetOf(this.currentMode),
			} as never,
		});
		if (!session.data?.id) throw new Error("opencode started but would not open a session.");
		return session.data.id;
	}

	/**
	 * The deck's description, written where opencode can read it.
	 *
	 * opencode's `instructions` are file paths, not prose, so the briefing every other
	 * runtime gets as a string has to become a file. It goes in the deck, hidden, because a
	 * temp file is a thing the agent is holding that the user cannot look at.
	 */
	private briefingFile(): string {
		const { deck } = this.context;
		const path = resolve(deck.path, ".decks-agent.md");
		// Shared by every opencode agent in the deck.
		const text = agentBriefing(deck, this.context);
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

	// --- the conversation -------------------------------------------------------------

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

	// --- models and modes -------------------------------------------------------------

	// --- identity and the session tree --------------------------------------------------

}
