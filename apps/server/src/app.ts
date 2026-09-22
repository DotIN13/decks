import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { examplesDir, runtimeLib } from "@decks/runtime";
import type { AgentKind, Board, Camera, Canvas, ClientMessage, DeckState, RuntimeInfo, ServerMessage, StageCall } from "@decks/protocol";
import { Registry } from "./agents/registry.ts";
import { Acts } from "./agents/acts.ts";
import { BoardService } from "./boards/service.ts";
import { EvalTrust } from "./boards/eval-trust.ts";
import { runtimeList } from "./runtimes/registry.ts";
import { isBoardFormat } from "./boards/templates.ts";
import { StageBridge } from "./stage/bridge.ts";
import { TaskService } from "./tasks/service.ts";
import { TaskStore } from "./tasks/store.ts";
import { SettingsStore } from "./settings.ts";
import { CanvasStore } from "./canvas/store.ts";
import { canvasStage, type StageTarget } from "./canvas/stage.ts";
import { dispatch } from "./wire/index.ts";
import type { Reply } from "./wire/context.ts";
import { WebBridge } from "./web/bridge.ts";
import { ThumbService } from "./boards/thumbs.ts";
import { StageService } from "./stage/service.ts";
import { ClaudeAccounts, DEFAULT_ACCOUNT } from "./runtimes/claude/accounts.ts";
import { claudeIdentity } from "./runtimes/claude/backend.ts";
import { mapSeries } from "./series.ts";
import { DECK_DIR, type Config } from "./config.ts";
import { describeSync, syncExamplesDir, syncRuntimeLib } from "./deck/lib-sync.ts";
import { Deck } from "./deck/loader.ts";
import { watchDeck } from "./deck/watcher.ts";
import { cameraFor, type CameraReading } from "./deck/place.ts";
import { Hub, type View } from "./ws.ts";
import type { DeckAgent } from "./agents/session.ts";

/**
 * How often the deck re-reads its boards from disk regardless of what the watcher said.
 *
 * Slow enough that it is free (a walk and a `stat` per board), fast enough that a missed
 * event is a beat rather than a session.
 */
/** How long an account's identity is worth reusing before asking the CLI again. */
const IDENTITY_TTL_MS = 60_000;

/** How long the dashboard waits between looks at its schedules. */
const TASKS_MS = 30_000;

const RESYNC_MS = 4000;

/**
 * The open deck, the watcher on it, and the browsers looking at it.
 *
 * Deliberately thin: it holds no agent, no camera and no selection. Agents arrive
 * in M2 and get their own registry; the camera belongs to the browser that is
 * looking; the selection belongs to the frame. What lives here is what is true
 * for everyone — which board files exist and where they sit.
 */
export class App {
	deck: Deck;
	readonly agents: Registry;
	readonly stage: StageService;
	/** What each agent is doing to which board, said to the browsers as it happens (`agents/acts.ts`). */
	readonly acts: Acts;
	/** The board files: writing, revisioning, editing, deleting (`boards/service.ts`). */
	readonly boards: BoardService;
	/** Tasks and schedules: the dashboard's store, rule and scheduler (`tasks/service.ts`). */
	readonly tasks: TaskService;
	/** The deck's own settings. Built first: it sets the clock everything after it reads. */
	readonly settings: SettingsStore;
	/**
	 * The deck's canvases: what holds the boards, their places and the arrows between them.
	 *
	 * One per deck, shared by every agent on it, which is the whole point — two agents working
	 * on one thing are on one canvas and see one arrangement.
	 */
	readonly canvases: CanvasStore;
	/** Which boards may run their own code, and the list the first question writes (`boards/eval-trust.ts`). */
	readonly evalTrust: EvalTrust;
	/** The port this server is on, so a board's `stage.url()` answers like an agent's. */
	get port(): number {
		return this.config.port;
	}
	/** The canvas tool's other end, for the runtimes that are not in this process. */
	readonly bridge = new StageBridge();
	/** The user's own Chrome, shared through the Decks extension (`web/bridge.ts`). */
	readonly web: WebBridge;
	readonly thumbs: ThumbService;
	private hub: Hub | undefined;
	/** The browser whose frame is being handled right now, if any — see `handle`. */
	viewing: View | undefined;
	private unwatch: (() => void) | undefined;
	/** The safety net under the watcher — see `watch()`. */
	private resyncTimer: NodeJS.Timeout | undefined;
	/** The dashboard's scheduler — see `watch()`. */
	private tasksTimer: NodeJS.Timeout | undefined;
	/**
	 * Where the browser last said it was looking.
	 *
	 * The camera belongs to the browser; the server keeps the last reading only so
	 * an agent can ask what the user can see. It is a reading, not a source of
	 * truth — nothing here ever moves it except at an agent's request.
	 */
	lastCamera: CameraReading = { at: { x: 0, y: 0, zoom: 1 } };
	/**
	 * And one per conversation, because the camera belongs to the conversation.
	 *
	 * The browser reports which agent's view it is reporting, so `stage.camera()` answers
	 * "where is my canvas looking" rather than "where is the user looking". An agent nobody
	 * has looked at yet falls back to the last reading, which is the only honest guess.
	 */
	readonly cameras = new Map<string, CameraReading>();
	/** Stage calls waiting for the browser to carry them out. */
	readonly pendingStage = new Map<string, { resolve: (value: unknown) => void; timer: NodeJS.Timeout }>();
	/** The Claude subscriptions this install can use, shared by every Claude agent. */
	readonly claudeAccounts: ClaudeAccounts;

