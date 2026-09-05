import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
	forkSession,
	getSessionMessages,
	query,
	renameSession,
	type ModelInfo,
	type Options,
	type PermissionMode,
	type Query,
	type SDKControlGetUsageResponse,
	type SDKRateLimitInfo,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentCapabilities, AgentMode, AgentModel, AgentUsage, ModelOption, SlashCommand, ThinkingLevel, UsageReport } from "@decks/protocol";
import type { AgentBackend, AgentBackendContext, ConversationPoint } from "../agents/backend.ts";
import { parseSlash } from "../agents/slash.ts";
import { answerQuestions } from "./ask-user-question.ts";
import { deckContext, runtimeDir } from "../agents/context.ts";
import { claudeAvailability, claudeBundledExecutable, claudeExecutable } from "./available.ts";
import { firstUrl, lastLine, plain } from "./cli-output.ts";
import { handleClaudeMessage, newStreamState } from "./events.ts";
import { qualifiedToolName, stageMcpServer } from "./tools.ts";
import { toUsageReport } from "./usage.ts";

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
 * The two accounts Claude Code can be signed in to, and the flag that picks one.
 *
 * `claude auth login` defaults to the subscription and takes `--console` for an
 * Anthropic API account (usage billing) instead — the same choice the interactive CLI
 * puts on its first screen. Decks has to ask it out loud: a headless login that guessed
 * would sign a Console user into the wrong account and only say so a turn later, when
 * the first request came back unauthorised.
 */
const LOGIN_METHODS = [
	{ label: "Claude subscription (Pro or Max)", flag: "--claudeai", noun: "subscription" },
	{ label: "Anthropic API account (Console, usage billing)", flag: "--console", noun: "API account" },
] as const;

/**
 * The `/` commands a Claude agent can run, and every one is the deck's own.
 *
 * The CLI does not parse slash commands out of prompts it is handed — `/login` comes
 * back as the model answering "not available in this environment" — so there is no
 * pass-through here. What works headless is what Decks interprets: `/login` drives the
 * CLI's own `auth login` through the dock's dialogs, `/logout` runs `auth logout`, and
 * the rest read state the backend already has.
 */
