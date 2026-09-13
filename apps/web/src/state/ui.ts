import type { UsageReport } from "@decks/protocol";
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { openThumbnails } from "../canvas/thumb-budget.ts";
import { notice } from "./notices.ts";
import { send } from "./socket.ts";

/**
 * What the browser is showing that the server has no opinion about.
 *
 * Layer 2: it imports `socket` (to ask for a usage report) and `notices` (to say when a
 * board could not be read), and nothing imports it back. Everything here is *browser* state
 * — which panel is open, which modal is up, what the composer was handed — as distinct from
 * `deck`, which is the server's view of the world. A reload is allowed to lose all of it.
 *
 * ### Three decisions worth reading before changing anything here
 *
 * **The initial width is read through a function, not inline.** `boardsOpen` starts from the
 * window's width, and a module-scope `window.innerWidth` runs at *import* — so importing this
 * module in Node, which is what a unit test does, would throw before a single assertion ran.
 * `lib/media.ts` makes the same call for `canHover`, wrapping its `matchMedia` in a
 * try/catch, and this follows it.
 *
 * **`usageReport` is not called `report`.** It was, in `App.tsx`, where it was a closure. As
 * an import it would have been shadowed by the two upload handlers, which each declare a
 * local `const report = working(…)` and then call `report.update` on it. Shadowing is legal
 * and silent — neither the compiler nor the tests would have said anything — so the name
 * changed rather than the trap being left for whoever reads it next.
 *
 * **`unread` stays a map, and is not folded into the agent record.** It is a sixteenth thing
 * keyed by an agent id, so by the argument in `state/agent.ts` it ought to move there. It does
 * not, for the reason already recorded for `contexts` in `state/deck.ts`: it is handed *whole*
 * to three components — `AgentPill` declares `unread: Record<string, number>` twice — which
 * index it themselves. Moving it means changing those signatures, which is its own change.
 */

/**
 * Whether the boards panel starts open, from the width of the window.
 *
 * **Open where it is a panel, closed where it is a sheet.** Above 1100px it stands beside the
 * canvas and costs 264px of a wide window, which is a fair trade for knowing what the agent is
 * holding. Below that it is a sheet *over* the canvas, and a canvas app that opens with
 * something covering the canvas is answering a question nobody asked — on a 393px screen the
 * sheet took the left two thirds, and a pinch aimed at a board landed on a list of filenames.
 */
const panelOpensWith = (): boolean => {
	try {
		return window.innerWidth > 1100;
	} catch {
		// No window at all: a test, not a browser. Closed is the safe default, for the reason
		// above — a canvas that opens covered is worse than one that opens bare.
		return false;
	}
};

