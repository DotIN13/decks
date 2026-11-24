import { randomUUID } from "node:crypto";
import type { ActBox, ActKind, AgentChat, AgentKind, AgentMode, AgentModel, AgentState, AgentUsage, Camera, Identity, MessagePart, ServerMessage } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import type { CanvasService } from "../canvas/service.ts";
import { createDecksTool, type DecksTool } from "../calls/tool.ts";
import { PERSON, type CreateSpec, type QueuedWork, type SendSpec, type CanvasSnapshot } from "./work.ts";
import type { AgentStateStore } from "./agent-state.ts";
import type { ClaudeAccountSwitcher } from "./backend.ts";
import type { AgentRecord, AgentStore } from "./store.ts";
import type { CanvasBridge } from "../canvas/bridge.ts";
import type { Act } from "./acts.ts";
import { cleanTags, sameTags } from "./tags.ts";
import { cleanWorkspace } from "./workspaces.ts";
import { identityReminder } from "./identity-reminder.ts";
import { lookingLineIn, type LookingAt } from "./looking-at.ts";
import { canvasNameReminder } from "../canvas/canvas-name.ts";
import { Conversation } from "./conversation.ts";
import { Inbox } from "./inbox.ts";
import { cleanPlaces, Seat } from "./seat.ts";
import { Turns } from "./turns.ts";

/**
 * One agent: who it is, and the four parts it is made of.
 *
 * What is its own is here: its name, face, colour, tags and workspace, its record on disk, its row
 * in the agents list, and the tool its calls run through. The rest is a part with one job each, and
 * a caller asks the part:
 *
 * - `conversation`: what was said, and the runtime that says the agent's side of it (`conversation.ts`);
 * - `seat`: its home canvas, the cards it holds, what it has seen of its canvases (`seat.ts`);
 * - `turns`: what it is asked to do, and in what order (`turns.ts`);
 * - `inbox`: what waits for it when it asks, and that an agent working outside Decks is here (`inbox.ts`).
 *
 * The parts do not know each other. Each is handed what it needs of the agent as plain functions,
 * and the agent is where they meet: a message is said by the conversation with the seat's news put
 * first (`prompt`), and a turn that ends tells the turns part that the agent has gone quiet.
 */
export class DeckAgent {
	/** Kept across restarts when the agent was restored: the avatar file is addressed by it. */
	readonly id: string;
	readonly conversation: Conversation;
	readonly seat: Seat;
	readonly turns: Turns;
	readonly inbox: Inbox;

	private tool: DecksTool | undefined;
	private personal: DecksTool | undefined;

	private identity: Identity;

	/** The workspace it works in: its own fact, set by it or by you, kept on the record. */
	private workspaceChosen: string | undefined;

	/**
	 * Things to tell the agent before its next turn.
	 *
	 * A change the person made to a card, or that the agent was moved to another canvas, is not an
	 * interruption: it rides along with whatever is said next rather than waking the agent up. Kept
	 * here and not left to a runtime, so every runtime behaves the same.
	 */
	private pending: string[] = [];

