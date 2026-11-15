import { insetsOnly } from "@decks/canvas/camera";
import { Switcher } from "../connections/Switcher.tsx";
import { can } from "../connections/backend.ts";
import type { Page, DeckPen } from "../state/types/index.ts";
import type { PenDocument } from "@decks/pen";
import AppWindow from "lucide-solid/icons/app-window";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Circle from "lucide-solid/icons/circle";
import Clock from "lucide-solid/icons/clock";
import Sparkles from "lucide-solid/icons/sparkles";
import FileText from "lucide-solid/icons/file-text";
import MoveUpRight from "lucide-solid/icons/move-up-right";
import PenLine from "lucide-solid/icons/pen-line";
import Square from "lucide-solid/icons/square";
import StickyNote from "lucide-solid/icons/sticky-note";
import Type from "lucide-solid/icons/type";
import Layers from "lucide-solid/icons/layers";
import Folder from "lucide-solid/icons/folder";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import SettingsIcon from "lucide-solid/icons/settings";
import X from "lucide-solid/icons/x";
import { createEffect, createMemo, createSignal, createUniqueId, For, onCleanup, onMount, Show, untrack, type JSX } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { Icon } from "@decks/ui";
import { clampPanelWidth, loadPanelWidth, PANEL_MAX, PANEL_MIN, PANEL_WIDTH, savePanelWidth } from "./panel-width.ts";
import type { AgentChat, Identity } from "../state/types/index.ts";
import { AgentHoverCard } from "../agents/AgentHoverCard.tsx";
import { AgentRow } from "../agents/AgentRow.tsx";
import { NewAgentButton } from "../agents/face/view.tsx";
import type { AgentKind } from "../state/types/index.ts";
import { agentSections, recentAgents, type AgentRow as AgentListRow, type AgentSection } from "../agents/agent-sections.ts";
import { DecksLineMark } from "./DecksLineMark.tsx";
import { canvasItems, type CanvasItem, type ItemKind } from "@decks/canvas/tools";
import { carriesAgent, draggedAgent } from "../agents/agent-drag.ts";

/**
 * The left panel: one surface, **one list**, and a button that makes it go away.
 *
 * It replaces three things. The floating context rail, the floating agents panel and the
 * full-screen `AllBoards` modal all answered "what is on this canvas, and what else is
 * there" — and the first two could not be open at once because the panel module closed one
 * when the other opened. That is a tab strip with the strip left out: the relationship was
 * enforced in code and invisible on screen, which is why the third surface had nowhere to
 * live and became a modal over the canvas you were looking at.
 *
 * For a while the answer was a real tab strip: **Context** and **Deck**. That was one
 * surface too few and one list too many — everything in Context was also in Deck, so the two
 * tabs were the same list with a line drawn through it, and finding a board began with
 * guessing which side of the line the app had put it on *this second*.
 *
 * So there is one scroller with three headings in it — **on the canvas**, **held, not
 * shown**, **in the deck** — and one search field over all of it. `panel-groups.ts` owns the
 * grouping and argues it; what is left here is the surface. Agents are the second tab, filed by
 * workspace (`agent-sections.ts`).
 *
 * The first two sections are the **focused agent's**, all of them and nothing else — no
 * other agent's holdings appear anywhere, and a board somebody else is holding is simply in
 * the deck like any other. So nothing on this screen has to ask whose a row is.
 *
 * ### Folded means gone
 *
 * The panel is opened and closed by a **button** — the leftmost control in the top-left
 * pill, which owns `open` and passes it in here — and by `⌘\`. It is not summoned by the
 * cursor coming near the edge, which is what the panels used to do: a surface you rely
 * on to know what an agent is holding should not arrive because of where the mouse happens
 * to be, and a button that disagrees with the screen is worse than no button.
 *
 * And **there is no 40px strip**. An earlier draft folded to one, holding the two tab icons
 * and a chevron, on the argument that a panel which disappears entirely is a keyboard
 * shortcut you have to remember. That argument dies with the hover: the strip existed
 * because a hover-summoned panel needed something to aim at, and **a button is that
 * something**. Folded, this component draws nothing at all — which is also what makes the
 * camera correct for free, since `camera/insets.ts` measures what is in the document and an
 * absent panel measures nothing.
 *
 * It must stay *mounted* while folded, though, because `⌘\` is registered here. Wrapping the
 * call site in a `<Show>` would take the shortcut away in exactly the state it is needed.
 *
 * ### Presentational
 *
 * No socket, no app state: boards in, `onPickItem` out. The panel is a picture of what it is
 * given, and everything with a rule behind it — which board is in which section, what the
 * search matches — is in `panel-groups.ts`, where it can be tested without a DOM.
 */

