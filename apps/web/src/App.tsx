import type { AgentKind, Board, Camera, Identity, ThinkingLevel } from "@decks/protocol";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import Info from "lucide-solid/icons/info";
import Moon from "lucide-solid/icons/moon";
import SettingsIcon from "lucide-solid/icons/settings";
import Sun from "lucide-solid/icons/sun";
import {createEffect, createMemo, createSignal, on as watch, onCleanup, onMount, Show, untrack} from "solid-js";
import type { EditorHost } from "./canvas/Editor.ts";
import { Settings } from "./chat/Settings.tsx";
import {forgetAskedResults, setToolResultSender} from "./chat/tool-results.ts";
import type { Presenting } from "./state/ui.ts";
import { createAlerts } from "./app/alerts.ts";
import { camera, CLOSE_MS, GLIDE_MS, glide, LEAVE_BOARD_MS, moveCamera, OPEN_MS, reducedMotion, setCamera } from "./state/camera.ts";
import { cameraOntoPage } from "./camera/morph.ts";
import { createCanvasMorph, flyAlong } from "./app/canvas-morph.ts";
import { handleFrame, type FrameHooks } from "./app/frames.ts";
import { createFileDrops } from "./app/files.ts";
import { reportCamera, reportCameraSoon, setCameraAndReport } from "./app/camera-report.ts";
import { installKeys } from "./app/keys.ts";
import { scratch } from "./state/agent.ts";
import { ensureHistory, loadEarlier } from "./state/history.ts";
import { frameRevs, patchBoard } from "./state/patches.ts";
import {clearMarks, component, marks, mode, selected, setComponent, setMode, setSelected, setTool, tool} from "./state/selection.ts";
import { on, send, start } from "./state/socket.ts";
import { Icon } from "./ui/icons.tsx";
import {clearDialog, clearPreview, dialog, preview, runtimeFor, setState, state} from "./state/deck.ts";
import { notice } from "./state/notices.ts";
import {boardsMayStart, boardsOpen, boardsStarted, canvasOpened, focus, releaseBoards, draft, editingSource, ops, openSource, openUsage, picking, presenting, readUsage, setBoardsOpen, setDraft, setEditingSource, setFocus, setOps, setPicking, setPresenting, setSettings, setUnread, setUsagePanel, settings, unread, usagePanel, usageReport, surface, setSurface, dispatchTab, setDispatchTab, dispatchPreview, setDispatchPreview} from "./state/ui.ts";
import { installRoute, type Place } from "./app/route.ts";
import { destination, destinationLabel, DISPATCHER_NAME, stripMention } from "./app/send-from-bar.ts";
import { makeFloat } from "./chrome/float.ts";
import { DispatchView } from "./chrome/DispatchView.tsx";
import { isNews, wantsYou } from "./chrome/dispatch-view.ts";
import { canvasApiPresent, effectiveRenderer, loadRenderer, type RendererChoice, saveRenderer } from "./lib/renderer.ts";
import { FilePicker } from "./canvas/FilePicker.tsx";
import { applyLive, patchesFor, readShape, type Edit, type Shape } from "./canvas/inspect.ts";
import { Inspector } from "./canvas/Inspector.tsx";
import { InkBar } from "./chrome/InkBar.tsx";
import { pageKey } from "./chat/composer/parked.ts";
import { CommentPopup } from "./canvas/CommentPopup.tsx";
import { commentBlock, withComments } from "./canvas/comments.ts";
import { markComment, unmarkComments } from "./canvas/comment-select.ts";
import { addComment, commenting, removeComment, setCommenting, takeComments, waitingComments } from "./state/comments.ts";
import { drawing, setDrawing } from "./state/ink.ts";
import { CanvasOps } from "./canvas/CanvasOps.tsx";
import { firstCanvasIn, workspaceNames } from "./chrome/canvas-sections.ts";
import { Stage } from "./canvas/Stage.tsx";
import { Dialog } from "./chat/Dialog.tsx";
import { Composer } from "./chat/composer/Composer.tsx";
import { Present } from "./canvas/Present.tsx";
import { PresentEmbed } from "./canvas/PresentEmbed.tsx";
import { StatusLine } from "./chat/StatusLine.tsx";
import { Stream } from "./chat/Stream.tsx";
import { AgentPill } from "./chrome/AgentPill.tsx";
import { Corner } from "./chrome/Corner.tsx";
import { ArrivalChip } from "./canvas/ArrivalChip.tsx";
import { NoticeStrip } from "./chrome/NoticeStrip.tsx";
import { LeftPanel, type PanelTab } from "./chrome/LeftPanel.tsx";
import {boxOf, fitInto, INTERACT_ZOOM, keepVisible} from "./camera/camera.ts";
import { selectionOnSwitch, viewOnSwitch, viewToPark } from "./camera/agent-view.ts";
import { agentViews } from "./camera/agent-views.ts";
import {closeHistory, historyShown, openHistory, setInspectable} from "./state/edge.ts";
import { canvasBox, insets, watchInsets } from "./camera/insets.ts";
import { canHover, NARROW } from "./lib/media.ts";
import { installViewport, obscured } from "./app/viewport.ts";
import { scheme, toggleScheme } from "./lib/theme.ts";
import { UsageModal } from "./chat/UsageModal.tsx";
import { workingWords } from "./chat/working-sign.ts";

/**
 * The shell: a title bar, the stage, and the panels floating over it.
 *
 * All server state arrives on the socket and nothing is fetched twice — the
 * greeting after a connect is the whole deck, so a reconnect is a refresh. The
 * camera is the one piece of state that is the browser's alone; it is not sent
 * anywhere until an agent asks about it (M3).
 */
