import { FpsMeter, showFps } from "./perf/fps.tsx";
import { ConfirmDialog } from "./ui/ConfirmDialog.tsx";
import { queuedFor } from "./state/queued.ts";
import type { Board, ThinkingLevel } from "@decks/protocol";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import {createComputed, createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack, type JSX} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { createFileDrops } from "./app/files.ts";
import { Settings } from "./settings/Settings.tsx";
import {forgetAskedResults, setToolResultSender} from "./chat/tool-results.ts";
import { createAlerts } from "./app/alerts.ts";
import { camera } from "./state/camera.ts";
import { handleFrame, type FrameHooks } from "./app/frames.ts";
import { installKeys } from "./app/keys.ts";
import { scratch } from "./state/agent.ts";
import { ensureHistory } from "./state/history.ts";
import { mode, selected, setMode } from "./state/selection.ts";
import { on, send, setOnScreen, start } from "./state/socket.ts";
import { can } from "./connections/backend.ts";
import { Icon } from "./ui/icons.tsx";
import {clearDialog, dialog, preview, runtimeFor, setState, state} from "./state/deck.ts";
import { pens } from "./state/pens.ts";
import { notice } from "./state/notices.ts";
import { boardsOpen, boardsStarted, releaseBoards, draft, ops, openUsage, picking, readUsage, setBoardsOpen, setDraft, setOps, setPicking, setSettings, setUnread, setUsagePanel, settings, unread, usagePanel, usageReport } from "./state/ui.ts";
import { destination, destinationLabel } from "./app/send-from-bar.ts";
import { FilePicker } from "./board/FilePicker.tsx";
import { pageKey } from "./chat/composer/parked.ts";
import { adoptFormerComments, removeComment, waitingComments } from "./state/comments.ts";
import { drawing, setDrawing } from "@decks/canvas/tools";
import { CanvasOps } from "./canvas/CanvasOps.tsx";
import type { FramedHandle } from "@decks/canvas";
import { Dialog } from "./chat/Dialog.tsx";
import { Composer } from "./chat/composer/Composer.tsx";
import { StageManager } from "./canvas/StageManager.tsx";
import { stageOf, stages, viewOnly } from "./state/stages.ts";
import { TopBar } from "./v3/TopBar.tsx";
import { TopRight } from "./v3/TopRight.tsx";
import { ChatSection, StatusPill } from "./v3/ChatSection.tsx";
import { installTooltips } from "./v3/tooltip.ts";
import { syncRings } from "./agents/ring-sync.ts";
import { NoticeStrip } from "./chrome/NoticeStrip.tsx";
import { LeftPanel, type PanelTab } from "./panel/LeftPanel.tsx";
import { CanvasSwitcher } from "./canvas/CanvasSwitcher.tsx";
import { agentViews } from "./camera/agent-views.ts";
import { closeHistory } from "./state/edge.ts";
import { watchInsets } from "@decks/canvas/camera";
import { installViewport } from "./app/viewport.ts";
import { scheme } from "./lib/theme.ts";
import { UsageModal } from "./settings/UsageModal.tsx";
import { act, editDrawing, setPersonStage } from "./state/decks.ts";
import { createBar } from "./app/bar.ts";
import { createFloats } from "./app/floats.ts";
import { createDock } from "./app/dock.ts";
import { createCameraLanding, reportCameraOnArrival } from "./app/landing.ts";
import { createFraming } from "./app/links.ts";
import { createPills } from "./app/pills.ts";
import { createAppsPanel } from "./app/apps-panel.ts";
import { moreItems } from "./app/more-menu.ts";
import { createChatLayout, createPresenting } from "./app/chat-layout.ts";
import { CanvasHost, type CanvasHostInputs } from "./app/canvas-host.tsx";
import { FocusedStream } from "./app/chat-stream.tsx";

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
	 * The bar's destination and the line sent from it (`app/bar.ts`): its pills are named by what
	 * the canvas calls them, read when the line is sent.
	 */
	const { barText, setBarText, agentName, barContext, sendFromBar } = createBar({ titleOf: (path) => titleOf(path), itemName: (id) => itemName(id) });


	/** The canvas on screen, when it is a friend's shared with you to view (`state/stages.ts`). */
	const viewOnlyStage = () => viewOnly(stageOf(state.focused)?.name);
	/* A backend that cannot write is read, and so is a friend's canvas shared with you to view: no edit mode and no pen, whichever key asked for them. */
	createEffect(() => {
		if (can("write") && !viewOnlyStage()) return;
		if (mode() !== "browse") setMode("browse");
		if (drawing()) setDrawing(false);
	});

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
	/* The floats and the dock (`app/floats.ts`, `app/dock.ts`): the layout is read once the page has mounted. */
	const floats = createFloats();
	const dock = createDock({ phone: () => phone(), phoneChat: () => phoneChat(), setPhoneChat: (open, from) => setPhoneChat(open, from), viewWidth: () => viewWidth() }, floats);


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

	// One camera reading at startup, and again whenever this browser is come back to (`app/landing.ts`).
	reportCameraOnArrival();


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
		hearCreated: (request, path) => files.hearCreated(request, path),
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
	files.install({
		preview,
		// A paste with the focus on this page: items copied on a canvas, or words, go to the canvas on screen.
		forward: (data) => {
			const handle = editorHandle();
			if (!handle?.paste) return false;
			handle.paste(data);
			return true;
		},
	});
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

	/* The layout: phone or not, the conversation folded or a sheet (`app/chat-layout.ts`). */
	const { viewWidth, phone, chatFolded, setChatFolded, phoneChat, setPhoneChat, sheetFrom, sheetLeaving, chatShown, openChat, holdHistory } = createChatLayout();
	/* The conversation is not a float on the right edge any more, so the edge is the inspector's alone. */
	onMount(() => closeHistory());
	onMount(() => onCleanup(installTooltips()));
	onMount(() => onCleanup(syncRings()));
	const { presenting, present } = createPresenting();
	/** The deck's apps, for the panel's Apps tab (`app/apps-panel.ts`). */
	const { apps, loadApps, onApp, onAppLogs } = createAppsPanel(stageBoards, (path) => frameWhenPlaced(path));

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

	/* A board put on the canvas is flown to once the server has placed it (`app/links.ts`). */
	const { frameWhenPlaced, playAndFrame } = createFraming(stageBoards);


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

	/* The camera, and whose it is (`app/landing.ts`). */
	const { park, personMoved } = createCameraLanding({ views, stagePen, stageBoards, deckSeen });


	/** The editor on screen (`createFramedEditor`), for what this app asks of it from outside: the scheme, a selection. */
	const [editorHandle, setEditorHandle] = createSignal<FramedHandle>();
	/** The drawn items selected on the canvas, for the panel's Canvas tab. */
	const [penSelected, setPenSelected] = createSignal<string[]>([]);
	/* What a row, a pill or a sent message names, found on the canvas (`app/pills.ts`). */
	const { pickItem, titleOf, itemName, showPill } = createPills({ stagePen, editorHandle, setPenSelected, playAndFrame });

	// The app's scheme, to the editor at each switch: it draws ink, cards and board pages in it.
	createEffect(() => {
		const dark = scheme() === "dark";
		untrack(editorHandle)?.setDark(dark);
	});

	/** What the canvas host (`app/canvas-host.tsx`) needs of this page. */
	const canvasHost: CanvasHostInputs = {
		stagePen,
		personMoved,
		setPenSelected,
		setEditorHandle,
		dockCover: dock.dockCover,
		composerBox: dock.composerBox,
		openAppsPanel,
		files,
		frameWhenPlaced,
	};


	return (
		<div class="app" data-presenting={presenting() ? "true" : undefined} data-phone={phone() ? "true" : undefined} data-reader={can("write") ? undefined : ""}>
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
				<CanvasHost host={canvasHost} />
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
								more={moreItems(stageBoards)}
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
						more={moreItems(stageBoards)}
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
					apps={apps()}
					onAppsOpen={loadApps}
					onApp={onApp}
					onAppLogs={onAppLogs}
					chat={
						<Show when={!phone()}>
					<ChatSection
						chat={focusedChat()}
						identity={state.identities[state.focused ?? ""]}
						unread={state.focused ? (unread[state.focused] ?? 0) : 0}
						folded={chatFolded()}
						onFold={(folded) => { setChatFolded(folded); holdHistory(); }}
						
					>
						<FocusedStream shown={chatShown()} items={transcript()} chat={focusedChat()} atTurn={atTurn()} />
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
						<FocusedStream shown={chatShown()} items={transcript()} chat={focusedChat()} atTurn={atTurn()} />
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
				<div class="dock" ref={dock.watchDock}>
					{/* Only drawn while the bar is put away behind the right edge (a hard throw
					    at it, `float.ts`): the one part of it left on screen, and the way back. */}
					<button type="button" class="stowtab" data-stowtab aria-label="Bring the input bar back" title="Bring the input bar back" onClick={() => dock.unstow()}>
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
