import { parseSlash } from "./slash.ts";
import { readFileSync } from "node:fs";
import type { AgentChat, AgentKind, AgentMode, AgentModel, AgentState, AgentUsage, ChatItem, MessagePart, ModelOption, ServerMessage, ThinkingLevel, UsageReport } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import { runtimeOf } from "../runtimes/registry.ts";
import type { CanvasBridge } from "../canvas/bridge.ts";
import type { AgentBackend, AgentBackendContext, ClaudeAccountSwitcher } from "./backend.ts";
import { ExtensionUiBridge } from "./extension-ui.ts";
import type { AgentRecord, AgentStore } from "./store.ts";
import { Translator } from "./translator.ts";
import { forBrowser, HISTORY_ITEMS } from "./wire.ts";

/**
 * An agent's conversation: what was said, and the runtime that says the agent's side of it.
 *
 * The transcript (a window of it in memory, the rest on disk, read the first time it is asked for),
 * the runtime behind it (started by the first message, not before, so a restored chat is a row
 * that costs nothing until it is spoken to), the model, mode and subscription it runs on, the
 * questions it asks the person, and the time machine: rewinding, forking and starting afresh.
 *
 * The runtime is made asynchronously (a session has to load its tools, resolve models and check
 * credentials), so a conversation exists and can be listed before it can be prompted, and a
 * message that arrives early waits for the start instead of failing. That matters because the
 * browser draws the composer at once and a person types faster than a runtime starts.
 */

/**
 * How much of the last thing said a row carries.
 *
 * The row draws one line of it, clipped, and the hover card three. It was the whole message:
 * 41 KB of a 76 KB chat list on a deck of thirty-four chats, sent again every time the list
 * is published, which is on every prompt. Two hundred and forty characters is longer than
 * anything either of those two places can show.
 */
const PREVIEW_CHARS = 240;

/** A tool call starting or ending, as the translator says it. */
type ToolEvent = Parameters<NonNullable<Translator["onTool"]>>[0];

/** What the conversation needs of the agent it is the conversation of. */
export interface ConversationHost {
	readonly id: string;
	readonly kind: AgentKind;
	readonly deck: Deck;
	readonly store: AgentStore;
	readonly port: number;
	emit(message: ServerMessage): void;
	/** Something the record keeps changed: write it shortly. */
	save(): void;
	/** Write the record now: a finished turn is the point worth being durable at. */
	writeNow(): void;
	/** The agent's record as it is now, for the one write that is not the agent's own (`reset`). */
	record(): AgentRecord;
	/** Say the agent's row again: a turn that has just ended has left a new last line. */
	sayRow(): void;
	/** It started or stopped working: for the log a restart reads, and for the turns that wait on quiet. */
	stateChanged(now: AgentState, before: AgentState): void;
	/** It used a tool on something: the canvas draws its cursor there. */
	acted?(event: ToolEvent): void;
	/** The tool the runtime's calls run through, and what that tool may reach on the agent. */
	tool(): AgentBackendContext["tool"];
	hooks(): AgentBackendContext["stageAgent"];
	/** The runtime opened: its own name for the agent, if it has one, and the canvas a resumed session had. */
	opened(name: string | undefined): void;
	/** A rewind: put what the agent held, showed and called itself back as it was at that time. */
	restoreAt(when: number): void;
	/** Stop was pressed. */
	stopped(): void;
	/** Starting afresh: what was waiting to be told to the agent is told to nobody. */
	forgetNotes(): void;
	/** This runtime answered with a model catalogue: the runtime list goes out again. */
	runtimesChanged?(): void;
}

/** What a conversation is made from: a new agent's choices, or a restored one's record. */
export interface ConversationStart {
	createdAt: number;
	/** The runtime's own reference to the session, to open it again. */
	resumeRef?: string | undefined;
	/** The model and mode to open on, handed down rather than read off disk (`Registry.create`). */
	model?: AgentModel | undefined;
	mode?: AgentMode | undefined;
	/** The Claude account to open on, for a child that should spend what its parent does. */
	account?: string | undefined;
	/** The install's Claude subscriptions (`claude/accounts.ts`). */
	accounts?: ClaudeAccountSwitcher | undefined;
	accountsChanged?: (() => void) | undefined;
	accountNeeded?: ((why: "no-account" | "asked", accountId?: string) => void) | undefined;
	commandsChanged?: (() => void) | undefined;
	bridge?: CanvasBridge | undefined;
	/** A chat read back off disk: a row first and a conversation second. */
	restored?: { lastLine?: string | undefined; lastAt?: number | undefined; model?: AgentModel | undefined; mode?: AgentMode | undefined; usage?: AgentUsage | undefined; account?: string | undefined } | undefined;
}