	private constructor(
		readonly config: Config,
		deck: Deck,
	) {
		this.deck = deck;
		this.canvases = new CanvasStore(deck.path, (text) => this.send({ type: "notice", level: "warn", text }));
		this.evalTrust = new EvalTrust(config.dataDir);
		this.boards = new BoardService(deck, {
			send: (message) => this.send(message),
			/*
			 * The arrangement, not the deck — `BoardService` broadcasts a board on every write, and the
			 * loader's copy of one has no place of its own any more. It asks rather than is handed the
			 * positions so that the seeding `stageState` does happens on this path too.
			 */
			state: () => this.stageState(),
			edited: (path, summary) => this.agents.userEdited(path, summary),
			removed: (path) => {
				// A board that left the deck leaves every canvas, with its place and its arrows.
				this.canvases.boardRemoved(path);
				this.agents.boardRemoved(path);
			},
		});
		this.stage = new StageService(deck, {
			/*

			 * Move a board on the stage being served, and answer with the board as that stage sees it.

			 * The deck has no arrangement to write to: a place belongs to an agent, so this writes on the

			 * focused one, which is the stage the sandbox is running as.

			 */

			place: (agentId: string, path: string, x: number, y: number) => {

				const agent = this.agents.get(agentId) ?? this.agents.focused();

				agent.setPosition(path, x, y);

				return this.stageState(agent).boards.find((board) => board.path === path);

			},

			/*
			 * `stage.boards()` reads the arrangement **of the agent that asked** — the same canvas
			 * `stage.move` writes to. Served from the conversation on screen instead, an agent
			 * working while the person read another chat moved a board and read back the place it
			 * had before, with the move itself correct on disk.
			 *
			 * No id is a board running its own code, which acts for the conversation in front of
			 * the person (`stage/board-actor.ts`), so that case keeps the old answer.
			 */
			boards: (agentId?: string, canvasId?: string) =>
				// A named canvas answers with its own places: `stage.boards({ canvas })` reads a room the agent is not in.
				canvasId && this.canvases.get(canvasId) ? this.canvasState(canvasId).boards : this.stageState(agentId ? this.agents.get(agentId) : undefined).boards,

			newBoard: ({ format, ...rest }) => this.boards.newBoard({ ...rest, ...(isBoardFormat(format) ? { format } : {}) }),
			newMirror: (options) => this.boards.newMirror(options),
			writeBoard: (path, html) => this.boards.writeBoard(path, html),
			extent: (path, rev) => this.boards.extent(path, rev),
			awaitExtent: (path, rev, ms) => this.boards.awaitExtent(path, rev, ms),
			reading: (path, rev) => this.boards.reading(path, rev),
			views: async (path) => {
				const board = this.deck.board(path);
				return board ? this.thumbs.views(board) : undefined;
			},
			call: (call) => this.callStage(call),
			connected: () => (this.hub?.connections ?? 0) > 0,
			broadcast: (message) => this.send(message),
			camera: (agentId) => (this.cameras.get(agentId) ?? this.lastCamera).at,
			agents: () => this.agents.summaries(),
		});
		/*
		 * The Claude subscriptions this install can use (`claude/accounts.ts`).
		 *
		 * On the install's data directory rather than the deck: an account is a property of
		 * the machine, like the credentials it stands for. Swept on open, so a login that was
		 * abandoned halfway leaves no directory behind.
		 */
		this.claudeAccounts = new ClaudeAccounts(config.dataDir);
		this.claudeAccounts.sweep();
		/*
		 * The shared browser, on the install like the accounts are: the pairing code is a
		 * property of this server, not of a deck. Every change is broadcast, so the status
		 * board and the extension's popup say the same thing at the same time.
		 */
		this.web = new WebBridge(config.dataDir, (status) => this.send({ type: "web.status", status }));
		this.stage.web = Object.assign(this.web, { board: () => this.boards.newWebBoard() }) as typeof this.web & { board: () => string };
		/*
		 * The dashboard: tasks and schedules, per deck like the agents they belong to.
		 *
		 * Its `registry` is the three things it may touch — the roster the rule ranks, the
		 * queue it writes into, and the queue it takes a cancelled task back out of — so
		 * the service stays a service and the registry stays a registry. Warnings about a
		 * corrupt store ride the same notice strip an agent uses.
		 */
		/*
		 * Board pictures for the dashboard, taken by this server of itself. `127.0.0.1` whatever
		 * the host is: `0.0.0.0` is somewhere to listen, not somewhere to go.
		 */
		this.thumbs = new ThumbService({
			origin: () => `http://${config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host}:${config.port}`,
			dir: join(deck.path, ".decks", "thumbs"),
			/*
			 * The same guards as `board.extent` on the wire — the revision measured, and never a
			 * deck — and one more: **a reader's browser outranks this one.**
			 *
			 * This measurement is taken in the server's own Chromium, with the server's fonts. A
			 * reader's browser has theirs, and the same document comes to a different height in
			 * the two: 1,149 px here against 1,221 px there on a board of tables, which is three
			 * lines of wrapping. Both readings are honest and only one can be the board's. It has
			 * to be the reader's, or the board is cut for the person actually looking at it.
			 *
			 * So this fills in a height nobody has reported yet — a board on the dashboard that
			 * has never been opened, which is the reason the callback exists — and never overrules
			 * a frame's.
			 */
			measured: (path, rev, h) => {
				const board = this.deck.board(path);
				if (!board || board.format === "slides" || board.rev !== rev) return;
				if (this.boards.extent(path, rev)) return;
				if (this.deck.setHeight(path, h)) this.send({ type: "deck.state", deck: this.stageState() });
			},
		});
		this.settings = new SettingsStore(deck.path, (text) => this.send({ type: "notice", level: "warn", text }));
		this.tasks = new TaskService(
			new TaskStore(deck.path, (text) => this.send({ type: "notice", level: "warn", text })),
			{
				roster: () => this.agents.summaries(),
				deliver: (target, spec) => this.agents.deliver(target, spec),
				removeQueued: (agentId, taskId) => this.agents.removeQueued(agentId, taskId),
				decide: (task) => this.agents.decide(task),
			},
			(message) => this.send(message),
		);
		this.acts = new Acts({
			emit: (message) => this.send(message),
			identity: (agentId) => this.agents.get(agentId)?.who(),
			boardPathOf: (file) => this.boards.boardPathOf(file),
			read: (path) => {
				try {
					return this.stage.read(path);
				} catch {
					return undefined;
				}
			},
		});
		this.agents = new Registry(
			deck,
			(message) => this.send(message),
			this.stage,
			{
				port: config.port,
				act: (agentId, act) => this.acts.act(agentId, act),
				defaultKind: config.backend,
				dispatcherKind: () => this.settings.get().dispatcherKind,
				camera: (agentId) => (this.cameras.get(agentId) ?? this.lastCamera).at,
				cameraOn: (agentId, canvasId) => cameraFor(this.cameras.get(agentId) ?? this.lastCamera, canvasId),
				/*
				 * A board joining a canvas was given a place (`agents/session.ts`). The browsers draw a
				 * board where the deck state says it is, so the state goes out here — before the
				 * `context.changed` that says the board is on the canvas, which is the order the two
				 * arrive in.
				 */
				arranged: () => this.send({ type: "deck.state", deck: this.stageState() }),
				canvases: this.canvases,
				canvasList: () => this.canvasList(),
				publishCanvases: () => this.publishCanvases(),
				publishRuntimes: () => this.send({ type: "runtimes", list: this.runtimes() }),
				recordRevision: (path) => this.boards.recordRevision(path),
				wrote: (path, who) => this.boards.wrote(path, who),
				boardPathOf: (file) => this.boards.boardPathOf(file),
				accounts: this.claudeAccounts,
				accountsChanged: () => void this.publishAccounts(),
				bridge: this.bridge,
				tasks: {
					create: (spec, fromId) => this.tasks.create(spec, undefined, fromId),
					started: (taskId) => this.tasks.taskStarted(taskId),
					finished: (finish) => this.tasks.taskFinished(finish),
					agentRemoved: (id) => this.tasks.agentRemoved(id),
					assigned: (placement) => this.tasks.assignedByDispatcher(placement),
					decided: (outcome) => this.tasks.decided(outcome),
					schedule: (spec) => this.tasks.createSchedule(spec),
					scheduled: (outcome) => this.tasks.scheduled(outcome),
				},
			},
		);
	}

