import { titleCanvas } from "./canvas/admin.ts";
import { runAtOpen } from "./migrations/index.ts";
import { closeOldShapes } from "./deck/old-shapes.ts";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runtimeLib } from "@decks/runtime";
import type { Page, DeckState, RuntimeInfo, ServerMessage } from "@decks/protocol";
import { Registry } from "./agents/registry.ts";
import { Acts } from "./agents/acts.ts";
import { CardService } from "./cards/service.ts";
import { AppTrust } from "./auth/app-trust.ts";
import { runtimeList } from "./runtimes/registry.ts";
import { CanvasBridge } from "./canvas/bridge.ts";
import { SettingsStore } from "./settings.ts";
import { WebBridge } from "./browser/bridge.ts";
import { SMALL_WIDTHS, PictureService } from "./pictures/service.ts";
import { codeRequired, PairCodes } from "./auth/issue.ts";
import { HARNESS_ID, passSecret, Passes } from "./auth/passes.ts";
import { boardOnCanvas } from "./calls/canvas-frame.ts";
import { TokenStore } from "./auth/tokens.ts";
import { studioLink } from "./studio/index.ts";
import { CanvasShots } from "./canvas/shots.ts";
import { CanvasService } from "./canvas/service.ts";
import { PageCalls } from "./canvas/page-calls.ts";
import { ClaudeAccounts } from "./runtimes/claude/accounts.ts";
import { AccountList } from "./runtimes/claude/account-list.ts";
import { DECK_DIR, type Config } from "./config.ts";
import { describeSync, syncRuntimeLib } from "./deck/lib-sync.ts";
import { Deck } from "./deck/loader.ts";
import { followDeck } from "./cards/follow.ts";
import { Cameras } from "./deck/cameras.ts";
import { Broadcast } from "./connections/broadcast.ts";
import type { DeckAgent } from "./agents/session.ts";
import { CanvasPens, type PenEntry } from "./canvas/pens.ts";
import { Forwards } from "./ports.ts";
import { Apps } from "./apps/service.ts";
import { checkApp } from "./apps/check.ts";
import { DocLibrary, DocService } from "@decks/docs/server";
import { compileTex } from "./docs/compile.ts";
import { gitSync } from "./docs/git.ts";
import { GoogleDocs } from "./google/docs.ts";
import { NativeShots } from "./canvas/native-shots.ts";
import { resolveDoc } from "./docs/resolve.ts";
import { documentsOnCanvas } from "./docs/on-canvas.ts";
import { canvasListMessage } from "./canvas/canvas-list.ts";
import { Writers } from "./docs/writers.ts";
import { canvasShowsApp, canvasShowsDocument } from "./calls/app-caller.ts";
import { deckImportPaths } from "./cards/cards.ts";

/**
 * The harness, put together: every part made and handed what it needs of the others, the deck
 * opened and followed, and the pages told what changed.
 *
 * It holds no logic of its own that a part could own. What an agent is lives in `agents/`, a canvas
 * in `stage/`, a call in `calls/`, the ways in under `connections/`; here they are wired, started
 * and stopped.
 */