export function App() {
	// The camera itself is `state/camera.ts`; this is the one derived reading of it.
	const zoomInteractive = createMemo(() => camera().zoom >= INTERACT_ZOOM);
	/** The turn the chat was opened at, from a click on the spine. */
	const [atTurn, setAtTurn] = createSignal<{ id: string; at: number } | undefined>(undefined);

	/*
	 * The history window — asked for when a chat is shown, and reached back through on demand
	 * (`state/history.ts`). The map of waiting readers lives with the request it mints, which
	 * is why it is not part of the frame switch that answers it.
	 */

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

	/*
	 * The state each agent was last in lives on its scratch record, so a change can be told
	 * from a restatement. Not reactive, and it must be read and written in the same tick the
	 * message arrives — a signal read here would see whatever the last flush left.
	 * Reconnection replays every agent's state, which is exactly the case `finished()` refuses
	 * on the grounds that the previous value is unknown.
	 */

	/**
	 * The views this device has left behind, per conversation.
	 *
	 * Kept in `localStorage` rather than in the scratch record beside them (`agent-views.ts` says
	 * why): a view is a fact about the machine looking, not about the deck, so it survives a
	 * reload and belongs to this browser alone.
	 */
	const views = createMemo(() => agentViews(state.deck?.path ?? ""));

	/**
	 * Views of agents that are gone are dropped.
	 *
	 * The key is a map of agent id to view, and agents are removed all the time — a chat closed,
	 * a session deleted — so without this it grows by one entry per conversation ever had, for
	 * eyes that will never read them.
	 */
	createEffect(() => {
		const ids = state.chats.map((chat) => chat.id);
		if (ids.length > 0) views().retain(ids);
	});

	/**
	 * The view you are in when the page goes away.
	 *
	 * Views are parked when you switch conversations, which covers everything except the one you
	 * were in when the tab was closed or reloaded — and that is exactly the conversation a reload
	 * is about, so without this the camera would come back for every chat but the one you left.
	 *
	 * `pagehide` rather than `beforeunload`: it fires on a reload, on a navigate, and when a phone
	 * puts the page away, which is where `beforeunload` famously does not.
	 */
	onMount(() => {
		const park = () => {
			const id = state.focused;
			if (id) views().keep(id, viewToPark(camera(), selected()));
		};
		addEventListener("pagehide", park);
		onCleanup(() => removeEventListener("pagehide", park));
	});

	/*
	 * Where the person is, from the hash.
	 *
	 * The middle of the window is one of two surfaces: the dispatch dashboard, or an agent's
	 * stage. Neither is set by a gesture directly. A gesture writes the hash through `go`,
	 * and the one place that reads the hash sets the signals, so a press, the browser's Back
	 * button, a reload and a pasted link all arrive by the same road. The stage's agent is
	 * `state.focused`, which the server owns: arriving at `?agent=x` asks for x the way a
	 * row in the panel does, and the camera comes back from `agent-views.ts` as it always has.
	 */
	const [routeAgent, setRouteAgent] = createSignal<string | undefined>();
	/** The canvas the hash names: the place, where the agent is only who is being addressed on it. */
	const [routeCanvas, setRouteCanvas] = createSignal<string | undefined>();
	/*
	 * Opening a canvas grows it out of the card that was pressed, and going Home shrinks it back
	 * in (`app/canvas-morph.ts`). `morphing` tells the surface not to slide its layers while the
	 * camera is doing the moving; `arriving` is the canvas whose boards the camera is waiting for.
	 */
	const morph = createCanvasMorph({ deckPath: () => state.deck?.path ?? "", stage: () => document.querySelector(".stage"), camera });
	const [morphing, setMorphing] = createSignal(false);
	let morphDone: ReturnType<typeof setTimeout> | undefined;
	const morphFor = (ms: number) => {
		setMorphing(true);
		clearTimeout(morphDone);
		morphDone = setTimeout(() => setMorphing(false), ms + 120);
	};
	let arriving: { id: string; at: number } | undefined;
	/** The place last applied, so a delayed switch can tell whether it is still wanted. */
	let currentPlace: Place | undefined;
	/** How long a canvas is given to produce a board to land on, before the camera is left alone. */
	const LAND_WINDOW = 6000;
	/**
	 * The canvas asked for has its boards: land on it — out of the card when a card was pressed,
	 * else straight to where it was left or a fit. Once per arrival, not on every board change.
	 *
	 * **Given up on after a few seconds**, and that is the whole of a bug worth naming. A canvas
	 * with nothing on it has nowhere to land, so `arrived` says no and the request stays
	 * outstanding — and every later change to what is on the canvas asks again. On a shared
	 * canvas that later change is somebody *else* putting a board up, minutes on, and the answer
	 * then is a camera that flies to a stored view while you are reading something. An arrival
	 * is a moment, so it expires.
	 */
	const landCanvas = () => {
		if (!arriving || arriving.id !== state.canvas) return;
		// Only done asking once it has somewhere to land: a canvas arrives before its boards do.
		if (morph.arrived(arriving.id, stageBoards()) || Date.now() - arriving.at > LAND_WINDOW) arriving = undefined;
	};
	const applyPlace = (place: Place) => {
		currentPlace = place;
		// Read before anything sets it: whether we are leaving a canvas we were looking at.
		const wasOnStage = surface() === "stage";
		if (place.surface === "dispatch") {
			const leaving = wasOnStage ? state.canvas : undefined;
			if (leaving) {
				morphFor(CLOSE_MS);
				morph.leave(leaving, stageBoards(), () => {
					// Only if nothing else moved in the meantime: a second press wins.
					if (currentPlace?.surface === "dispatch") setSurface("dispatch");
				});
			} else setSurface("dispatch");
			setDispatchTab(place.tab);
			setDispatchPreview(place.board);
			setRouteAgent(undefined);
			setRouteCanvas(undefined);
			return;
		}
		setSurface("stage");
		setDispatchPreview(undefined);
		/*
		 * A stage is a canvas, always.
		 *
		 * Opening one is a frame of its own: the server answers this socket with that canvas's
		 * boards and clears its changed mark. Who you are talking to rides on the same place —
		 * `?agent=` — and changing it does not touch the room, which is why an agent switch is
		 * a `replace` and a canvas switch is a push.
		 */
		setRouteAgent(place.agent);
		setRouteCanvas(place.canvas);
		/*
		 * Keep where the canvas being left was looking, for the next time it is opened — but
		 * only when we were looking at it. Coming back through the dashboard, the camera has
		 * already flown into the card by now, and `morph.leave` parked the real view on the
		 * way out; parking again here wrote the shrunken card camera over it, and the next
		 * open of that canvas landed at one percent with the boards in the corner.
		 */
		if (wasOnStage && state.canvas && state.canvas !== place.canvas) morph.keep(state.canvas, camera());
		/*
		 * Whether this is an *arrival*, which is what decides if the camera lands.
		 *
		 * Two ways in: the canvas changed, or the stage did — coming back from the dashboard
		 * is an arrival even when it is the same room, because going Home flew the camera
		 * into that room's card (`morph.leave`) and left it there. Without this the second
		 * opening of a canvas showed its boards shrunk into the corner the card had been in,
		 * which is the camera nobody moved rather than the camera going wrong.
		 *
		 * And *not* an arrival when only `?agent=` changed. A canvas is not re-landed because
		 * you addressed somebody else: the boards did not move, and a camera that jumped on
		 * every switch would be the room moving under the conversation.
		 */
		const room = place.canvas !== state.canvas;
		if (room || !wasOnStage) arriving = { id: place.canvas, at: Date.now() };
		if (room) send({ type: "canvas.focus", id: place.canvas });
		else landCanvas();
		/*
		 * The room is the place; the agent is who the composer addresses in it. Told to the
		 * server only when it is somebody else, so opening a canvas with the same agent on
		 * screen is one frame rather than two.
		 */
		if (place.agent && place.agent !== state.focused) {
			requested = place.agent;
			focusAgent(place.agent);
		}
	};
	/*
	 * The stage follows the server's focus, and the hash follows the stage.
	 *
	 * Focus is the server's: closing the conversation on screen moves it to the nearest row,
	 * and a `#/agent/x` for an x that does not exist is answered with whoever is focused.
	 * Either way the canvas already shows that agent, so the hash is replaced to say so
	 * rather than left naming one that is not there. A change we asked for ourselves is
	 * not a correction: `requested` is the id a route asked for, and its answer is skipped.
	 */
	let requested: string | undefined;
	createEffect(
		watch(
			() => state.focused,
			(id) => {
				if (surface() !== "stage" || !id) return;
				if (requested) {
					if (id === requested) requested = undefined;
					return;
				}
				const canvas = state.canvas ?? routeCanvas();
				if (canvas && id !== routeAgent()) go({ surface: "stage", canvas, agent: id }, { replace: true });
			},
			{ defer: true },
		),
	);
	createEffect(
		watch(
			() => state.chats.map((chat) => chat.id).join(","),
			() => {
				// The roster arrived without the agent a route asked for: the ask is over.
				if (!requested || state.chats.length === 0 || state.chats.some((chat) => chat.id === requested)) return;
				requested = undefined;
				const canvas = state.canvas ?? routeCanvas();
				if (surface() === "stage" && state.focused && canvas) go({ surface: "stage", canvas, agent: state.focused }, { replace: true });
			},
			{ defer: true },
		),
	);
	/*
	 * Reading a board is what takes its "changed" mark off the dashboard: its preview there, or
	 * the focus view on a stage. Said once per opening; the server ignores a board already read
	 * since its last write, and the next write brings the mark back.
	 */
	createEffect(
		watch(
			() => {
				const path = surface() === "dispatch" ? dispatchPreview() : focus();
				// The file's time is part of the key: a board rewritten while it is open is still
				// being read, so the mark must not come back under the reader's eyes.
				return path ? `${state.boards.find((board) => board.path === path)?.modifiedAt ?? 0}|${path}` : undefined;
			},
			(key) => {
				if (key) send({ type: "board.seen", path: key.slice(key.indexOf("|") + 1) });
			},
		),
	);
	/* Installed once the socket is open (below, with the frame handler): landing on
	   `#/canvas/x` asks the server for x, and a send before `start` is a throw. */
	let route: ReturnType<typeof installRoute> | undefined;
	const go = (place: Place, options?: { replace?: boolean }) => route?.go(place, options);
	/** The canvas somebody looked at most recently, which is where a stage with nothing else to go on lands. */
	const lastOpenedCanvas = () => [...state.canvases].sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))[0];
	/**
	 * The canvas an agent is working on now, when it is one that still exists.
	 *
	 * The server says so on the chat row and on every `context.changed`, and the agent moves
	 * itself with `stage.canvas(name)`, so this follows the agent rather than the reader.
	 */
	const workingOn = (id: string) => {
		const canvas = state.agents[id]?.canvas;
		return canvas && state.canvases.some((one) => one.id === canvas) ? canvas : undefined;
	};
	/**
	 * Which room to open for an agent.
	 *
	 * An agent is on every canvas it has worked in, so this is a preference rather than a
	 * lookup: the room you are already in if it is one of its, then the one of its rooms
	 * opened most recently, then wherever you were. `undefined` means the deck has no canvas
	 * at all yet, and the caller makes one.
	 */
	const canvasFor = (agentId?: string): string | undefined => {
		if (agentId) {
			const now = workingOn(agentId);
			if (now) return now;
			const here = state.canvases.find((canvas) => canvas.id === state.canvas && canvas.agents.includes(agentId));
			if (here) return here.id;
			const theirs = state.canvases.filter((canvas) => canvas.agents.includes(agentId)).sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))[0];
			if (theirs) return theirs.id;
		}
		return state.canvas ?? lastOpenedCanvas()?.id;
	};
	/**
	 * Who to address on a canvas the server has not made yet.
	 *
	 * `canvas.create` answers with the whole list and says which one this browser is now on;
	 * the effect below is what turns that into a place. An empty string is "open it, with
	 * nobody named", which is what the pill's own `+` means.
	 */
	let openingWith: string | undefined;
	/**
	 * A new canvas, opened when `open` says who to talk to there, in `workspace` when one is given.
	 *
	 * Named after the workspace when it is the first canvas in it — the room a project opens
	 * with is the project's — and "Canvas n" otherwise, out of the way of every name in use.
	 */
	const newCanvas = (open?: string, workspace?: string, o?: { stay?: boolean }) => {
		// By slug, as the server tells names apart: "Political LLM" and `political-llm` are one name.
		const key = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
		const taken = new Set(state.canvases.map((canvas) => key(canvas.name)));
		let name: string;
		if (workspace && !taken.has(key(workspace))) name = workspace;
		else {
			let n = 1;
			while (taken.has(`canvas-${n}`)) n += 1;
			name = `Canvas ${n}`;
		}
		// Opened, so the name can be typed where it will be read, with whoever you were talking to —
		// unless the caller says to stay: a new workspace is made from the dashboard, and its first
		// canvas appearing under a new heading is the whole point of making it there.
		openingWith = o?.stay ? undefined : (open ?? state.focused ?? "");
		send({ type: "canvas.create", name, ...(workspace ? { workspace } : {}) });
	};
	/** A stage, from anywhere. Switching agent while already on one replaces the entry, so five presses are one Back. */
	const openStage = (id: string) => {
		const canvas = canvasFor(id);
		if (!canvas) {
			// Nothing to stand on: the first canvas is made, and opened with this agent on it.
			newCanvas(id);
			return;
		}
		go({ surface: "stage", canvas, agent: id }, { replace: surface() === "stage" });
	};
	/**
	 * Go to an agent: to the canvas it is working on, and talk to it there.
	 *
	 * **Agents are the way in, and an agent's room is where its work is.** Its row in the
	 * Agents tab, its face in the toolbar and in the corner all land here, from a stage or from
	 * the dashboard, and all three go to the canvas the agent is on now: the one it chose with
	 * `stage.canvas`, or the one it was handed work on. Pressing the agent you are already with,
	 * in the room it is in, moves nothing.
	 *
	 * An agent that has shown nothing yet is on no canvas, and is addressed without moving you
	 * when you are in a room, or — from the dashboard, or when it declared a workspace — in the
	 * first room of its project, which is where its first board will land.
	 */
	const visitAgent = (id: string) => {
		const replace = surface() === "stage";
		const canvas = workingOn(id);
		if (canvas) {
			go({ surface: "stage", canvas, agent: id }, { replace });
			return;
		}
		const workspace = state.identities[id]?.workspace;
		const here = surface() === "stage" ? state.canvases.find((one) => one.id === state.canvas) : undefined;
		if (here && (!workspace || here.workspace === workspace)) {
			go({ surface: "stage", canvas: here.id, agent: id }, { replace: true });
			return;
		}
		if (!workspace) {
			openStage(id);
			return;
		}
		const room = firstCanvasIn(state.canvases, workspace);
		if (room) {
			go({ surface: "stage", canvas: room.id, agent: id }, { replace });
			return;
		}
		newCanvas(id, workspace);
	};
	const addressAgent = visitAgent;
	/*
	 * The view follows the agent you are talking to when it moves itself.
	 *
	 * An agent moves with `stage.useCanvas` or `stage.newCanvas`, and pressing it goes to where
	 * it is — so the room you are in should be where it went, not where it was. Without this the
	 * person stayed behind, and their next line brought the agent back (`canvas.use` before a
	 * prompt), which undid the move it had just made. Only a move by the same agent counts:
	 * switching agent is `visitAgent`'s business, and a move into the room you are already in
	 * is no move at all. A canvas made in the same breath can reach the list a frame after the
	 * move does, so the follow waits for it rather than landing on a room that is not there yet.
	 */
	let followed: { agent: string; canvas?: string } | undefined;
	createEffect(() => {
		const agent = state.focused;
		const canvas = agent ? state.agents[agent]?.canvas : undefined;
		const listed = !!canvas && state.canvases.some((one) => one.id === canvas);
		untrack(() => {
			if (!agent) {
				followed = undefined;
				return;
			}
			if (canvas && !listed) return;
			const last = followed;
			followed = { agent, ...(canvas ? { canvas } : {}) };
			if (!canvas || !last || last.agent !== agent || last.canvas === canvas) return;
			if (surface() !== "stage" || state.canvas === canvas) return;
			go({ surface: "stage", canvas, agent });
		});
	});
	/** Open a canvas, keeping whoever you are talking to: the room changes, the conversation does not. */
	const openCanvas = (id: string, options?: { replace?: boolean }) =>
		go({ surface: "stage", canvas: id, ...(state.focused ? { agent: state.focused } : {}) }, options);
	/** Back to the dashboard, on the tab it was left on. */
	const goHome = () => go({ surface: "dispatch", tab: dispatchTab() });
	/*
	 * A canvas the server has just put this browser on becomes the place.
	 *
	 * The server answers `canvas.create` with the list and a `focused` id, and a made canvas
	 * is one nobody has a hash for yet. On a stage the hash is corrected to whatever the
	 * server says we are looking at; on the dashboard nothing moves unless the canvas was
	 * made in order to be opened.
	 */
	createEffect(
		watch(
			() => state.canvas,
			(id) => {
				const opening = openingWith;
				openingWith = undefined;
				if (!id) return;
				if (opening !== undefined) {
					go({ surface: "stage", canvas: id, ...(opening ? { agent: opening } : {}) });
					return;
				}
				if (surface() !== "stage" || id === routeCanvas()) return;
				go({ surface: "stage", canvas: id, ...(state.focused ? { agent: state.focused } : {}) }, { replace: true });
			},
			{ defer: true },
		),
	);
	/*
	 * A stage always has a canvas, so a hash naming one that is gone is not a blank screen.
	 *
	 * The likeliest way in is an old link or a canvas somebody deleted from another browser.
	 * Waits for the list to exist — it arrives second in the greeting, before any board — and
	 * then lands on the canvas last opened, or goes Home when the deck has none at all.
	 */
	createEffect(() => {
		if (surface() !== "stage") return;
		const id = routeCanvas();
		if (!id || state.canvases.length === 0) return;
		if (state.canvases.some((canvas) => canvas.id === id)) return;
		const fallback = lastOpenedCanvas();
		if (fallback) openCanvas(fallback.id, { replace: true });
		else goHome();
	});
	/*
	 * Escape goes Home from a stage, and ⌘1 ⌘2 ⌘3 pick a dashboard tab.
	 *
	 * After everything that owns Escape ahead of this: a field, a dialog, a selection
	 * (`app/keys.ts`), the conversation when it is showing, a board being presented. Only a
	 * stage with nothing to let go of goes back to the dashboard.
	 */
	onMount(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			const target = event.target as HTMLElement | null;
			const inField = !!target?.closest?.("input, textarea, select, [contenteditable]");
			if ((event.metaKey || event.ctrlKey) && !event.altKey && ["1", "2", "3"].includes(event.key) && surface() === "dispatch" && !inField) {
				event.preventDefault();
				const tab = ({ "1": "canvases", "2": "tasks", "3": "cron" } as const)[event.key as "1" | "2" | "3"];
				go({ surface: "dispatch", tab });
				return;
			}
			if (event.key !== "Escape" || inField) return;
			if (surface() !== "stage") return;
			// Everything that owns Escape on a stage keeps it: a selection, a dialog, a board
			// being presented or read in the focus view, the conversation, the source editor,
			// the file picker, settings, the cheat sheet and the usage panel.
			if (component() || dialog() || presenting() || historyShown() || focus() || editingSource() || picking() || settings() || ops() || usagePanel()) return;
			event.preventDefault();
			goHome();
		};
		window.addEventListener("keydown", onKeyDown);
		onCleanup(() => window.removeEventListener("keydown", onKeyDown));
	});

	/*
	 * The bar's destination, decided in one place.
	 *
	 * Where a line lands depends on which surface is up, who is focused, and whether the
	 * text names an agent. The word on the bar is this same function run without sending,
	 * so the label and the frame cannot disagree. `barText` is what the composer holds right
	 * now, reported on every keystroke, so an @ name changes the word as it is typed.
	 */
	const [barText, setBarText] = createSignal("");
	/*
	 * The dispatcher: the agent behind the dashboard's bar. Made by the server, one per
	 * deck, and kept out of every list a person picks an agent from — `visibleChats` is what
	 * the sidebar, the pill and the corner draw. On the dashboard the bar, its model picker
	 * and the conversation float are the dispatcher's; on a stage they are the focused
	 * agent's. `barAgent` is that one switch.
	 */
	/*
	 * Two dispatchers to tell apart. The **template** is the one with no parent: it never
	 * places anything, it holds the model, thinking and mode the composer sets on the
	 * dashboard, and every task's dispatcher is spawned from it. A **task's dispatcher** is
	 * a child of the template, one per task, and its transcript is that task's log: the
	 * float on the dashboard shows the one whose row was last opened, else the template.
	 */
	/* One template per runtime that has been chosen (`RuntimeMenu`); the bar's is the chosen one. */
	const dispatcherId = createMemo(() => {
		const templates = state.chats.filter((chat) => chat.role === "dispatcher" && !chat.parentId);
		const wanted = state.settings.dispatcherKind ?? state.defaultKind;
		return (templates.find((chat) => chat.kind === wanted) ?? templates[0])?.id;
	});
	const visibleChats = createMemo(() => state.chats.filter((chat) => chat.role !== "dispatcher"));
	const [logAgent, setLogAgent] = createSignal<string | undefined>(undefined);
	const barAgent = () => (surface() === "dispatch" ? dispatcherId() : state.focused);
	const barChat = createMemo(() => state.chats.find((chat) => chat.id === barAgent()));
	const streamAgent = () => (surface() === "dispatch" ? (logAgent() && state.chats.some((chat) => chat.id === logAgent()) ? logAgent() : dispatcherId()) : state.focused);
	const streamChat = createMemo(() => state.chats.find((chat) => chat.id === streamAgent()));
	const agentName = (id: string) => state.identities[id]?.name ?? state.chats.find((chat) => chat.id === id)?.name ?? id;
	/*
	 * Who the composer's chip was set to, on this stage: an agent, or the dispatcher.
	 *
	 * Kept apart from `state.focused` on purpose. Focusing an agent is *following* it now — the
	 * pill's face takes you to the canvas it works on and keeps up as it moves — and the chip is
	 * the other direction: the line carries this canvas with it, and the agent comes here. So a
	 * pick in the chip changes only where the next line goes, and it lasts until the agent you
	 * follow or the room changes, which is when the question is asked afresh.
	 */
	const [addressed, setAddressed] = createSignal<{ id: string } | "dispatcher" | undefined>();
	createEffect(() => {
		void state.focused;
		void state.canvas;
		setAddressed(undefined);
	});
	const barContext = () => {
		const focusedId = state.focused;
		const nameOf = agentName;
		const open = state.canvases.find((canvas) => canvas.id === state.canvas);
		const to = addressed();
		const addressedAgent = to && to !== "dispatcher" && state.chats.some((chat) => chat.id === to.id) ? { id: to.id, name: nameOf(to.id) } : undefined;
		return {
			surface: surface(),
			...(focusedId ? { focused: { id: focusedId, name: nameOf(focusedId) } } : {}),
			...(open ? { canvas: { id: open.id, name: open.name } } : {}),
			agents: visibleChats().map((chat) => ({ id: chat.id, name: nameOf(chat.id) })),
			...(to === "dispatcher" ? { addressed: "dispatcher" as const } : addressedAgent ? { addressed: addressedAgent } : {}),
		};
	};
	const sendFromBar = (typed: string, commentIds: string[] = []) => {
		const dest = destination(typed, barContext());
		/*
		 * The comments whose pills were in the field go in front of the words, whoever the words
		 * are for, and stop waiting. They are kept under the agent whose canvas they were made
		 * on, which is the focused one: the only place a comment can be made is its stage.
		 */
		// In the order their pills sat in the text, which is the order `[comment n]` counts in.
		const held = state.focused && commentIds.length > 0 ? takeComments(state.focused) : [];
		const notes = commentIds.flatMap((id) => held.filter((note) => note.id === id));
		unmarkComments(notes.map((note) => note.id));
		const text = withComments(typed, notes);
		switch (dest.kind) {
			case "task":
				send({
					type: "task.create",
					task: { text: dest.named ? withComments(stripMention(typed, DISPATCHER_NAME), notes) : text, ...(dest.canvas ? { canvas: dest.canvas.id } : {}) },
					requestedBy: "you",
				});
				// From a stage nothing on screen changes, so it is said: the task is on the dashboard.
				if (surface() === "stage") notice("info", dest.canvas ? `Handed to the dispatcher, for ${dest.canvas.name}. Whoever takes it works here.` : "Handed to the dispatcher. It is on the dashboard's Tasks tab.");
				return;
			case "prompt": {
				const line = dest.named ? withComments(stripMention(typed, dest.name), notes) : text;
				if (dest.id === state.focused) clearMarks(dest.id);
				/*
				 * Named in a room: the agent is brought to this canvas before it hears the line, so
				 * what it puts up lands here. The order on the wire is the order it happens in.
				 */
				if (dest.canvas) send({ type: "canvas.use", agentId: dest.id, canvasId: dest.canvas.id });
				send({ type: "agent.prompt", id: dest.id, text: line });
				return;
			}
			case "note":
				notice("info", "Notes on a component are not built yet.");
				return;
			default:
				notice("info", "Pick an agent first, or go Home and dispatch it.");
		}
	};

	/*
	 * A comment on selected words (`canvas/comments.ts`), ending one of the two ways the popup
	 * offers. Kept, it becomes a pill in the input bar, to go with this agent's next message,
	 * and its words stay marked on the board. Sent, it is a message of its own, to the agent whose canvas this is,
	 * and a busy agent takes it as steering exactly as it takes a typed line.
	 */
	const endComment = (text: string, how: "keep" | "send") => {
		const target = commenting();
		const agentId = state.focused;
		if (!target || !agentId) return;
		const note = { id: `c${Date.now().toString(36)}`, board: target.path, quote: target.quote, text, at: Date.now(), ...(target.component ? { component: target.component } : {}) };
		if (how === "keep") {
			addComment(agentId, note);
			markComment(note.id, target.range);
			// Handed to the composer the way a dropped file is: a one-shot draft, here a pill.
			setDraft({ text: "", at: Date.now(), insert: true, agentId, comment: note.id });
		} else {
			clearMarks(agentId);
			send({ type: "agent.prompt", id: agentId, text: commentBlock([note]) });
		}
		target.frame.contentDocument?.getSelection()?.removeAllRanges();
		setCommenting(undefined);
	};
	/* The popup belongs to browsing with the pen down; anything else puts it away. */
	createEffect(() => {
		if (mode() !== "browse" || drawing() || surface() !== "stage") setCommenting(undefined);
	});

	/*
	 * The two floats: the composer and the conversation.
	 *
	 * Both are the app's own chrome, kept where they are by default. Taken by the grip or
	 * the header they go where they are put, clamped to the surface, snapping home within
	 * 24px, remembered per person in localStorage as a corner and an offset so a narrower
	 * window keeps them on screen. Neither is an inset: a float over the canvas does not move
	 * what is centred on the canvas, which is the rule `camera/insets.ts` keeps.
	 */
	let dockEl: HTMLDivElement | undefined;
	/** How much of a put-away composer still shows: the tab that brings it back. */
	const STOW_TAB = 36;
	let unstowComposer = () => {};
	let streamEl: HTMLElement | undefined;
	/*
	 * The canvas column the floats may move in. The insets come from the signal, not from
	 * the `--inset-*` variables: the variables are written after the signal settles, so an
	 * effect on `insets()` that read them got the previous fold's numbers, and a float
	 * parked on the left stood still when the sidebar folded and then moved when it opened.
	 */
	const workBox = () => {
		const work = document.querySelector(".work");
		const rect = work?.getBoundingClientRect();
		const { left, right } = insets();
		return { x: left, y: 0, w: (rect?.width ?? window.innerWidth) - left - right, h: rect?.height ?? window.innerHeight };
	};
	const floatsOff = () => window.innerWidth < 1100;
	/* Under a finger the conversation stands on the composer and is not dragged (`shell.css`). */
	const coarse = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : undefined;
	const conversationFixed = () => floatsOff() || coarse?.matches === true;
	/*
	 * `pin: "bottom"` writes the position as a `bottom` rather than a `top`. The composer is
	 * a column whose status row comes and goes above the box (it leaves when the conversation
	 * opens), and pinned by its top the box slid up into the row's place. Pinned by its
	 * bottom, the box stays where it was put and the row appears above it, which is what the
	 * dock's own CSS does at home. `read` is what a drag then starts from, because the top
	 * the float remembers is stale the moment the height changes.
	 */
	const mountFloat = (el: HTMLElement, key: string, handle: HTMLElement, ignore: string, home: () => { x: number; y: number }, pin: "top" | "bottom" = "top", stow?: { tab: number }, off: () => boolean = floatsOff) =>
		makeFloat(el, {
			...(stow ? { stow } : {}),
			key,
			handle,
			ignore,
			home,
			bounds: workBox,
			size: () => ({ w: el.offsetWidth, h: el.offsetHeight }),
			disabled: off,
			pin,
			read: () => ({ x: el.offsetLeft, y: el.offsetTop }),
			apply: (p, atHome, stowed) => {
				/*
				 * Put away, everything but the tab is out of reach as well as out of sight:
				 * `inert`, so Tab does not walk into a text box that is off the screen.
				 */
				el.toggleAttribute("data-stowed", stowed);
				for (const child of el.children) if (!child.classList.contains("dock-stowtab")) child.toggleAttribute("inert", stowed);
				if (atHome || !p) {
					el.removeAttribute("data-floating");
					el.style.left = "";
					el.style.top = "";
					el.style.bottom = "";
					return;
				}
				el.setAttribute("data-floating", "true");
				el.style.left = `${p.x}px`;
				if (pin === "bottom") {
					el.style.top = "";
					el.style.bottom = `${workBox().h - (p.y + el.offsetHeight)}px`;
				} else {
					el.style.bottom = "";
					el.style.top = `${p.y}px`;
				}
			},
		});
	onMount(() => {
		const dock = dockEl;
		const handle = dock?.querySelector<HTMLElement>(".dockbox");
		if (!dock || !handle) return;
		const float = mountFloat(dock, "composer", handle, "[data-slot='composer-input'], textarea, input, button, select, a, [role='menu'], [role='listbox'], .sendbtn", () => {
			const box = workBox();
			return { x: box.x + box.w / 2 - dock.offsetWidth / 2, y: box.h - dock.offsetHeight - 12 };
		}, "bottom", { tab: STOW_TAB });
		unstowComposer = () => float.unstow();
		/*
		 * Two things bring it back on their own, because both are the app asking for the
		 * person's attention *in the bar*: a question that needs an answer, and a line put
		 * into the box for them (a comment on a component, a dropped file).
		 */
		createEffect(() => {
			if ((dialog() || draft()) && float.stowed()) float.unstow();
		});
		/* The bounds are the canvas column, which is measured after mount and moves when the
		   sidebar folds. A float restored against the wrong column sits 264px to the left. */
		createEffect(() => {
			insets();
			float.restore();
		});
		/* How tall the composer is, as a variable: the focus view pads its foot by it so a
		   page scrolls clear of the bar. Measured, because the bar grows with its text. */
		if (typeof ResizeObserver !== "undefined") {
			const publish = () => document.documentElement.style.setProperty("--dock-h", `${Math.round(dock.getBoundingClientRect().height)}px`);
			const watcher = new ResizeObserver(publish);
			watcher.observe(dock);
			publish();
			onCleanup(() => watcher.disconnect());
		}
		onCleanup(() => float.dispose());
	});
	const mountStreamFloat = (head: HTMLDivElement) => {
		const stream = streamEl ?? (head.closest(".stream") as HTMLElement | null);
		if (!stream) return;
		const float = mountFloat(stream, "conversation", head, "button, a", () => {
			const box = workBox();
			// The panel's own CSS: `right: 12px`, `top: 64px` (the gutter is 0 once it is a panel).
			return { x: box.x + box.w - stream.offsetWidth - 12, y: 64 };
		}, "top", undefined, conversationFixed);
		createEffect(() => {
			insets();
			float.restore();
		});
		onCleanup(() => float.dispose());
	};

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
		const timer = window.setTimeout(() => reportCamera(camera()), 400);
		onCleanup(() => clearTimeout(timer));
	});

	onMount(() => {
		start(() => {
			/* A reconnect means whatever the old connection was asked is not coming. */
			scratch.forgetAsked();
			forgetAskedResults();
		});
		// Whatever arrives or does not, the canvas is not held empty for longer than this.
		setTimeout(releaseBoards, 2500);
		// The chip knows the row; the conversation it is in is found here.
		setToolResultSender((itemId) => {
			const agentId = Object.keys(state.agents).find((id) => state.agents[id]?.transcript.some((item) => item.id === itemId));
			if (!agentId) return false;
			send({ type: "chat.tool", agentId, itemId });
			return true;
		});
		const off = on((message) => handleFrame(message, frames));
		onCleanup(off);
		route = installRoute({ onPlace: applyPlace });
		onCleanup(() => route?.dispose());
	});

	/**
	 * Where the canvas should be looking when this conversation's boards arrive.
	 *
	 * The view this device left it in, or a fit of what it holds — `viewOnSwitch` decides, and
	 * `undefined` there means "nothing on the canvas", which leaves the canvas alone.
	 */
	/**
	 * Where the canvas looks after a switch, once the switch has actually happened.
	 *
	 * `switchAgent` asks for it; this answers — with the boards as the new conversation has them,
	 * where the remembered view can be checked against what is really there. Nothing is left
	 * waiting by a switch that is followed by another: `awaiting` is an id, and the second switch
	 * replaces it before either answer arrives.
	 */
	const landed = () => {
		const id = awaiting;
		if (!id || id !== state.focused) return;
		awaiting = undefined;
		const playing = state.agents[id]?.inPlay ?? [];
		const view = views().of(id);
		const size = { width: window.innerWidth, height: window.innerHeight };
		const next = viewOnSwitch({ view, playing, boards: state.boards, viewport: size, region: canvasBox(size) });
		if (next) setCamera(next);
		/* The board selection follows the camera. It was global, which made it inconsistent
		   with the *component* selection — the two are the same kind of fact. */
		setSelected(selectionOnSwitch(view, playing));
	};

	/** The conversation a switch is waiting for the canvas of — see `landed`. */
	let awaiting: string | undefined;

	const openingCamera = createMemo(() => {
		const id = state.focused;
		if (!id) return undefined;
		const size = { width: window.innerWidth, height: window.innerHeight };
		return viewOnSwitch({
			view: views().of(id),
			playing: state.agents[id]?.inPlay ?? [],
			boards: state.boards,
			viewport: size,
			region: canvasBox(size),
		});
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
	/* The conversation float shows whoever the bar addresses: the dispatcher on the
	   dashboard, the focused agent on a stage. Its history is asked for when it is shown. */
	const transcript = createMemo(() => {
		const id = streamAgent();
		return id ? state.agents[id]?.transcript ?? [] : [];
	});
	createEffect(() => {
		if (historyShown()) ensureHistory(streamAgent());
	});
	const busy = createMemo(() => {
		const chat = focusedChat();
		return chat ? chat.state !== "idle" : false;
	});

	/*
	 * Telling the server where the user is looking (`app/camera-report.ts`): the debounce, the
	 * reading, and the canvas size that rides with it.
	 */


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
	/**
	 * The canvas the stage is drawing: the one this browser opened, else the one the focused chat
	 * works on. Its arrows and groups are drawn under the boards.
	 */
	const stageCanvas = createMemo(() => state.canvases.find((one) => one.id === state.canvas) ?? state.canvases.find((one) => !!state.focused && one.agents.includes(state.focused)));

	const stageBoards = createMemo(() => {
		/*
		 * What is on the canvas, from the canvas — and from the focused chat when this browser
		 * has not opened one.
		 *
		 * The canvas is what holds the boards, so a window that has opened one draws its list
		 * whoever it is talking to, and two agents working there draw the same thing. Without
		 * a canvas this is what it always was: the focused conversation's own set.
		 */
		const canvas = state.canvases.find((one) => one.id === state.canvas);
		const playing = new Set(canvas ? canvas.boards : state.focused ? (state.agents[state.focused]?.inPlay ?? []) : []);
		return state.boards.filter((board) => playing.has(board.path));
	});

	/*
	 * A canvas that was asked for has arrived — the server has said this browser is on it, and
	 * its boards came with that — so the camera lands on it. Tracked on both, because the boards
	 * are what decide where to land and the canvas is what says they are the right ones.
	 */
	createEffect(() => {
		void state.canvas;
		void stageBoards();
		untrack(landCanvas);
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

	/*
	 * What `handleFrame` may touch (`app/frames.ts`). **Three fields**, and each has a reason
	 * to be here: a request registry `app/files.ts` owns and mints, a signal whose one reader
	 * is the conversation column, and behaviour that needs the component's own `focusAgent`.
	 * Everything else the handler uses it imports — the camera, the patch queue, the store.
	 */
	const frames: FrameHooks = {
		hearBoard: (request, path) => files.hearBoard(request, path),
		setAtTurn,
		raise,
		landed,
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
		patch: (path, patches) => patchBoard(path, patches),
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
	/**
	 * Which board the focus view would show: the selected one, or the one being looked at.
	 *
	 * The selection first, because that is what a person has just pointed at. Otherwise the
	 * board nearest the middle of the view, which is the one in front of them — the alternative
	 * was "the first in the deck", which is a board they may not be able to see.
	 */
	const focusTarget = (): string | undefined => {
		const chosen = selected();
		if (chosen) return chosen;
		const at = camera();
		let best: { path: string; away: number } | undefined;
		for (const board of stageBoards()) {
			const away = Math.hypot(board.x + board.w / 2 - at.x, board.y + board.h / 2 - at.y);
			if (!best || away < best.away) best = { path: board.path, away };
		}
		return best?.path;
	};

	/**
	 * The focus view on or off — one key (`d`), one button, and Escape to come back.
	 *
	 * Nothing to show is a sentence rather than a mode with an empty page in it: with no boards
	 * at all the view has nothing to be a view *of*, and a canvas that went blank on a keypress
	 * and needed the same key to come back would read as a fault.
	 */
	/*
	 * Opening a board is the camera arriving, and the page taking over on the last frame.
	 *
	 * The reading view is not a camera trick — the canvas stops being drawn and a page is laid
	 * out — so the arrival has to end *exactly* where that page will be (`cameraOntoPage`), at the
	 * same scale, and then the page replaces the canvas with nothing to see. The camera you had is
	 * kept, and the way out flies back to it rather than to a fit, so the canvas is where you put
	 * it down. `GLIDE_MS` in, a little less out; nothing but the swap with reduced motion.
	 */
	let focusReturn: { camera: Camera; path: string } | undefined;
	const stageGeometry = () => {
		const stageEl = document.querySelector(".stage");
		if (!stageEl) return undefined;
		const rect = stageEl.getBoundingClientRect();
		const style = getComputedStyle(stageEl);
		const px = (name: string, fallback: number) => {
			const value = parseFloat(style.getPropertyValue(name));
			return Number.isFinite(value) ? value : fallback;
		};
		return { view: { width: rect.width, height: rect.height }, insets: { left: px("--inset-left", 0), right: px("--inset-right", 0), top: px("--inset-top", 52) } };
	};
	const enterFocus = (path: string) => {
		const board = stageBoards().find((one) => one.path === path);
		const geometry = stageGeometry();
		if (!board || !geometry || reducedMotion()) {
			setFocus(path);
			return;
		}
		focusReturn = { camera: camera(), path };
		flyAlong(camera(), cameraOntoPage(board, geometry.view, geometry.insets), boxOf(board), geometry.view, GLIDE_MS, () => {
			// Only if nothing else was asked for while it flew.
			if (focusReturn?.path === path) setFocus(path);
		});
	};
	const leaveFocus = () => {
		const back = focusReturn;
		focusReturn = undefined;
		setFocus(undefined);
		const board = back ? stageBoards().find((one) => one.path === back.path) : undefined;
		const geometry = stageGeometry();
		if (!back || !board || !geometry || reducedMotion()) return;
		flyAlong(camera(), back.camera, boxOf(board), geometry.view, LEAVE_BOARD_MS);
	};

	const toggleFocus = (wanted?: string) => {
		// The board's own button names it, so that path wins; the key and the rule behind it
		// pass nothing and get the target below.
		const path = wanted ?? focusTarget();
		if (focus() !== undefined && (focus() === path || wanted === undefined)) {
			leaveFocus();
			return;
		}
		if (!path) {
			notice("warn", "No board to focus. Put one on the canvas first.");
			return;
		}
		enterFocus(path);
	};

	/**
	 * A selected box's file as something to fill the window with.
	 *
	 * The overlay is told what the *box* said — the path, the page range — rather than being
	 * handed the frame's document, because it mounts its own frame on the file's URL and has
	 * nothing of the board's to read it from (`canvas/PresentEmbed.tsx`). The board is named
	 * too: an embed's path is relative to the board that wrote it, which is exactly what
	 * `urlFor` in `lib/board.js` and `embedUrl` in `lib/api.ts` both need.
	 */
	const embedPresenting = (box: Shape): Presenting => ({
		kind: "embed",
		board: box.path,
		raw: box.attrs["data-embed"] ?? "",
		...(box.attrs["data-pages"] === undefined ? {} : { pages: box.attrs["data-pages"] }),
		title: `${box.attrs["data-embed"] ?? "file"} — ${box.id}`,
	});

	/**
	 * What fullscreen means *now*: the embed in the selected box, or the board.
	 *
	 * One key with one meaning per level — `f` fullscreens the selection if it is an embed and
	 * the board otherwise — and it is answered here because the selection is this component's.
	 * The stage knows which board, and the box is a `Shape` the inspector is already reading.
	 * The path check is the load-bearing part: a box selected on *another* board must not
	 * change what `f` does to this one.
	 */
	const presentingFor = (path: string, at: number): Presenting => {
		const box = shape();
		if (box && box.path === path && box.family === "embed" && box.attrs["data-embed"]) return embedPresenting(box);
		return { kind: "board", path, at };
	};

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
	const files = createFileDrops({ editor });
	const { addFile, drops, intoComposer, paste } = files;


	// A paste, and a drop that missed every board (`app/files.ts`).
	files.install({ preview });
	// The window's own facts: the on-screen keyboard, the page-zoom block, the dock's height.
	installViewport();

	/** Bumped to say "put the cursor in the search field" — the panel watches it. */
	const [findAt, setFindAt] = createSignal(0);
	// The two app-wide shortcuts: `⌘K` to find a board, Escape to drop a selection.
	installKeys({ openBoards: () => showBoards(true), find: setFindAt });


	/*
	 * Opening the conversation is the act of having read it.
	 *
	 * An effect rather than a step inside every opener, which is what it used to be — there
	 * were three routes in and each had to remember to clear the badge. Now `state/edge.ts`
	 * owns whether the column is up, and this watches that one fact: however it came to be
	 * open, the agent on screen stops being unread.
	 *
	 * Which matters more than tidiness, because unread is no longer only a badge. A face in
	 * the top-right corner is *green* while a finished turn has not been read, and that is
	 * the whole signal — so a missed clear leaves a light on for something you are looking
	 * at.
	 */


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
	 * `state/edge.ts` directly. So the rule went where the *state* is instead of where the
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
	/** The Agents tab of the panel, asked for by the agent list's overflow row. */
	const [panelAsk, setPanelAsk] = createSignal<{ tab: PanelTab; at: number } | undefined>();
	const openAgentsPanel = () => {
		showBoards(true);
		setPanelAsk({ tab: "agents", at: Date.now() });
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
	 * **In a room, switching changes the conversation and nothing else.** The boards belong
	 * to the canvas and so does the camera, so who you are talking to is a change of
	 * addressee: the transcript, the unread count and the draft follow the agent, while the
	 * view, the boards and the selection stay where they are. Off a canvas — which is only
	 * the moment before one opens — the old per-agent camera still applies.
	 */
	const focusAgent = (id: string) => {
		const leaving = state.focused;
		if (leaving === id) return;
		/* The hash is set before this runs (`applyPlace`), so a switch made on the way into a
		   room counts as being in one: the canvas is about to land the camera itself. */
		const inRoom = Boolean(routeCanvas() ?? state.canvas);

		/*
		 * Park the view you are leaving, then take the one you are arriving at.
		 *
		 * Only where the canvas is the agent's own, which on a stage it no longer is. Two
		 * agents in a room look at one arrangement, so a camera that jumped when you
		 * addressed somebody else would be the room moving under the conversation; the view
		 * a room is left in is kept against the *canvas* instead (`app/canvas-morph.ts`).
		 *
		 * `agent-view.ts` owns the three cases and argues for them. In short: nothing on the
		 * canvas leaves the camera alone, a remembered view comes back *exactly*, and an agent
		 * with no memory gets a fit of what it holds.
		 */
		if (!inRoom && leaving) views().keep(leaving, viewToPark(camera(), selected()));

		setState("focused", id);
		setUnread(id, 0);
		// A component selected in a board another agent was holding is not your selection —
		// unless the board is the room's, in which case neither is the selection.
		if (!inRoom) setComponent(undefined);

		/*
		 * The camera and the selection wait for the canvas itself.
		 *
		 * `agent.focus` is answered with the whole deck as the *new* stage sees it, and where the
		 * boards are is half of what `viewOnSwitch` decides on — a remembered view that no longer
		 * shows one of its own boards is a fit instead. Deciding it here would decide it against
		 * the conversation being left, which is the one arrangement that is definitely not the one
		 * about to be shown. `landed` is the other half.
		 */
		if (!inRoom) awaiting = id;

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
		flyToBoards([board], { animate: true });
	};

	/**
	 * Put a board on the canvas and fly to it — **after** the server has said where it landed.
	 *
	 * A board joining a canvas is placed beside the boards already on it (`deck/place.ts`), so the
	 * place it had a moment ago is not where it will be: on a deck this app has been used on for a
	 * while, every board carries a place from the old deck-wide layout, hundreds of thousands of
	 * pixels down. Flying to the board as it is *now* would land the camera on empty canvas and
	 * leave the board off screen, which is the bug this fixes rather than a race worth ignoring.
	 *
	 * So the flight waits for two frames from the server, in the order they are sent: the deck
	 * state, which carries the new place, and the context, which says the board is on the canvas.
	 */
	const [framing, setFraming] = createSignal<{ path: string; asked: number } | undefined>();
	/** Fly to a board once the server has placed it and put it on the canvas. */
	const frameWhenPlaced = (path: string) => setFraming({ path, asked: Date.now() });
	const playAndFrame = (path: string) => {
		send({ type: "board.play", path });
		frameWhenPlaced(path);
	};
	createEffect(() => {
		const wanted = framing();
		if (!wanted) return;
		/* Given up on after ten seconds, so a board that never arrives cannot fly the camera
		   somewhere a minute later, when the person is reading something else. */
		if (Date.now() - wanted.asked > 10_000) {
			setFraming(undefined);
			return;
		}
		/*
		 * On the canvas, which is the room's list rather than the agent's.
		 *
		 * A board you put up while looking at a canvas is placed by the canvas
		 * (`canvas/stage.ts`), so the agent's in-play set never moves and a flight that waited
		 * for it waited forever: the board arrived half a million pixels away and the camera
		 * stayed where it was.
		 */
		if (!stageBoards().some((one) => one.path === wanted.path)) return;
		const board = state.boards.find((one) => one.path === wanted.path);
		if (!board) return;
		setFraming(undefined);
		flyTo(board);
	});

	/*
	 * Frame these boards, whatever they are: the camera moves to hold them all.
	 *
	 * A function over a list rather than one board, because the two things that fly — a row in
	 * the rail, and a board a link on another board opened (below) — both want the same
	 * arithmetic, and the second one wants the *pair*: a board that arrives beside the one you
	 * were reading is only useful if you can see it is beside it.
	 *
	 * `animate` is what the two of them ask for and nothing else does: after a link or a press a
	 * camera that *arrives* says which way it went, where a camera that jumps leaves you to work
	 * out how the board you are now looking at relates to the one you were. `fitAll` below stays
	 * instant, because a keyboard shortcut is a hand and a chat switch is a change of context.
	 */
	const flyToBoards = (boards: Board[], options?: { animate?: boolean }) => {
		if (boards.length === 0) return;
		const stage = document.querySelector(".stage");
		if (!stage) return;
		const view = { width: stage.clientWidth, height: stage.clientHeight };
		moveCamera(fitInto(boards.map(boxOf), view, canvasBox(view)), options);
	};

	/**
	 * A link **on a board** that points at another board — the app's half of it.
	 *
	 * Returns whether the deck had that board, because the board itself cannot open one: the
	 * canvas is the app's to arrange. A path the deck does not hold is a broken link, and the
	 * one answer that is any use is saying so.
	 *
	 * **Placed, not stacked.** A board that arrives on top of the one the reader is reading is
	 * a board they then have to drag apart; so it lands to the right of the link's own board,
	 * and both are framed, because the pair is the thing being looked at. Only when it is not
	 * already on the canvas: a board the user put somewhere is theirs, and following a link is
	 * not a reason to move it.
	 */
	const openLinkedBoard = (path: string, from: string): boolean => {
		const board = state.boards.find((one) => one.path === path);
		if (!board) {
			notice("warn", `No board at ${path} — the link points at something this deck does not have.`);
			return false;
		}
		const playing = new Set(state.focused ? state.agents[state.focused]?.inPlay ?? [] : []);
		const source = state.boards.find((one) => one.path === from);
		const opening = !playing.has(path);
		if (opening && source) move(path, source.x + source.w + 32, source.y);
		send({ type: "board.play", path });
		setSelected(path);
		setComponent(undefined);
		flyToBoards(source ? [source, board] : [board], { animate: true });
		return true;
	};

	/**
	 * A component on a board carrying code was pressed.
	 *
	 * The board posts the name of its code block; the frame's own path goes with it, and the
	 * server reads the code out of that board's file, asks once whether this board is trusted,
	 * and runs it with the stage API (`apps/server/src/wire/boards.ts`). Nothing to draw here:
	 * the run announces itself in the focused conversation, and whatever becomes visible is
	 * the board's own code doing it through `stage`.
	 */
	const evalBoard = (path: string, id: string, value: unknown): void => {
		send({ type: "board.eval", path, id, ...(value !== undefined ? { value } : {}) });
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
				<div class="surface" data-surface={surface()} data-morph={morphing() ? "true" : undefined}>
					{/*
					 * The dashboard in front by default, the stage behind it, and a press slides
					 * one over the other. The layer behind is `data-hidden` and `inert`, the same
					 * two attributes the canvas uses for its world behind the focus view: a `Show`
					 * here would tear down every board document to reach the dashboard.
					 */}
					<div class="surface-layer" data-layer="dispatch" data-hidden={surface() === "dispatch" ? undefined : "true"} inert={surface() === "dispatch" ? undefined : true} aria-hidden={surface() !== "dispatch"}>
						<DispatchView
							tab={dispatchTab()}
							onTab={(tab) => go({ surface: "dispatch", tab })}
							boards={state.boards}
							identities={state.identities}
							canvases={state.canvases}
							onOpenCanvas={(canvas, card) => {
								morph.open(canvas.id, card);
								morphFor(OPEN_MS);
								openCanvas(canvas.id);
							}}
							onNewCanvas={(workspace) => newCanvas(undefined, workspace)}
							onRenameCanvas={(id, name) => send({ type: "canvas.rename", id, name })}
							onMoveCanvas={(id, workspace) => send({ type: "canvas.workspace", id, workspace })}
							onRemoveCanvas={(id) => send({ type: "canvas.remove", id })}
							workspaces={workspaceNames(state.canvases, state.identities)}
							/* Named as typed and filed under the server's slug of it, which is what the heading will say. */
							onNewWorkspace={(name) => newCanvas(undefined, name, { stay: true })}
							chats={visibleChats()}
							contexts={state.contexts}
							tasks={state.tasks}
							schedules={state.schedules}
							onOpenLog={(id) => {
								setLogAgent(id);
								openHistory();
							}}
							preview={dispatchPreview()}
							onPreview={(path) => go({ surface: "dispatch", tab: dispatchTab(), ...(path ? { board: path } : {}) })}
							onOpenOnCanvas={(path) => {
								/* Whoever holds it, else the agent you were last with. `agent.focus` goes
								   first on the wire, so the play is attributed to the right stage. */
								const holder = Object.entries(state.contexts).find(([, paths]) => paths.includes(path))?.[0] ?? state.focused;
								if (!holder) {
									notice("info", "No agent to open it with. Make one first.");
									return;
								}
								openStage(holder);
								playAndFrame(path);
							}}
							onOpenAgent={addressAgent}
							onCancelTask={(id) => send({ type: "task.cancel", id })}
							onRetryTask={(id) => send({ type: "task.retry", id })}
							onRunSchedule={(id) => send({ type: "schedule.run", id })}
							onCancelSchedule={(id) => send({ type: "schedule.cancel", id })}
						/>
					</div>
					<div class="surface-layer" data-layer="stage" data-hidden={surface() === "stage" ? undefined : "true"} inert={surface() === "stage" ? undefined : true} aria-hidden={surface() !== "stage"}>
				<Show when={renderer()} keyed>
					{(current) => (
					<Stage
						renderer={current}
						/*
						 * Where the canvas opens, decided here rather than in the canvas.
						 *
						 * `viewOnSwitch` is the same three cases a switch uses, so opening a
						 * conversation on a reload and coming back to it later land in the same
						 * place for the same reasons. Passing the decision rather than the view
						 * also gets the ordering right: the conversation arrives with the agent
						 * list, which is not always the first thing to arrive, and `undefined`
						 * (not known yet) has to be told apart from "nothing remembered".
						 */
						opening={state.focused ? { camera: openingCamera() } : undefined}
						/* Board documents start only once a stage is on screen. The dashboard is
						   metadata and pictures; the first press pays for the mount, as the design
						   says, and a person who never opens a stage never pays it. */
						boardsMayStart={boardsMayStart() && surface() === "stage"}
						// The panel's list and the rail's thumbnails are less urgent: after the canvas.
						onBoardsStarted={canvasOpened}
						mode={mode()}
						marks={marks()}
						boards={stageBoards()}
						links={stageCanvas()?.links ?? []}
						groups={stageCanvas()?.groups ?? []}
						camera={camera()}
						glide={glide()}
						setCamera={setCameraAndReport}
						selected={selected()}
						/*
						 * The board, or the file inside the box that is selected on it.
						 *
						 * One key with one meaning per level, which is the design's rule: `f`
						 * fullscreens the selection when the selection *is* an embed, and the board
						 * otherwise. Answered here rather than in `Stage` because the selection is
						 * this component's — the stage knows the board, and the box is a shape
						 * (`canvas/inspect.ts`) that the inspector is already reading.
						 */
						onPresent={(path, at) => setPresenting(presentingFor(path, at))}
						onEditSource={openSource}
						{...(focus() === undefined ? {} : { focus: focus()! })}
						onFocusToggle={() => toggleFocus()}
						onFocusBoard={(path) => toggleFocus(path)}
						{...(editingSource()
							? {
									editing: {
										path: editingSource()!.path,
										editing: {
											/*
											 * Committed as bytes, because that is what this editor edits.
											 *
											 * There used to be a second commit here — a batch of ops from a GrapesJS
											 * model, with a fallback to the bytes when the ops could not express the
											 * change. Both are gone with that editor, and this is the `source` op:
											 * the whole file, written as the person typed it. Unchanged text is
											 * dropped here rather than sent, so opening the editor and closing it
											 * without touching anything is not a write.
											 */
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
							/*
							 * A press outside every board takes the focus, which is how an edit inside one ends.
							 *
							 * The frame cannot hear a press that lands outside it, and a `<div>` cannot take focus
							 * by itself — so without this the frame keeps focus, `focusout` never fires inside it,
							 * and a run or a caret stays open with its outline drawn after somebody has clicked
							 * away. Moving focus to the canvas is the one move every editor already understands:
							 * the frame blurs, and each of them closes what it had open.
							 *
							 * Only for a press that named no board: a press *inside* one is the frame's own, and
							 * taking focus from it there would end the edit the press was meant to make.
							 */
							if (!path) (document.querySelector(".stage") as HTMLElement | null)?.focus?.();
						}}
						onMove={move}
						/*
						 * A resize is a write to the board's own file, so it goes to the server and
						 * comes back as a `board.changed` — the frame reloads at the new size rather
						 * than the app drawing a board it has not written. Nothing is previewed here
						 * for that reason: the drag draws the box it is asking for, and the file
						 * decides what is true.
						 */
						onResize={(path, size) => send({ type: "board.resize", path, ...size })}
						/*
						 * A double-click on empty canvas makes a blank board, centred where it landed.
						 * `files.boardAt` owns the request-and-hear-the-path dance, because the server
						 * mints the name and only it knows what the path is.
						 */
						onCreateBoard={(at) =>
							void files.boardAt(at).then((path) => {
								if (!path) return;
								setSelected(path);
								setComponent(undefined);
							})
						}
						onHide={(path) => send({ type: "board.hide", path })}
						nonces={state.nonces}
						cursor={state.cursor}
						onViewport={() => reportCameraSoon(camera())}
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
						/*
						 * A link on a board, pointing at another board.
						 *
						 * The board will not follow it — a frame has no back button, so the board being read
						 * would be replaced by the one it linked to — and asks here instead. Only a link to a
						 * board file gets this far; everything else opened in a tab at the click. The answer is
						 * whether this deck holds that board: `true` and it is on the canvas beside the board
						 * that linked to it, `false` and there is a notice saying there is no board there.
						 */
						onOpenBoard={openLinkedBoard}
						onBoardEval={evalBoard}
						agentIdentity={(agentId) => {
							const identity = state.identities[agentId];
							return identity ? { name: identity.name, color: identity.color } : undefined;
						}}
						/*
						 * What that agent is doing, in the sign's own words.
						 *
						 * The mirror draws a working line at the foot of its transcript, and it is the same
						 * sentence the dock and the column say — `workingWords` is the one place that decides
						 * between "working…", "typing…" and "running tools…". A board that read the words off
						 * the transcript instead, as it used to, could only tell that *something* was
						 * happening, and called all three of them "working…".
						 */
						working={(agentId) => {
							const chat = state.chats.find((one) => one.id === agentId);
							const identity = state.identities[agentId];
							return chat && identity ? workingWords(chat.state, identity.name) : undefined;
						}}
						/* The canvas's own way out — Escape, over the canvas or inside a board. Clearing
						   the browser's copy is the whole of it: the server keeps no preview state,
						   which is also why a reload has always been an accidental escape hatch. */
						onLeavePreview={clearPreview}
						onEdgeSwipe={edgeSwipe}
					/>
					)}
				</Show>
					</div>
				</div>

				{/*
					The two top clusters, and the tools are inside the left one.

					`Palette` is gone as a free-standing float: it was already top-centre, and
					what it lacked was a row to be part of. With the bar deleted it sits at the
					same height as the agent and the camera, top centre goes empty — which is
					where notices land, and they had been dodging it — and there is one
					`data-inset="top"` where there were two.
				*/}
				<AgentPill
					{...(stageCanvas() && state.canvas
						? {
								canvas: {
									id: stageCanvas()!.id,
									name: stageCanvas()!.name,
									agents: [...stageCanvas()!.agents],
								},
								onRenameCanvas: (name: string) => send({ type: "canvas.rename", id: stageCanvas()!.id, name }),
							}
						: {})}
					canvases={state.canvases}
					onOpenCanvas={(id) => openCanvas(id)}
					onNewCanvas={() => newCanvas(state.focused ?? "")}
					onRemoveCanvas={(id) => send({ type: "canvas.remove", id })}
					mode={mode()}
					onMode={(next) => {
						// A press while editing means "this component", so the pen is put down first.
						if (next === "edit") setDrawing(false);
						setMode(next);
					}}
					drawing={drawing()}
					onDrawing={setDrawing}
					surface={surface()}
					onHome={goHome}
					wantsYou={wantsYou(state.tasks)}
					tab={dispatchTab()}
					onTab={(tab) => go({ surface: "dispatch", tab })}
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
					chats={visibleChats()}
					identities={state.identities}
					focused={state.focused}
					unread={unread}
					onFocus={addressAgent}
					onNew={(kind) => send({ type: "agent.create", ...(kind ? { kind } : {}) })}
					onMore={openAgentsPanel}
					onClose={closeAgent}
					surface={surface()}
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
					onNewBoard={(format) => {
						/* From the dashboard a new board is made for the agent you were last with, and
						   the stage opens so it lands somewhere you can see. */
						if (surface() === "dispatch") {
							if (!state.focused) {
								notice("info", "Make an agent first: a board is made on an agent's canvas.");
								return;
							}
							openStage(state.focused);
						}
						/* Asked for by name, so the camera can arrive on it: the server places a new
						   board in the middle of this canvas's view and clear of what is there, which
						   is near but not always on screen when the middle is taken. */
						void files
							.askForBoard((request) => send({ type: "board.create", ...(format ? { format } : {}), request }))
							.then((path) => {
								if (!path) return;
								setSelected(path);
								setComponent(undefined);
								frameWhenPlaced(path);
							});
					}}
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
					onFullscreen={() => {
						const box = shape();
						if (box) setPresenting(embedPresenting(box));
					}}
					/* Edit-only: it is a properties panel, and a panel whose fields cannot be
					   applied is a panel that lies about what it does. */
					visible={zoomInteractive() && !preview() && mode() === "edit"}
					onEdit={inspect}
					pickFile={() => editor.pickFile(shape()?.path)}
					onClose={() => setComponent(undefined)}
				/>

				<Show when={commenting()} keyed>
					{(target) => (
						<CommentPopup
							target={target}
							moved={() => [camera(), focus(), insets()]}
							left={insets().left}
							canSend={!!state.focused}
							onKeep={(text) => endComment(text, "keep")}
							onSend={(text) => endComment(text, "send")}
							onClose={() => setCommenting(undefined)}
						/>
					)}
				</Show>

				<Show when={drawing() && mode() === "browse" && surface() === "stage"}>
					<InkBar onDone={() => setDrawing(false)} />
				</Show>

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
					{...(panelAsk() ? { ask: panelAsk()! } : {})}
					boards={state.boards}
					listMayGrow={boardsStarted() || surface() === "dispatch"}
					current={selected()}
					/*
					 * What is on the canvas, which is the room's list and not the agent's.
					 *
					 * `stageBoards` is the same answer the stage draws from, so the panel's "on the
					 * canvas" section and the boards on screen cannot disagree — they did the moment a
					 * canvas stopped being one agent's in-play set.
					 */
					inPlay={stageBoards().map((board) => board.path)}
					/* What the room took off and keeps: boards belong to the canvas, not to whoever you are talking to. */
					kept={stageCanvas()?.kept ?? []}
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
					chats={visibleChats()}
					identities={state.identities}
					unread={unread}
					/* The room's project, on a stage: the workspace of the canvas you are looking at leads both lists. */
					hereWorkspace={surface() === "stage" ? stageCanvas()?.workspace : undefined}
					onFocusAgent={visitAgent}
					onNewAgent={(workspace) => send({ type: "agent.create", ...(workspace ? { workspace } : {}) })}
					/* The Canvases tab: the rooms, under their projects, and a way between them. */
					canvases={state.canvases}
					currentCanvas={surface() === "stage" ? state.canvas : undefined}
					onOpenCanvas={(id) => openCanvas(id)}
					onNewCanvas={(workspace) => newCanvas(undefined, workspace)}
					onRemoveCanvas={(id) => send({ type: "canvas.remove", id })}
					onCloseAgent={closeAgent}
					onMirrorAgent={(id) =>
						void files.askForBoard((request) => send({ type: "agent.mirror", agentId: id, request })).then((path) => path && frameWhenPlaced(path))
					}
					/* Your tags, which the agent cannot see or overwrite — a separate field from
					   `stage.me.setTags`, for the reason `protocol/Identity` gives. */
					onAgentTags={(id, tags) => send({ type: "agent.tags", id, tags })}
					/* The workspace, which is one field with two writers rather than two fields: the
					   agent declares one and you can move it, and whoever wrote last is where it is. */
					onAgentWorkspace={(id, workspace) => send({ type: "agent.workspace", id, workspace })}
					onAgentRename={(id, name) => send({ type: "agent.rename", id, name })}
					onPick={(board) => {
						/* On the dashboard a board row is a preview; on a stage it is the canvas. */
						if (surface() === "dispatch") {
							go({ surface: "dispatch", tab: dispatchTab(), board: board.path });
							return;
						}
						playAndFrame(board.path);
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
					onHide={(board) => send({ type: "board.hide", path: board.path })}
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
				 * Whether it is up is `state/edge.ts`'s business, not this component's, because
				 * the same edge is wanted by the inspector and only one of them may have it.
				 */}
				<Stream
					onHead={mountStreamFloat}
					items={transcript()}
					/*
					 * Reaching back, in two parts: whether there is anything there, and how to
					 * ask for it. The column owns the window over what is held; the server owns
					 * everything older (`agents/store.ts`), and this is the seam between them.
					 */
					more={streamAgent() ? state.agents[streamAgent()!]?.moreHistory === true : false}
					onEarlier={() => (streamAgent() ? loadEarlier(streamAgent()!) : Promise.resolve(0))}
					agentId={streamAgent() ?? ""}
					state={streamChat()?.state ?? "idle"}
					name={state.identities[streamAgent() ?? ""]?.name ?? streamChat()?.name ?? "It"}
					agent={streamChat()?.kind ?? state.defaultKind}
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
				<div class="dock" ref={dockEl}>
					{/* Only drawn while the bar is put away behind the right edge (a hard throw
					    at it, `float.ts`): the one part of it left on screen, and the way back. */}
					<button type="button" class="dock-stowtab" aria-label="Bring the input bar back" title="Bring the input bar back" onClick={() => unstowComposer()}>
						<Icon of={ChevronLeft} size={16} />
					</button>
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
						state={barChat()?.state ?? "idle"}
						name={state.identities[barAgent() ?? ""]?.name ?? barChat()?.name ?? "It"}
						agent={barChat()?.kind ?? state.defaultKind}
					/>

					{/* On the dashboard every control here is the dispatcher's: its model, its
					    thinking level, its mode and its usage. `barAgent` is the one switch. */}
					<Composer
						draft={draft()}
						agentId={barAgent()}
						page={pageKey(surface(), state.focused)}
						usage={barAgent() ? state.agents[barAgent()!]?.usage : undefined}
						onUsage={() => openUsage(barAgent())}
						busy={busy()}
						model={barAgent() ? state.agents[barAgent()!]?.model : undefined}
						models={runtimeFor(barChat()?.kind)?.models ?? []}
						commands={barChat()?.commands ?? runtimeFor(barChat()?.kind)?.commands ?? []}
						runtime={barChat()?.kind}
						modes={runtimeFor(barChat()?.kind)?.capabilities?.modes ?? []}
						mode={barChat()?.mode}
						onMode={(mode) => send({ type: "agent.setMode", id: barAgent() ?? "", mode })}
						{...(surface() === "dispatch" ? { onRuntime: (kind: AgentKind) => send({ type: "dispatcher.setKind", kind }) } : {})}
						onSend={sendFromBar}
						comments={surface() === "stage" ? waitingComments(state.focused) : []}
						onCommentsGone={(ids) => {
							for (const id of ids) if (state.focused) removeComment(state.focused, id);
							unmarkComments(ids);
						}}
						onText={setBarText}
						destination={destinationLabel(destination(barText(), barContext()))}
						recipient={{
							chats: visibleChats(),
							identities: state.identities,
							unread,
							focused: state.focused,
							here: surface() === "stage" ? [...(stageCanvas()?.agents ?? [])] : [],
							dest: destination(barText(), barContext()),
							label: destinationLabel(destination(barText(), barContext())),
							...(dispatcherId() ? { dispatcher: state.chats.find((chat) => chat.id === dispatcherId()) } : {}),
							...(surface() === "stage" && stageCanvas() ? { canvasName: stageCanvas()!.name } : {}),
							// On a stage the chip addresses; on the dashboard, where there is no room to bring anyone to, an agent is the way in.
							onPick: (id) => (surface() === "stage" ? setAddressed({ id }) : visitAgent(id)),
							onDispatcher: () => setAddressed("dispatcher"),
							onNew: (kind) => send({ type: "agent.create", ...(kind ? { kind } : {}) }),
							onClose: closeAgent,
							onMore: openAgentsPanel,
						}}
						mentionables={[
							...visibleChats().map((chat) => ({ name: agentName(chat.id), here: (stageCanvas()?.agents ?? []).includes(chat.id), chat })),
							{ name: DISPATCHER_NAME, here: true, task: true, ...(dispatcherId() ? { chat: state.chats.find((chat) => chat.id === dispatcherId()) } : {}) },
						]}
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
								id: barAgent() ?? "",
								provider,
								model,
								...(thinking ? { thinking } : {}),
							})
						}
						onThinking={(thinking: ThinkingLevel) =>
							send({ type: "agent.thinking", id: barAgent() ?? "", thinking })
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
						if (showing.kind === "embed") {
							return (
								<PresentEmbed
									board={showing.board}
									raw={showing.raw}
									{...(showing.pages === undefined ? {} : { pages: showing.pages })}
									title={showing.title}
									onExit={() => setPresenting(undefined)}
								/>
							);
						}
						const board = () => state.boards.find((candidate) => candidate.path === showing.path);
						return (
							<Show when={board()} keyed>
								{(deck) => (
									<Present
										board={deck}
										at={showing.at}
										onExit={() => setPresenting(undefined)}
										onOpenBoard={openLinkedBoard}
										onBoardEval={evalBoard}
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
				<Show when={surface() === "stage"}>
					<ArrivalChip
						arrival={state.arrival}
						identities={state.identities}
						boards={state.boards}
						onGo={(target, path) => {
							// A press is about the journey, so it arrives rather than jumps.
							moveCamera(target, { animate: true });
							setSelected(path);
							setState("arrival", undefined);
						}}
						onDismiss={() => setState("arrival", undefined)}
					/>
				</Show>

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
