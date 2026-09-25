import type { Board, Camera, ThinkingLevel } from "@decks/protocol";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import Info from "lucide-solid/icons/info";
import Moon from "lucide-solid/icons/moon";
import SettingsIcon from "lucide-solid/icons/settings";
import Sun from "lucide-solid/icons/sun";
import {createEffect, createMemo, createSignal, on as watch, onCleanup, onMount, Show} from "solid-js";
import type { EditorHost, Tool } from "./board/Editor.ts";
import { Settings } from "./settings/Settings.tsx";
import {forgetAskedResults, setToolResultSender} from "./chat/tool-results.ts";
import type { Presenting } from "./state/ui.ts";
import { createAlerts } from "./app/alerts.ts";
import { camera, GLIDE_MS, glide, LEAVE_BOARD_MS, moveCamera, reducedMotion, setCamera } from "./state/camera.ts";
import { cameraOntoPage } from "./camera/morph.ts";
import { flyAlong } from "./app/fly-along.ts";
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
import { pens } from "./state/pens.ts";
import { notice } from "./state/notices.ts";
import {boardsMayStart, boardsOpen, boardsStarted, canvasOpened, focus, releaseBoards, draft, editingSource, ops, openSource, openUsage, picking, presenting, readUsage, setBoardsOpen, setDraft, setEditingSource, setFocus, setOps, setPicking, setPresenting, setSettings, setUnread, setUsagePanel, settings, unread, usagePanel, usageReport} from "./state/ui.ts";
import { destination, destinationLabel, stripMention } from "./app/send-from-bar.ts";
import { makeFloat } from "./chrome/float.ts";
import { isNews } from "./panel/board-news.ts";
import { canvasApiPresent, effectiveRenderer, loadRenderer, type RendererChoice, saveRenderer } from "./lib/renderer.ts";
import { FilePicker } from "./board/FilePicker.tsx";
import { applyLive, patchesFor, readShape, type Edit, type Shape } from "./board/inspect.ts";
import { Inspector } from "./board/Inspector.tsx";
import { InkBar } from "./markup/InkBar.tsx";
import { PenBar } from "./canvas/pen/PenBar.tsx";
import { setPenTool } from "./state/pen-tools.ts";
import { pageKey } from "./chat/composer/parked.ts";
import { CommentPopup } from "./markup/CommentPopup.tsx";
import { commentBlock, withComments } from "./markup/comments.ts";
import { markComment, unmarkComments } from "./markup/comment-select.ts";
import { addComment, commenting, removeComment, setCommenting, takeComments, waitingComments } from "./state/comments.ts";
import { drawing, setDrawing } from "./state/ink.ts";
import { CanvasOps } from "./canvas/CanvasOps.tsx";
import { Stage } from "./canvas/Stage.tsx";
import { Dialog } from "./chat/Dialog.tsx";
import { Composer } from "./chat/composer/Composer.tsx";
import { Present } from "./present/Present.tsx";
import { PresentEmbed } from "./present/PresentEmbed.tsx";
import { StatusLine } from "./chat/StatusLine.tsx";
import { Stream } from "./chat/Stream.tsx";
import { AgentPill } from "./agents/AgentPill.tsx";
import { StageManager } from "./canvas/StageManager.tsx";
import { stageOf, stages } from "./state/stages.ts";
import { Corner } from "./chrome/Corner.tsx";
import { NoticeStrip } from "./chrome/NoticeStrip.tsx";
import { LeftPanel, type PanelTab } from "./panel/LeftPanel.tsx";
import {boxOf, fitInto, INTERACT_ZOOM, keepVisible, middleOf} from "./camera/camera.ts";
import { selectionOnSwitch, viewOnSwitch, viewToPark } from "./camera/agent-view.ts";
import { agentViews } from "./camera/agent-views.ts";
import {closeHistory, historyShown, openHistory, setInspectable} from "./state/edge.ts";
import { canvasBox, insets, watchInsets } from "./camera/insets.ts";
import { canHover, NARROW } from "./lib/media.ts";
import { installViewport, obscured } from "./app/viewport.ts";
import { scheme, toggleScheme } from "./lib/theme.ts";
import { UsageModal } from "./settings/UsageModal.tsx";
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
	 * The boards that are news, each in its writer's colour: what the canvas draws a glow round
	 * until the board is read there (`board/glow.ts`). The same rule as the sidebar's mark, so a
	 * board glows on the canvas exactly when it is marked in the list.
	 */
	const newsGlow = createMemo(() => {
		const out: Record<string, string> = {};
		for (const board of state.boards) {
			if (!isNews(board)) continue;
			out[board.path] = (board.lastWrittenBy && state.identities[board.lastWrittenBy]?.color) || "var(--color-accent)";
		}
		return out;
	});
	/*
	 * Reading a board in the focus view is what takes its "changed" mark off. Said once per
	 * opening; the server ignores a board already read since its last write, and the next write
	 * brings the mark back.
	 */
	createEffect(
		watch(
			() => {
				const path = focus();
				// The file's time is part of the key: a board rewritten while it is open is still
				// being read, so the mark must not come back under the reader's eyes.
				return path ? `${state.boards.find((board) => board.path === path)?.modifiedAt ?? 0}|${path}` : undefined;
			},
			(key) => {
				if (key) send({ type: "board.seen", path: key.slice(key.indexOf("|") + 1) });
			},
		),
	);

	/*
	 * The bar's destination, decided in one place.
	 *
	 * Where a line lands depends on who is focused and whether the text names an agent. The
	 * word on the bar is this same function run without sending, so the label and the frame
	 * cannot disagree. `barText` is what the composer holds right now, reported on every
	 * keystroke, so an @ name changes the word as it is typed.
	 */
	const [barText, setBarText] = createSignal("");
	const agentName = (id: string) => state.identities[id]?.name ?? state.chats.find((chat) => chat.id === id)?.name ?? id;
	const barContext = () => {
		const focusedId = state.focused;
		return {
			...(focusedId ? { focused: { id: focusedId, name: agentName(focusedId) } } : {}),
			agents: state.chats.map((chat) => ({ id: chat.id, name: agentName(chat.id) })),
		};
	};
	const sendFromBar = (typed: string, commentIds: string[] = []) => {
		const dest = destination(typed, barContext());
		/*
		 * The comments whose pills were in the field go in front of the words, whoever the words
		 * are for, and stop waiting. They are kept under the agent whose stage they were made
		 * on, which is the focused one: the only place a comment can be made is its stage.
		 */
		// In the order their pills sat in the text, which is the order `[comment n]` counts in.
		const held = state.focused && commentIds.length > 0 ? takeComments(state.focused) : [];
		const notes = commentIds.flatMap((id) => held.filter((note) => note.id === id));
		unmarkComments(notes.map((note) => note.id));
		const text = withComments(typed, notes);
		switch (dest.kind) {
			case "prompt": {
				const line = dest.named ? withComments(stripMention(typed, dest.name), notes) : text;
				if (dest.id === state.focused) clearMarks(dest.id);
				send({ type: "agent.prompt", id: dest.id, text: line });
				return;
			}
			case "note":
				notice("info", "Notes on a component are not built yet.");
				return;
			default:
				notice("info", "Pick an agent first.");
		}
	};

	/*
	 * A comment on selected words (`markup/comments.ts`), ending one of the two ways the popup
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
		if (mode() !== "browse" || drawing()) setCommenting(undefined);
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
		const handle = dock?.querySelector<HTMLElement>(".composer-box");
		if (!dock || !handle) return;
		const float = mountFloat(dock, "composer", handle, "[data-slot='composer-input'], textarea, input, button, select, a, [role='menu'], [role='listbox'], .send-button", () => {
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
	/* The conversation float shows the focused agent. Its history is asked for when it is shown. */
	const transcript = createMemo(() => {
		const id = state.focused;
		return id ? state.agents[id]?.transcript ?? [] : [];
	});
	createEffect(() => {
		if (historyShown()) ensureHistory(state.focused);
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
	/** The drawing of the chat on screen, when it has one (`state/pens.ts`). */
	const stagePen = createMemo(() => {
		const id = state.focused;
		const pen = id ? pens()[id] : undefined;
		return pen ? { doc: pen.doc, base: pen.base } : undefined;
	});

	/** Undo or redo the person's own last edit to the drawing (`StagePens.step`). */
	const penStep = (direction: "undo" | "redo") => {
		const agentId = state.focused;
		if (agentId) send({ type: "stage.pen.step", agentId, direction });
	};
	/** A board tool, from the palette or its key; one armed tool at a time, so the drawing's is put down. */
	const pickTool = (next: Tool) => {
		setTool(next);
		setPenTool("select");
	};

	const stageBoards = createMemo(() => {
		const playing = new Set(state.focused ? (state.agents[state.focused]?.inPlay ?? []) : []);
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
	 * The selected component as the inspector needs it (`board/inspect.ts`).
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
	 * nothing of the board's to read it from (`present/PresentEmbed.tsx`). The board is named
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
	const { addFile, drops, intoComposer } = files;


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
	 * Switch to an agent: its stage, its conversation, and the view this device left it in.
	 *
	 * Named, because there are several ways in — the pill's dropdown, a face in the top-right
	 * stack, a row in the panel — and several copies of these steps is several chances to
	 * forget one.
	 */
	const focusAgent = (id: string) => {
		const leaving = state.focused;
		if (leaving === id) return;

		/*
		 * Park the view you are leaving, then take the one you are arriving at.
		 *
		 * `agent-view.ts` owns the three cases and argues for them. In short: nothing on the
		 * stage leaves the camera alone, a remembered view comes back *exactly*, and an agent
		 * with no memory gets a fit of what it holds.
		 */
		if (leaving) views().keep(leaving, viewToPark(camera(), selected()));

		setState("focused", id);
		setUnread(id, 0);
		// A component selected in a board another agent was holding is not your selection.
		setComponent(undefined);

		/*
		 * The camera and the selection wait for the stage itself.
		 *
		 * `agent.focus` is answered with the whole deck as the *new* stage sees it, and where the
		 * boards are is half of what `viewOnSwitch` decides on — a remembered view that no longer
		 * shows one of its own boards is a fit instead. Deciding it here would decide it against
		 * the conversation being left, which is the one arrangement that is definitely not the one
		 * about to be shown. `landed` is the other half.
		 */
		awaiting = id;

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
	 * the rail, and a board a link on another board opened (below) — want the same arithmetic,
	 * and a list is also what an agent's `stage.show` of several boards asks for.
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

	/** Whether the stage manager is up. One state, because there is one of it (`StageManager`). */
	const [stagesOpen, setStagesOpen] = createSignal(false);

	/**
	 * Land on a stage that has just been opened: the middle of its work.
	 *
	 * Waits for the boards, because moving an agent to a stage is a round trip — the server takes
	 * that stage's boards as the session's and sends the arrangement back — and a camera moved
	 * before they arrive is a camera moved to where the *old* stage was. Given up on after a few
	 * seconds, so a stage the server never answers about cannot fly the camera later.
	 *
	 * `middleOf` rather than a fit: see `camera/camera.ts` for why one stray board must not decide
	 * where a whole stage is read from.
	 */
	const landOnStage = () => {
		const asked = Date.now();
		const stop = () => clearInterval(timer);
		const timer = setInterval(() => {
			if (Date.now() - asked > 6000) return stop();
			const stage = document.querySelector(".stage");
			if (!stage) return;
			// The boards of the conversation on screen, which are that stage's the moment it lands.
			const boards = stageBoards();
			if (boards.length === 0 && Date.now() - asked < 1200) return;
			stop();
			const view = { width: stage.clientWidth, height: stage.clientHeight };
			moveCamera(middleOf(boards.map(boxOf), canvasBox(view), view, camera()), { animate: true });
		}, 200);
	};

	/**
	 * A link **on a board** that points at another board — the app's half of it.
	 *
	 * Returns whether the deck had that board, because the board itself cannot open one: the
	 * canvas is the app's to arrange. A path the deck does not hold is a broken link, and the
	 * one answer that is any use is saying so.
	 *
	 * **Placed, not stacked.** A board that arrives on top of the one the reader is reading is
	 * a board they then have to drag apart; so it lands to the right of the link's own board.
	 * Only when it is not already on the canvas: a board the user put somewhere is theirs, and
	 * following a link is not a reason to move it.
	 *
	 * **The camera goes to the board that was asked for, and only to it.** It used to frame the
	 * pair, on the argument that a board arriving beside another is only useful if you can see
	 * that it did. What that costs is the thing the link was followed for: two boards side by
	 * side fit at half the zoom of one, which on a laptop is under `INTERACT_ZOOM` — the board
	 * lands too small to read and too small to click into. Where it sits is answerable by
	 * zooming out; text too small to read is not answerable at all.
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
		flyToBoards([board], { animate: true });
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
				<div class="surface" data-surface="stage">
					<div class="surface-layer" data-layer="stage">
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
						boardsMayStart={boardsMayStart()}
						// The panel's list and the rail's thumbnails are less urgent: after the canvas.
						onBoardsStarted={canvasOpened}
						mode={mode()}
						marks={marks()}
						boards={stageBoards()}
						/*
						 * A plain prop, never a spread: a conditional spread makes every prop the stage reads
						 * depend on it, so each drawing update re-ran the camera's effects and cut a fly short.
						 */
						pen={stagePen()}
						onPenEdit={(ops) => {
							const agentId = state.focused;
							if (agentId) send({ type: "stage.pen.edit", agentId, ops });
						}}
						onPenStep={penStep}
						drawing={drawing() && mode() === "browse"}
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
						 * (`board/inspect.ts`) that the inspector is already reading.
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
						acts={state.acts}
						news={newsGlow()}
						onRead={(path) => send({ type: "board.seen", path })}
						onViewport={() => reportCameraSoon(camera())}
						onExtent={(path, extent) => send({ type: "board.extent", path, ...extent })}
						editor={editor}
						onTool={pickTool}
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
						/*
						 * Dropped on the composer: talk about it.
						 *
						 * Each arrives as a **pill**, the object the comment pill already is: an icon, a
						 * colour of its own, and the thing it stands for carried inside it rather than
						 * guessed back out of a label (`chat/composer/draft.ts`). What the agent reads
						 * for one is its address — `@boards/plan.html`, which is how a dropped file is
						 * already spelled, and `@item:<id>` for something drawn on the stage.
						 *
						 * Through the same one-shot draft handoff a dropped file uses, so a sentence
						 * half typed survives it.
						 */
						onRefer={(pills) =>
							setDraft({
								text: "",
								pills,
								at: Date.now(),
								insert: true,
								...(state.focused ? { agentId: state.focused } : {}),
							})
						}
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
					chats={state.chats}
					identities={state.identities}
					focused={state.focused}
					unread={unread}
					onFocus={focusAgent}
					onNew={(kind) => send({ type: "agent.create", ...(kind ? { kind } : {}) })}
					onClose={closeAgent}
					onMoreAgents={openAgentsPanel}
					mode={mode()}
					onMode={(next) => {
						// A press while editing means "this component", so the pen is put down first.
						if (next === "edit") setDrawing(false);
						setMode(next);
					}}
					drawing={drawing()}
					onDrawing={setDrawing}
					boardsOpen={boardsOpen()}
					onToggleBoards={() => showBoards(!boardsOpen())}
					{...(stageOf(state.focused) ? { stage: stageOf(state.focused)!.name } : {})}
					{...(stages().length > 0 ? { onStages: () => void setStagesOpen((was) => !was), stagesOpen: stagesOpen() } : {})}
				/>

				{/*
					The stage manager: every stage in the deck, over the canvas.

					Here rather than inside the pill, because it covers the canvas and the pill is a
					cluster of controls 40px tall. The pill owns the button; this owns the surface.
				*/}
				<StageManager
					stages={stages()}
					isolated={state.chats.find((chat) => chat.id === state.focused)?.isolated === true}
					onRename={(name, to) => send({ type: "stage.rename", name, to })}
					onDelete={(name) => send({ type: "stage.delete", name })}
					here={stageOf(state.focused)?.name}
					open={stagesOpen()}
					onClose={() => void setStagesOpen(false)}
					onPick={(name) => {
						const agentId = state.focused;
						if (!agentId || stageOf(agentId)?.name === name) return;
						send({ type: "agent.stage", id: agentId, stage: name });
						landOnStage();
					}}
					onNew={(title) => {
						const agentId = state.focused;
						if (!agentId) return;
						send({ type: "stage.new", id: agentId, title });
						landOnStage();
					}}
					scheme={scheme()}
				/>

				<Corner
					chats={state.chats}
					identities={state.identities}
					focused={state.focused}
					unread={unread}
					onFocus={focusAgent}
					onMore={openAgentsPanel}
					onClose={closeAgent}
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
						if (!state.focused) {
							notice("info", "Make an agent first: a board is made on an agent's stage.");
							return;
						}
						/* Asked for by name, so the camera can arrive on it: the server places a new
						   board in the middle of this stage's view and clear of what is there, which
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
					/* Isolation belongs to the agent you are talking to; the server restarts it in its
					   stage's folder and says so on the row (`agent.row.isolated`). */
					{...(state.focused
						? {
								isolated: state.chats.find((chat) => chat.id === state.focused)?.isolated === true,
								onIsolate: () => {
									const on = state.chats.find((chat) => chat.id === state.focused)?.isolated !== true;
									send({ type: "agent.setIsolated", id: state.focused ?? "", on });
								},
							}
						: {})}
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

				<Show when={drawing() && mode() === "browse"}>
					<InkBar
						onDone={() => setDrawing(false)}
						onStep={penStep}
						onDelete={(ids) => {
							const agentId = state.focused;
							if (agentId) send({ type: "stage.pen.edit", agentId, ops: ids.map((id) => ({ op: "delete", id })) });
						}}
					/>
				</Show>

				{/* The drawing's tools, in both modes: browse leaves the boards' pages as they are, not the drawing. */}
				<Show when={!(drawing() && mode() === "browse") && stagePen()}>
					{(pen) => (
						<PenBar
							doc={pen().doc}
							onEdit={(ops) => {
								const agentId = state.focused;
								if (agentId) send({ type: "stage.pen.edit", agentId, ops });
							}}
							onStep={penStep}
							onArm={(next) => {
								if (next !== "select") setTool("select");
							}}
							onExport={(ids) => {
								const agentId = state.focused;
								if (!agentId) return;
								// A link the browser downloads: the picture is taken on the server, which can take a moment.
								notice("info", "Taking the picture…");
								const link = document.createElement("a");
								link.href = `/api/stage-shot?${new URLSearchParams({ agent: agentId, of: ids.join(","), format: "png", scheme: scheme() })}`;
								link.download = "";
								link.click();
							}}
						/>
					)}
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
					listMayGrow={boardsStarted()}
					current={selected()}
					/* `stageBoards` is the same answer the stage draws from, so the panel's "on the
					   stage" section and the boards on screen cannot disagree. */
					inPlay={stageBoards().map((board) => board.path)}
					/* What the focused agent holds and has taken off its stage. */
					kept={state.focused ? (state.contexts[state.focused] ?? []) : []}
					focused={state.focused}
					open={boardsOpen()}
					onOpenChange={showBoards}
					findAt={findAt()}
					/*
					 * The Agents tab. The same three signals the corner and the dropdown already
					 * take, so the panel is not a second source of truth about who exists — and
					 * `focusAgent` rather than a bare `agent.focus`, because switching moves the
					 * stage, the camera, the transcript and the draft together.
					 */
					chats={state.chats}
					identities={state.identities}
					unread={unread}
					onFocusAgent={focusAgent}
					onNewAgent={(workspace, kind) => send({ type: "agent.create", kind, ...(workspace ? { workspace } : {}) })}
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
					onPick={(board) => playAndFrame(board.path)}
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
						at={usageReport().at}
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
					more={state.focused ? state.agents[state.focused!]?.moreHistory === true : false}
					onEarlier={() => (state.focused ? loadEarlier(state.focused!) : Promise.resolve(0))}
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
						state={focusedChat()?.state ?? "idle"}
						name={state.identities[state.focused ?? ""]?.name ?? focusedChat()?.name ?? "It"}
						agent={focusedChat()?.kind ?? state.defaultKind}
					/>

					<Composer
						draft={draft()}
						agentId={state.focused}
						page={pageKey(state.focused)}
						usage={state.focused ? state.agents[state.focused!]?.usage : undefined}
						onUsage={() => openUsage(state.focused)}
						busy={busy()}
						model={state.focused ? state.agents[state.focused!]?.model : undefined}
						models={runtimeFor(focusedChat()?.kind)?.models ?? []}
						commands={focusedChat()?.commands ?? runtimeFor(focusedChat()?.kind)?.commands ?? []}
						runtime={focusedChat()?.kind}
						modes={runtimeFor(focusedChat()?.kind)?.capabilities?.modes ?? []}
						mode={focusedChat()?.mode}
						onMode={(mode) => send({ type: "agent.setMode", id: state.focused ?? "", mode })}
						onSend={sendFromBar}
						comments={waitingComments(state.focused)}
						onCommentsGone={(ids) => {
							for (const id of ids) if (state.focused) removeComment(state.focused, id);
							unmarkComments(ids);
						}}
						onText={setBarText}
						destination={destinationLabel(destination(barText(), barContext()))}
						recipient={{
							chats: state.chats,
							identities: state.identities,
							unread,
							focused: state.focused,
							dest: destination(barText(), barContext()),
							label: destinationLabel(destination(barText(), barContext())),
							onPick: focusAgent,
							onNew: (kind) => send({ type: "agent.create", ...(kind ? { kind } : {}) }),
							onClose: closeAgent,
							onMore: openAgentsPanel,
						}}
						mentionables={state.chats.map((chat) => ({ name: agentName(chat.id), chat }))}
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
