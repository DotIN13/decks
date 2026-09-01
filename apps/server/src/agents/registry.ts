import { readFileSync } from "node:fs";
import type { AgentChat, AgentKind, Camera, ChatItem, ServerMessage } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import type { StageService } from "../stage/service.ts";
import type { DelegateReport, DelegateSpec } from "../stage/tool.ts";
import { DeckAgent } from "./session.ts";
import { SnapshotStore } from "./snapshot.ts";
import { AgentStore } from "./store.ts";

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
const MAX_CHILDREN = 4;
/**
 * How many past chats a deck keeps.
 *
 * A legibility limit again, not a storage one — the records are small. Every restart used to
 * leave a conversation behind on disk, so a deck worked in daily would list dozens of rows
 * nobody will open. The newest fifteen are the ones with any chance of being wanted; the
 * rest are pruned when the deck opens.
 */
const KEEP_CHATS = 15;

export class Registry {
	private readonly agents: DeckAgent[] = [];
	private focusedId: string | undefined;
	/** Shared, so a fork can inherit the canvas of the agent it came from (§6.2). */
	private readonly snapshots = new SnapshotStore();
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
			camera(): Camera;
			recordRevision(path: string): string | undefined;
			boardPathOf(file: string): string | undefined;
		},
	) {
		this.store = new AgentStore(deck);
	}

	/** What every agent may know about the others — including itself. */
	summaries(): Array<{ id: string; name: string; state: string; context: string[] }> {
		return this.agents.map((agent) => {
			const chat = agent.chat();
			return { id: agent.id, name: chat.name, state: chat.state, context: [...agent.context] };
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
			/** Set only by `restore`: a chat from a previous run, with nothing running behind it. */
			restored?: { id: string; items: ChatItem[]; context: string[]; inPlay: string[]; avatar?: string; createdAt: number };
		} = {},
	): DeckAgent {
		const agent = new DeckAgent(
			this.deck,
			this.emit,
			this.stage,
			{
				port: this.host.port,
				camera: () => this.host.camera(),
				agents: () => this.summaries(),
				spawn: (parentId, spec) => this.spawn(parentId, spec),
				recordRevision: (path) => this.host.recordRevision(path),
				boardPathOf: (file) => this.host.boardPathOf(file),
			},
			{
				...options,
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
		for (const { record, items } of this.store.prune(KEEP_CHATS).reverse()) {
			this.create({
				name: record.name,
				kind: record.kind,
				color: record.color,
				...(record.resumeRef ? { resumeRef: record.resumeRef } : {}),
				...(record.parentId ? { parentId: record.parentId } : {}),
				restored: {
					id: record.id,
					items,
					context: record.context,
					inPlay: record.inPlay,
					...(record.avatar ? { avatar: record.avatar } : {}),
					createdAt: record.createdAt,
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
	 * Hand work to a new agent and wait for its report (§6.2).
	 *
	 * In-process rather than a subprocess, unlike Pi's own subagent example: the child
	 * shares this deck's stage, so its boards land on the same canvas and its
	 * transcript is a row in the same chat list. What it does not share is context —
	 * it is a fresh session with its own file.
	 */
	async spawn(parentId: string, spec: DelegateSpec): Promise<DelegateReport> {
		const parent = this.get(parentId);
		if (!parent) throw new Error("The delegating agent is gone");

		const running = this.agents.filter((agent) => agent.parentId === parentId && agent.running).length;
		if (running >= MAX_CHILDREN) {
			throw new Error(`You already have ${running} subagents running; wait for one to finish.`);
		}

		const child = this.create({ parentId, ...(spec.name ? { name: spec.name } : {}) });
		if (spec.model?.includes("/")) {
			const [provider, ...rest] = spec.model.split("/");
			try {
				await child.setModel(provider!, rest.join("/"));
			} catch (error) {
				parent.translator.notice("warn", `Subagent stays on the default model: ${(error as Error).message}`);
			}
		}

		const handed = (spec.boards ?? []).filter((path) => this.deck.board(path));
		if (handed.length > 0) child.setContext(handed);

		const result = await child.run(brief(spec.task, handed, this.deck));
		this.publish();
		return { agent: child.id, name: child.chat().name, report: result.report, boards: result.boards };
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
		 * A deck restored from the store starts no runtimes, so no agent exists to
		 * produce the `models` catalogue that a fresh deck's first agent produces at
		 * boot — and without it every dormant chat's picker says nothing until some
		 * new agent starts. The focused chat is the one the browser opens to talk
		 * to; waking it here brings the catalogue (and its own model) with it.
		 * `start()` is memoised, so an agent already starting is a no-op.
		 */
		const focus = this.get(this.focusedId);
		if (focus) void focus.start();
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
	const parts = [task.trim()];

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
		"When you are done, reply with a short report: what you changed, and anything the parent agent needs to decide.",
	);
	return parts.join("\n");
}
