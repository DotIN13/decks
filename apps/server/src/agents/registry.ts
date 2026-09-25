import { readFileSync } from "node:fs";
import type { AgentChat, AgentKind, AgentMode, AgentModel, AgentState, Camera, ModelOption, ServerMessage } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import { nowWords, processZone } from "../lib/clock.ts";
import type { StageBridge } from "../stage/bridge.ts";
import type { StageService } from "../stage/service.ts";
import type { Act } from "./acts.ts";
import { numberedName } from "./names.ts";
import { runtimeOf } from "../runtimes/registry.ts";
import type { CreateSpec, SendSpec } from "../stage/tool.ts";
import type { ClaudeAccountSwitcher } from "./backend.ts";
import { DeckAgent } from "./session.ts";
import { AgentStateStore } from "./agent-state.ts";
import { AgentStore, type AgentRecord } from "./store.ts";
import { readCanvasStage } from "./from-canvas.ts";

/**
 * Which agents exist, and which one the browser is looking at.
 *
 * One agent in M2; the shape is already plural because M5 adds a chat list and
 * subagents, and because "the focused agent" is a question the stage asks on every
 * frame — it should not have to know whether there is one or ten.
 */
const COLORS = ["#3b5cf6", "#2eaf5a", "#e7af36", "#623be2", "#d92e3c", "#0f9ba8"];
/**
 * How many children one parent may have running at once.
 *
 * Not a resource limit — it is a legibility limit. Six agents editing the same deck
 * at once produce a canvas nobody can follow and a bill nobody expected.
 */

export class Registry {
	private readonly agents: DeckAgent[] = [];
	private focusedId: string | undefined;
	/** Shared, so a fork can inherit the canvas of the agent it came from (§6.2). */
	private readonly snapshots = new AgentStateStore();
	/** The chat list on disk, so it survives a restart (§6.2). */
	private store: AgentStore;

	constructor(
		private deck: Deck,
		private readonly emit: (message: ServerMessage) => void,
		private readonly stage: StageService,
		private readonly host: {
			port: number;
			/** The runtime a new agent gets unless it asks for another one. */
			defaultKind: AgentKind;
			camera(agentId: string): Camera;
			/** Say that a board was placed, so the deck state goes out before the canvas changes. */
			arranged?(): void;
			/** Send the runtime list again: one of them reported a model catalogue. */
			publishRuntimes?(): void;
			recordRevision(path: string): string | undefined;
			/** An agent said it wrote this board — the byline the gallery shows. Optional so a bare test host can omit it. */
			wrote?(path: string, who: string): void;
			/** An agent is acting on a board: the canvas draws its cursor and marks (`agents/acts.ts`). Optional like `wrote`. */
			act?(agentId: string, act: Act): void;
			boardPathOf(file: string): string | undefined;
			/** The Claude subscriptions this install can use, for the backends that can. */
			accounts?: ClaudeAccountSwitcher;
			/** Tell the browser the list moved, after a login or an automatic switch. */
			accountsChanged?(): void;
			/** The canvas tool's HTTP end, for a runtime that is not in this process. */
			bridge?: StageBridge;
		},
	) {
		this.store = new AgentStore(deck);
	}

	/**
	 * What every agent may know about the others — including itself.
	 *
	 * `tags` is here so an agent can ask what the others are working on with one call rather
	 * than needing a second shape for the same fact. **`userTags` is deliberately absent:**
	 * what *you* think of an agent is not something it should be steering on, and a field an
	 * agent can read is a field it will optimise against. The same argument bars a model or a
	 * cost figure: an agent choosing who to hand work to should be choosing on what they are
	 * doing and what they can do, not on which of them is cheaper.
	 *
	 * `context` is the twenty newest boards, not everything held. That is a cap, not a
	 * truncation: `holding` carries the true total, so a reader can tell a slice from the
	 * whole before deciding whether to ask for more. And `kind` is the runtime, because it is
	 * now load-bearing — whether the row you are handing to is a Claude one or an antigravity
	 * one changes what it can do.
	 *
	 * `workspace` is here for the same reason `tags` is, one level up: an agent asking "who is
	 * on this project" gets an answer from the call it already makes to see who exists, rather
	 * than needing a second shape for the same fact. `undefined` for an agent in none, which is
	 * the absence the panel draws one section for.
	 */
	summaries(): Array<{ id: string; name: string; state: AgentState; kind: AgentKind; context: string[]; holding: number; tags: string[]; workspace: string | undefined; queued: number; stage: string | undefined }> {
		return this.agents.map((agent) => {
			const chat = agent.chat();
			// `queued` is here for the same reason `tags` is: so an agent deciding who to hand
			// something to can see, in one call, both what they are doing and how much is
			// already waiting for them.
			return {
				id: agent.id,
				name: chat.name,
				state: chat.state,
				kind: agent.kind,
				// `held` is most-recently-touched first, so the front of the list is the
				// answer to "what is it working on" and twenty is a screen of it — more than
				// any agent on a deck is genuinely working from at once.
				context: [...agent.context].slice(0, 20),
				holding: agent.context.length,
				tags: agent.tags,
				// The workspace, or `undefined` for an agent in none — see `agents/workspaces.ts` for
				// who is in which, and `roster` for the aggregation.
				workspace: agent.workspace,
				queued: agent.queued,
				// The stage it has open, so `stage.stages()` can say who is on each (`stage/pens.ts`).
				stage: agent.stageName(),
			};
		});
	}

