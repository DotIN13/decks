import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BoardPatch, Camera, ClientMessage, ServerMessage, StageCall } from "@decks/protocol";
import { Registry } from "./agents/registry.ts";
import { applyPatches, mintId, PatchRefused } from "./boards/patch.ts";
import { Revisions } from "./boards/snapshots.ts";
import { isBoardKind, renderTemplate, slugFor, type BoardKind } from "./boards/templates.ts";
import { StageService } from "./stage/service.ts";
import { ClaudeAccounts, DEFAULT_ACCOUNT } from "./claude/accounts.ts";
import { claudeIdentity } from "./claude/backend.ts";
import { DECK_DIR, type Config } from "./config.ts";
import { describeSync, syncRuntimeLib } from "./deck/lib-sync.ts";
import { Deck } from "./deck/loader.ts";
import { watchDeck } from "./deck/watcher.ts";
import { Hub } from "./ws.ts";

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
	readonly revisions: Revisions;
	private hub: Hub | undefined;
	private unwatch: (() => void) | undefined;
	/**
	 * Where the browser last said it was looking.
	 *
	 * The camera belongs to the browser; the server keeps the last reading only so
	 * an agent can ask what the user can see. It is a reading, not a source of
	 * truth — nothing here ever moves it except at an agent's request.
	 */
	private lastCamera: Camera = { x: 0, y: 0, zoom: 1 };
	/** Stage calls waiting for the browser to carry them out. */
	private readonly pendingStage = new Map<string, { resolve: (value: unknown) => void; timer: NodeJS.Timeout }>();
	/** The Claude subscriptions this install can use, shared by every Claude agent. */
	private readonly claudeAccounts: ClaudeAccounts;

	private constructor(
		readonly config: Config,
		deck: Deck,
	) {
		this.deck = deck;
		this.revisions = new Revisions(deck);
		this.stage = new StageService(deck, {
			newBoard: (options) => this.newBoard({ ...options, kind: options.kind as BoardKind }),
			call: (call) => this.callStage(call),
			connected: () => (this.hub?.connections ?? 0) > 0,
			broadcast: (message) => this.send(message),
			camera: () => this.lastCamera,
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
		this.agents = new Registry(
			deck,
			(message) => this.send(message),
			this.stage,
			{
				port: config.port,
				defaultKind: config.backend,
				camera: () => this.lastCamera,
				recordRevision: (path) => this.recordRevision(path),
				boardPathOf: (file) => this.boardPathOf(file),
				accounts: this.claudeAccounts,
				accountsChanged: () => void this.publishAccounts(),
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
	private async publishAccounts(reply?: (message: ServerMessage) => void): Promise<void> {
		const stored = this.claudeAccounts.list();
		const active = this.claudeAccounts.activeId();
		const accounts = await Promise.all(
			stored.map(async (account) => {
				const isDefault = account.id === DEFAULT_ACCOUNT;
				const identity = await claudeIdentity(isDefault ? undefined : this.claudeAccounts.configDir(account.id));
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
					...(account.limitedUntil ? { limitedUntil: account.limitedUntil } : {}),
					...(account.limitType ? { limitType: account.limitType } : {}),
				};
			}),
		);
		// Recorded so a row keeps its name when the CLI is next slow to answer.
		const mine = accounts.find((account) => account.isDefault);
		if (mine?.signedIn) {
			this.claudeAccounts.describeDefault({
				...(mine.email ? { email: mine.email } : {}),
				...(mine.orgName ? { orgName: mine.orgName } : {}),
				...(mine.plan ? { plan: mine.plan } : {}),
			});
		}
		const frame: ServerMessage = { type: "claude.accounts", accounts, active };
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
	}

	private watch(): void {
		this.unwatch?.();
		this.unwatch = watchDeck(this.deck.path, (change) => {
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
						this.revisions.record(change.path, readFileSync(this.deck.fileOf(change.path), "utf8"));
					} catch {
						/* the file went away between the event and the read */
					}
				}
				// A board that is gone must leave every agent's context with it, or the
				// dead path silently empties the rail and the canvas (DeckAgent.forget).
				if (!board) this.agents.boardRemoved(change.path);
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
	}

	handle(message: ClientMessage, reply: (message: ServerMessage) => void): void {
		switch (message.type) {
			case "deck.open": {
				this.openDeck(message.path);
				return;
			}
			case "board.move": {
				const board = this.deck.setPosition(message.path, message.x, message.y);
				if (!board) {
					reply({ type: "error", text: `No such board: ${message.path}` });
					return;
				}
				// Broadcast rather than reply: a second tab is looking at the same
				// stage and the board has moved there too.
				this.send({ type: "board.changed", path: board.path, rev: board.rev, board });
				return;
			}
			case "camera.set":
				// Recorded, not acted on: the camera is the browser's, and this is the
				// reading an agent gets when it asks what the user can see.
				this.lastCamera = message.camera;
				return;

			case "stage.result": {
				const pending = this.pendingStage.get(message.result.id);
				if (!pending) return;
				this.pendingStage.delete(message.result.id);
				clearTimeout(pending.timer);
				pending.resolve(message.result.error ? { error: message.result.error } : (message.result.value ?? null));
				return;
			}

			case "board.patch": {
				this.patch(message.path, message.rev, message.patches, reply);
				return;
			}

			case "board.undo": {
				this.undo(message.path, reply);
				return;
			}

			/*
			 * The user's half of the canvas. Playing a board is how the rail works as a
			 * control; hiding takes it off the canvas and deliberately does *not* detach —
			 * the context is the agent's, and nobody should be able to strip what it is
			 * working from by tidying the view.
			 */
			case "board.play": {
				const agent = this.agents.focused();
				agent.setInPlay([...agent.inPlay, message.path]);
				return;
			}

			case "board.hide": {
				const agent = this.agents.focused();
				agent.setInPlay(agent.inPlay.filter((path) => path !== message.path));
				return;
			}

			/*
			 * A new board, and it goes straight onto the canvas.
			 *
			 * Created *and* played, because the two are one act: nobody asks for a board in
			 * order to leave it in the deck. Attached too — `setInPlay` puts it in the focused
			 * agent's context — so the agent you are talking to can see the thing you just
			 * made without being told about it.
			 *
			 * An unknown `kind` becomes `blank` rather than an error. This arrives from a
			 * button today, and the worst outcome of a bad template name should be an empty
			 * board rather than a refusal.
			 */
			case "board.create": {
				const kind = isBoardKind(message.kind) ? message.kind : "blank";
				const path = this.newBoard({ title: "Untitled", kind });
				const agent = this.agents.focused();
				agent.setInPlay([...agent.inPlay, path]);
				return;
			}

			case "board.delete": {
				this.deleteBoard(message.path, reply);
				return;
			}

			case "agent.create": {
				const agent = this.agents.create({
					...(message.parentId ? { parentId: message.parentId } : {}),
					...(message.kind ? { kind: message.kind } : {}),
				});
				/*
				 * Asked for by a person, so it is what they want to talk to. A subagent is
				 * created through `Registry.spawn` instead and deliberately does not take
				 * the focus — its parent is mid-turn and still has something to say.
				 */
				this.agents.focus(agent.id);
				return;
			}

			case "agent.focus": {
				this.agents.focus(message.id);
				return;
			}

			case "agent.remove": {
				const outcome = this.agents.remove(message.id);
				if (!outcome.removed && outcome.reason) reply({ type: "notice", level: "warn", text: outcome.reason });
				return;
			}

			/*
			 * Your own tags on an agent, from the customise popup.
			 *
			 * Silent when the agent is gone: the popup is opened from a row, and a row can be
			 * removed by another tab between the open and the save. There is nothing useful to
			 * say about it — the list the popup was editing no longer exists.
			 */
			case "agent.tags": {
				this.agents.get(message.id)?.setUserTags(message.tags);
				return;
			}

			case "agent.prompt": {
				const agent = this.agents.get(message.id) ?? this.agents.focused();
				// Deliberately not awaited: a prompt runs for minutes and the socket has
				// other frames to handle meanwhile. Everything it produces arrives as
				// events, and `publish()` refreshes the chat list once it settles.
				void agent.prompt(message.text).then(() => this.agents.publish());
				this.agents.publish();
				return;
			}

			case "agent.abort": {
				void this.agents.get(message.id)?.abort();
				return;
			}

			case "agent.setModel": {
				const agent = this.agents.get(message.id);
				if (!agent) return;
				void agent
					.setModel(message.provider, message.model, message.thinking)
					.catch((error: unknown) => reply({ type: "error", text: (error as Error).message }));
				return;
			}

			case "agent.thinking": {
				this.agents.get(message.id)?.setThinking(message.thinking);
				return;
			}

			/*
			 * The usage panel, read on demand.
			 *
			 * Replied to rather than broadcast: a second tab did not open this panel and has
			 * no use for figures it did not ask for. The `/cost` path is the other way round
			 * and broadcasts — see `pushReport` — because there the *agent* asked.
			 */
			case "agent.report": {
				const agent = this.agents.get(message.id);
				if (!agent) {
					reply({ type: "agent.report", id: message.id, error: "That agent is gone." });
					return;
				}
				void agent
					.report()
					.then((report) => reply({ type: "agent.report", id: message.id, report }))
					.catch((error: unknown) => reply({ type: "agent.report", id: message.id, error: (error as Error).message }));
				return;
			}

			case "agent.setMode": {
				const agent = this.agents.get(message.id);
				if (!agent) return;
				void agent
					.setMode(message.mode)
					.then(() => this.agents.publish())
					.catch((error: unknown) => {
						reply({ type: "notice", level: "warn", text: `Could not change mode: ${(error as Error).message}` });
					});
				return;
			}

			case "rewind.preview": {
				const agent = this.agents.get(message.id);
				if (!agent) return;
				// A preview is a read. Nothing is written, and the browser renders those
				// revisions read-only.
				reply({
					type: "timeline.preview",
					agentId: message.id,
					entryId: message.entryId,
					boards: message.entryId ? this.boardsAt(agent, message.entryId) : {},
				});
				return;
			}

			case "rewind.to": {
				const agent = this.agents.get(message.id);
				if (!agent) return;
				void agent.rewindTo(message.entryId).then((result) => {
					this.agents.publish();
					if (result.cancelled) {
						reply({ type: "notice", level: "info", text: "Rewind cancelled." });
						return;
					}
					/*
					 * The rewound message goes back in the composer, which is what the deck has
					 * been passing `editorText` around for since rewinding existed — and where it
					 * never actually went. It was announced instead, so the notice carried the
					 * whole message: a paragraph in a toast, saying a thing the transcript above
					 * it already said, and the one place it would have been useful — the input
					 * bar, ready to be said differently — was empty.
					 */
					reply({ type: "notice", level: "info", text: "Rewound." });
					if (result.editorText) reply({ type: "composer.draft", text: result.editorText });
				});
				return;
			}

			case "fork.from": {
				const agent = this.agents.get(message.id);
				if (!agent) return;
				// Async now: Claude's handle comes from copying a session file, which Pi
				// can do from memory.
				void agent.forkFrom(message.entryId).then((resumeRef) => {
					if (!resumeRef) {
						reply({ type: "notice", level: "warn", text: "There is nothing before that message to fork from." });
						return;
					}
					const at = agent.entryTime(message.entryId);
					// A fork is a new chat that remembers everything up to that point —
					// including what was on the canvas then, so it does not open blank.
					const child = this.agents.create({
						name: `${agent.chat().name} (fork)`,
						resumeRef,
						kind: agent.kind,
						...(at ? { forkedFrom: { agentId: agent.id, at } } : {}),
						// And the model it was being held in. A fork continues one
						// conversation; answering the rest of it from a different model is a
						// change nobody asked for, and on Claude there is no session file to
						// recover the choice from.
						...(agent.model ? { model: agent.model } : {}),
						...(agent.mode ? { mode: agent.mode } : {}),
					});
					this.agents.focus(child.id);
				});
				return;
			}

			case "boards.restore": {
				/*
				 * The one place a preview turns into a write, and it takes a click of its
				 * own to get here. Restoring is a new revision rather than a rewind of the
				 * store: going back is a thing that happened, and undoing the restore has
				 * to be possible too.
				 */
				const agent = this.agents.get(message.id);
				if (!agent) return;
				const wanted = this.boardsAt(agent, message.entryId);
				let restored = 0;
				for (const [path, sha] of Object.entries(wanted)) {
					try {
						const content = this.revisions.read(sha);
						if (content === readFileSync(this.deck.fileOf(path), "utf8")) continue;
						writeFileSync(this.deck.fileOf(path), content);
						this.revisions.record(path, content);
						restored++;
					} catch (error) {
						reply({ type: "notice", level: "warn", text: `Could not restore ${path}: ${(error as Error).message}` });
					}
				}
				reply({
					type: "notice",
					level: "info",
					text: restored === 0 ? "Those boards are already as they were." : `Restored ${restored} board${restored === 1 ? "" : "s"}.`,
				});
				return;
			}

			case "extension.ui.answer": {
				// The answer carries no agent id — a dialog id is unique across them —
				// so it goes to every agent and the one holding that question takes it.
				for (const agent of this.agents.all()) agent.answerDialog(message.answer);
				return;
			}

			case "claude.accounts":
				void this.publishAccounts(reply);
				return;

			case "claude.accounts.add": {
				/*
				 * The login runs on an *agent*, because it is the agent's dialog bridge that
				 * asks for the code — the flow needs somewhere to put a modal and somewhere to
				 * report to, and the conversation is both.
				 *
				 * A Claude agent, specifically: a pi agent has no Claude login to run. Focused
				 * first, since that is the conversation the person is looking at.
				 */
				const claude = [this.agents.focused(), ...this.agents.all()].find((agent) => agent.kind === "claude");
				if (!claude) {
					reply({ type: "notice", level: "warn", text: "Start a Claude agent first — signing in runs through one." });
					return;
				}
				void claude.prompt("/login");
				return;
			}

			case "claude.accounts.use": {
				const moved = this.claudeAccounts.use(message.id);
				if (!moved) {
					reply({ type: "notice", level: "warn", text: "That account is not on the list any more." });
					return;
				}
				// The switch is the symlink; every running session reads through it, so there is
				// nothing to restart.
				this.send({ type: "notice", level: "info", text: `Now using ${moved.email ?? "that account"}.` });
				void this.publishAccounts();
				return;
			}

			case "claude.accounts.forget": {
				this.claudeAccounts.forget(message.id);
				void this.publishAccounts();
				return;
			}

			default:
				reply({ type: "notice", level: "warn", text: `Not implemented yet: ${message.type}` });
		}
	}

	/**
	 * Which revision each board was at, at a point in a conversation.
	 *
	 * The session's `board-rev` entries answer this for boards the conversation has
	 * touched. For the rest, the store answers by time: the newest version that
	 * already existed when that message was sent. A board created later resolves to
	 * its first version rather than "did not exist" — a real past state, and closer to
	 * the truth than showing today's file.
	 *
	 * One implementation, because the preview and the restore have to agree. They did
	 * not, when this lived in two places: hovering showed the past and restoring said
	 * there was nothing to do.
	 */
	private boardsAt(
		agent: { revisionsAt(entryId: string): Record<string, string>; timeline(): Array<{ id: string; at?: number }> },
		entryId: string,
	): Record<string, string> {
		const recorded = agent.revisionsAt(entryId);
		const when = agent.timeline().find((entry) => entry.id === entryId)?.at ?? Date.now();
		const at: Record<string, string> = {};
		for (const board of this.deck.boards) {
			const sha = recorded[board.path] ?? this.revisions.at(board.path, when);
			if (sha) at[board.path] = sha;
		}
		return at;
	}

	/**
	 * Write a new board from a template, and return its deck-relative path (§2).
	 *
	 * Here rather than in the stage service because this is where board writes and their
	 * revisions live — a new board is a first revision like any other. The name is minted
	 * from the title and made unique by suffixing, so an agent answering three questions
	 * about the same thing gets `-2` and `-3` rather than an error.
	 */
	newBoard(options: { title: string; kind: BoardKind; size?: { w?: number; h?: number } }): string {
		const base = slugFor(options.title, options.kind);
		let path = `boards/${base}.html`;
		for (let suffix = 2; existsSync(join(this.deck.path, path)); suffix++) {
			path = `boards/${base}-${suffix}.html`;
			if (suffix > 200) throw new Error(`Too many boards called ${base}`);
		}

		const file = this.deck.fileOf(path);
		const html = renderTemplate(options.kind, options.title, options.size);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, html);
		this.revisions.record(path, html);

		// The watcher would find it in 80ms; refreshing now means the caller can attach
		// and show it in the same turn without a race.
		const board = this.deck.refresh(path);
		if (board) this.send({ type: "board.changed", path, rev: board.rev, board });
		return path;
	}

	/**
	 * Delete a board: keep a copy of what it said, unlink it, and tell everyone.
	 *
	 * The order is the whole of it. **A last revision first**, because the point of
	 * `.decks/revisions` is that a version the server has seen is on disk under its sha —
	 * and the version that matters most is the one somebody just deleted. If the file has
	 * been edited outside the app since the last record, that edit is otherwise the one
	 * version never kept.
	 *
	 * Then `Deck.remove`, which owns both the file and the map it is in, and which refuses a
	 * path that climbs out of the deck. Then the agents, because a dead path left in a
	 * context silently empties the rail and the canvas (`DeckAgent.forget`) — the watcher
	 * would do this ~80ms later off the filesystem event, and doing it here means the row is
	 * gone under the cursor that pressed it rather than after a visible beat. The message it
	 * sends is the same message the watcher would, so the duplicate that follows is a no-op.
	 *
	 * A refusal is a notice to the browser that asked, not a throw: this arrives from a
	 * button, and the two ways it fails — a path with no board, and a file the OS will not
	 * unlink — are both things the person pressing it should read rather than a stack trace
	 * in a log they do not have.
	 */
	private deleteBoard(path: string, reply: (message: ServerMessage) => void): void {
		if (!this.deck.board(path)) {
			reply({ type: "notice", level: "warn", text: `There is no board at ${path} to delete.` });
			return;
		}
		this.recordRevision(path);
		try {
			this.deck.remove(path);
		} catch (error) {
			reply({ type: "notice", level: "error", text: `Could not delete ${path}: ${(error as Error).message}` });
			return;
		}
		this.agents.boardRemoved(path);
		this.send({ type: "board.changed", path, rev: 0, removed: true });
	}

	/** Store a board's current bytes as a revision; used right after an agent writes. */
	private recordRevision(path: string): string | undefined {
		try {
			return this.revisions.record(path, readFileSync(this.deck.fileOf(path), "utf8"));
		} catch {
			return undefined;
		}
	}

	/**
	 * An absolute (or relative) file an agent wrote -> the board it is, if it is one.
	 *
	 * Agents write with absolute paths as often as not, and only paths inside
	 * `boards/` are boards — an agent editing `lib/board.css` has not produced a new
	 * revision of anything.
	 */
	private boardPathOf(file: string): string | undefined {
		const relative = file.startsWith(this.deck.path)
			? file.slice(this.deck.path.length).replace(/^\/+/, "")
			: file.replace(/^\.\//, "");
		const normalized = relative.split("\\").join("/");
		return this.deck.board(normalized) ? normalized : undefined;
	}

	/**
	 * Apply a user's edit to a board file (§6.5).
	 *
	 * The `rev` the browser composed against is a precondition, not decoration: if
	 * the agent wrote the file mid-drag, applying anyway would silently undo its work
	 * — the bug that looks like a haunting. A refusal carries the current rev so the
	 * browser can re-read the frame and decide whether the gesture still means
	 * anything.
	 */
	private patch(path: string, rev: number, patches: BoardPatch[], reply: (message: ServerMessage) => void): void {
		const board = this.deck.board(path);
		if (!board) {
			reply({ type: "board.patched", path, rev: 0, refused: `No such board: ${path}` });
			return;
		}
		if (board.rev !== rev) {
			reply({
				type: "board.patched",
				path,
				rev: board.rev,
				refused: "That board changed while you were editing it, so it is being re-read.",
			});
			return;
		}

		const file = this.deck.fileOf(path);
		try {
			const before = readFileSync(file, "utf8");
			/*
			 * Ids are minted here, not in the browser.
			 *
			 * A name has to be unique against the file as it is now, and only the server
			 * has that — two tabs inserting at once would otherwise both pick
			 * `sticky-3`, and the second insert would be refused for a reason that reads
			 * like a bug. Handed to `applyPatches` as a function rather than applied to
			 * the batch first, so each insert is named against the file the one before it
			 * produced: dropping two files on a board is one batch of two inserts.
			 */
			const { html, summary } = applyPatches(before, patches, mintId);
			if (html === before) {
				reply({ type: "board.patched", path, rev: board.rev });
				return;
			}
			writeFileSync(file, html);
			this.revisions.record(path, html);
			const updated = this.deck.refresh(path);
			// `board.changed` will also arrive from the watcher; this one is immediate,
			// so the browser's optimistic edit is confirmed without waiting on the disk.
			this.send({ type: "board.patched", path, rev: updated?.rev ?? board.rev });
			if (updated) {
				updated.lastWrittenBy = "you";
				this.send({ type: "board.changed", path, rev: updated.rev, board: updated });
			}
			this.agents.userEdited(path, summary.join(", "));
		} catch (error) {
			const text = error instanceof PatchRefused ? error.message : `Could not apply that edit: ${(error as Error).message}`;
			reply({ type: "board.patched", path, rev: board.rev, refused: text });
		}
	}

	/**
	 * Undo the last change to a board, whoever made it.
	 *
	 * One mechanism for both authors, because the store holds both (§6.7). Undoing
	 * writes the previous revision back rather than reversing the edit: there is no
	 * inverse of "the agent rewrote this file", but there is a copy of what it said
	 * before.
	 */
	private undo(path: string, reply: (message: ServerMessage) => void): void {
		const previous = this.revisions.previous(path);
		if (!previous) {
			reply({ type: "notice", level: "info", text: "Nothing further to undo on this board." });
			return;
		}
		try {
			const content = this.revisions.read(previous);
			writeFileSync(this.deck.fileOf(path), content);
			this.revisions.pop(path);
			const updated = this.deck.refresh(path);
			if (updated) this.send({ type: "board.changed", path, rev: updated.rev, board: updated });
			this.send({ type: "board.patched", path, rev: updated?.rev ?? 0 });
		} catch (error) {
			reply({ type: "error", text: `Could not undo: ${(error as Error).message}` });
		}
	}

	greet(reply: (message: ServerMessage) => void): void {
		reply({ type: "deck.state", deck: this.deck.state() });
		for (const warning of this.deck.warnings) reply({ type: "notice", level: "warn", text: warning });
		// The whole truth on connect, so a reconnect is a refresh: the deck, the
		// agents, and each one's transcript.
		this.agents.greet(reply);
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
		this.revisions.setDeck(this.deck);
		// An agent's cwd is the deck, and a Pi session's cwd cannot move, so opening
		// another deck starts again rather than re-pointing what is running.
		void this.agents.reset(this.deck).then(() => {
			if (this.agents.restore() === 0) this.agents.create();
		});
		this.watch();
		this.send({ type: "deck.state", deck: this.deck.state() });
		for (const warning of this.deck.warnings) this.send({ type: "notice", level: "warn", text: warning });
	}

	private send(message: ServerMessage): void {
		this.hub?.broadcast(message);
	}

	dispose(): void {
		this.unwatch?.();
		this.unwatch = undefined;
		this.agents.dispose();
	}
}
