import { closeHistory } from "@decks/agent-ui/edge";
import type { FramedHandle } from "@decks/canvas";
import { watchInsets } from "@decks/canvas/camera";
import { drawing, setDrawing } from "@decks/canvas/tools";
import { createEffect, createSignal, onCleanup, onMount, untrack } from "solid-js";
import { syncRings } from "../agents/ring-sync.ts";
import { can } from "../connections/backend.ts";
import { scheme } from "../lib/theme.ts";
import { installTooltips } from "../shell/tooltip.ts";
import { preview, state } from "../state/deck.ts";
import { setPersonStage } from "../state/decks.ts";
import { ensureHistory } from "../state/history.ts";
import { mode, setMode } from "../state/selection.ts";
import { setOnScreen } from "../state/socket.ts";
import { setPicking } from "../state/ui.ts";
import { createAlerts } from "./alerts.ts";
import { createAppsPanel } from "./apps-panel.ts";
import { createBar } from "./bar.ts";
import type { CanvasHostInputs } from "../tabs/kinds/canvas-host.tsx";
import { createChatLayout, createPresenting } from "./chat-layout.ts";
import { parkOnLeaving, watchPencil } from "./device.ts";
import { createDock } from "./dock.ts";
import { createFileDrops } from "./files/drops.ts";
import { createFloats } from "./floats.ts";
import { setCommentSender } from "./frame-handoffs.ts";
import { installKeys } from "./keys.ts";
import { createCameraLanding, reportCameraOnArrival } from "./landing.ts";
import { createFraming } from "./links.ts";
import { createOnScreen } from "./on-screen.ts";
import { focusAgent, moveConversation, openAppsPanel, showPanel, viewOnlyStage } from "./person.ts";
import { createPills } from "./pills.ts";
import { listenToHarness, type FrameHooks } from "./socket-messages.ts";
import { installViewport } from "./viewport.ts";
import { canvasOnScreen } from "../tabs/tabs.ts";

/** The page's parts, as its sections are handed them. */
export type Parts = ReturnType<typeof createParts>;

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

/**
 * The page's parts, wired once when the app mounts: what is on screen, the layout, the bar, the
 * dock, the files, the camera's landing, the pills, and the connection to the harness.
 *
 * All server state arrives on the socket and nothing is fetched twice — the greeting after a
 * connect is the whole deck, so a reconnect is a refresh. The camera is the one piece of state that
 * is the browser's alone; it is not sent anywhere until an agent asks about it.
 *
 * The order is the order things must be ready in: the chrome is measured before the socket opens,
 * and each part is given the ones made before it, or reads a later one through a function.
 */