export class App {
	deck: Deck;
	readonly agents: Registry;
	readonly stage: CanvasService;
	/** Every agent's stage drawing, as `.pen` files under `canvases/` (`canvas/pens.ts`). */
	readonly pens: CanvasPens;
	/** The ports agents have forwarded through this server (`ports.ts`). */
	readonly forwards: Forwards;
	/** The apps agents build in the deck's `apps/` (`apps/service.ts`). */
	readonly apps: Apps;
	/** What each agent is doing to which board, said to the browsers as it happens (`agents/acts.ts`). */
	readonly acts: Acts;
	/** The board files: writing, revisioning, editing, deleting (`boards/service.ts`). */
	readonly boards: CardService;
	/** Documents open as pages (`@decks/docs`), resolved by `docs/resolve.ts`. */
	readonly docs: DocService;
	/** Google Docs opened as document pages, kept in step through a markdown mirror (`google/docs.ts`). */
	readonly google: GoogleDocs;
	/** An agent's name as it says it, for crediting its edits; its id when it has said none. */
	agentName(agentId: string): string {
		return this.agents.get(agentId)?.who()?.name ?? agentId;
	}
	/** The deck's `docs/`, where each document's history and review are kept, made once per deck so each folder has one version store. */
	private library: DocLibrary | undefined;
	private docLibrary(): DocLibrary {
		const dir = join(this.deck.path, "docs");
		if (this.library?.dir !== dir) this.library = new DocLibrary(dir);
		return this.library;
	}
	/** Which agent's tool call explains a write to a file, for a document's change (`docs/writers.ts`). */
	private readonly writers = new Writers({
		name: (agentId) => this.agents.get(agentId)?.who()?.name,
		cwd: () => this.deck.path,
	});
	/** The deck's own settings. Built first: it sets the clock everything after it reads. */
	readonly settings: SettingsStore;
	/** Every token this harness has given out, and who each one is (`auth/tokens.ts`). */
	readonly tokens: TokenStore;
	/** The id of the token written for `decks login` on this machine (`auth/cli-token.ts`), once the server listens. */
	cliTokenId: string | undefined;
	/** The code `decks pair code` makes, for pairing and `decks login` (`auth/issue.ts`). */
	readonly codes: PairCodes;
	/** Canvas passes, signed and checked on every use (`auth/passes.ts`). */
	readonly passes: Passes;
	/** Which boards may run their own code, and the list the first question writes (`auth/app-trust.ts`). */
	readonly appTrust: AppTrust;
	/** Whether a card or board is placed on a canvas: a canvas pass reads it as one of that canvas's (`auth/guard.ts`). */
	/**
	 * The deck's import map, as the canvas frame is handed it (`/api/passes`): names to another site's addresses,
	 * or to paths under `assets/`, which the frame reads from beside its canvas's cards, where the deck's `assets/`
	 * is served (`connections/routes/card-path.ts`) on the pass it already has. Read when asked: it is small, and may change.
	 */
	deckImports(): Record<string, string> {
		const file = join(this.deck.path, "assets", "importmap.json");
		try {
			return existsSync(file) ? deckImportPaths(readFileSync(file, "utf8")) : {};
		} catch {
			return {};
		}
	}
	placedOn(path: string, canvas: string): boolean {
		// An app's picture (`apps/<name>`) is the canvas's to read when the app is placed on it.
		const app = /^apps\/([^/]+)$/.exec(path)?.[1];
		if (app && this.stage.pens) return canvasShowsApp(this.stage.pens, canvas, app);
		// A document's file is the canvas's to picture when a document item naming it is placed there (`connections/routes/pictures.ts`, `docPage`).
		if (/\.(?:md|markdown)$/i.test(path) && this.stage.pens && canvasShowsDocument(this.stage.pens, canvas, path)) return true;
		return boardOnCanvas(this, path, canvas);
	}
	/** The port this server is on, so a card's `decks.card.url()` answers like an agent's. */
	get port(): number {
		return this.config.port;
	}
	/** The canvas tool's other end, for the runtimes that are not in this process. */
	readonly bridge: CanvasBridge;
	/** The user's own Chrome, shared through the Decks extension (`browser/bridge.ts`). */
	readonly web: WebBridge;
	readonly thumbs: PictureService;
	/** Stage pictures drawn without a browser (`canvas/native-shots.ts`). */
	readonly nativeShots: NativeShots;
	private unwatch: (() => void) | undefined;
	/** Where each agent's stage is looking, as the browsers report it (`deck/cameras.ts`). */
	readonly cameras = new Cameras();
	/** What an agent asked the pages to do to a canvas, waiting on their answers (`canvas/page-calls.ts`). */
	/** What is said to the pages, and who is listening (`connections/broadcast.ts`). */
	readonly pages: Broadcast<DeckAgent> = new Broadcast<DeckAgent>({
		looking: () => this.agents.looking(),
		agent: (id) => this.agents.get(id),
		stateFor: (agent) => this.stageState(agent),
		// Every change to a card is announced through the broadcast, whoever made it, which makes it the one place to keep the card's picture up with it (`pictures/service.ts`).
		saying: (message) => {
			if (message.type !== "card.changed") return;
			if (message.removed) this.thumbs.forget(message.path);
			else if (message.card) this.thumbs.changed(message.card);
		},
	});

