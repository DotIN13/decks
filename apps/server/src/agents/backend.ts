import type { AgentCapabilities, AgentMode, AgentModel, AgentUsage, ModelOption, SlashCommand, ThinkingLevel, UsageReport } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import type { StageAgentHooks, StageTool } from "../stage/tool.ts";
import type { ExtensionUiBridge } from "./extension-ui.ts";
import type { Translator } from "./translator.ts";

/**
 * What the shell needs from an agent, and nothing about how it works.
 *
 * There are two implementations: Pi and Claude Code. The interface predates the second
 * one, for the same reason `translator.ts` is separate from `pi/events.ts` — the
 * transcript, the identity and the chat list are the same for every agent — and the
 * second one arriving is what tested the claim.
 *
 * What differs between runtimes lives in `capabilities` rather than in a method that
 * throws: a client that can see what an agent cannot do never offers it.
 */
export interface AgentBackendContext {
	cwd: string;
	deck: Deck;
	translator: Translator;
	bridge: ExtensionUiBridge;
	/** For things that are the environment's fault rather than the agent's. */
	notice(level: "info" | "warn" | "error", text: string): void;
	/**
	 * A turn finished.
	 *
	 * Only a backend whose `prompt()` returns before the turn does needs this — Claude's
	 * does, because the turn runs on its message stream. Pi's `prompt()` awaits, so the
	 * shell already knows.
	 */
	turnEnded?(): void;
	/**
	 * The canvas tool, defined once and adapted by each backend (§6.3).
	 *
	 * Not a Pi extension any more: Pi takes a tool definition directly, the Claude SDK
	 * takes an in-process MCP server, and the description and guidelines are the part
	 * that matters and must not drift between them.
	 */
	tool: StageTool;
	/**
	 * The agent behind the tool, for the parts of a backend that are not the tool itself.
	 *
	 * Pi's adapter needs it to attribute a board revision to a turn; nothing else does.
	 */
	stageAgent: StageAgentHooks;
	/**
	 * The port Decks' own HTTP server is on.
	 *
	 * Only the out-of-process runtimes need it, and they need it for one thing: the canvas
	 * tool's other end (`stage/bridge.ts`) is a route on that server, so a tool body running
	 * inside opencode's Bun or antigravity's Python has an address to call back on.
	 */
	port: number;
	/**
	 * This agent's canvas token, for a runtime that is not in this process.
	 *
	 * Pi and Claude reach `tool` directly — a closure in this process. opencode registers a
	 * TypeScript tool that runs in its own Bun runtime and antigravity a Python function
	 * inside its SDK's, so for those two the tool body is an HTTP call and this is what it
	 * authenticates with. Absent for the in-process runtimes, which have no use for it.
	 */
	canvasToken?: string;
	/**
	 * The stage bridge, for a runtime whose canvas tool is an HTTP call back here.
	 *
	 * opencode shares one `opencode serve` across every opencode agent, so its tool cannot
	 * carry a per-agent token any more — it sends the session id opencode gave it, and the
	 * backend needs the bridge to bind that session to this agent (`stage/bridge.ts`). The
	 * in-process runtimes have no use for it and antigravity authenticates by token alone.
	 */
	stageBridge?: import("../stage/bridge.ts").StageBridge;
	/** A session file to open instead of starting a new one — see `forkFrom`. */
	resumeRef?: string;
	/**
	 * The model the conversation was last on, for a session being resumed.
	 *
	 * Both runtimes take a model at session creation and neither reads one back out of a
	 * resumed session, so without this a chat continued after a restart answers from
	 * whatever the runtime's own configuration says — which is not the model the rest of
	 * the conversation was held in, and not what the row promised (`agents/store.ts`).
	 *
	 * Advisory: a model that has since lost its credentials, or been renamed, is not worth
	 * refusing to start over. A backend that cannot honour it falls back and reports what
	 * it actually opened on, which is what `model()` is for.
	 */
	model?: AgentModel;
	/** What it last asked before acting, on a runtime that has modes. */
	mode?: AgentMode;
	/**
	 * The Claude subscriptions this install can use (`claude/accounts.ts`).
	 *
	 * On the context rather than reached for globally, because it is the *shell's* — one
	 * store for the install, handed to whichever backends can use it. Pi ignores it: its
	 * credentials are `pi auth`'s business and it has no equivalent of a plan window.
	 */
	accounts?: ClaudeAccountSwitcher;
	/**
	 * The transcript changed in a way `chat.item` cannot express — something was removed.
	 *
	 * One caller, and it is why this exists rather than being a general facility: a turn
	 * whose whole reply was a transient auth failure is taken back before it is retried
	 * (`claude/transient.ts`). The shell re-sends the history, exactly as a rewind does.
	 */
	historyChanged?(): void;
	/** Tell the browser the account list moved, after a login or a switch. */
	accountsChanged?(): void;
	/**
	 * Which Claude subscription this agent spends, and how to change it.
	 *
	 * Read at spawn and written when a limit moves it. The *session* owns the value — it is
	 * on the agent's record and persists with the conversation — so this is a window onto
	 * it rather than a second copy: `id()` is what to spawn with, and `set()` is how a
	 * rotation makes the change stick.
	 */
	account?: {
		id(): string;
		set(accountId: string): void;
	};
	/**
	 * The `/` menu changed: republish the chat row that carries it.
	 *
	 * A runtime's command list is not fixed at start — Claude discovers skills as the
	 * agent moves about, and pushes a replacement when it does — and the browser caches
	 * the list per chat, so a list that moved has to be pushed rather than waited for.
	 */
	commandsChanged?(): void;
	/**
	 * Open the usage panel, unasked — `/cost`, typed in the composer.
	 *
	 * The backend does not draw it and does not format it: it says the person asked, and the
	 * shell reads the report and sends it with `show`. Which is the difference between this
	 * and what was here before, where each backend built its own list of `label: value`
	 * strings and so each decided how usage looked.
	 */
	showUsage?(): void;
}

