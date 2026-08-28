import { readFileSync } from "node:fs";
import type { AgentChat, AgentKind, Camera, ServerMessage } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import type { StageService } from "../stage/service.ts";
import type { DelegateReport, DelegateSpec } from "../stage/tool.ts";
import { DeckAgent } from "./session.ts";
import { SnapshotStore } from "./snapshot.ts";

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

export class Registry {
	private readonly agents: DeckAgent[] = [];
	private focusedId: string | undefined;
	/** Shared, so a fork can inherit the canvas of the agent it came from (§6.2). */
	private readonly snapshots = new SnapshotStore();

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
	) {}

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
			forkedFrom?: { agentId: string; at: number };
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
				color: COLORS[this.agents.length % COLORS.length]!,
				kind: options.kind ?? this.host.defaultKind,
				snapshots: this.snapshots,
			},
		);
		this.agents.push(agent);
		this.focusedId ??= agent.id;
		void agent.start();
		this.publish();
		return agent;
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
	}

	/** A different deck is a different set of agents: a session's cwd cannot move. */
	async reset(deck: Deck): Promise<void> {
		for (const agent of this.agents) agent.dispose();
		this.agents.length = 0;
		this.focusedId = undefined;
		this.deck = deck;
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
