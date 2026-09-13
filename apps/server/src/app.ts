import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Camera, ClientMessage, ServerMessage, StageCall } from "@decks/protocol";
import { Registry } from "./agents/registry.ts";
import { BoardService } from "./boards/service.ts";
import { runtimeList } from "./runtimes/registry.ts";
import { isBoardFormat, type BoardTemplate } from "./boards/templates.ts";
import { StageBridge } from "./stage/bridge.ts";
import { dispatch } from "./wire/index.ts";
import type { Reply } from "./wire/context.ts";
import { WebBridge } from "./web/bridge.ts";
import { StageService } from "./stage/service.ts";
import { ClaudeAccounts, DEFAULT_ACCOUNT } from "./runtimes/claude/accounts.ts";
import { claudeIdentity } from "./runtimes/claude/backend.ts";
import { mapSeries } from "./series.ts";
import { DECK_DIR, type Config } from "./config.ts";
import { describeSync, syncRuntimeLib } from "./deck/lib-sync.ts";
import { Deck } from "./deck/loader.ts";
import { watchDeck } from "./deck/watcher.ts";
import { Hub } from "./ws.ts";

/**
 * How often the deck re-reads its boards from disk regardless of what the watcher said.
 *
 * Slow enough that it is free (a walk and a `stat` per board), fast enough that a missed
 * event is a beat rather than a session.
 */
