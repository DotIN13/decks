import type {
	AgentKind,
	AgentChat,
	AgentModel,
	AgentUsage,
	Board,
	BoardPatch,
	Camera,
	ChatItem,
	ClaudeAccount,
	DeckState,
	ExtensionUiPrompt,
	Identity,
	ModelOption,
	ThinkingLevel,
} from "@decks/protocol";
import Info from "lucide-solid/icons/info";
import MessageSquare from "lucide-solid/icons/message-square";
import Minus from "lucide-solid/icons/minus";
import Moon from "lucide-solid/icons/moon";
import Layers from "lucide-solid/icons/layers";
import SettingsIcon from "lucide-solid/icons/settings";
import LayoutGrid from "lucide-solid/icons/layout-grid";
import PanelLeft from "lucide-solid/icons/panel-left";
import Plus from "lucide-solid/icons/plus";
import Sun from "lucide-solid/icons/sun";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { EditorHost, Tool } from "./canvas/Editor.ts";
import { flow, guardDocumentDrops, isImage, shapeFor, type FileDropHost } from "./canvas/file-drop.ts";
import { Settings } from "./chat/Settings.tsx";
import { FilePicker } from "./canvas/FilePicker.tsx";
import { DecksMark, Icon } from "./icons.tsx";
import { applyLive, patchesFor, readShape, type Edit, type Shape } from "./canvas/inspect.ts";
import { Inspector } from "./canvas/Inspector.tsx";
import { CanvasOps } from "./canvas/CanvasOps.tsx";
import { coalesce, needsReload } from "./canvas/patches.ts";
import { Stage } from "./canvas/Stage.tsx";
import { runStageCall } from "./canvas/stage-ops.ts";
import { Dialog } from "./chat/Dialog.tsx";
import { Composer } from "./chat/composer/Composer.tsx";
import { StatusLine } from "./chat/StatusLine.tsx";
import { Stream } from "./chat/Stream.tsx";
import { AgentPill } from "./chrome/AgentPill.tsx";
import { Corner } from "./chrome/Corner.tsx";
import { LeftPanel } from "./chrome/LeftPanel.tsx";
import { boxOf, fitInto, INTERACT_ZOOM, keepVisible } from "./lib/camera.ts";
import { closeHistory, historyShown, openHistory, setInspectable, toggleHistory } from "./lib/edge.ts";
import { canvasBox, watchInsets } from "./lib/insets.ts";
import { connect, type Socket } from "./lib/socket.ts";
import { embedPath, uploadAsset } from "./lib/upload.ts";
import { canHover, NARROW } from "./lib/panels.ts";
import { obscured, trackVisualViewport } from "./lib/viewport.ts";
import { scheme, toggleScheme } from "./lib/theme.ts";

interface Notice {
	id: number;
	level: "info" | "warn" | "error";
	text: string;
}

/**
 * The shell: a title bar, the stage, and the panels floating over it.
 *
 * All server state arrives on the socket and nothing is fetched twice — the
 * greeting after a connect is the whole deck, so a reconnect is a refresh. The
 * camera is the one piece of state that is the browser's alone; it is not sent
 * anywhere until an agent asks about it (M3).
 */