export class Conversation {
	readonly translator: Translator;
	readonly bridge: ExtensionUiBridge;
	private backend: AgentBackend | undefined;
	private starting: Promise<void> | undefined;
	private failure: string | undefined;
	private current: AgentState = "idle";
	/**
	 * Mutable, unlike the rest of this block: a rewind moves the session it points at, so
	 * the stored ref is refreshed from the backend rather than fixed at creation.
	 */
	private resumeRef: string | undefined;
	/** Restored from disk and not yet started — a row you can read but nothing is running. */
	private restored: boolean;
	/**
	 * Whether the stored transcript has been read into the window yet.
	 *
	 * True for anything that has never been to disk — a new agent's transcript is its own —
	 * and false for a restored one until `transcript` runs. That is the whole of the lazy
	 * load: one flag, read in one place.
	 */
	private transcriptLoaded = true;
	/**
	 * The last thing said, as the record has it, for a row whose transcript has not been read.
	 *
	 * Superseded by the window the moment the transcript loads — `chat()` asks the translator
	 * first — so this only ever draws a preview for a chat nobody has opened.
	 */
	private storedLast: { text: string; at: number } | undefined;
	/** The last model the runtime reported, kept for the record — and for a dormant chat, which has no runtime to ask. */
	private lastModel: AgentModel | undefined;
	/**
	 * The model list, kept as well as sent.
	 *
	 * The first agent starts when the server does, so its `models` frame is
	 * broadcast before any browser exists to hear it. Anything a late connection
	 * needs has to be in the greeting, not only in the event that produced it.
	 *
	 * Seeded in the constructor from what this runtime last offered on this deck
	 * (`AgentStore.rememberModels`), because a list that only exists once a session has been
	 * started is a picker that cannot be used until you have already sent a turn. Replaced
	 * by the runtime's own list as soon as there is one.
	 */
	private modelOptions: ModelOption[] = [];
	private currentMode: AgentMode | undefined;
	/**
	 * The last context and cost reading, for the same reason and with one difference.
	 *
	 * The model is *applied* from here when the runtime opens; this is only ever displayed.
	 * It is the conversation's own reading — what this transcript costs to send — so it
	 * survives a restart honestly, and it is replaced by the runtime's the moment a turn
	 * ends. Without it a chat nobody had prompted since the deck opened drew no ring at all,
	 * which is indistinguishable from a conversation that has cost nothing.
	 */
	private lastUsage: AgentUsage | undefined;
	/**
	 * Which Claude subscription this agent spends, by account id.
	 *
	 * Owned here because it is persisted here: it is on the record beside the model, so it
	 * survives a restart with the conversation and a dormant row can still say what it will
	 * spend. `claude/accounts.ts` owns the accounts and the per-agent symlinks; who is on
	 * which is this.
	 *
	 * Resolved once, at start, and then recorded — so changing the default afterwards cannot
	 * move an agent that already exists, which is the surprise the per-agent choice is for.
	 */
	private account: string | undefined;
	/** Shared with every other agent: the set of subscriptions this install can use. */
	private readonly accounts: ClaudeAccountSwitcher | undefined;
	private readonly accountsChanged: (() => void) | undefined;
	/** Ask the person to sign in to Claude (`claude/login.ts`). */
	private readonly accountNeeded: ((why: "no-account" | "asked", accountId?: string) => void) | undefined;
	/** The runtime's `/` menu moved, so the chat row that carries it has to be resent. */
	private readonly commandsChanged: (() => void) | undefined;
	/** Where an out-of-process runtime's canvas tool calls back to. */
	private readonly stageBridge: CanvasBridge | undefined;

	constructor(
		private readonly of: ConversationHost,
		start: ConversationStart,
	) {
		this.restored = start.restored !== undefined;
		/*
		 * What the conversation was last on, before any runtime exists to ask.
		 *
		 * Two jobs, and for a long time it only did the first: it is what a dormant row
		 * *says* it will use, and it is what the runtime is actually *opened on* when the
		 * row is finally prompted (`start`). Without the second the display was a promise
		 * the runtime broke: a chat left on `deepseek-v4-pro` came back saying so and
		 * then answered from pi's configured default the moment you typed.
		 */
		this.lastModel = start.restored?.model ?? start.model ?? sessionModelOf(start.resumeRef);
		this.lastUsage = start.restored?.usage;
		// What this runtime offered the last time one ran on this deck. A list that is a
		// session out of date is worth more than a picker that cannot be opened; choosing
		// from it starts the runtime, which republishes it (`setModel`).
		this.modelOptions = of.store.knownModels(of.kind);
		/*
		 * A record written before accounts existed names none, and neither does a brand new agent:
		 * both take the default, once. A record naming an account that has since been forgotten also
		 * falls back, rather than pointing a link at a directory that is gone. Read from `start`,
		 * never from `this.accounts` before it is assigned: that mistake once left every agent with
		 * no account at all, silently, since a missing one is a legal state.
		 */
		const named = start.restored?.account ?? start.account;
		this.account = named && start.accounts?.has(named) ? named : start.accounts?.defaultId();
		this.currentMode = start.restored?.mode ?? start.mode;
		this.resumeRef = start.resumeRef;
		this.accounts = start.accounts;
		this.accountsChanged = start.accountsChanged;
		this.accountNeeded = start.accountNeeded;
		this.commandsChanged = start.commandsChanged;
		this.stageBridge = start.bridge;

		/*
		 * The translator's frames pass through here so the conversation can keep the one piece of
		 * state the chat list needs, what the agent is doing, without a second path that could
		 * disagree with what the browser was told.
		 */
		this.translator = new Translator(
			of.id,
			(message) => {
				if (message.type === "agent.state") {
					const before = this.current;
					this.current = message.state;
					// The turns' whole clock: going idle starts the wait for quiet, anything else stops it.
					of.stateChanged(message.state, before);
				}
				// Rows leave trimmed: no arguments, and only a preview of a long output (`wire.ts`).
				of.emit(message.type === "chat.item" ? { ...message, item: forBrowser(message.item) } : message);
				/*
				 * A turn that has just ended has left a new last line, so the row is said here
				 * rather than wherever the turn was asked for. Work an agent gave itself ends
				 * the same way work a person typed does, and this is the one place both pass
				 * through.
				 */
				if (message.type === "agent.state" && message.state === "idle") of.sayRow();
			},
			of.deck.path,
			() => of.save(),
			/*
			 * Rows leaving the window go straight to disk, not through `save`.
			 *
			 * `save` is debounced and rewrites the whole tail; this is an append of exactly
			 * what was dropped, and it has to happen at the moment of the drop because that
			 * is the last moment those rows exist anywhere. Written before the debounce so a
			 * kill in the next second cannot lose them.
			 */
			(dropped) => of.store.archive(of.id, dropped),
		);
		this.translator.onTool = (event) => of.acted?.(event);

		/*
		 * A restored chat's transcript is **not** put back here. It is read the first time somebody
		 * asks for the conversation (`window`), because reading it for every row is what made the
		 * chat list cost the sum of every chat ever held; the row draws from the record alone,
		 * and `storedLast` is the part of the transcript a row needs.
		 */
		if (start.restored) {
			this.transcriptLoaded = false;
			if (start.restored.lastLine) this.storedLast = { text: start.restored.lastLine, at: start.restored.lastAt ?? start.createdAt };
		}

		this.bridge = new ExtensionUiBridge({
			prompt: (prompt) => of.emit({ type: "agent.prompt", agentId: of.id, prompt }),
			closePrompt: (id) => of.emit({ type: "agent.promptClosed", agentId: of.id, id }),
			notify: (text, level) => this.translator.notice(level, text),
			status: () => {},
			working: () => {},
		});
	}