	/**
	 * A new agent.
	 *
	 * `kind` is the runtime, fixed here for the agent's life. It defaults to the server's
	 * (`DECKS_BACKEND`), so the `+` button gives you whatever the deck is set up for
	 * without having to say so every time.
	 */
	create(
		options: {
			name?: string;
			parentId?: string;
			resumeRef?: string;
			kind?: AgentKind;
			color?: string;
			forkedFrom?: { agentId: string; at: number };
			/**
			 * The model to open on, for a chat that is continuing someone else's conversation.
			 *
			 * A fork's, in practice. Separate from `restored.model` because they answer to
			 * different owners: that one is this chat's own history read back off disk, this
			 * one is the parent's live choice being handed down. A fork of an Opus
			 * conversation that opened on the default model was answering the same
			 * conversation in a different voice.
			 */
			model?: AgentModel;
			mode?: AgentMode;
			/** The Claude subscription to open on — a delegating parent's, handed down. */
			account?: string;
			/**
			 * The workspace to open in — a delegating parent's, or a chat's own record.
			 *
			 * A child is created in its parent's workspace rather than in none, for the reason it
			 * inherits the parent's account: a subagent is the parent's work continuing, and a
			 * fan-out that lands in a different group from the agent that asked for it is a group
			 * nobody declared. A restored chat's own comes through `restored.workspace` instead.
			 */
			workspace?: string;
			/** Set only by `restore`: a chat from a previous run, with nothing running behind it. */
			restored?: {
				id: string;
				context: string[];
				inPlay: string[];
				/** Where this conversation had put its boards: a stage's own arrangement. */
				positions?: Record<string, { x: number; y: number }>;
				avatar?: string;
				createdAt: number;
				/**
				 * What the row shows before its transcript has been read.
				 *
				 * A restored chat is a row first and a conversation second: the list draws it from
				 * the record alone (`store.list`), so the last thing said and when have to come
				 * from there rather than from a `chat.json` nobody has opened.
				 */
				lastLine?: string;
				lastAt?: number;
				model?: AgentModel;
				mode?: AgentMode;
				account?: string;
				tags?: string[];
				userTags?: string[];
			};
		} = {},
	): DeckAgent {
		const agent = new DeckAgent(
			this.deck,
			this.emit,
			this.stage,
			{
				port: this.host.port,
				camera: (agentId: string) => this.host.camera(agentId),
				// A board that was given a place: the browsers need the arrangement, not just the list.
				arranged: () => this.host.arranged?.(),
				runtimesChanged: () => this.host.publishRuntimes?.(),
				agents: () => this.summaries(),
				send: (fromId, target, spec) => this.send(fromId, target, spec),
				create: (fromId, spec) => this.createFor(fromId, spec),
			report: (agentId, text) => this.get(agentId)?.translator.notice("info", text),
				queue: (agentId) => this.get(agentId)?.queue() ?? [],
				brief: (task, boards) => brief(task, boards, this.deck),
				recordRevision: (path) => this.host.recordRevision(path),
				wrote: (path, who) => this.host.wrote?.(path, who),
				act: (agentId, act) => this.host.act?.(agentId, act),
				boardPathOf: (file) => this.host.boardPathOf(file),
			},
			{
				...options,
				...(this.host.accounts ? { accounts: this.host.accounts } : {}),
				...(this.host.accountsChanged ? { accountsChanged: this.host.accountsChanged } : {}),
				...(this.host.bridge ? { bridge: this.host.bridge } : {}),
				// The whole chat row is what carries the menu, so a longer list is one
				// republish of the list the browser already keys on.
				commandsChanged: () => this.publish(),
				/*
				 * `Agent 1`, `Agent 2`, and nothing else on the deck has that number.
				 *
				 * Every unnamed chat used to be called `Agent`: six of them on this machine, and
				 * a name is how an agent is addressed — `@Agent` from the bar could mean any of
				 * them. The number is the whole of the fix, and it stops mattering the moment the
				 * agent gives itself a name (`stage.me({ name })`), which is the first thing most
				 * of them do.
				 */
				name: options.name ?? numberedName("Agent", (name) => this.nameTaken(name)),
				color: options.color ?? COLORS[this.agents.length % COLORS.length]!,
				kind: options.kind ?? this.host.defaultKind,
				snapshots: this.snapshots,
				store: this.store,
			},
		);
		this.agents.push(agent);
		this.focusedId ??= agent.id;
		/*
		 * A restored chat starts nothing.
		 *
		 * Fifteen rows would otherwise mean fifteen runtimes at boot — fifteen model runtimes
		 * for pi, fifteen CLI subprocesses for Claude — for conversations nobody has asked to
		 * continue. `prompt()` already opens with `await this.start()` and `start()` is
		 * memoised, so the first thing said to a dormant agent starts it.
		 */
		if (!options.restored) void agent.start();
		this.publish();
		return agent;
	}