/**
 * What a backend needs from the account store, and nothing more.
 *
 * Narrowed to an interface here rather than importing the class, so `agents/` does not
 * depend on `claude/` — the shell knows there is a thing that can rotate an account, and
 * only `claude/backend.ts` knows what one is.
 */
export interface ClaudeAccountSwitcher {
	/** What `CLAUDE_CONFIG_DIR` should be, or nothing when the link cannot be made. */
	activeConfigDir(): string | undefined;
	/**
	 * The whole environment a session must be spawned with to spend the active account —
	 * the config directory and, for macOS, which keychain entry that account's token is in.
	 */
	activeEnvironment(): NodeJS.ProcessEnv | undefined;
	/**
	 * The same, for **one agent spending one account**: its own link, so that repointing it
	 * switches that agent and nobody else. This is what a session is actually spawned with;
	 * `activeEnvironment` remains for the machine-wide paths that have no agent.
	 */
	environmentFor(agentId: string, accountId: string): NodeJS.ProcessEnv | undefined;
	/** Which account a new agent starts on, when its record does not name one. */
	defaultId(): string;
	/** Repoint one agent's link, so its next request spends a different subscription. */
	pointAgentAt?(agentId: string, accountId: string): boolean;
	/** An agent is gone: drop its link. */
	releaseAgent?(agentId: string): void;
	/** Whether an id still names an account: a record can outlive the account it names. */
	has(id: string): boolean;
	/** Who an id is, for the sentence a switch says. */
	describe(id: string): { id: string; email?: string } | undefined;
	/**
	 * Mark the account that refused as spent and say which one to move to, without moving
	 * anybody. Being spent belongs to the subscription; where an agent goes next is the
	 * agent's, and is written to its record by whoever asked.
	 */
	nextFor(
		spent: string | undefined,
		resetsAt: number | undefined,
		limitType: string | undefined,
	): { moved?: { id: string; email?: string }; nextReset?: number };
	/** The account's own directory, as opposed to the link. Empty for the CLI's own login. */
	keychainDir(id: string): string;
	/** Which account is in force, by id, so a one-off command can be aimed at it. */
	activeId(): string;
	/** Which account is in force, for the sentence a switch says. */
	active(): { id: string; email?: string } | undefined;
	/**
	 * Give up on the account that just refused and take the next one.
	 *
	 * Returns the account moved to, or the soonest any of them will be usable again when
	 * they are all spent.
	 */
	rotate(
		except: string | undefined,
		resetsAt: number | undefined,
		limitType: string | undefined,
	): { moved?: { id: string; email?: string }; nextReset?: number };
}

/**
 * A point in a conversation the server can address: one per user message.
 *
 * Server-internal. It used to be a protocol type feeding a timeline widget; the widget
 * is gone (its actions moved onto the messages themselves) and what remains is the one
 * use that never was drawing — matching a revision to the moment a message was sent.
 */
export interface ConversationPoint {
	id: string;
	at?: number;
}

export interface AgentBackend {
	readonly capabilities: AgentCapabilities;

	prompt(text: string): Promise<void>;
	abort(): Promise<void>;
	readonly isStreaming: boolean;

	/**
	 * What typing `/` in the composer can do on this runtime. The deck interprets
	 * some of them itself; the rest pass through to the runtime as prompts.
	 */
	commands(): SlashCommand[];

	model(): AgentModel | undefined;
	setModel(provider: string, model: string, thinking?: ThinkingLevel): Promise<void>;
	setThinking(level: ThinkingLevel): void;
	/** Only meaningful when `capabilities.modes` is non-empty. */
	setMode?(mode: AgentMode): Promise<void>;
	mode?(): AgentMode | undefined;
	models(): Promise<ModelOption[]>;
	usage(): AgentUsage | null;
	/**
	 * The full reading: the plan's windows, what this conversation spent, what drove it.
	 *
	 * Optional because it is a round trip to the runtime and not every runtime has one to
	 * make. A backend without it is not asked, and the panel says which parts a runtime
	 * cannot answer rather than drawing them empty.
	 */
	report?(): Promise<UsageReport>;

	/** The name the agent gave itself, if it has (M3: `stage.me.setName`). */
	name(): string | undefined;
	setName(name: string): void;

	// --- the session tree (§6.7, the time machine) ---------------------------------

	/**
	 * A handle that reopens *this* conversation — what `resumeRef` will be next time.
	 *
	 * Both runtimes already hold it and neither exposed it: pi's is the session file path,
	 * Claude's is the session id. Read after a turn rather than only at start, because a
	 * rewind moves it — Claude's rewind is a fork it stays in, so the id changes and a
	 * stored ref taken at start would point at the abandoned branch.
	 *
	 * `undefined` before the session exists, which is why an agent that has never run is
	 * not worth persisting.
	 */
	sessionRef(): string | undefined;

	/** The points in this conversation worth returning to: the user's messages. */
	timeline(): ConversationPoint[];
	/**
	 * Tag the transcript's user messages with the session entries they became.
	 *
	 * Async because Claude's message ids come from reading the session file, which Pi
	 * can do from memory.
	 */
	syncEntryIds(): Promise<void>;
	/** Which revision each board was at, at that point in the conversation. */
	revisionsAt(entryId: string): Record<string, string>;
	/** Move the conversation back to just before that message. */
	rewindTo(entryId: string): Promise<{ cancelled: boolean; editorText?: string }>;
	/** A handle a new chat can open, holding everything up to that point. */
	forkFrom(entryId: string): Promise<string | undefined>;

	dispose(): void;
}