	// --- what the agent's row and record say of it -------------------------------------------

	/** What it is doing now. */
	get state(): AgentState {
		return this.current;
	}

	/** Restored from disk: a row that was written before, whether or not anything has been said since. */
	get wasRestored(): boolean {
		return this.restored;
	}

	/** Whether the person has said anything in it. */
	get spoken(): boolean {
		return this.translator.userMessages().length > 0;
	}

	/** The row's facts that are the conversation's: its state, the runtime's commands, and what it runs on and has cost. */
	chatFacts(): Pick<AgentChat, "state" | "commands" | "model" | "account" | "usage"> {
		const model = this.model;
		return {
			state: this.current,
			...(this.backend ? { commands: this.backend.commands() } : {}),
			...(model ? { model } : {}),
			/*
			 * What it will spend, and what it has spent. Both were once missing from the greeting,
			 * and both are only ever *emitted* from a running backend, so on a chat nobody had
			 * prompted since the deck opened, the model picker's Subscription section had no row
			 * marked and the context ring was not drawn at all. Neither needs a runtime to answer:
			 * the account is on the record and the reading is the conversation's own.
			 */
			...(this.account ? { account: this.account } : {}),
			...(this.usage ? { usage: this.usage } : {}),
		};
	}

	/**
	 * The fields of a row that only the row carries, as they are now: the last thing said, the mode,
	 * and whether it is dormant (restored and untouched: readable, but nothing runs until it is
	 * prompted). `mode` is here rather than beside the model because nothing else announces it: a
	 * runtime reports what it asks before acting when it starts, and that is a row change.
	 */
	rowFacts(): Pick<AgentChat, "lastLine" | "lastAt" | "mode" | "dormant"> {
		const last = this.lastSaid();
		return {
			...(last ? { lastLine: last.text.slice(0, PREVIEW_CHARS), lastAt: last.at } : {}),
			...(this.currentMode ? { mode: this.currentMode } : {}),
			...(this.restored && !this.starting ? { dormant: true as const } : {}),
		};
	}

	/**
	 * What the record keeps of the conversation. The last line is the window's when it has one, and
	 * the record's own when the transcript has never been read: a dormant row still shows a preview,
	 * and a write on shutdown cannot make an old chat look like the newest one.
	 */
	record(): Pick<AgentRecord, "resumeRef" | "model" | "mode" | "usage" | "account" | "lastLine"> & { lastAt?: number } {
		const last = this.lastSaid();
		return {
			...(this.resumeRef ? { resumeRef: this.resumeRef } : {}),
			...(this.lastModel ? { model: this.lastModel } : {}),
			...(this.currentMode ? { mode: this.currentMode } : {}),
			...(this.usage ? { usage: this.usage } : {}),
			...(this.account ? { account: this.account } : {}),
			...(last ? { lastLine: last.text, lastAt: last.at } : {}),
		};
	}

	/**
	 * The rows to write beside the record, or undefined when the transcript has not been read: an
	 * unread transcript is left exactly where it is. Reading it to rewrite it would undo the restore,
	 * and writing the window, which is empty until something asks, would erase it. The session's
	 * reference is taken from the runtime each time: a rewind moves the session, and a reference
	 * from the start would point at the branch that was abandoned.
	 */
	toWrite(): ChatItem[] | undefined {
		this.resumeRef = this.backend?.sessionRef() ?? this.resumeRef;
		return this.transcriptLoaded ? this.translator.history() : undefined;
	}

