import { FpsMeter, showFps } from "./perf/fps.tsx";
import { ConfirmDialog } from "./ui/ConfirmDialog.tsx";
import { queuedFor } from "./state/queued.ts";
import type { Board, Camera, ThinkingLevel } from "@decks/protocol";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import Info from "lucide-solid/icons/info";
import Moon from "lucide-solid/icons/moon";
import SettingsIcon from "lucide-solid/icons/settings";
import {createComputed, createEffect, createMemo, createSignal, on as watch, onCleanup, onMount, Show, untrack, type JSX} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { createFileDrops } from "./app/files.ts";
import { Settings } from "./settings/Settings.tsx";
import type { InkRequest } from "@decks/canvas";
import {forgetAskedResults, setToolResultSender} from "./chat/tool-results.ts";
import { createAlerts } from "./app/alerts.ts";
import { camera, glide, moveCamera } from "./state/camera.ts";
import { handleFrame, rememberView, type FrameHooks } from "./app/frames.ts";
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
import { pens } from "./state/pens.ts";
import { notice } from "./state/notices.ts";
import { boardsOpen, boardsStarted, focus, releaseBoards, draft, ops, openUsage, picking, readUsage, setBoardsOpen, setDraft, setOps, setPicking, setSettings, setUnread, setUsagePanel, settings, unread, usagePanel, usageReport } from "./state/ui.ts";
import { destination, destinationLabel, stripMention, withoutName } from "./app/send-from-bar.ts";
import { makeFloat } from "@decks/ui/float";
import { isNews } from "./panel/board-news.ts";
import { FilePicker } from "./board/FilePicker.tsx";
import { pageKey } from "./chat/composer/parked.ts";
import { commentBlock, withComments } from "./markup/comments.ts";
import { addComment, adoptFormerComments, cleanFrameComment, cleanFrameInk, cleanFramePills, removeComment, takeComments, waitingComments } from "./state/comments.ts";
import { drawing, setDrawing } from "@decks/canvas/tools";
import { CanvasOps } from "./canvas/CanvasOps.tsx";
import { createFramedEditor, type CanvasHandle } from "@decks/canvas";
import { canvasPass, cardAgentCall } from "./board/canvas-frame.ts";
import { Dialog } from "./chat/Dialog.tsx";
import { Composer } from "./chat/composer/Composer.tsx";
import { Stream } from "./chat/Stream.tsx";
import { StageManager } from "./canvas/StageManager.tsx";
import { stageOf, stages, viewOnly } from "./state/stages.ts";
import Eraser from "lucide-solid/icons/eraser";
import { TopBar } from "./v3/TopBar.tsx";
import { TopRight } from "./v3/TopRight.tsx";
import { ChatSection, StatusPill } from "./v3/ChatSection.tsx";
import { installTooltips } from "./v3/tooltip.ts";
import { syncRings } from "./agents/ring-sync.ts";
import { NoticeStrip } from "./chrome/NoticeStrip.tsx";
import { LeftPanel, type PanelApp, type PanelTab } from "./panel/LeftPanel.tsx";
import { CanvasSwitcher } from "./canvas/CanvasSwitcher.tsx";
import { canvasItems, type CanvasItem } from "@decks/canvas/tools";
import { setMineReader } from "@decks/agent-ui/chat";
import { aboutSent, messageParts, readParts, readSent } from "./chat/composer/pill-about.ts";
import type { Draft, DraftMention } from "./chat/composer/draft.ts";
import type { WaitingComment } from "./state/comments.ts";
import { boxOf, fitInto } from "@decks/canvas/camera";
import { baseTheme, placements } from "@decks/pen";
import { createLanding, type CameraOwner } from "@decks/canvas/camera";
import { agentViews } from "./camera/agent-views.ts";
import { closeHistory } from "./state/edge.ts";
import { canvasBox, insets, insetsMoving, watchInsets } from "@decks/canvas/camera";
import { installViewport } from "./app/viewport.ts";
import { scheme, toggleScheme } from "./lib/theme.ts";
import { UsageModal } from "./settings/UsageModal.tsx";
import { ask } from "./state/confirm.ts";
import { act, editDrawing, setDrawingEditor, setPersonStage } from "./state/decks.ts";

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

	/** The canvas the conversation on screen is on: with the agent, what its draft and its waiting comments are kept under. */
	const focusedCanvas = () => stageOf(state.focused)?.name;
	// Comments an earlier build kept under the agent alone wait on the canvas it is on now (`adoptComments`).
	createEffect(() => {
		const agent = state.focused;
		const canvas = focusedCanvas();
		if (agent && canvas) untrack(() => adoptFormerComments(agent, canvas));
	});

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
		const away = () => park();
		addEventListener("pagehide", away);
		onCleanup(() => removeEventListener("pagehide", away));
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
	const sendFromBar = (typed: string, commentIds: string[] = [], queue = false, draft?: Draft) => {
		const dest = destination(typed, barContext());
		/*
		 * The comments whose pills were in the field go in front of the words, whoever the words
		 * are for, and stop waiting. They are kept under the agent whose stage they were made
		 * on, which is the focused one: the only place a comment can be made is its stage.
		 */
		// In the order their pills sat in the text, which is the order `[comment n]` counts in.
		const held = state.focused && commentIds.length > 0 ? takeComments(state.focused, focusedCanvas()) : [];
		const notes = commentIds.flatMap((id) => held.filter((note) => note.id === id));
		const text = withComments(typed, notes);
		switch (dest.kind) {
			case "prompt": {
				const line = dest.named ? withComments(stripMention(typed, dest.name), notes) : text;
				/*
				 * The message as it was written, kept with it beside the text the agent gets (which this does not
				 * change): each pill by name, who put it in, and what its card shows, so the conversation draws it
				 * again after a reload and on another device. The `@name` that picked the agent is not part of it.
				 */
				const stage = stageOf(state.focused)?.name;
				const written = draft && messageParts(dest.named ? withoutName(draft, dest.name) : draft, notes, { titleOf, itemName, ...(stage ? { canvas: `canvases/${stage}` } : {}) });
				const parts = written?.some((part) => part.type === "mention") ? { parts: written } : {};
				// Ctrl+Enter: held for the end of the turn, by the server (`DeckAgent.queueMine`), which sends it at once if there is none.
				if (queue) send({ type: "agent.queue", id: dest.id, action: "add", text: line, ...parts });
				else send({ type: "agent.prompt", id: dest.id, text: line, ...parts });
				return;
			}
			case "note":
				notice("info", "Notes on a component are not built yet.");
				return;
			default:
				notice("info", "Pick an agent first.");
		}
	};

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
	/* The pencil is the hand in use from its first press until a finger or a mouse presses: the page is
	   then unselectable (`shell.css`), so a stroke never becomes a text selection. Set in the capture
	   phase, before Safari starts a selection from the same press. */
	onMount(() => {
		const press = (event: PointerEvent) => {
			const pen = event.pointerType === "pen";
			if (pen === document.documentElement.hasAttribute("data-pen")) return;
			document.documentElement.toggleAttribute("data-pen", pen);
			if (pen) getSelection()?.removeAllRanges();
		};
		window.addEventListener("pointerdown", press, true);
		onCleanup(() => window.removeEventListener("pointerdown", press, true));
	});
	let dockEl: HTMLDivElement | undefined;
	/** How far up from the bottom the dock reaches: the canvas frame puts a phone's tool row above it. */
	const [dockCover, setDockCover] = createSignal(0);
	/** Measured from the dock itself, whenever it is drawn: it comes and goes with the conversation. */
	const watchDock = (el: HTMLDivElement) => {
		dockEl = el;
		const measure = () => setDockCover(el.isConnected ? Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top)) : 0);
		const watch = new ResizeObserver(measure);
		watch.observe(el);
		addEventListener("resize", measure);
		queueMicrotask(measure);
		onCleanup(() => {
			watch.disconnect();
			removeEventListener("resize", measure);
			setDockCover(0);
		});
	};
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
	/*
	 * What the foot of the screen keeps for itself: as much of the home indicator's strip
	 * (`env(safe-area-inset-bottom)`, 25px on an iPad in Safari) as the composer's 12px does not already
	 * clear, and the keyboard while it is up. The stylesheet rests the composer there, so the floats'
	 * box stops there too:
	 * measured from the screen's own edge, home was 25px below where the composer rests, a drop near
	 * it landed low and then jumped, and a drop at the foot went under the home indicator.
	 */
	let footProbe: HTMLDivElement | undefined;
	const footInset = () => {
		if (!footProbe) {
			footProbe = document.createElement("div");
			footProbe.setAttribute("aria-hidden", "true");
			footProbe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:calc(max(12px, env(safe-area-inset-bottom, 0px)) - 12px + var(--keyboard, 0px))";
			document.body.appendChild(footProbe);
		}
		return parseFloat(getComputedStyle(footProbe).paddingBottom) || 0;
	};
	const workBox = () => {
		/* While the side panel is dragged the column's own box does not change, only its insets: the
		   box measured before is used, so a step reads nothing from a layout the drag has just dirtied. */
		if (!insetsMoving() || !workRect) {
			const rect = document.querySelector(".work")?.getBoundingClientRect();
			workRect = { width: rect?.width ?? window.innerWidth, height: rect?.height ?? window.innerHeight };
		}
		const { left, right } = insets();
		return { x: left, y: 0, w: workRect.width - left - right, h: workRect.height - footInset() };
	};
	/*
	 * What a float must not land on: the other floats, as they stand now, in `workBox`'s frame.
	 * Measured from the page rather than kept as state, so a float that has not been dragged,
	 * a conversation that is shut and a toolbar that is not mounted all say so on their own.
	 * Of a tucked float only its tab shows, so its tab is what there is to run into.
	 */
	const FLOATS = ".dock, .stream[data-shown='true']";
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
					// From the column's own foot, not the box's: the box stops above the home indicator, the CSS `bottom` does not.
					const full = workRect?.height ?? workBox().h + footInset();
					el.style.bottom = `${full - (p.y + (sized?.h ?? el.offsetHeight))}px`;
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
		/*
		 * The top bar's room beside the one on the right, `--topright-w`, so a narrow column (an iPad
		 * upright with the panel open) never has the two overlap; with little room, `data-tight-top`
		 * drops the agent's kind so its name and the canvas's keep theirs.
		 */
		const fitChrome = () => {
			const right = document.querySelector<HTMLElement>(".v3-topright")?.offsetWidth ?? 0;
			document.documentElement.style.setProperty("--topright-w", `${right}px`);
			const column = workBox().w;
			document.querySelector(".app")?.toggleAttribute("data-tight-top", column - 32 - right < 340);
			// Short of width, the composer takes the column's whole width less its margins, rather than 64px less.
			document.querySelector(".app")?.toggleAttribute("data-narrow-dock", column < 640);
		};
		createEffect(() => {
			insets();
			viewWidth();
			if (insetsMoving()) return;
			fitChrome();
			float.restore();
		});
		if (typeof ResizeObserver !== "undefined") {
			const right = new ResizeObserver(() => fitChrome());
			queueMicrotask(() => {
				const bar = document.querySelector(".v3-topright");
				if (bar) right.observe(bar);
			});
			onCleanup(() => right.disconnect());
		}
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
	 * and the deck may still be arriving at 400ms. A later switch reports from its landing (`settle`).
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
	/*
	 * And again whenever this browser is come back to: the harness answers an agent's `view.camera` with
	 * the newest reading of its canvas from any device (`deck/cameras.ts`), and the device the person is
	 * on now is the one whose view that should be, even before they pan.
	 */
	onMount(() => {
		const again = () => {
			if (document.visibilityState === "visible" && state.focused) reportCamera(camera(), state.focused);
		};
		window.addEventListener("focus", again);
		document.addEventListener("visibilitychange", again);
		onCleanup(() => {
			window.removeEventListener("focus", again);
			document.removeEventListener("visibilitychange", again);
		});
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

	/** How many deck frames have arrived: a landing with no canvas waits for one sent after it began (`landing`). */
	const [deckSeen, setDeckSeen] = createSignal(0);
	const landed = () => setDeckSeen((n) => n + 1);

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
	 * The boards on the focused agent's stage, at the size the stage draws them.
	 *
	 * **A board is as tall as the stage file says, and no taller.** Its height is what a drag, a
	 * `decks.canvas.fit` or `decks.canvas.update` gave it; what its page measures in this browser is
	 * sent to the harness for `fit` to report (`board.extent`) and never grows the board by itself,
	 * for a board and a card alike. A page taller than its board is cut at the board's foot.
	 *
	 * Kept in a store reconciled by path, so a board keeps its identity when its height is raised or
	 * changes: what lists the boards by identity (the stage's board pages) keeps its page rather than
	 * loading it again.
	 */
	const [shownBoards, setShownBoards] = createStore<Board[]>([]);
	createComputed(() => {
		const playing = new Set(state.focused ? (state.agents[state.focused]?.inPlay ?? []) : []);
		const list = state.boards
			.filter((board) => playing.has(board.path))
			.map((board) => {
				// A copy of its own: the merge below writes into this store's objects, never into the deck's.
				return JSON.parse(JSON.stringify(board)) as Board;
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
	/** What a sketch handed to the agent asks it, in words: a draft for the composer. */
	const inkAsked = (request: InkRequest): string | undefined => {
		if (request.ids.length === 0) return undefined;
		const n = request.ids.length;
		const b = request.box;
		const where = `[${n} ink ${n === 1 ? "stroke" : "strokes"} on the canvas ${request.canvas}, at x ${Math.round(b.x)} y ${Math.round(b.y)}, ${Math.round(b.w)} × ${Math.round(b.h)}: ${request.ids.join(", ")}]`;
		const keep = "Then hide the strokes, setting enabled to false on each, so they are kept in the file but not shown.";
		const asked =
			request.action === "drawing"
				? `Make this a drawing I can edit: a shape for each outline, the handwritten words as text, and arrows joined to the shapes they connect, in the same place and at the same size. ${keep}`
				: request.action === "board"
					? `Make this a board, placed where the strokes are and about their size. ${keep}`
					: "Read what is written or drawn there and act on it. If it is an instruction, carry it out; if it is a question, answer it; if it is a sketch or notes, say in a line what you read and what you would make of it.";
		return `${where}\n${asked}`;
	};
	/*
	 * What the canvas frame hands the composer (`@decks/canvas`, `frame/`): a comment, a sketch. Drafts,
	 * shown in the composer and sent only when you press Send there: anything in the frame can hand
	 * these over, a card's script too, so nothing from it goes to an agent on its word alone. Every text
	 * in them is cleaned of what cannot be seen and cut at 2,000 characters (`cleanFrame*`), and a
	 * comment's pill has a dashed edge, marked as from the canvas, and its card's Exact text is all of what
	 * is sent.
	 */
	const frameComment = (handed: { path: string; title: string; quote: string; text: string; send?: boolean; component?: string; items?: string[] }) => {
		const agentId = state.focused;
		if (!agentId) return;
		const canvas = focusedCanvas();
		const comment = cleanFrameComment(handed);
		const note = { id: `c${Date.now().toString(36)}`, board: comment.path, quote: comment.quote, text: comment.text, at: Date.now(), from: "canvas" as const, ...(comment.component ? { component: comment.component } : {}), ...(comment.items?.length ? { items: comment.items } : {}) };
		if (comment.send) setDraft({ text: commentBlock([note]), at: Date.now(), insert: true, agentId });
		else {
			addComment(agentId, canvas, note);
			setDraft({ text: "", at: Date.now(), insert: true, agentId, comment: note.id });
		}
	};
	const frameInk = (request: InkRequest) => {
		const agentId = state.focused;
		const text = inkAsked(cleanFrameInk(request));
		if (agentId && text) setDraft({ text, at: Date.now(), insert: true, agentId });
	};
	/** A picture of these drawn items to download, taken by the server. */
	const exportPicture = (ids: string[]) => {
		const agentId = state.focused;
		if (!agentId) return;
		// A link the browser downloads: the picture is taken on the server, which can take a moment.
		notice("info", "Taking the picture…");
		const link = document.createElement("a");
		link.href = api(`/stage-shot?${new URLSearchParams({ agent: agentId, of: ids.join(","), format: "png", scheme: scheme() })}`);
		link.download = "";
		link.click();
	};
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

		// The camera and the selection follow by themselves: the view is kept and taken by its owner (`landing`).
		setState("focused", id);
		setUnread(id, 0);
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
	 * out how the board you are now looking at relates to the one you were. a fit stays
	 * instant, because a keyboard shortcut is a hand and a chat switch is a change of context.
	 */
	const flyToBoards = (boards: Board[], options?: { animate?: boolean }) => {
		if (boards.length === 0) return;
		const stage = document.querySelector(".stage, iframe.canvas-frame");
		if (!stage) return;
		const view = { width: stage.clientWidth, height: stage.clientHeight };
		moveCamera(fitInto(boards.map(boxOf), view, canvasBox(view)), options);
	};

	/** Move the conversation to a canvas: the stage manager's pick, and the panel's Open. The camera follows when the server says the agent is there (the canvas effect below). */
	const openCanvas = (name: string) => {
		const agentId = state.focused;
		if (!agentId || stageOf(agentId)?.name === name) return;
		void act("agent.update", [{ canvas: name }], agentId);
	};

	/** The canvas switcher around a trigger: the panel head's title and the top bar's canvas chip both use it. */
	const canvasMenu = (trigger: (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element, placement: "bottom-start" | "bottom-end" = "bottom-start") => (
		<CanvasSwitcher
			stages={stages()}
			here={stageOf(state.focused)?.name}
			scheme={scheme()}
			placement={placement}
			onPick={(name) => openCanvas(name)}
			onNew={() => newCanvas()}
			onAll={() => void setStagesOpen(true)}
			trigger={trigger}
		/>
	);
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
			if (agentId) void act("agent.update", [{ canvas: made.name }], agentId);
		});
	};

	/*
	 * The camera, and whose it is (`camera/landing.ts`, shared with the canvas frame's views for other
	 * conversations, which it hands here to keep): a view kept per agent and canvas on this device,
	 * taken back exactly on arriving there, else the middle of everything on the canvas once its
	 * drawing is on screen. An agent with no canvas waits for a deck frame sent after it began, since
	 * its boards are the deck's.
	 */
	const landing = createLanding({
		views: () => views(),
		camera: () => untrack(camera),
		selected: () => untrack(selected),
		boxes: () => untrack(canvasBoxes),
		viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
		region: canvasBox,
		current: (to) => state.focused === to.scope && stageOf(to.scope)?.name === to.canvas,
		onScreen: (to) => !to.canvas || untrack(stagePen)?.scope === to.canvas,
		waitFor: (to, first) => {
			/*
			 * The page's first landing has no canvas being left, and its deck frame usually came before it
			 * began, so it takes any frame at all; it also waits for the canvas's boards themselves, the deck
			 * frame on hand may not have put them in play yet. A canvas's boards are in its drawing, so a
			 * switch to a canvas waits for nothing more: a switch by `agent.update` is followed by no deck frame.
			 */
			const deckAt = first ? 0 : untrack(deckSeen);
			return () => (to.canvas && !first ? true : untrack(deckSeen) > deckAt) && (!first || untrack(stageBoards).length > 0);
		},
		land: (next, to) => {
			moveCamera(next);
			reportCamera(next, to.scope);
		},
		select: (path) => setSelected(path),
	});
	onCleanup(landing.stop);
	const park = landing.park;
	const personMoved = (next: Camera) => {
		landing.personMoved(next);
		setCameraAndReport(next);
	};
	createEffect(() => {
		const agent = state.focused;
		const canvas = stageOf(agent)?.name;
		// Not before the canvases are known: an agent's canvas read as none would land once for no canvas, then again.
		if (!agent || (!canvas && stages().length === 0)) return;
		const to: CameraOwner = { scope: agent, ...(canvas ? { canvas } : {}) };
		untrack(() => landing.arrive(to, stageOf(agent)?.formerly));
	});

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



	/** The editor on screen (`createFramedEditor`), for what this app asks of it from outside: the scheme, a selection. */
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
		const stage = document.querySelector(".stage, iframe.canvas-frame");
		if (!stage || item.box.w <= 0) return;
		const view = { width: stage.clientWidth, height: stage.clientHeight };
		const region = canvasBox(view);
		const fitted = fitInto([item.box], view, region);
		const zoom = Math.min(fitted.zoom, camera().zoom);
		const cx = item.box.x + item.box.w / 2;
		const cy = item.box.y + item.box.h / 2;
		moveCamera({ zoom, x: cx - (region.x + region.width / 2 - view.width / 2) / zoom, y: cy - (region.y + region.height / 2 - view.height / 2) / zoom }, { animate: true });
	};
	/** A board's or card's title by its path, for the name on a pill's card. */
	const titleOf = (path: string) => state.boards.find((one) => one.path === path)?.title;
	/** A drawn item's name by its id, as the layers list calls it: its own name, or a few of its words. */
	const itemName = (id: string) => canvasItems(stagePen()?.doc).items.find((one) => one.id === id)?.label;
	/**
	 * Show what a pill is about (its card's name): a file opens in a new tab; a board, a card or a drawn
	 * item, or what a comment is on, is found on the canvas and framed as the side panel's rows do.
	 */
	const showPill = (node: DraftMention, comment?: WaitingComment) => {
		if (node.kind === "file") return void window.open(api(`/file?path=${encodeURIComponent(node.id)}`), "_blank", "noopener");
		const target = comment ? (comment.items?.[0] ?? comment.board) : node.id;
		const name = stageOf(state.focused)?.name;
		const item = canvasItems(stagePen()?.doc).items.find(
			(one) => one.id === target || (!!one.board && (one.board === target || target.endsWith(`/${one.board}`) || (!!name && `canvases/${name}/${one.board}` === target))),
		);
		if (item) return pickItem(item);
		const board = state.boards.find((one) => one.path === target);
		if (board) return flyTo(board);
		notice("info", "That is not on this canvas.");
	};
	// A message you sent, read back into its pills: from the parts kept with it, or, sent before they were, from its text.
	setMineReader((text, parts) => {
		const reading = (parts?.length ? readParts(parts) : undefined) ?? readSent(text, titleOf);
		return reading && { draft: reading.draft, pills: { about: (node) => aboutSent(reading, node, titleOf), show: (node) => showPill(node, node.kind === "comment" ? reading.comments.get(node.id) : undefined) } };
	});
	onCleanup(() => setMineReader(undefined));
	// The app's scheme, to the editor at each switch: it draws ink, cards and board pages in it.
	createEffect(() => {
		const dark = scheme() === "dark";
		untrack(editorHandle)?.setDark(dark);
	});

	/**
	 * A file of any kind, chosen in the file picker and placed in the middle of the view by what it is:
	 * the frame's tool column's "Add a file" (`frame/chrome.tsx`), which asks the page for its picker.
	 */
	const openFileAtMiddle = () => {
		const stage = document.querySelector(".stage, iframe.canvas-frame");
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

	/** The canvas: made once, as a component, so nothing read while it is made makes it again. */
	const StageEditor = (): JSX.Element => {
		/*
		 * The shared editor in a sandboxed frame of its own (`@decks/canvas`, `frame/`): the frame reads,
		 * follows and edits the canvas on screen on a ticket and a token for it, and draws this app's tools
		 * beside it (`frame/chrome.tsx`). This page keeps what is its own: the camera, selection, mode and
		 * ink are this app's state, kept in step with the frame, so the agent-centric camera (per agent and
		 * canvas, on this device) and agents moving the view work as before; and it answers what the frame
		 * hands over: drafts for the composer, a card's agent calls, apps, uploads, views for other agents.
		 */
		const editor = createFramedEditor({
			text: "",
			// The app's scheme (`lib/theme.ts`): left out, the editor painted light over it on mount.
			dark: untrack(scheme) === "dark",
			toolbar: false,
			onSelection: (ids) => setPenSelected([...ids]),
			state: {
				pen: stagePen,
				camera: [camera, personMoved],
				glide,
				selected: [selected, (path) => setSelected(path)],
				mode: [mode, setMode],
				inking: drawing,
			},
			canvasName: () => (state.focused ? pens()[state.focused]?.stage : undefined),
			boards: { onOpenLink: openLinkedBoard },
			onViewport: () => reportCameraSoon(camera()),
			onExport: exportPicture,
			onRefer: (pills) =>
				setDraft({
					text: "",
					pills: cleanFramePills(pills),
					at: Date.now(),
					insert: true,
					...(state.focused ? { agentId: state.focused } : {}),
				}),
			frame: {
				pass: canvasPass,
				comment: frameComment,
				ink: frameInk,
				panel: (name) => (name === "files" ? openFileAtMiddle() : openAppsPanel()),
				agent: cardAgentCall,
				dock: dockCover,
				composer: () => dockEl?.querySelector<HTMLElement>(".composer-box") ?? undefined,
				openApp: (name) => window.open(`/app/${encodeURIComponent(name)}/`, "_blank", "noopener"),
				upload: ({ files: dropped, at, card }) => files.dropAt(at, dropped, card),
				focused: () => state.focused,
				agents: () => Object.fromEntries(Object.entries(state.identities).map(([id, one]) => [id, { name: one.name, color: one.color }])),
				viewFor: rememberView,
			},
		});
		setEditorHandle(editor.handle);
		// Every edit to the drawing on screen goes through the canvas, which shows it at once (`state/decks.ts`).
		setDrawingEditor({ agentId: () => state.focused, edit: (ops) => editor.handle.edit(ops) });
		onCleanup(() => {
			setDrawingEditor(undefined);
			setEditorHandle(undefined);
			editor.dispose();
		});
		return editor.surface();
	};

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
				<div class="surface" data-surface="stage">
					<div class="surface-layer" data-layer="stage">
				<StageEditor />
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
					/* On a desktop the deck is in the panel's head; folded, the top bar holds only the button that brings the panel back. */
					panelOpen={boardsOpen() && !phone()}
					desktop={!phone()}
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
					{...(!phone() && stages().length > 0 ? { canvasMenu: (trigger: Parameters<typeof canvasMenu>[0]) => canvasMenu(trigger) } : {})}
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
<Show when={showFps()}>
	<FpsMeter />
</Show>
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
					onCanvases={() => void setStagesOpen((was) => !was)}
					{...(stages().length > 0 ? { canvasMenu: (trigger: Parameters<typeof canvasMenu>[0]) => canvasMenu(trigger) } : {})}
					onPickArrows={(ids) => {
						editorHandle()?.select(ids);
						setPenSelected(ids);
					}}
					desktop={!phone()}
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
					onAbortAgent={(id) => send({ type: "agent.abort", id })}
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
					onApp={async (app, action) => {
						const running = app.status === "running" || app.status === "asleep";
						/* Its board, made now if the app's folder was written by hand and has none yet. */
						const show = async () => {
							const own = `boards/apps/${app.name}.html`;
							const here = stageBoards().find((one) => one.path === own || one.path.endsWith(`/${own}`));
							if (here) return frameWhenPlaced(here.path);
							const made = (await act<string>("apps.board", [app.name])) ?? app.board;
							const placed = await act<{ board?: string }>("canvas.insert", [{ type: "board", board: made }]);
							frameWhenPlaced(placed?.board ?? made);
						};
						if (action === "show") return show();
						if (action === "run-show") {
							if (!running) await act("apps.run", [app.name]);
							loadApps();
							return show();
						}
						if (action === "delete") {
							const yes = await ask({ title: `Delete ${app.title}?`, body: `Its folder, apps/${app.name}, moves to the deck's trash, and its boards are deleted.`, yes: "Delete", no: "Cancel" });
							if (!yes) return;
							await act("apps.delete", [app.name]);
							return loadApps();
						}
						await act(action === "start" ? "apps.run" : action === "stop" ? "apps.stop" : "apps.restart", [app.name]);
						loadApps();
					}}
					onAppLogs={(app) => act<string[]>("apps.logs", [app.name, { tail: 80 }])}
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
						phone={phone()}
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
				<div class="dock" ref={watchDock}>
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

					<Composer
						draft={draft()}
						agentId={state.focused}
						page={pageKey(state.focused, focusedCanvas())}
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
						onSend={(text, comments, draft) => sendFromBar(text, comments, false, draft)}
						onQueue={(text, comments, draft) => sendFromBar(text, comments, true, draft)}
						{...(queuedFor(state.focused) ? { queued: queuedFor(state.focused)! } : {})}
						onQueueAction={(action, item) => {
							const id = state.focused;
							if (id) send({ type: "agent.queue", id, action, ...(item ? { item } : {}) });
						}}
						comments={waitingComments(state.focused, focusedCanvas())}
						onCommentsGone={(ids) => {
							for (const id of ids) if (state.focused) removeComment(state.focused, focusedCanvas(), id);
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
						 * what it hands back is a deck path — so what it inserts is a file pill, which the agent reads as an `@` mention
						 * of a file, which is the one thing in this app a message can point at.
						 */
						onAttach={() => {
							// Taken now: the picker can be open across a switch, and the mention is for
							// the conversation it was attached to. A deck path, not one relative to the
							// selected board — a message is not a board, and `@../assets/x.png` means
							// nothing to the agent reading it.
							const agentId = state.focused;
							void pickFile().then((path) => {
								if (path) setDraft({ text: "", files: [path], at: Date.now(), insert: true, ...(agentId ? { agentId } : {}) });
							});
						}}
						onDraftTaken={() => setDraft(undefined)}
						onDropFiles={(files) => void intoComposer(files)}
						titleOf={titleOf}
						itemName={itemName}
						onShowPill={showPill}
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

const CHAT_FOLDED_KEY = "decks.chatFolded";

/** Whether the panel's conversation was folded on this device. */
function readChatFolded(): boolean {
	try {
		return localStorage.getItem(CHAT_FOLDED_KEY) === "1";
	} catch {
		return false;
	}
}