	/**
	 * Put the deck's chat list back (§6.2).
	 *
	 * Called once when the deck opens. Returns how many rows were restored, so the caller can
	 * decide whether the deck still needs its first agent — a restored deck does not.
	 */
	restore(): number {
		// The deck's dispatcher is gone with the dashboard; its records stay on disk, unread.
		const records = this.store
			.list()
			.map(({ record }) => record)
			.filter((record) => !record.wasDispatcher)
			.map((record) => this.fromCanvas(record));
		for (const record of [...records].reverse()) {
			this.create({
				name: record.name,
				kind: record.kind,
				color: record.color,
				...(record.resumeRef ? { resumeRef: record.resumeRef } : {}),
				...(record.parentId ? { parentId: record.parentId } : {}),
				restored: {
					id: record.id,
					inPlay: record.inPlay,
					...(record.positions ? { positions: record.positions } : {}),
					// The transcript is not read here. It is read when somebody opens the chat
					// (`session.transcript`), which is the difference between a list that costs
					// a directory read and one that costs every conversation ever had.
					context: record.context,
					...(record.lastLine ? { lastLine: record.lastLine } : {}),
					...(record.lastAt ? { lastAt: record.lastAt } : {}),
					...(record.avatar ? { avatar: record.avatar } : {}),
					createdAt: record.createdAt,
					// The model and the mode the chat was last on. Forwarding them is the whole
					// point of storing them: a restored chat opens its runtime on the model the
					// conversation was using, not on whatever the runtime defaults to.
					...(record.model ? { model: record.model } : {}),
					...(record.mode ? { mode: record.mode } : {}),
					// And what it cost, which is a reading about the transcript rather than
					// about the runtime — so it is as true now as it was before the restart.
					...(record.usage ? { usage: record.usage } : {}),
					// And the subscription it was spending, for the same reason: a restart
					// should not move an agent onto a different account without saying so.
					...(record.account ? { account: record.account } : {}),
					...(record.tags ? { tags: record.tags } : {}),
					...(record.userTags ? { userTags: record.userTags } : {}),
					...(record.workspace ? { workspace: record.workspace } : {}),
					...(record.stage ? { stage: record.stage } : {}),
					...(record.isolated ? { isolated: true as const } : {}),
					...(record.isolatedStages ? { isolatedStages: record.isolatedStages } : {}),
				},
			});
		}
		/*
		 * Focus the newest, not the first one put back.
		 *
		 * `create` sets `focusedId ??=`, and the list is restored oldest-first so the colour
		 * fallback lands in the original order — which together would focus the *oldest* chat.
		 */
		this.focusedId = this.agents.at(-1)?.id;
		this.publish();
		return this.agents.length;
	}