	/** The agent named itself: the runtime keeps its own copy of the name. */
	setName(name: string): void {
		this.backend?.setName(name);
	}

	/** What a new browser needs that the row cannot carry: a question asked before that browser existed. */
	greet(reply: (message: ServerMessage) => void): void {
		for (const prompt of this.bridge.outstanding()) reply({ type: "agent.prompt", agentId: this.of.id, prompt });
	}

	/** The agent's token stops working: before its runtime has finished dying, so a call from a process that outlives it is refused. */
	revoke(): void {
		this.stageBridge?.revoke(this.of.id);
	}

	dispose(): void {
		this.bridge.dispose();
		this.backend?.dispose();
	}

	private lastSaid(): { text: string; at: number } | undefined {
		return this.translator.lastLine() ?? this.storedLast;
	}

	// --- the transcript ---------------------------------------------------------------------

	/**
	 * The conversation as a browser should open it — the newest rows of the window, trimmed
	 * for the wire (`wire.ts`) — and whether there is more before them. Sent when a browser
	 * asks (`chat.open`) and after a rewind; it is no longer part of the greeting.
	 *
	 * `more` is asked of the store rather than remembered, because eviction and this
	 * question have no reason to be in touch — the log either has something in it or it
	 * does not, and that is a `statSync` rather than a piece of state to keep true.
	 */
	historyMessage(): ServerMessage {
		const window = this.window();
		const shown = window.slice(-HISTORY_ITEMS);
		return {
			type: "chat.history",
			agentId: this.of.id,
			items: shown.map(forBrowser),
			// More behind it when the window holds rows it did not send, or the archive has any.
			more: window.length > shown.length || this.of.store.hasArchive(this.of.id),
		};
	}

	/** The window of the conversation held in memory, read from disk the first time it is asked for. */
	window(): ChatItem[] {
		if (!this.transcriptLoaded) {
			this.transcriptLoaded = true;
			this.translator.load(this.of.store.readItems(this.of.id));
		}
		return this.translator.history();
	}

	/**
	 * A page of conversation older than the row the browser holds, in reading order.
	 *
	 * The window first, then the archive. A history carries only the newest rows of the
	 * window, so the rows just before what a browser holds are usually still here in memory.
	 * The archive is only what is older than the window, and asked about a row it has never
	 * seen it answers with its own last page — which, asked first, would skip every row between.
	 */
	earlier(before: string, limit: number): { items: ChatItem[]; more: boolean } {
		const window = this.window();
		const at = window.findIndex((item) => item.id === before);
		if (at > 0) {
			const start = Math.max(0, at - limit);
			return { items: window.slice(start, at).map(forBrowser), more: start > 0 || this.of.store.hasArchive(this.of.id) };
		}
		const page = this.of.store.earlier(this.of.id, before, limit);
		return { items: page.items.map(forBrowser), more: page.more };
	}

	/** A tool call's whole output, for a chip that was sent only a preview of it (`chat.tool`). */
	toolResult(itemId: string): string | undefined {
		const found = this.window().find((item) => item.id === itemId) ?? this.of.store.findArchived(this.of.id, itemId);
		return found?.kind === "tool" ? found.result : undefined;
	}

	// --- the runtime behind it -----------------------------------------------------------------

