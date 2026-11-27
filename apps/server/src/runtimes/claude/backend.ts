import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
import type { AgentCapabilities, AgentMode, AgentModel, AgentUsage, ModelOption, SlashCommand, ThinkingLevel, UsageReport } from "@decks/protocol";
import type { AgentBackend, AgentBackendContext, ConversationPoint } from "../../agents/backend.ts";
import { deckSlash, mergeCommands, parseSlash, sameCommands, type DeckSlashFacts } from "../../agents/slash.ts";
import { pairUserEntries, translatorTimeline } from "../../agents/entries.ts";
import { answerQuestions } from "./ask-user-question.ts";
import { runtimeDir } from "@decks/runtime";
import { agentBriefing } from "../../agents/context.ts";
import { claudeAvailability, claudeExecutable } from "./available.ts";
import { handleClaudeMessage, newStreamState } from "./events.ts";
import { ClaudeRecovery, type RecoveryAction } from "./recovery.ts";
import { claudeAuthStatus, runClaudeCommand } from "./auth-command.ts";
import { DECKS_COMMAND_RULES, decksMcpServer, gdocsToolNames } from "./tools.ts";
import { gdocsCaller } from "../../google/agent-tools.ts";
import { decksEnv } from "../decks-env.ts";
import { ClaudeUsageReader } from "./usage-reader.ts";

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
 * guidelines every agent is given (`calls/tool.ts`, likewise).
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

export const CLAUDE_CAPABILITIES: AgentCapabilities = { modes: ["manual", "acceptEdits", "plan", "auto"], steers: "next-step", accounts: true };

/**
 * The `/` commands a Claude agent can run, and every one is the deck's own.
 *
 * The CLI does not parse slash commands out of prompts it is handed — `/login` comes
 * back as the model answering "not available in this environment" — so there is no
 * pass-through here. What works headless is what Decks interprets: `/login` drives the
 * CLI's own `auth login` through the dock's dialogs, `/logout` runs `auth logout`, and
 * the rest read state the backend already has.
 */
const CLAUDE_DECK_COMMANDS: SlashCommand[] = [
	{ name: "login", hint: "Sign in with a subscription or an API account", source: "deck" },
	{ name: "logout", hint: "Sign out of Claude", source: "deck" },
	{ name: "status", hint: "Model, mode and auth state", source: "deck" },
	// `/cost` opens the panel, and Claude resolves its own `/cost` to `/usage` — claimed
	// as an alias so the merge does not list that one beside this one.
	{ name: "cost", hint: "Open the usage panel: plan limits, spend, context", source: "deck", aliases: ["usage", "stats"] },
	{ name: "help", hint: "The commands Decks understands", source: "deck" },
];

/**
 * What a chat offers before its runtime has answered.
 *
 * The deck's five, plus the two pass-through commands worth having in a dormant chat's
 * menu. Once the session is up this is replaced by the CLI's own list — sixty-odd
 * commands, skills and the project's own `commands/` included — merged over the same
 * five. See `refreshCommands`.
 */
export const CLAUDE_COMMANDS: SlashCommand[] = [
	...CLAUDE_DECK_COMMANDS,
	{ name: "compact", hint: "Compress the conversation", arg: "[notes]", source: "runtime" },
	{ name: "doctor", hint: "Check the Claude Code install", source: "runtime" },
];