	/** Say something to every page. */
	send(message: ServerMessage): void {
		this.pages.send(message);
	}

	readonly pageCalls = new PageCalls({ send: (message) => this.send(message), screens: () => this.pages.screens });
	/** The Claude subscriptions this install can use, shared by every Claude agent. */
	readonly claudeAccounts: ClaudeAccounts;
	/** The subscriptions as the page is told of them: who each is, its five-hour window, who spends which (`runtimes/claude/account-list.ts`). */
	readonly accountList: AccountList;

	private constructor(
		readonly config: Config,
		deck: Deck,
	) {
		this.deck = deck;
		// Kept with the deck it was opened with: a deck opened later keeps the same callers.
		this.tokens = new TokenStore(join(deck.path, ".decks", "tokens.json"));
		this.codes = new PairCodes(this.tokens, { required: codeRequired() });
		this.passes = new Passes(
			{
				live: (id) => this.tokens.live(id),
				// The person's role on a canvas now: none for one that is not there (any more), view for one shared to view.
				role: (canvas) => {
					const pens = this.stage?.pens;
					if (!pens?.has(canvas)) return undefined;
					return pens.rights.sharing(canvas)?.role === "view" ? "view" : "edit";
				},
				appRun: (name) => this.apps?.runOf(name),
				// An app on a canvas runs in its frame only while it is placed there and the canvas is yours alone.
				appOnCanvas: (name, canvas) => {
					const pens = this.stage?.pens;
					return !!pens?.has(canvas) && pens.rights.yoursAlone(canvas) && canvasShowsApp(pens, canvas, name);
				},
				document: (path) => this.documentKey(path) === path,
			},
			passSecret(config.dataDir),
		);
		this.bridge = new CanvasBridge(this.tokens);
		this.appTrust = new AppTrust(config.dataDir);
		this.boards = new CardService(deck, {
			send: (message) => {
				this.send(message);
			},
			/*
			 * The arrangement, not the deck — `CardService` broadcasts a board on every write, and the
			 * loader's copy of one has no place of its own any more. It asks rather than is handed the
			 * positions so that the seeding `stageState` does happens on this path too.
			 */
			state: () => this.stageState(),
			removed: (path) => this.agents.boardRemoved(path),
		});
		this.stage = new CanvasService(deck, {
			/*

			 * Move a board on the stage being served, and answer with the board as that stage sees it.

			 * The deck has no arrangement to write to: a place belongs to an agent, so this writes on the

			 * focused one, which is the stage the sandbox is running as.

			 */

			place: (agentId: string, path: string, x: number, y: number) => {

				const agent = this.agents.get(agentId) ?? this.agents.focused();

				agent.seat.setPosition(path, x, y);

				return this.stageState(agent).boards.find((board) => board.path === path);

			},

			/*
			 * `decks.canvas.read()` reads the arrangement **of the agent that asked** — the same stage
			 * `decks.canvas.move` writes to. Served from the conversation on screen instead, an agent
			 * working while the person read another chat moved a board and read back the place it
			 * had before, with the move itself correct on disk.
			 *
			 * No id is an app running its own code, which acts for a conversation on a canvas
			 * showing it (`calls/app-caller.ts`), so that case keeps the old answer.
			 */
			boards: (agentId?: string) => this.stageState(agentId ? this.agents.get(agentId) : undefined).boards,

			writeBoard: (path, html) => this.boards.writeBoard(path, html),
			deleteBoard: (path) => {
				let refused: string | undefined;
				this.boards.deleteBoard(path, (message) => {
					if (message.type === "harness.notice") refused = message.text;
				});
				return refused;
			},
			extent: (path, rev, at) => this.boards.extent(path, rev, at),
			awaitExtent: (path, rev, ms, at) => this.boards.awaitExtent(path, rev, ms, at),
			reading: (path, rev) => this.boards.reading(path, rev),
			views: async (path) => {
				const board = this.deck.board(path);
				return board ? this.thumbs.views(board) : undefined;
			},
			measureAway: async (path, w) => {
				const board = this.deck.board(path);
				return board && this.stage.shots ? this.stage.shots.measure(w === undefined ? board : { ...board, w }) : undefined;
			},
			call: (call, timeoutMs) => this.pageCalls.ask(call, timeoutMs),
			callAll: (call, timeoutMs) => this.pageCalls.askAll(call, timeoutMs),
			// A tab on the socket, or a canvas frame following its canvas's stream (`/api/v1/events`).
			connected: () => this.pages.connected,
			broadcast: (message) => this.send(message),
			stagesChanged: () => this.publishStages(),
			wrote: (path, who) => this.boards.wrote(path, who),
			retitle: (name, title) => titleCanvas({ deck: this.deck, pens: this.pens, agents: this.agents.all() }, name, title),
			camera: (agentId) => this.cameras.answer(agentId, this.agents.get(agentId)?.seat.stageName()),
			agents: () => this.agents.summaries(),
		});
		/*
		 * The stage drawings. A change — through the tool or by hand — goes to every browser, keyed by
		 * the agents whose stage it is, since two chats never share a folder but the browser draws per chat.
		 */
		this.pens = new CanvasPens(deck.path, (name, entry) => this.publishPen(name, entry));
		// A canvas's copy of a board from elsewhere is a board of the deck the moment it is made.
		this.pens.cards.copied = (path) => this.boards?.appeared(path);
		this.stage.pens = this.pens;
		this.forwards = new Forwards(deck.path, config.port);
		this.stage.forwards = this.forwards;
		this.apps = new Apps(deck.path);
		this.apps.decksPort = config.port;
		this.apps.passes = this.passes;
		// A canvas frame showing the app hears its state change (`calls/canvas-frame.ts`, `onCanvas`), instead of asking every ten seconds.
		this.apps.onChange = (name, state) => this.pages.tellStreams({ type: "app.changed", name, ...(state.title ? { title: state.title } : {}), status: state.status });
		this.stage.apps = this.apps;
		this.pens.watch();
		// Read through the deck each time, so a deck switch needs nothing but `closeAll`.
		this.docs = new DocService({
			resolve: (path) => resolveDoc(this.deck.roots, path),
			versions: this.boards.revisions,
			send: (message) => this.send(message),
			writer: (file) => this.google.writer(file) ?? this.writers.who(file),
			remote: (file) => this.google.remote(file),
			opened: (file) => this.google.opened(file),
			style: (file, requests, text) => this.google.style(file, requests, text),
			comment: (file, message) => this.google.comment(file, message),
			// A document is edited where it is, in its repository or folder; its history, review and PDF are kept in the deck's docs/.
			library: () => this.docLibrary(),
			// LaTeX pages typeset to a PDF beside the page (`docs/compile.ts`).
			compile: compileTex,
			// A document in a git repository pulls and pushes it, to stay in step with Overleaf (`docs/git.ts`).
			git: gitSync,
		});
		this.google = new GoogleDocs({ dataDir: config.dataDir, library: () => this.docLibrary(), docs: this.docs, send: (message) => this.send(message) });
		this.google.start();
		/*
		 * The Claude subscriptions this install can use (`claude/accounts.ts`).
		 *
		 * On the install's data directory rather than the deck: an account is a property of
		 * the machine, like the credentials it stands for. Swept on open, so a login that was
		 * abandoned halfway leaves no directory behind.
		 */
		this.claudeAccounts = new ClaudeAccounts(config.dataDir);
		this.claudeAccounts.sweep();
		this.accountList = new AccountList({
			accounts: this.claudeAccounts,
			spending: () => Object.fromEntries(this.agents.all().flatMap((agent) => (agent.conversation.accountId() ? [[agent.id, agent.conversation.accountId()!]] : []))),
			send: (message) => this.send(message),
		});
		/*
		 * The shared browser, on the install like the accounts are: the pairing code is a
		 * property of this server, not of a deck. Every change is broadcast, so the settings'
		 * Your Chrome and the extension's popup say the same thing at the same time.
		 */
		this.web = new WebBridge(config.dataDir, (status) => this.send({ type: "web.changed", status }));
		this.stage.web = this.web;
		/*
		 * Board pictures, taken by this server of itself. `127.0.0.1` whatever
		 * the host is: `0.0.0.0` is somewhere to listen, not somewhere to go.
		 */
		this.thumbs = new PictureService({
			origin: () => `http://${config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host}:${config.port}`,
			dir: join(deck.path, ".decks", "thumbs"),
			boards: () => this.deck.boards,
			apps: () => this.apps.list().map((one) => one.name),
			placed: () => new Set(this.pens.names().flatMap((name) => this.pens.cards.boards(name).map((one) => one.path))),
			// Its own reads of the harness, on a pass it makes for no canvas (`auth/guard.ts`, `harnessReads`).
			reader: () => this.passes.canvas("", "view", HARNESS_ID).pass,
			extraOrigins: () => (process.env.DECKS_WEB_PORT ? [`http://127.0.0.1:${process.env.DECKS_WEB_PORT}`] : []),
			// The web app's `measure.html`, which draws a card for its picture as the canvas frame draws it: Vite's in development.
			webOrigin: () => (process.env.DECKS_WEB_PORT ? `http://127.0.0.1:${process.env.DECKS_WEB_PORT}` : `http://${config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host}:${config.port}`),
		});
		this.thumbs.indexLater();
		this.thumbs.cleanDaily();
		/*
		 * Pictures of a stage (`canvas/shots.ts`), in the same Chromium as the card pictures. The page
		 * it loads, `shot.html`, is part of the web app: served by this server in production, and by
		 * Vite in development, whose port the dev scripts put in `DECKS_WEB_PORT`.
		 */
		const apiOrigin = () => `http://${config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host}:${config.port}`;
		/*
		 * Stage pictures are drawn natively over each card's picture of its current revision: the
		 * ladder's rung (`SMALL_WIDTHS`) when the card is drawn no wider, the whole picture otherwise. A
		 * card with none sends the shot to the browser, and is pictured in the background for the next one.
		 */
		this.nativeShots = new NativeShots({
			cardPicture: (path, scheme, px) => {
				const board = deck.board(path);
				if (!board) return { why: `there is no card ${path}` };
				const size = SMALL_WIDTHS.find((width) => px <= width) ?? "whole";
				for (const want of size === "whole" ? (["whole"] as const) : [size, "whole" as const]) {
					const found = this.thumbs.nearest(board, scheme, want);
					if (found?.exact) return { file: found.file };
				}
				void this.thumbs.picture(board, scheme, size, () => false, true).catch(() => {});
				return { why: `the card ${path} has no picture of its current revision yet (one is being taken)` };
			},
		});
		this.stage.shots = new CanvasShots({
			deck: deck.path,
			pens: this.pens,
			webOrigin: () => (process.env.DECKS_WEB_PORT ? `http://127.0.0.1:${process.env.DECKS_WEB_PORT}` : apiOrigin()),
			pass: (canvas) => this.passes.canvas(canvas, "view", HARNESS_ID).pass,
			borrow: (use) => this.thumbs.borrow(use),
			...(process.env.DECKS_NATIVE_SHOTS === "0" ? {} : { native: this.nativeShots }),
			writer: (stage) => {
				const id = this.pens.log.writerOf(stage);
				return id ? this.agents.get(id)?.who() : undefined;
			},
		});
		this.stage.appCheck = (name) => checkApp({ borrow: (use) => this.thumbs.borrow(use), origin: apiOrigin(), deckPath: this.deck.path, name });
		this.stage.boardPicture = async (path, scheme) => {
			const board = deck.board(path);
			if (!board) throw new Error(`There is no board ${path}.`);
			return readFileSync(await this.thumbs.get(board, scheme, () => false));
		};
		this.stage.pairCode = () => {
			const made = this.codes.newCode();
			this.send(this.pairingMessage());
			return made;
		};
		this.settings = new SettingsStore(deck.path, (text) => this.send({ type: "harness.notice", level: "warn", text }));
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
				act: (agentId, act) => {
					if (act.kind === "tool") this.writers.tool(agentId, act.event);
					this.acts.act(agentId, act);
				},
				defaultKind: config.backend,
				camera: (agentId) => this.cameras.answer(agentId, this.agents.get(agentId)?.seat.stageName()),
				/*
				 * A board joining a canvas was given a place (`agents/session.ts`). The browsers draw a
				 * board where the deck state says it is, so the state goes out here — before the
				 * `context.changed` that says the board is on the canvas, which is the order the two
				 * arrive in.
				 */
				arranged: () => this.send({ type: "deck.changed", deck: this.stageState() }),
				publishRuntimes: () => this.send({ type: "harness.runtimes", list: this.runtimes() }),
				recordRevision: (path) => this.boards.recordRevision(path),
				wrote: (path, who) => this.boards.wrote(path, who),
				boardPathOf: (file) => this.boards.boardPathOf(file),
				accounts: this.claudeAccounts,
				accountsChanged: () => void this.accountList.publish(),
				bridge: this.bridge,
			},
		);
	}

	/**
	 * Open the deck in the data directory, creating it the first time.
	 *
	 * A data directory that does not exist yet is not an error — it is somebody starting.
	 * The new deck is deliberately **empty** apart from the primitives: the first thing
	 * you see is your own canvas, and the checks' deck in `e2e/fixture/` is a thing you opt into by
	 * pointing at it.
	 */
	static open(config: Config): App {
		// A deck kept in an older shape is moved to this one before anything reads it (`migrations/`).
		for (const line of runAtOpen(config.deck, { dataDir: config.dataDir })) console.log(`[decks] ${line}`);
		const existing = existsSync(join(config.deck, "deck.json")) || existsSync(join(config.deck, "boards"));
		const deck = existing ? Deck.open(config.deck) : Deck.create(config.deck, App.runtimeLib);
		// A deck this build did not create has whichever `lib/` created it, so every
		// start brings the primitives forward. `Deck.create` has just done it for a new
		// one. Before `attach()`, deliberately: the watcher is not running yet, so the one
		// restart that does rewrite files cannot also reload every board twice.
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
		return runtimeLib();
	}

	attach(): void {
		this.follow();
		/*
		 * The deck's own chat list first, then one agent only if it had none.
		 *
		 * Restored chats start nothing, so this is a directory read rather than fifteen
		 * runtimes. Starting a *new* agent is asynchronous and may fail (no credentials, most
		 * often), and that failure belongs in its own transcript rather than in the way of the
		 * deck.
		 */
		if (this.agents.restore() === 0) this.agents.create();
		// The turns the last stop cut go on by themselves (`agents/working.ts`).
		this.agents.resumeInterrupted();
		/*
		 * After the rows are back: drop per-agent account links for agents this install no
		 * longer has. `remove` covers the ordinary close; this covers a chat pruned while the
		 * server was down, and a data directory carried between installs.
		 */
		this.claudeAccounts.sweepAgents(this.agents.all().map((agent) => agent.id));
	}

	/** Follow the open deck's files (`cards/follow.ts`), and start reading the accounts' limits. */
	private follow(): void {
		this.unwatch?.();
		this.unwatch = followDeck({
			deck: () => this.deck,
			boards: this.boards,
			send: (message) => this.send(message),
			state: () => this.stageState(),
			placed: (card) => this.placed(card),
			landed: (path) => this.acts.landed(path, this.stage.read(path)),
			gone: (path) => this.agents.boardRemoved(path),
		});
		this.accountList.startLimits();
	}

	/** The code on show and every front end holding a token, for Settings. */
	pairingMessage(): ServerMessage {
		// The code itself never goes to a browser: it is made and shown only by decks pair code.
		const studio = studioLink(this.deck.path);
		return { type: "harness.paired", paired: this.tokens.paired(), ...(studio ? { studio } : {}) };
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
		// A deck kept in an older shape is moved to this one before anything reads it, as at start-up (`migrations/`).
		for (const line of runAtOpen(deckPath, { dataDir: path })) console.log(`[decks] ${line}`);
		const existing = existsSync(join(deckPath, "deck.json")) || existsSync(join(deckPath, "boards"));
		this.deck = existing ? Deck.open(deckPath) : Deck.create(deckPath, App.runtimeLib);
		if (existing) App.refreshLib(this.deck);
		this.stage.setDeck(this.deck);
		this.pens.setDeck(this.deck.path);
		this.forwards.setDeck(this.deck.path);
		this.apps.setDeck(this.deck.path);
		this.boards.setDeck(this.deck);
		this.docs.closeAll();
		this.settings.setDeck(this.deck.path);
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
		this.follow();
		this.send({ type: "deck.changed", deck: this.stageState() });
		for (const warning of this.deck.warnings) this.send({ type: "harness.notice", level: "warn", text: warning });
	}

	/**
	 * The deck as the conversation on screen sees it (`Seat.deckState`), or as one agent does.
	 *
	 * **Every outbound card list goes through this**, because `Deck.state()` on its own is the
	 * auto-layout and not the arrangement the conversation is looking at. **It never creates an
	 * agent**: `Registry.focused()` makes one on demand, which is right for a prompt and wrong here,
	 * since this is called from broadcast paths and a `card.changed` must not start a runtime as a side
	 * effect of being sent. No agent means the deck's own layout, which is what a deck with nobody
	 * looking at it has anyway.
	 */
	stageState(asked?: DeckAgent): DeckState {
		return (asked ?? this.agents.looking())?.seat.deckState() ?? this.deck.state();
	}

	/** What a board frame acts on: the stage of the conversation this browser is in. */
	target(): DeckAgent {
		return this.agents.focused();
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
	private placed(board: Page): Page {
		return this.stageState().boards.find((one) => one.path === board.path) ?? board;
	}

	/** Apps the person let call verbs with "Allow once": remembered until the server restarts (`calls/caller.ts`). */
	readonly appsAllowedOnce = new Set<string>();

	/** The files a canvas's document items name, as the document service keys them (`docs/on-canvas.ts`). */
	documentsOn(canvas: string): Map<string, string> {
		return documentsOnCanvas(this.pens, this.deck, canvas);
	}

	/**
	 * The name a document is kept under (`docs/resolve.ts`), for a file a document may be and that is
	 * there: in the deck or a root it declares, never the app's own records. What a document pass names.
	 */
	documentKey(path: string): string | undefined {
		try {
			const found = resolveDoc(this.deck.roots, path);
			return statSync(found.file).isFile() ? found.key : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * A canvas's drawing changed: every agent on that canvas takes its cards from it, and whoever
	 * hears the canvas is told once (`canvas.changed`).
	 */
	private publishPen(name: string, entry: PenEntry): void {
		const on = (this.agents?.all() ?? []).filter((agent) => agent.seat.stageName() === name);
		for (const agent of on) agent.seat.penChanged();
		// What changed, not the whole drawing: a client that missed a revision asks for it whole.
		this.send(this.pens.log.changes(name));
		// The manager lists what each stage holds, and this is the moment that changed.
		this.publishStages();
	}

	/** Every canvas and who is on it, for the pages' list (`canvas/canvas-list.ts`). */
	stagesMessage(): ServerMessage {
		return canvasListMessage(this.pens, this.agents?.all() ?? []);
	}

	publishStages(): void {
		this.send(this.stagesMessage());
	}

	dispose(): void {
		// A run that read a deck's old shapes has restored and written back every record by now (`deck/old-shapes.ts`).
		closeOldShapes(this.deck.path);
		this.unwatch?.();
		this.unwatch = undefined;
		this.accountList.dispose();
		this.web.dispose();
		this.thumbs.dispose();
		this.nativeShots.stop();
		this.apps.dispose();
		this.pens.close();
		this.agents.dispose();
	}
}