	/**
	 * Start the backend, once, and remember the reason if it will not start.
	 *
	 * The only place that knows both runtimes exist. Which one an agent uses is fixed at
	 * creation: a live session cannot change the process it is talking to, and pretending
	 * otherwise would silently start a new conversation.
	 */
	start(): Promise<void> {
		// Returned before anything is built, not just before the promise is replaced. The
		// memo below is on `starting` alone, so every call used to construct a fresh stage
		// tool and context and throw them away — which was invisible while `start()` was
		// called once at creation, and is not now that a prompt is what starts an agent.
		if (this.starting) return this.starting;

		const tool = this.of.tool();

		const context: AgentBackendContext = {
			cwd: this.of.deck.path,
			deck: this.of.deck,
			translator: this.translator,
			bridge: this.bridge,
			notice: (level, text) => this.translator.notice(level, text),
			turnEnded: () => {
				if (!this.backend) return;
				this.lastUsage = this.backend.usage() ?? this.lastUsage;
				this.of.emit({
					type: "agent.usage",
					id: this.of.id,
					usage: this.usage ?? { contextTokens: null, contextWindow: 0, cost: 0 },
				});
				// A finished turn is the point worth being durable at, rather than a second
				// later: it is also the first moment the session ref exists to be stored.
				this.of.writeNow();
			},
			tool,
			stageAgent: this.of.hooks(),
			// Where a runtime that is not in this process reaches the deck: the same
			// loopback server the browser talks to.
			port: this.of.port,
			// Minted here rather than in the backend, because the token is the *agent's* and
			// outlives any one runtime process: a rewind reopens the session and the tool on
			// the other side must not be left holding a token nobody answers.
			...(this.stageBridge ? { agentToken: this.stageBridge.issue(this.of.id) } : {}),
			// …and the bridge itself, for the one runtime that shares a process and so names
			// its calls by session id rather than by a token of its own (opencode).
			...(this.stageBridge ? { stageBridge: this.stageBridge } : {}),
			...(this.resumeRef ? { resumeRef: this.resumeRef } : {}),
			// Opened *on* the model and mode the conversation was last using, rather than
			// asked what it happened to default to. Both runtimes take them at session
			// creation, which is why this is a field here and not a `setModel` afterwards:
			// a second call would write a model change into a session that never changed.
			...(this.lastModel ? { model: this.lastModel } : {}),
			...(this.currentMode ? { mode: this.currentMode } : {}),
			/*
			 * Something was taken out of the transcript, so the browser needs the whole list
			 * again — the same message a rewind sends, and for the same reason.
			 */
			historyChanged: () => {
				this.of.emit(this.historyMessage());
				this.of.save();
			},
			// The install's Claude subscriptions, so a limit can say whether there is another.
			...(this.accounts ? { accounts: this.accounts } : {}),
			/*
			 * And which of them *this* agent spends: what to spawn with, and whose usage
			 * report the meter is asking for. Read-only, now that nothing switches by itself
			 * — it used to carry a `set` the backend called when a limit moved it.
			 */
			...(this.accounts && this.account
				? { account: { id: () => this.account ?? (this.accounts as ClaudeAccountSwitcher).defaultId() } }
				: {}),
			...(this.accountsChanged ? { accountsChanged: this.accountsChanged } : {}),
			...(this.accountNeeded ? { accountNeeded: (why: "no-account" | "asked") => this.accountNeeded!(why, this.account) } : {}),
			...(this.commandsChanged ? { commandsChanged: this.commandsChanged } : {}),
			// `/cost` asked for the panel. The shell reads the figures; the backend only says
			// that somebody wants them.
			showUsage: () => void this.pushReport(),
		};

		const create: Promise<AgentBackend> = runtimeOf(this.of.kind).create(context);
		this.starting ??= create
			.then((backend) => {
				this.backend = backend;
				this.currentMode = backend.mode?.();
				// The runtime's own name for the agent, and the canvas a resumed session had (`DeckAgent`).
				this.of.opened(backend.name());
				this.lastModel = backend.model();
				this.of.emit({ type: "agent.model", id: this.of.id, model: backend.model() });
				/*
				 * And the row: a chat that was dormant is not any more, and what it asks before
				 * acting is whatever the runtime that just opened says it is. Those two change
				 * here and nowhere else, so this is where they are said.
				 */
				this.of.sayRow();
				void this.publishModels();
				// A restored chat now carries a live model; put it on the record so the
				// next boot can greet it from the store instead of from the runtime.
				this.of.save();
			})
			.catch((error: unknown) => {
				/*
				 * The usual cause is credentials — `pi auth`, or a Claude Code that is not
				 * installed. So this is a notice in the agent's own column rather than a
				 * thrown error that takes the deck down: the boards still work, and the
				 * reason is where the person is looking.
				 */
				this.failure = error instanceof Error ? error.message : String(error);
				this.translator.notice("error", `This agent could not start: ${this.failure}`);
			});
		return this.starting;
	}

	/** A Claude sign-in landed (`claude/login.ts`): the runtime reads its models anew, and the picker hears them. */
	async signedIn(): Promise<void> {
		if (!this.backend?.signedIn) return;
		await this.backend.signedIn();
		await this.publishModels();
	}

	private async publishModels(): Promise<void> {
		if (!this.backend) return;
		try {
			this.modelOptions = await this.backend.models();
			// Remembered per runtime, so the *next* chat has a picker before it has a session,
			// and published as the runtime's — one list for every chat on it, rather than the
			// same catalogue once per conversation.
			this.of.store.rememberModels(this.of.kind, this.modelOptions);
			this.of.runtimesChanged?.();
		} catch (error) {
			this.translator.notice("warn", `Could not list models: ${(error as Error).message}`);
		}
	}