	/**
	 * The account list, with every identity read fresh from the CLI.
	 *
	 * Read rather than remembered, because the CLI's own login can change without Decks
	 * hearing about it — somebody running `claude auth login` in a terminal, or a token that
	 * expired. A list that reported a stale email would be worse than one that took a moment.
	 *
	 * Broadcast when nobody asked in particular (a switch, a new login), because two tabs on
	 * one deck share these accounts.
	 */
	/**
	 * Refresh an account's token **once**, before the sessions want it.
	 *
	 * An account nothing has used for eight hours has an expired access token, so the first
	 * request after switching to it must refresh — and every session switches at the same
	 * instant, because they all read the same link. Six sessions then race for one lock,
	 * five lose, and each loss is somebody's turn replaced by "another Claude Code process
	 * is refreshing it".
	 *
	 * So the switch does the refresh itself, in one process, and waits for it. `auth status`
	 * is the cheapest thing that will do it: it reads the token, refreshes it if it is due,
	 * and writes it back where the account keeps it. By the time a session looks, the token
	 * on disk is fresh and there is nothing to contend for.
	 *
	 * `reread: true` on the publish that follows, because this is the one moment the cached
	 * identity is certainly stale — the file has just been rewritten.
	 */
	async warmAccount(id: string): Promise<void> {
		try {
			await this.identityOf(id, id === DEFAULT_ACCOUNT, true);
		} catch {
			/*
			 * A failed warm-up is not a failed switch. The account is already in force; what
			 * is lost is the head start, and the sessions fall back to what they did
			 * before — one of them refreshes and the rest retry (`claude/transient.ts`).
			 */
		}
	}

	/**
	 * An account's identity, from the CLI, with a short memory.
	 *
	 * `claude auth status` is a subprocess that will refresh a stale token, so it is not a
	 * free read — it touches the same credentials file every session is reading. Asking once
	 * a minute per account is enough for a panel: an email does not change on its own, and
	 * the one thing that *can* change without Decks hearing (somebody running
	 * `claude auth login` in a terminal) is exactly what `reread` is for.
	 */
	private readonly identities = new Map<string, { at: number; identity: { email?: string; orgName?: string; plan?: string } }>();

