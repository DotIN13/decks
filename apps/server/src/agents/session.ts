import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
	AgentCapabilities,
	AgentChat,
	AgentKind,
	AgentMode,
	AgentModel,
	AgentState,
	Camera,
	ChatItem,
	Identity,
	ModelOption,
	ServerMessage,
	SlashCommand,
	ThinkingLevel,
} from "@decks/protocol";
import { CLAUDE_CAPABILITIES, CLAUDE_COMMANDS, ClaudeBackend } from "../claude/backend.ts";
import type { Deck } from "../deck/loader.ts";
import { PI_CAPABILITIES, PI_COMMANDS, PiBackend } from "../pi/backend.ts";
import type { StageService } from "../stage/service.ts";
import { createStageTool, type DelegateReport, type DelegateSpec, type StageSnapshot, type StageTool } from "../stage/tool.ts";
import type { AgentBackend, AgentBackendContext } from "./backend.ts";
import { ExtensionUiBridge } from "./extension-ui.ts";
import type { SnapshotStore } from "./snapshot.ts";
import type { AgentRecord, AgentStore } from "./store.ts";
import { Translator } from "./translator.ts";

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
	/** The last model the runtime reported, kept for the record — and for a dormant chat, which has no runtime to ask. */
	private lastModel: AgentModel | undefined;
	private identity: Identity;
	/**
	 * The model list, kept as well as sent.
	 *
	 * The first agent starts when the server does, so its `models` frame is
	 * broadcast before any browser exists to hear it. Anything a late connection
	 * needs has to be in the greeting, not only in the event that produced it.
	 */
	private modelOptions: ModelOption[] = [];

	/** The boards this agent is holding, in the order it attached them. */
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
	private tool: StageTool | undefined;

	constructor(
		private readonly deck: Deck,
		private readonly emit: (message: ServerMessage) => void,
		private readonly stage: StageService,
		private readonly host: {
			port: number;
			camera(): Camera;
			agents(): Array<{ id: string; name: string; state: string; context: string[] }>;
			spawn(parentId: string, spec: DelegateSpec): Promise<DelegateReport>;
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
		this.currentMode = options.restored?.mode ?? options.mode;
		this.createdAt = options.restored?.createdAt ?? Date.now();
		this.identity = { name: options.name ?? "Agent", color: options.color };
		if (options.restored?.avatar) this.identity = { ...this.identity, avatar: options.restored.avatar };
		this.parentId = options.parentId;
		this.resumeRef = options.resumeRef;
		this.kind = options.kind;
		this.snapshots = options.snapshots;
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
				if (message.type === "agent.state") this.state = message.state;
				this.emit(message);
			},
			deck.path,
			() => this.save(),
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
			prompt: (prompt) => this.emit({ type: "extension.ui.prompt", prompt }),
			closePrompt: (id) => this.emit({ type: "extension.ui.prompt.closed", id }),
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
			setAvatar: (url: string) => this.setAvatar(url),
			agents: () => this.host.agents(),
			camera: () => this.host.camera(),
			spawn: (spec: DelegateSpec) => this.host.spawn(this.id, spec),
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
	 */
	setContext(paths: string[]): void {
		this.held = [...paths];
		this.playing = this.playing.filter((path) => this.held.includes(path));
		this.publishContext();
	}

	/** Set what is on the canvas. Anything shown is held, so showing can attach. */
	setInPlay(paths: string[]): void {
		const wanted = paths.filter((path, index) => paths.indexOf(path) === index);
		for (const path of wanted) if (!this.held.includes(path)) this.held.push(path);
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
				this.emit({
					type: "agent.usage",
					id: this.id,
					usage: this.backend.usage() ?? { contextTokens: null, contextWindow: 0, cost: 0 },
				});
				// A finished turn is the point worth being durable at, rather than a second
				// later: it is also the first moment the session ref exists to be stored.
				this.flush();
			},
			tool,
			stageAgent: this.stageHooks(),
			...(this.resumeRef ? { resumeRef: this.resumeRef } : {}),
			// Opened *on* the model and mode the conversation was last using, rather than
			// asked what it happened to default to. Both runtimes take them at session
			// creation, which is why this is a field here and not a `setModel` afterwards:
			// a second call would write a model change into a session that never changed.
			...(this.lastModel ? { model: this.lastModel } : {}),
			...(this.currentMode ? { mode: this.currentMode } : {}),
		};

		const create: Promise<AgentBackend> =
			this.kind === "claude" ? ClaudeBackend.create(context) : PiBackend.create(context);
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
			this.emit({ type: "models", agentId: this.id, models: this.modelOptions });
		} catch (error) {
			this.translator.notice("warn", `Could not list models: ${(error as Error).message}`);
		}
	}

	/** The backend's usage and cost, in a modal — the /cost command's surface, or the meter's click. */
	async usageModal(): Promise<void> {
		if (!this.backend) return;
		await this.backend.usageModal?.();
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
		this.emit({ type: "agent.usage", id: this.id, usage: this.backend.usage() ?? { contextTokens: null, contextWindow: 0, cost: 0 } });
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
			this.emit({ type: "chat.history", agentId: this.id, items: this.translator.history() });
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
		if (!this.backend?.setMode) return;
		await this.backend.setMode(mode);
		this.currentMode = mode;
	}

	get running(): boolean {
		return this.state !== "idle";
	}

	async abort(): Promise<void> {
		await this.backend?.abort();
		this.translator.setState("idle");
	}

	async setModel(provider: string, model: string, thinking?: ThinkingLevel): Promise<void> {
		await this.start();
		await this.backend?.setModel(provider, model, thinking);
		this.lastModel = this.backend?.model();
		this.emit({ type: "agent.model", id: this.id, model: this.backend?.model() });
		this.save();
	}

	setThinking(level: ThinkingLevel): void {
		this.backend?.setThinking(level);
		this.lastModel = this.backend?.model();
		this.emit({ type: "agent.model", id: this.id, model: this.backend?.model() });
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

	get color(): string {
		return this.identity.color;
	}

	/** What it is on now, live if it is running and from the record if it is not. */
	get model(): AgentModel | undefined {
		return this.backend?.model() ?? this.lastModel;
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
		reply({ type: "chat.history", agentId: this.id, items: this.translator.history() });
		reply({ type: "agent.state", id: this.id, state: this.state });
		reply({ type: "context.changed", agentId: this.id, boards: [...this.held], inPlay: [...this.playing] });
		if (this.backend) reply({ type: "agent.model", id: this.id, model: this.backend.model() });
		else if (this.lastModel) reply({ type: "agent.model", id: this.id, model: this.lastModel });
		if (this.modelOptions.length > 0) reply({ type: "models", agentId: this.id, models: this.modelOptions });
		// A question asked before this browser existed still needs answering, or the agent
		// that asked it waits forever.
		for (const prompt of this.bridge.outstanding()) reply({ type: "extension.ui.prompt", prompt });
	}

	answerDialog(...args: Parameters<ExtensionUiBridge["answer"]>): void {
		this.bridge.answer(...args);
	}

	dispose(): void {
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
function capabilitiesOf(kind: AgentKind): AgentCapabilities {
	return kind === "claude" ? CLAUDE_CAPABILITIES : PI_CAPABILITIES;
}

/**
 * The `/` commands a dormant chat offers without waking its runtime.
 *
 * Mirrors what each backend's `commands()` answers when it is running — a dormant
 * chat has no backend to ask, and the menu should not change when one is resumed.
 */
function commandsOf(kind: AgentKind): SlashCommand[] {
	return kind === "claude" ? CLAUDE_COMMANDS : PI_COMMANDS;
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
