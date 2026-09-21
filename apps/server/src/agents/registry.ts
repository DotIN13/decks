import { readFileSync } from "node:fs";
import type { AgentChat, AgentKind, AgentMode, AgentModel, AgentState, Camera, Canvas, Schedule, ScheduleSpec, ServerMessage, TaskResult, TaskSpec } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import { dispatcherBrief } from "../tasks/brief.ts";
import { nowWords, processZone } from "../clock.ts";
import type { StageBridge } from "../stage/bridge.ts";
import type { StageService } from "../stage/service.ts";
import type { CanvasStore } from "../canvas/store.ts";
import { planCanvases } from "../canvas/migrate.ts";
import type { CreateSpec, SendSpec } from "../stage/tool.ts";
import type { TaskFinish } from "../tasks/service.ts";
import type { ClaudeAccountSwitcher } from "./backend.ts";
import { DeckAgent } from "./session.ts";
import { AgentStateStore } from "./agent-state.ts";
import { AgentStore, type AgentRecord } from "./store.ts";

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

	/** A task the dispatcher is deciding, and the canvas it was asked for on. Read once, at the send. */
	private readonly taskCanvases = new Map<string, string>();

	constructor(
		private deck: Deck,
		private readonly emit: (message: ServerMessage) => void,
		private readonly stage: StageService,
		private readonly host: {
			port: number;
			/** The runtime a new agent gets unless it asks for another one. */
			defaultKind: AgentKind;
			/** The runtime chosen for the dashboard's dispatcher, if one has been (`settings.ts`). */
			dispatcherKind?: () => AgentKind | undefined;
			camera(agentId: string): Camera;
			/** Say that a board was placed, so the deck state goes out before the canvas changes. */
			arranged?(): void;
			/** The deck's canvases: what holds the boards (`canvas/store.ts`). */
			canvases: CanvasStore;
			/** Every canvas as the browser sees it, with who is on each. */
			canvasList?(): Canvas[];
			/** Send the canvas list to every browser. */
			publishCanvases?(): void;
			recordRevision(path: string): string | undefined;
			/** An agent said it wrote this board — the byline the gallery shows. Optional so a bare test host can omit it. */
			wrote?(path: string, who: string): void;
			boardPathOf(file: string): string | undefined;
			/** The Claude subscriptions this install can use, for the backends that can. */
			accounts?: ClaudeAccountSwitcher;
			/** Tell the browser the list moved, after a login or an automatic switch. */
			accountsChanged?(): void;
			/** The canvas tool's HTTP end, for a runtime that is not in this process. */
			bridge?: StageBridge;
			/**
			 * The dashboard, when the deck has one — the seam an agent and a removal reach it through.
			 *
			 * Separate from `TaskService` itself so the registry can stay a registry: it hands
			 * the stage its `task` verb, reports a queue item's life back, and tells the
			 * service when an assigned agent goes away. Absent means no dashboard, and every
			 * hook is a no-op.
			 */
			tasks?: {
				create(spec: TaskSpec, fromId?: string): TaskResult;
				started(taskId: string): void;
				finished(finish: TaskFinish): void;
				agentRemoved(id: string): void;
				/** The dispatcher handed a task to an agent: the registry saw its `send`. */
				assigned(placement: { taskId: string; agentId: string; agentName: string; why: string }): void;
				/** The dispatcher's turn over a task ended, with or without a `send`. */
				decided(outcome: { taskId: string; sent: boolean; report: string }): void;
				/** Make a schedule — `stage.schedule`. */
				schedule(spec: ScheduleSpec): Schedule | { error: string };
				/** A deciding dispatcher made a schedule for its task instead of sending it: the task is done. */
				scheduled(outcome: { taskId: string; schedule: Schedule }): void;
			};
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
	summaries(): Array<{ id: string; name: string; state: AgentState; kind: AgentKind; context: string[]; holding: number; tags: string[]; workspace: string | undefined; queued: number }> {
		// Not the dispatcher: it is the dashboard's, and an agent deciding who to hand work
		// to must not hand it to the thing that hands work out.
		return this.agents.filter((agent) => agent.role !== "dispatcher").map((agent) => {
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
			/** The deck's dispatcher. Made by `ensureDispatcher`, never by a person. */
			role?: "dispatcher";
			/**
			 * The canvas to work on, by id: a delegating parent's, or the one a task arrived with.
			 *
			 * A child works where its parent was working, for the reason it inherits the account —
			 * a fan-out that puts its boards on a canvas nobody is looking at is work you have to
			 * go and find.
			 */
			canvas?: string;
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
				/**
				 * The canvas this conversation was working on, by id.
				 *
				 * Where its boards sit and which are up live on the canvas now, so this one field
				 * replaces the list and the map a chat used to carry — and it is what makes a
				 * dragged board stay where it was put, for everyone on that canvas.
				 */
				canvas?: string;
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
				// A board that was given a place: the browsers need the arrangement, not just the canvas.
				arranged: () => this.host.arranged?.(),
				/*
				 * One agent changed a shared canvas. Everyone else on it is looking at the same
				 * boards, so each of their browsers is told, and the arrangement goes out once.
				 */
				canvasChanged: (canvasId: string, except: string) => this.canvasChanged(canvasId, except),
				canvasList: () => this.host.canvasList?.() ?? [],
				canvasesChanged: () => this.host.publishCanvases?.(),
				agents: () => this.summaries(),
				send: (fromId, target, spec) => this.send(fromId, target, spec),
				create: (fromId, spec) => this.createFor(fromId, spec),
			report: (agentId, text) => this.get(agentId)?.translator.notice("info", text),
				queue: (agentId) => this.get(agentId)?.queue() ?? [],
				/**
				 * A dashboard task popped and its turn ended: reported to the deck's own
				 * service, which records the state. Never awaited — the session has a turn
				 * to finish and the dashboard only records.
				 */
				taskStarted: (taskId) => this.host.tasks?.started(taskId),
				taskFinished: (finish) => this.host.tasks?.finished(finish),
				decided: (outcome) => {
					this.host.tasks?.decided(outcome);
					// A task's dispatcher has done its one job: the runtime goes, the log stays.
					if (agent.role === "dispatcher" && agent.parentId) void agent.sleep().then(() => this.publish());
				},
				task: (spec: TaskSpec): TaskResult => {
					if (!this.host.tasks) throw new Error("This deck has no dashboard.");
					// Work an agent asks for is for the canvas it is on, unless it said otherwise.
					const canvas = spec.canvas ?? agent.canvas;
					return this.host.tasks.create({ ...spec, ...(canvas ? { canvas } : {}) }, agent.id);
				},
				/*
				 * A schedule from a deciding dispatcher is that task's answer: the person asked
				 * for something recurring, and what they get is the schedule rather than one
				 * turn of it. So the task is done, with the schedule as its result, and the
				 * dispatcher's turn does not count as "sent nothing".
				 */
				schedule: (spec: ScheduleSpec) => {
					if (!this.host.tasks) throw new Error("This deck has no dashboard.");
					const made = this.host.tasks.schedule(spec);
					if (!("error" in made) && agent.role === "dispatcher" && agent.deciding && !agent.decidedSend) {
						agent.decidedSend = true;
						this.host.tasks.scheduled({ taskId: agent.deciding, schedule: made });
					}
					return made;
				},
				brief: (task, boards) => brief(task, boards, this.deck),
				recordRevision: (path) => this.host.recordRevision(path),
				wrote: (path, who) => this.host.wrote?.(path, who),
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
				color: options.color ?? COLORS[this.agents.length % COLORS.length]!,
				kind: options.kind ?? this.host.defaultKind,
				snapshots: this.snapshots,
				store: this.store,
				canvases: this.host.canvases,
				...(options.canvas ? { canvas: options.canvas } : {}),
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
		const records = this.store.list().map(({ record }) => record);
		const canvases = this.migrate(records);
		for (const record of [...records].reverse()) {
			const canvas = record.canvas ?? canvases.get(record.id);
			this.create({
				name: record.name,
				kind: record.kind,
				color: record.color,
				...(record.resumeRef ? { resumeRef: record.resumeRef } : {}),
				...(record.parentId ? { parentId: record.parentId } : {}),
				...(record.role ? { role: record.role } : {}),
				restored: {
					id: record.id,
					...(canvas ? { canvas } : {}),
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
	 * One-way, once: the chats that exist become the canvases they were describing.
	 *
	 * A record written before canvases carries what it had up, where it sat, and the word its
	 * agent typed about itself. `canvas/migrate.ts` decides what canvases those make; this
	 * writes them and answers with the chat id to canvas id map `restore` then hands each agent.
	 * A record that already names a canvas is left alone, so this is a no-op on the second open.
	 */
	private migrate(records: readonly AgentRecord[]): Map<string, string> {
		const assigned = new Map<string, string>();
		// Not the dispatchers: they hand work out and never put a board up, so they are on no canvas.
		const stale = records.filter((record) => record.role !== "dispatcher" && !record.canvas && (record.legacyWorkspace || record.legacyInPlay?.length));
		if (stale.length === 0) return assigned;
		const plans = planCanvases(
			stale.map((record) => ({
				id: record.id,
				name: record.name,
				...(record.legacyWorkspace ? { workspace: record.legacyWorkspace } : {}),
				inPlay: record.legacyInPlay ?? [],
				...(record.legacyPositions ? { positions: record.legacyPositions } : {}),
				lastAt: record.lastAt,
			})),
		);
		for (const plan of plans) {
			/*
			 * A workspace word several chats said is one canvas, and a canvas of that name already
			 * made is it. A chat's own name is not: two chats called "Agent" get two canvases.
			 */
			const existing = plan.shared ? this.host.canvases.byName(plan.name) : undefined;
			const canvas = existing ?? this.host.canvases.create({ name: plan.shared ? plan.name : this.host.canvases.freeName(plan.name), boards: plan.boards, places: plan.places });
			for (const member of plan.members) assigned.set(member, canvas.id);
		}
		/*
		 * Written now, not at the chat's next save. A restored chat is dormant and may never be
		 * saved again, and a record still without a canvas would be migrated again on the next
		 * open — making "Agent 7" out of a chat that already has "Agent". The three old fields go
		 * in the same write, which is what makes this happen once.
		 */
		for (const record of stale) {
			const canvas = assigned.get(record.id);
			const { legacyInPlay: _inPlay, legacyPositions: _positions, legacyWorkspace: _workspace, ...rest } = record;
			this.store.writeRecord({ ...rest, ...(canvas ? { canvas } : {}) });
		}
		return assigned;
	}

	/**
	 * A shared canvas changed: every agent on it is told, and the arrangement goes out once.
	 *
	 * `except` is whoever made the change, which has already said so itself. A person changing
	 * a canvas from the browser has no agent to except, and every agent there hears.
	 */
	canvasChanged(canvasId: string, except = ""): void {
		for (const other of this.agents) {
			if (other.id === except || other.canvas !== canvasId) continue;
			other.canvasMoved();
		}
		this.host.arranged?.();
	}

	get(id: string | undefined): DeckAgent | undefined {
		if (!id) return undefined;
		return this.agents.find((agent) => agent.id === id);
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
		// And the work it was assigned: a dashboard task it was carrying comes back out of
		// its queue and is re-decided, so nothing points at a ghost (tasks/service.ts).
		this.host.tasks?.agentRemoved(id);
		for (const child of this.agents) child.orphan(id);

		// The focus moves to whatever is nearest, or to a new agent on the next request —
		// `focused()` creates on demand, so a deck is never agentless.
		if (this.focusedId === id) {
			const next = this.agents[index] ?? this.agents[index - 1];
			this.focusedId = next?.id;
			if (next) next.greet((message) => this.emit(message));
		}
		this.emit({ type: "agent.removed", id });
		this.publish();
		return { removed: true };
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
	 * creator's account, workspace and model unless told otherwise. For a task's dispatcher
	 * the model is the dashboard's composer, which is where a person says what new work
	 * should run on; a model named here is the dispatcher's own decision, and a model the
	 * runtime cannot open is a notice in the creator's transcript, not an error.
	 */
	async createFor(fromId: string, spec: CreateSpec): Promise<{ agent: string; name: string }> {
		const from = this.get(fromId);
		if (!from) throw new Error("The creating agent is gone");
		const workspace = spec.workspace ?? from.workspace;
		/*
		 * The creator's runtime unless another is named. It used to be the server's default,
		 * which was the same thing while every dispatcher was the default runtime, and is not
		 * now: a Claude dispatcher handing its Claude model to a new Pi agent is a model that
		 * agent cannot open. The dashboard's bar chooses the runtime new work runs on, as it
		 * chooses the model.
		 */
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
			if (made.chat().capabilities.modes.includes(spec.mode)) {
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
		if (to.role === "dispatcher") throw new Error("The dispatcher hands work out; it does not take any. Send to an agent from stage.agents().");
		/*
		 * The dispatcher placing a task: its `send` during the deciding turn *is* the
		 * dashboard's answer, so the item carries the task's id (which is what turns the
		 * task running and done as the receiver's queue drains) and the dashboard hears who
		 * took it. A second send in the same turn is refused rather than split.
		 */
		const placing = from.role === "dispatcher" ? from.deciding : undefined;
		if (from.role === "dispatcher" && placing && from.decidedSend) throw new Error("This task was already handed to an agent; one send per task.");
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
			...(placing ? { taskId: placing } : {}),
			...(spec.reply ? { reply: true } : {}),
		});
		if (placing) {
			from.decidedSend = true;
			/*
			 * A task asked for on a canvas is done on that canvas: the agent it went to moves
			 * there, so the boards it makes land in front of the person who asked, and the card
			 * for that canvas says it is working there.
			 */
			const canvas = this.host.canvases.get(this.taskCanvases.get(placing));
			if (canvas) to.useCanvas(canvas.name);
			this.taskCanvases.delete(placing);
			this.host.tasks?.assigned({ taskId: placing, agentId: to.id, agentName: to.chat().name, why: firstLineOf(spec.task) });
		}
		this.publish();
		return { queued: true, position };
	}

	/**
	 * The deck's dispatcher: one agent, made here and never by a person, on the default
	 * runtime. It answers the dashboard's bar, and its transcript is the dashboard's log.
	 * Hidden from the lists (`AgentChat.role`), and never the focused stage: a person who
	 * lands on it would find an agent that refuses to do anything but hand work out.
	 */
	ensureDispatcher(): DeckAgent {
		/*
		 * One template per runtime that has been chosen, because a runtime is fixed when an
		 * agent is made: choosing Claude in the dashboard's bar cannot change the Pi dispatcher,
		 * it can only put a Claude one in its place. The others stay, hidden like every
		 * dispatcher, holding the model and mode they were left on for when they are chosen again.
		 */
		const kind = this.host.dispatcherKind?.() ?? this.host.defaultKind;
		const have = this.agents.find((agent) => agent.role === "dispatcher" && !agent.parentId && agent.kind === kind);
		if (have) {
			this.unfocusDispatcher();
			return have;
		}
		const made = this.create({ name: "Dispatcher", role: "dispatcher", kind });
		this.unfocusDispatcher();
		return made;
	}

	private unfocusDispatcher(): void {
		const focused = this.get(this.focusedId);
		if (focused?.role !== "dispatcher") return;
		this.focusedId = this.agents.find((agent) => agent.role !== "dispatcher")?.id;
		this.publish();
	}

	/**
	 * Ask a dispatcher to place a task: a **new one for this task**, spawned from the
	 * template with the model, thinking, mode and account the composer set there, so its
	 * transcript is this task's own log and two tasks never share a context. It is not
	 * handed the roster: the brief tells it to read `stage.agents()` itself. The briefing
	 * goes into its queue as a `decide` item and runs the moment it is up; when the turn
	 * ends the runtime is stopped and the conversation kept (`DeckAgent.sleep`).
	 */
	decide(task: { id: string; text: string; boards: string[]; workspace?: string; canvas?: string; promptPath?: string; schedule?: string }): { dispatcherId: string } {
		const template = this.ensureDispatcher();
		const canvasName = this.host.canvases.get(task.canvas)?.name;
		if (task.canvas && canvasName) this.taskCanvases.set(task.id, task.canvas);
		const model = template.currentModel();
		const mode = template.chat().mode;
		const account = template.accountId();
		const dispatcher = this.create({
			name: "Dispatcher",
			role: "dispatcher",
			parentId: template.id,
			kind: template.kind,
			...(model ? { model } : {}),
			...(mode ? { mode } : {}),
			...(account ? { account } : {}),
		});
		this.unfocusDispatcher();
		dispatcher.enqueue({
			from: "deck",
			fromName: "The dashboard",
			task: dispatcherBrief({ ...task, ...(canvasName ? { canvasName } : {}), now: nowWords(Date.now(), processZone()) }),
			boards: [],
			at: Date.now(),
			decide: task.id,
		});
		this.publish();
		return { dispatcherId: dispatcher.id };
	}

	/**
	 * Put work in an existing agent's queue with **no sending agent** — the dashboard's
	 * half of `send`. The same resolution by id or name, the same queue, the same cap;
	 * the sender it names is the dashboard, so a queue notice reads "The dashboard
	 * queued work for you" and a drain keeps it that way.
	 */
	deliver(target: string, spec: SendSpec & { taskId: string; fromName: string; canvas?: string }): { queued: true; position: number } {
		const to = this.resolve(target);
		// The work is for a canvas: the agent moves there first, so what it shows lands in front of the person who asked.
		const canvas = this.host.canvases.get(spec.canvas);
		if (canvas) to.useCanvas(canvas.name);
		const handed = (spec.boards ?? []).filter((path) => this.deck.board(path));
		const position = to.enqueue({
			from: "deck",
			fromName: spec.fromName,
			task: spec.task.trim(),
			boards: handed,
			at: Date.now(),
			taskId: spec.taskId,
			...(spec.reply ? { reply: true } : {}),
		});
		this.publish();
		return { queued: true, position };
	}

	/** Take a dashboard task back out of an agent's queue — a cancelled task must not run. */
	removeQueued(agentId: string, taskId: string): boolean {
		return this.get(agentId)?.cancelWork(taskId) ?? false;
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

/** The first line of a piece of work, for the dashboard's "why" beside a placed task. */
function firstLineOf(text: string): string {
	return text.trim().split("\n")[0]?.trim().slice(0, 160) ?? "";
}
