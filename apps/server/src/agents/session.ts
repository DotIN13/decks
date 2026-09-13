import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
	AgentCapabilities,
	AgentChat,
	AgentKind,
	AgentMode,
	AgentModel,
	AgentState,
	AgentUsage,
	Camera,
	ChatItem,
	Identity,
	ModelOption,
	ServerMessage,
	SlashCommand,
	ThinkingLevel,
	UsageReport,
} from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import { runtimeOf } from "../runtimes/registry.ts";
import type { StageService } from "../stage/service.ts";
import { createStageTool, type DelegateReport, type DelegateSpec, type QueuedWork, type SendSpec, type StageSnapshot, type StageTool } from "../stage/tool.ts";
import type { AgentBackend, AgentBackendContext } from "./backend.ts";
import { ExtensionUiBridge } from "./extension-ui.ts";
import type { SnapshotStore } from "./snapshot.ts";
import type { ClaudeAccountSwitcher } from "./backend.ts";
import type { AgentRecord, AgentStore } from "./store.ts";
import type { StageBridge } from "../stage/bridge.ts";
import { Translator } from "./translator.ts";
import { forBrowser, HISTORY_ITEMS } from "./wire.ts";
import { cleanTags, sameTags } from "./tags.ts";

/**
 * How long an agent must have been quiet before it starts on queued work.
 *
 * Ten seconds, because the number is not really about latency — it is about never running
 * a second thing while the first one is still settling. Long enough that a turn which has
 * just ended, a tool result still arriving, or a user halfway through typing gets there
 * first; short enough that a handover is not a thing you wait around for.
 */
function quietMs(): number {
	const configured = Number(process.env.DECKS_QUEUE_IDLE_MS);
	return Number.isFinite(configured) && configured > 0 ? configured : 10_000;
}

/**
 * How many items may be waiting for one agent.
 *
 * A legibility limit like `MAX_CHILDREN`, and for the same reason: eight tasks queued
 * against a chat is already more than anybody watching can follow, and the ninth is a sign
 * that the sender should have done the work or spawned somebody to.
 */
const QUEUE_LIMIT = 8;