	/**
	 * A record that named a shared canvas takes that canvas's boards as its own stage, once.
	 *
	 * Written straight back, so the next open reads the chat's own fields and the canvas file is
	 * never needed again. Every chat that was on one canvas gets its own copy of it: from here
	 * on each agent's stage is its own, and moving a board in one does not move it in another.
	 */
	private fromCanvas(record: AgentRecord): AgentRecord {
		if (!record.fromCanvas) return record;
		const { fromCanvas, ...rest } = record;
		const canvas = rest.inPlay.length === 0 && !rest.positions ? readCanvasStage(this.deck.path, fromCanvas) : undefined;
		if (!canvas) {
			this.store.writeRecord(rest);
			return rest;
		}
		const boards = canvas.boards.filter((path) => this.deck.board(path));
		const context = [...boards, ...rest.context.filter((path) => !boards.includes(path))];
		const places = Object.fromEntries(Object.entries(canvas.places).filter(([path]) => context.includes(path)));
		const next: AgentRecord = { ...rest, context, inPlay: boards, ...(Object.keys(places).length > 0 ? { positions: places } : {}) };
		this.store.writeRecord(next);
		return next;
	}

	get(id: string | undefined): DeckAgent | undefined {
		if (!id) return undefined;
		return this.agents.find((agent) => agent.id === id);
	}

	/**
	 * Whether another chat already answers to this name.
	 *
	 * Case-insensitive, because that is how the bar reads an `@name` (`app/send-from-bar.ts`)
	 * — `@sable` and `@Sable` are one address, so they are one name here.
	 */
	nameTaken(name: string, exceptId?: string): boolean {
		const wanted = name.trim().toLowerCase();
		if (!wanted) return false;
		return this.agents.some((agent) => agent.id !== exceptId && agent.chat().name.trim().toLowerCase() === wanted);
	}

	/** The agent the browser is looking at, created on demand so a deck is never agentless. */
	focused(): DeckAgent {
		const existing = this.get(this.focusedId);
		if (existing) return existing;
		return this.create();
	}

	/**
	 * The agent the browser is looking at, **without creating one**.
	 *
	 * `focused()` mints an agent on demand because a deck nobody has spoken to should still have a
	 * row to speak *in* — right when somebody is about to talk to it, wrong for a read that only
	 * wants to know where that conversation put its boards. A broadcast must not start a runtime as
	 * a side effect of being sent, and "no stage" is a real answer: the deck's own auto-layout.
	 *
	 * `undefined` after a dispose and before the first agent on a fresh deck.
	 */
	looking(): DeckAgent | undefined {
		return this.get(this.focusedId);
	}

	/**
	 * Take one browser's focus for the length of one of its frames.
	 *
	 * Silent, because nothing moved for anyone: each browser keeps its own conversation
	 * (`ws.ts`'s `View`), and this only makes "the focused agent" mean *that browser's* while
	 * its frame is handled. An id that is gone is ignored, and the last focus stands.
	 */
	look(id: string | undefined): void {
		if (this.get(id)) this.focusedId = id;
	}

	focus(id: string): void {
		if (!this.get(id)) return;
		this.focusedId = id;
		this.publish();
	}

	/**
	 * Take an agent off the list.
	 *
	 * Refused while it is working: stopping a turn is `agent.abort`, and quietly killing a
	 * session mid-reply loses whatever it was about to write to a board.
	 *
	 * Children are kept and promoted rather than removed with the parent. A subagent's row
	 * is the only place its transcript can be opened (the reason it is a row at all), so
	 * removing a parent must not take its children's work with it — they become top-level
	 * chats instead of rows pointing at a parent that is gone.
	 *
	 * The chat's own record goes with it (`agents/store.ts`), or it would be restored on the
	 * next boot. What is *not* touched is the runtime's session file: pi's and Claude's
	 * transcript directories are theirs, and closing a chat is not deleting a conversation.
	 */
	remove(id: string): { removed: boolean; reason?: string } {
		const index = this.agents.findIndex((agent) => agent.id === id);
		if (index === -1) return { removed: false, reason: "That agent is not here." };
		const agent = this.agents[index]!;
		if (agent.running) return { removed: false, reason: `${agent.chat().name} is still working. Stop it first.` };

		this.agents.splice(index, 1);
		agent.dispose();
		this.snapshots.forget(id);
		// After `dispose`, which flushes the record — deleting first would leave that write
		// to put it straight back, and the row would return on the next restart.
		this.store.forget(id);
		// And the symlink that said which subscription it spent. Nothing else of an agent
		// lives in the account store, so this is the whole of that cleanup.
		this.host.accounts?.releaseAgent?.(id);
		for (const child of this.agents) child.orphan(id);

		// The focus moves to whatever is nearest, or to a new agent on the next request —
		// `focused()` creates on demand, so a deck is never agentless.
		if (this.focusedId === id) {
			// `publish` below carries the whole of whatever the focus lands on: a row is the
			// conversation now, so there is nothing left to greet it with.
			this.focusedId = (this.agents[index] ?? this.agents[index - 1])?.id;
		}
		this.emit({ type: "agent.removed", id });
		this.publish();
		return { removed: true };
	}

