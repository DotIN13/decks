import { ConfirmDialog } from "./ui/ConfirmDialog.tsx";
import { queuedFor } from "./state/queued.ts";
import type { Board, Camera, ThinkingLevel } from "@decks/protocol";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import Info from "lucide-solid/icons/info";
import Moon from "lucide-solid/icons/moon";
import SettingsIcon from "lucide-solid/icons/settings";
import {createComputed, createEffect, createMemo, createSignal, on as watch, onCleanup, onMount, Show, untrack} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { shownHeight } from "./board/extent.ts";
import { createFileDrops } from "./app/files.ts";
import { Settings } from "./settings/Settings.tsx";
import {forgetAskedResults, setToolResultSender} from "./chat/tool-results.ts";
import { createAlerts } from "./app/alerts.ts";
import { camera, glide, moveCamera, reducedMotion, setCamera } from "./state/camera.ts";
import { cameraOntoPage } from "@decks/canvas/camera";
import { flyAlong } from "./app/fly-along.ts";
import { SPRING_BACK_MS, SPRING_BACK_RESPONSE, SPRING_MS } from "@decks/canvas/camera";
import { handleFrame, pageRev, type FrameHooks } from "./app/frames.ts";
import { reportCamera, reportCameraSoon, setCameraAndReport } from "./app/camera-report.ts";
import { installKeys } from "./app/keys.ts";
import { scratch } from "./state/agent.ts";
import { ensureHistory, loadEarlier } from "./state/history.ts";
import { mode, selected, setMode, setSelected } from "./state/selection.ts";
import { on, send, setOnScreen, start } from "./state/socket.ts";
import { api } from "./connections/connection.ts";
import { can } from "./connections/backend.ts";
import { Icon } from "./ui/icons.tsx";
import {clearDialog, clearPreview, dialog, preview, runtimeFor, setState, state} from "./state/deck.ts";
import { onPenRefused, pens } from "./state/pens.ts";
import { optionFor } from "./chat/composer/thinking.ts";
import { notice } from "./state/notices.ts";
import {boardsMayStart, boardsOpen, boardsStarted, canvasOpened, focus, releaseBoards, draft, editingSource, ops, openSource, openUsage, picking, readUsage, setBoardsOpen, setDraft, setEditingSource, setFocus, setOps, setPicking, setSettings, setUnread, setUsagePanel, settings, unread, usagePanel, usageReport} from "./state/ui.ts";
import { destination, destinationLabel, stripMention } from "./app/send-from-bar.ts";
import { makeFloat } from "@decks/ui/float";
import { isNews } from "./panel/board-news.ts";
import type { RendererChoice } from "@decks/canvas/host";
import { FilePicker } from "./board/FilePicker.tsx";
import { PenBar } from "@decks/canvas/host";
import { setPenTool } from "@decks/canvas/tools";
import { pageKey } from "./chat/composer/parked.ts";
import { CommentPopup } from "./markup/CommentPopup.tsx";
import { commentBlock, withComments } from "./markup/comments.ts";
import { markComment, unmarkComments } from "./markup/comment-select.ts";
import { addComment, commenting, removeComment, setCommenting, takeComments, waitingComments } from "./state/comments.ts";
import { drawing, setDrawing } from "@decks/canvas/tools";
import { CanvasOps } from "./canvas/CanvasOps.tsx";
import "./app/canvas-host.ts";
import { createEditor, isSharedBoard, type CanvasHandle } from "@decks/canvas";
import { boardUrl } from "./lib/api.ts";
import { mintBoardToken } from "./board/board-token.ts";
import { attachBoardFrame } from "./board/frame-hooks.ts";
import { shotAdaptor } from "./canvas/shots/adaptors.ts";
import { Dialog } from "./chat/Dialog.tsx";
import { Composer } from "./chat/composer/Composer.tsx";
import { Stream } from "./chat/Stream.tsx";
import { StageManager } from "./canvas/StageManager.tsx";
import { stageOf, stages, viewOnly } from "./state/stages.ts";
import Eraser from "lucide-solid/icons/eraser";
import { ToolColumn } from "./v3/ToolColumn.tsx";
import { PenTray } from "./v3/PenTray.tsx";
import { TopBar } from "./v3/TopBar.tsx";
import { TopRight } from "./v3/TopRight.tsx";
import { ZoomBar } from "./v3/ZoomBar.tsx";
import { ChatSection, StatusPill } from "./v3/ChatSection.tsx";
import { installTooltips } from "./v3/tooltip.ts";
import { syncRings } from "./agents/ring-sync.ts";
import { NoticeStrip } from "./chrome/NoticeStrip.tsx";
import { LeftPanel, type PanelApp, type PanelTab } from "./panel/LeftPanel.tsx";
import type { CanvasItem } from "./panel/canvas-items.ts";
import {boxOf, fitInto, keepVisible, middleOf} from "@decks/canvas/camera";
import { baseTheme, placements } from "@decks/pen";
import { type AgentView, selectionOnSwitch, viewOnSwitch, viewToPark } from "@decks/canvas/camera";
import { agentViews } from "./camera/agent-views.ts";
import { closeHistory, setInspectable } from "./state/edge.ts";
import { canvasBox, insets, insetsMoving, watchInsets } from "@decks/canvas/camera";
import { installViewport, obscured } from "./app/viewport.ts";
import { scheme, toggleScheme } from "./lib/theme.ts";
import { UsageModal } from "./settings/UsageModal.tsx";
import { workingWords } from "./chat/working-sign.ts";
import { act, editDrawing, sendDrawingEdit, setDrawingEditor, setPersonStage } from "./state/decks.ts";

/**
 * The shell: a title bar, the stage, and the panels floating over it.
 *
 * All server state arrives on the socket and nothing is fetched twice — the
 * greeting after a connect is the whole deck, so a reconnect is a refresh. The
 * camera is the one piece of state that is the browser's alone; it is not sent
 * anywhere until an agent asks about it (M3).
 */