/** How long an account's identity is worth reusing before asking the CLI again. */
const IDENTITY_TTL_MS = 60_000;

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
	/** The board files: writing, revisioning, editing, deleting (`boards/service.ts`). */
	readonly boards: BoardService;
	/** The canvas tool's other end, for the runtimes that are not in this process. */
	readonly bridge = new StageBridge();
	/** The user's own Chrome, shared through the Decks extension (`web/bridge.ts`). */
	readonly web: WebBridge;
	private hub: Hub | undefined;
	private unwatch: (() => void) | undefined;
	/** The safety net under the watcher — see `watch()`. */
	private resyncTimer: NodeJS.Timeout | undefined;
	/**
	 * Where the browser last said it was looking.
	 *
	 * The camera belongs to the browser; the server keeps the last reading only so
	 * an agent can ask what the user can see. It is a reading, not a source of
	 * truth — nothing here ever moves it except at an agent's request.
	 */
	lastCamera: Camera = { x: 0, y: 0, zoom: 1 };
	/**
	 * And one per conversation, because the camera belongs to the conversation.
	 *
	 * The browser reports which agent's view it is reporting, so `stage.camera()` answers
	 * "where is my canvas looking" rather than "where is the user looking". An agent nobody
	 * has looked at yet falls back to the last reading, which is the only honest guess.
	 */
	readonly cameras = new Map<string, Camera>();
	/** Stage calls waiting for the browser to carry them out. */
	readonly pendingStage = new Map<string, { resolve: (value: unknown) => void; timer: NodeJS.Timeout }>();
	/** The Claude subscriptions this install can use, shared by every Claude agent. */
	readonly claudeAccounts: ClaudeAccounts;

	private constructor(
		readonly config: Config,
		deck: Deck,
	) {
		this.deck = deck;
		this.boards = new BoardService(deck, {
			send: (message) => this.send(message),
			edited: (path, summary) => this.agents.userEdited(path, summary),
			removed: (path) => this.agents.boardRemoved(path),
		});
		this.stage = new StageService(deck, {
			newBoard: ({ format, template, ...rest }) =>
				this.boards.newBoard({ ...rest, template: template as BoardTemplate, ...(isBoardFormat(format) ? { format } : {}) }),
			newMirror: (options) => this.boards.newMirror(options),
			writeBoard: (path, html) => this.boards.writeBoard(path, html),
			extent: (path, rev) => this.boards.extent(path, rev),
			awaitExtent: (path, rev, ms) => this.boards.awaitExtent(path, rev, ms),
			call: (call) => this.callStage(call),
			connected: () => (this.hub?.connections ?? 0) > 0,
			broadcast: (message) => this.send(message),
			camera: (agentId) => this.cameras.get(agentId) ?? this.lastCamera,
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
		this.agents = new Registry(
			deck,
			(message) => this.send(message),
			this.stage,
			{
				port: config.port,
				defaultKind: config.backend,
				camera: (agentId) => this.cameras.get(agentId) ?? this.lastCamera,
				recordRevision: (path) => this.boards.recordRevision(path),
				boardPathOf: (file) => this.boards.boardPathOf(file),
				accounts: this.claudeAccounts,
				accountsChanged: () => void this.publishAccounts(),
				bridge: this.bridge,
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
		// one. Before `attach()`, deliberately: the watcher is not running yet, so the
		// one restart that does rewrite files cannot also reload every board twice.
		if (existing) App.refreshLib(deck);
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

	/** Where the shipped primitives live, copied into every deck and refreshed on open. */
	static get runtimeLib(): string {
		return resolve(dirname(fileURLToPath(import.meta.url)), "../../../runtime/lib");
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
				// Our own `save()` coming back around. The browsers already know — they
				// asked for it — and re-reading the deck to tell them again is what made a
				// drag reload every board on screen.
				if (this.deck.isOwnWrite()) return;
				// A hand edit, then: the arrangement is whatever the file now says.
				this.deck.reload();
				this.send({ type: "deck.state", deck: this.deck.state() });
				return;
			}
			if (change.kind === "board") {
				const board = this.deck.refresh(change.path);
				// Whoever wrote it — the agent, an editor, a shell redirect — this is the
				// moment the new version exists, so this is where it is recorded.
				if (board) {
					try {
						this.boards.recordRevision(change.path);
					} catch {
						/* the file went away between the event and the read */
					}
				}
				// A board that is gone must leave every agent's context with it, or the
				// dead path silently empties the rail and the canvas (DeckAgent.forget).
				if (!board) {
					this.agents.boardRemoved(change.path);
					this.boards.forgetExtent(change.path);
				}
				this.send(
					board
						? { type: "board.changed", path: change.path, rev: board.rev, board }
						: { type: "board.changed", path: change.path, rev: 0, removed: true },
				);
				return;
			}
			// An asset under the deck moved. A board may be showing it, and the frame
			// has no way to know, so every board reloads — cheap, and rare.
			this.send({ type: "deck.state", deck: this.deck.state() });
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
			this.send({ type: "board.changed", path: board.path, rev: board.rev, board });
		}
		for (const path of removed) {
			// A dead path left in a context silently empties the rail and the canvas.
			this.agents.boardRemoved(path);
			this.boards.forgetExtent(path);
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
	handle(message: ClientMessage, reply: Reply): void {
		dispatch(message, reply, this);
	}

	greet(reply: (message: ServerMessage) => void): void {
		reply({ type: "deck.state", deck: this.deck.state() });
		/*
		 * And what this install can run.
		 *
		 * A property of the machine rather than of the deck, which is why it is a frame of
		 * its own: which runtimes exist, what to call them in a menu, and whether this
		 * machine can start them. The browser needs the last one to grey a row out — before
		 * this, the `+` menu offered all four everywhere, and the first prompt was where you
		 * found out that the binary was not installed.
		 */
		reply({ type: "runtimes", list: runtimeList() });
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
		this.stage.setDeck(this.deck);
		this.boards.setDeck(this.deck);
		// An agent's cwd is the deck, and a Pi session's cwd cannot move, so opening
		// another deck starts again rather than re-pointing what is running.
		void this.agents.reset(this.deck).then(() => {
			if (this.agents.restore() === 0) this.agents.create();
		/*
		 * After the rows are back: drop per-agent account links for agents this install no
		 * longer has. `remove` covers the ordinary close; this covers a chat pruned while the
		 * server was down, and a data directory carried between installs.
		 */
		this.claudeAccounts.sweepAgents(this.agents.all().map((agent) => agent.id));
		});
		this.watch();
		this.send({ type: "deck.state", deck: this.deck.state() });
		for (const warning of this.deck.warnings) this.send({ type: "notice", level: "warn", text: warning });
	}

	send(message: ServerMessage): void {
		this.hub?.broadcast(message);
	}

	dispose(): void {
		this.unwatch?.();
		this.unwatch = undefined;
		clearInterval(this.resyncTimer);
		this.resyncTimer = undefined;
		this.web.dispose();
		this.agents.dispose();
	}
}