	/**
	 * What a runtime last offered on this deck, for the runtime list the browser is sent.
	 *
	 * Kept beside the agent records rather than in any of them (`store.ts`), because it is a
	 * fact about the runtime: one catalogue for every chat on it.
	 */
	knownModels(kind: AgentKind): ModelOption[] {
		return this.store.knownModels(kind);
	}

	all(): readonly DeckAgent[] {
		return this.agents;
	}

	chats(): AgentChat[] {
		return this.agents.map((agent) => agent.chat());
	}

	/**
	 * Make an agent with no task, for a `send` to follow — `stage.create`.
	 *
	 * A peer rather than a child: it has no parent to report to and is not counted against
	 * `MAX_CHILDREN`, because the one making it is not going to wait for it. It opens on the
	 * creator's account, workspace and model unless told otherwise; a model the runtime cannot
	 * open is a notice in the creator's transcript, not an error.
	 */
	async createFor(fromId: string, spec: CreateSpec): Promise<{ agent: string; name: string }> {
		const from = this.get(fromId);
		if (!from) throw new Error("The creating agent is gone");
		const workspace = spec.workspace ?? from.workspace;
		// The creator's runtime unless another is named, so an inherited model is one it can open.
		const kind = spec.kind ?? from.kind;
		const inherited = !spec.model && kind === from.kind ? from.currentModel() : undefined;
		const made = this.create({
			name: spec.name,
			kind,
			...(inherited ? { model: inherited } : {}),
			...(from.accountId() ? { account: from.accountId() as string } : {}),
			...(workspace ? { workspace } : {}),
		});
		if (spec.tags?.length) made.setTags(spec.tags);
		if (spec.model?.includes("/")) {
			const [provider, ...rest] = spec.model.split("/");
			try {
				await made.setModel(provider!, rest.join("/"), spec.thinking);
			} catch (error) {
				from.translator.notice("warn", `${made.chat().name} stays on the default model: ${(error as Error).message}`);
			}
		} else if (spec.thinking) {
			await made.setThinking(spec.thinking);
		}
		if (spec.mode) {
			if (runtimeOf(made.chat().kind).capabilities.modes.includes(spec.mode)) {
				await made.start();
				await made.setMode(spec.mode);
			} else {
				from.translator.notice("warn", `${made.chat().name} stays in its default mode: ${made.chat().kind} cannot do "${spec.mode}".`);
			}
		}
		this.publish();
		return { agent: made.id, name: made.chat().name };
	}

	/**
	 * Put work in an existing agent's queue and return — the handover that does not block.
	 *
	 * The only handover there is. Waiting for an agent was `spawn`, and it could not work: a
	 * stage run is abandoned after twenty seconds and a turn is minutes, so the report never
	 * came back. This hands the work over and returns; `reply` is how the answer arrives.
	 *
	 * The target may be given as an id or as a name, because a model reading
	 * `stage.agents()` has both in front of it and will reach for whichever reads better. A
	 * name that two agents share is refused rather than guessed at: sending work to the wrong
	 * conversation is not a mistake you can see happening.
	 */
	send(fromId: string, target: string, spec: SendSpec): { queued: true; position: number } {
		const from = this.get(fromId);
		if (!from) throw new Error("The sending agent is gone");

		const to = this.resolve(target);
		// Only boards that exist, and no context change on the receiver: what it is holding is
		// its own decision, and a sender that could rewrite it would be a sender that can take
		// somebody's canvas away. The source rides in the briefing instead.
		const handed = (spec.boards ?? []).filter((path) => this.deck.board(path));
		const position = to.enqueue({
			from: from.id,
			fromName: from.chat().name,
			task: spec.task.trim(),
			boards: handed,
			at: Date.now(),
			...(spec.reply ? { reply: true } : {}),
		});
		this.publish();
		return { queued: true, position };
	}