	constructor(
		private readonly deck: Deck,
		private readonly emit: (message: ServerMessage) => void,
		private readonly stage: CanvasService,
		private readonly host: {
			port: number;
			camera(agentId: string): Camera;
			/**
			 * A board was given a place: the arrangement changed, so the deck state has to go out.
			 *
			 * Optional because a unit fixture has no browsers to tell; absent means the place is
			 * recorded and nothing is broadcast, which is exactly right for a test.
			 */
			arranged?(): void;
			/**
			 * This agent's runtime answered with a model catalogue: send the runtime list again.
			 *
			 * The catalogue belongs to the runtime rather than to this conversation, so it is
			 * published there and not from here. Optional on the same terms as the two above.
			 */
			runtimesChanged?(): void;
			agents(): Array<{ id: string; name: string; state: AgentState; context: string[]; tags: string[]; kind: AgentKind; holding: number }>;
			/** Put work in another agent's queue, without waiting for it. */
			send(fromId: string, target: string, spec: SendSpec): { queued: true; position: number };
			/** Deliver now (`agent.send`); optional so a host with no registry can leave it out. */
			deliver?(fromId: string, target: string, spec: { task: string; boards?: string[] }): { delivered: boolean; turn: "running" | "new" | "queued"; position?: number; note?: string };
			/** Make an agent, idle, for a send to follow. Optional: a host without a registry has none. */
			create?(fromId: string, spec: CreateSpec): Promise<{ agent: string; name: string; kind?: AgentKind; model?: string; thinking?: string; mode?: string; canvas?: string }>;
			/**
			 * Deliver a finished item's report to the agent that asked for it.
			 *
			 * A notice, not a queued task: it lands in the sender's transcript without running a
			 * turn of their own, which is what keeps a reply from becoming a conversation.
			 */
			report(agentId: string, text: string): void;
			/** What is waiting for one agent, for `decks.agent.inbox`. */
			queue(agentId: string): QueuedWork[];
			/**
			 * This agent is acting on a board — a write or edit tool call, or a stage verb — so
			 * the canvas can draw its cursor and marks there (`agents/acts.ts`). Optional: a unit
			 * fixture has no canvas to draw on.
			 */
			act?(agentId: string, act: Act): void;
			/** This agent's turn started or ended, for the log a restart reads (`agents/working.ts`). Optional like `act`. */
			working?(agentId: string, working: boolean): void;
			/**
			 * The briefing a handed-over task is run with — the same one `delegate` uses.
			 *
			 * Called when the item *runs*, not when it was queued, so the receiver reads the
			 * board as it is by then. A brief composed at send time is a snapshot of a plan
			 * that may have moved twice while it sat in the queue.
			 */
			brief(task: string, boards: string[], person?: boolean): string;
			recordRevision(path: string): string | undefined;
			/** This agent said it wrote a board. Optional: a unit fixture has no byline to keep. */
			wrote?(path: string, who: string): void;
			boardPathOf(file: string): string | undefined;
		},
		options: {
			name?: string;
			color: string;
			parentId?: string;
			resumeRef?: string;
			kind: AgentKind;
			snapshots: AgentStateStore;
			store: AgentStore;
			/** The agent this one was forked from, so its stage can be inherited. */
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
			/**
			 * The workspace to open in — a delegating parent's, handed down.
			 *
			 * Separate from `restored.workspace` because they answer to different owners: that one is
			 * this chat's own record read back off disk, this one is the parent's live declaration
			 * being inherited by a child that has never had one.
			 */
			workspace?: string;
			/**
			 * The canvas a new agent opens on, asked the first time it needs one: the latest canvas of
			 * its workspace (`AgentRegistry.latestCanvas`). Nothing, or a canvas gone by then, makes one
			 * of its own, as before.
			 */
			firstCanvas?: (self: string) => string | undefined;
			/** The install's Claude subscriptions (`claude/accounts.ts`). */
			accounts?: ClaudeAccountSwitcher;
			accountsChanged?(): void;
			/** Ask the person to sign in to Claude for this agent (`claude/login.ts`). */
			accountNeeded?(agentId: string, why: "no-account" | "asked", accountId?: string): void;
			commandsChanged?(): void;
			bridge?: CanvasBridge;
			/** For an agent that works outside Decks (`kind` "outside"): the key it joins by and the app it runs in. */
			outside?: { key: string; client: string };
			/**
			 * Everything a chat needs to be a row again without its runtime running
			 * (`agents/store.ts`). Its presence is also what makes the agent dormant: it
			 * exists, it can be read, and it starts nothing until it is prompted.
			 */
			restored?: {
				id: string;
				context: string[];
				inPlay: string[];
				/**
				 * Where this conversation had put its boards, so the arrangement it was looking at comes
				 * back with it. Absent on a record written before a stage could have one, and the stage
				 * then falls to the auto-layout rather than to nothing.
				 */
				positions?: Record<string, { x: number; y: number }>;
				avatar?: string;
				createdAt: number;
				/**
				 * What the row shows before its transcript has been read.
				 *
				 * A restored chat is a row first and a conversation second: the list draws it from
				 * its record alone (`store.list`), so the last thing said and when have to come
				 * from there rather than from a `chat.json` nobody has opened.
				 */
				lastLine?: string;
				lastAt?: number;
				model?: AgentModel;
				mode?: AgentMode;
				/** What it last cost, so a dormant row can draw a ring — see `lastUsage`. */
				usage?: AgentUsage;
				/** Which subscription it was spending, so a restart does not move it. */
				account?: string;

				tags?: string[];
				userTags?: string[];
				/** An outside agent's own: its key, its app, when it last called and its waiting mail. */
				outside?: NonNullable<AgentRecord["outside"]>;
				workspace?: string;
				/** The folder its stage drawing is in (`canvas/pens.ts`). */
				stage?: string;
			};
		},
	) {
		this.id = options.restored?.id ?? randomUUID();
		this.seat = new Seat(
			{
				id: this.id,
				deck,
				stage,
				emit: (message) => this.emit(message),
				save: () => this.save(),
				...(host.arranged ? { arranged: () => host.arranged!() } : {}),
				agents: () => host.agents(),
				tell: (note) => void this.pending.push(note),
			},
			{ firstCanvas: options.firstCanvas, restored: options.restored },
		);
		this.turns = new Turns(
			{
				id: this.id,
				kind: options.kind,
				emit: (message) => this.emit(message),
				name: () => this.identity.name,
				state: () => this.conversation.state,
				prompt: (text, parts, at) => this.prompt(text, parts, at),
				run: (text) => this.run(text),
				notice: (level, text) => this.conversation.translator.notice(level, text),
				brief: (task, boards, person) => host.brief(task, boards, person),
				report: (agentId, text) => host.report(agentId, text),
				outside: () => (this.inbox.client === undefined ? undefined : { client: this.inbox.client }),
				mailChanged: () => this.inbox.changed(),
			},
			options.restored?.outside?.inbox,
		);
		const joined = options.restored?.outside ?? options.outside;
		this.inbox = new Inbox(
			{
				turns: this.turns,
				name: () => this.identity.name,
				canvasNotes: () => this.seat.canvasNotes(),
				said: (text, parts) => this.conversation.translator.user(text, parts),
				notice: (level, text) => this.conversation.translator.notice(level, text),
				sayRow: () => this.sayRow(),
				save: () => this.save(),
				writeNow: () => {
					if (this.saving) clearTimeout(this.saving);
					this.saving = undefined;
					this.flush();
				},
			},
			joined ? { key: joined.key, client: joined.client, seen: options.restored?.outside?.seen } : undefined,
		);
		this.store = options.store;
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
		/*
		 * And the workspace, from either direction.
		 *
		 * `restored` is a chat read back off disk; `options.workspace` is a child being handed its
		 * parent's — the same arrangement `account` has, and for the same reason: a subagent is the
		 * parent's work continuing and should not land in a different group from the agent that
		 * asked for it. Both are already cleaned, so neither is cleaned again here.
		 */
		const workspace = options.restored?.workspace ?? options.workspace;
		if (workspace) {
			this.workspaceChosen = workspace;
			this.identity = { ...this.identity, workspace };
		}
		// After construction, so nothing is announced for a chat the browsers have not been told of yet.
		if (options.restored) setTimeout(() => this.seat.adoptStage(), 0);
		this.parentId = options.parentId;
		this.kind = options.kind;
		this.snapshots = options.snapshots;
		this.conversation = new Conversation(
			{
				id: this.id,
				kind: options.kind,
				deck,
				store: options.store,
				port: host.port,
				emit: (message) => this.emit(message),
				save: () => this.save(),
				writeNow: () => this.flush(),
				record: () => this.record(),
				sayRow: () => this.sayRow(),
				stateChanged: (now, before) => {
					if ((before === "idle") !== (now === "idle")) host.working?.(this.id, now !== "idle");
					if (now === "idle") this.turns.wentIdle();
					else this.turns.wentBusy();
				},
				acted: (event) => host.act?.(this.id, { kind: "tool", event }),
				tool: () => this.stageTool(),
				hooks: () => this.stageHooks(),
				opened: (name) => {
					if (name) this.identity = { ...this.identity, name };
					// A resumed session had a canvas; without this it opens holding nothing, which reads as the cards having been lost.
					this.apply(this.snapshots.latest(this.id));
					this.emit({ type: "agent.identity", id: this.id, identity: this.identity });
				},
				restoreAt: (when) => this.apply(this.snapshots.at(this.id, when)),
				stopped: () => this.turns.stopped(),
				forgetNotes: () => {
					this.pending = [];
				},
				...(host.runtimesChanged ? { runtimesChanged: () => host.runtimesChanged!() } : {}),
			},
			{
				createdAt: this.createdAt,
				resumeRef: options.resumeRef,
				model: options.model,
				mode: options.mode,
				account: options.account,
				accounts: options.accounts,
				accountsChanged: options.accountsChanged,
				accountNeeded: options.accountNeeded ? (why: "no-account" | "asked", accountId?: string) => options.accountNeeded!(this.id, why, accountId) : undefined,
				commandsChanged: options.commandsChanged,
				bridge: options.bridge,
				restored: options.restored,
			},
		);

		/*
		 * A fork opens a conversation that already happened, so it should open with the
		 * canvas that conversation had rather than an empty context.
		 *
		 * Last, because applying it writes the chat's record, which reads the transcript: run
		 * before the translator existed, it threw inside the constructor and took the server
		 * down with it, so every fork from any runtime ended the deck instead of opening a chat.
		 */
		if (options.forkedFrom) {
			this.snapshots.seed(options.forkedFrom.agentId, this.id, options.forkedFrom.at);
			this.apply(this.snapshots.latest(this.id));
		}
	}

