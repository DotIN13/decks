import type {
	AgentState,
	Board,
	BoardPatch,
	Camera,
	Identity,
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
import type { EditorHost } from "./canvas/Editor.ts";
import { flow, guardDocumentDrops, isImage, shapeFor, type FileDropHost } from "./canvas/file-drop.ts";
import { Settings } from "./chat/Settings.tsx";
import { forgetAskedResults, receiveToolResult, setToolResultSender } from "./chat/tool-results.ts";
import { createAlerts } from "./app/alerts.ts";
import { handleFrame, type FrameHooks } from "./app/frames.ts";
import { createFileDrops } from "./app/files.ts";
import { createCameraReport } from "./app/camera-report.ts";
import { installKeys } from "./app/keys.ts";
import { type AgentRecord, createAgentScratch, emptyAgent } from "./state/agent.ts";
import { clearMarks, component, marks, mode, selected, setComponent, setMarks, setMode, setSelected, setTool, tool } from "./state/selection.ts";
import { on, send, start, started } from "./state/socket.ts";
import { clearDialog, clearPreview, dialog, preview, setState, state } from "./state/deck.ts";
import { notice, working } from "./state/notices.ts";
import {
	boardsMayStart,
	boardsOpen,
	boardsStarted,
	canvasOpened,
	draft,
	editingSource,
	ops,
	openSource,
	openUsage,
	picking,
	presenting,
	readUsage,
	setBoardsMayStart,
	setBoardsOpen,
	setDraft,
	setEditingSource,
	setOps,
	setPicking,
	setPresenting,
	setSettings,
	setUnread,
	setUsagePanel,
	setUsageReport,
	settings,
	unread,
	usagePanel,
	usageReport,
} from "./state/ui.ts";
import { canvasApiPresent, effectiveRenderer, loadRenderer, type RendererChoice, saveRenderer } from "./lib/renderer.ts";
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
import { Present } from "./canvas/Present.tsx";
import { StatusLine } from "./chat/StatusLine.tsx";
import { PAGE, prepend } from "./chat/history-page.ts";
import { Stream } from "./chat/Stream.tsx";
import { AgentPill } from "./chrome/AgentPill.tsx";
import { Corner } from "./chrome/Corner.tsx";
import { NoticeStrip } from "./chrome/NoticeStrip.tsx";
import { LeftPanel } from "./chrome/LeftPanel.tsx";
import { boxOf, fitInto, INTERACT_ZOOM, keepVisible, toWorld } from "./camera/camera.ts";
import { selectionOnSwitch, viewOnSwitch, viewToPark } from "./camera/agent-view.ts";
import { closeHistory, historyShown, openHistory, setInspectable, toggleHistory } from "./lib/edge.ts";
import { canvasBox, watchInsets } from "./camera/insets.ts";
import { embedPath, uploadAsset } from "./app/upload.ts";
import { canHover, NARROW } from "./lib/panels.ts";
import { blockPageZoom, obscured, trackVisualViewport, watchDock } from "./app/viewport.ts";
import {
	type AlertKind,
	type AlertPrefs,
	type Presence,
	finished,
	inView,
	loadPrefs,
	savePrefs,
	shouldNotify,
	shouldSound,
	startedAsking,
} from "./lib/alerts.ts";
import { scheme, toggleScheme } from "./lib/theme.ts";
import { UsageModal } from "./chat/UsageModal.tsx";

/**
 * The shell: a title bar, the stage, and the panels floating over it.
 *
 * All server state arrives on the socket and nothing is fetched twice — the
 * greeting after a connect is the whole deck, so a reconnect is a refresh. The
 * camera is the one piece of state that is the browser's alone; it is not sent
 * anywhere until an agent asks about it (M3).
 */
export function App() {
	/**
	 * The scratch half of an agent's state: real, and deliberately not drawn (`state/agent.ts`).
	 *
	 * Where it was carried before: `views` parked a camera, `historyHeld` and `historyAsked`
	 * guarded a request, `lastState` told a transition from a restatement. Each was a plain
	 * `Map` or `Set` rather than store state, for one reason each file spelled out — nothing
	 * renders from them, and a signal would re-run every reader on every change. That is still
	 * true, so they are still not reactive; they are merely in one place now.
	 */
	const scratch = createAgentScratch();

	/**
	 * The record for an agent, created if this is the first thing said about it.
	 *
	 * Every write below goes through here first, and it is not a nicety: Solid's store
	 * **throws** on a nested write whose parent is missing — `setState("agents", id, "model", …)`
	 * with no `agents[id]` raises `Cannot read properties of undefined`, for plain values and
	 * function updaters alike (measured). There is no single moment an agent first appears —
	 * `agent.identity`, `models`, `chat.history`, `context.changed` and four others all write
	 * into whichever field arrives first — so the alternative is remembering, twenty-two times,
	 * something the compiler cannot check.
	 */
	const ensureAgent = (id: string) => {
		if (!state.agents[id]) setState("agents", id, emptyAgent());
	};

	const [camera, setCamera] = createSignal<Camera>({ x: 0, y: 0, zoom: 1 });
	const zoomInteractive = createMemo(() => camera().zoom >= INTERACT_ZOOM);
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

	/**
	 * Readers waiting on a page of scrollback, keyed by the row they asked from.
	 *
	 * Keyed by the cursor rather than by the agent because the cursor is what the answer
	 * carries back, and two pages can be in flight when a reader keeps scrolling. The value
	 * is what the column is really waiting for: **how many rows arrived**, which is what it
	 * uses to hold the reader's place while the column grows above them.
	 */
	const earlierWaiting = new Map<string, (added: number) => void>();

	let opened = false;
	const appOpened = () => {
		if (opened) return;
		opened = true;
		requestAnimationFrame(() => requestAnimationFrame(() => setBoardsMayStart(true)));
	};

	/*
	 * A history is asked for when a chat is shown — opened, or mirrored on a board — rather
	 * than greeted: the greeting used to carry every chat's, 8.2 MB on the live deck, with the
	 * one on screen arriving last. The two flags live on the agent's scratch record, which is
	 * not reactive, because nothing is drawn from them; a reconnect clears both, since whatever
	 * the old connection was asked is not coming.
	 */
	const ensureHistory = (agentId: string | undefined) => {
		if (!agentId || !started()) return;
		const held = scratch.of(agentId);
		if (held.historyHeld || held.historyAsked) return;
		held.historyAsked = true;
		send({ type: "chat.open", agentId });
	};

	/**
	 * Reach back past what the browser holds (`chat/history-page.ts`).
	 *
	 * Resolves with how many rows arrived, and with zero for every case where nothing will:
	 * an empty conversation, a server that has already said there is nothing older, a
	 * request already in flight for this cursor, or an answer that never comes. A promise
	 * that resolves with nothing is what lets the column try again rather than deciding it
	 * has reached the beginning.
	 */
	const loadEarlier = (agentId: string): Promise<number> => {
		const held = state.agents[agentId]?.transcript ?? [];
		const before = held[0]?.id;
		if (!before || state.agents[agentId]?.moreHistory === false) return Promise.resolve(0);
		if (earlierWaiting.has(before)) return Promise.resolve(0);
		return new Promise<number>((resolve) => {
			earlierWaiting.set(before, resolve);
			send({ type: "chat.earlier", agentId, before, limit: PAGE });
			/*
			 * A dropped socket must not leave the column unable to ask again. Ten seconds is
			 * far longer than a read of a log file and short enough that a reader who has
			 * given up scrolling has not yet come back.
			 */
			setTimeout(() => {
				if (earlierWaiting.delete(before)) resolve(0);
			}, 10_000);
		});
	};

	/**
	 * How boards are drawn (`lib/renderer.ts`). The choice is remembered; what runs is the
	 * choice or `dom`, depending on whether this browser can draw an element into a canvas.
	 */
	const [rendererChoice, setRendererChoice] = createSignal<RendererChoice>(loadRenderer());
	const canvasApi = canvasApiPresent();
	const renderer = createMemo(() => effectiveRenderer(rendererChoice(), canvasApi));
	const setRenderer = (choice: RendererChoice) => {
		setRendererChoice(choice);
		saveRenderer(choice);
	};

	/*
	 * The alerts: a cue, a banner and a badge, and the three conditions behind them
	 * (`app/alerts.ts`). Wired here because `raise` is called from the frame switch below,
	 * and clicking a banner has to be able to switch conversations.
	 */
	const { prefs, setPrefs, raise } = createAlerts({ focusAgent: (id) => focusAgent(id) });

	/** What to call an agent in a banner, without making the sentence about an id. */
	const nameOf = (id: string | undefined) => (id ? (state.identities[id]?.name ?? "An agent") : "An agent");

	/*
	 * The state each agent was last in lives on its scratch record, so a change can be told
	 * from a restatement. Not reactive, and it must be read and written in the same tick the
	 * message arrives — a signal read here would see whatever the last flush left.
	 * Reconnection replays every agent's state, which is exactly the case `finished()` refuses
	 * on the grounds that the previous value is unknown.
	 */

	/*
	 * Start measuring the chrome.
	 *
	 * Before the socket, deliberately: the first `deck.state` can arrive with boards in it
	 * and trigger the opening fit, and a fit that runs before anything has been measured
	 * frames into the whole window and then never runs again.
	 */
	onMount(() => watchInsets());

	/*
	 * One reading at startup, so an agent knows the canvas before anybody pans.
	 *
	 * Until now the server only ever heard about the camera *after* a gesture: a session
	 * where the user asked one question and never touched the canvas reported nothing, and
	 * `stage.viewport()` had nothing to answer with. Read at fire time rather than now,
	 * because the deck arrives and fits itself in the first moments and this should carry
	 * where that left the camera, not the {0,0,1} it started at.
	 */
	onMount(() => {
		const timer = window.setTimeout(() => sendCamera(camera()), 400);
		onCleanup(() => clearTimeout(timer));
	});

	onMount(() => {
		start(() => {
			/* A reconnect means whatever the old connection was asked is not coming. */
			scratch.forgetAsked();
			forgetAskedResults();
		});
		// Whatever arrives or does not, the canvas is not held empty for longer than this.
		setTimeout(appOpened, 2500);
		// The chip knows the row; the conversation it is in is found here.
		setToolResultSender((itemId) => {
			const agentId = Object.keys(state.agents).find((id) => state.agents[id]?.transcript.some((item) => item.id === itemId));
			if (!agentId) return false;
			send({ type: "chat.tool", agentId, itemId });
			return true;
		});
		const off = on((message) => handleFrame(message, frames));
		onCleanup(off);
	});

	const move = (path: string, x: number, y: number) => {
		// Optimistic, and in place: the board is already where it was dropped, and the
		// server's answer confirms it. Replacing the object here would re-create the
		// row and reload the document that is sitting in it.
		const index = state.boards.findIndex((board) => board.path === path);
		if (index >= 0) setState("boards", index, { x, y });
		send({ type: "board.move", path, x, y });
	};

	const focusedChat = createMemo(() => state.chats.find((chat) => chat.id === state.focused));
	const transcript = createMemo(() => (state.focused ? state.agents[state.focused]?.transcript ?? [] : []));
	const busy = createMemo(() => {
		const chat = focusedChat();
		return chat ? chat.state !== "idle" : false;
	});

	/*
	 * Telling the server where the user is looking (`app/camera-report.ts`): the debounce, the
	 * reading, and the canvas size that rides with it.
	 */
	const report = createCameraReport({ read: camera, write: setCamera });
	const sendCamera = report.now;
	const setCameraAndReport = report.set;


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
		const playing = new Set(state.focused ? state.agents[state.focused]?.inPlay ?? [] : []);
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
		send({ type: "board.patch", path, rev, patches });
	};

	/*
	 * What `handleFrame` may touch (`app/frames.ts`): the things the component *writes* —
	 * the camera, the pins, the patch queue, the unread marks — plus the two readers a frame
	 * needs to answer a question with. Everything else the handler uses is a module.
	 */
	const frames: FrameHooks = {
		appOpened,
		ensureAgent,
		ensureHistory,
		hearBoard: (request, path) => files.hearBoard(request, path),
		scratch,
		earlierWaiting,
		selfRevs,
		patching,
		queued,
		setFrameRev: (path, rev) => setFrameRevs(path, rev),
		sendPatches,
		setCamera,
		sendCamera,
		setAtTurn,
		setSeenAt,
		raise,
		nameOf,
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
		undo: (path) => send({ type: "board.undo", path }),
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
		/*
		 * The whole of browse mode is this line.
		 *
		 * It was "are we zoomed in far enough": below `INTERACT_ZOOM` a frame takes no pointer
		 * events, so there is nothing to edit with. Browse mode is a second reason for the
		 * same gate to be shut — and because every listener in `Editor.ts` already consulted
		 * it, dragging, selecting, the handle and double-click-to-retype all stand down
		 * together with no new interception logic anywhere.
		 *
		 * What is *not* gated is what makes browse mode worth having: the frame still takes
		 * pointer events, so text selects and copies, and a board that is a game is playable.
		 */
		enabled: () => zoomInteractive() && mode() === "edit",
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
		setInspectable(shape() !== undefined && zoomInteractive() && !preview());
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
	/*
	 * Files arriving from outside: dropped, pasted, or picked (`app/files.ts`). Five routes,
	 * one destination — the bytes are copied into the deck's `assets/`.
	 */
	const files = createFileDrops({ editor, camera });
	const { addFile, drops, intoComposer, paste } = files;


	// A paste, and a drop that missed every board (`app/files.ts`).
	files.install({ preview });

	/** Bumped to say "put the cursor in the search field" — the panel watches it. */
	const [findAt, setFindAt] = createSignal(0);
	// The two app-wide shortcuts: `⌘K` to find a board, Escape to drop a selection.
	installKeys({ openBoards: () => showBoards(true), find: setFindAt });


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
		const leaving = state.focused;
		if (leaving === id) return;

		/*
		 * Park the view you are leaving, then take the one you are arriving at.
		 *
		 * The canvas has always been per agent — it is the focused agent's in-play set — while
		 * the camera was one value for the whole app, so switching swapped every board on
		 * screen and left the camera where the last conversation had it. Nothing refitted,
		 * because the only automatic fit runs once per page load: two agents in different
		 * corners of a deck meant coming back to one of them and looking at empty canvas
		 * thousands of pixels from anything.
		 *
		 * `agent-view.ts` owns the three cases and argues for them. In short: nothing on the
		 * canvas leaves the camera alone, a remembered view comes back *exactly*, and an agent
		 * with no memory gets a fit of what it holds.
		 */
		if (leaving) scratch.of(leaving).view = viewToPark(camera(), selected());

		setState("focused", id);
		setUnread(id, 0);
		setAtTurn(undefined);
		setSeenAt(Date.now());
		// A component selected in a board another agent was holding is not your selection.
		setComponent(undefined);

		const playing = state.agents[id]?.inPlay ?? [];
		const view = scratch.peek(id)?.view;
		const size = { width: window.innerWidth, height: window.innerHeight };
		const next = viewOnSwitch({ view, playing, boards: state.boards, viewport: size, region: canvasBox(size) });
		if (next) setCamera(next);
		/* The board selection follows the camera. It was global, which made it inconsistent
		   with the *component* selection three lines up — the two are the same kind of fact. */
		setSelected(selectionOnSwitch(view, playing));

		ensureHistory(id);
		setDraft(undefined);
		send({ type: "agent.focus", id });
	};

	/*
	 * Close a chat — the × on a row in the agent list.
	 *
	 * Nothing is cleaned up here on purpose. The server answers with `agent.removed`, which
	 * is where the transcript, identity and context kept for that id are dropped, and then
	 * an `agents` frame that carries the new list *and the new focus* — the registry moves it
	 * to the nearest row, so guessing at one here would be a second opinion about which
	 * conversation you are now in. A refusal comes back as a notice, which is the case the
	 * row's × is disabled to avoid: `closing()` in `agent-order.ts` draws it from the same
	 * rule `Registry.remove` enforces.
	 */
	const closeAgent = (id: string) => send({ type: "agent.remove", id });

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
				{/*
				 * Keyed on the renderer, so changing it in Settings rebuilds the stage: a board's
				 * document lives in a different element under each renderer, and moving an iframe
				 * reloads it anyway, so a clean remount is the honest version of the same cost.
				 */}
				<Show when={renderer()} keyed>
					{(current) => (
					<Stage
						renderer={current}
						boardsMayStart={boardsMayStart()}
						// The panel's list and the rail's thumbnails are less urgent: after the canvas.
						onBoardsStarted={canvasOpened}
						mode={mode()}
						marks={marks()}
						boards={stageBoards()}
						camera={camera()}
						setCamera={setCameraAndReport}
						selected={selected()}
						onPresent={(path, at) => setPresenting({ path, at })}
						onEditSource={openSource}
						{...(editingSource()
							? {
									editing: {
										path: editingSource()!.path,
										editing: {
											source: editingSource()!.source,
											onCommit: (text: string) => {
												const open = editingSource();
												setEditingSource(undefined);
												if (!open) return;
												const board = state.boards.find((candidate) => candidate.path === open.path);
												if (!board || text === open.source) return;
												send({ type: "board.patch", path: open.path, rev: board.rev, patches: [{ op: "source", text }] });
											},
											onCancel: () => setEditingSource(undefined),
										},
									},
								}
							: {})}
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
						onHide={(path) => send({ type: "board.hide", path })}
						nonces={state.nonces}
						cursor={state.cursor}
						onViewport={() => report.soon(camera())}
						onExtent={(path, extent) => send({ type: "board.extent", path, ...extent })}
						editor={editor}
						onTool={setTool}
						drops={drops}
						frameRevs={frameRevs}
						preview={preview()?.boards}
						/*
						 * A live board draws itself from a conversation this app is already
						 * holding — every agent's, not only the focused one, because the registry
						 * greets the browser with all of them. Accessors rather than values: which
						 * conversation a board wants is only known once it has loaded and asked.
						 */
						transcript={(agentId) => {
							// A mirror of a chat nobody has opened here asks for it, like opening it would.
							ensureHistory(agentId);
							return state.agents[agentId]?.transcript;
						}}
						webStatus={() => state.web}
						onWebReply={(reply) => {
							if (reply.decks === "live.web.answer") send({ type: "web.answer", id: reply.id, ok: reply.ok });
							else send({ type: "web.stop" });
						}}
						agentIdentity={(agentId) => {
							const identity = state.identities[agentId];
							return identity ? { name: identity.name, color: identity.color } : undefined;
						}}
						/* The canvas's own way out — Escape, over the canvas or inside a board. Clearing
						   the browser's copy is the whole of it: the server keeps no preview state,
						   which is also why a reload has always been an accidental escape hatch. */
						onLeavePreview={clearPreview}
						onEdgeSwipe={edgeSwipe}
					/>
					)}
				</Show>

				{/*
					The two top clusters, and the tools are inside the left one.

					`Palette` is gone as a free-standing float: it was already top-centre, and
					what it lacked was a row to be part of. With the bar deleted it sits at the
					same height as the agent and the camera, top centre goes empty — which is
					where notices land, and they had been dodging it — and there is one
					`data-inset="top"` where there were two.
				*/}
				<AgentPill
					mode={mode()}
					onMode={setMode}
					chats={state.chats}
					identities={state.identities}
					focused={state.focused}
					unread={unread}
					onFocus={focusAgent}
					onNew={(kind) => send({ type: "agent.create", ...(kind ? { kind } : {}) })}
					onClose={closeAgent}
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
						send({ type: "board.undo", path });
					}}
				/>

				<Corner
					chats={state.chats}
					identities={state.identities}
					focused={state.focused}
					unread={unread}
					onFocus={focusAgent}
					onNew={(kind) => send({ type: "agent.create", ...(kind ? { kind } : {}) })}
					onClose={closeAgent}
					defaultKind={state.defaultKind}
					zoom={camera().zoom}
					onZoom={(zoom) => setCamera((c) => ({ ...c, zoom }))}
					/*
					 * Fit what is *on the canvas*, not the whole deck.
					 *
					 * `stageBoards()` is already the focused agent's in-play set, so this was
					 * right — but the menu row said "Fit the whole deck", and a label that
					 * disagrees with the button is worse than either being wrong on its own. The
					 * deck can be 112 boards; the canvas is what you are looking at, and fitting
					 * it is what "where am I" means.
					 */
					onFit={() => fitAll(stageBoards(), setCamera)}
					onNewBoard={(format) => send({ type: "board.create", ...(format && format !== "component" ? { format } : {}) })}
					/*
					 * Off the canvas, one message per board, and *not* out of the context.
					 * `board.hide` has always drawn that line — the context is the agent's, and
					 * tidying the view must not strip what it is working from.
					 */
					onClearStage={() => {
						for (const board of stageBoards()) send({ type: "board.hide", path: board.path });
					}}
					onCanvas={stageBoards().length}
					/*
					 * The context reading, which used to be a dial under the input bar. It is a
					 * row of numbers in `⋯` now, and the corner's own button wears the warning.
					 */
					usage={state.focused ? state.agents[state.focused]?.usage : undefined}
					onContext={() => openUsage(state.focused)}
					overflow={[
						{ label: "Shortcuts", icon: Info, onPick: () => setOps(true) },
						{
							label: "Settings",
							icon: SettingsIcon,
							onPick: () => {
								setSettings(true);
								// Read on open rather than kept in step: every identity in the list comes
								// from the CLI, and the CLI's own login can change without the deck hearing.
								send({ type: "claude.accounts" });
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
					/* Edit-only: it is a properties panel, and a panel whose fields cannot be
					   applied is a panel that lies about what it does. */
					visible={zoomInteractive() && !preview() && mode() === "edit"}
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
					One panel where there were two asides and a modal — and one list in it.

					The agent list moved into the pill's dropdown — a list you switch *with* is a
					selector, and a selector belongs on the thing it selects — and the board browser
					stopped being a full-screen sheet over the canvas you were trying to look at.
					It was this panel's second tab for a while; it is the third section of its one
					list now, because Context and Deck were never two collections (`panel-groups.ts`).

					Mounted while folded, deliberately: it registers `⌘\`, and a `<Show>` here
					would take the shortcut away in exactly the state it exists for.
				*/}
				<LeftPanel
					boards={state.boards}
					listMayGrow={boardsStarted()}
					current={selected()}
					inPlay={state.focused ? state.agents[state.focused]?.inPlay ?? [] : []}
					holdings={state.contexts}
					focused={state.focused}
					open={boardsOpen()}
					onOpenChange={showBoards}
					findAt={findAt()}
					/*
					 * The Agents tab. The same three signals the corner and the dropdown already
					 * take, so the panel is not a second source of truth about who exists — and
					 * `focusAgent` rather than a bare `agent.focus`, because switching moves the
					 * canvas, the camera, the transcript and the draft together.
					 */
					chats={state.chats}
					identities={state.identities}
					unread={unread}
					onFocusAgent={focusAgent}
					onCloseAgent={closeAgent}
					onMirrorAgent={(id) => send({ type: "agent.mirror", agentId: id })}
					/* Your tags, which the agent cannot see or overwrite — a separate field from
					   `stage.me.setTags`, for the reason `protocol/Identity` gives. */
					onAgentTags={(id, tags) => send({ type: "agent.tags", id, tags })}
					onPick={(board) => {
						send({ type: "board.play", path: board.path });
						flyTo(board);
					}}
					/*
					 * Delete the file. The row asks twice before this is called (`BoardRow.tsx`).
					 *
					 * Nothing is cleaned up here on purpose: the board leaves the deck when the
					 * server says `board.changed … removed`, which is the same message the watcher
					 * sends when a board is deleted from a shell — so there is one path out of the
					 * deck rather than an optimistic one beside it. The selection and the canvas
					 * follow from that, where they already did.
					 */
					onDelete={(board) => send({ type: "board.delete", path: board.path })}
				/>


				{/*
					The usage panel — the plan, the spend, and what has been driving it.
					
					Drawn only while it is open *for the agent you are looking at*: the figures are
					one agent's, so a switch closes it instead of leaving this agent's name over the
					last one's plan.
					
					Its own `Show`, not nested in the settings one — which is where the modal it
					replaced first landed, so it could only open while Settings happened to be open
					too.
				*/}
				<Show when={usagePanel() && usagePanel() === state.focused}>
					<UsageModal
						usage={state.focused ? state.agents[state.focused]?.usage : undefined}
						report={usageReport().report}
						error={usageReport().error}
						loading={usageReport().loading}
						onRefresh={() => readUsage(state.focused)}
						onClose={() => setUsagePanel(undefined)}
					/>
				</Show>

				<Show when={settings()}>
					<Settings
						prefs={prefs()}
						onPrefs={setPrefs}
						accounts={state.accounts}
						active={state.activeAccount}
						onAdd={() => send({ type: "claude.accounts.add" })}
						onForget={(id) => send({ type: "claude.accounts.forget", id })}
						web={state.web}
						onWebRepair={() => send({ type: "web.repair" })}
						onWebStop={() => send({ type: "web.stop" })}
						onWebBoard={() => {
							send({ type: "web.board" });
							setSettings(false);
						}}
						renderer={rendererChoice()}
						onRenderer={setRenderer}
						canvasApi={canvasApi}
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
					/*
					 * Reaching back, in two parts: whether there is anything there, and how to
					 * ask for it. The column owns the window over what is held; the server owns
					 * everything older (`agents/store.ts`), and this is the seam between them.
					 */
					more={state.focused ? state.agents[state.focused]?.moreHistory === true : false}
					onEarlier={() => (state.focused ? loadEarlier(state.focused) : Promise.resolve(0))}
					agentId={state.focused ?? ""}
					state={focusedChat()?.state ?? "idle"}
					name={state.identities[state.focused ?? ""]?.name ?? focusedChat()?.name ?? "It"}
					agent={focusedChat()?.kind ?? state.defaultKind}
					{...(atTurn() ? { scrollTo: atTurn()! } : {})}
					previewing={preview()?.entryId ?? null}
					onPreview={(entryId) => {
						if (!state.focused) return;
						if (!entryId) {
							clearPreview();
							return;
						}
						send({ type: "rewind.preview", id: state.focused, entryId });
					}}
					onRewind={(entryId) => {
						if (!state.focused) return;
						clearPreview();
						send({ type: "rewind.to", id: state.focused, entryId });
					}}
					onFork={(entryId) => {
						if (!state.focused) return;
						clearPreview();
						send({ type: "fork.from", id: state.focused, entryId });
					}}
					onRestore={(entryId) => {
						if (!state.focused) return;
						clearPreview();
						send({ type: "boards.restore", id: state.focused, entryId });
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
					<Show when={dialog()}>
						{(prompt) => (
							<Dialog
								prompt={prompt()}
								onAnswer={(answer) => {
									send({
										type: "extension.ui.answer",
										answer: { id: prompt().id, ...answer } as never,
									});
									clearDialog();
								}}
							/>
						)}
					</Show>

					<StatusLine
						state={focusedChat()?.state ?? "idle"}
						name={state.identities[state.focused ?? ""]?.name ?? focusedChat()?.name ?? "It"}
						agent={focusedChat()?.kind ?? state.defaultKind}
					/>

					<Composer
						draft={draft()}
						agentId={state.focused}
						usage={state.focused ? state.agents[state.focused]?.usage : undefined}
						onUsage={() => openUsage(state.focused)}
						busy={busy()}
						model={state.focused ? state.agents[state.focused]?.model : undefined}
						models={state.focused ? state.agents[state.focused]?.models ?? [] : []}
						commands={focusedChat()?.commands ?? []}
						runtime={focusedChat()?.kind}
						modes={focusedChat()?.capabilities?.modes ?? []}
						mode={focusedChat()?.mode}
						onMode={(mode) => send({ type: "agent.setMode", id: state.focused ?? "", mode })}
						onSend={(text) => {
							/* A new turn clears what the last one pointed at — see `clearMarks`. */
							if (state.focused) clearMarks(state.focused);
							send({ type: "agent.prompt", id: state.focused ?? "", text });
						}}
						onAbort={() => send({ type: "agent.abort", id: state.focused ?? "" })}
						/*
						 * `thinking` comes back with the model now. Switching to a model that does
						 * not offer the level you were on keeps the nearest one it does, and that
						 * decision is made in the picker — so it has to travel with the choice, or
						 * the server would hear two messages and apply them in either order.
						 */
						onModel={(provider, model, thinking) =>
							send({
								type: "agent.setModel",
								id: state.focused ?? "",
								provider,
								model,
								...(thinking ? { thinking } : {}),
							})
						}
						onThinking={(thinking: ThinkingLevel) =>
							send({ type: "agent.thinking", id: state.focused ?? "", thinking })
						}
						/*
						 * Which subscription this conversation spends.
						 *
						 * Only for a Claude chat: the other runtimes have no Claude account, and a
						 * section offering to change one they do not have would be a control that
						 * does nothing. `agentId` is what makes the switch reach this agent alone —
						 * without it the server reads it as the default for the *next* one.
						 */
						{...(focusedChat()?.kind === "claude" && state.accounts.length > 1 ? { accounts: state.accounts } : {})}
						/* Falling back to the default, because that is what an agent with no entry in
						   the mapping is actually on — and a picker showing nothing selected reads
						   as "no subscription" rather than as "the list has not arrived". */
						account={(state.focused ? state.agents[state.focused]?.spending : undefined) ?? state.activeAccount}
						onAccount={(id: string) => send({ type: "claude.accounts.use", id, agentId: state.focused ?? "" })}
						/*
						 * The paperclip opens the same picker the inspector's embed row does, and
						 * what it hands back is a deck path — so what it inserts is an `@` mention
						 * of a file, which is the one thing in this app a message can point at.
						 */
						onAttach={() => {
							// Taken now: the picker can be open across a switch, and the mention is for
							// the conversation it was attached to. A deck path, not one relative to the
							// selected board — a message is not a board, and `@../assets/x.png` means
							// nothing to the agent reading it.
							const agentId = state.focused;
							void editor.pickFile(undefined).then((path) => {
								if (path) setDraft({ text: `@${path}`, at: Date.now(), insert: true, ...(agentId ? { agentId } : {}) });
							});
						}}
						onDraftTaken={() => setDraft(undefined)}
						onDropFiles={(files) => void intoComposer(files)}
					/>
				</div>


				{/*
					Presenting a deck: an overlay over the whole app, not a change to the canvas.
				
					Last in the tree so it is last in paint order, and mounted only while it is up —
					`Show` rather than a hidden layer, because the overlay captures the keyboard and one
					that is merely invisible would still be taking Escape.
				*/}
				<Show when={presenting()} keyed>
					{(showing) => {
						const board = () => state.boards.find((candidate) => candidate.path === showing.path);
						return (
							<Show when={board()} keyed>
								{(deck) => (
									<Present
										board={deck}
										at={showing.at}
										onExit={() => setPresenting(undefined)}
										onLeave={(at) => {
											// Put the canvas's own frame on the slide you finished on, so
											// leaving fullscreen is not a jump back in the talk.
											const frame = document.querySelector(
												`.board-node[data-path="${showing.path.replace(/"/g, '\\"')}"] iframe`,
											) as HTMLIFrameElement | null;
											(frame?.contentWindow as { __deck?: { go(n: number): void } } | null)?.__deck?.go(at);
										}}
									/>
								)}
							</Show>
						);
					}}
				</Show>

				{/* No zoombar. "Where am I looking" is a menu chip in the top-right cluster
				    now, which is one place for it and gives the bottom-right corner back. */}

				{/* No turn bar. It was a column of notches down the edge of the window, one per
				    turn, addressing the same messages the conversation already lists — and now
				    that a bubble carries its own rewind button, it was the same list drawn
				    twice. `scrubToTurn` survives it, because a notice can still ask to be
				    shown a turn. */}

				<NoticeStrip />

			</div>
		</div>
	);
}

function fitAll(boards: Board[], setCamera: (camera: Camera) => void): void {
	const stage = document.querySelector(".stage");
	if (!stage) return;
	const view = { width: stage.clientWidth, height: stage.clientHeight };
	setCamera(fitInto(boards.map(boxOf), view, canvasBox(view)));
}