export function App() {
	const [state, setState] = createStore<{
		deck?: DeckState;
		boards: Board[];
		notices: Notice[];
		/** One entry per agent, so switching chats (M5) is a lookup and not a fetch. */
		chats: AgentChat[];
		focused?: string;
		identities: Record<string, Identity>;
		transcripts: Record<string, ChatItem[]>;
		modelsByAgent: Record<string, ModelOption[]>;
		/** The model (and its thinking level) each agent is on, by agent id. */
		agentModel: Record<string, AgentModel | undefined>;
		/** The context/cost meter for each agent, by id. */
		agentUsage: Record<string, AgentUsage | undefined>;
		dialog?: ExtensionUiPrompt;
		/** Boards each agent is holding, from `context.changed`. */
		contexts: Record<string, string[]>;
		/** The subset each agent has put on the canvas. */
		inPlay: Record<string, string[]>;
		/** Reload counters from `stage.reload`, per board. */
		nonces: Record<string, number>;
		defaultKind: AgentKind;
		cursor?: { path: string; x: number; y: number; label: string; color: string } | null;
		/**
		 * A point being previewed, and the revisions to render while it is.
		 *
		 * Preview is a *look*: the frames load revisions out of the store instead of
		 * the file, the stage refuses pointer events, and nothing is written until the
		 * user actually clicks the notch.
		 */
		preview?: { entryId: string; boards: Record<string, string> };
		/** The Claude subscriptions this install can use (`chat/Settings.tsx`). */
		accounts: ClaudeAccount[];
		/** Which of them is spending. `default` is the CLI's own login. */
		activeAccount: string;
	}>({
		boards: [],
		notices: [],
		chats: [],
		identities: {},
		transcripts: {} as Record<string, ChatItem[]>,
		modelsByAgent: {} as Record<string, ModelOption[]>,
		agentModel: {} as Record<string, AgentModel | undefined>,
		agentUsage: {} as Record<string, AgentUsage | undefined>,
		contexts: {} as Record<string, string[]>,
		inPlay: {} as Record<string, string[]>,
		nonces: {} as Record<string, number>,
		defaultKind: "pi" as AgentKind,
		accounts: [] as ClaudeAccount[],
		activeAccount: "default",
	});

	const [camera, setCamera] = createSignal<Camera>({ x: 0, y: 0, zoom: 1 });
	const [connected, setConnected] = createSignal(false);
	const [selected, setSelected] = createSignal<string | undefined>(undefined);
	const [tool, setTool] = createSignal<Tool>("select");
	const [component, setComponent] = createSignal<{ path: string; id: string } | undefined>(undefined);
	/**
	 * The file picker's promise, and which board asked.
	 *
	 * The board is what a file uploaded *through* the picker needs: an embed is written
	 * the way that board's document would address it (`embedPath`), so "add a photo from
	 * this phone" cannot be answered without knowing where the answer is going.
	 */
	const [picking, setPicking] = createSignal<{ resolve: (path: string | undefined) => void; board?: string } | undefined>(undefined);
	/** The turn the chat was opened at, from a click on the spine. */
	const [atTurn, setAtTurn] = createSignal<{ id: string; at: number } | undefined>(undefined);
	/**
	 * When this conversation was last looked at.
	 *
	 * The spine marks turns that arrived since, which is what tells you something was
	 * said while the panel was away. While the panel is open nothing is unseen, so the
	 * comparison is skipped entirely rather than being kept up to date — see `turns`.
	 */
	const [seenAt, setSeenAt] = createSignal(Date.now());
	/**
	 * Whether the conversation is up (see `FloatingTranscript`).
	 *
	 * This is *the* transcript now — the sheet that used to slide in from the right edge
	 * is gone — so the flag is no longer only about the dock giving way to it. It is what
	 * "the conversation is open" means everywhere: the dock's peek stands down, the spine
	 * stops marking turns as unseen, and an arriving reply is not unread.
	 */
	/** The all-canvases modal (`canvas/AllBoards.tsx`), which is a thing you do and then stop. */
	/*
	 * Whether the boards panel is there. One signal where `lib/panels.ts` had two, because
	 * there is one panel now — and a plain signal rather than that module's persisted pair,
	 * since what it was mostly doing was closing one panel when the other opened.
	 *
	 * **Open where it is a panel, closed where it is a sheet.** Above 1100px it stands beside
	 * the canvas and costs 264px of a wide window, which is a fair trade for knowing what the
	 * agent is holding. Below that it is a sheet *over* the canvas, and a canvas app that
	 * opens with something covering the canvas is answering a question nobody asked — on a
	 * 393px screen the sheet took the left two thirds, and a pinch aimed at a board landed on
	 * a list of filenames.
	 */
	const [boardsOpen, setBoardsOpen] = createSignal(window.innerWidth > 1100);
	/** Settings: the Claude subscriptions this install can use (`chat/Settings.tsx`). */
	const [settings, setSettings] = createSignal(false);
	/**
	 * Words the server has handed to the input bar: the message a rewind took back.
	 *
	 * Stamped, so rewinding twice to the same message is two handovers rather than one the
	 * composer has already acted on.
	 */
	const [draft, setDraft] = createSignal<{ text: string; at: number } | undefined>(undefined);
	/**
	 * Whether the canvas cheat sheet is open (see `CanvasOps`).
	 *
	 * Reference material, behind a button. It was a permanent line of grey text under the
	 * input bar once, and a tip rotating through the composer's placeholder after that —
	 * both of which put a reference table where a person is working, so it was either always
	 * in the way or arriving at a moment nobody asked for it.
	 */
	const [ops, setOps] = createSignal(false);
	/**
	 * Unread counts, kept here rather than on the server.
	 *
	 * "Have I read this" is a fact about a person in front of a browser, not about the
	 * agent — a second tab has its own answer, and the server has no business
	 * guessing. Reset by opening the conversation, which is the only thing that means
	 * you have seen it.
	 */
	const [unread, setUnread] = createStore<Record<string, number>>({});

	/**
	 * Revisions this browser caused, by path.
	 *
	 * Its own edit is already in the frame's DOM, so reloading the frame to show it
	 * would throw away the thing it is showing and flash. Somebody else's edit — the
	 * agent's, another tab's — does reload.
	 *
	 * This is keyed by revision rather than being a "just wrote it" flag because one
	 * patch produces *two* `board.changed` messages: the immediate one from the write and
	 * the watcher's, both carrying the same rev. A flag is consumed by the first and the
	 * second then looks exactly like somebody else's write — it unpinned the frame and
	 * reloaded the document out from under the user, which is the flash you see on every
	 * component drag. A rev is a content hash, so matching on it absorbs however many
	 * echoes arrive and still reloads for a rev we did not produce.
	 */
	const selfRevs = new Map<string, number>();
	/** Paths with a patch in flight, before the accepted rev is known. */
	const patching = new Set<string>();
	/**
	 * Edits made while a patch was in flight, per path.
	 *
	 * A patch carries the rev it was composed against, so a second one sent before the
	 * first is acknowledged names a revision that no longer exists and is refused —
	 * correct for "the agent wrote this file underneath you" and absurd for "you
	 * clicked three inspector buttons". They wait here and go as one batch against the
	 * rev the acknowledgement brings back. See `canvas/patches.ts`.
	 */
	const queued = new Map<string, BoardPatch[]>();
	/**
	 * The revision each frame is pinned to, or 0 for "show the newest".
	 *
	 * A pin is what stops a reload. Our own edit is already in the frame's DOM, so the
	 * frame is pinned to the revision it *loaded* — not the one it just produced —
	 * and the URL therefore does not change. Somebody else's edit clears the pin, the
	 * URL changes, and the frame reloads, which is exactly what should happen.
	 */
	const [frameRevs, setFrameRevs] = createStore<Record<string, number>>({});

	let socket: Socket;
	let noticeId = 0;

	const notice = (level: Notice["level"], text: string) => {
		const id = ++noticeId;
		setState("notices", (all) => [...all, { id, level, text }]);
		// Length-based, floored and capped: long enough to read, short enough that a
		// burst of warnings does not become a wall.
		const linger = Math.min(12000, Math.max(4000, (text.length / 20) * 1000));
		setTimeout(() => setState("notices", (all) => all.filter((item) => item.id !== id)), linger);
	};

	/**
	 * A notice that lasts as long as the work it describes.
	 *
	 * The timed notices above are for things that have already happened. An upload has
	 * not: it takes as long as the file is big, and a message that expires after four
	 * seconds while the bytes are still going is worse than none. So this one is held
	 * open by the caller, rewritten as the work progresses, and replaced by an ordinary
	 * timed notice when it ends.
	 */
	const working = (text: string) => {
		const id = ++noticeId;
		setState("notices", (all) => [...all, { id, level: "info" as const, text }]);
		const drop = () => setState("notices", (all) => all.filter((item) => item.id !== id));
		return {
			update: (next: string) =>
				setState("notices", (all) => all.map((item) => (item.id === id ? { ...item, text: next } : item))),
			done: (final?: string, level: Notice["level"] = "info") => {
				drop();
				if (final) notice(level, final);
			},
		};
	};

	/*
	 * Start measuring the chrome.
	 *
	 * Before the socket, deliberately: the first `deck.state` can arrive with boards in it
	 * and trigger the opening fit, and a fit that runs before anything has been measured
	 * frames into the whole window and then never runs again.
	 */
	onMount(() => watchInsets());

	onMount(() => {
		socket = connect(setConnected);
		const off = socket.on((message) => {
			switch (message.type) {
				case "deck.state":
					setState("deck", message.deck);
					/*
					 * The greeting is a refresh (§5), so nothing is in flight any more. Said
					 * out loud because the patch queue depends on it: an edit made while a
					 * patch is unacknowledged waits for that acknowledgement, and one lost to
					 * a dropped socket would otherwise leave every later edit to that board
					 * waiting for a message that is never coming.
					 */
					patching.clear();
					queued.clear();
					/*
					 * Reconciled by path, not replaced.
					 *
					 * A board row owns a live iframe, and Solid re-creates a row whose item
					 * is a new object — so assigning a fresh array reloaded every board on
					 * screen. That is what "moving a board refreshes the page" was: a drag
					 * writes deck.json, the watcher reports it, and the whole deck arrived
					 * as new objects. `reconcile` keyed on the path updates the boards that
					 * changed and leaves the rest — and their documents — alone.
					 */
					setState("boards", reconcile(message.deck.boards, { key: "path", merge: false }));
					return;
				case "board.patched": {
					patching.delete(message.path);
					if (message.refused) {
						notice("warn", message.refused);
						// Its optimistic DOM is now a lie: unpin and reload from the file. What
						// was queued behind it was composed against that same lie, so it goes
						// too — one warning, not one per held-back click.
						queued.delete(message.path);
						// And the selection, which may name a component that was never renamed
						// or a copy that was never made. The frame is about to reload with the
						// file's own answer; a selection composed against the refused version of
						// it would leave the inspector describing something that does not exist.
						setComponent(undefined);
						selfRevs.delete(message.path);
						setFrameRevs(message.path, 0);
						setState("nonces", message.path, (current = 0) => current + 1);
						return;
					}
					// Accepted: remember the rev our write produced so both echoes of it are
					// recognised, and keep the pin so the frame holds the DOM it already has.
					selfRevs.set(message.path, message.rev);
					/*
					 * Whatever arrived while this was in flight goes now, against the rev this
					 * message carries — which is the only place the new rev is known this
					 * early: `board.rev` in the store is not updated until `board.changed`
					 * lands, one message later, so composing against it here would send a
					 * stale patch to fix a stale patch.
					 */
					const waiting = queued.get(message.path);
					if (waiting && waiting.length > 0) {
						queued.delete(message.path);
						sendPatches(message.path, message.rev, waiting);
					}
					return;
				}

				case "board.changed": {
					if (message.removed) {
						setState("boards", (boards) => boards.filter((board) => board.path !== message.path));
						return;
					}
					if (!message.board) return;
					const board = message.board;
					if (selfRevs.get(board.path) === board.rev) {
						// Our own write, already on screen. Kept, not consumed: the same rev
						// arrives twice and the second copy must not read as somebody else's.
					} else if (patching.has(board.path)) {
						// The echo overtook the acknowledgement — adopt it as ours.
						selfRevs.set(board.path, board.rev);
					} else {
						// Somebody else wrote it — the agent, another tab, an editor. Drop
						// the pin so the frame loads what is now on disk.
						selfRevs.delete(board.path);
						setFrameRevs(board.path, 0);
					}
					// Merged into the existing row so its frame survives; only a board that
					// is genuinely new grows the array.
					//
					// `reconcile` with `merge` rather than a plain assignment: `Stage` renders
					// the boards with `<For>`, which keys by reference, so replacing the object
					// at this index makes the row new — and re-creating a row re-creates its
					// iframe, which reloads the document. That is a full white-flash reload of
					// the board the user is editing, on every component drag, showing the very
					// bytes the live DOM already has. Merging leaves the identity alone and
					// updates only the fields that moved.
					const index = state.boards.findIndex((existing) => existing.path === board.path);
					if (index === -1) {
						setState("boards", (boards) => [...boards, board].sort((a, b) => a.path.localeCompare(b.path)));
					} else {
						setState("boards", index, reconcile(board, { merge: true }));
					}
					return;
				}
				case "agents": {
					const focused = message.focused ?? state.focused;
					// A different conversation is a different history: the turn the chat was
					// opened at belongs to the one you were reading.
					if (focused !== state.focused) {
						setAtTurn(undefined);
						setSeenAt(Date.now());
					}
					setState({ chats: message.chats, focused, defaultKind: message.defaultKind });
					return;
				}

				case "agent.removed": {
					/*
					 * Drop what was being kept for it. The `agents` frame that follows sets
					 * the list and the focus, so this is only about not holding a transcript
					 * for a chat that is gone — and about not showing its unread count on
					 * whatever row happens to take its place.
					 */
					setState("transcripts", message.id, undefined as never);
					setState("identities", message.id, undefined as never);
					setState("contexts", message.id, undefined as never);
					setState("inPlay", message.id, undefined as never);
					setState("agentModel", message.id, undefined as never);
					setState("agentUsage", message.id, undefined as never);
					setState("modelsByAgent", message.id, undefined as never);
					setUnread(message.id, 0);
					return;
				}

				case "agent.identity":
					setState("identities", message.id, message.identity);
					return;

				case "agent.state":
					setState("chats", (chats) => chats.map((chat) => (chat.id === message.id ? { ...chat, state: message.state } : chat)));
					return;

				case "agent.model":
					setState("agentModel", message.id, message.model);
					return;

				case "agent.usage":
					setState("agentUsage", message.id, message.usage);
					return;

				case "models":
					// One list per agent: the runtime each agent runs on answers its own, and
					// a global list would show the last agent to start on everyone — a row
					// for Claude listing the models of a pi agent that started after it.
					setState("modelsByAgent", message.agentId, message.models);
					return;

				case "chat.history":
					setState("transcripts", message.agentId, message.items);
					return;

				case "chat.item": {
					const item = message.item;
					/*
					 * A reply you cannot see is the thing an unread count is for — whether
					 * that is because you are in another conversation or because the panel
					 * is away. Your own messages are not news.
					 */
					const unseen = message.agentId !== state.focused || !historyShown();
					if (unseen && item.kind === "assistant") setUnread(message.agentId, (count = 0) => count + 1);
					setState("transcripts", message.agentId, (items = []) => {
						const index = items.findIndex((existing) => existing.id === item.id);
						if (index === -1) return [...items, item];
						const next = [...items];
						next[index] = item;
						return next;
					});
					return;
				}

				case "chat.delta": {
					// Deltas are applied to the item in place: the server sends the whole
					// item at the start and the end, and the increments in between.
					setState("transcripts", message.agentId, (items = []) =>
						items.map((item) => {
							if (item.id !== message.itemId || item.kind !== "assistant") return item;
							return message.field === "thinking"
								? { ...item, thinking: (item.thinking ?? "") + message.delta }
								: { ...item, text: item.text + message.delta };
						}),
					);
					return;
				}

				case "timeline.preview":
					setState("preview", message.entryId ? { entryId: message.entryId, boards: message.boards } : undefined);
					return;

				case "context.changed":
					setState("contexts", message.agentId, message.boards);
					setState("inPlay", message.agentId, message.inPlay);
					return;

				case "stage.call": {
					/*
					 * An agent asking something of the canvas. It is answered, always —
					 * the server is holding a tool call open on it, and a refusal it can
					 * read beats a timeout it cannot.
					 */
					let value: unknown;
					try {
						value = runStageCall(message.call, {
							boards: () => state.boards,
							viewport: () => {
								const stage = document.querySelector(".stage");
								return { width: stage?.clientWidth ?? 0, height: stage?.clientHeight ?? 0 };
							},
							setCamera: (camera) => setCamera(camera),
							select: (path) => setSelected(path),
							reload: (path) => setState("nonces", path, (current = 0) => current + 1),
							cursor: (cursor) => setState("cursor", cursor),
							toast: (text) => notice("info", text),
						});
					} catch (error) {
						value = { error: error instanceof Error ? error.message : String(error) };
					}
					socket.send({ type: "stage.result", result: { id: message.call.id, value } });
					return;
				}

				case "extension.ui.prompt":
					setState("dialog", message.prompt);
					// Drawn in the dock, above the input bar, so it needs nothing dragged
					// open to be seen.
					return;

				case "extension.ui.prompt.closed":
					setState("dialog", (current) => (current?.id === message.id ? undefined : current));
					return;

				case "notice":
					notice(message.level, message.text);
					return;

				case "composer.draft":
					setDraft({ text: message.text, at: Date.now() });
					return;

				case "claude.accounts":
					setState({ accounts: message.accounts, activeAccount: message.active });
					return;
				case "error":
					notice("error", message.text);
					return;
				default:
					return;
			}
		});
		onCleanup(off);
	});

	const move = (path: string, x: number, y: number) => {
		// Optimistic, and in place: the board is already where it was dropped, and the
		// server's answer confirms it. Replacing the object here would re-create the
		// row and reload the document that is sitting in it.
		const index = state.boards.findIndex((board) => board.path === path);
		if (index >= 0) setState("boards", index, { x, y });
		socket.send({ type: "board.move", path, x, y });
	};

	const focusedChat = createMemo(() => state.chats.find((chat) => chat.id === state.focused));
	const transcript = createMemo(() => (state.focused ? state.transcripts[state.focused] ?? [] : []));
	const busy = createMemo(() => {
		const chat = focusedChat();
		return chat ? chat.state !== "idle" : false;
	});

	/**
	 * Tell the server where the user is looking, but not on every frame.
	 *
	 * A pan is hundreds of camera changes and the server only needs the resting
	 * place, so this trails the gesture by a beat rather than narrating it.
	 */
	let cameraTimer: number | undefined;
	const reportCamera = (camera: Camera) => {
		if (cameraTimer) clearTimeout(cameraTimer);
		cameraTimer = window.setTimeout(() => socket.send({ type: "camera.set", camera }), 250);
	};

	const setCameraAndReport = (camera: Camera) => {
		setCamera(camera);
		reportCamera(camera);
	};

	/**
	 * What the focused agent holds, restricted to boards that still exist.
	 *
	 * The server prunes deleted boards out of context, but context is also rebuilt from a
	 * transcript when rewinding, and a transcript can name a board that has since been
	 * deleted. Resolving here means one dead path can never empty the rail and the canvas
	 * at once: an agent left holding only ghosts counts as holding nothing, which is the
	 * case the whole-deck fallback exists for.
	 */
	const held = createMemo(() => {
		const paths = state.focused ? state.contexts[state.focused] ?? [] : [];
		if (paths.length === 0) return paths;
		const known = new Set(state.boards.map((board) => board.path));
		return paths.filter((path) => known.has(path));
	});

	/**
	 * The focused agent's boards, in attach order, and nothing else.
	 *
	 * The fallback to the whole deck is gone with the panel that needed it. It was there
	 * because the rail was the only way to find a board, so it had to list everything there
	 * was to find — which meant one list meaning two different things depending on state
	 * nobody was looking at. Finding a board is the all-canvases modal's job now
	 * (`canvas/AllBoards.tsx`), so this can say what is true: an agent holding nothing shows
	 * nothing, and the panel says so in a sentence.
	 */
	const contextBoards = createMemo(() => {
		const byPath = new Map(state.boards.map((board) => [board.path, board]));
		return held().flatMap((path) => {
			const board = byPath.get(path);
			return board ? [board] : [];
		});
	});

	/**
	 * What is on the canvas: the focused agent's in-play set, and nothing else.
	 *
	 * An agent holding nothing shows *no* boards. The rail still lists the whole deck
	 * (`railBoards` above), so nothing is hidden — what is empty is the canvas, which is
	 * the honest reading of "this agent has not put anything in play".
	 *
	 * This used to fall back to the whole deck, on the argument that a fresh agent opening
	 * onto a blank canvas reads as data loss. The argument was wrong about which state is
	 * misleading: a canvas showing every board in the deck claims the agent is working from
	 * all of them, and it made the first thing an agent did — narrowing to one board — look
	 * like boards disappearing. An empty canvas beside a full rail says what is true, and
	 * says it before anything has happened rather than after.
	 */
	const stageBoards = createMemo(() => {
		const playing = new Set(state.focused ? state.inPlay[state.focused] ?? [] : []);
		return state.boards.filter((board) => playing.has(board.path));
	});

	/**
	 * Who to tell when the selection moves.
	 *
	 * Each board frame draws its own selection overlay, so all of them need to hear:
	 * the one that gained the selection to draw it, and the one that lost it to stop.
	 */
	const selectionListeners = new Set<() => void>();
	createEffect(() => {
		component();
		for (const listener of selectionListeners) listener();
	});

	/**
	 * A batch of patches, down the socket, against a named revision.
	 *
	 * Split out from `editor.patch` because the queue above sends from a second place:
	 * the acknowledgement of the patch that was in flight.
	 */
	const sendPatches = (path: string, rev: number, patches: BoardPatch[]) => {
		patching.add(path);
		/*
		 * Pin to what the frame is showing *now*, before the write lands — and only if
		 * it is not already pinned. Re-pinning on each edit moves the pin to the newest
		 * rev while the document on screen is still the one it first loaded, so the URL
		 * changes and the frame reloads: the flash came back on the second drag.
		 *
		 * An insert is the exception, and a duplicate with it: both have to actively
		 * *unpin*. The pin's premise is that the frame's DOM is already correct because
		 * the editor mutated it — true of a drag, false of a component that exists only
		 * in the file, because the server mints the id and writes the markup (§6.5).
		 * Pinned, a dropped file landed in `assets/`, landed in the board's source, and
		 * appeared nowhere on screen until something else reloaded the frame. One reload
		 * beats a component the user cannot see.
		 */
		if (needsReload(patches)) setFrameRevs(path, 0);
		else if (!frameRevs[path]) {
			const board = state.boards.find((candidate) => candidate.path === path);
			if (board) setFrameRevs(path, board.rev);
		}
		socket.send({ type: "board.patch", path, rev, patches });
	};

	const editor: EditorHost = {
		tool: () => tool(),
		resetTool: () => setTool("select"),
		selected: () => component(),
		select: (selection) => {
			setComponent(selection);
			if (selection) setSelected(selection.path);
		},
		onSelectionChange: (listener) => {
			selectionListeners.add(listener);
			return () => selectionListeners.delete(listener);
		},
		patch: (path, patches) => {
			const board = state.boards.find((candidate) => candidate.path === path);
			if (!board) return;
			// One patch at a time per board. The rest wait for the rev the acknowledgement
			// brings, coalesced, because a burst of edits to one component is one edit as
			// far as the file is concerned.
			if (patching.has(path)) {
				queued.set(path, coalesce([...(queued.get(path) ?? []), ...patches]));
				return;
			}
			sendPatches(path, board.rev, patches);
		},
		undo: (path) => socket.send({ type: "board.undo", path }),
		pickFile: (board) =>
			new Promise<string | undefined>((resolve) => {
				setPicking({
					board,
					resolve: (picked: string | undefined) => {
						setPicking(undefined);
						resolve(picked);
					},
				});
			}),
		notice: (text) => notice("info", text),
		// Editing follows the same threshold as pointer events: if the frame is inert
		// because we are zoomed out, there is nothing to edit with.
		enabled: () => camera().zoom >= INTERACT_ZOOM,
		reveal: (path, box) => {
			const board = state.boards.find((candidate) => candidate.path === path);
			const stage = document.querySelector(".stage");
			if (!board || !stage) return;
			/*
			 * The room to aim for. The bottom is the keyboard plus the dock that sits above
			 * it — a caret tucked behind the input bar is as lost as one behind the keys —
			 * and the top is the title bar the canvas already runs under.
			 */
			const dock = document.querySelector(".dock")?.getBoundingClientRect().height ?? 0;
			setCamera(
				keepVisible(
					camera(),
					{ width: stage.clientWidth, height: stage.clientHeight },
					{ x: board.x + box.x, y: board.y + box.y, w: box.w, h: box.h },
					{ top: 12, bottom: obscured().bottom + dock + 12 },
				),
			);
		},
	};

	/**
	 * The selected component as the inspector needs it (`canvas/inspect.ts`).
	 *
	 * Read from the live document rather than kept in the store: the board is
	 * same-origin (§4) and the DOM is already the truth about what is on screen, so a
	 * second copy of "what class does this have" would be one more thing to invalidate.
	 * Re-read when the selection changes, when the board's revision changes (our own
	 * write, or the agent's), and when a reload is forced — those three cover every way
	 * the component under the selection can become something else.
	 */
	const [shape, setShape] = createSignal<Shape | undefined>(undefined);

	/*
	 * Tell the right edge whether the inspector has anything to describe.
	 *
	 * Here rather than in the inspector, because "describable" is all three of these at
	 * once: a component is selected, the camera is close enough for a board to take pointer
	 * events at all, and no past revision is being previewed. The panel knows the first;
	 * only this component knows all three.
	 *
	 * And it is an effect rather than a call inside `setComponent`, because the zoom and the
	 * preview can turn it off without the selection changing — the edge would otherwise keep
	 * showing an inspector for something that had stopped being selectable.
	 */
	createEffect(() => {
		setInspectable(shape() !== undefined && camera().zoom >= INTERACT_ZOOM && !state.preview);
	});
	createEffect(() => {
		const selection = component();
		if (!selection) {
			setShape(undefined);
			return;
		}
		// Read as dependencies, not for their values.
		void state.boards.find((board) => board.path === selection.path)?.rev;
		void state.nonces[selection.path];
		setShape(readShape(selection.path, selection.id));
	});

	/**
	 * An inspector edit: the live document, then the file.
	 *
	 * Both halves, because the frame is pinned to the revision it loaded (§7) — a patch
	 * alone would be a change the user cannot see until somebody else writes the board.
	 * The exception is a duplicate, whose markup exists only in the file; `patches.ts`
	 * is where that unpins.
	 */
	const inspect = (edit: Edit) => {
		const current = shape();
		if (!current) return;
		applyLive(current, edit);
		editor.patch(current.path, patchesFor(current, edit));
		if (edit.kind === "remove") {
			setComponent(undefined);
			return;
		}
		// A rename moves the selection with it: the id *is* how the component is
		// addressed, here as in the file, and the old one now names nothing.
		const id = edit.kind === "rename" ? edit.to : current.id;
		if (edit.kind === "rename") setComponent({ path: current.path, id });
		setShape(readShape(current.path, id));
	};

	/**
	 * A file dragged in from the desktop, landing on a board as an embed (§3).
	 *
	 * The order matters and is the reason this is not two lines: the bytes have to be
	 * *in* the deck before a board can point at them, so every file is uploaded first
	 * and the inserts go out afterwards as **one** patch. One patch and not one each
	 * because a patch carries the revision it was composed against — a second patch
	 * sent before the first has come back would be refused as stale, and three files
	 * dropped together would land as one.
	 *
	 * Uploads are sequential rather than parallel, so the progress line means
	 * something: four bars all at 30% is not information anybody can act on.
	 */
	const dropOnBoard = async (path: string, files: File[], at: { x: number; y: number }) => {
		const board = state.boards.find((candidate) => candidate.path === path);
		if (!board) return;
		const report = working(files.length > 1 ? `Adding ${files.length} files…` : `Adding ${files[0]?.name ?? "file"}…`);
		// The insert variant specifically, so the summary below can read back `embed`.
		const inserts: Extract<BoardPatch, { op: "insert" }>[] = [];
		const failures: string[] = [];
		let reused = 0;

		/*
		 * Laid out before anything is uploaded, and for the whole batch at once. The
		 * shapes are read from the files locally — an image's own pixels, mostly — and
		 * `flow` needs to see all of them to put them in a row that wraps at the board's
		 * edge instead of a pile at the cursor.
		 */
		const boxes = flow(await Promise.all(files.map(shapeFor)), at, board.w);

		for (const [index, file] of files.entries()) {
			const of = files.length > 1 ? `${index + 1} of ${files.length} · ` : "";
			try {
				const asset = await uploadAsset(file, (fraction) =>
					report.update(`${of}${file.name} · ${Math.round(fraction * 100)}% of ${sizeLabel(file.size)}`),
				);
				if (asset.reused) reused += 1;
				inserts.push({
					op: "insert",
					// `image` and `embed` render the same markup; the kind is what names the
					// component, so `image-1` in the file says what it is without opening it.
					kind: isImage(file) ? "image" : "embed",
					id: "",
					at: boxes[index]!,
					embed: embedPath(path, asset.path),
				});
			} catch (error) {
				failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		if (inserts.length > 0) editor.patch(path, inserts);
		const added =
			inserts.length === 0
				? ""
				: `${inserts.length === 1 ? inserts[0]?.embed?.split("/").pop() : `${inserts.length} files`} added${reused > 0 ? ` (${reused} already in the deck)` : ""}`;
		report.done([added, ...failures].filter(Boolean).join(" · ") || undefined, failures.length > 0 ? "warn" : "info");
	};

	/**
	 * What a board frame hands back when files are dropped inside it (`file-drop.ts`).
	 *
	 * Per board, because the drop belongs to the board it landed on: the frame knows
	 * where in its own document the cursor was, and those pixels are board pixels.
	 */
	const drops = (path: string): FileDropHost => ({
		enabled: () => editor.enabled(),
		drop: (files, at) => void dropOnBoard(path, files, at),
	});

	/**
	 * One file from the device, copied into the deck, answered as an embed path.
	 *
	 * The other end of the file picker (`FilePicker`), and the whole of "getting a photo
	 * off a phone onto a board": the upload route and the insert path were already there
	 * for the desktop drag (§6.9), and a drag is the one gesture a touchscreen does not
	 * have. So this is the same two steps in the other order — the bytes go into the deck
	 * first, and the path comes back for the component that asked.
	 */
	const addFile = async (board: string | undefined, file: File): Promise<string | undefined> => {
		const report = working(`Adding ${file.name}…`);
		try {
			const asset = await uploadAsset(file, (fraction) =>
				report.update(`${file.name} · ${Math.round(fraction * 100)}% of ${sizeLabel(file.size)}`),
			);
			report.done(`${file.name} added${asset.reused ? " (already in the deck)" : ""}`);
			// Relative to the board that asked, because a deck is self-contained and an
			// absolute path is a board that breaks when the deck moves.
			return board ? embedPath(board, asset.path) : asset.path;
		} catch (error) {
			report.done(`${file.name}: ${error instanceof Error ? error.message : String(error)}`, "warn");
			return undefined;
		}
	};

	/**
	 * A file on the clipboard, landing on the selected board.
	 *
	 * The sibling of the drop path, and the one edge §8 listed against §6.9. A paste has no
	 * cursor position — that is the whole difference from a drop — so it needs a rule
	 * instead of a point: **the selected board, at the middle of it.** The selection is
	 * the board the user is working on and it is already visible on screen, which makes
	 * this the smallest rule that is never surprising; nothing is invented when there is
	 * no selection, exactly as nothing is invented for a file dropped on empty canvas.
	 *
	 * A paste while something is focused belongs to that thing: the composer, an
	 * inspector field, a run of text being retyped. A screenshot pasted into a sentence
	 * you are writing is not an embed.
	 */
	const pasteOnBoard = (files: File[]) => {
		if (files.length === 0) return;
		const path = selected();
		const board = path ? state.boards.find((candidate) => candidate.path === path) : undefined;
		if (!board) {
			notice("info", "Pick a board first. A pasted file becomes an embed, and an embed lives on a board.");
			return;
		}
		if (!editor.enabled()) {
			notice("info", "Zoom in until the board is live, then paste.");
			return;
		}
		void dropOnBoard(board.path, files, { x: board.w / 2, y: board.h / 2 });
	};

	onMount(() => {
		const onPaste = (event: ClipboardEvent) => {
			// `closest` is asked for rather than assumed: a paste with nothing focused
			// targets the document, which is not an element.
			const target = event.target as HTMLElement | null;
			if (target?.closest?.("input, textarea, [contenteditable]")) return;
			const files = Array.from(event.clipboardData?.files ?? []);
			if (files.length === 0) return;
			event.preventDefault();
			pasteOnBoard(files);
		};
		document.addEventListener("paste", onPaste);
		onCleanup(() => document.removeEventListener("paste", onPaste));

		/*
		 * Escape lets the selection go, from anywhere.
		 *
		 * It always did — inside the board's own document, where `Editor` listens (§6.5).
		 * That is the one place the key was *never* pressed: selecting a component opens the
		 * inspector, and the next thing a hand does is reach for it, which moves focus out
		 * of the iframe. From then on the keypress arrived here, where nothing was listening,
		 * and the only way out of a selection was the inspector's own ×.
		 *
		 * Two things own Escape ahead of this and keep it. A **field** — the composer clears
		 * its draft, an inspector input reverts — because the selection is still there to let
		 * go of afterwards, and losing a draft you were trying to keep is the worse outcome.
		 * A **dialog**, because a question waiting for an answer is more urgent than a
		 * selection, and answering it is what the key is for while one is up.
		 */
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (!component()) return;
			if (state.dialog) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest?.("input, textarea, select, [contenteditable]")) return;
			event.preventDefault();
			setComponent(undefined);
		};
		window.addEventListener("keydown", onKeyDown);
		onCleanup(() => window.removeEventListener("keydown", onKeyDown));
		// The visual viewport, so the dock stays above the on-screen keyboard.
		onCleanup(trackVisualViewport());

		/*
		 * How tall the dock currently is, published for the stylesheet.
		 *
		 * The conversation stops above the dock, and the dock is a stack of however many of
		 * "the last reply", "a permission question" and "the input bar" are true right now.
		 * A constant would be wrong most of the time and on top of the composer some of it,
		 * so the one thing that knows measures it.
		 */
		const dock = document.querySelector(".dock");
		if (dock) {
			const observer = new ResizeObserver(([entry]) => {
				const height = Math.round(entry?.contentRect.height ?? 0);
				document.documentElement.style.setProperty("--dock", `${height}px`);
			});
			observer.observe(dock);
			onCleanup(() => observer.disconnect());
		}
	});

	/*
	 * The browser opens a dropped file by default, which would unload the app — socket,
	 * camera, transcript and all — to show a picture. Guarded on the whole document
	 * rather than over the canvas, because "anywhere" includes the rail, the conversation
	 * and the gap between boards.
	 *
	 * Reaching here means the drop missed every live board, since a drop over one is
	 * consumed inside that frame's document. The answer is a notice and nothing else:
	 * an embed belongs to a board, and inventing a board to hold a file the user
	 * dropped on empty canvas would be the app deciding something it was not asked to.
	 */
	onMount(() => {
		onCleanup(
			guardDocumentDrops(document, (at) => {
				const over = document.elementFromPoint(at.x, at.y)?.closest(".board-node");
				// While the timeline is being previewed the frames take no pointer events, so
				// every drop arrives here — and "zoom in" would be a lie about why.
				if (state.preview) {
					notice("info", "That is a board as it used to be. Let go of the timeline first.");
					return;
				}
				notice(
					"info",
					over
						? "Zoom in until the board is live, then drop the file on it."
						: "Drop a file onto a board. An embed lives on a board, not on the canvas.",
				);
			}),
		);
	});

	/*
	 * Opening the conversation is the act of having read it.
	 *
	 * An effect rather than a step inside every opener, which is what it used to be — there
	 * were three routes in and each had to remember to clear the badge. Now `lib/edge.ts`
	 * owns whether the column is up, and this watches that one fact: however it came to be
	 * open, the agent on screen stops being unread.
	 *
	 * Which matters more than tidiness, because unread is no longer only a badge. A face in
	 * the top-right corner is *green* while a finished turn has not been read, and that is
	 * the whole signal — so a missed clear leaves a light on for something you are looking
	 * at.
	 */
	createEffect(() => {
		if (!historyShown()) {
			setSeenAt(Date.now());
			return;
		}
		if (state.focused) setUnread(state.focused, 0);
	});

	/**
	 * On a narrow screen the panel and the conversation take turns.
	 *
	 * 264px of panel and 320px of cards on a 390px phone is two surfaces and no canvas.
	 * Above `NARROW` nothing is closed: a laptop has room for a panel beside the
	 * conversation, and taking one away would be the app tidying up after a choice the user
	 * had just made.
	 *
	 * Two surfaces where there were three, because the agents are a dropdown now rather than
	 * a panel — so the rule that used to need a `keep` argument is two `if`s.
	 */
	const narrow = () => window.innerWidth < NARROW;

	/*
	 * On a narrow screen the two surfaces take turns, whichever way they were opened.
	 *
	 * 264px of sheet and 320px of conversation on a 393px screen is two surfaces and no
	 * canvas. The swipes used to be the only place this was enforced, because they were the
	 * only openers `App` could see — the history button lives in `Corner` and calls
	 * `lib/edge.ts` directly. So the rule went where the *state* is instead of where the
	 * buttons are: an effect watching whether the conversation is up.
	 *
	 * One direction only, deliberately. Closing the panel cannot reopen the conversation, so
	 * there is no cycle to guard against — and the other direction is handled by the one
	 * setter the panel has, below.
	 */
	createEffect(() => {
		if (historyShown() && narrow()) setBoardsOpen(false);
	});

	/** Open the panel, and on a phone put the conversation away to make room. */
	const showBoards = (open: boolean) => {
		setBoardsOpen(open);
		if (open && narrow()) closeHistory();
	};

	/*
	 * `⌘K` — which is what the full-screen board browser became.
	 *
	 * That modal covered the canvas you were looking at in order to help you find something
	 * on it, and the Deck tab is where it went. So the shortcut opens the panel, switches to
	 * that tab and puts the cursor in the search field: the same three keystrokes-worth of
	 * intent, without a sheet over the work.
	 *
	 * The composer's placeholder has promised this since before there was anything behind
	 * it, which is the other reason it is here rather than on a list of things to do.
	 */
	const [findAt, setFindAt] = createSignal(0);
	onMount(() => {
		const keys = (event: KeyboardEvent) => {
			if (event.key !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
			event.preventDefault();
			showBoards(true);
			setFindAt(Date.now());
		};
		window.addEventListener("keydown", keys);
		onCleanup(() => window.removeEventListener("keydown", keys));
	});

	/**
	 * Pull in from an edge and the surface on that side arrives (`canvas/edge-swipe.ts`).
	 *
	 * A swipe *opens*; it does not toggle. A gesture aimed at the edge a drawer comes from
	 * means "bring it", and answering an open drawer by putting it away would make one
	 * motion mean two opposite things depending on state nobody is looking at. The buttons
	 * in the two clusters stay the way back, and on a phone the sheet has its own swipe out
	 * (`chat/swipe-close.ts`).
	 *
	 * Off where a cursor can hover: the buttons are right there, and a laptop with a
	 * touchscreen would have two rules for one edge.
	 */
	const edgeSwipe = {
		enabled: () => !canHover(),
		left: () => showBoards(true),
		// The effect above closes the panel; a swipe only has to say what it wants.
		right: () => openHistory(),
	};

	/**
	 * Switch to an agent.
	 *
	 * Named, where it used to be written inline in the agents panel, because there are
	 * three ways in now — the pill's dropdown, a face in the top-right stack, and the `+n`
	 * chip — and three copies of seven steps is three chances to forget one.
	 *
	 * Switching moves the canvas, the camera, the panel, the transcript and the draft
	 * together, which is the whole reason there is no separate "observe": following an
	 * agent *is* switching to it.
	 */
	const focusAgent = (id: string) => {
		setState("focused", id);
		setUnread(id, 0);
		setAtTurn(undefined);
		setSeenAt(Date.now());
		// A component selected in a board another agent was holding is not your selection.
		setComponent(undefined);
		socket.send({ type: "agent.focus", id });
	};

	const flyTo = (board: Board) => {
		setSelected(board.path);
		const stage = document.querySelector(".stage");
		if (!stage) return;
		const view = { width: stage.clientWidth, height: stage.clientHeight };
		setCamera(fitInto([boxOf(board)], view, canvasBox(view)));
	};

	/**
	 * Open the conversation around a turn — the deck's scrub, which is what the spine is
	 * for.
	 *
	 * `atTurn` carries a timestamp as well as an id so that clicking the same block twice
	 * is a new request: the float keys its jump on both and would otherwise treat the
	 * second click as one it had already carried out.
	 */
	const scrubToTurn = (turn: { id: string }) => {
		setAtTurn({ id: turn.id, at: Date.now() });
		openHistory();
	};

	return (
		<div class="app">
			{/*
				No title bar.
				*
				* A canvas app should not spend a strip of every window on a logo, and the deck
				* mark was the only thing in it that could not be reached some other way. What
				* replaced its seven buttons: the two panel toggles became one button in the
				* pill below, the board browser became a tab in the panel it used to cover, the
				* conversation became the corner's history button, and the cheat sheet, the
				* settings and the theme became the three rows of the corner's overflow.
				*
				* The connection state went with the mark. It shows in the agent's own face
				* instead — a socket that is down is an agent that cannot be doing anything.
			*/}

			<div class="work">
				<Stage
					boards={stageBoards()}
					camera={camera()}
					setCamera={setCameraAndReport}
					selected={selected()}
					/*
					 * A press on the canvas outside the component lets it go.
					 *
					 * Every caller of this is the user pressing on bare stage or on a board's
					 * own title bar, and both of those are "not the component" — so the
					 * component selection goes with the board one rather than surviving it in
					 * a panel still describing something nobody is pointing at. Pressing
					 * *inside* a board is `Editor`'s to interpret, and it already clears the
					 * selection for a press that lands on no component; the chrome panels are
					 * not this handler's callers at all, which is what keeps a click on the
					 * inspector from dismissing the thing it is about.
					 */
					onSelect={(path) => {
						setSelected(path);
						setComponent(undefined);
					}}
					onMove={move}
					onHide={(path) => socket.send({ type: "board.hide", path })}
					nonces={state.nonces}
					cursor={state.cursor}
					onViewport={() => reportCamera(camera())}
					editor={editor}
					onTool={setTool}
					drops={drops}
					frameRevs={frameRevs}
					preview={state.preview?.boards}
					onEdgeSwipe={edgeSwipe}
				/>

				{/*
					The two top clusters, and the tools are inside the left one.

					`Palette` is gone as a free-standing float: it was already top-centre, and
					what it lacked was a row to be part of. With the bar deleted it sits at the
					same height as the agent and the camera, top centre goes empty — which is
					where notices land, and they had been dodging it — and there is one
					`data-inset="top"` where there were two.
				*/}
				<AgentPill
					chats={state.chats}
					identities={state.identities}
					focused={state.focused}
					unread={unread}
					onFocus={focusAgent}
					onNew={(kind) => socket.send({ type: "agent.create", ...(kind ? { kind } : {}) })}
					defaultKind={state.defaultKind}
					boardsOpen={boardsOpen()}
					onToggleBoards={() => showBoards(!boardsOpen())}
					tool={tool()}
					onTool={setTool}
					onUndo={() => {
						const path = selected() ?? component()?.path;
						if (!path) {
							notice("info", "Pick the board to undo on first.");
							return;
						}
						socket.send({ type: "board.undo", path });
					}}
				/>

				<Corner
					chats={state.chats}
					identities={state.identities}
					focused={state.focused}
					unread={unread}
					onFocus={focusAgent}
					onNew={(kind) => socket.send({ type: "agent.create", ...(kind ? { kind } : {}) })}
					defaultKind={state.defaultKind}
					zoom={camera().zoom}
					onZoom={(zoom) => setCamera((c) => ({ ...c, zoom }))}
					onFit={() => fitAll(stageBoards(), setCamera)}
					overflow={[
						{ label: "What you can do on the canvas", icon: Info, onPick: () => setOps(true) },
						{
							label: "Settings",
							icon: SettingsIcon,
							onPick: () => {
								setSettings(true);
								// Read on open rather than kept in step: every identity in the list comes
								// from the CLI, and the CLI's own login can change without the deck hearing.
								socket.send({ type: "claude.accounts" });
							},
						},
						{
							label: scheme() === "dark" ? "Switch to light" : "Switch to dark",
							icon: scheme() === "dark" ? Sun : Moon,
							onPick: () => toggleScheme(),
						},
					]}
				/>

				{/* The selection's properties. Same visibility rule as the palette — below
				    `INTERACT_ZOOM` a board takes no pointer events and nothing can be
				    selected — and off entirely while a past revision is being previewed,
				    which is a read-only view of a board that no longer exists (§6.7). */}
				<Inspector
					shape={shape()}
					visible={camera().zoom >= INTERACT_ZOOM && !state.preview}
					onEdit={inspect}
					pickFile={() => editor.pickFile(shape()?.path)}
					onClose={() => setComponent(undefined)}
				/>

				<Show when={ops()}>
					<CanvasOps onClose={() => setOps(false)} />
				</Show>

				<Show when={picking()}>
					{(request) => (
						<FilePicker
							onPick={(path) => request().resolve(path)}
							onCancel={() => request().resolve(undefined)}
							onAdd={(file) => addFile(request().board, file)}
						/>
					)}
				</Show>

				{/*
				 * Two panels where there was one, in the same corner and one at a time.
				 *
				 * The agent list and the boards an agent is holding were stacked inside a single
				 * surface, so opening either brought both — you scrolled past six chats to see a
				 * thumbnail, or past four thumbnails to switch agent. They answer different
				 * questions and now they are asked separately.
				 */}
				{/*
					One panel where there were two asides and a modal.

					The agent list moved into the pill's dropdown — a list you switch *with* is a
					selector, and a selector belongs on the thing it selects — and the board
					browser became this panel's second tab instead of a full-screen sheet over the
					canvas you were trying to look at.

					Mounted while folded, deliberately: it registers `⌘\`, and a `<Show>` here
					would take the shortcut away in exactly the state it exists for.
				*/}
				<LeftPanel
					boards={state.boards}
					current={selected()}
					inPlay={state.focused ? state.inPlay[state.focused] ?? [] : []}
					holdings={state.contexts}
					focused={state.focused}
					identities={state.identities}
					open={boardsOpen()}
					onOpenChange={showBoards}
					findAt={findAt()}
					onPick={(board) => {
						socket.send({ type: "board.play", path: board.path });
						flyTo(board);
					}}
				/>


				<Show when={settings()}>
					<Settings
						accounts={state.accounts}
						active={state.activeAccount}
						onAdd={() => socket.send({ type: "claude.accounts.add" })}
						onUse={(id) => socket.send({ type: "claude.accounts.use", id })}
						onForget={(id) => socket.send({ type: "claude.accounts.forget", id })}
						onClose={() => setSettings(false)}
					/>
				</Show>


				{/*
				 * The conversation: bubbles over the boards, and the only transcript there is.
				 *
				 * The 380px sheet that used to hold the full history is gone — see
				 * `FloatingTranscript` — so everything that could only be done in it, the time
				 * machine included, is addressed to a bubble now.
				 */}
				{/*
				 * The conversation: opaque cards over the boards, full height on the right.
				 *
				 * Not a panel and deliberately not an inset — the gaps between cards pass
				 * clicks through to whatever board is underneath, and a board is allowed to sit
				 * below it. The rule: a surface that arrives on its own must be subtracted, and
				 * one you summoned may overlap. Which is also why the inspector *is* an inset.
				 *
				 * Whether it is up is `lib/edge.ts`'s business, not this component's, because
				 * the same edge is wanted by the inspector and only one of them may have it.
				 */}
				<Stream
					items={transcript()}
					{...(atTurn() ? { scrollTo: atTurn()! } : {})}
					previewing={state.preview?.entryId ?? null}
					onPreview={(entryId) => {
						if (!state.focused) return;
						if (!entryId) {
							setState("preview", undefined);
							return;
						}
						socket.send({ type: "rewind.preview", id: state.focused, entryId });
					}}
					onRewind={(entryId) => {
						if (!state.focused) return;
						setState("preview", undefined);
						socket.send({ type: "rewind.to", id: state.focused, entryId });
					}}
					onFork={(entryId) => {
						if (!state.focused) return;
						setState("preview", undefined);
						socket.send({ type: "fork.from", id: state.focused, entryId });
					}}
					onRestore={(entryId) => {
						if (!state.focused) return;
						setState("preview", undefined);
						socket.send({ type: "boards.restore", id: state.focused, entryId });
					}}
				/>

				{/*
				 * The dock: a question if one is waiting, the status row, and the input bar.
				 *
				 * One bottom-centred stack, because these are the same conversation and should
				 * not be in three different places — and a stack rather than three offsets so
				 * that a question appearing pushes the rest up instead of landing on it.
				 *
				 * The status row keeps its height whether or not it has anything to say, which
				 * is the whole reason it is a row and not a chip that comes and goes: the box
				 * you type into must not move between turns.
				 */}
				<div class="dock">
					<Show when={state.dialog}>
						{(prompt) => (
							<Dialog
								prompt={prompt()}
								onAnswer={(answer) => {
									socket.send({
										type: "extension.ui.answer",
										answer: { id: prompt().id, ...answer } as never,
									});
									setState("dialog", undefined);
								}}
							/>
						)}
					</Show>

					<StatusLine
						state={focusedChat()?.state ?? "idle"}
						name={state.identities[state.focused ?? ""]?.name ?? focusedChat()?.name ?? "It"}
						agent={focusedChat()?.kind ?? state.defaultKind}
						{...(state.identities[state.focused ?? ""]?.color ? { color: state.identities[state.focused ?? ""]!.color } : {})}
					/>

					<Composer
						draft={draft()}
						busy={busy()}
						model={state.focused ? state.agentModel[state.focused] : undefined}
						models={state.focused ? state.modelsByAgent[state.focused] ?? [] : []}
						commands={focusedChat()?.commands ?? []}
						usage={state.focused ? state.agentUsage[state.focused] : undefined}
						onUsage={() => socket.send({ type: "agent.usage", id: state.focused ?? "" })}
						modes={focusedChat()?.capabilities?.modes ?? []}
						mode={focusedChat()?.mode}
						onMode={(mode) => socket.send({ type: "agent.setMode", id: state.focused ?? "", mode })}
						onSend={(text) => socket.send({ type: "agent.prompt", id: state.focused ?? "", text })}
						onAbort={() => socket.send({ type: "agent.abort", id: state.focused ?? "" })}
						/*
						 * `thinking` comes back with the model now. Switching to a model that does
						 * not offer the level you were on keeps the nearest one it does, and that
						 * decision is made in the picker — so it has to travel with the choice, or
						 * the server would hear two messages and apply them in either order.
						 */
						onModel={(provider, model, thinking) =>
							socket.send({
								type: "agent.setModel",
								id: state.focused ?? "",
								provider,
								model,
								...(thinking ? { thinking } : {}),
							})
						}
						onThinking={(thinking: ThinkingLevel) =>
							socket.send({ type: "agent.thinking", id: state.focused ?? "", thinking })
						}
						/*
						 * The paperclip opens the same picker the inspector's embed row does, and
						 * what it hands back is a deck path — so what it inserts is an `@` mention
						 * of a file, which is the one thing in this app a message can point at.
						 */
						onAttach={() => {
							void editor.pickFile(selected()).then((path) => {
								if (path) setDraft({ text: `@${path} `, at: Date.now() });
							});
						}}
					/>
				</div>


				{/* No zoombar. "Where am I looking" is a menu chip in the top-right cluster
				    now, which is one place for it and gives the bottom-right corner back. */}

				{/* No turn bar. It was a column of notches down the edge of the window, one per
				    turn, addressing the same messages the conversation already lists — and now
				    that a bubble carries its own rewind button, it was the same list drawn
				    twice. `scrubToTurn` survives it, because a notice can still ask to be
				    shown a turn. */}

				{/*
					Toasts. Utilities rather than a stylesheet rule, because none of this is a
					decision worth a name: it is a centred column of small cards over the canvas.

					The responsive rules are variants here rather than media queries in the
					stylesheet, because a utility outranks anything in the components layer — a
					`@media` block there would lose to the class beside it and silently do
					nothing. `pointer-coarse` drops the column below a title bar that grows to
					52px with a 44px palette in it, where 58px used to be clear; the narrow rule
					lets it span the screen instead of centring inside it.
				*/}
				<div class="notices pointer-events-none absolute top-[58px] left-1/2 flex max-w-[560px] -translate-x-1/2 flex-col gap-1.5 pointer-coarse:top-[74px] max-[760px]:right-3 max-[760px]:left-3 max-[760px]:max-w-none max-[760px]:translate-x-0">
					<For each={state.notices}>
						{(item) => (
							<div
								class="notice rounded-[10px] border border-line bg-panel px-3 py-[7px] text-[12px] shadow-panel data-[level=error]:border-danger/50 data-[level=warn]:border-warn/50"
								data-level={item.level}
							>
								{item.text}
							</div>
						)}
					</For>
				</div>

			</div>
		</div>
	);
}

/** A byte count as a person would say it, for a progress line. */
function sizeLabel(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${bytes} B`;
}

function fitAll(boards: Board[], setCamera: (camera: Camera) => void): void {
	const stage = document.querySelector(".stage");
	if (!stage) return;
	const view = { width: stage.clientWidth, height: stage.clientHeight };
	setCamera(fitInto(boards.map(boxOf), view, canvasBox(view)));
}