	/** Mutable only through `orphan`: a subagent outlives the parent it reported to. */
	parentId: string | undefined;
	readonly kind: AgentKind;
	private readonly snapshots: AgentStateStore;
	private readonly store: AgentStore;
	private readonly createdAt: number;
	private saving: ReturnType<typeof setTimeout> | undefined;

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

	/** Put a remembered stage back: what the agent held, showed and called itself. */
	private apply(snapshot: CanvasSnapshot | undefined): void {
		if (!snapshot) return;
		if (Array.isArray(snapshot.context)) this.seat.setContext(snapshot.context.filter((path) => typeof path === "string"));
		if (Array.isArray(snapshot.inPlay)) this.seat.setInPlay(snapshot.inPlay.filter((path) => typeof path === "string"));
		if (snapshot.positions && typeof snapshot.positions === "object") {
			const kept = cleanPlaces(snapshot.positions);
			if (kept) {
				for (const [path, at] of Object.entries(kept)) this.seat.setPosition(path, at.x, at.y);
				this.save();
				this.host.arranged?.();
			}
		}
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
		/*
		 * And the workspace, which rides the snapshot for the same reason the tags do: a rewind
		 * restores what the agent was, and where it was working is part of that. Guarded rather than
		 * `?? null` — absent means a snapshot taken before this existed, and clearing the workspace
		 * of an agent that has one would be a rewind *removing* a fact rather than restoring an old
		 * one.
		 */
		if (snapshot.identity?.workspace) this.setWorkspace(snapshot.identity.workspace);
	}