	/**
	 * Say a message to the agent, as a turn: start its runtime if it has none, show the words, and
	 * hand them over with `notes` put first (what the agent should know before it reads what to do:
	 * `DeckAgent.prompt` gathers them). `parts` is the message as written (`MessagePart`), kept with
	 * it in the conversation; the runtime gets `text`.
	 */
	async say(text: string, parts: MessagePart[] | undefined, notes: (slash: boolean) => string[]): Promise<void> {
		await this.start();
		if (!this.backend) {
			this.translator.notice("error", `Not started: ${this.failure ?? "unknown reason"}`);
			return;
		}
		this.translator.user(text, parts);
		this.translator.setState("thinking");
		/*
		 * Anything the user did to a board since the last turn rides along with this
		 * message rather than arriving as its own interruption. Prefixed, not appended:
		 * the agent should know the board moved *before* it reads what to do about it.
		 */
		// A slash command by the one rule every runtime reads it by (`parseSlash`): a message that only begins with a path is a message, and gets its notes.
		const slash = parseSlash(text) !== undefined;
		const nudges = notes(slash);
		const sent = nudges.length > 0 ? `${nudges.join("\n")}\n\n${text}` : text;
		try {
			await this.backend.prompt(sent);
		} catch (error) {
			this.translator.notice("error", (error as Error).message);
			this.translator.setState("idle");
		}
		/*
		 * The "thinking" above is a **prediction**: set before the runtime has been told
		 * anything, so the row lights up when you press send rather than when the runtime's
		 * first frame arrives. A turn takes the prediction back — Pi's `agent_end`, Claude's
		 * `result`, opencode's idle frame — and a slash command is not a turn. Pi's `/compact`
		 * summarises in place, `/help`, `/name` and `/session` answer out of state the shell
		 * already has, and Claude's `/status` and Antigravity's `/models` are the same kind of
		 * thing: none of them starts an agent run, so no terminal event follows and the
		 * prediction stood **for ever**.
		 *
		 * What that cost: the chat list said "working" about an agent that was finished, so did
		 * `decks.agent.list()` for every other agent that asked, and — the part that actually bites —
		 * **the queue never drained**, because its clock starts on the return to idle. Work
		 * another agent had handed over sat behind a `/compact` until somebody pressed stop.
		 *
		 * So the runtime is asked the one question it can answer: is anything running now? A
		 * backend whose `prompt()` returns mid-turn — Claude's pushes the message and returns —
		 * says yes and keeps the state. One that ran nothing says no, and the prediction goes
		 * back. It is here rather than in each backend's command switch because there are four
		 * of those and three of them would forget.
		 */
		if (!this.backend.isStreaming && this.current !== "idle") this.translator.setState("idle");
		this.lastUsage = this.backend.usage() ?? this.lastUsage;
		this.of.emit({ type: "agent.usage", id: this.of.id, usage: this.usage ?? { contextTokens: null, contextWindow: 0, cost: 0 } });
		// The branch gained a point — the message just asked — so the transcript's user
		// messages can be paired with it and get their rewind actions.
		await this.backend.syncEntryIds();
	}

	get running(): boolean {
		return this.current !== "idle";
	}

	async abort(): Promise<void> {
		// Stopping work is also a statement that now is not the moment for more of it: the
		// countdown starts again from the return to idle below, and your queue waits for you.
		this.of.stopped();
		await this.backend?.abort();
		this.translator.setState("idle");
	}

	/**
	 * The full usage reading — the panel's own request, and `/cost`'s.
	 *
	 * Throws rather than answering emptily: the panel has a refresh button and shows what
	 * went wrong beside the figures it already has, so a failure that is reported is worth
	 * more than one that leaves the button looking broken.
	 */
	async report(): Promise<UsageReport> {
		await this.start();
		const backend = this.backend;
		if (!backend) throw new Error(this.failure ?? "This agent is not running.");
		if (!backend.report) throw new Error("This runtime does not report usage.");
		return backend.report();
	}

	/**
	 * `/cost`: the same reading, pushed with the instruction to open the panel.
	 *
	 * Broadcast rather than replied to, because nobody clicked anything in a browser — the
	 * request came from the composer as a prompt, and every tab looking at this agent should
	 * get the panel the person just asked for.
	 */
	private async pushReport(): Promise<void> {
		try {
			this.of.emit({ type: "agent.report", id: this.of.id, report: await this.report(), show: true });
		} catch (error) {
			this.of.emit({ type: "agent.report", id: this.of.id, error: (error as Error).message, show: true });
		}
	}

	// --- the time machine (§6.7) ----------------------------------------------------------------

	timeline(): ReturnType<NonNullable<typeof this.backend>["timeline"]> {
		return this.backend?.timeline() ?? [];
	}

	revisionsAt(entryId: string): Record<string, string> {
		return this.backend?.revisionsAt(entryId) ?? {};
	}

	/** When a message was sent, so a fork can inherit the canvas as it was then. */
	entryTime(entryId: string): number | undefined {
		return this.timeline().find((point) => point.id === entryId)?.at;
	}

	/**
	 * Rewind, and put the transcript back to match.
	 *
	 * Pi rebuilds its own messages; the transcript in memory is ours, so it is
	 * truncated to the same point. The text of the rewound message comes back so the
	 * browser can put it in the composer — the user is usually about to say it
	 * differently, which is why they rewound.
	 */
	async rewindTo(entryId: string): Promise<{ cancelled: boolean; editorText?: string }> {
		if (!this.backend) return { cancelled: true };
		// A rewind truncates what is here, so what is here has to be everything there is.
		this.window();
		/*
		 * The runtime hands back what the model was sent, which carries Decks' reminders before the
		 * person's words (`sent-as.ts`): that text is in no bubble, so it cut nothing and filled the
		 * input bar with a reminder. The words the person typed, from the bubble paired to this
		 * entry, are what go back in the bar and say where the transcript is cut.
		 */
		const shown = this.translator.userMessages().find((item) => item.entryId === entryId)?.text;
		const runtime = await this.backend.rewindTo(entryId);
		const result = runtime.cancelled || !shown ? runtime : { ...runtime, editorText: shown };
		if (!result.cancelled) {
			this.translator.truncateToUserMessage(result.editorText);
			this.of.emit(this.historyMessage());
			// The branch moved, so the pairing is stale for everything still shown.
			await this.backend?.syncEntryIds();
			/*
			 * And the canvas moves with the conversation, which is the whole point of
			 * rewinding: the boards, the context and the name it was going by at that
			 * moment. Resolved by time, the same way `App.boardsAt` picks a revision.
			 */
			const when = this.timeline().find((point) => point.id === entryId)?.at;
			if (when) this.of.restoreAt(when);
		}
		return result;
	}

