import type { AgentCapabilities, AgentMode, AgentModel, AgentUsage, ModelOption, SlashCommand, ThinkingLevel } from "@decks/protocol";
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
	/** Tell the browser the account list moved, after a login or a switch. */
	accountsChanged?(): void;
}

/**
 * What a backend needs from the account store, and nothing more.
 *
 * Narrowed to an interface here rather than importing the class, so `agents/` does not
 * depend on `claude/` — the shell knows there is a thing that can rotate an account, and
 * only `claude/backend.ts` knows what one is.
 */
export interface ClaudeAccountSwitcher {
	/** What `CLAUDE_CONFIG_DIR` should be, or nothing to leave the CLI on its own default. */
	activeConfigDir(): string | undefined;
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
	/** The runtime's own usage and cost, in a modal the browser shows. */
	usageModal?(): Promise<void>;

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