export function App() {
	/** The turn the chat was opened at, from a click on the spine. */
	const [atTurn, setAtTurn] = createSignal<{ id: string; at: number } | undefined>(undefined);

	/*
	 * The history window — asked for when a chat is shown, and reached back through on demand
	 * (`state/history.ts`). The map of waiting readers lives with the request it mints, which
	 * is why it is not part of the frame switch that answers it.
	 */

	/** How boards are drawn: each a live page (`dom`). The per-board canvas renderer went with the board frame. */
	const renderer = (): RendererChoice => "dom";
	/* What the stage is built for: a new renderer builds it again (`Show keyed` below). */
	const stageBuild = createMemo(() => ({ renderer: renderer() }), undefined, { equals: (a, b) => a.renderer === b.renderer });

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
			if (id) views().keep(id, stageOf(id)?.name, viewToPark(camera(), selected()));
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
	const sendFromBar = (typed: string, commentIds: string[] = [], queue = false) => {
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
				// Ctrl+Enter: held for the end of the turn, by the server (`DeckAgent.queueMine`), which sends it at once if there is none.
				if (queue) send({ type: "agent.queue", id: dest.id, action: "add", text: line });
				else send({ type: "agent.prompt", id: dest.id, text: line });
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
		const note = { id: `c${Date.now().toString(36)}`, board: target.path, quote: target.quote, text, at: Date.now(), ...(target.component ? { component: target.component } : {}), ...(target.items?.length ? { items: target.items } : {}) };
		if (how === "keep") {
			addComment(agentId, note);
			if (target.range) markComment(note.id, target.range);
			// Handed to the composer the way a dropped file is: a one-shot draft, here a pill.
			setDraft({ text: "", at: Date.now(), insert: true, agentId, comment: note.id });
		} else {
			send({ type: "agent.prompt", id: agentId, text: commentBlock([note]) });
		}
		target.frame?.contentDocument?.getSelection()?.removeAllRanges();
		setCommenting(undefined);
	};
	/* The popup belongs to browsing with the pen down; anything else puts it away. */
	createEffect(() => {
		// A comment on the whole board, from its pill, is not a selection and stays in any mode.
		if ((mode() !== "browse" || drawing()) && untrack(commenting)?.range) setCommenting(undefined);
	});
	/** The canvas on screen, when it is a friend's shared with you to view (`state/stages.ts`). */
	const viewOnlyStage = () => viewOnly(stageOf(state.focused)?.name);
	/* A backend that cannot write is read, and so is a friend's canvas shared with you to view: no edit mode and no pen, whichever key asked for them. */
	createEffect(() => {
		if (can("write") && !viewOnlyStage()) return;
		if (mode() !== "browse") setMode("browse");
		if (drawing()) setDrawing(false);
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
	/*
	 * The canvas column the floats may move in. The insets come from the signal, not from
	 * the `--inset-*` variables: the variables are written after the signal settles, so an
	 * effect on `insets()` that read them got the previous fold's numbers, and a float
	 * parked on the left stood still when the sidebar folded and then moved when it opened.
	 */
	let workRect: { width: number; height: number } | undefined;
	const workBox = () => {
		/* While the side panel is dragged the column's own box does not change, only its insets: the
		   box measured before is used, so a step reads nothing from a layout the drag has just dirtied. */
		if (!insetsMoving() || !workRect) {
			const rect = document.querySelector(".work")?.getBoundingClientRect();
			workRect = { width: rect?.width ?? window.innerWidth, height: rect?.height ?? window.innerHeight };
		}
		const { left, right } = insets();
		return { x: left, y: 0, w: workRect.width - left - right, h: workRect.height };
	};
	/*
	 * What a float must not land on: the other floats, as they stand now, in `workBox`'s frame.
	 * Measured from the page rather than kept as state, so a float that has not been dragged,
	 * a conversation that is shut and a toolbar that is not mounted all say so on their own.
	 * Of a tucked float only its tab shows, so its tab is what there is to run into.
	 */
	const FLOATS = ".dock, .pen-tools, .stream[data-shown='true']";
	const otherFloats = (el: HTMLElement) => () => {
		const work = document.querySelector(".work")?.getBoundingClientRect();
		return [...document.querySelectorAll<HTMLElement>(FLOATS)]
			.filter((other) => other !== el && other.offsetParent !== null)
			.map((other) => {
				const shown = other.hasAttribute("data-stowed") ? other.querySelector(":scope > .stowtab") : null;
				const r = (shown ?? other).getBoundingClientRect();
				return { x: r.left - (work?.left ?? 0), y: r.top - (work?.top ?? 0), w: r.width, h: r.height };
			});
	};
	/* Every mounted float, so one that has just landed can have the others step out of its way. */
	const floats = new Map<HTMLElement, { restore: () => void }>();
	/*
	 * `pin: "bottom"` writes the position as a `bottom` rather than a `top`. The composer is
	 * a column whose status row comes and goes above the box (it leaves when the conversation
	 * opens), and pinned by its top the box slid up into the row's place. Pinned by its
	 * bottom, the box stays where it was put and the row appears above it, which is what the
	 * dock's own CSS does at home. `read` is what a drag then starts from, because the top
	 * the float remembers is stale the moment the height changes.
	 */
	const mountFloat = (el: HTMLElement, key: string, handle: HTMLElement, ignore: string, home: () => { x: number; y: number }, pin: "top" | "bottom" = "top", stow?: { tab: number | (() => number); initially?: "left" | "right" }, disabled?: () => boolean) => {
		/* How tall the tab is (`--stowtab-h`, `shell.css`): a tucked float is only its tab. */
		const tabHeight = () => parseFloat(getComputedStyle(el).getPropertyValue("--stowtab-h")) || 48;
		let sized: { w: number; h: number } | undefined;
		const float = makeFloat(el, {
			...(stow ? { stow: { ...stow, tabHeight } } : {}),
			others: otherFloats(el),
			...(disabled ? { disabled } : {}),
			onSettled: () => {
				for (const [other, handle] of floats) if (other !== el) handle.restore();
			},
			key,
			handle,
			ignore,
			home,
			bounds: workBox,
			size: () => (sized = { w: el.offsetWidth, h: el.offsetHeight }),
			pin,
			read: () => ({ x: el.offsetLeft, y: el.offsetTop }),
			apply: (p, atHome, stowed) => {
				/*
				 * Put away, everything but the tab is out of reach as well as out of sight:
				 * `inert`, so Tab does not walk into a text box that is off the screen.
				 */
				if (stowed) el.setAttribute("data-stowed", stowed);
				else el.removeAttribute("data-stowed");
				for (const child of el.children) if (!child.hasAttribute("data-stowtab")) child.toggleAttribute("inert", stowed !== undefined);
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
					// The height last measured: a step of a panel's resize places it without reading the layout.
					el.style.bottom = `${workBox().h - (p.y + (sized?.h ?? el.offsetHeight))}px`;
				} else {
					el.style.bottom = "";
					el.style.top = `${p.y}px`;
				}
			},
		});
		floats.set(el, float);
		const dispose = float.dispose;
		return { ...float, dispose: () => { floats.delete(el); dispose(); } };
	};
	onMount(() => {
		const dock = dockEl;
		const handle = dock?.querySelector<HTMLElement>(".composer-box");
		if (!dock || !handle) return;
		const keepsOwn = "[data-slot='composer-input'], textarea, input, button, select, a, [role='menu'], [role='listbox'], .send-button";
		// On a phone the composer stays at the foot: its grip opens the conversation instead (below).
		const float = mountFloat(dock, "composer", handle, keepsOwn, () => {
			const box = workBox();
			return { x: box.x + box.w / 2 - dock.offsetWidth / 2, y: box.h - dock.offsetHeight - 12 };
		}, "bottom", { tab: STOW_TAB }, () => phone());
		createEffect(() => {
			phone();
			float.restore();
		});
		/*
		 * On a phone the grip is the conversation's: a tap on it, or a drag up from it, opens the history
		 * out of the composer (the tools give way while it is open); a tap or a drag down closes it again.
		 * The grip is the bar's top band and the little bar in it, not the words or the buttons.
		 */
		const SWIPE = 24;
		handle.addEventListener("pointerdown", (event) => {
			if (!phone() || event.button !== 0 || (event.target instanceof Element && event.target.closest(keepsOwn))) return;
			const start = { x: event.clientX, y: event.clientY, id: event.pointerId };
			let done = false;
			const finish = () => {
				done = true;
				window.removeEventListener("pointermove", move, true);
				window.removeEventListener("pointerup", up, true);
				window.removeEventListener("pointercancel", cancel, true);
			};
			const move = (next: PointerEvent) => {
				if (done || next.pointerId !== start.id) return;
				const dy = next.clientY - start.y;
				if (!phoneChat() && dy < -SWIPE) {
					finish();
					setPhoneChat(true, dock.getBoundingClientRect());
				} else if (phoneChat() && dy > SWIPE) {
					finish();
					setPhoneChat(false);
				}
			};
			const up = (next: PointerEvent) => {
				if (done || next.pointerId !== start.id) return;
				finish();
				if (Math.hypot(next.clientX - start.x, next.clientY - start.y) > 8) return;
				if (phoneChat()) setPhoneChat(false);
				else setPhoneChat(true, dock.getBoundingClientRect());
			};
			const cancel = (next: PointerEvent) => next.pointerId === start.id && finish();
			window.addEventListener("pointermove", move, true);
			window.addEventListener("pointerup", up, true);
			window.addEventListener("pointercancel", cancel, true);
		});
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
			// While the side panel is dragged a float follows it step by step, cheaply; it is put back properly once the drag ends.
			if (insetsMoving()) return float.follow();
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
	/*
	 * The drawing tools: the third float, taken by the grip at the column's head, on every
	 * screen. Like the composer, a hard throw at either edge tucks it behind that edge with
	 * its tab showing, and the tab can be dragged or pulled back out.
	 *
	 * Home is the CSS's own place, so it is **measured** whenever the column is standing there
	 * rather than worked out again here, with the window's middle only until it first has been.
	 */
	const mountToolsFloat = (tools: HTMLElement, grip: HTMLElement, key = "pen-tools"): { unstow: () => void } => {
		let seen: { x: number; y: number } | undefined;
		const home = () => {
			const work = document.querySelector(".work")?.getBoundingClientRect();
			if (!tools.hasAttribute("data-floating") && !tools.hasAttribute("data-stowed")) {
				const r = tools.getBoundingClientRect();
				seen = { x: r.left - (work?.left ?? 0), y: r.top - (work?.top ?? 0) };
			}
			const box = workBox();
			return seen ?? { x: box.x + 12, y: box.y + box.h / 2 - tools.offsetHeight / 2 };
		};
		const cssPx = (name: string, fallback: number) => parseFloat(getComputedStyle(tools).getPropertyValue(name)) || fallback;
		const float = mountFloat(
			tools,
			key,
			grip,
			"button, input, label",
			home,
			"top",
			{ tab: () => cssPx("--stowtab-w", 20) },
		);
		createEffect(() => {
			insets();
			// While the side panel is dragged a float follows it step by step, cheaply; it is put back properly once the drag ends.
			if (insetsMoving()) return float.follow();
			float.restore();
		});
		onCleanup(() => float.dispose());
		return { unstow: () => float.unstow() };
	};

	/*
	 * Start measuring the chrome.
	 *
	 * Before the socket, deliberately: the first `deck.state` can arrive with boards in it
	 * and trigger the opening fit, and a fit that runs before anything has been measured
	 * frames into the whole window and then never runs again.
	 */
	onMount(() => watchInsets());
	// A person's change goes to the canvas they are looking at, named on the frame (`state/socket.ts`).
	setOnScreen(() => stageOf(state.focused)?.name);
	// The same two for the person's clicks sent as verbs (`state/decks.ts`).
	setPersonStage(() => stageOf(state.focused)?.name, () => state.focused);

	/*
	 * One reading at startup, so an agent knows the canvas before anybody pans.
	 *
	 * Until now the server only ever heard about the camera *after* a gesture: a session
	 * where the user asked one question and never touched the canvas reported nothing, and
	 * `decks.view.viewport()` had nothing to answer with. Read at fire time rather than now,
	 * because the deck arrives and fits itself in the first moments and this should carry
	 * where that left the camera, not the {0,0,1} it started at.
	 *
	 * Once there is a conversation to report it for: a reading has to name whose stage it is,
	 * and the deck may still be arriving at 400ms. A later switch reports from `landed`.
	 */
	let reportedOpening = false;
	createEffect(() => {
		const id = state.focused;
		if (!id || reportedOpening) return;
		reportedOpening = true;
		const timer = window.setTimeout(() => {
			if (state.focused === id) reportCamera(camera(), id);
		}, 400);
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
		const view = views().of(id, stageOf(id)?.name);
		const size = { width: window.innerWidth, height: window.innerHeight };
		const next = viewOnSwitch({ view, playing, boards: state.boards, viewport: size, region: canvasBox(size) });
		if (next) setCamera(next);
		// The camera is this conversation's now, moved or not: say so, or its next board is
		// placed from the reading of whichever stage was on screen before (`camera-report.ts`).
		reportCamera(camera(), id);
		/* The board selection follows the camera: each conversation's canvas has its own. */
		setSelected(selectionOnSwitch(view, playing));
	};

	/** The conversation a switch is waiting for the canvas of — see `landed`. */
	let awaiting: string | undefined;

	const openingCamera = createMemo(() => {
		const id = state.focused;
		if (!id) return undefined;
		const size = { width: window.innerWidth, height: window.innerHeight };
		return viewOnSwitch({
			view: views().of(id, stageOf(id)?.name),
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
		void act("canvas.move", [path, { at: { x1: x, y1: y } }]);
	};

	const focusedChat = createMemo(() => state.chats.find((chat) => chat.id === state.focused));
	/* The conversation float shows the focused agent. Its history is asked for when it is shown. */
	const transcript = createMemo(() => {
		const id = state.focused;
		return id ? state.agents[id]?.transcript ?? [] : [];
	});
	createEffect(() => {
		if (chatShown()) ensureHistory(state.focused);
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
		// Its placeholder frames are marked with the agent that last wrote it, as the canvas knows it.
		const by = pen?.by ? state.identities[pen.by] : undefined;
		const writer = by ? { name: by.name, color: by.color } : undefined;
		return pen ? { doc: pen.doc, base: pen.base, scope: pen.stage, ...(pen.edits ? { edits: pen.edits } : {}), ...(pen.made ? { made: pen.made } : {}), ...(writer ? { writer } : {}) } : undefined;
	});
	/**
	 * Everything on the canvas in view, for framing it: its boards and every item drawn round them
	 * (notes, shapes, arrows, ink, frames), so a canvas that is mostly drawing is framed on its drawing.
	 */
	const canvasBoxes = (): Array<{ x: number; y: number; w: number; h: number }> => {
		const boxes = stageBoards().map(boxOf);
		const doc = stagePen()?.doc;
		if (doc) {
			const placed = placements(doc, { theme: baseTheme(doc, scheme() === "dark" ? "dark" : "light") });
			for (const node of doc.children ?? []) {
				const box = placed.get(node.id)?.box;
				if (box && box.w > 0 && box.h > 0) boxes.push({ x: box.x, y: box.y, w: box.w, h: box.h });
			}
		}
		return boxes;
	};


	/**
	 * Ink on the boards, which only browse mode has. A memo here rather than `a() && b()` in the
	 * prop: Solid compiles a conditional prop into a getter that makes a new computation on every
	 * read, and the stage reads this one in its pointer handlers, outside any owner, so each move
	 * warned that the computation would never be disposed.
	 */
	const inking = createMemo(() => drawing() && mode() === "browse");

	/** Undo or redo the person's own last edit to the drawing (`StagePens.step`), as sent; `edit` names it, as an edit's name. */
	const sendPenStep = (direction: "undo" | "redo", edit?: string) => {
		const agentId = state.focused;
		if (agentId) send({ type: "stage.pen.step", agentId, direction, ...(edit ? { edit } : {}) });
	};
	/** Undo or redo from a button or a key: through the canvas, which shows the step at once when it can (`drawing.ts`). */
	const penStep = (direction: "undo" | "redo") => {
		const handle = untrack(editorHandle);
		if (!handle) return sendPenStep(direction);
		if (direction === "undo") handle.undo();
		else handle.redo();
	};

	/**
	 * How tall each board's page was last measured, in this browser (`board/extent.ts`, `measureFrame`).
	 */
	const [flowHeights, setFlowHeights] = createSignal<Readonly<Record<string, number>>>({});
	const noteFlow = (path: string, h: number) => {
		if (flowHeights()[path] === h) return;
		setFlowHeights({ ...flowHeights(), [path]: h });
	};

	/**
	 * The boards on the focused agent's stage, at the size the stage draws them.
	 *
	 * **A board's height is a floor its content raises.** The stage file's height for a board is what a
	 * drag or a `decks.canvas.fit` gave it, and the board is drawn at least as tall as its page measures
	 * here, so it never clips a paragraph. Read in each browser and never written back: two browsers
	 * whose fonts lay it out a pixel apart each draw their own, rather than answering each other's
	 * height for ever.
	 *
	 * Kept in a store reconciled by path, so a board keeps its identity when its height is raised or
	 * changes: what lists the boards by identity (the stage's board pages) keeps its page rather than
	 * loading it again.
	 */
	const [shownBoards, setShownBoards] = createStore<Board[]>([]);
	createComputed(() => {
		const playing = new Set(state.focused ? (state.agents[state.focused]?.inPlay ?? []) : []);
		const flows = flowHeights();
		const list = state.boards
			.filter((board) => playing.has(board.path))
			.map((board) => {
				// A copy of its own: the merge below writes into this store's objects, never into the deck's.
				const copy = JSON.parse(JSON.stringify(board)) as Board;
				const h = shownHeight(board, flows[board.path]);
				return h === board.h ? copy : { ...copy, h };
			});
		setShownBoards(reconcile(list, { key: "path", merge: true }));
	});
	const stageBoards = (): Board[] => shownBoards;

	/*
	 * What `handleFrame` may touch (`app/frames.ts`). **Three fields**, and each has a reason
	 * to be here: a request registry `app/files.ts` owns and mints, a signal whose one reader
	 * is the conversation column, and behaviour that needs the component's own `focusAgent`.
	 * Everything else the handler uses it imports — the camera, the store.
	 */
	const frames: FrameHooks = {
		hearBoard: (request, path) => files.hearBoard(request, path),
		setAtTurn,
		raise,
		landed,
		focusAgent: (id) => focusAgent(id),
	};

	/** The file picker, for the composer's paperclip. */
	const pickFile = () =>
		new Promise<string | undefined>((resolve) => {
			setPicking({
				purpose: "attach",
				resolve: (picked: string | undefined) => {
					setPicking(undefined);
					resolve(picked);
				},
			});
		});

	const files = createFileDrops();
	const { addFile, intoComposer } = files;


	// A paste, and a drop on the canvas, over a board or not (`app/files.ts`).
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


	/** Open the panel. */
	const showBoards = (open: boolean) => setBoardsOpen(open);
	/** The Agents tab of the panel, asked for by the agent list's overflow row. */
	const [panelAsk, setPanelAsk] = createSignal<{ tab: PanelTab; at: number } | undefined>();
	const openAgentsPanel = () => {
		showBoards(true);
		setPanelAsk({ tab: "agents", at: Date.now() });
	};

	/*
	 * The v3 layout's own state.
	 *
	 * A phone is under 600px wide: its tools are a row above the composer, the top bars are one,
	 * and the conversation is a sheet that grows out of the status pill. Everywhere else the
	 * conversation is the side panel's lower half, folded or not, remembered on this device.
	 */
	const [viewWidth, setViewWidth] = createSignal(window.innerWidth);
	onMount(() => {
		const resized = () => setViewWidth(window.innerWidth);
		window.addEventListener("resize", resized);
		onCleanup(() => window.removeEventListener("resize", resized));
	});
	const phone = () => viewWidth() < 600;
	/* The conversation is not a float on the right edge any more, so the edge is the inspector's alone. */
	onMount(() => closeHistory());
	onMount(() => onCleanup(installTooltips()));
	onMount(() => onCleanup(syncRings()));
	const [chatFolded, setChatFoldedRaw] = createSignal(readChatFolded());
	const setChatFolded = (folded: boolean) => {
		setChatFoldedRaw(folded);
		try {
			localStorage.setItem(CHAT_FOLDED_KEY, folded ? "1" : "0");
		} catch {
			// Kept for the session.
		}
	};
	const [phoneChat, setPhoneChatRaw] = createSignal(false);
	/* The pill the phone's sheet opens out of, and the sheet's way out: it leaves quicker than it came. */
	const [sheetFrom, setSheetFrom] = createSignal<DOMRect | undefined>();
	const [sheetLeaving, setSheetLeaving] = createSignal(false);
	const setPhoneChat = (open: boolean, from?: DOMRect, gone = false) => {
		// Dragged off the screen already: it goes now, with no leaving animation after its own.
		if (!open && gone) {
			setSheetLeaving(false);
			return void setPhoneChatRaw(false);
		}
		if (open) {
			setSheetFrom(from ?? document.querySelector(".v3-status")?.getBoundingClientRect());
			setSheetLeaving(false);
			return void setPhoneChatRaw(true);
		}
		if (!phoneChat() || sheetLeaving()) return;
		setSheetLeaving(true);
		// As long as its slide off the screen (`v3-sheet-out`).
		setTimeout(() => {
			setPhoneChatRaw(false);
			setSheetLeaving(false);
		}, 260);
	};
	/** Whether the conversation is on screen: the panel's lower half, or the phone's sheet. */
	const chatShown = () => (phone() ? phoneChat() : boardsOpen() && !chatFolded());
	const openChat = () => {
		if (phone()) return void setPhoneChat(true);
		showBoards(true);
		setChatFolded(false);
		holdHistory();
	};
	/*
	 * While the conversation grows open or folds, its history stays where it rests: pinned to the
	 * bottom every frame, so the panel uncovers the messages rather than carrying them along.
	 */
	const holdHistory = (ms = 320) => {
		const until = performance.now() + ms;
		const pin = () => {
			for (const roll of document.querySelectorAll<HTMLElement>(".v3-chat .stream-roll")) roll.scrollTop = roll.scrollHeight;
			if (performance.now() < until) requestAnimationFrame(pin);
		};
		pin();
	};
	/** Present: the canvas alone, full screen. Escape, or leaving full screen, brings the chrome back. */
	const [presenting, setPresenting] = createSignal(false);
	const present = () => {
		setPresenting(true);
		void document.documentElement.requestFullscreen?.().catch(() => {});
	};
	onMount(() => {
		const keys = (event: KeyboardEvent) => {
			if (event.key === "Escape" && presenting()) setPresenting(false);
		};
		const left = () => {
			if (!document.fullscreenElement) setPresenting(false);
		};
		window.addEventListener("keydown", keys);
		document.addEventListener("fullscreenchange", left);
		onCleanup(() => {
			window.removeEventListener("keydown", keys);
			document.removeEventListener("fullscreenchange", left);
		});
	});
	/** The deck's apps, for the panel's Apps tab: asked for each time the tab opens. */
	const [apps, setApps] = createSignal<PanelApp[] | undefined>();
	const loadApps = () =>
		void act<Array<{ name: string; title?: string; status: string; board: string }>>("apps.list", []).then((list) => {
			if (list) setApps(list.map((app) => ({ name: app.name, title: app.title || app.name, status: app.status, board: app.board })));
		});
	const openAppsPanel = () => {
		showBoards(true);
		setPanelAsk({ tab: "apps", at: Date.now() });
	};
	/** The agents whose canvas is the one on screen: the faces in the top-right bar. */
	const hereAgents = createMemo(() => {
		const stage = stageOf(state.focused)?.name;
		if (!stage) return state.chats.filter((chat) => chat.id === state.focused);
		return state.chats.filter((chat) => stageOf(chat.id)?.name === stage);
	});
	const newCanvas = () => {
		const agentId = state.focused;
		if (!agentId) return;
		void act<{ name: string }>("canvas.create", ["Untitled"], agentId).then((made) => made && act("agent.update", [{ canvas: made.name }], agentId));
	};
	const setPen = (on: boolean) => {
		if (on && mode() === "edit") setMode("browse");
		setDrawing(on);
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
		if (leaving) views().keep(leaving, stageOf(leaving)?.name, viewToPark(camera(), selected()));

		setState("focused", id);
		setUnread(id, 0);

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
	 * and a list is also what an agent's `decks.view.focus` on several boards asks for.
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
	 * From the pick of another canvas until its camera has landed. The new canvas's boards can reach
	 * the page before the message that names the canvas, and drawn at the old camera they started
	 * pages for a view that lasted half a second; this holds every page from the moment of the pick.
	 */
	const [switchingCanvas, setSwitchingCanvas] = createSignal(false);
	let switchingTimer: ReturnType<typeof setTimeout> | undefined;
	const switchingFor = (on: boolean) => {
		clearTimeout(switchingTimer);
		setSwitchingCanvas(on);
		// Never for long: a switch the server refuses must not hold the canvas's pages.
		if (on) switchingTimer = setTimeout(() => setSwitchingCanvas(false), 4000);
	};

	/** Move the conversation to a canvas: the stage manager's pick, and the panel's Open. The camera follows when the server says the agent is there (the canvas effect below). */
	const openCanvas = (name: string) => {
		const agentId = state.focused;
		if (!agentId || stageOf(agentId)?.name === name) return;
		switchingFor(true);
		void act("agent.update", [{ canvas: name }], agentId);
	};

	/** Whether the stage manager is up. One state, because there is one of it (`StageManager`). */
	const [stagesOpen, setStagesOpen] = createSignal(false);
	/**
	 * Your own copy of a friend's canvas (`canvas.copyShared`), and this conversation moved onto it:
	 * how a canvas shared with you to view is changed. It syncs as your canvas, never back to theirs.
	 */
	const copyShared = (name: string) => {
		const agentId = state.focused;
		void act<{ name: string; title: string }>("canvas.copyShared", [{ canvas: name }]).then((made) => {
			if (!made) return;
			setStagesOpen(false);
			notice("info", `${made.title} is your own copy: change it as you like. It never changes theirs.`);
			if (agentId) {
				switchingFor(true);
				void act("agent.update", [{ canvas: made.name }], agentId);
			}
		});
	};

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
	/*
	 * Moving between canvases, whoever moved: the view of the canvas left is parked for this agent
	 * on this device, and the view this device last had of the canvas arrived at comes back — or,
	 * the first time there, the middle of what it holds. A view is agent × canvas × device
	 * (`camera/agent-views.ts`); a switch of agent parks and takes views on its own (`switchAgent`).
	 */
	let onCanvas: { agent?: string; stage?: string } = {};
	createEffect(() => {
		const agent = state.focused;
		const stage = stageOf(agent)?.name;
		const was = onCanvas;
		onCanvas = { agent, stage };
		if (!agent || was.agent !== agent || was.stage === undefined || was.stage === stage) return;
		/*
		 * The same canvas in a new folder: its first name was chosen, and named the folder too. The
		 * view stays as it is, kept under the new name, rather than landing as on a canvas arrived at.
		 */
		const renamed = untrack(() => stageOf(agent)?.formerly?.includes(was.stage!) === true);
		if (renamed) return void untrack(() => views().keep(agent, stage, viewToPark(camera(), selected())));
		untrack(() => {
			views().keep(agent, was.stage, viewToPark(camera(), selected()));
			landOnStage(views().of(agent, stage), stage);
		});
	});

	/*
	 * The one landing in flight, if any: the canvas it was started for, and how to call it off.
	 *
	 * Held for the whole app rather than inside each landing, because a landing with nothing
	 * remembered waits for boards — and a second switch inside that wait used to leave the first
	 * one running. It then read the boards of whatever canvas was current by the time it fired and
	 * fitted *those*, so a quick A → B → A came back to A at the arriving zoom, a screen away from
	 * where it was left, with its selection cleared. Reported 5 October 2026 and measured at 922px
	 * and 3.4× → 0.3× in `e2e/checks/camera-roundtrip.mjs`.
	 */
	let landing: { stage?: string; stop: () => void } | undefined;
	const stopLanding = () => {
		landing?.stop();
		landing = undefined;
	};
	onCleanup(stopLanding);

	const landOnStage = (view?: AgentView, forStage?: string) => {
		// Whatever was still arriving belongs to a canvas this is leaving: it does not get to land.
		stopLanding();
		/*
		 * A view this device had of the canvas is a camera, and needs nothing from the server: it is
		 * taken at once and without a glide, so the canvas's boards are drawn there from their first
		 * frame. Waiting for them and then gliding from the last canvas's camera drew them at a view
		 * that belongs to another canvas, and started pages for it (`Stage`, `landing`).
		 */
		if (view) {
			moveCamera(view.camera);
			setSelected(view.selected);
			reportCamera(camera(), state.focused);
			switchingFor(false);
			return;
		}
		const asked = Date.now();
		const stop = () => clearInterval(timer);
		const timer = setInterval(() => {
			if (Date.now() - asked > 6000) return stopLanding();
			/*
			 * Still the canvas this was started for? A switch calls it off, but a canvas can also
			 * change under it — the server saying so, another browser moving this agent — and a fit
			 * of the wrong canvas's boards is the one thing this must never do.
			 */
			if (forStage !== undefined && stageOf(state.focused)?.name !== forStage) return stopLanding();
			const stage = document.querySelector(".stage");
			if (!stage) return;
			// The boards of the conversation on screen, which are that stage's the moment it lands.
			const boxes = canvasBoxes();
			if (boxes.length === 0 && Date.now() - asked < 1200) return;
			stopLanding();
			const size = { width: stage.clientWidth, height: stage.clientHeight };
			moveCamera(middleOf(boxes, canvasBox(size), size, camera()));
			setSelected(undefined);
			switchingFor(false);
			reportCamera(camera(), state.focused);
		}, 200);
		landing = { ...(forStage === undefined ? {} : { stage: forStage }), stop };
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
		if (!state.boards.some((one) => one.path === path)) {
			notice("warn", `No board at ${path} — the link points at something this deck does not have.`);
			return false;
		}
		/*
		 * A link names the library file (`../../../boards/x.html` from a canvas's copy), and the canvas
		 * shows its own copy of it (`canvases/<canvas>/boards/x.html`): the copy is what moves, is
		 * selected and is flown to, once the canvas has one.
		 */
		const rest = path.replace(/^boards\//, "");
		const playing = () => (state.focused ? state.agents[state.focused]?.inPlay ?? [] : []);
		const onCanvas = () => playing().find((one) => one === path || (one.startsWith("canvases/") && one.split("/").slice(2).join("/") === `boards/${rest}`));
		const opening = !onCanvas();
		const land = (at: string) => {
			const board = state.boards.find((one) => one.path === at);
			const source = state.boards.find((one) => one.path === from);
			if (opening && source) move(at, source.x + source.w + 32, source.y);
			setSelected(at);
			const placed = state.boards.find((one) => one.path === at) ?? board;
			if (placed) flyToBoards([placed], { animate: true });
		};
		const there = onCanvas();
		if (there) {
			land(there);
			return true;
		}
		send({ type: "board.play", path });
		// The server copies the board into the canvas; it is landed when the copy arrives.
		const started = performance.now();
		const wait = () => {
			const copy = onCanvas();
			if (copy && state.boards.some((one) => one.path === copy)) return land(copy);
			if (performance.now() - started < 4000) setTimeout(wait, 60);
		};
		wait();
		return true;
	};



	/** The editor on screen (`createEditor`), for what this app asks of it from outside: a board's page loaded again. */
	const [editorHandle, setEditorHandle] = createSignal<CanvasHandle>();
	/** The drawn items selected on the canvas, for the panel's Canvas tab. */
	const [penSelected, setPenSelected] = createSignal<string[]>([]);
	/**
	 * A row of the Canvas tab: a board plays and is framed as from any list; a drawn item is selected
	 * and brought to the middle of the canvas, framed whole when it would not fit at this zoom.
	 */
	const pickItem = (item: CanvasItem) => {
		if (item.board) {
			const name = stageOf(state.focused)?.name;
			const path = state.boards.find((one) => one.path === item.board || (name && one.path === `canvases/${name}/${item.board}`))?.path;
			if (path) return playAndFrame(path);
		}
		untrack(editorHandle)?.select([item.id]);
		setPenSelected([item.id]);
		const stage = document.querySelector(".stage");
		if (!stage || item.box.w <= 0) return;
		const view = { width: stage.clientWidth, height: stage.clientHeight };
		const region = canvasBox(view);
		const fitted = fitInto([item.box], view, region);
		const zoom = Math.min(fitted.zoom, camera().zoom);
		const cx = item.box.x + item.box.w / 2;
		const cy = item.box.y + item.box.h / 2;
		moveCamera({ zoom, x: cx - (region.x + region.width / 2 - view.width / 2) / zoom, y: cy - (region.y + region.height / 2 - view.height / 2) / zoom }, { animate: true });
	};
	// The app's scheme, to the editor at each switch: it draws ink, cards and board pages in it.
	createEffect(() => {
		const dark = scheme() === "dark";
		untrack(editorHandle)?.setDark(dark);
	});
		// A board whose page has to load again without a new revision (`state.nonces`): told to the editor.
	let nonces: Record<string, unknown> | undefined;
	createEffect(() => {
		const now: Record<string, unknown> = { ...(state.nonces ?? {}) };
		const was = nonces;
		nonces = now;
		const handle = untrack(editorHandle);
		if (!handle || !was) return;
		for (const path of Object.keys(now)) if (now[path] !== was[path]) handle.reloadBoard(path);
	});

	/** A file of any kind, chosen in the file picker and placed in the middle of the view by what it is. */
	const openFileAtMiddle = () => {
		const stage = document.querySelector(".stage");
		if (!stage) return;
		void files.fileAt({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, false).then((path) => {
			if (!path) return;
			setSelected(path);
			frameWhenPlaced(path);
		});
	};

	/**
	 * What `⋯` holds: clearing the canvas, then the app's own. Highlighting is the pointer's menu now. Fit is the zoom bar's, and the
	 * context reading the composer's (a phone's ⋯ adds it back, `TopRight.tsx`).
	 *
	 * "Highlight on hover" is the canvas's mode: on (`edit`), what is under the pointer is outlined,
	 * a flow board shows its blocks' grips, and Alt shows distances; off (`browse`), nothing lights
	 * up and everything still moves, sizes and snaps.
	 */
	const moreItems = () => [
		{
			label: "Clear the canvas",
			icon: Eraser,
			disabled: stageBoards().length === 0,
			onPick: () => {
				const paths = stageBoards().map((board) => board.path);
				if (paths.length) void act("canvas.batch", [paths.map((path) => ({ op: "delete", id: path }))]);
			},
		},
		{ label: "Dark mode", icon: Moon, rule: true, checked: scheme() === "dark", onPick: () => toggleScheme() },
		{ label: "Shortcuts", icon: Info, onPick: () => setOps(true) },
		{
			label: "Settings",
			icon: SettingsIcon,
			onPick: () => {
				setSettings(true);
				send({ type: "claude.accounts", limits: true });
			},
		},
	];

	return (
		<div class="app" data-presenting={presenting() ? "true" : undefined} data-phone={phone() ? "true" : undefined} data-reader={can("write") ? undefined : ""} data-focus={focus() === undefined ? undefined : ""}>
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
				 * Keyed on the renderer, so changing it in Settings rebuilds the stage: a board's document
				 * lives in a different element under each renderer, and moving an iframe reloads it anyway,
				 * so a clean remount is the honest version of the same cost.
				 */}
				<div class="surface" data-surface="stage">
					<div class="surface-layer" data-layer="stage">
				<Show when={stageBuild()} keyed>
					{(current) => {
						/*
						 * The shared editor (`@decks/canvas`'s `createEditor`), as Studio's is: plain boards shown as
						 * pictures while the camera moves, the pill instead of title bars. This app keeps what is its
						 * own: the drawing is its server's (`document`), and the camera, selection, mode and ink are
						 * this app's state, so the agent-centric camera (per agent and canvas, on this device) and
						 * agents moving the view work as before.
						 */
						const editor = createEditor({
							text: "",
							// The app's scheme (`lib/theme.ts`): left out, the editor painted light over it on mount.
							dark: untrack(scheme) === "dark",
							renderer: current.renderer,
							toolbar: false,
							onSelection: (ids) => setPenSelected([...ids]),
							state: {
								pen: stagePen,
								opening: () => (state.focused ? { camera: openingCamera() } : undefined),
								camera: [camera, setCameraAndReport],
								glide,
								selected: [
									selected,
									(path) => setSelected(path),
								],
								mode: [mode, setMode],
								inking: drawing,
							},
							document: {
								send: (ops, edit) => {
									const agentId = state.focused;
									return agentId ? sendDrawingEdit(agentId, ops, edit) : Promise.resolve(false);
								},
								step: sendPenStep,
							},
							canvasName: () => (state.focused ? pens()[state.focused]?.stage : undefined),
							boards: {
								list: stageBoards,
								page: (path) => {
									const board = state.boards.find((one) => one.path === path);
									// At the revision its page was loaded at, when only its size has changed since (`pageRev`).
									return board ? boardUrl({ path: board.path, rev: pageRev(board) }) : undefined;
								},
								mintBoardToken: mintBoardToken,
								// A document board's socket, and comments on words selected in a board (`board/frame-hooks.ts`).
								attach: attachBoardFrame,
								sandboxed: isSharedBoard,
								mayStart: boardsMayStart,
								switching: switchingCanvas,
								onStarted: canvasOpened,
								onExtent: (path, extent) => {
									noteFlow(path, extent.h);
									send({ type: "board.extent", path, ...extent });
								},
								onOpenLink: openLinkedBoard,
								news: newsGlow,
								onRead: (path) => send({ type: "board.seen", path }),
								// Hide is the board's item deleted from the drawing, as the server's canvas.delete does: shown at once (`drawing.ts`).
								shots: () => {
									const adaptor = shotAdaptor();
									return {
										picture: (board, look) => adaptor.picture(board, look),
										ownPicture: adaptor.id !== "canvas",
									};
								},
							},
							onViewport: () => reportCameraSoon(camera()),
							onComment: (comment) => setCommenting({ ...comment, open: true }),
							onSelectTool: () => setPenTool("select"),
							onRefer: (pills) =>
								setDraft({
									text: "",
									pills,
									at: Date.now(),
									insert: true,
									...(state.focused ? { agentId: state.focused } : {}),
								}),
						});
						setEditorHandle(editor.handle);
						// Every edit to the drawing on screen goes through the canvas, which shows it at once (`state/decks.ts`).
						setDrawingEditor({ agentId: () => state.focused, edit: (ops) => editor.handle.edit(ops) });
						onPenRefused((_agentId, edit) => editor.handle.refused(edit));
						onCleanup(() => {
							setDrawingEditor(undefined);
							onPenRefused(undefined);
							setEditorHandle(undefined);
							editor.dispose();
						});
						return editor.surface();
					}}
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
				<TopBar
					panelOpen={boardsOpen() && !phone()}
					onTogglePanel={() => showBoards(!boardsOpen())}
					chats={state.chats}
					identities={state.identities}
					focused={state.focused}
					unread={unread}
					onFocus={focusAgent}
					onNew={(kind) => send({ type: "agent.create", ...(kind ? { kind } : {}), ...(state.focused ? { near: state.focused } : {}) })}
					onClose={closeAgent}
					onMoreAgents={openAgentsPanel}
					phone={phone()}
					onNewCanvas={newCanvas}
					{...(stageOf(state.focused) ? { stage: stageOf(state.focused)!.title } : {})}
					{...(stages().length > 0 ? { onStages: () => void setStagesOpen((was) => !was), stagesOpen: stagesOpen() } : {})}
					{...(viewOnlyStage() ? { viewOnly: viewOnlyStage()!.shared!.owner, onCopy: () => copyShared(viewOnlyStage()!.name) } : {})}
				/>

				{/*
					The stage manager: every stage in the deck, over the canvas.

					Here rather than inside the pill, because it covers the canvas and the pill is a
					cluster of controls 40px tall. The pill owns the button; this owns the surface.
				*/}
				<StageManager
					stages={stages()}
					onRename={(name, to) => send({ type: "stage.rename", name, to })}
					onDelete={(name) => send({ type: "stage.delete", name })}
					onCopy={copyShared}
					here={stageOf(state.focused)?.name}
					open={stagesOpen()}
					onClose={() => void setStagesOpen(false)}
					onPick={openCanvas}
					onNew={(title) => {
						const agentId = state.focused;
						if (!agentId) return;
						void act<{ name: string }>("canvas.create", [title], agentId).then((made) => made && act("agent.update", [{ canvas: made.name }], agentId));
					}}
					scheme={scheme()}
				/>

				<Show
					when={!phone()}
					fallback={
						<span class="v3-phone-more">
							<TopRight
								menuOnly
								here={[]}
								identities={state.identities}
								unread={unread}
								focused={state.focused}
								onFocus={focusAgent}
								onPresent={present}
								usage={state.focused ? state.agents[state.focused]?.usage : undefined}
								onContext={() => openUsage(state.focused)}
								more={moreItems()}
							/>
						</span>
					}
				>
					<TopRight
						here={hereAgents()}
						identities={state.identities}
						unread={unread}
						focused={state.focused}
						onFocus={focusAgent}
						onPresent={present}
						usage={state.focused ? state.agents[state.focused]?.usage : undefined}
						onContext={() => openUsage(state.focused)}
						more={moreItems()}
					/>
					<ZoomBar zoom={camera().zoom} onZoom={(zoom) => setCamera((c) => ({ ...c, zoom }))} onFit={() => fitAll(canvasBoxes(), setCamera)} />
				</Show>


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
					<PenTray
						onFloat={(tray, grip) => mountToolsFloat(tray, grip, "pen-tray")}
						onDone={() => setDrawing(false)}
						onStep={penStep}
						onDelete={(ids) => {
							const agentId = state.focused;
							if (agentId) void editDrawing(agentId, ids.map((id) => ({ op: "delete", id })));
						}}
					/>
				</Show>

				{/* The drawing's tools, in both modes: browse leaves the boards' pages as they are, not the drawing. */}
				<Show when={!(drawing() && mode() === "browse") && stagePen()}>
					{(pen) => (
						<PenBar
							tools={false}
							doc={editorHandle()?.drawn() ?? pen().doc}
							onEdit={(ops) => {
								const agentId = state.focused;
								if (agentId) void editDrawing(agentId, ops);
							}}
							onStep={penStep}
							onArm={() => {}}
							onExport={(ids) => {
								const agentId = state.focused;
								if (!agentId) return;
								// A link the browser downloads: the picture is taken on the server, which can take a moment.
								notice("info", "Taking the picture…");
								const link = document.createElement("a");
								link.href = api(`/stage-shot?${new URLSearchParams({ agent: agentId, of: ids.join(","), format: "png", scheme: scheme() })}`);
								link.download = "";
								link.click();
							}}
						/>
					)}
				</Show>

				{/* The tools, in every mode and while the pen is out: the pen is one of them (`v3/ToolColumn.tsx`). On a phone, a row in the dock. */}
				<Show when={stagePen() && !phone()}>
					<ToolColumn onStep={penStep} onFloat={mountToolsFloat} onApps={openAppsPanel} onOpenFile={openFileAtMiddle} onPen={setPen} mode={mode()} onMode={(next) => setMode(next)} />
				</Show>

				<Show when={ops()}>
					<CanvasOps onClose={() => setOps(false)} />
				</Show>

				<ConfirmDialog />

				<Show when={picking()}>
					{(request) => (
						<FilePicker
							onPick={(path) => request().resolve(path)}
							onCancel={() => request().resolve(undefined)}
							onAdd={(file) => addFile(file)}
							purpose={request().purpose ?? "embed"}
							{...(request().google ? { onGoogle: (url: string) => request().resolve(`google:${url}`) } : {})}
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
					news={newsGlow()}
					boards={state.boards}
					{...(stagePen()?.doc ? { canvasDoc: stagePen()!.doc } : {})}
					{...(stageOf(state.focused) ? { canvasTitle: stageOf(state.focused)!.title } : {})}
					selectedItems={penSelected()}
					onPickItem={pickItem}
					onPickArrows={(ids) => {
						editorHandle()?.select(ids);
						setPenSelected(ids);
					}}
					rail={!phone()}
					onSettings={() => {
						setSettings(true);
						send({ type: "claude.accounts", limits: true });
					}}
					pens={state.deck?.pens ?? []}
					onPlacePen={(pen) => {
						// A pen file goes on the stage as a ref, its corner at the middle of the view, as an agent places one.
						const agentId = state.focused;
						const at = camera();
						if (agentId) void editDrawing(agentId, [{ op: "insert", node: { type: "ref", ref: pen.ref }, box: { x1: Math.round(at.x), y1: Math.round(at.y) } }]);
					}}
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
					onNewAgent={(workspace, kind) => send({ type: "agent.create", kind, ...(workspace ? { workspace } : {}), ...(state.focused ? { near: state.focused } : {}) })}
					onCloseAgent={closeAgent}
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
					onHide={(board) => void act("canvas.delete", [board.path])}
					apps={apps()}
					onAppsOpen={loadApps}
					onPickApp={(app) => playAndFrame(app.board)}
					chat={
						<Show when={!phone()}>
					<ChatSection
						chat={focusedChat()}
						identity={state.identities[state.focused ?? ""]}
						unread={state.focused ? (unread[state.focused] ?? 0) : 0}
						folded={chatFolded()}
						onFold={(folded) => { setChatFolded(folded); holdHistory(); }}
						
					>
						<Stream
							shown={chatShown()}
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
							timeMachine="buttons"
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
					</ChatSection>
						</Show>
					}
				/>
				<Show when={phone() && phoneChat()}>
					<ChatSection
						chat={focusedChat()}
						identity={state.identities[state.focused ?? ""]}
						unread={state.focused ? (unread[state.focused] ?? 0) : 0}
						folded={false}
						onFold={(folded, gone) => (folded ? setPhoneChat(false, undefined, gone) : undefined)}
						from={sheetFrom()}
						leaving={sheetLeaving()}
						sheet
					>
						<Stream
							shown={chatShown()}
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
							timeMachine="buttons"
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
					</ChatSection>
				</Show>


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
					<button type="button" class="stowtab" data-stowtab aria-label="Bring the input bar back" title="Bring the input bar back" onClick={() => unstowComposer()}>
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

					{/* Only while nothing else says it: the panel's folded foot does, while the panel is open. */}
					<Show when={!chatShown() && (phone() || !boardsOpen())}>
						<StatusPill chat={focusedChat()} identity={state.identities[state.focused ?? ""]} onOpen={openChat} />
					</Show>
					<Show when={phone() && stagePen() && !phoneChat()}>
						<ToolColumn row onStep={penStep} onApps={openAppsPanel} onOpenFile={openFileAtMiddle} onPen={setPen} mode={mode()} onMode={(next) => setMode(next)} />
					</Show>

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
						onQueue={(text, comments) => sendFromBar(text, comments, true)}
						{...(queuedFor(state.focused) ? { queued: queuedFor(state.focused)! } : {})}
						onQueueAction={(action, item) => {
							const id = state.focused;
							if (id) send({ type: "agent.queue", id, action, ...(item ? { item } : {}) });
						}}
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
							onNew: (kind) => send({ type: "agent.create", ...(kind ? { kind } : {}), ...(state.focused ? { near: state.focused } : {}) }),
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
						onAccountsOpen={() => send({ type: "claude.accounts", limits: true })}
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
							void pickFile().then((path) => {
								if (path) setDraft({ text: `@${path}`, at: Date.now(), insert: true, ...(agentId ? { agentId } : {}) });
							});
						}}
						onDraftTaken={() => setDraft(undefined)}
						onDropFiles={(files) => void intoComposer(files)}
					/>
				</div>


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

function fitAll(boxes: Array<{ x: number; y: number; w: number; h: number }>, setCamera: (camera: Camera) => void): void {
	const stage = document.querySelector(".stage");
	if (!stage || boxes.length === 0) return;
	const view = { width: stage.clientWidth, height: stage.clientHeight };
	setCamera(fitInto(boxes, view, canvasBox(view)));
}

const CHAT_FOLDED_KEY = "decks.chatFolded";

/** Whether the panel's conversation was folded on this device. */
function readChatFolded(): boolean {
	try {
		return localStorage.getItem(CHAT_FOLDED_KEY) === "1";
	} catch {
		return false;
	}
}