	async forkFrom(entryId: string): Promise<string | undefined> {
		return this.backend?.forkFrom(entryId);
	}

	/**
	 * Start afresh: a new conversation with the same agent. Its turn (if any) is stopped, its runtime
	 * let go with the session it was on, and its log set aside on disk (`store.retire`); what makes it
	 * this agent stays — name, face, colour, workspace, tags, home canvas, model and mode. The next
	 * message starts a new session, as for an agent just made.
	 */
	async reset(): Promise<void> {
		if (this.running) await this.abort().catch(() => undefined);
		this.backend?.dispose();
		this.backend = undefined;
		this.starting = undefined;
		this.stageBridge?.revoke(this.of.id);
		this.resumeRef = undefined;
		this.of.forgetNotes();
		this.of.store.retire(this.of.id);
		this.translator.clear();
		this.transcriptLoaded = true;
		this.storedLast = undefined;
		this.lastUsage = undefined;
		this.of.store.writeRecord(this.of.record());
		this.of.emit(this.historyMessage());
		this.of.sayRow();
	}

	// --- model, mode and account -----------------------------------------------------------------

	/** What it is on now, live if it is running and from the record if it is not. */
	get model(): AgentModel | undefined {
		return this.backend?.model() ?? this.lastModel;
	}

	/** The model this conversation is on, live if a runtime is up, else as last recorded. */
	currentModel(): AgentModel | undefined {
		return this.backend?.model() ?? this.lastModel;
	}

	/**
	 * Change the model, and say so in the conversation.
	 *
	 * The transcript is the record of what happened, and *which model said it* is part of
	 * what happened — a long chat can span three of them, and the answer that surprised you
	 * reads differently once you know it came from a different one. The picker in the dock
	 * only ever shows the model in use *now*, so without this the switch leaves no trace at
	 * all: the reply above it and the reply below it look like the same voice.
	 *
	 * A notice rather than a kind of its own, because it is the same shape as everything else
	 * the deck says about itself — it lands at the point it happened, it is in the display
	 * copy on disk (`agents/store.ts`), and it needs no new drawing.
	 *
	 * Said only when something actually changed. Both callers are a `<select>`, which fires
	 * on every commit including one that lands on the value it already had, and a line per
	 * non-change is a transcript that logs the furniture.
	 */
	async setModel(provider: string, model: string, thinking?: ThinkingLevel): Promise<void> {
		/*
		 * A chat nobody has prompted has no runtime to tell, so the choice is written down
		 * and the runtime is **opened on it** — `start()` reads the model off the record and
		 * passes it at session creation. Recorded before starting rather than after, which is
		 * the whole point: starting first and then asking for a change opens the session on
		 * the model that was being replaced, and on the one runtime where the model is a
		 * launch flag (antigravity) that is a spawn and an immediate respawn.
		 */
		if (!this.backend) {
			this.lastModel = { provider, model, thinking: thinking ?? this.lastModel?.thinking ?? "medium" };
			this.of.emit({ type: "agent.model", id: this.of.id, model: this.lastModel });
			this.of.save();
			await this.start();
			this.reportModel();
			return;
		}
		const before = this.backend?.model();
		await this.backend?.setModel(provider, model, thinking);
		this.lastModel = this.backend?.model();
		this.noteModel(before, this.lastModel);
		this.of.emit({ type: "agent.model", id: this.of.id, model: this.backend?.model() });
		this.of.save();
	}

	/**
	 * Say what the runtime landed on, once it exists.
	 *
	 * A separate method rather than three lines inline, and not only to avoid repeating them:
	 * inside `if (!this.backend)` the compiler has narrowed the field away, so a re-read
	 * after `await this.start()` — which is precisely the point of these branches — cannot be
	 * written there at all. What was asked for and what a runtime accepts are different
	 * things (a thinking level clamped to what the model offers, a model whose credentials
	 * have gone), so the row is corrected from the runtime rather than left saying the wish.
	 */
	private reportModel(): void {
		this.lastModel = this.backend?.model() ?? this.lastModel;
		this.of.emit({ type: "agent.model", id: this.of.id, model: this.lastModel });
	}

	/**
	 * One line about a model change, or nothing.
	 *
	 * Reads the *reported* model on both sides rather than what was asked for: a runtime that
	 * falls back — a model that has lost its credentials, a thinking level clamped to what the
	 * model supports — should have the transcript say what it actually got.
	 */
	private noteModel(before: AgentModel | undefined, after: AgentModel | undefined): void {
		if (!after) return;
		const name = (model: AgentModel) => `${model.provider}/${model.model}`;
		if (before && name(before) === name(after)) {
			if (before.thinking === after.thinking) return;
			this.translator.notice("info", `Thinking: ${before.thinking} → ${after.thinking}`);
			return;
		}
		const arrow = before ? `${name(before)} → ${name(after)}` : name(after);
		this.translator.notice("info", `Model: ${arrow}${after.thinking ? ` · thinking ${after.thinking}` : ""}`);
	}

