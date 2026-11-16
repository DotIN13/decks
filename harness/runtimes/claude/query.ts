// The Claude query an agent holds open: starting it, feeding it, the messages it
// sends back, and what the end of a turn may do (limits, retries, a stale session).
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { query, type ModelInfo, type Options, type PermissionMode, type Query, type SDKRateLimitInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMode, AgentUsage, ThinkingLevel } from "../types/index.ts";
import type { AgentBackendContext } from "../backend.ts";
import { answerQuestions } from "./ask-user-question.ts";
import { runtimeDir } from "../../prompts/paths.ts";
import { claudeExecutable } from "./available.ts";
import { claudeAuthStatus } from "./login.ts";
import { limitWindow, resetWords } from "./limits.ts";
import { handleClaudeMessage, newStreamState } from "./events.ts";
import { isTransientAuthFailure, MAX_TRANSIENT_RETRIES, retryDelayMs } from "./transient.ts";
import { isStaleSession } from "./stale-session.ts";
import { epochMs, eventPercent } from "../../accounts/index.ts";
import { DECKS_COMMAND_RULES, decksMcpServer, gdocsToolNames } from "./tools.ts";
import { gdocsCaller } from "../shared/gdocs.ts";

/** Anthropic is the only provider behind this backend. */
export const PROVIDER = "anthropic";

/** Decks' mode names, and the CLI's. */
export const CLI_MODE: Record<AgentMode, PermissionMode> = {
	manual: "default",
	acceptEdits: "acceptEdits",
	plan: "plan",
	auto: "auto",
};

/**
 * Boards are the medium, so edits inside the deck proceed unasked.
 *
 * A confirm per board write would make the app unusable — writing boards is what the agent
 * is *for*. Everything the CLI judges riskier than an edit still comes through
 * `canUseTool`, which Decks answers with the dialog bridge.
 */
export const DEFAULT_MODE: AgentMode = "acceptEdits";

/** The open query behind a Claude agent; ClaudeBackend builds the rest of the agent on it. */
export abstract class ClaudeQuery {

	protected session!: Query;
	/** Messages waiting to go into the open query. */
	protected queue: SDKUserMessage[] = [];
	protected wake: (() => void) | undefined;
	protected closed = false;
	/**
	 * Which query's input is live. Bumped by every `startQuery`, so a generator left from the
	 * query a restart replaced ends instead of parking again: `closed` is already false by the
	 * time it wakes, and two generators sharing `queue` and `wake` meant the next prompt could
	 * go to the dead query, leaving the agent thinking for good.
	 */
	protected feed = 0;
	protected streaming = false;
	protected pump: Promise<void> | undefined;

	protected sessionId: string | undefined;
	protected currentMode: AgentMode = DEFAULT_MODE;
	protected currentModel: string | undefined;
	protected currentThinking: ThinkingLevel | undefined;
	protected available: ModelInfo[] = [];
	/** Cached, because Decks reads usage synchronously and the CLI answers async. */
	protected lastUsage: AgentUsage | null = null;
	protected storedName: string | undefined;
	protected title: string | undefined;
	/** Which limit window has already been warned about, so it is said once and not per turn. */
	protected warnedAbout: string | undefined;
	/**
	 * The account this session's process was started on. A switch reaches its *turns* (the CLI
	 * reads the credentials again for every message) but not its usage read, which keeps the
	 * login the process started with — so `report` asks a fresh process once the agent has moved.
	 */
	protected startedOn: string | undefined;
	/** A switch arrived mid-turn on macOS: start again on the new account when the turn ends. */
	protected restartForAccount = false;
	/** How many times this turn has been retried past a busy login (`transient.ts`). */
	protected transientTries = 0;
	/**
	 * How many times this turn has been asked again after the session it was told to resume
	 * turned out not to be in this account's store (`stale-session.ts`). One, deliberately: a
	 * second restart would mean the fresh session is missing too, and that is a sentence for a
	 * person rather than another attempt.
	 */
	protected staleTries = 0;

	// What the agent built on this query answers: its commands, its record of entries, its usage, its account.
	protected abstract refreshCommands(): Promise<void>;
	protected abstract setCommands(declared: Array<{ name: string; description?: string; argumentHint?: string; aliases?: string[] }>): void;
	abstract syncEntryIds(): Promise<void>;
	protected abstract refreshUsage(): Promise<void>;
	protected abstract onOtherAccount(): boolean;
	protected abstract restart(): Promise<void>;