	private async identityOf(id: string, isDefault: boolean, reread: boolean): Promise<{ email?: string; orgName?: string; plan?: string }> {
		const cached = this.identities.get(id);
		if (!reread && cached && Date.now() - cached.at < IDENTITY_TTL_MS) return cached.identity;
		const identity = await claudeIdentity(isDefault ? undefined : this.claudeAccounts.configDir(id));
		/*
		 * An empty answer is not cached. It means the CLI was slow, or busy behind somebody
		 * else's refresh — and remembering "this account has no name" for a minute is how a
		 * transient failure becomes a panel that says the account is signed out.
		 */
		if (identity.email || identity.plan) this.identities.set(id, { at: Date.now(), identity });
		return identity;
	}

	async publishAccounts(reply?: (message: ServerMessage) => void, options?: { reread?: boolean }): Promise<void> {
		const stored = this.claudeAccounts.list();
		// What a conversation with no account of its own spends — see `ClaudeAccounts.defaultId`.
		const active = this.claudeAccounts.defaultId();
		/*
		 * One `claude auth status` at a time, and not at all when a recent answer will do.
		 *
		 * This used to be `Promise.all` over the accounts — one subprocess per row, all at
		 * once, each able to refresh a stale token. Which made this function a small
		 * stampede on the very files the sessions are reading: the CLI serialises a refresh
		 * with a lock and tells the losers to come back in a minute, so a publish could
		 * cost somebody their turn. It fires on six paths, including one that is a person
		 * pressing a button, so it has to be cheap rather than parallel.
		 */
		const accounts = await mapSeries(stored, async (account) => {
			const isDefault = account.id === DEFAULT_ACCOUNT;
			const identity = await this.identityOf(account.id, isDefault, options?.reread === true);
			const signedIn = Boolean(identity.email || identity.plan);
			return {
					id: account.id,
					...(isDefault ? { isDefault: true as const } : {}),
					signedIn,
					// What the CLI says now, falling back to what was recorded when it was added —
					// so a row still has a name if `auth status` is slow or the token has lapsed.
					...(identity.email ?? account.email ? { email: identity.email ?? account.email } : {}),
					...(identity.orgName ?? account.orgName ? { orgName: identity.orgName ?? account.orgName } : {}),
					...(identity.plan ?? account.plan ? { plan: identity.plan ?? account.plan } : {}),
			};
		});
		// Recorded so a row keeps its name when the CLI is next slow to answer.
		const mine = accounts.find((account) => account.isDefault);
		if (mine?.signedIn) {
			this.claudeAccounts.describeDefault({
				...(mine.email ? { email: mine.email } : {}),
				...(mine.orgName ? { orgName: mine.orgName } : {}),
				...(mine.plan ? { plan: mine.plan } : {}),
			});
		}
		/*
		 * Who is on what, because `active` no longer answers it.
		 *
		 * With a subscription per agent, one "in force" row is at best the default a new
		 * agent gets. The panel is where somebody goes to ask which subscription is being
		 * spent, and the answer is now a mapping — leaving it out is how the account row came
		 * to disagree with the billing in the first place.
		 */
		const spending: Record<string, string> = {};
		for (const agent of this.agents.all()) {
			const on = agent.accountId();
			if (on) spending[agent.id] = on;
		}
		const frame: ServerMessage = { type: "claude.accounts", accounts, active, ...(Object.keys(spending).length > 0 ? { spending } : {}) };
		if (reply) reply(frame);
		else this.send(frame);
	}