function createUi() {
	/**
	 * The deck being presented, and the slide it opened on.
	 *
	 * Browser-only, and deliberately: paging a deck is a *view*, not a change to it. Putting
	 * the slide number in the file would make every page-turn a write and the deck's git
	 * history a log of somebody presenting — so the cost is that a reload opens on slide
	 * one, which is the right way round.
	 */
	const [presenting, setPresenting] = createSignal<{ path: string; at: number } | undefined>();

	/**
	 * The board being edited as its own source, once its file has arrived.
	 *
	 * Fetched rather than read out of the frame. The frame holds the *rendered* markdown, and
	 * rendering is one-way — recovering the source from it is the round trip this editor
	 * exists to avoid. `?raw=1` is the same parameter the shell uses to ask for the file
	 * behind a board.
	 */
	const [editingSource, setEditingSource] = createSignal<{ path: string; source: string } | undefined>();

	const openSource = (path: string) => {
		void fetch(`/api/board/${path}?raw=1`)
			.then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
			.then((source) => setEditingSource({ path, source }))
			.catch(() => notice("error", `Could not read ${path} to edit it.`));
	};

	/**
	 * The file picker's promise, and which board asked.
	 *
	 * The board is what a file uploaded *through* the picker needs: an embed is written
	 * the way that board's document would address it (`embedPath`), so "add a photo from
	 * this phone" cannot be answered without knowing where the answer is going.
	 */
	const [picking, setPicking] = createSignal<{ resolve: (path: string | undefined) => void; board?: string } | undefined>(undefined);

	/**
	 * Whether the boards panel is there. One signal where the module it came from had two, because
	 * there is one panel now — and a plain signal rather than that module's persisted pair,
	 * since what it was mostly doing was closing one panel when the other opened.
	 */
	const [boardsOpen, setBoardsOpen] = createSignal(panelOpensWith());

	/** Settings: the Claude subscriptions this install can use (`chat/Settings.tsx`). */
	const [settings, setSettings] = createSignal(false);

	/**
	 * Words the server has handed to the input bar: the message a rewind took back.
	 *
	 * Stamped, so rewinding twice to the same message is two handovers rather than one the
	 * composer has already acted on.
	 */
	const [draft, setDraft] = createSignal<{ text: string; at: number; agentId?: string; insert?: boolean } | undefined>(undefined);

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
	 * The usage panel: whose it is open for, and what it has read.
	 *
	 * An agent id rather than a boolean, because every figure in it belongs to one agent and
	 * a panel that survived a switch would be showing the last agent's plan under this one's
	 * name. `usagePanel` is compared against `state.focused` before it is drawn, so moving
	 * to another conversation closes it rather than relabelling it.
	 *
	 * Two ways in. On a desktop the cheap reading is a popover on the dial under the input
	 * bar and this is what its last row opens; on a phone there is no room under the box, so
	 * `⋯` has one row for the reading and it opens this directly. The third way is `/cost`,
	 * which arrives from the server with `show` — see the `agent.report` case in `App.tsx`.
	 *
	 * The reading itself is *not* kept per agent across openings: it is read fresh every
	 * time, because two of its three parts are running totals and the third is a countdown.
	 */
	const [usagePanel, setUsagePanel] = createSignal<string | undefined>(undefined);
	const [usageReport, setUsageReport] = createSignal<{ report?: UsageReport; error?: string; loading: boolean }>({ loading: false });

	/** Re-read the figures for an agent without opening or moving the panel. */
	const readUsage = (id: string | undefined) => {
		if (!id) return;
		setUsageReport((was) => ({ ...was, loading: true }));
		send({ type: "agent.report", id });
	};

	/** Open the panel on an agent, and ask for its figures. */
	const openUsage = (id: string | undefined) => {
		if (!id) return;
		setUsagePanel(id);
		setUsageReport({ loading: true });
		send({ type: "agent.report", id });
	};

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
	 * Whether the app has opened, which is when the boards may start (`Stage`).
	 *
	 * Opened means the deck is laid out and the chat you are looking at has its history — the
	 * two things on screen that are the app's own. A board is a document on the same main
	 * thread, so boards that start while the chat is still arriving are a page that does not
	 * answer; they wait for this, and it happens once. Two frames after the history lands so it
	 * is painted first, or after a few seconds whatever happened, so a history that never comes
	 * cannot keep the canvas empty.
	 */
	const [boardsMayStart, setBoardsMayStart] = createSignal(false);

	/**
	 * And after that, the boards on the canvas are in: the rest of the panel's list may be
	 * drawn and the rail's thumbnails may start. Chat, then canvas, then the rest.
	 */
	const [boardsStarted, setBoardsStarted] = createSignal(false);

	/**
	 * Release the gate above, once.
	 *
	 * Called from wherever the first thing worth showing lands — the greeting, or the focused
	 * conversation's history — and from a timer, because a history that never comes must not
	 * keep the canvas empty. Idempotent: the first call wins and the rest are a boolean.
	 *
	 * It was `appOpened` in `App.tsx`, which is where the *decisions* about when to call it
	 * still are. The gate it fires is here, beside the signal it sets, so the frame switch can
	 * reach it without a hook.
	 */
	let opened = false;
	const releaseBoards = () => {
		if (opened) return;
		opened = true;
		requestAnimationFrame(() => requestAnimationFrame(() => setBoardsMayStart(true)));
	};

	const canvasOpened = () => {
		setBoardsStarted(true);
		openThumbnails();
	};

	return {
		presenting,
		setPresenting,
		editingSource,
		setEditingSource,
		openSource,
		picking,
		setPicking,
		boardsOpen,
		setBoardsOpen,
		settings,
		setSettings,
		draft,
		setDraft,
		ops,
		setOps,
		usagePanel,
		setUsagePanel,
		usageReport,
		setUsageReport,
		readUsage,
		openUsage,
		unread,
		setUnread,
		boardsMayStart,
		setBoardsMayStart,
		boardsStarted,
		setBoardsStarted,
		canvasOpened,
		releaseBoards,
	};
}

export type Ui = ReturnType<typeof createUi>;

/** The app's one set of browser state. Tests build their own with `createUi()`. */
export const ui = createUi();

export const {
	presenting,
	setPresenting,
	editingSource,
	setEditingSource,
	openSource,
	picking,
	setPicking,
	boardsOpen,
	setBoardsOpen,
	settings,
	setSettings,
	draft,
	setDraft,
	ops,
	setOps,
	usagePanel,
	setUsagePanel,
	usageReport,
	setUsageReport,
	readUsage,
	openUsage,
	unread,
	setUnread,
	boardsMayStart,
	setBoardsMayStart,
	boardsStarted,
	setBoardsStarted,
	canvasOpened,
	releaseBoards,
} = ui;