	/** What the canvas extension is allowed to reach on this agent (§6.2). */
	private stageHooks() {
		return {
			id: this.id,
			identity: () => this.identity,
			context: () => [...this.seat.context],
			inPlay: () => [...this.seat.inPlay],
			setInPlay: (paths: string[], at?: Record<string, { x: number; y: number }>) => this.seat.setInPlay(paths, { place: true, ...(at ? { at } : {}) }),
			positions: () => this.seat.remembered(),
			setPosition: (path: string, x: number, y: number) => this.seat.setPosition(path, x, y),
			rename: (name: string) => this.rename(name),
			setTags: (tags: unknown) => this.setTags(tags),
			setWorkspace: (workspace: unknown) => this.setWorkspace(workspace),
			setAvatar: (url: string) => this.setAvatar(url),
			agents: () => this.host.agents(),
			camera: () => this.host.camera(this.id),
			send: (target: string, spec: SendSpec) => this.host.send(this.id, target, spec),
			create: (spec: CreateSpec) => {
				if (!this.host.create) throw new Error("This deck cannot make agents.");
				return this.host.create(this.id, spec);
			},
			queue: (agentId?: string) => this.host.queue(agentId ?? this.id),
			news: () => this.inbox.takeNews(),
			recordRevision: (path: string) => this.host.recordRevision(path),
			worked: (path: string) => this.workedOn(path),
			acted: (what: ActKind, path: string) => this.host.act?.(this.id, { kind: "verb", what, path }),
			sized: (path: string, size: { w: number; h: number }) => {
				this.seat.setSize(path, size);
				this.host.arranged?.();
			},
			drew: (stage: string, ids: string[], boxes: ActBox[]) => this.host.act?.(this.id, { kind: "draw", stage, ids, boxes }),
			boardPathOf: (file: string) => this.host.boardPathOf(file),
			stageName: () => this.seat.stageName(true),

			openStage: (name: string) => this.seat.openStage(name),
			newStage: (title: string) => this.seat.newStage(title),
			setHome: (name: string) => this.seat.openStage(name),
			deliver: (target: string, spec: { task: string; boards?: string[] }) => {
				if (!this.host.deliver) throw new Error("This deck cannot deliver messages.");
				return this.host.deliver(this.id, target, spec);
			},
		};
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
	 *
	 * A **restored** chat is the other case, and it is written even before anything is said to
	 * it: the row is already on disk, so a rename, a tag or a board hung on it has somewhere to
	 * go. Its transcript has not been read though — that is the whole point of restoring — which
	 * is why `flush` writes the record on its own in that state rather than reading the
	 * conversation to write it back.
	 */
	private save(): void {
		if (!this.persisted()) return;
		// An outside agent's record is small and is all there is of it: written now (`Inbox.keep`).
		if (this.inbox.outsideKey !== undefined) {
			this.flush();
			return;
		}
		if (this.saving) return;
		this.saving = setTimeout(() => {
			this.saving = undefined;
			this.flush();
		}, 1000);
	}

	/**
	 * Whether there is a row to write.
	 *
	 * A restored chat has one already; a new one is not written down until the user has spoken
	 * to it. Reading this as "has user messages" was right while every restored chat carried
	 * its transcript in memory and wrong the moment they stopped: it silently dropped a rename
	 * or a tag on a chat nobody had opened, because the guard could not tell "nothing to say
	 * yet" from "not read yet".
	 */
	private persisted(): boolean {
		// An outside agent is its record: there is no runtime session to find it by again.
		return this.conversation.wasRestored || this.inbox.outsideKey !== undefined || this.conversation.spoken;
	}

	/** Write the record now. */
	private flush(): void {
		if (!this.persisted()) return;
		// The rows first: asking for them is also what refreshes the session's reference on the record (`Conversation.toWrite`).
		const rows = this.conversation.toWrite();
		const record = this.record();
		if (rows) this.store.write(record, rows);
		else this.store.writeRecord(record);
	}

	private record(): AgentRecord {
		const said = this.conversation.record();
		return {
			id: this.id,
			kind: this.kind,
			name: this.identity.name,
			...(this.identity.avatar ? { avatar: this.identity.avatar } : {}),
			color: this.identity.color,
			...(this.parentId ? { parentId: this.parentId } : {}),
			...this.seat.record(),
			...(this.workspaceChosen ? { workspace: this.workspaceChosen } : {}),
			createdAt: this.createdAt,
			...(this.identity.tags?.length ? { tags: this.identity.tags } : {}),
			...(this.identity.userTags?.length ? { userTags: this.identity.userTags } : {}),
			// The session, what it runs on, and the last thing actually said: its time, not this write's, is what the list is
			// ordered by, and a write on shutdown must not make an old chat look like the newest one.
			...said,
			lastAt: said.lastAt ?? this.createdAt,
			...(this.inbox.outsideKey !== undefined ? { outside: this.inbox.record()! } : {}),
		};
	}

	/**
	 * This agent's stage tool: the `stage` its code runs against, and what `/api/v1/<verb>` calls
	 * when a request names this agent (`calls/caller.ts`). Made once and kept, so a verb called
	 * over HTTP before the agent's first turn acts on the same stage its turns will.
	 */
	stageTool(): DecksTool {
		this.tool ??= createDecksTool({
			stage: this.stage,
			agent: this.stageHooks(),
			port: this.host.port,
			// Recorded after every run, so a rewind can put the canvas back to what it was
			// at that point and a fork can inherit it (§6.2).
			persist: (snapshot) => this.snapshots.record(this.id, snapshot),
		});
		return this.tool;
	}

	/**
	 * The stage tool for the person, acting on this agent's stage from the browser (`calls/person.ts`):
	 * the same verbs, and the same stage, with the person as the one who acted, so nothing they do
	 * draws this agent's cursor or counts as its work.
	 */
	personTool(): DecksTool {
		this.personal ??= createDecksTool({
			stage: this.stage,
			agent: {
				...this.stageHooks(),
				person: true,
				acted: undefined,
				worked: undefined,
				drew: undefined,
				// A hand-off the person makes is signed as theirs, not as this agent's.
				send: (target: string, spec: SendSpec) => this.host.send(PERSON, target, spec),
				deliver: (target: string, spec: { task: string; boards?: string[] }) => {
					if (!this.host.deliver) throw new Error("This deck cannot deliver messages.");
					return this.host.deliver(PERSON, target, spec);
				},
			},
			port: this.host.port,
		});
		return this.personal;
	}

	/**
	 * `parts`: the message as written (`MessagePart`), kept with it in the conversation; the agent gets
	 * `text`. `at`: what the person was looking at when they wrote it, as their page says
	 * (`looking-at.ts`); the agent is told in a line put before the words, with the other notes.
	 */
	async prompt(text: string, parts?: MessagePart[], at?: LookingAt): Promise<void> {
		// Before anything is appended: a restored chat's stored rows belong under the new message, not after it.
		this.conversation.window();
		// An outside agent has no runtime to prompt: the words wait in its inbox (`Inbox.leave`), with where they were written. A slash command means nothing to it.
		if (this.inbox.outsideKey !== undefined) {
			this.inbox.leave(text, parts, at ? lookingLineIn(at, this.deck, this.stage.pens, this.seat.stageName()) : undefined);
			return;
		}
		await this.conversation.say(text, parts, (slash) => this.notesFor(slash, at));
	}


	/**
	 * What the agent should know before it reads what to do, put first in its next message.
	 *
	 * Every line Decks adds to a message is added here, and nowhere else. A slash command gets none of
	 * them: every runtime reads one as an exact line, so anything put before it turns the command into
	 * a sentence for the model. What it would have carried waits for the next message.
	 *
	 * In order: anything the person did to a card since the last turn, which rides along with the
	 * message rather than arriving as its own interruption; what others changed on its canvases since
	 * its last message (every way in comes through here: a message typed, queued, sent into a running
	 * turn or handed over); who it has not said it is, until it has (`agents/identity-reminder.ts`);
	 * its canvas's name, while it has none of its own or has outgrown it (`canvas/canvas-name.ts`); and
	 * last, nearest the words, what the person was looking at when they wrote them (`looking-at.ts`).
	 */
	private notesFor(slash: boolean, at?: LookingAt): string[] {
		if (slash) return [];
		const notes = this.pending.splice(0);
		notes.push(...this.seat.canvasNotes());
		const unsaid = identityReminder(this.identity);
		if (unsaid) notes.push(unsaid);
		const unnamed = canvasNameReminder(this.stage.pens, this.seat.stageName());
		if (unnamed) notes.push(unnamed);
		if (at) notes.push(lookingLineIn(at, this.deck, this.stage.pens, this.seat.stageName()));
		return notes;
	}

	/**
	 * Run one task to completion and report — what a delegating parent awaits (§6.2).
	 *
	 * The boards it touched are found by comparing revisions either side of the run,
	 * rather than by watching what tools it called: an agent might write a board with
	 * `bash` and a heredoc, and the parent still wants to know the board changed.
	 */
	/**
	 * Run one turn of handed-over work, and say which boards it was about.
	 *
	 * **The boards are the ones the agent named, not the ones that moved.** This used to hash
	 * every board before the turn and list whatever differed after it, which credited the turn
	 * with anything anybody wrote meanwhile: another agent's board, the person's retype. Now the
	 * list is what the agent fitted, showed or reported through the stage tool during the turn
	 * (`workedOn`), in the order it first named them.
	 */
	async run(text: string): Promise<{ report: string; boards: string[] }> {
		this.worked = new Set();
		await this.prompt(text);
		const boards = [...this.worked].filter((path) => this.deck.board(path));
		return { report: this.conversation.translator.lastAssistantText(), boards };
	}

	/**
	 * The agent fitted, showed or reported this board: it is its writer, and the board is part of
	 * what this turn did. The stage tool calls this; nothing reads authorship off the disk.
	 */
	workedOn(path: string): void {
		if (!this.deck.board(path)) return;
		this.worked.add(path);
		this.host.wrote?.(path, this.id);
	}

	/** Boards named through the stage tool since the last `run` began. */
	private worked = new Set<string>();

	// --- the time machine (§6.7) -----------------------------------------------------

	/** The agent naming itself, from `decks.agent.update({ name })`. */
	rename(name: string): void {
		this.identity = { ...this.identity, name };
		this.conversation.setName(name);
		this.emit({ type: "agent.identity", id: this.id, identity: this.identity });
		this.save();
	}

	setAvatar(url: string | undefined): void {
		this.identity = { ...this.identity, avatar: url };
		this.emit({ type: "agent.identity", id: this.id, identity: this.identity });
		this.save();
	}

	/**
	 * The agent saying what it is doing, from `decks.agent.update({ tags })`. Replaces the list.
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
	 * 		 * Your tags on this agent, from the customise popup. A separate field, on purpose.
	 *
	 * `setTags` above replaces, so a shared list would mean the agent's next call silently
	 * deleted what you typed. The agent cannot read this field either — `decks.agent.list()`
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

	/** Record the workspace and say so: `setWorkspace` and `clearWorkspace` write through here. */
	private declareWorkspace(workspace: string | undefined): void {
		this.workspaceChosen = workspace;
		this.identity = { ...this.identity, workspace };
		this.emit({ type: "agent.identity", id: this.id, identity: this.identity });
	}

	/**
	 * The workspace this agent is in, from `decks.agent.update({ workspace })` or from the customise popup.
	 *
	 * Replaces — one value, not a list — and `null` or an empty string leaves it, which is the
	 * same absence as never having had one. Returns what was **stored**, which is not always what
	 * was passed: a workspace is slugged and cut at 24 characters, so a model that sends
	 * `"Political LLM (round 20)"` gets `political-llm` back and learns the word the others are
	 * actually in. That return value is the whole reason this is not a `void`: two agents that
	 * both declared "the same" project in different words would otherwise never meet.
	 *
	 * Both writers land here, you and the agent, and there is no second field to keep in step. See
	 * `protocol/Identity.workspace` for why a workspace is one value where tags are two.
	 */
	setWorkspace(raw: unknown): string | null {
		const workspace = cleanWorkspace(raw);
		/*
		 * Saying nothing leaves it alone rather than clearing it: "I am not going to say" is not
		 * the same as "take my work away".
		 */
		if (!workspace) return this.workspaceChosen ?? null;
		if (workspace === this.workspaceChosen) return workspace;
		this.declareWorkspace(workspace);
		this.save();
		return workspace;
	}

	/**
	 * Take the workspace away, because **you** said to — dropping the row under `No workspace`,
	 * or choosing it in the row's window.
	 *
	 * A separate verb from `setWorkspace`, and the difference is who is speaking. An agent that
	 * sends nothing is saying "I am not going to say", which must not empty a field somebody
	 * else filled in; a person who drags a row out of a project is saying "take it out". One
	 * function cannot mean both, and the one it used to mean was the agent's, so this half of
	 * the panel's own popup quietly did nothing.
	 */
	clearWorkspace(): void {
		if (this.workspaceChosen === undefined) return;
		this.declareWorkspace(undefined);
		this.save();
	}

	/** The workspace it works in, as a slug: what the agent list groups by. */
	get workspace(): string | undefined {
		return this.workspaceChosen;
	}

	get tags(): string[] {
		return this.identity.tags ?? [];
	}

	get color(): string {
		return this.identity.color;
	}

	/** What it answers to. Public because a list of agents outside this class draws it. */
	get name(): string {
		return this.identity.name;
	}

	/**
	 * One row in the chat list: everything a browser knows about this conversation.
	 *
	 * It carries what the greeting used to send after it, one message per fact per chat —
	 * the identity, the boards, the model, the account, the reading. Each of those is still
	 * broadcast on its own when it changes; this is the same facts, gathered, so that
	 * arriving is one change to the browser's state instead of seven per chat.
	 *
	 * What is **not** here is what belongs to the runtime rather than to this conversation:
	 * its modes, its dormant slash commands and its model catalogue all travel once, in
	 * `runtimes`. The one exception is a started session that has discovered commands of its
	 * own, which is the only way two chats on one runtime differ.
	 *
	 * Unread is the browser's business, not ours.
	 */
	/** The name and colour a cursor or a mark for this agent is drawn with (`agents/acts.ts`). */
	who(): { name: string; color: string } {
		return { name: this.identity.name, color: this.identity.color };
	}

	chat(): AgentChat {
		return {
			id: this.id,
			name: this.identity.name,
			...(this.identity.avatar ? { avatar: this.identity.avatar } : {}),
			...(this.parentId ? { parentId: this.parentId } : {}),
			...this.rowFacts(),
			unread: 0,
			kind: this.kind,
			identity: this.identity,
			boards: [...this.seat.context],
			inPlay: [...this.seat.inPlay],
			// Its state, the runtime's commands, and what it runs on, will spend and has spent.
			...this.conversation.chatFacts(),
		};
	}

	/**
	 * The fields of a row that only the row carries, as they are now.
	 *
	 * Written once and read twice: by `chat()` above, and by `sayRow()` below, which is how they
	 * reach a browser between one chat list and the next. Two copies of this would be two answers to
	 * "what did it last say", and the point of the message is that there is one.
	 */
	private rowFacts(): Pick<AgentChat, "lastLine" | "lastAt" | "mode" | "dormant" | "outside"> {
		const { dormant, ...said } = this.conversation.rowFacts();
		const outside = this.inbox.row();
		// An outside agent is never dormant: Decks has no runtime of its to start.
		return { ...said, ...(dormant && !outside ? { dormant } : {}), ...(outside ? { outside } : {}) };
	}

	/**
	 * Say that this row moved, without sending every other row with it.
	 *
	 * A prompt and the end of a turn used to publish the whole chat list — every chat on the
	 * deck, to report that one of them had spoken. This is the same news in about a hundred
	 * bytes. Everything else a turn moves already says so on its own: the state, the model,
	 * the cost, the boards.
	 */
	sayRow(): void {
		this.emit({ type: "agent.row", id: this.id, ...this.rowFacts() });
	}

	/**
	 * What a new browser needs that the row cannot carry.
	 *
	 * One thing: a question this agent asked before that browser existed. It is not a fact
	 * about the conversation but an open call waiting on an answer, and an agent whose
	 * question is never redrawn waits forever.
	 */
	greet(reply: (message: ServerMessage) => void): void {
		this.conversation.greet(reply);
		this.turns.greet(reply);
	}

	dispose(): void {
		// The canvas token stops working before the runtime has finished dying, so a tool
		// call from a process that outlives its agent is refused rather than answered.
		this.conversation.revoke();
		this.turns.dispose();
		// Before the backend goes: `flush` asks it for the session to resume, and a disposed
		// one cannot answer. A pending debounce is cancelled because this write supersedes it.
		if (this.saving) clearTimeout(this.saving);
		this.saving = undefined;
		this.flush();
		this.conversation.dispose();
	}
}