	/**
	 * Ask the browser to do something to the canvas, and wait for it.
	 *
	 * Broadcast rather than addressed: two tabs on one deck are looking at the same
	 * stage, and both should move. The first answer wins, and a browser that never
	 * answers times out into a result rather than leaving the agent's tool call
	 * hanging on a tab that was closed mid-gesture.
	 */
	private callStage(call: Omit<StageCall, "id">): Promise<unknown> {
		const id = randomUUID();
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pendingStage.delete(id);
				resolve({ skipped: "the canvas did not answer in time" });
			}, 5000);
			this.pendingStage.set(id, { resolve, timer });
			this.send({ type: "stage.call", call: { ...call, id } });
		});
	}

	/**
	 * Open the deck in the data directory, creating it the first time.
	 *
	 * A data directory that does not exist yet is not an error — it is somebody starting.
	 * The new deck is deliberately **empty** apart from the primitives: the first thing
	 * you see is your own canvas, and the demo in `example/` is a thing you opt into by
	 * pointing at it.
	 */
	static open(config: Config): App {
		const existing = existsSync(join(config.deck, "deck.json")) || existsSync(join(config.deck, "boards"));
		const deck = existing ? Deck.open(config.deck) : Deck.create(config.deck, App.runtimeLib);
		// A deck this build did not create has whichever `lib/` created it, so every
		// start brings the primitives forward. `Deck.create` has just done it for a new
		// one. The examples are refreshed for both, in the same breath: the nine worked
		// boards live here after every restart, at their current content, so the copy
		// never drifts from what this build ships. Before `attach()`, deliberately: the
		// watcher is not running yet, so the one restart that does rewrite files cannot
		// also reload every board twice.
		if (existing) App.refreshLib(deck);
		App.refreshExamples(deck);
		return new App(config, deck);
	}

	/**
	 * Bring a deck's copied primitives up to this build's (DESIGN §2).
	 *
	 * Logged rather than sent as a notice: on a normal restart it changes nothing and
	 * says nothing, and when it does change something the person who needs to know is
	 * whoever is reading the server's output wondering why a board looks different.
	 */
	private static refreshLib(deck: Deck): void {
		const sync = syncRuntimeLib(App.runtimeLib, join(deck.path, "lib"));
		const summary = describeSync(sync);
		if (summary) console.log(`[decks] lib/ ${summary}`);
		for (const gone of sync.removed) console.log(`[decks] lib/ removed ${gone} — this build no longer ships it`);
	}

	/**
	 * Bring a deck's `examples/` up to this build's.
	 *
	 * The same content-compared copy as `refreshLib`, so a restart that changed nothing
	 * writes nothing. Logged rather than sent as a notice, for the same reason: on a
	 * normal restart it changes nothing and says nothing.
	 */
	private static refreshExamples(deck: Deck): void {
		const sync = syncExamplesDir(App.runtimeExamples, join(deck.path, "examples"));
		const summary = describeSync(sync);
		if (summary) console.log(`[decks] examples/ ${summary}`);
		for (const gone of sync.removed) console.log(`[decks] examples/ removed ${gone} — this build no longer ships it`);
	}

	/** Where the shipped primitives live, copied into every deck and refreshed on open. */
	static get runtimeLib(): string {
		return runtimeLib();
	}

	/** Where the shipped examples live, copied into every deck and refreshed on open. */
	static get runtimeExamples(): string {
		return examplesDir();
	}

	attach(hub: Hub): void {
		this.hub = hub;
		this.watch();
		/*
		 * The deck's own chat list first, then one agent only if it had none.
		 *
		 * Restored chats start nothing, so this is a directory read rather than fifteen
		 * runtimes. Starting a *new* agent is asynchronous and may fail (no credentials, most
		 * often), and that failure belongs in its own transcript rather than in the way of the
		 * deck.
		 */
		if (this.agents.restore() === 0) this.agents.create();
		// And the dashboard's dispatcher, one per deck, whether the deck is new or restored.
		this.agents.ensureDispatcher();
		/*
		 * After the rows are back: drop per-agent account links for agents this install no
		 * longer has. `remove` covers the ordinary close; this covers a chat pruned while the
		 * server was down, and a data directory carried between installs.
		 */
		this.claudeAccounts.sweepAgents(this.agents.all().map((agent) => agent.id));
	}

	private watch(): void {
		this.unwatch?.();
		this.unwatch = watchDeck(this.deck.path, (change) => {
			if (change.kind === "rescan") {
				// A rename went past, or the watcher was replaced. Either way what we
				// were told is no longer trustworthy, so ask the disk.
				this.resyncBoards();
				return;
			}
			if (change.kind === "deck") {
				/*
				 * A hand edit, always: **the app never writes `deck.json`** any more, so there is no echo of
				 * its own to tell apart from somebody's. A place belongs to a stage and a size belongs to the
				 * board's file, so the only things left in here — the name, the roots, and an older build's
				 * arrangement — are the user's to change.
				 */
				this.deck.reload();
				this.boards.restamp();
				this.send({ type: "deck.state", deck: this.stageState() });
				return;
			}
			if (change.kind === "board") {
				const board = this.deck.refresh(change.path);
				// Whoever wrote it — the agent, an editor, a shell redirect — this is the
				// moment the new version exists, so this is where it is recorded.
				if (board) {
					try {
						this.boards.recordRevision(change.path);
						// Whoever was holding this board with a write or edit tool is done, and the diff says what changed.
						this.acts.landed(change.path, this.stage.read(change.path));
					} catch {
						/* the file went away between the event and the read */
					}
				}
				// A board that is gone must leave every agent's context with it, or the
				// dead path silently empties the rail and the canvas (DeckAgent.forget).
				if (!board) {
					this.agents.boardRemoved(change.path);
					this.boards.forgetBoard(change.path);
				}
				this.send(
					board
						? { type: "board.changed", path: change.path, rev: board.rev, board: this.placed(board) }
						: { type: "board.changed", path: change.path, rev: 0, removed: true },
				);
				return;
			}
			// An asset under the deck moved. A board may be showing it, and the frame
			// has no way to know, so every board reloads — cheap, and rare.
			this.send({ type: "deck.state", deck: this.stageState() });
		});

		/*
		 * And a slow reading of the disk under all of it.
		 *
		 * The watcher is a promise the operating system does not quite make: events are
		 * dropped under load, a recursive arm can end up pointed at a replaced inode, and
		 * a deck on a network filesystem may produce nothing at all. None of that is
		 * recoverable from the inside, and the failure is silent — the canvas simply stops
		 * agreeing with the files.
		 *
		 * So every few seconds the deck stats its boards and reports what actually moved.
		 * It costs a directory walk and one `stat` per board, it reads nothing that has
		 * not changed, and it says nothing when nothing has. `unref` so it never holds a
		 * process open, which matters for the tests and for a headless run.
		 */
		clearInterval(this.resyncTimer);
		this.resyncTimer = setInterval(() => this.resyncBoards(), RESYNC_MS);
		this.resyncTimer.unref?.();

		/*
		 * And the dashboard's scheduler under it, on its own slower beat.
		 *
		 * A task lands at :09:00, not :09:00:00 — the digest does not care about the
		 * second — so thirty seconds is a fine quantum and downtime of less than that
		 * costs nothing. `unref`, like the resync, so a headless run can exit with
		 * schedules waiting.
		 */
		clearInterval(this.tasksTimer);
		this.tasksTimer = setInterval(() => this.tasks.tick(), TASKS_MS);
		this.tasksTimer.unref?.();
	}

	/**
	 * Re-read the boards directory and tell everyone what moved.
	 *
	 * The same two messages the watcher's own branch sends, from the same place, so a
	 * board that arrives this way is indistinguishable from one the watcher caught.
	 */
	private resyncBoards(): void {
		const { changed, removed } = this.deck.resync();
		for (const board of changed) {
			this.boards.recordRevision(board.path);
			this.send({ type: "board.changed", path: board.path, rev: board.rev, board: this.placed(board) });
		}
		for (const path of removed) {
			// A dead path left in a context silently empties the rail and the canvas.
			this.agents.boardRemoved(path);
			this.boards.forgetBoard(path);
			this.send({ type: "board.changed", path, rev: 0, removed: true });
		}
	}

	/**
	 * One frame, answered by the table in `wire/`.
	 *
	 * This method used to *be* the table — 38 cases and 500 lines in the middle of the
	 * composition root, so every new frame landed in the same place as every unrelated
	 * feature's. The cases moved to `wire/`, and what is left is the one line that says
	 * where they went.
	 */
	handle(message: ClientMessage, reply: Reply, view?: View): void {
		if (!view) {
			dispatch(message, reply, this);
			return;
		}
		/*
		 * Each browser has its own conversation, so a frame is handled as the browser that sent it.
		 *
		 * The registry keeps one "focused agent", which every frame about "the stage you are on" reads:
		 * a board moved, a board placed, a prompt with no id. Setting it to this browser's before the
		 * frame and reading it back after is what lets a phone and a laptop sit on two different
		 * conversations — without it, opening a chat on one moved the other to it too.
		 */
		this.agents.look(view.focused);
		this.viewing = view;
		try {
			dispatch(message, reply, this);
		} finally {
			this.viewing = undefined;
			view.focused = this.agents.looking()?.id;
		}
	}

	greet(reply: (message: ServerMessage) => void, view?: View): void {
		// A new browser starts on the conversation last opened anywhere, and moves on its own after.
		if (view) view.focused = this.agents.looking()?.id;
		reply({ type: "deck.state", deck: this.stageState() });
		// And what canvases there are: the dashboard's cards, and the list the composer's
		// `@` and the canvas switcher read.
		reply({ type: "canvases", canvases: this.canvasList(), ...(view?.canvas ? { focused: view.canvas } : {}) });
		/*
		 * And what this install can run.
		 *
		 * A property of the machine rather than of the deck, which is why it is a frame of
		 * its own: which runtimes exist, what to call them in a menu, and whether this
		 * machine can start them. The browser needs the last one to grey a row out — before
		 * this, the `+` menu offered all four everywhere, and the first prompt was where you
		 * found out that the binary was not installed.
		 */
		reply({ type: "runtimes", list: this.runtimes() });
		for (const warning of this.deck.warnings) reply({ type: "notice", level: "warn", text: warning });
		// The whole truth on connect, so a reconnect is a refresh: the deck, the
		// agents, and each one's transcript.
		this.agents.greet(reply);
		/*
		 * And the subscriptions, which used to arrive only when Settings was opened.
		 *
		 * Every conversation's model picker draws a row per account, so a browser that has
		 * not opened Settings had a picker with no Subscription section at all — the control
		 * for switching account was invisible until you visited an unrelated panel. The list
		 * is a property of the install, like the deck itself, so it belongs in the greeting.
		 *
		 * Late, deliberately: each row costs a `claude auth status`, so this resolves a
		 * second or two after the rest and the browser fills the section in when it lands.
		 */
		void this.publishAccounts(reply);
		// And the shared browser, with the code the extension pairs with: the status board
		// shows it when nothing is connected yet, and the browser is where the user reads it.
		reply({ type: "web.status", status: this.web.status(), code: this.web.code() });
		// And the dashboard's tasks and schedules, with the boards: everything the panel
		// draws is part of the greeting, so a reconnect is a refresh.
		reply({ type: "tasks", ...this.tasks.summary() });
		reply(this.settingsMessage());
	}

	settingsMessage(): ServerMessage {
		return { type: "settings", settings: this.settings.get(), machineZone: this.settings.machineZone() };
	}

	/**
	 * Choose the deck's timezone. The clock moves at once, every schedule on the deck's
	 * clock is re-read against it, and every browser hears both.
	 */
	setTimezone(zone: string | null): { error: string } | undefined {
		const outcome = this.settings.setTimezone(zone);
		if ("error" in outcome) return outcome;
		this.tasks.rezone();
		this.send(this.settingsMessage());
		return undefined;
	}

	/**
	 * Choose the runtime the dashboard's dispatcher is. A runtime this machine cannot start is
	 * refused with its own reason; otherwise the dispatcher of that kind is found or made, and
	 * every browser hears the setting and the chat list.
	 */
	setDispatcherKind(kind: AgentKind): { error: string } | undefined {
		const runtime = this.runtimes().find((candidate) => candidate.kind === kind);
		if (!runtime) return { error: `"${kind}" is not a runtime this server has.` };
		if (!runtime.available) return { error: runtime.reason ?? `${runtime.label} is not installed on this machine.` };
		this.settings.setDispatcherKind(kind);
		this.agents.ensureDispatcher();
		this.send(this.settingsMessage());
		this.agents.publish();
		return undefined;
	}

	/**
	 * Open another data directory. Its deck is `<path>/decks`, created if absent.
	 *
	 * The path is a *data* directory rather than a deck, because the two are the same
	 * choice: a deck is a working directory, and its transcripts, revisions and settings
	 * are keyed to it. Nothing in the UI sends this yet.
	 */
	openDeck(path: string): void {
		const deckPath = join(path, DECK_DIR);
		const existing = existsSync(join(deckPath, "deck.json")) || existsSync(join(deckPath, "boards"));
		this.deck = existing ? Deck.open(deckPath) : Deck.create(deckPath, App.runtimeLib);
		if (existing) App.refreshLib(this.deck);
		App.refreshExamples(this.deck);
		this.stage.setDeck(this.deck);
		this.boards.setDeck(this.deck);
		// A different deck is a different set of canvases, read from its own folder.
		this.canvases.setDeck(this.deck.path);
		// The new deck's clock first: its schedules are read against it.
		this.settings.setDeck(this.deck.path);
		// Tasks and schedules belong to the deck they name, so a switch is a fresh read —
		// the dashboard that opens here is the new deck's, not the old one's.
		this.tasks.reset(this.deck);
		// An agent's cwd is the deck, and a Pi session's cwd cannot move, so opening
		// another deck starts again rather than re-pointing what is running.
		void this.agents.reset(this.deck).then(() => {
			if (this.agents.restore() === 0) this.agents.create();
		// And the dashboard's dispatcher, one per deck, whether the deck is new or restored.
		this.agents.ensureDispatcher();
		/*
		 * After the rows are back: drop per-agent account links for agents this install no
		 * longer has. `remove` covers the ordinary close; this covers a chat pruned while the
		 * server was down, and a data directory carried between installs.
		 */
		this.claudeAccounts.sweepAgents(this.agents.all().map((agent) => agent.id));
		});
		this.watch();
		this.send({ type: "deck.state", deck: this.stageState() });
		for (const warning of this.deck.warnings) this.send({ type: "notice", level: "warn", text: warning });
	}

	/**
	 * The deck as the focused stage sees it, with the places it had to work out written down on it.
	 *
	 * **Every outbound board list goes through this**, including the ones `boards/service.ts` sends,
	 * because `Deck.state()` on its own is the auto-layout and not the arrangement the conversation is
	 * looking at. It is one function rather than a rule repeated at six call sites: the failure mode of
	 * the rule is a board jumping to the origin on somebody else's write, which is easy to miss and
	 * hard to attribute.
	 *
	 * The seeding half matters as much as the reading half. `Deck.arrange` places a board the stage has
	 * not placed beside the frontier *as it is at that moment*, so leaving the result unrecorded means
	 * a board drifts every time a different one is dragged down. Writing the computed place onto the
	 * stage is what makes a board land once — `setPosition` is the debounced write the rest of the
	 * stage state already uses, so this is not a write per send.
	 *
	 * **It never creates an agent.** `Registry.focused()` mints one on demand for a deck nobody has
	 * spoken to, which is right for a prompt and wrong here: this is called from broadcast paths, and a
	 * `board.changed` must not start a runtime as a side effect of being sent. No stage means the
	 * deck's own auto-layout, which is what a deck with nobody looking at it has anyway.
	 */
	stageState(asked?: DeckAgent): DeckState {
		/*
		 * A frame from a browser that has opened a canvas is answered with that canvas. Asked
		 * about a particular agent — a per-view render, a board the agent placed — the answer is
		 * that agent's canvas, as before.
		 */
		if (!asked && this.viewing?.canvas && this.canvases.get(this.viewing.canvas)) return this.canvasState(this.viewing.canvas);
		const agent = asked ?? this.agents.looking();
		if (!agent) return this.deck.state();
		const seeded: Array<{ path: string; x: number; y: number }> = [];
		/*
		 * The canvas goes with the positions, and it is what the auto-layout is measured against: a
		 * board with no place of its own is put beside **the boards on this canvas**, not below every
		 * board this stage has ever been given a place for. The second is what the deck-wide layout
		 * did, and on a deck of 900 boards it is a column a million pixels tall with three boards
		 * visible anywhere in it.
		 */
		const state = this.deck.state(agent.positions(), (path, at) => seeded.push({ path, ...at }), agent.inPlay);
		for (const { path, x, y } of seeded) agent.setPosition(path, x, y);
		return state;
	}

	/**
	 * The deck as one canvas sees it: its boards, in the places that canvas has put them.
	 *
	 * The same two halves as `stageState` — the arrangement, and writing down any place that had
	 * to be worked out — with the canvas as the owner instead of a chat. A canvas that is gone
	 * is the deck's own layout rather than an error: a stale tab asking for one should draw
	 * something.
	 */
	canvasState(canvasId: string): DeckState {
		const canvas = this.canvases.get(canvasId);
		if (!canvas) return this.deck.state();
		const seeded: Array<{ path: string; x: number; y: number }> = [];
		const state = this.deck.state(this.canvases.places(canvas.id), (path, at) => seeded.push({ path, ...at }), this.canvases.boards(canvas.id));
		for (const { path, x, y } of seeded) this.canvases.place(canvas.id, path, x, y);
		return state;
	}

	/**
	 * What a board frame acts on: the canvas this browser opened, else the chat it is in.
	 *
	 * The canvas when there is one, because that is what the person is looking at and adding
	 * to — whoever they happen to be talking to. The agent otherwise, which is exactly what
	 * every board frame did before canvases.
	 */
	target(): StageTarget {
		const id = this.viewing?.canvas;
		if (id && this.canvases.get(id)) {
			return canvasStage({
				canvases: this.canvases,
				deck: this.deck,
				id,
				// Of this canvas or nothing: the reading may be a parked view of another room.
				camera: () => cameraFor(this.cameras.get(this.viewing?.focused ?? "") ?? this.lastCamera, id),
				changed: () => this.agents.canvasChanged(id),
			});
		}
		return this.agents.focused();
	}

	/**
	 * Every canvas as the browser needs it, with the agents on each.
	 *
	 * On, not working-on-now: an agent belongs to every canvas it has worked in
	 * (`session.canvasIds`), so one agent shows up in several rooms and a room keeps the
	 * faces of everybody who has done something there.
	 */
	canvasList(): Canvas[] {
		const working = new Map<string, string[]>();
		for (const agent of this.agents.all()) {
			for (const id of agent.canvasIds) {
				const on = working.get(id);
				if (on) on.push(agent.id);
				else working.set(id, [agent.id]);
			}
		}
		return this.canvases.list().map((canvas) => ({
			id: canvas.id,
			name: canvas.name,
			...(canvas.workspace ? { workspace: canvas.workspace } : {}),
			boards: [...canvas.boards],
			kept: this.canvases.kept(canvas.id).filter((path) => this.deck.board(path)),
			links: canvas.links.map((link) => ({ ...link })),
			groups: canvas.groups.map((group) => ({ name: group.name, boards: [...group.boards] })),
			changedAt: canvas.changedAt,
			...(canvas.openedAt === undefined ? {} : { openedAt: canvas.openedAt }),
			agents: working.get(canvas.id) ?? [],
		}));
	}

	publishCanvases(): void {
		this.send({ type: "canvases", canvases: this.canvasList() });
	}

	/**
	 * Every runtime, with everything about it that is not about a conversation: whether it
	 * can start here, its modes, its slash commands, and the models it last offered on this
	 * deck. The last three used to be copied onto every chat row.
	 */
	runtimes(): RuntimeInfo[] {
		return runtimeList((kind) => this.agents.knownModels(kind));
	}

	/**
	 * One board as the focused stage sees it — the same resolution `stageState` does, for the one caller
	 * that has the board already. A broadcast that carried the loader's copy instead would put the board
	 * at the origin for everybody, because the loader's boards have no place of their own any more.
	 */
	private placed(board: Board): Board {
		return this.stageState().boards.find((one) => one.path === board.path) ?? board;
	}

	send(message: ServerMessage): void {
		/*
		 * Every change to a board is announced through here, whoever made it, which makes it
		 * the one place to keep the board's picture up with it (`boards/thumbs.ts`).
		 */
		if (message.type === "board.changed") {
			if (message.removed) this.thumbs.forget(message.path);
			else if (message.board) this.thumbs.changed(message.board);
			/*
			 * And the canvases holding it are news until somebody opens them. The mark is about
			 * the board's *contents*, so it is set here — where every write to a board passes,
			 * whoever made it — and not where boards are moved.
			 */
			const marked = this.canvases.holding(message.path);
			for (const canvas of marked) this.canvases.changed(canvas.id);
			if (marked.length > 0) queueMicrotask(() => this.publishCanvases());
		}
		this.hub?.each((view) => this.forView(message, view));
	}

	/**
	 * A broadcast as one browser should see it.
	 *
	 * Three frames depend on which conversation is on screen: `agents` names it, and `deck.state` and
	 * `board.changed` carry that stage's arrangement. They are built for the registry's focus, which is
	 * whichever browser acted last, so a browser on another conversation gets them rebuilt for its own.
	 * A browser whose conversation was closed is moved to the registry's, which is the nearest row.
	 */
	private forView(message: ServerMessage, view: View): ServerMessage {
		/*
		 * A browser that has opened a canvas is sent that canvas's boards, whatever chat it is
		 * on. This is the whole of the decoupling on the wire: the canvas decides the boards,
		 * the chat decides the conversation, and one browser can change either on its own.
		 */
		if (view.canvas && this.canvases.get(view.canvas)) {
			if (message.type === "deck.state") return { ...message, deck: this.canvasState(view.canvas) };
			if (message.type === "canvases") return { ...message, focused: view.canvas };
			if (message.type === "board.changed" && message.board) {
				const placed = this.canvasState(view.canvas).boards.find((one) => one.path === message.path);
				if (placed) return { ...message, board: { ...message.board, x: placed.x, y: placed.y } };
			}
		}
		const shared = this.agents.looking();
		if (view === this.viewing) return message;
		const own = this.agents.get(view.focused);
		if (!own) {
			view.focused = shared?.id;
			return message;
		}
		if (own === shared) return message;
		switch (message.type) {
			case "agents":
				return { ...message, focused: own.id };
			case "deck.state":
				return { ...message, deck: this.stageState(own) };
			case "board.changed": {
				if (!message.board) return message;
				const placed = this.stageState(own).boards.find((one) => one.path === message.path);
				return placed ? { ...message, board: { ...message.board, x: placed.x, y: placed.y } } : message;
			}
			default:
				return message;
		}
	}

	dispose(): void {
		this.unwatch?.();
		this.unwatch = undefined;
		clearInterval(this.resyncTimer);
		this.resyncTimer = undefined;
		this.web.dispose();
		this.thumbs.dispose();
		this.agents.dispose();
	}
}