/** The first line of a task, for a notice that has to fit on one. */
function firstLine(task: string): string {
	const line = task.trim().split("\n")[0] ?? "";
	return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

/**
 * One agent, and everything about it that is not Pi's.
 *
 * The transcript, the identity, the state, the dialog bridge. The backend is
 * created asynchronously — a Pi session has to load extensions, resolve models and
 * check credentials — so an agent exists and can be listed before it can be
 * prompted, and a prompt that arrives early waits for `ready` instead of failing.
 * That matters because the browser draws the composer immediately and a person
 * types faster than a model runtime starts.
 */
export class DeckAgent {
	/** Kept across restarts when the agent was restored: the avatar file is addressed by it. */
	readonly id: string;
	readonly translator: Translator;
	readonly bridge: ExtensionUiBridge;

	private backend: AgentBackend | undefined;
	private starting: Promise<void> | undefined;
	private failure: string | undefined;
	private state: AgentState = "idle";
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

	/** The last model the runtime reported, kept for the record — and for a dormant chat, which has no runtime to ask. */
	private lastModel: AgentModel | undefined;
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
	/** Shared with every other agent: the set of subscriptions this install can use. */
	private readonly accounts: ClaudeAccountSwitcher | undefined;
	private readonly accountsChanged: (() => void) | undefined;
	/** The runtime's `/` menu moved, so the chat row that carries it has to be resent. */
	private readonly commandsChanged: (() => void) | undefined;
	/** Where an out-of-process runtime's canvas tool calls back to. */
	private readonly stageBridge: StageBridge | undefined;
	private identity: Identity;
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

	/**
	 * The boards this agent is holding, most-recently-touched first.
	 *
	 * The order used to be insertion order, which is how `stage.agents()` ended up answering
	 * "what is this agent working on" with everything it had ever held, oldest first. A held
	 * board is a decision the agent made — attaching one is it saying *this is what I am
	 * working from* — so the recent end is the answer to the question, and the rest of the
	 * list is history. The touch sites (`stage.attach`, a new board, a first `show`) put the
	 * newest board at the front; `setContext` keeps whatever order it is given. Re-attaching a
	 * board is a fresh touch, which is why `attach` moves it to the front rather than leaving
	 * it where it sat.
	 */
	private held: string[] = [];
	/**
	 * The subset of those on the canvas.
	 *
	 * Separate from the context because they are different decisions: what the agent is
	 * working from, and what it wants the user looking at now. A board is put in play by
	 * being attached or shown, and taken out of play without leaving the context.
	 */
	private playing: string[] = [];
	/**
	 * Things to tell the agent before its next turn.
	 *
	 * Pi could do this through `pi.sendMessage({ deliverAs: "nextTurn" })`, which is an
	 * Extension API only Pi has. A queue here works for both runtimes and keeps the
	 * behaviour the Pi version was chosen for: a board edit is not an interruption, so it
	 * rides along with whatever the user says next rather than waking the agent up.
	 */
	private pending: string[] = [];
	/**
	 * Work another agent handed over, waiting for this one to be quiet.
	 *
	 * Beside `pending` rather than in it, because they are different things arriving by
	 * different routes. A nudge is a *fact* about a board that rides along with whatever the
	 * user says next and never wakes anybody; an item here is a *task*, and it runs a turn of
	 * its own once nothing else is happening. Sharing one list would have meant either a task
	 * that waits forever for a user who has gone to lunch, or a board edit that starts a turn
	 * nobody asked for.
	 */
	private work: QueuedWork[] = [];
	/**
	 * The quiet period before the queue is drained.
	 *
	 * Armed on the way into `idle` and cancelled on the way out, so it measures *silence*
	 * rather than elapsed time: an agent that is thinking, streaming, running a tool, or —
	 * the case that matters — `waiting` on a question it asked the user is not idle, and the
	 * timer cannot fire under any of them.
	 */
	private drainTimer: ReturnType<typeof setTimeout> | undefined;
	private tool: StageTool | undefined;

	constructor(
		private readonly deck: Deck,
		private readonly emit: (message: ServerMessage) => void,
		private readonly stage: StageService,
		private readonly host: {
			port: number;
			camera(agentId: string): Camera;
			agents(): Array<{ id: string; name: string; state: string; context: string[]; tags: string[]; kind: AgentKind; holding: number }>;
			spawn(parentId: string, spec: DelegateSpec): Promise<DelegateReport>;
			/** Put work in another agent's queue, without waiting for it. */
			send(fromId: string, target: string, spec: SendSpec): { queued: true; position: number };
			/**
			 * Deliver a finished item's report to the agent that asked for it.
			 *
			 * A notice, not a queued task: it lands in the sender's transcript without running a
			 * turn of their own, which is what keeps a reply from becoming a conversation.
			 */
			report(agentId: string, text: string): void;
			/** What is waiting for one agent, for `stage.queue`. */
			queue(agentId: string): QueuedWork[];
			/**
			 * The briefing a handed-over task is run with — the same one `delegate` uses.
			 *
			 * Called when the item *runs*, not when it was queued, so the receiver reads the
			 * board as it is by then. A brief composed at send time is a snapshot of a plan
			 * that may have moved twice while it sat in the queue.
			 */
			brief(task: string, boards: string[]): string;
			recordRevision(path: string): string | undefined;
			boardPathOf(file: string): string | undefined;
		},
		options: {
			name?: string;
			color: string;
			parentId?: string;
			resumeRef?: string;
			kind: AgentKind;
			snapshots: SnapshotStore;
			store: AgentStore;
			/** The agent this one was forked from, so its canvas can be inherited. */
			forkedFrom?: { agentId: string; at: number };
			/** The model and mode to open on, handed down rather than read off disk — see `Registry.create`. */
			model?: AgentModel;
			mode?: AgentMode;
			/**
			 * The Claude account to open on, for a child that should spend what its parent does.
			 *
			 * A subagent is the parent's work continuing, so it should not quietly spend a
			 * different subscription — `stage.delegate` hands this down. Absent means the
			 * install's default.
			 */
			account?: string;
			/** The install's Claude subscriptions (`claude/accounts.ts`). */
			accounts?: ClaudeAccountSwitcher;
			accountsChanged?(): void;
			commandsChanged?(): void;
			bridge?: StageBridge;
			/**
			 * Everything a chat needs to be a row again without its runtime running
			 * (`agents/store.ts`). Its presence is also what makes the agent dormant: it
			 * exists, it can be read, and it starts nothing until it is prompted.
			 */
			restored?: {
				id: string;
				items: ChatItem[];
				context: string[];
				inPlay: string[];
				avatar?: string;
				createdAt: number;
				model?: AgentModel;
				mode?: AgentMode;
				/** What it last cost, so a dormant row can draw a ring — see `lastUsage`. */
				usage?: AgentUsage;
				/** Which subscription it was spending, so a restart does not move it. */
				account?: string;
				tags?: string[];
				userTags?: string[];
			};
		},
	) {
		this.id = options.restored?.id ?? randomUUID();
		this.store = options.store;
		this.restored = options.restored !== undefined;
		/*
		 * What the conversation was last on, before any runtime exists to ask.
		 *
		 * Two jobs, and for a long time it only did the first: it is what a dormant row
		 * *says* it will use, and it is what the runtime is actually *opened on* when the
		 * row is finally prompted (`start`). Without the second the display was a promise
		 * the runtime broke — a chat left on `deepseek-v4-pro` came back saying so and
		 * then answered from pi's configured default the moment you typed.
		 */
		this.lastModel = options.restored?.model ?? options.model ?? sessionModelOf(options.resumeRef);
		this.lastUsage = options.restored?.usage;
		// What this runtime offered the last time one ran on this deck. A list that is a
		// session out of date is worth more than a picker that cannot be opened; choosing
		// from it starts the runtime, which republishes it (`setModel`).
		this.modelOptions = options.store.knownModels(options.kind);
		/*
		 * A record written before this existed names no account, and neither does a brand new
		 * agent — both take the default, once. A record naming an account that has since been
		 * forgotten also falls back, rather than pointing a link at a directory that is gone.
		 *
		 * Read from `options`, not from `this.accounts`, and that is not a style choice: it
		 * used to be `this.accounts?.has(...)` twenty lines *above* `this.accounts = …`, so it
		 * was always `undefined` and every agent resolved to no account at all. Which is
		 * invisible from here — the field is optional and a missing one is a legal state — and
		 * fatal one level down: the backend only puts `account` on its context when this is
		 * set, so every session spawned on the machine-wide link and no per-agent switch could
		 * reach a running session. A constructor that reads its own fields in the order they
		 * happen to be written is a bug waiting for the next person to move a line.
		 */
		const named = options.restored?.account ?? options.account;
		this.account = named && options.accounts?.has(named) ? named : options.accounts?.defaultId();
		this.currentMode = options.restored?.mode ?? options.mode;
		this.createdAt = options.restored?.createdAt ?? Date.now();
		this.identity = { name: options.name ?? "Agent", color: options.color };
		if (options.restored?.avatar) this.identity = { ...this.identity, avatar: options.restored.avatar };
		/*
		 * Both tag lists come back with a restored agent.
		 *
		 * Assigned rather than pushed through `setTags`, because this runs in the constructor:
		 * the setters emit and save, and there is nobody subscribed yet and nothing to save
		 * over. Already cleaned — they were cleaned on the way in — and re-cleaning a stored
		 * value is how a cap change silently rewrites history.
		 */
		if (options.restored?.tags?.length) this.identity = { ...this.identity, tags: options.restored.tags };
		if (options.restored?.userTags?.length) this.identity = { ...this.identity, userTags: options.restored.userTags };
		this.parentId = options.parentId;
		this.resumeRef = options.resumeRef;
		this.kind = options.kind;
		this.snapshots = options.snapshots;
		this.accounts = options.accounts;
		this.accountsChanged = options.accountsChanged;
		this.commandsChanged = options.commandsChanged;
		this.stageBridge = options.bridge;
		// A fork opens a conversation that already happened, so it should open with the
		// canvas that conversation had rather than an empty context.
		if (options.forkedFrom) {
			this.snapshots.seed(options.forkedFrom.agentId, this.id, options.forkedFrom.at);
			this.apply(this.snapshots.latest(this.id));
		}

		/*
		 * The translator's frames pass through here so the agent can keep the one
		 * piece of state the chat list needs — what it is doing — without a second
		 * path that could disagree with what the browser was told.
		 */
		this.translator = new Translator(
			this.id,
			(message) => {
				if (message.type === "agent.state") {
					this.state = message.state;
					// The queue's whole clock. Going idle starts the countdown; anything else
					// stops it, which is how "quiet for ten seconds" stays true rather than
					// becoming "ten seconds after the last time it happened to be idle".
					if (message.state === "idle") this.armDrain();
					else this.cancelDrain();
				}
				// Rows leave trimmed: no arguments, and only a preview of a long output (`wire.ts`).
				this.emit(message.type === "chat.item" ? { ...message, item: forBrowser(message.item) } : message);
			},
			deck.path,
			() => this.save(),
			/*
			 * Rows leaving the window go straight to disk, not through `save`.
			 *
			 * `save` is debounced and rewrites the whole tail; this is an append of exactly
			 * what was dropped, and it has to happen at the moment of the drop because that
			 * is the last moment those rows exist anywhere. Written before the debounce so a
			 * kill in the next second cannot lose them.
			 */
			(dropped) => this.store.archive(this.id, dropped),
		);

		/*
		 * A restored chat is put back before anything can change it.
		 *
		 * `held` and `playing` are assigned rather than set through `setContext`, which
		 * would broadcast a `context.changed` for an agent no browser has been told about
		 * yet. The greeting is what carries this to a client, and it reads the same fields.
		 */
		if (options.restored) {
			this.translator.load(options.restored.items);
			this.held = [...options.restored.context];
			this.playing = options.restored.inPlay.filter((path) => this.held.includes(path));
		}

		this.bridge = new ExtensionUiBridge({
			prompt: (prompt) => this.emit({ type: "extension.ui.prompt", agentId: this.id, prompt }),
			closePrompt: (id) => this.emit({ type: "extension.ui.prompt.closed", agentId: this.id, id }),
			notify: (text, level) => this.translator.notice(level, text),
			status: () => {},
			working: () => {},
		});
	}

	/** Mutable only through `orphan`: a subagent outlives the parent it reported to. */
	parentId: string | undefined;
	readonly kind: AgentKind;
	/**
	 * Mutable, unlike the rest of this block: a rewind moves the session it points at, so
	 * the stored ref is refreshed from the backend rather than fixed at creation.
	 */
	private resumeRef: string | undefined;
	private readonly snapshots: SnapshotStore;
	private readonly store: AgentStore;
	/** Restored from disk and not yet started — a row you can read but nothing is running. */
	private readonly restored: boolean;
	private readonly createdAt: number;
	private saving: ReturnType<typeof setTimeout> | undefined;
	private currentMode: AgentMode | undefined;

	/**
	 * The parent this reported to is gone, so stop claiming it.
	 *
	 * Becomes a top-level chat rather than a row tagged with a name that no longer
	 * resolves. Its transcript is untouched — that is the point of keeping it.
	 */
	orphan(parentId: string): void {
		if (this.parentId !== parentId) return;
		this.parentId = undefined;
	}

	/** Put a remembered canvas back: what the agent held, showed and called itself. */
	private apply(snapshot: StageSnapshot | undefined): void {
		if (!snapshot) return;
		if (Array.isArray(snapshot.context)) this.setContext(snapshot.context.filter((path) => typeof path === "string"));
		if (Array.isArray(snapshot.inPlay)) this.setInPlay(snapshot.inPlay.filter((path) => typeof path === "string"));
		if (snapshot.identity?.name) this.rename(snapshot.identity.name);
		if (snapshot.identity?.avatar) this.setAvatar(snapshot.identity.avatar);
		/*
		 * Tags survive a restart, both kinds.
		 *
		 * The agent's, because a dormant agent's tags are the answer to "which of these was
		 * the one about the panel" — which is the question most often asked about the parked
		 * ones, and it would be lost exactly when it is most useful. Yours, because you typed
		 * them and nothing about a restart is a reason to throw them away.
		 */
		if (snapshot.identity?.tags) this.setTags(snapshot.identity.tags);
		if (snapshot.identity?.userTags) this.setUserTags(snapshot.identity.userTags);
	}

	/** What the canvas extension is allowed to reach on this agent (§6.2). */
	private stageHooks() {
		return {
			id: this.id,
			identity: () => this.identity,
			context: () => [...this.held],
			setContext: (paths: string[]) => this.setContext(paths),
			inPlay: () => [...this.playing],
			setInPlay: (paths: string[]) => this.setInPlay(paths),
			rename: (name: string) => this.rename(name),
			setTags: (tags: unknown) => this.setTags(tags),
			setAvatar: (url: string) => this.setAvatar(url),
			agents: () => this.host.agents(),
			camera: () => this.host.camera(this.id),
			spawn: (spec: DelegateSpec) => this.host.spawn(this.id, spec),
			send: (target: string, spec: SendSpec) => this.host.send(this.id, target, spec),
			queue: (agentId?: string) => this.host.queue(agentId ?? this.id),
			recordRevision: (path: string) => this.host.recordRevision(path),
			boardPathOf: (file: string) => this.host.boardPathOf(file),
		};
	}

	get context(): readonly string[] {
		return this.held;
	}

	get inPlay(): readonly string[] {
		return this.playing;
	}

	/**
	 * Set the context, keeping the canvas a subset of it.
	 *
	 * Detaching a board has to take it off the canvas too — a board in play that the agent
	 * is no longer holding would be a third state nobody asked for.
	 *
	 * `held` is most-recently-touched first, and the callers build the argument that way —
	 * the newest board leads. This keeps the order: it is the one place the invariant is
	 * stored, so every reader (`stage.agents()`, the rail, the canvas, the record on disk)
	 * sees the same list without each deciding what "newest" means for itself.
	 */
	setContext(paths: string[]): void {
		this.held = paths.filter((path, index) => paths.indexOf(path) === index);
		this.playing = this.playing.filter((path) => this.held.includes(path));
		this.publishContext();
	}

	/** Set what is on the canvas. Anything shown is held, so showing can attach. */
	setInPlay(paths: string[]): void {
		const wanted = paths.filter((path, index) => paths.indexOf(path) === index);
		// A board shown for the first time is the most recent touch, so it leads the held
		// list rather than joining the end. This is one of the two places a board first
		// enters `held` — the other is `stage.attach`, which fronts them itself — and both
		// must agree on what "newest" means or the recency order silently splits in two.
		for (const path of wanted) if (!this.held.includes(path)) this.held.unshift(path);
		this.playing = wanted;
		this.publishContext();
	}

	/**
	 * Forget a board that no longer exists.
	 *
	 * A deleted board left in context is worse than it sounds: the rail resolves held
	 * paths against the deck and the canvas filters the deck by what is in play, so one
	 * dead path is enough to make an agent that holds only that board show an empty rail
	 * and an empty canvas — and because the context is not empty, the "holding nothing
	 * shows the whole deck" fallback does not fire. It reads as the deck being gone.
	 */
	forget(path: string): boolean {
		if (!this.held.includes(path) && !this.playing.includes(path)) return false;
		this.held = this.held.filter((held) => held !== path);
		this.playing = this.playing.filter((playing) => playing !== path);
		this.publishContext();
		return true;
	}

	private publishContext(): void {
		this.emit({ type: "context.changed", agentId: this.id, boards: [...this.held], inPlay: [...this.playing] });
		// The boards are part of the record, and this is not a transcript change, so the
		// translator's hook does not cover it.
		this.save();
	}

	// --- the record on disk (§6.2) ----------------------------------------------------

	/**
	 * Note that something worth keeping changed, and write it shortly.
	 *
	 * Debounced because the transcript changes many times a turn — every message, every
	 * tool result — and the record is a whole-file write. A second is short enough that a
	 * `node --watch` restart lands after it and long enough that a turn costs one write
	 * rather than thirty.
	 *
	 * **An agent nobody has spoken to is not written down.** `focused()` creates one on
	 * demand so a deck is never agentless, so without this rule every boot would leave an
	 * empty "Agent" row behind and the list would fill with them.
	 */
	private save(): void {
		if (this.translator.userMessages().length === 0) return;
		if (this.saving) return;
		this.saving = setTimeout(() => {
			this.saving = undefined;
			this.flush();
		}, 1000);
	}

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
		const window = this.translator.history();
		const shown = window.slice(-HISTORY_ITEMS);
		return {
			type: "chat.history",
			agentId: this.id,
			items: shown.map(forBrowser),
			// More behind it when the window holds rows it did not send, or the archive has any.
			more: window.length > shown.length || this.store.hasArchive(this.id),
		};
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
		const window = this.translator.history();
		const at = window.findIndex((item) => item.id === before);
		if (at > 0) {
			const start = Math.max(0, at - limit);
			return { items: window.slice(start, at).map(forBrowser), more: start > 0 || this.store.hasArchive(this.id) };
		}
		const page = this.store.earlier(this.id, before, limit);
		return { items: page.items.map(forBrowser), more: page.more };
	}

	/** A tool call's whole output, for a chip that was sent only a preview of it (`chat.tool`). */
	toolResult(itemId: string): string | undefined {
		const found = this.translator.history().find((item) => item.id === itemId) ?? this.store.findArchived(this.id, itemId);
		return found?.kind === "tool" ? found.result : undefined;
	}

	/** Write the record now. */
	private flush(): void {
		if (this.translator.userMessages().length === 0) return;
		// Taken from the backend each time: a rewind moves the session, and a ref from
		// start() would point at the branch that was abandoned.
		this.resumeRef = this.backend?.sessionRef() ?? this.resumeRef;
		this.store.write(this.record(), this.translator.history());
	}

	private record(): AgentRecord {
		return {
			id: this.id,
			kind: this.kind,
			...(this.resumeRef ? { resumeRef: this.resumeRef } : {}),
			name: this.identity.name,
			...(this.identity.avatar ? { avatar: this.identity.avatar } : {}),
			color: this.identity.color,
			...(this.parentId ? { parentId: this.parentId } : {}),
			context: [...this.held],
			inPlay: [...this.playing],
			createdAt: this.createdAt,
			...(this.lastModel ? { model: this.lastModel } : {}),
			...(this.currentMode ? { mode: this.currentMode } : {}),
			...(this.usage ? { usage: this.usage } : {}),
			...(this.account ? { account: this.account } : {}),
			...(this.identity.tags?.length ? { tags: this.identity.tags } : {}),
			...(this.identity.userTags?.length ? { userTags: this.identity.userTags } : {}),
			// The last thing actually said, not the time of this write — it is what the list
			// is ordered by and what `prune` keeps, so a flush on shutdown must not make an
			// old chat look like the newest one.
			lastAt: this.translator.lastLine()?.at ?? this.createdAt,
		};
	}

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

		const tool = createStageTool({
			stage: this.stage,
			agent: this.stageHooks(),
			port: this.host.port,
			// Recorded after every run, so a rewind can put the canvas back to what it was
			// at that point and a fork can inherit it (§6.2).
			persist: (snapshot) => this.snapshots.record(this.id, snapshot),
		});
		this.tool = tool;

		const context: AgentBackendContext = {
			cwd: this.deck.path,
			deck: this.deck,
			translator: this.translator,
			bridge: this.bridge,
			notice: (level, text) => this.translator.notice(level, text),
			turnEnded: () => {
				if (!this.backend) return;
				this.lastUsage = this.backend.usage() ?? this.lastUsage;
				this.emit({
					type: "agent.usage",
					id: this.id,
					usage: this.usage ?? { contextTokens: null, contextWindow: 0, cost: 0 },
				});
				// A finished turn is the point worth being durable at, rather than a second
				// later: it is also the first moment the session ref exists to be stored.
				this.flush();
			},
			tool,
			stageAgent: this.stageHooks(),
			// Where a runtime that is not in this process reaches the deck: the same
			// loopback server the browser talks to.
			port: this.host.port,
			// Minted here rather than in the backend, because the token is the *agent's* and
			// outlives any one runtime process: a rewind reopens the session and the tool on
			// the other side must not be left holding a token nobody answers.
			...(this.stageBridge ? { canvasToken: this.stageBridge.issue(this.id, tool) } : {}),
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
				this.emit(this.historyMessage());
				this.save();
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
			...(this.commandsChanged ? { commandsChanged: this.commandsChanged } : {}),
			// `/cost` asked for the panel. The shell reads the figures; the backend only says
			// that somebody wants them.
			showUsage: () => void this.pushReport(),
		};

		const create: Promise<AgentBackend> = runtimeOf(this.kind).create(context);
		this.starting ??= create
			.then((backend) => {
				this.backend = backend;
				this.currentMode = backend.mode?.();
				const name = backend.name();
				if (name) this.identity = { ...this.identity, name };
				// A resumed session had a canvas; without this it opens holding nothing,
				// which reads as the boards having been lost.
				this.apply(this.snapshots.latest(this.id));
				this.lastModel = backend.model();
				this.emit({ type: "agent.identity", id: this.id, identity: this.identity });
				this.emit({ type: "agent.model", id: this.id, model: backend.model() });
				void this.publishModels();
				// A restored chat now carries a live model; put it on the record so the
				// next boot can greet it from the store instead of from the runtime.
				this.save();
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

	private async publishModels(): Promise<void> {
		if (!this.backend) return;
		try {
			this.modelOptions = await this.backend.models();
			// Remembered per runtime, so the *next* chat has a picker before it has a session.
			this.store.rememberModels(this.kind, this.modelOptions);
			this.emit({ type: "models", agentId: this.id, models: this.modelOptions });
		} catch (error) {
			this.translator.notice("warn", `Could not list models: ${(error as Error).message}`);
		}
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
			this.emit({ type: "agent.report", id: this.id, report: await this.report(), show: true });
		} catch (error) {
			this.emit({ type: "agent.report", id: this.id, error: (error as Error).message, show: true });
		}
	}

	async prompt(text: string): Promise<void> {
		await this.start();
		if (!this.backend) {
			this.translator.notice("error", `Not started: ${this.failure ?? "unknown reason"}`);
			return;
		}
		this.translator.user(text);
		this.translator.setState("thinking");
		/*
		 * Anything the user did to a board since the last turn rides along with this
		 * message rather than arriving as its own interruption. Prefixed, not appended:
		 * the agent should know the board moved *before* it reads what to do about it.
		 */
		const nudges = this.pending.splice(0);
		const sent = nudges.length > 0 ? `${nudges.join("\n")}\n\n${text}` : text;
		try {
			await this.backend.prompt(sent);
		} catch (error) {
			this.translator.notice("error", (error as Error).message);
			this.translator.setState("idle");
		}
		this.lastUsage = this.backend.usage() ?? this.lastUsage;
		this.emit({ type: "agent.usage", id: this.id, usage: this.usage ?? { contextTokens: null, contextWindow: 0, cost: 0 } });
		// The branch gained a point — the message just asked — so the transcript's user
		// messages can be paired with it and get their rewind actions.
		await this.backend.syncEntryIds();
	}

	/**
	 * Tell the agent the user changed a board.
	 *
	 * An agent holding an explicit context hears only about boards in it: one working
	 * on a different corner of the deck does not need to know that a sticky moved,
	 * and telling it anyway is context spent on nothing.
	 *
	 * An agent holding *nothing* hears about everything, and that case is the common
	 * one — a fresh agent has attached no boards, so the narrower rule alone meant the
	 * notification almost never fired. "No declared context" means the whole deck is
	 * its business, which is also how it behaves in every other respect.
	 */
	userEdited(path: string, summary: string): void {
		if (this.held.length > 0 && !this.held.includes(path)) return;
		const line = `The user edited ${path}: ${summary}. Read it again before assuming it says what you last wrote.`;
		// Deduplicated: editing the same board five times before saying anything should
		// not spend five lines of the next turn saying so.
		if (!this.pending.includes(line)) this.pending.push(line);
	}

	/**
	 * Run one task to completion and report — what a delegating parent awaits (§6.2).
	 *
	 * The boards it touched are found by comparing revisions either side of the run,
	 * rather than by watching what tools it called: an agent might write a board with
	 * `bash` and a heredoc, and the parent still wants to know the board changed.
	 */
	async run(text: string): Promise<{ report: string; boards: string[] }> {
		const before = new Map(this.deck.boards.map((board) => [board.path, board.rev]));
		await this.prompt(text);
		const boards = this.deck.boards
			.filter((board) => before.get(board.path) !== board.rev)
			.map((board) => board.path);
		return { report: this.translator.lastAssistantText(), boards };
	}

	// --- work handed over by another agent -------------------------------------------

	/**
	 * Take an item into this agent's queue, and say so where the user can see it.
	 *
	 * The notice is not decoration. A queue that fills silently and then starts a turn on its
	 * own is a chat that appears to talk to itself, and the first time it happens the honest
	 * reading is that something is broken — so the arrival is in the transcript at the moment
	 * it arrives, named with who sent it, and the work itself lands as an ordinary message
	 * when it runs.
	 *
	 * Returns the position it landed at: an agent that queued something behind five other
	 * items should know that before it decides to wait.
	 */
	enqueue(item: QueuedWork): number {
		if (this.work.length >= QUEUE_LIMIT) {
			throw new Error(`${this.identity.name} already has ${QUEUE_LIMIT} items waiting; nothing was queued.`);
		}
		this.work.push(item);
		this.translator.notice("info", `${item.fromName} queued work for you: ${firstLine(item.task)}`);
		// Nothing is started here. A dormant chat stays dormant until its item actually runs,
		// and `prompt()` already opens with `await this.start()` — waking a runtime at queue
		// time would mean a restored chat with something waiting behind six other items holds
		// a model process open for as long as the queue is long.
		this.armDrain();
		return this.work.length;
	}

	/** What is waiting, oldest first. A copy: the queue is drained here and nowhere else. */
	queue(): QueuedWork[] {
		return [...this.work];
	}

	/** How much is waiting, for the chat list and for `stage.agents()`. */
	get queued(): number {
		return this.work.length;
	}

	private armDrain(): void {
		if (this.drainTimer || this.work.length === 0 || this.state !== "idle") return;
		this.drainTimer = setTimeout(() => {
			this.drainTimer = undefined;
			void this.drain();
		}, quietMs());
		// So a queue waiting to drain never holds the process open — a server with nothing
		// else to do should still be able to exit, and a test should not hang for ten seconds.
		this.drainTimer.unref?.();
	}

	private cancelDrain(): void {
		if (this.drainTimer) clearTimeout(this.drainTimer);
		this.drainTimer = undefined;
	}

	/**
	 * Run one item, then let the state hook decide whether to run another.
	 *
	 * Popped *before* it runs, not after: an item that fails, or a turn the user aborts
	 * halfway, must not come back round and be tried again forever. One item at a time, and
	 * the re-arm rides on the return to idle, so a drain can never overlap a turn.
	 */
	private async drain(): Promise<void> {
		if (this.state !== "idle") return;
		const item = this.work.shift();
		if (!item) return;
		try {
			const result = await this.run(this.host.brief(item.task, item.boards));
			// A report the sender asked for is delivered to them as a notice, not as a queued
			// task. The distinction is the whole of the no-loop rule: an item in a queue runs a
			// turn when it drains, and a turn that answers a report with another report is two
			// agents talking forever. A notice lands in the sender's transcript and is read on
			// their next turn instead.
			if (item.reply) {
				const report = result.report.trim();
				if (report) this.host.report(item.from, `${this.identity.name} finished "${firstLine(item.task)}": ${report}`);
			}
		} catch (error) {
			this.translator.notice("error", `Queued work from ${item.fromName} failed: ${(error as Error).message}`);
		}
		// Belt and braces: the state hook re-arms on the way back to idle, but a turn that
		// never moved the state at all (a backend that failed to start) would otherwise leave
		// the rest of the queue stranded.
		this.armDrain();
	}

	// --- the time machine (§6.7) -----------------------------------------------------

	timeline(): ReturnType<NonNullable<typeof this.backend>["timeline"]> {
		return this.backend?.timeline() ?? [];
	}

	revisionsAt(entryId: string): Record<string, string> {
		return this.backend?.revisionsAt(entryId) ?? {};
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
		const result = await this.backend.rewindTo(entryId);
		if (!result.cancelled) {
			this.translator.truncateToUserMessage(result.editorText);
			this.emit(this.historyMessage());
			// The branch moved, so the pairing is stale for everything still shown.
			await this.backend?.syncEntryIds();
			/*
			 * And the canvas moves with the conversation, which is the whole point of
			 * rewinding: the boards, the context and the name it was going by at that
			 * moment. Resolved by time, the same way `App.boardsAt` picks a revision.
			 */
			const when = this.timeline().find((point) => point.id === entryId)?.at;
			if (when) this.apply(this.snapshots.at(this.id, when));
		}
		return result;
	}

	async forkFrom(entryId: string): Promise<string | undefined> {
		return this.backend?.forkFrom(entryId);
	}

	/** When a message was sent, so a fork can inherit the canvas as it was then. */
	entryTime(entryId: string): number | undefined {
		return this.timeline().find((point) => point.id === entryId)?.at;
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
			this.save();
			// `start()` reads the mode off the record and reports back what the runtime made
			// of it, so there is nothing to re-read here.
			await this.start();
			return;
		}
		if (!this.backend.setMode) return;
		await this.backend.setMode(mode);
		this.currentMode = mode;
	}

	get running(): boolean {
		return this.state !== "idle";
	}

	async abort(): Promise<void> {
		// Stopping work is also a statement that now is not the moment for more of it: the
		// countdown starts again from the return to idle below.
		this.cancelDrain();
		await this.backend?.abort();
		this.translator.setState("idle");
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
	 * A no-op when it is already on that account: both callers can arrive at the value they
	 * already had, and a line per non-change is a transcript that logs the furniture.
	 */
	useAccount(accountId: string): boolean {
		if (!this.accounts || !this.accounts.has(accountId)) return false;
		if (this.account === accountId) return true;
		this.account = accountId;
		this.accounts.pointAgentAt?.(this.id, accountId);
		this.save();
		const who = this.accounts.describe(accountId);
		this.translator.notice("info", `Now spending ${who?.email ?? "another subscription"}.`);
		this.emit({ type: "agent.account", id: this.id, account: accountId });
		return true;
	}

	/** Which subscription it is spending, for the row and for a delegated child. */
	accountId(): string | undefined {
		return this.account;
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
			this.emit({ type: "agent.model", id: this.id, model: this.lastModel });
			this.save();
			await this.start();
			this.reportModel();
			return;
		}
		const before = this.backend?.model();
		await this.backend?.setModel(provider, model, thinking);
		this.lastModel = this.backend?.model();
		this.noteModel(before, this.lastModel);
		this.emit({ type: "agent.model", id: this.id, model: this.backend?.model() });
		this.save();
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
		this.emit({ type: "agent.model", id: this.id, model: this.lastModel });
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
				this.emit({ type: "agent.model", id: this.id, model: this.lastModel });
				this.save();
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
		this.emit({ type: "agent.model", id: this.id, model: this.lastModel });
		this.save();
	}

	/** The agent naming itself, from M3's `stage.me.setName`. */
	rename(name: string): void {
		this.identity = { ...this.identity, name };
		this.backend?.setName(name);
		this.emit({ type: "agent.identity", id: this.id, identity: this.identity });
		this.save();
	}

	setAvatar(url: string | undefined): void {
		this.identity = { ...this.identity, avatar: url };
		this.emit({ type: "agent.identity", id: this.id, identity: this.identity });
		this.save();
	}

	/**
	 * The agent saying what it is doing, from `stage.me.setTags`. Replaces the list.
	 *
	 * Cleaned here rather than at the tool, so the one caller that is *not* a tool — a
	 * restored snapshot — cannot reintroduce a tag this build would refuse. Returns the
	 * cleaned list because the tool reports it back to the agent, which is how a model
	 * discovers that its sentence became `reading-panel-css-and`.
	 */
	setTags(raw: unknown): string[] {
		const tags = cleanTags(raw);
		// A no-op is not a change. An agent that re-sets the same tags every turn would
		// otherwise put an identity on the wire per turn and re-render every panel watching.
		if (sameTags(this.identity.tags, tags)) return tags;
		this.identity = { ...this.identity, ...(tags.length > 0 ? { tags } : { tags: undefined }) };
		this.emit({ type: "agent.identity", id: this.id, identity: this.identity });
		this.save();
		return tags;
	}

	/**
	 * Your tags on this agent, from the customise popup. A separate field, on purpose.
	 *
	 * `setTags` above replaces, so a shared list would mean the agent's next call silently
	 * deleted what you typed. The agent cannot read this field either — `stage.agents()`
	 * reports `tags` and not `userTags`, because what you think of an agent is not something
	 * it should be steering on.
	 */
	setUserTags(raw: unknown): string[] {
		const tags = cleanTags(raw);
		if (sameTags(this.identity.userTags, tags)) return tags;
		this.identity = { ...this.identity, ...(tags.length > 0 ? { userTags: tags } : { userTags: undefined }) };
		this.emit({ type: "agent.identity", id: this.id, identity: this.identity });
		this.save();
		return tags;
	}

	get tags(): string[] {
		return this.identity.tags ?? [];
	}

	get color(): string {
		return this.identity.color;
	}

	/** What it is on now, live if it is running and from the record if it is not. */
	get model(): AgentModel | undefined {
		return this.backend?.model() ?? this.lastModel;
	}

	/** What it has cost, on the same terms — and `undefined` means "not known", not "nothing". */
	get usage(): AgentUsage | undefined {
		return this.backend?.usage() ?? this.lastUsage;
	}

	get mode(): AgentMode | undefined {
		return this.backend?.mode?.() ?? this.currentMode;
	}

	/** One row in the chat list. Unread is the browser's business, not ours. */
	chat(): AgentChat {
		const last = this.translator.lastLine();
		return {
			id: this.id,
			name: this.identity.name,
			...(this.identity.avatar ? { avatar: this.identity.avatar } : {}),
			...(this.parentId ? { parentId: this.parentId } : {}),
			state: this.state,
			...(last ? { lastLine: last.text, lastAt: last.at } : {}),
			unread: 0,
			contextCount: this.held.length,
			kind: this.kind,
			capabilities: this.backend?.capabilities ?? capabilitiesOf(this.kind),
			commands: this.backend?.commands() ?? commandsOf(this.kind),
			...(this.currentMode ? { mode: this.currentMode } : {}),
			// Restored and untouched: readable, but nothing is running until it is prompted.
			...(this.restored && !this.starting ? { dormant: true as const } : {}),
		};
	}

	greet(reply: (message: ServerMessage) => void): void {
		reply({ type: "agent.identity", id: this.id, identity: this.identity });
		reply({ type: "agent.state", id: this.id, state: this.state });
		reply({ type: "context.changed", agentId: this.id, boards: [...this.held], inPlay: [...this.playing] });
		if (this.backend) reply({ type: "agent.model", id: this.id, model: this.backend.model() });
		else if (this.lastModel) reply({ type: "agent.model", id: this.id, model: this.lastModel });
		if (this.modelOptions.length > 0) reply({ type: "models", agentId: this.id, models: this.modelOptions });
		/*
		 * What it will spend, and what it has spent. Both were missing from the greeting, and
		 * both are only ever *emitted* from a running backend — so on a chat nobody had
		 * prompted since the deck opened, the model picker's Subscription section had no row
		 * marked and the context ring was not drawn at all. Neither needs a runtime to answer:
		 * the account is on the record and the reading is the conversation's own.
		 */
		if (this.account) reply({ type: "agent.account", id: this.id, account: this.account });
		if (this.usage) reply({ type: "agent.usage", id: this.id, usage: this.usage });
		// A question asked before this browser existed still needs answering, or the agent
		// that asked it waits forever.
		for (const prompt of this.bridge.outstanding()) reply({ type: "extension.ui.prompt", agentId: this.id, prompt });
	}

	answerDialog(...args: Parameters<ExtensionUiBridge["answer"]>): void {
		this.bridge.answer(...args);
	}

	dispose(): void {
		// The canvas token stops working before the runtime has finished dying, so a tool
		// call from a process that outlives its agent is refused rather than answered.
		this.stageBridge?.revoke(this.id);
		this.cancelDrain();
		// Before the backend goes: `flush` asks it for the session to resume, and a disposed
		// one cannot answer. A pending debounce is cancelled because this write supersedes it.
		if (this.saving) clearTimeout(this.saving);
		this.saving = undefined;
		this.flush();
		this.bridge.dispose();
		this.backend?.dispose();
	}
}