	/** One agent, by id or by a name that only one agent answers to. */
	private resolve(target: string): DeckAgent {
		const byId = this.get(target);
		const named = this.agents.filter((agent) => agent.chat().name.toLowerCase() === target.toLowerCase());
		if (!byId && named.length > 1) throw new Error(`More than one agent is called ${target}; use the id from stage.agents().`);
		const to = byId ?? named[0];
		if (!to) throw new Error(`No agent ${target}. Use an id or a name from stage.agents().`);
		return to;
	}

	/** Every agent holding this board hears what the user did to it. */
	userEdited(path: string, summary: string): void {
		for (const agent of this.agents) agent.userEdited(path, summary);
	}

	/** An agent that is gone keeps nothing. */
	forget(id: string): void {
		this.snapshots.forget(id);
	}

	/** A board was deleted: no agent should still be holding it. */
	boardRemoved(path: string): void {
		let touched = false;
		for (const agent of this.agents) touched = agent.forget(path) || touched;
		if (touched) this.publish();
	}

	publish(): void {
		this.emit({
			type: "agents",
			chats: this.chats(),
			defaultKind: this.host.defaultKind,
			...(this.focusedId ? { focused: this.focusedId } : {}),
		});
	}

	greet(reply: (message: ServerMessage) => void): void {
		reply({
			type: "agents",
			chats: this.chats(),
			defaultKind: this.host.defaultKind,
			...(this.focusedId ? { focused: this.focusedId } : {}),
		});
		for (const agent of this.agents) agent.greet(reply);
		/*
		 * And nothing is started. This used to wake the focused agent here, because the model
		 * catalogue came from a running backend and a restored deck has none — so every
		 * dormant chat's picker was empty until something started. Which meant **opening the
		 * page started a runtime**: a `claude` process, a session, and a first request, to
		 * fill a dropdown nobody had opened.
		 *
		 * The list is remembered per runtime now (`AgentStore.rememberModels`) and greeted
		 * from the store, along with the account each chat spends and the reading it left. So
		 * a restored deck can draw all three controls with nothing running, which is what
		 * dormant was always supposed to mean: readable, and started by something the person
		 * actually did.
		 */
	}

	/** A different deck is a different set of agents: a session's cwd cannot move. */
	async reset(deck: Deck): Promise<void> {
		for (const agent of this.agents) agent.dispose();
		this.agents.length = 0;
		this.focusedId = undefined;
		this.deck = deck;
		this.store.setDeck(deck);
	}

	dispose(): void {
		for (const agent of this.agents) agent.dispose();
		this.agents.length = 0;
	}
}

/**
 * What the child is told, and why it is the whole board and not a summary.
 *
 * A briefing paraphrased by the parent is a second version of the plan, and the two
 * drift within a turn. The board source is the plan of record — the child reads the
 * same bytes the user is looking at, and reports by changing them.
 */
function brief(task: string, boards: string[], deck: Deck): string {
	// When the work runs, not when it was queued: "since yesterday" is read against this.
	const parts = [task.trim(), "", `It is now ${nowWords(Date.now(), processZone())}.`];

	if (boards.length > 0) {
		parts.push(
			"",
			`You have been handed ${boards.length === 1 ? "a board" : `${boards.length} boards`}. These are the plan of record: they are what the user is looking at, and reporting means updating them rather than only describing what you did.`,
		);
		for (const path of boards) {
			try {
				parts.push("", `## ${path}`, "", "```html", readFileSync(deck.fileOf(path), "utf8").trimEnd(), "```");
			} catch (error) {
				parts.push("", `## ${path}`, "", `_could not be read: ${(error as Error).message}_`);
			}
		}
	}

	parts.push(
		"",
		"Boards you changed are listed with this work only if you named them: `stage.fit`, a `stage.show` of one board, or `stage.report(paths)`.",
		"When you are done, reply with a short report: what you changed, and anything the parent agent needs to decide.",
	);
	return parts.join("\n");
}