/**
 * Cards are the medium, so edits inside the deck proceed unasked.
 *
 * A confirm per card write would make the app unusable — writing cards is what the agent
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
	/**
	 * Which query's input is live. Bumped by every `startQuery`, so a generator left from the
	 * query a restart replaced ends instead of parking again: `closed` is already false by the
	 * time it wakes, and two generators sharing `queue` and `wake` meant the next prompt could
	 * go to the dead query, leaving the agent thinking for good.
	 */
	private feed = 0;
	private streaming = false;
	private pump: Promise<void> | undefined;

	private sessionId: string | undefined;
	private currentMode: AgentMode = DEFAULT_MODE;
	private currentModel: string | undefined;
	private currentThinking: ThinkingLevel | undefined;
	private available: ModelInfo[] = [];
	/** The figures after each turn, the usage panel's reading and the rate-limit warnings (`usage-reader.ts`). */
	private readonly reading: ClaudeUsageReader;
	private storedName: string | undefined;
	private title: string | undefined;
	/** The `/` menu: the deck's own, with whatever the CLI declares merged under them. */
	private commandList: SlashCommand[] = CLAUDE_COMMANDS;
	/**
	 * The account this session's process was started on. A switch reaches its *turns* (the CLI
	 * reads the credentials again for every message) but not its usage read, which keeps the
	 * login the process started with — so `report` asks a fresh process once the agent has moved.
	 */
	private startedOn: string | undefined;
	/** What happens when a turn ends and it was not the whole story: a stale session, a busy login, an account move, a sign-in (`recovery.ts`). */
	private readonly recovery: ClaudeRecovery;

	private constructor(private readonly context: AgentBackendContext) {
		this.reading = new ClaudeUsageReader(context, () => this.session, () => this.startedOn);
		this.recovery = new ClaudeRecovery(context, () => this.onOtherAccount());
		/*
		 * A resumed conversation opens on the model and mode it was last held in.
		 *
		 * `startQuery` already passes both to the SDK; what was missing was anything to
		 * pass. `currentModel` started undefined, so `available[0]` — Claude Code's
		 * "default" entry — won every time, and a chat left on Opus came back on whatever
		 * the CLI picks. Assigned here rather than in `startQuery` because that runs again
		 * after a rewind, and by then these hold the live answer.
		 */
		if (context.model?.provider === PROVIDER) {
			this.currentModel = context.model.model;
			this.currentThinking = context.model.thinking;
		}
		if (context.mode) this.currentMode = context.mode;
	}

	static async create(context: AgentBackendContext): Promise<ClaudeBackend> {
		const availability = claudeAvailability();
		// Checked before starting, so the failure is a sentence about Claude Code rather
		// than the SDK's message about a platform package nobody asked for.
		if (!availability.available) throw new Error(availability.reason);
		const backend = new ClaudeBackend(context);
		await backend.startQuery(context.resumeRef);
		// A Claude install with no credentials fails on its first real turn; say where
		// /login lives before that happens. Fire-and-forget: it is a hint, not a gate.
		void backend.hintIfUnauthenticated();
		return backend;
	}

	/** When this agent has no way to authenticate yet: the harness checks its account, and asks the person to sign in if there is none (`claude/login.ts`). */
	private async hintIfUnauthenticated(): Promise<void> {
		if (process.env.ANTHROPIC_API_KEY) return;
		this.context.accountNeeded?.("no-account");
	}

	// --- the open query --------------------------------------------------------------

	/**
	 * Open a query and start draining its messages.
	 *
	 * Called again by `rewindTo`, which is why it takes the session to resume: a rewind is
	 * a fork you stay in, so the same agent continues against a new session id.
	 */
	private async startQuery(resume?: string): Promise<void> {
		const { translator, notice } = this.context;
		if (resume) {
			try {
				this.bringTranscriptHere(resume);
			} catch {
				// Unreadable projects folder: the resume fails as it would have, and says so.
			}
		}
		const state = newStreamState();
		const options = this.queryOptions(resume);

		this.closed = false;
		const feed = ++this.feed;
		this.session = query({ prompt: this.input(feed), options });

		// Drained in the background for the agent's life: this is the event loop.
		this.pump = (async () => {
			try {
				for await (const message of this.session) {
					if (message.type === "system" && message.subtype === "init") {
						this.sessionId = message.session_id;
					}
					/*
					 * The list changed under us — a skill discovered as the agent moved into a
					 * subdirectory, a `commands/` file written this turn. The SDK pushes the
					 * whole replacement rather than a delta, so this is a set and not a merge
					 * of a merge.
					 */
					if (message.type === "system" && message.subtype === "commands_changed") {
						this.setCommands(message.commands);
					}
					/*
					 * The subscription ran out, or is about to.
					 *
					 * `rate_limit_event` is the CLI's own signal and carries the window that ran
					 * out and when it lifts — so this is read rather than inferred from a failed
					 * turn, and `allowed_warning` gives a heads-up before anything breaks.
					 */
					if (message.type === "rate_limit_event") this.reading.rateLimit(message.rate_limit_info);
					if (message.type === "result") {
						this.streaming = false;
						/*
						 * Pair the transcript with the session file *here*, not where the
						 * shell does it.
						 *
						 * `prompt()` returns as soon as the message is queued — the turn
						 * runs on this stream — so the shell's post-prompt call happens
						 * before the CLI has written the message to its session file, and
						 * found nothing to pair. Every message after the first was left
						 * without an id, and a message with no id has no rewind, no fork
						 * and no card restore.
						 *
						 * The usage read is in the chain rather than beside it, and that
						 * ordering is the whole of whether the meter appears. `turnEnded`
						 * emits `agent.usage` from the cached figures, so a fire-and-forget
						 * refresh lost the race every time: the browser was told
						 * `{ contextTokens: null, contextWindow: 0 }` and nothing ever
						 * corrected it, so the composer's meter — which needs both — never
						 * drew for a Claude agent while pi's always did.
						 */
						void this.syncEntryIds()
							.then(() => this.reading.refresh())
							.then(() => this.context.turnEnded?.());
					}
					handleClaudeMessage(translator, state, message);
					// After the translator, so `lastAssistantText` is the reply this turn gave.
					if (message.type === "result") this.recover(this.recovery.afterTurn(translator.lastAssistantText()));
				}
			} catch (error) {
				// A query a restart replaced ending is not this agent stopping.
				if (this.closed || feed !== this.feed) return;
				this.streaming = false;
				translator.setState("idle");
				// Before reporting a stop: the same failure arrives here when the first turn cannot
				// open the session it was told to resume, and that one is recoverable.
				const failure = this.recovery.afterFailure((error as Error).message);
				if (failure.handled) {
					this.recover(failure.action);
					return;
				}
				notice("error", `Claude stopped: ${(error as Error).message}`);
			}
		})();

		// Not awaited with the models: the menu is worth having a moment later, and a
		// control request that hangs must not hold up the session opening.
		void this.refreshCommands();

		try {
			this.available = await this.session.supportedModels();
			/*
			 * What it actually opened on, which is not always what was asked for.
			 *
			 * A stored model can have been renamed or lost its entitlement between runs, and
			 * the CLI answers such a request by falling back rather than failing. Reporting
			 * the fallback is the honest reading — `model()` feeds the picker, and a picker
			 * showing a model the turn will not use is worse than one that moved.
			 */
			const known = this.available.some((model) => model.value === this.currentModel);
			if (!known) this.currentModel = this.available[0]?.value;
		} catch (error) {
			notice("warn", `Could not list Claude's models: ${(error as Error).message}`);
		}
	}

	/**
	 * What a query is opened with: the deck's briefing and skills, the `decks` command, the mode,
	 * the model, and the account this agent spends.
	 */
	private queryOptions(resume: string | undefined): Options {
		const { deck, notice } = this.context;
		const executable = claudeExecutable();
		/*
		 * Read once: it ensures this agent's symlink as a side effect, and the answer must
		 * not change halfway through building the options.
		 *
		 * Per agent, not per machine. The link is `claude-accounts/agents/<id>`, so another
		 * agent switching account — or running out and rotating — cannot reach this session,
		 * and this one switching cannot reach theirs.
		 */
		const accounts = this.context.accounts;
		const account = this.context.account;
		const accountEnv = accounts && account ? accounts.environmentFor(this.context.toolAgent.id, account.id()) : accounts?.activeEnvironment();
		this.startedOn = account?.id();

		const options: Options = {
			cwd: this.context.cwd,
			// The deck's description, the same text Pi gets as a context file. Appended to
			// Claude Code's own preset rather than replacing it: the built-in prompt is
			// what makes its file tools work well, and Decks has no business rewriting it.
			systemPrompt: {
				type: "preset",
				preset: "claude_code",
				append: agentBriefing(deck, this.context),
			},
			/*
			 * Decks' own skills, as a local plugin.
			 *
			 * `AGENTS.md.tmpl` tells every agent to read the **card-authoring** skill before
			 * building a card, and until now that instruction was only true on pi, which
			 * takes `additionalSkillPaths` directly. A Claude agent called `Skill`, got an
			 * error, and went hunting the filesystem with `find` for a directory it had been
			 * told existed — so the one document that explains the component classes was
			 * reachable by neither the tool that should load it nor the model that was told
			 * to.
			 *
			 * The SDK has no skill-path option; a local plugin is the supported way in, and
			 * `runtime/` is already shaped like one — `skills/<name>/SKILL.md` is exactly
			 * where a plugin keeps them, so the manifest in `runtime/.claude-plugin/` is the
			 * whole of what was missing. It contributes nothing else: there is no
			 * `commands/`, `agents/` or `hooks/` beside them to pick up.
			 */
			plugins: [{ type: "local", path: runtimeDir() }],
			mcpServers: { [decksServerName()]: decksMcpServer(gdocsCaller(this.context.port, this.context.agentToken)) },
			// Pre-approved: the `decks` command is how the agent answers, and a confirm in
			// front of it would be a confirm in front of every reply.
			allowedTools: [...DECKS_COMMAND_RULES, ...gdocsToolNames()],
			permissionMode: CLI_MODE[this.currentMode],
			includePartialMessages: true,
			canUseTool: (toolName, input) => this.ask(toolName, input),
			...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
			...(resume ? { resume } : {}),
			...(this.currentModel ? { model: this.currentModel } : {}),
			...(effortOf(this.currentThinking) ? { effort: effortOf(this.currentThinking) } : {}),
			/*
			 * Which subscription this session spends (`claude/accounts.ts`).
			 *
			 * A symlink — **this agent's own** — so re-pointing it switches the account inside
			 * this session and no other. The CLI re-reads its credentials per request, so the
			 * next turn uses whoever the link points at now; on macOS, where the token is a
			 * keychain entry named at spawn, `accountChanged` starts the process again instead. Set for the CLI's own login too,
			 * which is what makes a session that started on it switchable: a subprocess's
			 * environment cannot be changed after `spawn`, so a session given no variable is
			 * pinned to `~/.claude` for life.
			 *
			 * Both variables, and the credentials come from `CLAUDE_SECURESTORAGE_CONFIG_DIR`
			 * rather than `CLAUDE_CONFIG_DIR` — for a long time only the second one carried the
			 * link, which made every word above true of a variable the CLI does not read a
			 * token from. `accounts.ts` has the measurement.
			 */
			// …and, whichever it is, the `decks` command and who this agent is, for its shell (`runtimes/decks-env.ts`).
			env: { ...(accountEnv ?? process.env), ...decksEnv(this.context.port, this.context.toolAgent.id, this.context.agentToken, (accountEnv ?? process.env).PATH) },
			stderr: (data: string) => {
				// The CLI's own diagnostics, which are usually about credentials.
				if (data.trim()) notice("warn", data.trim().split("\n").slice(-1)[0] ?? "");
			},
		};
		return options;
	}

	/**
	 * The input side of the query: an async iterable the shell pushes into.
	 *
	 * A generator rather than a channel object because that is the shape `query()` takes.
	 * It parks on a promise when the queue is empty, so an idle agent costs nothing.
	 */
	private async *input(feed: number): AsyncGenerator<SDKUserMessage> {
		while (!this.closed && feed === this.feed) {
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
		// `AskUserQuestion` is not a permission question, it *is* the question
		// (`ask-user-question.ts`).
		if (toolName === "AskUserQuestion") return answerQuestions(input, (request) => this.context.bridge.choose(request));
		/*
		 * Its own memory, in auto mode: allowed without asking. Claude Code asks for these because the
		 * memory folder is in its config folder, outside the one it works in, and in auto mode a
		 * question about the agent's own notes is one nobody wants to be interrupted by.
		 */
		if (this.currentMode === "auto" && this.isOwnMemory(toolName, input)) return { behavior: "allow", updatedInput: input };
		const detail = describe(input);
		// The bridge's own fallback for a confirm is `false`, which is the answer this
		// wants: an abandoned question denies rather than waves a command through.
		const allowed = await this.context.bridge
			.context()
			.confirm(`Claude wants to run ${toolName}`, detail ? `${detail}\n\nAllow it?` : "Allow it?");
		return allowed ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "The user denied this." };
	}

	/**
	 * The agent asking the *user* something, rather than asking permission.
	 *
	 * This arrives through `canUseTool` like every other tool, and treating it as one is
	 * what made it useless: Decks showed "Claude wants to run AskUserQuestion — allow it?",
	 * you clicked yes, and the CLI ran a tool whose answers nobody had supplied. The turn
	 * carried on as though nothing had been asked, which is exactly what it looked like.
	 *
	 * **The host is the renderer, and `updatedInput` is the channel.** The tool's own
	 * schema says so — `answers` is described as "user answers collected by the permission
	 * component" — so the contract is: draw the questions, put the choices back on the
	 * input, allow it, and the CLI hands them to the model as the tool's result. Keyed by
	 * the question text, which is what the output is keyed by.
	 *
	 * Asked one at a time. A question may be one of four, and four stacked dialogs in a
	 * dock 88px tall is a dock nobody can read; sequential is also the only order in which
	 * a later question can be worth answering after an earlier one.
	 */

	// --- the conversation -------------------------------------------------------------

	async prompt(text: string): Promise<void> {
		/*
		 * A prompt that starts with `/` is a command. The CLI executes most of them
		 * itself — /compact, /doctor, /cost run inside the session and answer back
		 * through the stream — and the ones that need a terminal do not: /login and
		 * /logout are refused "in this environment", so Decks runs the CLI's own
		 * `auth login` subcommand instead, whose subscription flow prints a sign-in
		 * URL to complete in any browser. /status reads state the backend already
		 * has. Only /help and /status are the deck's own words.
		 */
		const command = parseSlash(text);
		if (command) {
			await this.runSlash(command.name, command.args);
			return;
		}
		this.streaming = true;
		this.context.translator.setState("thinking");
		this.push(text);
	}

	/** What typing `/` completes to, for the composer's menu. */
	commands(): SlashCommand[] {
		return this.commandList;
	}

	/**
	 * Ask the CLI what it can do, and merge it under the deck's own.
	 *
	 * `supportedCommands()` is a control request rather than a turn, so it costs nothing
	 * to ask and answers with everything this session can reach: the built-ins, the
	 * skills it discovered, and any `commands/` the project or the user has. That list is
	 * the whole reason the menu is worth more than seven rows — and it is also the reason
	 * it must be *asked for* rather than written down here, because half of it is the
	 * user's own files and cannot be known in advance.
	 *
	 * Never fatal: a session whose control channel refuses this still has the deck's five
	 * and its pass-throughs, which is what the menu had before.
	 */
	private async refreshCommands(): Promise<void> {
		try {
			this.setCommands(await this.session.supportedCommands());
		} catch {
			// A CLI too old to answer is a shorter menu, not a broken agent.
		}
	}

	/** One list in, one list out, and the browser told if it moved. */
	private setCommands(declared: Array<{ name: string; description?: string; argumentHint?: string; aliases?: string[] }>): void {
		const runtime: SlashCommand[] = declared.map((command) => ({
			name: command.name,
			...(command.description ? { hint: command.description } : {}),
			...(command.argumentHint ? { arg: command.argumentHint } : {}),
			...(command.aliases && command.aliases.length > 0 ? { aliases: command.aliases } : {}),
			// The CLI does not say which of these is a skill and which is a builtin, and a
			// badge that guesses is worse than one that says where the answer comes from.
			source: "runtime" as const,
		}));
		const merged = mergeCommands(CLAUDE_DECK_COMMANDS, runtime);
		if (sameCommands(this.commandList, merged)) return;
		this.commandList = merged;
		this.context.commandsChanged?.();
	}

	private async runSlash(name: string, args: string): Promise<void> {
		switch (name) {
			case "login":
				// The harness's sign-in, in the page's modal (`claude/login.ts`), not a flow of this agent's own.
				this.context.accountNeeded?.("asked");
				return;
			case "logout":
				await this.slashLogout();
				return;
			default:
				// `/status`, `/help` and `/cost` are the deck's, answered as on every runtime (`agents/slash.ts`).
				if (await deckSlash(name, this.context, this.slashFacts())) return;
				/*
				 * The CLI's own commands — /compact, /doctor — run inside the session and answer
				 * back through the stream, and **every one of them ends in a `result` frame**, the
				 * way a turn does (measured: `/compact` sends `status: compacting`, then nothing
				 * until the summary is written, then `init` and `result`; `/context` sends `init`
				 * and `result`). So it is a turn as far as "is anything running" goes. Without
				 * this the shell took its "thinking" back the moment the command was queued, and
				 * a compaction that runs for a minute showed an idle agent: the row said done,
				 * and the queue handed it the next piece of work in the middle of it.
				 */
				this.streaming = true;
				this.context.translator.setState("thinking");
				this.push(`/${name}${args ? ` ${args}` : ""}`);
		}
	}

	/** What `/status` and `/help` say for Claude Code. */
	private slashFacts(): DeckSlashFacts {
		return {
			runtime: "Claude Code",
			commands: () => this.commands(),
			status: async () => {
				const auth = await claudeAuthStatus();
				return [`model ${this.currentModel ?? "default"}`, `mode ${this.currentMode ?? "default"}`, auth.loggedIn ? `signed in (${auth.label})` : "not signed in"];
			},
		};
	}

	/** Sign out, the same way: the CLI's own `auth logout`, outside the session. */
	private async slashLogout(): Promise<void> {
		const { code, stderr } = await runClaudeCommand(["auth", "logout"]);
		if (code === 0) this.context.notice("info", "Signed out of Claude.");
		else if (stderr.trim()) this.context.notice("warn", stderr.trim().split("\n").slice(-1)[0] ?? "Could not sign out.");
		else this.context.notice("info", "Claude was not signed in.");
	}

	/**
	 * The agent moved to another subscription (`AgentSession.useAccount`).
	 *
	 * On Linux and Windows the token is read through the agent's link, which has already
	 * moved, so the next turn spends the new account and nothing needs doing. On macOS it is
	 * read from a keychain entry named when the process started (`accounts.ts`,
	 * `activeEnvironment`). Measured 2026-10-10: a process started on one account, its link
	 * repointed between turns, sent its second turn on the first account. So the process
	 * starts again, resuming this conversation, which keeps its history. Never mid-turn:
	 * that would cut the reply off, so a switch during a turn waits for it to end.
	 */
	accountChanged(): void {
		if (process.platform !== "darwin" || !this.onOtherAccount()) return;
		if (this.streaming) {
			this.recovery.accountMovedMidTurn();
			return;
		}
		void this.restart();
	}

	/**
	 * A Claude sign-in landed (`claude/login.ts`): the models this session listed were the old login's,
	 * or none when it had none, so it starts again, resuming this conversation, and lists them anew.
	 * Never mid-turn: then it waits for the turn to end. Resolves once the models are read.
	 */
	signedIn(): Promise<void> {
		if (!this.streaming) return this.restart();
		return this.recovery.signInMidTurn();
	}

	/** Whether this process was started on an account other than the one the agent is on now. */
	private onOtherAccount(): boolean {
		const now = this.context.account?.id();
		return this.startedOn !== undefined && now !== undefined && now !== this.startedOn;
	}

	/**
	 * Reopen the query against the same session, picking up new options (a key).
	 *
	 * The same dance a rewind does: close the old stream, start a new one against the
	 * same session id, then let the old one go.
	 */
	private async restart(): Promise<void> {
		const previous = this.session;
		this.closed = true;
		this.wake?.();
		this.queue = [];
		await this.startQuery(this.sessionRef());
		if (this.currentMode !== DEFAULT_MODE) await this.setMode(this.currentMode);
		try {
			await previous.return(undefined);
		} catch {
			/* a query that has already ended is not a problem worth raising */
		}
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
		return this.reading.usage();
	}

	/** The full reading, for the usage panel (`ClaudeUsageReader.report`). */
	report(): Promise<UsageReport> {
		return this.reading.report();
	}

	/** Do what `ClaudeRecovery` decided at the end of a turn: at most one restart, and a retry. */
	private recover(action: RecoveryAction | undefined): void {
		if (!action) return;
		if (action.kind === "fresh") {
			// Forgotten before the restart, so the new query is opened without `--resume`.
			this.sessionId = undefined;
			void this.restartQuery(action.ask).then(() => this.recovery.restarted());
			return;
		}
		if (action.kind === "resume") void this.restart().then(() => this.recovery.restarted());
		const ask = action.kind === "resume" ? action.ask : action;
		if (!ask) return;
		const timer = setTimeout(() => {
			if (this.closed) return;
			this.push(ask.text);
		}, ask.after);
		// Never a reason to hold the process open: a deck shutting down mid-wait should shut down.
		timer.unref?.();
	}

	/**
	 * Open a fresh session and ask the same thing in it.
	 *
	 * The same moves `rewindTo` makes to replace a query: stop feeding the old one, open the new
	 * one, then let the old one end. Nothing is resumed, which is the whole point of it.
	 */
	private async restartQuery(text: string): Promise<void> {
		const previous = this.session;
		this.closed = true;
		this.wake?.();
		this.queue = [];
		try {
			await this.startQuery();
			this.push(text);
		} catch (error) {
			this.closed = false;
			this.context.notice("error", `Claude could not start a new session: ${(error as Error).message}`);
		}
		try {
			await previous.return(undefined);
		} catch {
			/* a query that has already ended is not a problem worth raising */
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
	 * The ids are what a rewind, a fork and a card restore are addressed to; the walk is
	 * every runtime's (`agents/entries.ts`), and what is Claude's own is reading the entries.
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
		pairUserEntries(
			this.context.translator,
			entries.map((entry) => ({ id: entry.uuid, content: (entry.message as { content?: unknown } | undefined)?.content })),
		);
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
		return translatorTimeline(this.context.translator);
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
	/** The Claude Code config folder this agent's session runs under: its account's, or the machine's. */
	private configDir(): string {
		const accounts = this.context.accounts;
		const account = this.context.account;
		const env = accounts && account ? accounts.environmentFor(this.context.toolAgent.id, account.id()) : accounts?.activeEnvironment();
		return env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
	}

	/**
	 * Whether a file tool is writing this agent's own memory: `projects/<folder>/memory/` in its
	 * Claude config folder, by either spelling of the path (the config folder is a link).
	 */
	private isOwnMemory(toolName: string, input: Record<string, unknown>): boolean {
		if (!["Write", "Edit", "MultiEdit"].includes(toolName) || typeof input.file_path !== "string") return false;
		return inMemoryFolder(this.configDir(), input.file_path);
	}

	/**
	 * Make a conversation resumable from this folder.
	 *
	 * Claude Code files a session under `projects/<the folder, every other character a dash>/`, so a
	 * session resumed from another folder (a deck that moved, a conversation begun elsewhere) is
	 * looked for where it is not, and fails with "No conversation found". When the
	 * file is not under this folder, it is found under any other and copied here; the original
	 * stays, so the old folder can still open it.
	 */
	private bringTranscriptHere(id: string): void {
		const root = join(this.configDir(), "projects");
		const here = join(root, this.context.cwd.replace(/[^a-zA-Z0-9]/g, "-"));
		if (existsSync(join(here, `${id}.jsonl`)) || !existsSync(root)) return;
		for (const folder of readdirSync(root)) {
			const source = join(root, folder, `${id}.jsonl`);
			if (!existsSync(source)) continue;
			mkdirSync(here, { recursive: true });
			copyFileSync(source, join(here, `${id}.jsonl`));
			return;
		}
	}

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

function decksServerName(): string {
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

/** A one-line description of what a tool was asked to do, for the confirm dialog. */
/**
 * Whether `file` is in a memory folder of this Claude config folder, `projects/<folder>/memory/`,
 * by either spelling of either path — the config folder Decks hands an agent is a link.
 */
export function inMemoryFolder(configDir: string, file: string): boolean {
	const target = resolve(file);
	const projects = join(configDir, "projects");
	const roots = [projects];
	try {
		roots.push(realpathSync(projects));
	} catch {
		// No projects folder yet: only the plain spelling can match.
	}
	const spellings = [target];
	try {
		spellings.push(join(realpathSync(dirname(target)), basename(target)));
	} catch {
		// A memory file in a folder not made yet: the plain spelling is all there is.
	}
	return spellings.some((path) =>
		roots.some((root) => {
			const rel = relative(root, path);
			const parts = rel.split(sep);
			return !rel.startsWith("..") && !isAbsolute(rel) && parts.length >= 3 && parts[1] === "memory" && !parts.includes("..");
		}),
	);
}

function describe(input: Record<string, unknown>): string {
	for (const key of ["command", "file_path", "path", "pattern", "url"]) {
		const value = input[key];
		if (typeof value === "string" && value.trim()) return `${key}: ${value.trim().slice(0, 300)}`;
	}
	return "";
}