/**
 * What a runtime can do, without an instance of it.
 *
 * A dormant chat has no backend to ask, but its row still has to say whether the mode
 * control belongs on it — and capabilities are a property of the runtime, not of a session,
 * which is why both backends declare them as a module constant. `session.ts` is already the
 * only file that knows both runtimes exist, so the mapping belongs here rather than in the
 * neutral interface.
 */
/**
 * Which class answers for which runtime.
 *
 * A table rather than a chain of ternaries, because there are four of them now and a
 * fifth would have been a fourth place to forget. Every entry is the same shape — a
 * context in, a started backend out — which is the whole of what `AgentBackend` asks.
 */
/**
 * The runtime behind an agent: its class, its capabilities and its dormant commands.
 *
 * Three tables lived here, all keyed by kind, all listing the same four names — and this
 * file imported every runtime to fill them, which is the opposite of what `backend.ts` says
 * the layering is. They are one descriptor per runtime now (`runtimes/`), and this file
 * asks the registry rather than naming anybody.
 */
function capabilitiesOf(kind: AgentKind): AgentCapabilities {
	return runtimeOf(kind).capabilities;
}

/**
 * The `/` commands a dormant chat offers without waking its runtime.
 *
 * Mirrors what each backend's `commands()` answers when it is running — a dormant
 * chat has no backend to ask, and the menu should not change when one is resumed.
 */
function commandsOf(kind: AgentKind): SlashCommand[] {
	return runtimeOf(kind).commands;
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
