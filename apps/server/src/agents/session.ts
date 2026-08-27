import { randomUUID } from "node:crypto";
import type { AgentChat, AgentState, Camera, Identity, ModelOption, ServerMessage, ThinkingLevel } from "@decks/protocol";
import type { DelegateReport, DelegateSpec } from "../pi/extension.ts";
import type { Deck } from "../deck/loader.ts";
import { decksStage } from "../pi/extension.ts";
import { ExtensionUiBridge } from "../pi/extension-ui.ts";
import { PiBackend } from "../pi/backend.ts";
import type { StageService } from "../stage/service.ts";
import type { AgentBackend } from "./backend.ts";
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
	readonly id = randomUUID();
	readonly translator: Translator;
	readonly bridge: ExtensionUiBridge;

	private backend: AgentBackend | undefined;
	private starting: Promise<void> | undefined;
	private failure: string | undefined;
	private state: AgentState = "idle";
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
	/** Set by the extension once it is running; the only route to the model. */
	private tell: ((text: string) => void) | undefined;

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
		options: { name?: string; color: string; parentId?: string; resumeRef?: string },
	) {
		this.identity = { name: options.name ?? "Agent", color: options.color };
		this.parentId = options.parentId;
		this.resumeRef = options.resumeRef;

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
		);

		this.bridge = new ExtensionUiBridge({
			prompt: (prompt) => this.emit({ type: "extension.ui.prompt", prompt }),
			closePrompt: (id) => this.emit({ type: "extension.ui.prompt.closed", id }),
			notify: (text, level) => this.translator.notice(level, text),
			status: () => {},
			working: () => {},
		});
	}

	readonly parentId: string | undefined;
	private readonly resumeRef: string | undefined;

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
	}

	/** Start the backend, once, and remember the reason if it will not start. */
	start(): Promise<void> {
		this.starting ??= PiBackend.create({
			cwd: this.deck.path,
			deck: this.deck,
			translator: this.translator,
			bridge: this.bridge,
			notice: (level, text) => this.translator.notice(level, text),
			...(this.resumeRef ? { resumeRef: this.resumeRef } : {}),
			extensions: [
				decksStage({
					stage: this.stage,
					agent: this.stageHooks(),
					port: this.host.port,
					bind: (tell) => {
						this.tell = tell;
					},
				}),
			],
		})
			.then((backend) => {
				this.backend = backend;
				const name = backend.name();
				if (name) this.identity = { ...this.identity, name };
				this.emit({ type: "agent.identity", id: this.id, identity: this.identity });
				this.emit({ type: "agent.model", id: this.id, model: backend.model() });
				void this.publishModels();
			})
			.catch((error: unknown) => {
				/*
				 * The usual cause is no credentials, and the usual fix is `pi auth`. So
				 * this is a notice in the agent's own column rather than a thrown error
				 * that takes the deck down: the boards still work, and the reason is
				 * where the person is looking.
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
			this.emit({ type: "models", models: this.modelOptions });
		} catch (error) {
			this.translator.notice("warn", `Could not list models: ${(error as Error).message}`);
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
		try {
			await this.backend.prompt(text);
		} catch (error) {
			this.translator.notice("error", (error as Error).message);
			this.translator.setState("idle");
		}
		this.emit({ type: "agent.usage", id: this.id, usage: this.backend.usage() ?? { contextTokens: null, contextWindow: 0, cost: 0 } });
		// The branch gained a point — the message just asked — so the transcript's user
		// messages can be paired with it and get their rewind actions.
		this.backend.syncEntryIds();
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
		if (!this.tell) return;
		if (this.held.length > 0 && !this.held.includes(path)) return;
		this.tell(`The user edited ${path}: ${summary}. Read it again before assuming it says what you last wrote.`);
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
			this.backend?.syncEntryIds();
		}
		return result;
	}

	forkFrom(entryId: string): string | undefined {
		return this.backend?.forkFrom(entryId);
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
		this.emit({ type: "agent.model", id: this.id, model: this.backend?.model() });
	}

	setThinking(level: ThinkingLevel): void {
		this.backend?.setThinking(level);
		this.emit({ type: "agent.model", id: this.id, model: this.backend?.model() });
	}

	/** The agent naming itself, from M3's `stage.me.setName`. */
	rename(name: string): void {
		this.identity = { ...this.identity, name };
		this.backend?.setName(name);
		this.emit({ type: "agent.identity", id: this.id, identity: this.identity });
	}

	setAvatar(url: string | undefined): void {
		this.identity = { ...this.identity, avatar: url };
		this.emit({ type: "agent.identity", id: this.id, identity: this.identity });
	}

	get color(): string {
		return this.identity.color;
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
		};
	}

	greet(reply: (message: ServerMessage) => void): void {
		reply({ type: "agent.identity", id: this.id, identity: this.identity });
		reply({ type: "chat.history", agentId: this.id, items: this.translator.history() });
		reply({ type: "agent.state", id: this.id, state: this.state });
		reply({ type: "context.changed", agentId: this.id, boards: [...this.held], inPlay: [...this.playing] });
		if (this.backend) reply({ type: "agent.model", id: this.id, model: this.backend.model() });
		if (this.modelOptions.length > 0) reply({ type: "models", models: this.modelOptions });
	}

	answerDialog(...args: Parameters<ExtensionUiBridge["answer"]>): void {
		this.bridge.answer(...args);
	}

	dispose(): void {
		this.bridge.dispose();
		this.backend?.dispose();
	}
}