	/**
	 * How hard it thinks — the same rules as `setModel`, and it was the worse bug of the two.
	 *
	 * On a chat with no runtime this used to read `this.backend?.model()` and assign the
	 * `undefined` it got, so pressing a level on a dormant chat *erased* the model the row was
	 * showing and broadcast that erasure. Now the level is applied to the recorded model and
	 * the runtime opens on it, exactly as a model change does.
	 */
	async setThinking(level: ThinkingLevel): Promise<void> {
		if (!this.backend) {
			if (this.lastModel) {
				this.lastModel = { ...this.lastModel, thinking: level };
				this.of.emit({ type: "agent.model", id: this.of.id, model: this.lastModel });
				this.of.save();
			}
			await this.start();
			this.reportModel();
			return;
		}
		const before = this.backend.model();
		this.backend.setThinking(level);
		// `?? this.lastModel`: a runtime that does not report a model must not be allowed to
		// unset the one the row is showing — see the note above.
		this.lastModel = this.backend.model() ?? this.lastModel;
		this.noteModel(before, this.lastModel);
		this.of.emit({ type: "agent.model", id: this.of.id, model: this.lastModel });
		this.of.save();
	}

	get mode(): AgentMode | undefined {
		return this.backend?.mode?.() ?? this.currentMode;
	}

	async setMode(mode: AgentMode): Promise<void> {
		/*
		 * And the same for what it asks before acting. `start()` passes `mode` at session
		 * creation, so a dormant chat opens on the mode that was chosen rather than dropping
		 * the press: this used to return early on `!this.backend?.setMode`, which on a chat
		 * with no runtime is every press.
		 */
		if (!this.backend) {
			this.currentMode = mode;
			this.of.save();
			// `start()` reads the mode off the record and reports back what the runtime made
			// of it, so there is nothing to re-read here.
			await this.start();
			return;
		}
		if (!this.backend.setMode) return;
		await this.backend.setMode(mode);
		this.currentMode = mode;
	}

	/** What it has cost, on the same terms — and `undefined` means "not known", not "nothing". */
	get usage(): AgentUsage | undefined {
		return this.backend?.usage() ?? this.lastUsage;
	}

	/** Which subscription it is spending, for the row and for a delegated child. */
	accountId(): string | undefined {
		return this.account;
	}

	/**
	 * Which subscription this agent spends, from the panel — and it lands on the next turn.
	 *
	 * Three writes, in this order, and the order is the whole of it. The **link** first,
	 * because that is the switch: the CLI re-reads its credentials on every request, so a
	 * repointed link is in force before this method returns and without the session being
	 * touched. Then the **record**, so a restart does not undo it. Then the **transcript**,
	 * because which subscription answered is part of what happened — the same reasoning as
	 * `noteModel`, and for the same reader.
	 *
	 * Except on macOS, where the token is a keychain entry fixed when the process started:
	 * there the link moves the files and not the login, so the backend is told and starts again.
	 *
	 * A no-op when it is already on that account: both callers can arrive at the value they
	 * already had, and a line per non-change is a transcript that logs the furniture.
	 */
	useAccount(accountId: string): boolean {
		if (!this.accounts || !this.accounts.has(accountId)) return false;
		if (this.account === accountId) return true;
		this.account = accountId;
		this.accounts.pointAgentAt?.(this.of.id, accountId);
		this.of.save();
		const who = this.accounts.describe(accountId);
		this.translator.notice("info", `Now spending ${who?.email ?? "another subscription"}.`);
		this.of.emit({ type: "agent.account", id: this.of.id, account: accountId });
		this.backend?.accountChanged?.();
		return true;
	}

	// --- questions it asks ------------------------------------------------------------------------

	answerDialog(...args: Parameters<ExtensionUiBridge["answer"]>): void {
		this.bridge.answer(...args);
	}

	/** The questions this agent is waiting on an answer to, for a front end that reads them over HTTP (Studio). */
	dialogs(): ReturnType<ExtensionUiBridge["outstanding"]> {
		return this.bridge.outstanding();
	}
}

/**
 * The model a pi session was last on, read from its file.
 *
 * A chat restored from before the record carried a model has no way to say what it uses
 * except its own runtime — and starting a runtime just to ask is what dormancy exists to
 * avoid. Pi's session file records <code>model_change</code> and
 * <code>thinking_level_change</code> entries, so the last of each is the answer, read
 * without waking anything. Fail-safe by design: any parse problem means “unknown”, which
 * is the same answer a chat with no session file gives.
 */
function sessionModelOf(path: string | undefined): AgentModel | undefined {
	if (!path || !path.endsWith(".jsonl")) return undefined;
	try {
		const lines = readFileSync(path, "utf8").split("\n");
		let provider: string | undefined;
		let model: string | undefined;
		let thinking: ThinkingLevel | undefined;
		for (const line of lines) {
			if (!line.trim()) continue;
			let entry: { type?: string; provider?: string; modelId?: string; thinkingLevel?: ThinkingLevel };
			try {
				entry = JSON.parse(line) as typeof entry;
			} catch {
				continue;
			}
			if (entry.type === "model_change" && entry.provider && entry.modelId) {
				provider = entry.provider;
				model = entry.modelId;
			} else if (entry.type === "thinking_level_change" && entry.thinkingLevel) {
				thinking = entry.thinkingLevel;
			}
		}
		return provider && model ? { provider, model, thinking: thinking ?? "medium" } : undefined;
	} catch {
		return undefined;
	}
}