export const CLAUDE_COMMANDS: SlashCommand[] = [
	{ name: "login", hint: "Sign in with a subscription or an API account" },
	{ name: "logout", hint: "Sign out of Claude" },
	{ name: "status", hint: "Model, mode and auth state" },
	{ name: "doctor", hint: "Check the Claude Code install" },
	{ name: "cost", hint: "Open the usage panel: plan limits, spend, context" },
	{ name: "compact", hint: "Compress the conversation", arg: "[notes]" },
	{ name: "help", hint: "The commands Decks understands" },
];

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
	/** Which limit window has already been warned about, so it is said once and not per turn. */
	private warnedAbout: string | undefined;

	private constructor(private readonly context: AgentBackendContext) {
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

	/** One notice, when this agent has no way to authenticate yet. */
	private async hintIfUnauthenticated(): Promise<void> {
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
			/*
			 * Decks' own skills, as a local plugin.
			 *
			 * `AGENTS.md.tmpl` tells every agent to read the **board-authoring** skill before
			 * building a board, and until now that instruction was only true on pi, which
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
			/*
			 * Which subscription this session spends (`claude/accounts.ts`).
			 *
			 * A symlink, so re-pointing it switches the account *inside* this session — the
			 * CLI re-reads its credentials per request, so the next turn uses whoever the link
			 * points at now. Absent when no account has been added, which leaves the CLI on
			 * its own `~/.claude` exactly as before.
			 *
			 * `env` REPLACES the subprocess environment rather than extending it, so
			 * `process.env` is spread: without it the CLI would start with no `PATH` and no
			 * `HOME`.
			 */
			...(this.context.accounts?.activeConfigDir()
				? { env: { ...process.env, CLAUDE_CONFIG_DIR: this.context.accounts.activeConfigDir() } }
				: {}),
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
		// `AskUserQuestion` is not a permission question, it *is* the question
		// (`ask-user-question.ts`).
		if (toolName === "AskUserQuestion") return answerQuestions(input, (request) => this.context.bridge.choose(request));
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
		return CLAUDE_COMMANDS;
	}

	private async runSlash(name: string, args: string): Promise<void> {
		const { notice } = this.context;
		switch (name) {
			case "login":
				await this.slashLogin();
				return;
			case "logout":
				await this.slashLogout();
				return;
			case "status": {
				const auth = await claudeAuthStatus();
				notice(
					"info",
					`Claude Code · model ${this.currentModel ?? "default"} · mode ${this.currentMode ?? "default"} · ${
						auth.loggedIn ? `signed in (${auth.label})` : "not signed in"
					}`,
				);
				return;
			}
			case "help":
				notice(
					"info",
					this.commands().map((slash) => `/${slash.name}${slash.arg ? ` ${slash.arg}` : ""} — ${slash.hint ?? ""}`).join("\n") || "No commands.",
				);
				return;
			case "cost":
				// The panel, not a paragraph. The shell reads the figures and sends them with
				// the instruction to open it (`session.pushReport`).
				this.context.showUsage?.();
				return;
			default:
				// The CLI's own commands — /compact, /doctor — run inside the
				// session and answer back through the stream.
				this.push(`/${name}${args ? ` ${args}` : ""}`);
		}
	}

	/**
	 * Sign in, either way, without a terminal to do it in.
	 *
	 * The CLI refuses `/login` inside a headless session, but its own `auth login`
	 * subcommand does not — and what that subcommand actually does is a *paste-the-code*
	 * flow: it prints an OAuth URL, then sits on **stdin** waiting for the code the
	 * browser shows at the end. So there are three things the deck owes the person, and
	 * an earlier version of this owed them all and paid none:
	 *
	 * 1. **Which account.** Subscription or Console are different sign-ins with different
	 *    billing, and the flag is chosen before the process starts (`LOGIN_METHODS`).
	 * 2. **The URL**, which arrives wrapped in an OSC-8 hyperlink — the URL is in the
	 *    escape sequence *and* again as the visible text, so a regex over the raw line
	 *    matches both at once and yields a doubled, unusable address (`cli-output.ts`).
	 * 3. **Somewhere to paste the code.** The child is spawned with a stdin pipe for
	 *    exactly this; with `"ignore"` the flow could only ever time out.
	 *
	 * An auth poll stays as a fallback, in case a flow ever completes in the browser
	 * alone — but only when this agent was *not* already signed in, because otherwise it
	 * cannot tell a new sign-in from the one already there.
	 *
	 * Nothing is stored by Decks itself: the credentials are Claude's own, in the
	 * user's home, the way an interactive `claude` would keep them.
	 */
	private async slashLogin(): Promise<void> {
		const { notice } = this.context;
		const binary = claudeExecutable() ?? claudeBundledExecutable();
		if (!binary) {
			notice("error", "No Claude Code executable to authenticate.");
			return;
		}

		const chosen = await this.context.bridge
			.context()
			.select("Sign in to Claude with…", LOGIN_METHODS.map((method) => method.label));
		if (!chosen) {
			notice("info", "/login cancelled.");
			return;
		}
		const method = LOGIN_METHODS.find((candidate) => candidate.label === chosen) ?? LOGIN_METHODS[0];

		/*
		 * Signed in to a directory of its own, so this *adds* an account rather than replacing
		 * one (`claude/accounts.ts`).
		 *
		 * Which is the whole of how several subscriptions come to be signed in at once: the
		 * CLI writes its credentials wherever `CLAUDE_CONFIG_DIR` points, so pointing it
		 * somewhere new each time leaves the previous account exactly as it was — including
		 * the CLI's own `~/.claude`, which this never touches.
		 */
		const accounts = this.context.accounts;
		const into = accounts && "begin" in accounts ? (accounts as { begin(): { id: string; configDir: string } }).begin() : undefined;

		/*
		 * Read before anything is spawned: what "signed in" would *change* is the only thing
		 * that can be observed, and this is the other half of that comparison. Asked of the
		 * new directory, which is empty — so `loggedIn` is false and the fallback poll below
		 * is armed, which is right: any credentials appearing there are this login's.
		 */
		const before = await claudeAuthStatus(into?.configDir);

		notice("info", `Starting Claude's ${method.noun} login…`);
		const child = spawn(binary, ["auth", "login", method.flag], {
			stdio: ["pipe", "pipe", "pipe"],
			...(into ? { env: { ...process.env, CLAUDE_CONFIG_DIR: into.configDir } } : {}),
		});

		// The URL prints immediately; wait for it rather than racing the process,
		// because the dialog is only worth showing once there is something to open.
		let url: string | undefined;
		let resolveUrl: () => void = () => {};
		const urlReady = new Promise<void>((resolve) => (resolveUrl = resolve));
		let stderr = "";
		/** The last thing the CLI said that was not the URL or its own prompt. */
		let lastSaid = "";
		const seenLines = new Set<string>();
		child.stdout.on("data", (data: Buffer) => {
			for (const raw of plain(data.toString()).split(/\r?\n/)) {
				const found = firstUrl(raw);
				if (found) {
					if (!url) {
						url = found;
						resolveUrl();
					}
					continue;
				}
				const line = raw.trim();
				if (!line) continue;
				// The CLI's own "Paste code here if prompted >" is the dialog's job now;
				// echoing it into the transcript would be the same request twice, once
				// somewhere nobody can answer it.
				if (/paste code/i.test(line)) continue;
				lastSaid = line;
				// Its other lines ("Opening browser…"), surfaced as they come.
				if (!seenLines.has(line)) {
					seenLines.add(line);
					notice("info", line);
				}
			}
		});
		child.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
		let exitCode: number | null = null;
		const exited = new Promise<void>((resolve) =>
			child.on("exit", (code) => {
				exitCode = code;
				resolve();
			}),
		);
		await Promise.race([urlReady, exited, sleep(20_000)]);
		if (!url) {
			child.kill();
			notice("error", lastLine(stderr) || lastSaid || "Claude's login would not start.");
			return;
		}

		// The dialog: open the link, sign in, paste what the browser gives back.
		const modal = this.context.bridge.login(
			url,
			`Open the link and sign in with your ${method.noun}, then paste the code the browser gives you back here.`,
			"Paste the code from the browser",
		);

		/*
		 * A watch for credentials appearing, and *only* where that would mean something.
		 *
		 * Both flows are paste-the-code flows, so this is a fallback rather than the path —
		 * but a fallback that cannot tell "signed in" from "was already signed in" is worse
		 * than none. Running `/login` to move from a subscription to a Console account
		 * starts from `loggedIn: true`, so an unconditional poll fired on its first tick,
		 * closed the dialog out from under the person, and reported a sign-in that had not
		 * happened — leaving them on the account they were trying to leave. So it only runs
		 * when there is a transition to see.
		 */
		const poll = before.loggedIn
			? undefined
			: setInterval(() => {
					void claudeAuthStatus(into?.configDir).then((auth) => {
						if (!auth.loggedIn) return;
						clearInterval(poll);
						this.context.bridge.answer({ id: modal.id, confirmed: true });
					});
				}, 2500);

		const answer = await modal.done;
		if (poll) clearInterval(poll);
		if (answer === false) {
			child.kill();
			notice("info", "/login cancelled.");
			return;
		}
		if (typeof answer === "string") {
			const code = answer.trim();
			if (!code) {
				child.kill();
				notice("warn", "No code to finish the sign-in with. Send /login again.");
				return;
			}
			// What the CLI has been waiting for since it printed the URL.
			child.stdin?.write(`${code}\n`);
			notice("info", "Finishing the sign-in…");
			/*
			 * The exit code is the answer, not the credentials file.
			 *
			 * The CLI exchanges the code, writes its credentials and exits 0, or prints its
			 * own refusal ("Login failed: Request failed with status code 400") and exits 1.
			 * Asking `auth status` afterwards instead cannot tell a successful re-login from
			 * the session that was already there — the same confusion the poll above had.
			 */
			await Promise.race([exited, sleep(60_000)]);
			if (exitCode === null) {
				child.kill();
				notice("error", "Claude's login did not finish. Send /login again.");
				return;
			}
			if (exitCode !== 0) {
				// The CLI's own sentence, where it has one ("Login failed: Request failed
				// with status code 400"). Prefixing it said "failed" twice in one line.
				notice("error", lastLine(stderr) || lastSaid || "Claude's login failed.");
				return;
			}
		}
		/*
		 * Who was just signed in, read back out of the CLI.
		 *
		 * The identity is what makes the list readable — a column of uuids is not an account
		 * list — and it comes from `auth status` against that directory rather than from
		 * anything Decks parsed out of the login, so it says what the CLI says.
		 */
		if (into && accounts && "remember" in accounts) {
			const identity = await claudeIdentity(into.configDir);
			/*
			 * Is this the subscription the CLI is already signed in as?
			 *
			 * Asked of the CLI's own directory, live, rather than of the label the store keeps
			 * for that row — because the label survives a `claude auth logout`, and refusing to
			 * add an account on the strength of a login that is no longer there would leave
			 * somebody with a signed-out first row and no way to add the credentials that would
			 * fix it. An email from `auth status` means signed in now.
			 */
			const mine = await claudeIdentity();
			const alreadyMine = Boolean(identity.email && mine.email && identity.email === mine.email);
			if (alreadyMine && "abandon" in accounts) {
				/*
				 * One subscription, one row — and the row it keeps is the CLI's own, which cannot
				 * go stale and is the same account by a shorter route. The credentials this login
				 * just wrote are a second copy of `~/.claude`'s, so they go with the directory.
				 *
				 * This is the bug that produced two identical rows, one with a × and one without:
				 * the copy was added, `remember()` removed the CLI's row as a duplicate, and the
				 * next read of the panel put that row straight back.
				 */
				(accounts as { abandon(id: string): unknown }).abandon(into.id);
				notice(
					"info",
					`${identity.email} is already this machine's Claude Code login, so it stays as the first account rather than becoming a second copy of itself. Nothing changed.`,
				);
				this.context.accountsChanged?.();
				return;
			}
			const remembered = (accounts as { remember(account: { id: string; email?: string; orgName?: string; plan?: string }): { email?: string } }).remember({
				id: into.id,
				...identity,
			});
			notice("info", `Signed in as ${remembered.email ?? `your ${method.noun}`}, and now using it.`);
			this.context.accountsChanged?.();
			// No restart: the account is a symlink every session reads through, so this one
			// picks it up on its next request (`claude/accounts.ts`).
			return;
		}
		notice("info", `Signed in to Claude with your ${method.noun}.`);
		await this.restart();
	}

	/** Sign out, the same way: the CLI's own `auth logout`, outside the session. */
	private async slashLogout(): Promise<void> {
		const { code, stderr } = await runClaudeCommand(["auth", "logout"]);
		if (code === 0) this.context.notice("info", "Signed out of Claude.");
		else if (stderr.trim()) this.context.notice("warn", stderr.trim().split("\n").slice(-1)[0] ?? "Could not sign out.");
		else this.context.notice("info", "Claude was not signed in.");
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
		return this.lastUsage;
	}

	/**
	 * The full reading, for the usage panel.
	 *
	 * Read fresh rather than from the cache: the panel is opened deliberately, so the one
	 * moment it is worth a round trip to the CLI is this one — the cached figures are as old
	 * as the last turn, and a session left idle for an hour would report an hour-old plan
	 * window.
	 *
	 * The mapping lives in `usage.ts` and everything it reads is `unknown`. What this method
	 * adds is the subject: **which account these windows belong to**. Decks rotates between
	 * several Claude subscriptions on its own, so "42% of the 5-hour window" is a reading
	 * with nobody attached until the report says whose it is.
	 */
	async report(): Promise<UsageReport> {
		await this.refreshUsage();
		const account = this.context.accounts?.active();
		return toUsageReport(await this.planUsage(), account?.email ?? null);
	}

	/**
	 * A subscription reaching its limit, and the next one taking over.
	 *
	 * The switch is one `rename` of a symlink and the CLI picks it up on its next request, so
	 * the conversation is not interrupted to change accounts — which is the whole point of
	 * doing it this way rather than reopening the session.
	 *
	 * **Whether the turn is re-sent is decided by whether anything happened in it.** A limit
	 * that lands before the agent has done anything is a turn that can simply be tried again
	 * on the new account. A limit that lands after three tool calls and a board write is not:
	 * Decks agents edit files, so replaying that turn could write the same board twice. So the
	 * account moves either way and the *prompt* is only re-sent when the turn was still
	 * untouched; otherwise the deck says what happened and leaves the resend to the person,
	 * who can see on the boards what got as far as being written.
	 */
	private onRateLimit(info: SDKRateLimitInfo): void {
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
				const share = typeof info.utilization === "number" ? ` (${Math.round(info.utilization)}% used)` : "";
				notice("warn", `This Claude subscription is close to its ${limitWindow(window)} limit${share}.`);
			}
			return;
		}
		if (info.status !== "rejected") {
			// Back under the limit: the next warning about this window is worth hearing again.
			this.warnedAbout = undefined;
			return;
		}

		const spent = accounts?.active();
		const reset = resetWords(info.resetsAt);
		if (!accounts) {
			notice("error", `This Claude subscription has reached its ${limitWindow(info.rateLimitType)} limit${reset}.`);
			return;
		}

		const { moved, nextReset } = accounts.rotate(spent?.id, info.resetsAt, info.rateLimitType);
		// The list moved either way — a spent account is now marked spent, which the panel
		// shows with its reset time.
		this.context.accountsChanged?.();
		if (!moved) {
			const wait = nextReset ? resetWords(nextReset) : reset;
			notice(
				"error",
				spent
					? `Every Claude account has reached its limit${wait}. Add another in settings, or wait.`
					: `This Claude subscription has reached its ${limitWindow(info.rateLimitType)} limit${reset}. Add another account in settings to switch automatically.`,
			);
			return;
		}

		/*
		 * The turn that was refused, and whether it is safe to try again.
		 *
		 * `this.streaming` is still true here — the refusal arrives before the result — so
		 * what is asked is whether the turn *did* anything, which the translator knows because
		 * every tool call and every board write went through it.
		 */
		const touched = this.context.translator.turnTouchedAnything();
		const from = spent?.email ?? "this subscription";
		const to = moved.email ?? "another account";
		if (touched) {
			notice(
				"warn",
				`${from} reached its ${limitWindow(info.rateLimitType)} limit${reset}. Switched to ${to}. This turn had already started work, so send it again to carry on.`,
			);
			return;
		}
		notice("info", `${from} reached its ${limitWindow(info.rateLimitType)} limit${reset}. Switched to ${to} and carrying on.`);
		const again = this.context.translator.lastUserText();
		if (again) this.push(again);
	}

	/** Read after each turn, because Decks' `usage()` is synchronous and this is not. */
	private async refreshUsage(): Promise<void> {
		try {
			const usage = await this.session.getContextUsage();
			this.lastUsage = {
				contextTokens: usage.totalTokens,
				contextWindow: usage.maxTokens,
				cost: (await this.spend()) ?? this.lastUsage?.cost ?? 0,
			};
		} catch {
			/* a query that has ended has no usage, which is not an error worth raising */
		}
	}

	/**
	 * What the session has cost, from the call behind the CLI's own `/usage`.
	 *
	 * Reported as zero until now, on the grounds that the call is experimental — which
	 * left the meter saying "3% ctx" beside a pi agent saying "3% ctx · $0.0018", and a
	 * cost of zero is not more honest than no figure, it is a wrong one.
	 *
	 * Held at arm's length, because the SDK's own name for it is an instruction:
	 * `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`. Probed for rather than
	 * called, so an SDK that drops or renames it degrades to the previous figure instead of
	 * throwing inside a turn — the same reason `report` treats the plan windows as a
	 * bonus rather than a field.
	 */
	private async spend(): Promise<number | undefined> {
		const usage = await this.planUsage();
		const cost = usage?.session?.total_cost_usd;
		return typeof cost === "number" && Number.isFinite(cost) ? cost : undefined;
	}

	/** The whole of what `/usage` knows, or nothing at all. */
	private async planUsage(): Promise<SDKControlGetUsageResponse | undefined> {
		const read = (this.session as Partial<Query>).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
		if (typeof read !== "function") return undefined;
		try {
			return await read.call(this.session);
		} catch {
			return undefined;
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
/** The CLI's own auth subcommand, to be run outside any session. */
function runClaudeCommand(
	args: string[],
	timeoutMs = 30_000,
	/** Which account to ask about; omitted means the CLI's own `~/.claude`. */
	configDir?: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const binary = claudeExecutable() ?? claudeBundledExecutable();
		if (!binary) {
			resolve({ code: 1, stdout: "", stderr: "No Claude Code executable found." });
			return;
		}
		const child = spawn(binary, args, {
			stdio: ["ignore", "pipe", "pipe"],
			...(configDir ? { env: { ...process.env, CLAUDE_CONFIG_DIR: configDir } } : {}),
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
		child.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
		const timer = setTimeout(() => child.kill(), timeoutMs);
		child.on("exit", (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
	});
}

/** Whether the CLI's own credentials file says signed in, and how. */
async function claudeAuthStatus(configDir?: string): Promise<{ loggedIn: boolean; label: string }> {
	try {
		const { stdout } = await runClaudeCommand(["auth", "status"], 30_000, configDir);
		const data = JSON.parse(stdout) as { loggedIn?: boolean; authMethod?: string; apiProvider?: string };
		return {
			loggedIn: data.loggedIn === true,
			label: [data.authMethod, data.apiProvider].filter(Boolean).join(" · "),
		};
	} catch {
		return { loggedIn: false, label: "" };
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/** The window a limit is about, in words rather than the wire's name for it. */
function limitWindow(type: string | undefined): string {
	switch (type) {
		case "five_hour":
			return "5-hour";
		case "seven_day":
			return "weekly";
		case "seven_day_opus":
			return "weekly Opus";
		case "seven_day_sonnet":
			return "weekly Sonnet";
		case "overage":
		case "seven_day_overage_included":
			return "overage";
		default:
			return "usage";
	}
}

/**
 * When a limit lifts, said the way a person would say it.
 *
 * A bare timestamp is not information at a glance, and the reset is usually today — so a
 * time is enough, and a date is only added when it is not today. Empty when there is no
 * reset to report, because "resets undefined" is worse than saying nothing.
 */
function resetWords(at: number | undefined): string {
	if (!at || !Number.isFinite(at)) return "";
	const when = new Date(at);
	if (Number.isNaN(when.getTime())) return "";
	const today = new Date().toDateString() === when.toDateString();
	const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return today ? ` (resets ${time})` : ` (resets ${when.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time})`;
}

/**
 * Who a config directory is signed in as, from the CLI's own `auth status`.
 *
 * Exported because the account list needs it for every row, including the CLI's own — and
 * that is the one that must be read rather than remembered: somebody who runs
 * `claude auth login` in a terminal has changed it without Decks hearing about it.
 */
export async function claudeIdentity(configDir?: string): Promise<{ email?: string; orgName?: string; plan?: string }> {
	try {
		const { stdout } = await runClaudeCommand(["auth", "status"], 30_000, configDir);
		const data = JSON.parse(stdout) as { loggedIn?: boolean; email?: string; orgName?: string; subscriptionType?: string };
		if (data.loggedIn !== true) return {};
		return {
			...(data.email ? { email: data.email } : {}),
			...(data.orgName ? { orgName: data.orgName } : {}),
			...(data.subscriptionType ? { plan: data.subscriptionType } : {}),
		};
	} catch {
		return {};
	}
}