export function createParts() {
	/** The turn the chat was opened at, from a click on the spine. */
	const [atTurn, setAtTurn] = createSignal<{ id: string; at: number } | undefined>(undefined);

	/*
	 * The alerts: a cue, a banner and a badge, and the three conditions behind them
	 * (`app/alerts.ts`). Wired here because `raise` is called from the frame handlers,
	 * and clicking a banner has to be able to switch conversations.
	 */
	const { prefs, setPrefs, raise } = createAlerts({ focusAgent: (id) => focusAgent(id) });

	const onScreen = createOnScreen();
	const { views, stagePen, stagePages } = onScreen;
	parkOnLeaving(() => park());

	/*
	 * The bar's destination and the line sent from it (`app/bar.ts`): its pills are named by what
	 * the canvas calls them, read when the line is sent.
	 */
	const bar = createBar({ titleOf: (path) => pills.titleOf(path), itemName: (id) => pills.itemName(id) });
	// A comment's Send now, from the page's own comment box: sent as the composer sends a comment with no words beside it.
	setCommentSender((ids) => bar.sendFromBar("", ids));

	/* A backend that cannot write is read, and so is a friend's canvas shared with you to view: no edit mode and no pen, whichever key asked for them. */
	createEffect(() => {
		if (can("write") && !viewOnlyStage()) return;
		if (mode() !== "browse") setMode("browse");
		if (drawing()) setDrawing(false);
	});
	watchPencil();

	/* The floats and the dock (`app/floats.ts`, `app/dock.ts`): the layout is read once the page has mounted. */
	const floats = createFloats();
	const dock = createDock({ phone: () => layout.phone(), phoneChat: () => layout.phoneChat(), setPhoneChat: (open, from) => layout.setPhoneChat(open, from), viewWidth: () => layout.viewWidth() }, floats);
	/** A sheet is open in the canvas frame over the foot of the screen (a phone's properties drawer): the dock slides out of its way, as under an iOS sheet. */
	const [underSheet, setUnderSheet] = createSignal(false);

	/*
	 * Start measuring the chrome.
	 *
	 * Before the socket, deliberately: the first `deck.state` can arrive with boards in it
	 * and trigger the opening fit, and a fit that runs before anything has been measured
	 * frames into the whole window and then never runs again.
	 */
	onMount(() => watchInsets());
	// A person's change goes to the canvas they are looking at, named on the frame (`state/socket.ts`).
	setOnScreen(() => canvasOnScreen()?.name, () => state.focused);
	// The same two for the person's clicks sent as verbs (`state/decks.ts`).
	setPersonStage(() => canvasOnScreen()?.name, () => state.focused);
	// One camera reading at startup, and again whenever this browser is come back to (`app/landing.ts`).
	reportCameraOnArrival();

	/** How many deck frames have arrived: a landing with no canvas waits for one sent after it began (`landing`). */
	const [deckSeen, setDeckSeen] = createSignal(0);
	/*
	 * What the frame handlers may touch (`app/socket-messages.ts`): a request registry
	 * `app/files/drops.ts` owns and mints, a signal whose one reader is the conversation column, the
	 * alerts, and the person's own moves. Everything else a handler uses it imports.
	 */
	const frames: FrameHooks = {
		hearCreated: (request, path) => files.hearCreated(request, path),
		setAtTurn,
		raise,
		landed: () => setDeckSeen((n) => n + 1),
		focusAgent: (id) => focusAgent(id),
		moveConversation: (id, canvas) => moveConversation(id, canvas),
	};
	listenToHarness(frames);

	createEffect(() => {
		if (layout.chatShown()) ensureHistory(state.focused);
	});

	const files = createFileDrops();
	// A paste, and a drop on the canvas, over a board or not (`app/files/drops.ts`).
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
	installKeys({ openPanel: () => showPanel(true), find: setFindAt });

	/* The layout: phone or not, the conversation folded or a sheet (`app/chat-layout.ts`). */
	const layout = createChatLayout();
	/* The conversation is not a float on the right edge any more, so the edge is the inspector's alone. */
	onMount(() => closeHistory());
	onMount(() => onCleanup(installTooltips()));
	onMount(() => onCleanup(syncRings()));
	const { presenting, present } = createPresenting();

	/* A board put on the canvas is flown to once the server has placed it (`app/links.ts`). */
	const { frameWhenPlaced, playAndFrame } = createFraming(stagePages);
	/** The deck's apps, for the panel's Apps tab (`app/apps-panel.ts`). */
	const apps = createAppsPanel(stagePages, (path) => frameWhenPlaced(path));

	/* The camera, and whose it is (`app/landing.ts`). */
	const { park, personMoved } = createCameraLanding({ views, stagePen, stagePages, deckSeen });

	/** The editor on screen (`createFramedEditor`), for what this app asks of it from outside: the scheme, a selection. */
	const [editorHandle, setEditorHandle] = createSignal<FramedHandle>();
	/** The drawn items selected on the canvas, for the panel's Canvas tab. */
	const [penSelected, setPenSelected] = createSignal<string[]>([]);
	/* What a row, a pill or a sent message names, found on the canvas (`app/pills.ts`). */
	const pills = createPills({ stagePen, editorHandle, setPenSelected, playAndFrame });

	// The app's scheme, to the editor at each switch: it draws ink, cards and board pages in it.
	createEffect(() => {
		const dark = scheme() === "dark";
		untrack(editorHandle)?.setDark(dark);
	});

	/** What the canvas host (`tabs/kinds/canvas-host.tsx`) needs of this page. */
	const canvasHost: CanvasHostInputs = {
		stagePen,
		personMoved,
		setPenSelected,
		setEditorHandle,
		dockCover: dock.dockCover,
		composerBox: dock.composerBox,
		underSheet: setUnderSheet,
		openAppsPanel,
		files,
		frameWhenPlaced,
		moveConversation,
	};

	return { ...onScreen, atTurn, prefs, setPrefs, bar, dock, floats, underSheet, pickFile, files, findAt, layout, presenting, present, apps, editorHandle, penSelected, setPenSelected, pills, canvasHost };
}
