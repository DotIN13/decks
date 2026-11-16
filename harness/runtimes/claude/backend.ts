// One Decks agent run by Claude Code, built on its open query (query.ts): the
// conversation and its commands, sign-in, accounts, model, usage, modes and rewinds.
import { sentAs } from "../shared/sent-as.ts";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { forkSession, getSessionMessages, renameSession, type Query, type SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { AgentCapabilities, AgentMode, AgentModel, AgentUsage, ModelOption, SlashCommand, ThinkingLevel, UsageReport } from "../types/index.ts";
import type { AgentBackend, AgentBackendContext, ConversationPoint } from "../backend.ts";
import { helpText, mergeCommands, parseSlash, sameCommands } from "../shared/slash.ts";
import { claudeAvailability, claudeBundledExecutable, claudeExecutable } from "./available.ts";
import { claudeAuthStatus, claudeIdentity, firstUrl, lastLine, plain, runClaudeCommand } from "./login.ts";
import { probeUsage, sessionCost } from "./limits.ts";
import { accountEnvironment, toUsageReport } from "../../accounts/index.ts";
import { ClaudeQuery, CLI_MODE, DEFAULT_MODE, PROVIDER, describe, effortOf } from "./query.ts";

/**
 * Claude Code behind one Decks agent (DESIGN §6.2).
 *
 * One `query()` per agent, in streaming-input mode, held open for the agent's life rather
 * than one per turn. Streaming input is what makes `interrupt()`, `setModel()`,
 * `setPermissionMode()` and `getContextUsage()` available at all; a fresh query per message
 * would re-pay process start every turn and lose every one of them. The cost is a `claude`
 * child process per started agent, which is what `dispose` closes.
 *
 * What is *not* here: the transcript (`shared/translator.ts`, shared with Pi), and the
 * guidelines every agent is given (the canvas tool, likewise).
 */



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

export class ClaudeBackend extends ClaudeQuery implements AgentBackend {
	readonly capabilities = CLAUDE_CAPABILITIES;
	/** The `/` menu: the deck's own, with whatever the CLI declares merged under them. */
	private commandList: SlashCommand[] = CLAUDE_COMMANDS;

	private constructor(context: AgentBackendContext) {
		super(context);
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
	protected async refreshCommands(): Promise<void> {
		try {
			this.setCommands(await this.session.supportedCommands());
		} catch {
			// A CLI too old to answer is a shorter menu, not a broken agent.
		}
	}

	/** One list in, one list out, and the browser told if it moved. */
	protected setCommands(declared: Array<{ name: string; description?: string; argumentHint?: string; aliases?: string[] }>): void {
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
					helpText(this.commands()),
				);
				return;
			case "cost":
				// The panel, not a paragraph. The shell reads the figures and sends them with
				// the instruction to open it (`session.pushReport`).
				this.context.showUsage?.();
				return;
			default:
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
	 *    matches both at once and yields a doubled, unusable address (`login.ts`).
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
		 * one (`accounts/accounts.ts`).
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
			// Aimed at the account's own directory rather than the link, and told to keep the
			// token under that directory's name — so the session, which reaches the same
			// account *through* the link, still finds it on macOS (`accountEnvironment`).
			...(into ? { env: accountEnvironment(into.configDir, into.configDir) } : {}),
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
			// A row of its own, or the new login written over the row already on the list for this
			// subscription (same email) or API account (same key) (`ClaudeAccounts.remember`).
			const remembered = (accounts as { remember(account: { id: string; email?: string; orgName?: string; plan?: string; kind: "subscription" | "api" }): { email?: string; replaced?: true } }).remember({
				id: into.id,
				...identity,
				kind: method.flag === "--console" ? "api" : "subscription",
			});
			const who = remembered.email ?? `your ${method.noun}`;
			notice("info", remembered.replaced ? `Signed in again as ${who}: its row now has the new login, and is in use.` : `Signed in as ${who}, and now using it.`);
			this.context.accountsChanged?.();
			// No restart: the account is a symlink every session reads its credentials through,
			// so this one picks it up on its next request (`accounts/accounts.ts`).
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

	// --- moving to another account ---------------------------------------------------

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
			this.restartForAccount = true;
			return;
		}
		void this.restart();
	}

	/** Whether this process was started on an account other than the one the agent is on now. */
	protected onOtherAccount(): boolean {
		const now = this.context.account?.id();
		return this.startedOn !== undefined && now !== undefined && now !== this.startedOn;
	}

	/**
	 * Reopen the query against the same session, picking up new options (a key).
	 *
	 * The same dance a rewind does: close the old stream, start a new one against the
	 * same session id, then let the old one go.
	 */
	protected async restart(): Promise<void> {
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

	// --- usage -----------------------------------------------------------------------

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
	 * adds is the subject: **which account these windows belong to**. An install can have
	 * several Claude subscriptions signed in at once, so "42% of the 5-hour window" is a
	 * reading with nobody attached until the report says whose it is.
	 */
	async report(): Promise<UsageReport> {
		/*
		 * Whose subscription this is, asked of the CLI rather than read off the row.
		 *
		 * The stored label is what the account was called when it was added, and it goes
		 * stale the moment somebody runs `claude auth login` in a terminal — which had the
		 * panel captioned with an account the machine was no longer signed in as. One short
		 * subprocess, and the stored label is still there as the answer when the CLI is slow.
		 */
		const accounts = this.context.accounts;
		/*
		 * This agent's account, not a machine-wide one. The meter says whose subscription is
		 * being spent, and with one per conversation the answer is the conversation's — a
		 * panel naming the install default while the turn bills somewhere else is worse than
		 * no panel.
		 */
		const mine = this.context.account?.id();

		/*
		 * One plan read, and everything else beside it.
		 *
		 * Measured against a live account: `get_usage` is a 2.0 s round trip through the CLI,
		 * `auth status` a 0.36 s subprocess, `getContextUsage` 0.35 s — and **two**
		 * `get_usage` calls are 4.0 s, because the CLI answers control requests one at a
		 * time. This method used to make two of them (`refreshUsage` asks for the session's
		 * cost, and the mapping below asks for the windows) with the subprocess between, in a
		 * chain: 4.9 s of a panel saying "Reading…" for a question it had already asked.
		 *
		 * So the read is started once here and *handed* to `refreshUsage`, rather than
		 * refreshed independently — passing the promise and not the value, because a
		 * `getContextUsage` that queues behind it finishes after the read has settled, and a
		 * value asked for then is a second round trip. Measured at 2.3 s, which is the one
		 * read plus the context reading queued behind it.
		 */
		const plan = this.planUsage();
		/*
		 * The windows of the account the agent is on *now*.
		 *
		 * Measured 2026-10-09 against two real subscriptions: a session moved from one at 60% to
		 * one at 0% sent its next turn on the new one (its rate-limit event said 0%, with the new
		 * account's reset time), while its usage read went on saying 60% for as long as it was
		 * asked. The CLI re-reads its credentials for a message but not for `/oauth/usage`. So
		 * after a switch the windows come from a process started on the new account, and only
		 * the session's own cost still comes from the session.
		 */
		const moved = accounts && mine && this.startedOn !== undefined && mine !== this.startedOn;
		const windows = moved ? probeUsage(accounts.environmentFor(this.context.agent.id, mine)).then((fresh) => fresh ?? plan) : plan;
		const [usage, identity] = await Promise.all([
			windows,
			accounts ? claudeIdentity(accounts.keychainDir(mine ?? accounts.active()?.id ?? "") || undefined) : Promise.resolve({} as Awaited<ReturnType<typeof claudeIdentity>>),
			this.refreshUsage(plan),
		]);
		return toUsageReport(usage, identity.email ?? (mine ? accounts?.describe(mine)?.email : accounts?.active()?.email) ?? null);
	}

	/**
	 * Read after each turn, because Decks' `usage()` is synchronous and this is not.
	 *
	 * The plan read is a *promise* and has a default, so a caller with one already in the air
	 * hands it over (`report`) and a caller without one starts it here — started before the
	 * context reading is awaited either way, so the two go together rather than one after the
	 * other. Handing over the value instead of the promise would not work: the context read
	 * queues behind the plan read in the CLI, so by the time it answers the plan read has
	 * settled and asking again is a second two-second round trip.
	 */
	protected async refreshUsage(plan: Promise<SDKControlGetUsageResponse | undefined> = this.planUsage()): Promise<void> {
		try {
			const context = await this.session.getContextUsage();
			this.lastUsage = {
				contextTokens: context.totalTokens,
				contextWindow: context.maxTokens,
				cost: sessionCost(await plan) ?? this.lastUsage?.cost ?? 0,
			};
		} catch {
			/* a query that has ended has no usage, which is not an error worth raising */
		}
	}

	/**
	 * The whole of what `/usage` knows, or nothing at all.
	 *
	 * Single-flight: a read already in the air is handed to the next caller rather than
	 * joined by a second one. Opening the panel asks this question twice over — once for the
	 * windows and once for the session's cost — and each ask is a two-second round trip to
	 * the CLI. Nothing is cached *past* the answer: the promise is forgotten when it settles,
	 * so a refresh press is always a fresh read.
	 */
	private planRead?: Promise<SDKControlGetUsageResponse | undefined>;

	private planUsage(): Promise<SDKControlGetUsageResponse | undefined> {
		if (this.planRead) return this.planRead;
		const read = (this.session as Partial<Query>).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
		if (typeof read !== "function") return Promise.resolve(undefined);
		const pending = read.call(this.session).catch(() => undefined);
		this.planRead = pending;
		void pending.finally(() => {
			if (this.planRead === pending) this.planRead = undefined;
		});
		return pending;
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
			if (!sentAs((entry.message as { content?: unknown } | undefined)?.content, item.text)) break;
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
	 * The session id to resume (`AgentBackend.sessionRef`).
	 *
	 * Reassigned by `rewindTo`, which forks and stays in the new session — so this is the
	 * live branch rather than the one the agent started on.
	 */
	sessionRef(): string | undefined {
		return this.sessionId;
	}

	/**
	 * The same point, as a session of its own.
	 *
	 * `forkSession` copies the transcript into a new session id, so the fork is resumable
	 * exactly like any other session and the original is untouched. `upToMessageId` is
	 * *inclusive* and Decks forks from *before* a message — so the new chat opens with it
	 * unasked — which means cutting at the message before ours.
	 */
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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- the session tree -------------------------------------------------------------

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