	protected constructor(protected readonly context: AgentBackendContext) {
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

	/** One notice, when this agent has no way to authenticate yet. */
	protected async hintIfUnauthenticated(): Promise<void> {
		if (process.env.ANTHROPIC_API_KEY) return;
		const auth = await claudeAuthStatus();
		if (!auth.loggedIn) this.context.notice("warn", "Claude isn't signed in. Send /login to sign in with your subscription.");
	}

	// --- the open query --------------------------------------------------------------

	/**
	 * Open a query and start draining its messages.
	 *
	 * Called again by `rewindTo`, which is why it takes the session to resume: a rewind is
	 * a fork you stay in, so the same agent continues against a new session id.
	 */
	protected async startQuery(resume?: string): Promise<void> {
		const { translator, notice } = this.context;
		if (resume) {
			try {
				this.bringTranscriptHere(resume);
			} catch {
				// Unreadable projects folder: the resume fails as it would have, and says so.
			}
		}
		const executable = claudeExecutable();
		const state = newStreamState();
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
		const accountEnv = accounts && account ? accounts.environmentFor(this.context.agent.id, account.id()) : accounts?.activeEnvironment();
		this.startedOn = account?.id();

		const options: Options = {
			cwd: this.context.cwd,
			// The deck's description, the same text Pi gets as a context file. Appended to
			// Claude Code's own preset rather than replacing it: the built-in prompt is
			// what makes its file tools work well, and Decks has no business rewriting it.
			systemPrompt: {
				type: "preset",
				preset: "claude_code",
				append: this.context.briefing(),
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
			mcpServers: { [stageServerName()]: decksMcpServer(gdocsCaller(this.context.decks)) },
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
			// …and, whichever it is, the `decks` command and who this agent is, for its shell (the harness's agent environment).
			env: { ...(accountEnv ?? process.env), ...this.context.decks.env((accountEnv ?? process.env).PATH) },
			stderr: (data: string) => {
				// The CLI's own diagnostics, which are usually about credentials.
				if (data.trim()) notice("warn", data.trim().split("\n").slice(-1)[0] ?? "");
			},
		};

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
					if (message.type === "rate_limit_event") this.onRateLimit(message.rate_limit_info);
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
						 * and no board restore.
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
							.then(() => this.refreshUsage())
							.then(() => this.context.turnEnded?.());
					}
					handleClaudeMessage(translator, state, message);
					// After the translator, so `lastAssistantText` is the reply this turn gave.
					if (message.type === "result") {
						this.recoverStaleSession(translator.lastAssistantText());
						this.retryTransient();
						// After both: a retry opens its new process on the new account already.
						if (this.restartForAccount) {
							this.restartForAccount = false;
							if (this.onOtherAccount()) void this.restart();
						}
					}
				}
			} catch (error) {
				// A query a restart replaced ending is not this agent stopping.
				if (this.closed || feed !== this.feed) return;
				this.streaming = false;
				translator.setState("idle");
				// Before reporting a stop: the same failure arrives here when the first turn cannot
				// open the session it was told to resume, and that one is recoverable.
				if (this.recoverStaleSession((error as Error).message)) return;
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
	 * Make a conversation resumable from this folder.
	 *
	 * Claude Code files a session under `projects/<the folder, every other character a dash>/`, so a
	 * session resumed from another folder (a deck that moved, a conversation begun elsewhere) is
	 * looked for where it is not, and fails with "No conversation found". When the
	 * file is not under this folder, it is found under any other and copied here; the original
	 * stays, so the old folder can still open it.
	 */
	protected bringTranscriptHere(id: string): void {
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

	/** The Claude Code config folder this agent's session runs under: its account's, or the machine's. */
	protected configDir(): string {
		const accounts = this.context.accounts;
		const account = this.context.account;
		const env = accounts && account ? accounts.environmentFor(this.context.agent.id, account.id()) : accounts?.activeEnvironment();
		return env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
	}

	/**
	 * The input side of the query: an async iterable the shell pushes into.
	 *
	 * A generator rather than a channel object because that is the shape `query()` takes.
	 * It parks on a promise when the queue is empty, so an idle agent costs nothing.
	 */
	protected async *input(feed: number): AsyncGenerator<SDKUserMessage> {
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

	protected push(text: string): void {
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
	protected async ask(toolName: string, input: Record<string, unknown>): Promise<
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
	 * Whether a file tool is writing this agent's own memory: `projects/<folder>/memory/` in its
	 * Claude config folder, by either spelling of the path (the config folder is a link).
	 */
	protected isOwnMemory(toolName: string, input: Record<string, unknown>): boolean {
		if (!["Write", "Edit", "MultiEdit"].includes(toolName) || typeof input.file_path !== "string") return false;
		return inMemoryFolder(this.configDir(), input.file_path);
	}

	// --- what the end of a turn may do -----------------------------------------------

	/**
	 * A subscription reaching its limit — said, not worked around.
	 *
	 * **Nothing switches by itself.** This used to mark the account spent, move the
	 * conversation to the next subscription down the list, and re-send the prompt when the
	 * turn had not touched anything yet. Three things happened without being asked, one of
	 * them mid-turn, and the record of it was a line of transcript nobody was reading at the
	 * time. So what is left is the sentence: which window ran out, whose subscription it was,
	 * when it lifts, and that another one is a press away in the model picker.
	 *
	 * The press is cheap, which is what makes this the right trade: a switch is one `rename`
	 * of a symlink and the CLI re-reads its credentials per request, so choosing another
	 * account and pressing send again spends it on the very next turn — no restart, no lost
	 * conversation. And re-sending is the person's, which is the part a machine should not
	 * guess: Decks agents edit files, and a turn that got three tool calls in before the
	 * refusal cannot simply be replayed.
	 */
	protected onRateLimit(info: SDKRateLimitInfo): void {
		const { notice } = this.context;
		const accounts = this.context.accounts;

		if (info.status === "allowed_warning") {
			/*
			 * Said once per window, not once per event.
			 *
			 * The CLI emits this whenever the figure moves, which near a limit is every turn —
			 * and a warning repeated every turn is one nobody reads. The window it is about is
			 * the key, so a fresh warning about the *seven-day* limit still gets through after
			 * one about the five-hour limit.
			 */
			const window = info.rateLimitType ?? "limit";
			if (this.warnedAbout !== window) {
				this.warnedAbout = window;
				// `eventPercent`, not `Math.round`: this event's figure is a fraction, and rounding it as a
				// percentage is what made every warning say "1% used". See the function for what is known
				// and what is inferred.
				const used = eventPercent(info.utilization);
				const share = used === null ? "" : ` (${used}% used)`;
				notice("warn", `This Claude subscription is close to its ${limitWindow(window)} limit${share}.`);
			}
			return;
		}
		if (info.status !== "rejected") {
			// Back under the limit: the next warning about this window is worth hearing again.
			this.warnedAbout = undefined;
			return;
		}

		// What *this* agent is on, not what the machine is on: two agents can be spending
		// two subscriptions, and the one that refused is the one this session was using.
		const mine = this.context.account?.id();
		const spent = mine ? accounts?.describe(mine) : accounts?.active();
		// Unix seconds on the event, milliseconds everywhere it is compared or shown.
		const reset = resetWords(epochMs(info.resetsAt));
		const window = limitWindow(info.rateLimitType);
		const whose = spent?.email ? `${spent.email}'s` : "This";
		/*
		 * Whether there is anywhere to go, which is the only thing the account list is asked
		 * here — and it decides one clause of a sentence rather than an account switch.
		 *
		 * `signed in and not this one` rather than `not spent`: nothing is marked spent any
		 * more, so the honest offer is "there is another subscription you could put this
		 * conversation on", and whether it has quota left is something only trying it can say.
		 */
		const elsewhere = accounts?.hasOther?.(mine) === true;
		notice(
			"error",
			elsewhere
				? `${whose} Claude subscription has reached its ${window} limit${reset}. Pick another one in the model picker and send again.`
				: `${whose} Claude subscription has reached its ${window} limit${reset}. Add another account in settings, or wait.`,
		);
	}

	/**
	 * A turn that was not an answer: try it again rather than leaving it as one.
	 *
	 * Several Claude Code processes on one machine share one credentials file, and when a
	 * token comes due they all want it refreshed at once. The CLI serialises that with a
	 * lock and tells the losers to come back — and with six agents open that is five turns
	 * lost to a sentence the CLI itself calls transient. Worse, the SDK reports the turn as
	 * a *success* whose content is that sentence, so it lands as the assistant's reply and
	 * the person watching has to read it and press send again.
	 *
	 * Three conditions, and all three are needed:
	 *
	 * - the reply **is** the failure (`transient.ts`, which matches on prose because there
	 *   is nothing structural to match on, and says so);
	 * - the turn **did nothing** — no tool call, no board write. Decks agents edit files, and
	 *   replaying a turn that got halfway could write the same board twice. The rate-limit
	 *   path used to resend under the same guard; it does not resend at all now;
	 * - there are retries left, so a refresh that is genuinely stuck ends in the message
	 *   standing rather than in a turn that never finishes.
	 *
	 * The old reply is taken back before the new attempt, so what the person sees is one
	 * line saying the login is busy and then the answer — rather than an error, an error,
	 * and an answer.
	 */
	protected retryTransient(): void {
		const { translator, notice } = this.context;
		if (!isTransientAuthFailure(translator.lastAssistantText())) {
			this.transientTries = 0;
			return;
		}
		if (translator.turnTouchedAnything()) return;
		const again = translator.lastUserText();
		if (!again) return;

		if (this.transientTries >= MAX_TRANSIENT_RETRIES) {
			this.transientTries = 0;
			notice("error", "Another Claude Code process is still refreshing this login. Send that again in a minute, or close some agents.");
			return;
		}

		const attempt = ++this.transientTries;
		const wait = retryDelayMs(attempt);
		translator.dropLastAssistant();
		this.context.historyChanged?.();
		notice("warn", `Another Claude Code process is refreshing this login. Trying again in ${Math.round(wait / 1000)}s.`);
		const timer = setTimeout(() => {
			if (this.closed) return;
			this.push(again);
		}, wait);
		// Never a reason to hold the process open: a deck shutting down mid-wait should shut down.
		timer.unref?.();
	}

	/**
	 * A turn that failed because the session it was told to resume is not in this account's
	 * store. Asked again once, in a fresh session.
	 *
	 * The id can be right and the store still be the wrong one, with nothing about the person,
	 * the deck or the task at fault: `--resume` is looked up inside the config directory the
	 * process is handed (`claude/accounts.ts`), and that directory can have moved under a
	 * stored id. It did here: the id was written before the per-agent link existed, the account
	 * it ended up on kept a private `projects/` instead of the shared store, and the session was
	 * in the 53 transcripts that copy did not have. The morning's scheduled task ended as
	 * `error_during_execution` with a session id quoted back at somebody who could do nothing
	 * with it. `stale-session.ts` says why this reads prose rather than a field.
	 *
	 * What starting fresh costs is the conversation's memory of itself, and that was already
	 * the cost — the memory is unreachable either way, and this way the work still happens.
	 *
	 * Returns whether it took the failure over, so the caller does not also report a stop.
	 */
	protected recoverStaleSession(said: string | undefined): boolean {
		const { translator, notice } = this.context;
		if (!isStaleSession(said)) {
			this.staleTries = 0;
			return false;
		}
		/*
		 * A turn that already changed a board is not repeated — the rule the busy-login retry
		 * follows too. Here it also means the failure stands: the turn did something, so "ask it
		 * again in a fresh session" is not a repair, it is a second attempt at work already done.
		 */
		const again = translator.turnTouchedAnything() ? undefined : translator.lastUserText();
		if (!again) return false;
		if (this.staleTries >= 1) {
			this.staleTries = 0;
			notice(
				"error",
				"Claude cannot find this conversation's session in this account's transcript store, so this turn cannot be asked again. Send it once more and it starts a fresh conversation.",
			);
			return true;
		}
		this.staleTries += 1;
		notice("warn", "Claude cannot find this conversation's session in this account's transcript store, so it starts a fresh one and asks again.");
		// The reply is not an answer, and leaving it in the transcript is what made this read
		// as a result rather than a failure.
		translator.dropLastAssistant();
		this.context.historyChanged?.();
		// Forgotten before the restart, so the new query is opened without `--resume`.
		this.sessionId = undefined;
		void this.restartQuery(again);
		return true;
	}

	/**
	 * Open a fresh session and ask the same thing in it.
	 *
	 * The same moves `rewindTo` makes to replace a query: stop feeding the old one, open the new
	 * one, then let the old one end. Nothing is resumed, which is the whole point of it.
	 */
	protected async restartQuery(text: string): Promise<void> {
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
}

// --- the query's options ----------------------------------------------------------

export function stageServerName(): string {
	// The MCP server Decks' own tools are under; tools.ts names them under the same "decks".
	return "decks";
}

/**
 * Decks' thinking levels and Claude's effort levels are nearly the same list.
 *
 * `off` and `minimal` have no effort counterpart — the CLI's lowest is `low` — so they map
 * to nothing rather than to a level that would spend more than was asked for.
 */
export function effortOf(level: ThinkingLevel | undefined): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
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

// --- permission prompts -----------------------------------------------------------

/** A one-line description of what a tool was asked to do, for the confirm dialog. */
export function describe(input: Record<string, unknown>): string {
	for (const key of ["command", "file_path", "path", "pattern", "url"]) {
		const value = input[key];
		if (typeof value === "string" && value.trim()) return `${key}: ${value.trim().slice(0, 300)}`;
	}
	return "";
}

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