/**
 * Which list the panel is showing.
 *
 * Two genuinely different collections, which is what makes a strip defensible here — see the
 * note on the `chats` prop.
 */
export type { PanelTab } from "./model.ts";
import { PANEL_TABS, tabBeside, type PanelTab } from "./model.ts";
import { createPanelTab, createPanelWidth } from "./actions.ts";

/** The strip's order: who is working, what is on the stage, and the deck's apps. It opens on Agents. */
const PANEL_TAB_LABEL: Record<PanelTab, string> = { recent: "Recent", canvas: "Canvas", agents: "Agents", apps: "Apps" };
const PANEL_TAB_ICON = { recent: Clock, canvas: Layers, agents: Sparkles, apps: AppWindow };

/** An app in the deck's `apps/` folder, as `apps.list` answers: its name, title, state and board. */
export type { PanelApp } from "./AppRow.tsx";
import { type AppAction, type PanelApp } from "./AppRow.tsx";
import { AppsTab, CanvasTab } from "./tabs/view.tsx";
import { AgentsTab, RecentTab, type Lists } from "./lists/view.tsx";

export function LeftPanel(props: {
	/** A tab asked for from outside — the agent menu's overflow row opens Agents. A new `at` is a new ask. */
	ask?: { tab: PanelTab; at: number };
	/** Every board there is. The list is all of them, in three sections. */
	boards: Page[];
	/** The `.pen` files in `boards/` and `frames/`, listed after the boards; a press places one on the stage. */
	pens?: DeckPen[];
	onPlacePen?: (pen: DeckPen) => void;
	/**
	 * Whether the rest of the list may be drawn. The first screenful is drawn at once; the rows
	 * below it wait for the app and its canvas to have opened (`App`), then arrive a chunk at a
	 * time. Left out, the whole list is drawn.
	 */
	listMayGrow?: boolean;
	/** The board the canvas is centred on. */
	current?: string;
	/** The focused agent's in-play set: what is actually on the canvas. */
	inPlay?: string[];
	/** Boards the focused agent holds and has taken off its stage: the Boards tab's "Held, not shown". */
	kept?: string[];
	/** The agent you are talking to, for the Agents tab. */
	focused?: string;
	/** Folded is gone. Owned by the pill's button, so the two can never disagree. */
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * A stamp that means "find a board now": take the cursor into the search field.
	 *
	 * `⌘K` is the caller. A stamp rather than a boolean because pressing it twice in a row
	 * is two requests, and a flag would make the second one look like a state the panel was
	 * already in — the same reason `draft` and `scrollTo` carry one.
	 */
	findAt?: number;

	// --- the Agents tab ---------------------------------------------------------------
	/**
	 * Every chat, for the second tab.
	 *
	 * A tab strip is back, and it is not the one that was removed. **Context** and **Deck**
	 * were one collection with a line drawn through it — everything in Context was also in
	 * Deck, so finding a board began by guessing which side the app had put it on this
	 * second. Boards and agents overlap in *nothing*: no agent is in the boards list and no
	 * board is in the agents list, so the invariant that mattered — every item appears
	 * exactly once — stays true trivially rather than by argument.
	 */
	chats?: AgentChat[];
	identities?: Record<string, Identity>;
	unread?: Record<string, number>;
	onFocusAgent?: (id: string) => void;
	/** Make an agent in a workspace (`undefined` for none) — the `+` on a heading of the workspace cut. */
	onNewAgent?: (workspace: string | undefined, kind: AgentKind) => void;

	onCloseAgent?: (id: string) => void;
	/** Replace *your* tags on an agent. Absent means no row can be customised. */
	onAgentTags?: (id: string, tags: string[]) => void;
	/** Move an agent into a workspace, or out of one with `null`. */
	onAgentWorkspace?: (id: string, workspace: string | null) => void;
	/** Rename an agent, from the edit window its row opens. */
	onAgentRename?: (id: string, name: string) => void;
	/** Stop the turn an agent is running (the row menu's Stop its turn). */
	onAbortAgent?: (id: string) => void;

	/**
	 * The desktop layout, drawn on the Decks Studio canvas ("tt-sidebar-redesign"): the head holds
	 * Decks' mark, the canvas, Settings and Hide, and a row of tab buttons sits under it, above the
	 * search. Left out on a phone, where the panel is a sheet with its own tab strip.
	 */
	desktop?: boolean;
	onSettings?: () => void;

	// --- the Canvas tab ---------------------------------------------------------------
	/** The drawing on screen: the tab lists its top-level items. */
	canvasDoc?: PenDocument;
	canvasTitle?: string;
	/** The drawn items selected on the canvas, by id. */
	selectedItems?: string[];
	/** A row pressed: select that item and bring it into view. */
	onPickItem?: (item: CanvasItem) => void;
	onPickArrows?: (ids: string[]) => void;
	/** The head's canvas title, pressed: the canvas manager. */
	onCanvases?: () => void;
	/** The canvas switcher around the head's canvas title (`canvas/CanvasSwitcher.tsx`). */
	canvasMenu?: (trigger: (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element) => JSX.Element;

	// --- the Apps tab -----------------------------------------------------------------
	/** The deck's apps; asked for when the tab opens. */
	apps?: PanelApp[];
	onAppsOpen?: () => void;
	/** Show, start, stop, restart or delete an app (`panel/AppRow.tsx`); its promise ends the row's wait. */
	onApp?: (app: PanelApp, action: AppAction) => Promise<unknown> | void;
	/** An app's recent output, for its Logs panel. */
	onAppLogs?: (app: PanelApp) => Promise<string[] | undefined>;

	/** The conversation, under the list: the v3 panel's lower half (the conversation section). */
	chat?: JSX.Element;
}) {
	const ids = createUniqueId();
	/*
	 * One line or two per agent. Remembered: it is how this person likes the
	 * list, not a question about it. Two is what it opens on, because the second line is the
	 * one fact worth reading at a glance: what each agent is doing.
	 */
	/* Two lines per agent, as v3 draws them: the name, kind and state, then the tags. */
	const lines = (): 1 | 2 => 2;
	/* The row under the pointer, for the one hover card the list shares, and only in the one-line view. */
	const [hovered, setHovered] = createSignal<{ id: string; at: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height"> } | undefined>();
	/*
	 * The card the list shares, held after the pointer leaves so it is **mounted once**.
	 *
	 * `AgentHoverCard` is built to be mounted and then unhidden: it places itself on the frame
	 * after its anchor changes, and until it has it draws nothing, so that it can never flash at
	 * `0,0` on its way to a row. Drawn inside a `<Show when={hovered()}>` that promise is
	 * inverted — every row entered built a new card, hid it for a frame and faded it in, and
	 * every row left threw it away. Running down a dense list that reads as a strobe: one flash
	 * per row, and the 160ms slide between rows never ran at all because there was never a card
	 * old enough to slide.
	 *
	 * So the memo keeps the last agent while the card fades out, and `shown` alone says whether
	 * it is up. Nothing is rebuilt between rows; the anchor changes and the card travels.
	 */
	const card = createMemo<{ chat: AgentChat; at: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height"> } | undefined>((previous) => {
		const over = hovered();
		if (!over) return previous;
		const chat = (props.chats ?? []).find((one) => one.id === over.id);
		return chat ? { chat, at: over.at } : previous;
	});
	const cardShown = () => (tab() === "agents" || tab() === "recent") && lines() === 1 && hovered() !== undefined;
	/* Beside the panel and level with the row: the row's height, the panel's sides, so the card clears the panel's edge. */
	const besideRow = (row: DOMRect, element: Element | null) => {
		const side = element?.getBoundingClientRect() ?? row;
		return { left: side.left, right: side.right, width: side.width, top: row.top, bottom: row.bottom, height: row.height };
	};
	const [query, setQuery] = createSignal("");
	/** The app picked in the Apps tab, and the one whose logs are open. */
	/* Agents first, as v3 opens; the tab last shown is remembered on this device. */
	const { tab, setTab, folded, toggleFolder } = createPanelTab();
	createEffect(() => {
		if (tab() === "apps" && props.open) props.onAppsOpen?.();
	});
	/* Workspace folders folded shut, remembered on this device. */
	const apps = createMemo(() => {
		const q = query().trim().toLowerCase();
		return (props.apps ?? []).filter((app) => !q || app.title.toLowerCase().includes(q) || app.name.toLowerCase().includes(q));
	});
	createEffect(() => {
		const ask = props.ask;
		if (ask) setTab(ask.tab);
	});

	/*
	 * The width is the person's to set, by the handle on the panel's right edge.
	 * Nothing else is told, because everything beside the panel reads `--inset-left`, which
	 * is measured from this box (`camera/insets.ts`).
	 */
	const { width, resizing, onHandleDown, onHandleKey, reset } = createPanelWidth();

	/*
	 * Switching tabs clears the query.
	 *
	 * The one thing the old strip got right, and it was right for a reason that applies here
	 * and did not apply there: the two lists differ, so a query left over from the other one
	 * is a filter whose cause is off screen. Between Context and Deck it was the same list
	 * either way, which is why the strip went.
	 */
	const goTab = (next: PanelTab) => {
		if (next === tab()) return;
		setTab(next);
		setQuery("");
	};

	/**
	 * The workspaces in use, for the popup's suggestions.
	 *
	 * Read off the identities the panel is already holding rather than asked for: a workspace is
	 * only a word somebody is using, so the set of them *is* this list, and a fetch for it would
	 * be a second source of truth free to disagree.
	 */
	/** The section a dragged agent is over, by its id, so the heading it would land under says so. */
	const [over, setOver] = createSignal<string | undefined>(undefined);
	/*
	 * However a drag ends — dropped here, dropped elsewhere, or abandoned with Escape — no
	 * heading is under it any more. On the window because `dragend` fires on the row that was
	 * picked up, which is not the section that marked itself.
	 */
	onMount(() => {
		const done = () => setOver(undefined);
		window.addEventListener("dragend", done);
		window.addEventListener("drop", done);
		onCleanup(() => {
			window.removeEventListener("dragend", done);
			window.removeEventListener("drop", done);
		});
	});

	const workspaceNames = createMemo(() => {
		const names = new Set<string>();
		for (const identity of Object.values(props.identities ?? {})) if (identity.workspace) names.add(identity.workspace);
		return [...names].sort();
	});

	/** Everything the list is derived from. One function, so the store below cannot be given a
	 *  different question from the one the foot counts. */
	const agentInput = () => ({
		chats: props.chats ?? [],
		identities: props.identities ?? {},
		unread: props.unread ?? {},
		focused: props.focused,
		query: query(),
	});

	/**
	 * The Agents tab's list, held in a store so that a state change *updates* a row instead of
	 * re-drawing the list.
	 *
	 * This is the whole of the fix for a list that flickered while an agent worked.
	 * `agentSections` builds fresh objects on every call and `<For>` keys by reference, so
	 * deriving straight into the markup meant that *any* change at all — one agent moving from
	 * `streaming` to `tool`, a tag arriving, a workspace being declared somewhere else — made
	 * every section and every row a new object, and `For` had no choice but to throw the DOM away
	 * and draw it again. Fourteen rows, their avatars, the pulse on a working face and any popup
	 * somebody had open: gone and back, several times a minute, for as long as an agent was
	 * running. `e2e/checks/panel-steady.mjs` is that, measured.
	 *
	 * `reconcile` is the other half. Given the list it drew last time and the list it has now, it
	 * keeps the object it already had wherever it can and writes only the fields that moved,
	 * joining old to new by `id` at every level. That is what `AgentSection.id` and `AgentRow.id`
	 * are for, and why neither is optional. The store hands back the same proxy for the same
	 * object, so `For` recognises the rows it already drew: it moves the ones that reordered, and
	 * re-creates only the ones that are genuinely new. What a state change is left with is a word
	 * and a colour on the row it was about.
	 *
	 * An **effect** rather than a memo, because `reconcile` is a setter and there has to be a
	 * store for it to write into. It runs in the same task as the update that caused it, before
	 * anything is painted, so the list is never a frame behind what the socket said.
	 */
	const [agentList, setAgentList] = createStore<AgentSection[]>(agentSections(agentInput()));
	createEffect(() => setAgentList(reconcile(agentSections(agentInput()))));
	const [recentList, setRecentList] = createStore<AgentListRow[]>(recentAgents(agentInput()));
	createEffect(() => setRecentList(reconcile(recentAgents(agentInput()), { key: "id" })));
	/* The Canvas tab's rows: the drawing on screen, as Studio's editor lists its layers. */
	// Listed without laying the drawing out (it ran on every change, whichever tab showed); the one picked is read again with its box, to fly to it.
	const items = createMemo(() => canvasItems(props.canvasDoc, query(), { boxes: false }));
	const selectedItems = createMemo(() => new Set(props.selectedItems ?? []));
	/** The head's second line: what the tab holds. */
	const headWords = () => {
		const t = tab();
		if (t === "canvas") return `${items().items.length} item${items().items.length === 1 ? "" : "s"}`;
		if (t === "apps") return props.apps === undefined ? "apps" : `${props.apps.length} app${props.apps.length === 1 ? "" : "s"}`;
		const n = agentCount();
		return `${n} agent${n === 1 ? "" : "s"}`;
	};

	/* Every name on the deck but the agent's own: what the edit window checks a new name against
	   before the server does, so the refusal is a red line under the field rather than a notice. */
	const nameTaken = (name: string, self: string) => {
		const wanted = name.trim().toLowerCase();
		return (props.chats ?? []).some((chat) => chat.id !== self && (props.identities?.[chat.id]?.name ?? chat.name).trim().toLowerCase() === wanted);
	};

	/** Every agent, unfiltered — what the placeholder and the empty state count. */
	const agentCount = () => props.chats?.length ?? 0;

	let list: HTMLDivElement | undefined;
	let field: HTMLInputElement | undefined;
	let nav: HTMLDivElement | undefined;
	let navMark: HTMLSpanElement | undefined;
	/* The tab marker slides under the tab that is showing, rather than each tab painting its own wash. */
	const placeNavMark = () => {
		const on = nav?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
		if (!on || !navMark) return;
		navMark.style.width = `${on.offsetWidth}px`;
		navMark.style.transform = `translateX(${on.offsetLeft}px)`;
	};
	createEffect(() => {
		tab();
		props.open;
		requestAnimationFrame(placeNavMark);
	});
	/* And again whenever the strip changes width: a narrower panel drops the tabs' icons (`styles/v3.css`). */
	onMount(() => {
		if (!nav || typeof ResizeObserver === "undefined") return;
		const watch = new ResizeObserver(() => placeNavMark());
		watch.observe(nav);
		onCleanup(() => watch.disconnect());
	});

	/* `⌘K` used to open a tab as well as take the cursor. There is one list now, so finding
	   a board is typing at it — and the query it lands on is whatever was already there. */
	createEffect(() => {
		if (!props.findAt) return;
		// Next frame, or there is nothing to focus yet on a panel that was closed.
		requestAnimationFrame(() => {
			field?.focus();
			field?.select();
		});
	});

	const type = (next: string) => setQuery(next);


	/*
	 * How many rows are drawn, across the sections in order.
	 *
	 * A row is about a millisecond — a title, a picture from the cache, an icon — and a deck has
	 * hundreds of things in it, boards and now conversations alike. Drawing every row the moment
	 * the deck arrived was 425 ms of the app's first second, all of it before the chat it opened
	 * on could be drawn. So the first screenful is drawn at once and the rest as the reader
	 * reaches for it — a chunk per approach to the bottom of the list.
	 *
	 * **Growth follows the scroll, not idle time.** It used to arrive sixty rows per idle moment,
	 * which was harmless while a row cap bounded the list and would now draw every conversation
	 * the deck has ever had, whether or not anybody looked. With nothing pruned
	 * (`agents/registry.ts`), "draw it later" is the whole of what keeps a long deck from
	 * spending its first second on rows below the fold.
	 *
	 * One budget for both tabs, because they share this scroller and only one is ever showing.
	 * The counts in the section headers are the whole list's all along; only rows below the fold
	 * are late.
	 */
	const FIRST_ROWS = 40;
	const MORE_ROWS = 60;
	/** How close to the bottom, in pixels, before the next chunk is drawn. */
	const LOAD_MORE_AT = 400;
	const [rowBudget, setRowBudget] = createSignal(FIRST_ROWS);
	/**
	 * Whether the list has rows at all: while the panel is open, and for its slide out after.
	 *
	 * A closed panel is still in the document, slid off the edge and transparent (`panel.css`), and
	 * every row in it held the server's picture of its board: 720 by 540 pixels decoded, 1.5MB, for a
	 * box of 20 by 14. Measured on an iPhone, the closed panel was painting 214 of them while the canvas
	 * was panned — about 330MB of pictures nobody could see, the largest thing in a tab that iOS kept
	 * killing. So a closed panel lets its rows go, and their pictures with them; they come back the
	 * moment it opens.
	 */
	const [listed, setListed] = createSignal(props.open);
	createEffect(() => {
		if (props.open) {
			setListed(true);
			return;
		}
		const timer = setTimeout(() => setListed(false), 260);
		onCleanup(() => clearTimeout(timer));
	});
	/** The sections of the list that is showing — boards, or agents. */
	const groups = (): Array<{ rows: unknown[] }> => (tab() === "agents" ? agentList : tab() === "recent" ? [{ rows: recentList }] : []);
	const visibleRows = () => groups().reduce((sum, section) => sum + section.rows.length, 0);
	/** How many of the section at `index`'s rows fit in what the sections above it left. */
	const allowance = (index: number): number => {
		if (!listed()) return 0;
		const all = groups();
		let before = 0;
		for (let i = 0; i < index; i += 1) before += all[i]?.rows.length ?? 0;
		return Math.max(0, rowBudget() - before);
	};
	/** Draw another chunk, whatever the scroll position — the keyboard's half of the same thing. */
	const grow = () => {
		if (rowBudget() >= visibleRows()) return;
		setRowBudget((n) => n + MORE_ROWS);
	};
	/**
	 * One chunk closer to the end, when the reader is nearly there.
	 *
	 * `listMayGrow` is the app saying its first paint is done; before that the budget stays at
	 * one screenful, so opening a large deck cannot spend its first second on rows nobody has
	 * scrolled to. A list shorter than its viewport produces no scroll event and needs none —
	 * there is nothing below the fold to draw.
	 */
	const growIfNearEnd = () => {
		if (!(props.listMayGrow ?? true) || !list) return;
		if (list.scrollHeight - list.scrollTop - list.clientHeight < LOAD_MORE_AT) grow();
	};

	/*
	 * `⌘\`, and the one guard it needs.
	 *
	 * Registered on the document rather than the panel, because the point of it is to work
	 * from the canvas — and it fires whether the panel is open or shut, which is the half a
	 * shortcut usually forgets. Not while a text field has focus: the dock's composer is a
	 * textarea that people type into for whole paragraphs, and a chord that folds the chrome
	 * on the way past a backslash is a chord that fires on a typo. `Escape` leaves this
	 * panel's own search field, which is how you get the shortcut back without a mouse.
	 */
	onMount(() => {
		const keys = (event: KeyboardEvent) => {
			if (event.key !== "\\" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
			if (typing()) return;
			event.preventDefault();
			props.onOpenChange(!props.open);
		};
		document.addEventListener("keydown", keys);
		onCleanup(() => document.removeEventListener("keydown", keys));
	});

	/** The rows, in document order, for the arrow keys to walk. */
	const rows = () => [...(list?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
	const focusRow = (index: number) => {
		const all = rows();
		if (all.length === 0) return;
		all[Math.min(Math.max(0, index), all.length - 1)]?.focus();
	};

	/*
	 * Up and down walk the rows; Enter is the button's own, so nothing here has to fake it.
	 * A list you can only reach with Tab is a list of seventy-eight tab stops.
	 *
	 * Down off the last *drawn* row draws another chunk and steps onto it. The last row on
	 * screen is the end of the budget rather than the end of the list, and an arrows-only
	 * reader who stops there would be told the list ended by a list that had not.
	 */
	const rove = (event: KeyboardEvent) => {
		const all = rows();
		if (all.length === 0) return;
		const here = all.indexOf(document.activeElement as HTMLElement);
		if (event.key === "ArrowDown") {
			if (here >= all.length - 1 && rowBudget() < visibleRows()) {
				grow();
				requestAnimationFrame(() => focusRow(here + 1));
			} else focusRow(here + 1);
		} else if (event.key === "ArrowUp") {
			if (here === 0) field?.focus();
			else focusRow(here - 1);
		} else if (event.key === "Home") focusRow(0);
		else if (event.key === "End") focusRow(all.length - 1);
		else return;
		event.preventDefault();
	};

	/** What both agent lists need from the panel. */
	const lists = (): Lists => ({
		identities: props.identities,
		workspaces: workspaceNames(),
		lines: lines(),
		count: agentCount(),
		query: query(),
		taken: nameTaken,
		hover: (id, at) => setHovered((was) => (at ? { id, at: besideRow(at, list?.closest(".panel-shell") ?? null) } : was?.id === id ? undefined : was)),
		...(props.onFocusAgent ? { onFocusAgent: props.onFocusAgent } : {}),
		...(props.onCloseAgent ? { onCloseAgent: props.onCloseAgent } : {}),
		...(props.onNewAgent ? { onNewAgent: props.onNewAgent } : {}),
		...(props.onAgentTags ? { onAgentTags: props.onAgentTags } : {}),
		...(props.onAgentWorkspace ? { onAgentWorkspace: props.onAgentWorkspace } : {}),
		...(props.onAgentRename ? { onAgentRename: props.onAgentRename } : {}),
		...(props.onAbortAgent ? { onAbortAgent: props.onAbortAgent } : {}),
	});

	return (
		<>
			<aside
				/*
				 * `data-inset` only while it is open: the attribute is the only thing telling the
				 * camera whether there is a panel to subtract — and a closed panel still has a
				 * box, because it is slid out rather than removed. See `camera/insets.ts`.
				 */
				data-inset={props.open ? "left" : undefined}
				data-open={props.open ? "true" : "false"}
				aria-hidden={!props.open}
				aria-label="Side panel"
				/*
				 * A stationary column, not a card: it runs the full height of the window at the
				 * left edge, with the deck mark on top, and never moves while the middle slides.
				 */
				style={{ width: `${width()}px` }}
				data-resizing={resizing() ? "true" : undefined}
				data-desktop={props.desktop ? "true" : undefined}
				class="panel-shell v3-panel fixed z-10 top-0 bottom-0 left-0 flex max-w-[86vw] flex-col"
			>
				{/* The right edge, as something to take hold of. A separator in the ARIA
				    sense: focusable, arrow keys move it, Home puts the default back, and so
				    does a double-click. */}
				<div
					class="panel-resize"
					role="separator"
					aria-orientation="vertical"
					aria-label="Sidebar width"
					aria-valuemin={PANEL_MIN}
					aria-valuemax={PANEL_MAX}
					aria-valuenow={width()}
					tabindex={props.open ? 0 : -1}
					title="Drag to resize. Double-click to reset."
					onPointerDown={onHandleDown}
					onKeyDown={onHandleKey}
					onDblClick={reset}
				/>
				{/*
					The deck's mark, where a title bar would have put it, and now the switcher too: it names
					the backend this tab is on and opens the others (`connections/Switcher.tsx`).
				*/}
				{/*
					The head: the deck's mark and name (the switcher, `connections/Switcher.tsx`), and the
					button that folds the panel away. Folded, the top bar carries both (`shell/TopBar.tsx`).
				*/}
				<Show
					when={props.desktop}
					fallback={
						<div class="v3-panel-head">
							<div class="panel-mark">
								<Switcher />
							</div>
							<span class="flex-1" />
							<button type="button" class="v3-icon" data-tip="Hide the side panel" data-key="⌘\" aria-label="Hide the side panel" onClick={() => props.onOpenChange(false)}>
								<Icon of={PanelLeftClose} size={17} />
							</button>
						</div>
					}
				>
					{/* Studio's panel head: the canvas, which opens the canvas manager, and under it the deck (its switcher) and what the tab holds. */}
					<div class="v3-lp-head">
						<span class="v3-lp-mark" aria-hidden="true">
							<DecksLineMark size={17} />
						</span>
						<div class="v3-lp-text">
							{(() => {
								const title = (popover?: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => (
									<button
										type="button"
										class="v3-lp-title"
										ref={popover?.ref}
										data-tip="Canvases"
										aria-haspopup="menu"
										aria-expanded={popover?.open ?? false}
										data-open={popover?.open ? "true" : undefined}
										disabled={!props.canvasMenu && !props.onCanvases}
										onClick={() => (popover ? popover.toggle() : props.onCanvases?.())}
									>
										<span class="truncate">{props.canvasTitle ?? "No canvas"}</span>
										<Icon of={ChevronDown} size={13} class="flex-none" />
									</button>
								);
								/*
								 * The canvas switcher where it is given; the canvas manager straight away otherwise.
								 * Only whether it is given rebuilds the title, as in the top bar's canvas chip:
								 * `canvasMenu` is a fresh function on every change to the canvas list.
								 */
								return (
									<Show when={props.canvasMenu !== undefined} fallback={title()}>
										{untrack(() => props.canvasMenu!((popover) => title(popover)))}
									</Show>
								);
							})()}
							<div class="v3-lp-status">
								<span class="v3-lp-deck">
									<Switcher />
								</span>
								<span class="truncate">{headWords()}</span>
							</div>
						</div>
						<div class="v3-lp-buttons">
							<Show when={props.onSettings}>
								<button type="button" class="v3-lp-icon" data-tip="Settings" aria-label="Settings" onClick={() => props.onSettings?.()}>
									<Icon of={SettingsIcon} size={16} />
								</button>
							</Show>
							<button type="button" class="v3-lp-icon" data-tip="Hide the side panel" data-key="⌘\" aria-label="Hide the side panel" onClick={() => props.onOpenChange(false)}>
								<Icon of={PanelLeftClose} size={16} />
							</button>
						</div>
					</div>
				</Show>
				{/* No agents behind a canvas opened from a file, so no Agents tab either. */}
				<div class="v3-nav" role="tablist" aria-label="Panel" ref={nav}>
					<span class="v3-nav-mark" ref={navMark} aria-hidden="true" />
					<For each={PANEL_TABS.filter((name) => (name !== "agents" && name !== "recent") || (props.chats && can("agents")))}>
						{(name) => (
							<button
								type="button"
								role="tab"
								id={`${ids}-tab-${name}`}
								aria-selected={tab() === name}
								aria-controls={`${ids}-list`}
								tabindex={tab() === name ? 0 : -1}
								data-on={tab() === name ? "true" : undefined}
								class="v3-nav-tab"
								onClick={() => goTab(name)}
								onKeyDown={(event) => {
									if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
									event.preventDefault();
									const step = event.key === "ArrowRight" ? 1 : -1;
									const next = tabBeside(name, step);
									goTab(next);
									document.getElementById(`${ids}-tab-${next}`)?.focus();
								}}
							>
								<Icon of={PANEL_TAB_ICON[name]} size={16} />
								{PANEL_TAB_LABEL[name]}
							</button>
						)}
					</For>
				</div>
				<div class="v3-search-wrap">
					<label class="v3-search">
						<Icon of={Search} class="flex-none" size={14} />
						<input
							ref={field}
							type="text"
							spellcheck={false}
							placeholder={tab() === "agents" || tab() === "recent" ? "Search agents and tags" : tab() === "apps" ? "Search apps" : `Search ${props.canvasTitle ?? "this canvas"}`}
							value={query()}
							onInput={(event) => type(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									if (query()) type("");
									else event.currentTarget.blur();
								}
								if (event.key === "ArrowDown") {
									event.preventDefault();
									focusRow(0);
								}
								if (event.key === "Enter") {
									const only = rows();
									if (only.length === 1) only[0]?.click();
								}
							}}
						/>
						<Show when={query()} fallback={<kbd class="v3-kbd">⌘K</kbd>}>
							<button
								type="button"
								class="v3-icon v3-search-clear"
								aria-label="Clear the search"
								onClick={() => {
									type("");
									field?.focus();
								}}
							>
								<Icon of={X} size={12} />
							</button>
						</Show>
					</label>
				</div>

				<div
					ref={list}
					id={`${ids}-list`}
					/*
					 */
					class="panel-list"
					/*
					 * Which list this is, for the stylesheet and for a check.
					 *
					 * The two lists share every class they can (`panel-list`, `panel-section`, `panel-meta`)
					 * because they are one surface with two contents. They do not share what their rows repeat
					 * down the right edge: a dot in the boards list, a timestamp in the agents one — and the
					 * count in the heading has to end on *that* line, so the two inset it differently. Same
					 * argument as `data-kind` on a section: name the thing rather than infer it from content.
					 */
					data-tab={tab()}
					onKeyDown={rove}
					onScroll={growIfNearEnd}
				>
					<Show when={tab() === "agents"}>
						<AgentsTab sections={agentList} l={lists()} f={{ folded, toggle: toggleFolder, over, setOver, allowance }} />
					</Show>
					<Show when={tab() === "recent"}>
						<RecentTab rows={recentList} l={lists()} />
					</Show>
					<Show when={tab() === "canvas"}>
						<CanvasTab items={items()} selected={selectedItems()} current={props.current} query={query()} onPick={(item) => props.onPickItem?.(canvasItems(props.canvasDoc, query()).items.find((one) => one.id === item.id) ?? item)} onPickArrows={(ids) => props.onPickArrows?.(ids)} />
					</Show>
					<Show when={tab() === "apps"}>
						<AppsTab apps={apps()} known={props.apps} query={query()} {...(props.onApp ? { onApp: props.onApp } : {})} {...(props.onAppLogs ? { onAppLogs: props.onAppLogs } : {})} />
					</Show>
				</div>

				{props.chat}

				{/* In the one-line view the row says who and what it is doing; the card says the rest. */}
				<Show when={card()}>
					{(over) => (
						<AgentHoverCard
							chat={over().chat}
							identity={props.identities?.[over().chat.id]}
							unread={props.unread?.[over().chat.id] ?? 0}
							anchor={over().at}
							beside
							shown={cardShown()}
						/>
					)}
				</Show>
			</aside>
		</>
	);
}


/** Is a text field taking keys right now? Then this component's chord is not for it. */
function typing(): boolean {
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return false;
	return active.isContentEditable || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
}
