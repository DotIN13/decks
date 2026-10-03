import { Switcher } from "../connections/Switcher.tsx";
import { can } from "../connections/backend.ts";
import type { Board, DeckPen } from "@decks/protocol";
import Rows2 from "lucide-solid/icons/rows-2";
import Rows3 from "lucide-solid/icons/rows-3";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { createEffect, createMemo, createSignal, createUniqueId, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { Icon } from "../ui/icons.tsx";
import { BoardRow } from "./BoardRow.tsx";
import { basename as basenameOf, panelSections } from "./panel-groups.ts";
import { clampPanelWidth, loadPanelWidth, PANEL_MAX, PANEL_MIN, PANEL_WIDTH, savePanelWidth } from "./panel-width.ts";
import type { AgentChat, Identity } from "@decks/protocol";
import { AgentHoverCard } from "../agents/AgentHoverCard.tsx";
import { AgentRow } from "../agents/AgentRow.tsx";
import { NewAgentButton } from "../agents/AgentPill.tsx";
import type { AgentKind } from "@decks/protocol";
import { agentSections, type AgentSection } from "../agents/agent-sections.ts";
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
 * ### Beside the canvas, or over it
 *
 * Under 1100px the panel is a **sheet** over the canvas rather than a panel beside it, and a
 * sheet must not carry `data-inset` — subtracting one fitted a 1600px board into the strip
 * beside it at 3.7%. That is why the breakpoint is a signal read from `matchMedia` rather
 * than a `@media` block: it changes which *attribute* is rendered, not only how the thing
 * looks, and CSS cannot tell the camera anything.
 *
 * The sheet starts under the pill instead of at the top of the window, so the button that
 * opened it is still there to close it. A sheet that covers its own dismiss control is a
 * trap, and on a 390px phone it would cover it by 250px.
 *
 * ### Presentational
 *
 * No socket, no app state: boards in, `onPick` out. The panel is a picture of what it is
 * given, and everything with a rule behind it — which board is in which section, what the
 * search matches — is in `panel-groups.ts`, where it can be tested without a DOM.
 */

/**
 * Which list the panel is showing.
 *
 * Two genuinely different collections, which is what makes a strip defensible here — see the
 * note on the `chats` prop.
 */
export type PanelTab = "agents" | "boards";

/** The strip's order: who is working, then what is on the stage. The panel still opens on Boards. */
const PANEL_TABS: PanelTab[] = ["agents", "boards"];
const PANEL_TAB_LABEL: Record<PanelTab, string> = { agents: "Agents", boards: "Boards" };

/** Below this the panel cannot stand beside the canvas, so it goes over it. */
const SHEET = 1100;

export function LeftPanel(props: {
	/** A tab asked for from outside — the agent menu's overflow row opens Agents. A new `at` is a new ask. */
	ask?: { tab: PanelTab; at: number };
	/** Every board there is. The list is all of them, in three sections. */
	boards: Board[];
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
	onPick: (board: Board) => void;
	/**
	 * Delete a board's file. Absent means no row has a delete on it.
	 *
	 * Every row has it, in all three sections: a board is a board wherever it is listed, and
	 * a rule that depends on which heading it is under is a rule to remember. The row does
	 * the asking — two presses, `BoardRow.tsx` — so by the time this is called it has been
	 * said twice.
	 */
	onDelete?: (board: Board) => void;
	/** Take a board off the canvas, keeping the file. */
	onHide?: (board: Board) => void;
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
	/** Boards that are news, each in its writer's colour: the dot at the end of the row (`BoardRow`). */
	news?: Record<string, string>;
	onFocusAgent?: (id: string) => void;
	/** Make an agent in a workspace (`undefined` for none) — the `+` on a heading of the workspace cut. */
	onNewAgent?: (workspace: string | undefined, kind: AgentKind) => void;

	onCloseAgent?: (id: string) => void;
	/** Put a live view of that agent's conversation on the canvas (`board/live-chat.ts`). */
	onMirrorAgent?: (id: string) => void;
	/** Replace *your* tags on an agent. Absent means no row can be customised. */
	onAgentTags?: (id: string, tags: string[]) => void;
	/** Move an agent into a workspace, or out of one with `null`. */
	onAgentWorkspace?: (id: string, workspace: string | null) => void;
	/** Rename an agent, from the edit window its row opens. */
	onAgentRename?: (id: string, name: string) => void;
}) {
	const ids = createUniqueId();
	/*
	 * One line or two per agent. Remembered: it is how this person likes the
	 * list, not a question about it. Two is what it opens on, because the second line is the
	 * one fact worth reading at a glance: what each agent is doing.
	 */
	const [lines, setLines] = createSignal<1 | 2>(readLines());
	const goLines = (next: 1 | 2) => {
		setLines(next);
		try {
			localStorage.setItem(LINES_KEY, String(next));
		} catch {
			// A private window with storage off keeps the choice for the session.
		}
	};
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
	const cardShown = () => tab() === "agents" && lines() === 1 && hovered() !== undefined;
	/* Beside the panel and level with the row: the row's height, the panel's sides, so the card clears the panel's edge. */
	const besideRow = (row: DOMRect, element: Element | null) => {
		const side = element?.getBoundingClientRect() ?? row;
		return { left: side.left, right: side.right, width: side.width, top: row.top, bottom: row.bottom, height: row.height };
	};
	const [query, setQuery] = createSignal("");
	const [tab, setTab] = createSignal<PanelTab>("boards");
	createEffect(() => {
		const ask = props.ask;
		if (ask) setTab(ask.tab);
	});
	const sheet = createSheet();

	/*
	 * A sheet over the canvas closes with a tap on the canvas beside it, as a phone's drawer does.
	 * The tap only closes: taken in the capture phase before the stage sees it, so it does not
	 * also select a board or start a pan under a panel that is going away.
	 */
	createEffect(() => {
		if (!props.open || !sheet()) return;
		const away = (event: PointerEvent) => {
			const target = event.target as Element | null;
			if (!target?.closest?.(".stage") || target.closest('aside[aria-label="Boards"]')) return;
			event.stopPropagation();
			event.preventDefault();
			props.onOpenChange(false);
		};
		window.addEventListener("pointerdown", away, true);
		onCleanup(() => window.removeEventListener("pointerdown", away, true));
	});

	/*
	 * The width is the person's to set, by the handle on the panel's right edge. Only beside
	 * the canvas: a sheet covers the screen on a phone and keeps the width it always had.
	 * Nothing else is told, because everything beside the panel reads `--inset-left`, which
	 * is measured from this box (`camera/insets.ts`).
	 */
	const [width, setWidth] = createSignal(clampPanelWidth(loadPanelWidth(), window.innerWidth));
	const [resizing, setResizing] = createSignal(false);
	const resizeTo = (next: number) => setWidth(clampPanelWidth(next, window.innerWidth));
	onMount(() => {
		// A window made narrower takes the panel down with it; the saved width is kept.
		const onResize = () => setWidth(clampPanelWidth(loadPanelWidth(), window.innerWidth));
		window.addEventListener("resize", onResize);
		onCleanup(() => window.removeEventListener("resize", onResize));
	});
	const onHandleDown = (event: PointerEvent) => {
		if (event.button !== 0) return;
		const handle = event.currentTarget as HTMLElement;
		const from = width();
		const start = event.clientX;
		event.preventDefault();
		handle.setPointerCapture(event.pointerId);
		setResizing(true);
		// The composer and the pill glide when the sidebar folds; following a drag, a glide
		// is a lag. Said on the root so their own stylesheets can answer it.
		document.documentElement.dataset.panelResizing = "true";
		const move = (moved: PointerEvent) => resizeTo(from + moved.clientX - start);
		const end = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", end);
			handle.removeEventListener("pointercancel", end);
			setResizing(false);
			delete document.documentElement.dataset.panelResizing;
			savePanelWidth(width());
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", end);
		handle.addEventListener("pointercancel", end);
	};
	const onHandleKey = (event: KeyboardEvent) => {
		const step = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
		if (event.key === "Home") resizeTo(PANEL_WIDTH);
		else if (step !== 0) resizeTo(width() + step);
		else return;
		event.preventDefault();
		savePanelWidth(width());
	};

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

	const sections = createMemo(() =>
		panelSections({
			boards: props.boards,
			kept: props.kept,
			inPlay: props.inPlay,
			query: query(),
			pens: props.pens ?? [],
		}),
	);

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
	const groups = (): Array<{ rows: unknown[] }> => (tab() === "agents" ? agentList : sections());
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

	return (
		<>
			<aside
				/*
				 * `data-inset` on the panel and *not* on the sheet — the one attribute in this
				 * component that changes what the camera believes. See `camera/insets.ts`.
				 */
				/*
				 * `data-inset` only while it is open *and* beside the canvas.
				 *
				 * The element is in the document either way now, so the attribute is the only
				 * thing telling the camera whether there is a panel to subtract — and a closed
				 * panel still has a box, because it is slid out rather than removed. A sheet
				 * never declares one: subtracting one fitted a 1600px board into the strip
				 * beside it at 3.7%.
				 */
				data-inset={props.open && !sheet() ? "left" : undefined}
				data-open={props.open ? "true" : "false"}
				aria-hidden={!props.open}
				data-sheet={sheet() ? "true" : undefined}
				aria-label="Boards"
				/*
				 * A stationary column, not a card. Beside the canvas it runs the full height of
				 * the window at the left edge, with the deck mark on top, and never moves while
				 * the middle slides. A sheet keeps the geometry it had: it covers the canvas on a
				 * phone and starts under the pill, 8px clear of it.
				 */
				style={sheet() ? undefined : { width: `${width()}px` }}
				data-resizing={resizing() ? "true" : undefined}
				class={`float panel-shell fixed flex w-[264px] max-w-[86vw] flex-col p-2 ${
					sheet()
						? /* Over the composer (10) on a phone, under the toolbars (20): the two used to
						     share 10, and the bar, later in the document, drew across the sheet's foot. */
							"z-[12] top-[calc(max(12px,env(safe-area-inset-top))_+_60px)] bottom-0 left-0"
						: "z-10 top-0 bottom-0 left-0 rounded-none border-y-0 border-l-0"
				}`}
			>
				<Show when={!sheet()}>
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
						onDblClick={() => {
							resizeTo(PANEL_WIDTH);
							savePanelWidth(width());
						}}
					/>
				</Show>
				{/*
					The deck's mark, where a title bar would have put it, and now the switcher too: it names
					the backend this tab is on and opens the others (`connections/Switcher.tsx`). On a phone
					as well, since it is the only way to another server there.
				*/}
				<div class="panel-mark">
					<Switcher />
				</div>
				{/*
					The header: which list, then a field over it.

					**Both controls are 32px**, which is `--control-md` — the height a labelled chip
					in the dock already is, so the panel's header matches the chrome across the top
					of the app instead of sitting 4px shorter than everything in it. It was 28px
					(`--field`), a value chosen for a box *inside a row*; asked twice whether that
					read short, the answer was twice yes.

					A strip is back, and `PanelTab` says why it is not the one that went: these are
					two collections rather than one with a line through it.

					On a coarse pointer both stay at 40px, which the field already had and which is
					under the 44px the panel uses for anything pressed.
				*/}
				<div class="flex flex-none flex-col gap-2 pb-3">
					{/* No agents behind a canvas opened from a file, so no Agents tab either. */}
					<Show when={props.chats && can("agents")}>
						{/*
							The app's `.segmented`, at `h-8` — 28px buttons inside 2px of padding is a 32px
							strip, matching the field below it. The removed Context/Deck strip was the
							same object at `h-6`.
						*/}
						<div class="segmented w-full" role="tablist" aria-label="Panel">
							{/*
								**Agents first, then Boards.**

								The order is the panel's own reading order rather than a claim about
								which list matters more: the agents are the thing that *changes* while
								you watch, and a list you check on is read before a list you browse.
								The panel still opens on Boards, because that is the canvas you were
								already looking at.
							*/}
							<For each={PANEL_TABS}>
								{(name) => (
									<button
										type="button"
										role="tab"
										id={`${ids}-tab-${name}`}
										aria-selected={tab() === name}
										aria-controls={`${ids}-list`}
										/* One tab stop for the strip, arrows within it — the ARIA tabs pattern,
										   which is what keeps the panel three stops rather than five. */
										tabindex={tab() === name ? 0 : -1}
										data-on={tab() === name}
										class="h-7 text-label pointer-coarse:h-9"
										onClick={() => goTab(name)}
										onKeyDown={(event) => {
											if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
											event.preventDefault();
											/* Left and right are the strip's order, which is this array's:
											   `agents` then `boards` — so the other one is named here rather
											   than derived, and these two lines are what a third tab would
											   have to change. */
											const step = event.key === "ArrowRight" ? 1 : -1;
											const next = PANEL_TABS[(PANEL_TABS.indexOf(name) + step + PANEL_TABS.length) % PANEL_TABS.length] ?? name;
											goTab(next);
											document.getElementById(`${ids}-tab-${next}`)?.focus();
										}}
									>
										{PANEL_TAB_LABEL[name]}
									</button>
								)}
							</For>
						</div>
					</Show>
					{/*
						`.field` is 24px by default; the header's rhythm wants 32, and a utility beats
						the layer it is defined in — which is the whole reason that layer exists.

						`flex-none` is load-bearing, not tidying. `.field` carries `flex: 1` for the
						inspector's row of four, where it grows sideways; in a *column* that grow is
						vertical, and a `flex-basis: 0` beats a stated height — so the field measured
						its input's min-content and came out 19px instead of 32.
					*/}
					<div class="flex flex-none gap-1.5">
					<label class="field h-8 min-w-0 flex-1 gap-1.5 rounded-lg pointer-coarse:h-10 pointer-coarse:gap-2 pointer-coarse:px-2.5">
						<Icon of={Search} class="flex-none text-faint" size={13} />
						{/*
							16px on a touch keyboard, like the composer's field and for the same reason:
							below 16 the browser zooms the page when the input takes focus, which leaves
							the canvas at a scale nobody chose and the chrome half off screen. It is the
							one number in this component that is not about how it looks.
						*/}
						<input
							ref={field}
							type="text"
							spellcheck={false}
							class="min-w-0 flex-1 border-0 bg-none text-ui text-fg outline-none placeholder:text-faint pointer-coarse:text-[16px]"
							/* Says what it will match, which for agents includes the tags — “who else is
							   on panel-css” is the question tags exist to answer, and this is the surface
							   with room to show the answer. */
							placeholder={
								tab() === "agents"
									? `Search ${agentCount()} agent${agentCount() === 1 ? "" : "s"}`
									: `Search ${props.boards.length} board${props.boards.length === 1 ? "" : "s"}`
							}
							value={query()}
							onInput={(event) => type(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									// Clear first, leave second: two presses, and the second is what
									// hands `⌘\` and the canvas's own keys back.
									event.preventDefault();
									if (query()) type("");
									else event.currentTarget.blur();
								}
								if (event.key === "ArrowDown") {
									event.preventDefault();
									focusRow(0);
								}
								// The commonest search is two letters from one answer.
								if (event.key === "Enter") {
									const only = rows();
									if (only.length === 1) only[0]?.click();
								}
							}}
						/>
						<Show when={query()}>
							{/* `.icon-button` is 28px, and 44px on a coarse pointer, which would burst a
							    24px field — so this one is sized by a utility instead. */}
							<button
								type="button"
								class="icon-button size-5 flex-none rounded-sm pointer-coarse:size-8"
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
					{/*
						One control beside the search, on Agents only: one line or two per agent. The
						boards list is one way, a line per board with no picture, so it has nothing to
						switch. `data-view` is what is showing now, for a check.
					*/}
					<Show when={tab() === "agents"}>
						<button
							type="button"
							class="icon-button panel-view size-8 flex-none rounded-lg pointer-coarse:size-10"
							data-view={`lines-${lines()}`}
							aria-label={lines() === 2 ? "One line per agent" : "Two lines per agent"}
							title={lines() === 2 ? "One line per agent" : "Two lines per agent"}
							onClick={() => goLines(lines() === 2 ? 1 : 2)}
						>
							<Icon of={lines() === 2 ? Rows3 : Rows2} size={13} />
						</button>
					</Show>
					</div>
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
						<For each={agentList}>
							{(section, index) => (
								<div
									class="panel-section"
									data-kind={section.kind}
									/*
									 * A heading is where an agent is dropped to change the project it says it is
									 * in (`agents/agent-drag.ts`). The whole section takes the drop, not the
									 * heading's own line: the target you aim at is the group of rows, and a 20px
									 * strip of text is a target you miss.
									 *
									 * `preventDefault` on `dragover` is what makes a drop possible at all, and
									 * saying it only for our own type is what keeps a file dragged in from
									 * landing here instead of on the canvas.
									 */
									data-drop={over() === section.id ? "true" : undefined}
									onDragOver={(event) => {
										if (!props.onAgentWorkspace || !carriesAgent(event.dataTransfer)) return;
										event.preventDefault();
										if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
										setOver(section.id);
									}}
									onDragLeave={(event) => {
										/*
										 * Only when the pointer left this section for somewhere we can name.
										 * Crossing a row inside it fires this too — hence the containment test —
										 * and a `dragleave` with no `relatedTarget` at all is the browser's way of
										 * saying "somewhere else", which during a drag over our own list is
										 * usually a frame boundary rather than a departure. Clearing on those left
										 * the heading unmarked while the hand held still over it. The end of the
										 * drag clears it whatever happens (below).
										 */
										const to = event.relatedTarget as Node | null;
										if (!to || event.currentTarget.contains(to)) return;
										setOver((was) => (was === section.id ? undefined : was));
									}}
									onDrop={(event) => {
										const id = draggedAgent(event.dataTransfer);
										setOver(undefined);
										if (!id) return;
										event.preventDefault();
										props.onAgentWorkspace?.(id, section.kind === "workspace" ? section.label : null);
									}}
								>
									<div class="panel-meta meta">
										<span class="truncate">{section.label}</span>
										<span class="flex-1" />
										{/*
											What the *group* is doing, where the group is a workspace.

											A section you are not in can be the one that needs you, and this is what says so
											without reading its rows — `1 wants you`, then `2 working`, then nothing. Written in
											the heading's right-hand column, inboard of the count, so the two are read together.
										*/}
										<Show when={section.note}>{(note) => <span class="note">{note()}</span>}</Show>
										{/*
											No count: the rows are right under it, and what the slot is for is a
											`+` — an agent made from under a project's heading is in that project, and one made
											under `No workspace` is in none.
										*/}
										<Show when={props.onNewAgent}>
											<NewAgentButton
												onNew={(kind) => props.onNewAgent?.(section.kind === "workspace" ? section.label : undefined, kind)}
												label={section.kind === "workspace" ? `Add an agent in ${section.label}` : "Add an agent in no workspace"}
												class="size-5 flex-none rounded-sm pointer-coarse:size-8"
												size={12}
											/>
										</Show>
									</div>
									{/*
										`.row-list` is the row vocabulary — the grid, the corner, the hover, the
										current wash, `.row-act` and its ×, and the `.row-label`/`.row-note` type scale. The
										agent row wants all of that and its own overrides (a 20px or 26px face column,
										by `data-lines`), which `.agent-list` in `panel.css` supplies.

										Re-implementing it instead is how two lists in one panel come to nearly
										match: the board rows above are the same object.
									*/}
									<div class="row-list agent-list" data-lines={lines()}>
									<For each={section.rows.slice(0, allowance(index()))}>
										{(row) => (
											<AgentRow
												row={row}
												identity={props.identities?.[row.chat.id]}
												onFocus={() => props.onFocusAgent?.(row.chat.id)}
												onClose={() => props.onCloseAgent?.(row.chat.id)}
												{...(props.onAgentTags ? { onTags: (tags: string[]) => props.onAgentTags?.(row.chat.id, tags) } : {})}
												workspaces={workspaceNames()}
												{...(props.onAgentWorkspace ? { onWorkspace: (workspace: string | null) => props.onAgentWorkspace?.(row.chat.id, workspace) } : {})}
												{...(props.onAgentRename ? { onRename: (name: string) => props.onAgentRename?.(row.chat.id, name) } : {})}
												taken={(name) => nameTaken(name, row.chat.id)}
												lines={lines()}
												onHover={(at) => setHovered((was) => (at ? { id: row.chat.id, at: besideRow(at, list?.closest(".panel-shell") ?? null) } : was?.id === row.chat.id ? undefined : was))}
												{...(props.onMirrorAgent ? { onMirror: () => props.onMirrorAgent?.(row.chat.id) } : {})}
											/>
										)}
									</For>
									</div>
								</div>
							)}
						</For>

						{/* The same shape of empty state the boards list has, and the same reasoning:
						    a panel that is blank for a good reason still looks broken without it. */}
						<Show when={agentList.length === 0}>
							<p class="m-0 px-1 py-2 text-ui leading-normal text-faint">
								{agentCount() === 0 ? "No agents yet. Start one with `+`." : `No agent matches “${query().trim()}”.`}
							</p>
						</Show>
					</Show>

					<Show when={tab() === "boards"}>
					<For each={sections()}>
							{(section, index) => (
								<div
									class="panel-section"
									/* So a stylesheet or a check can name *which* section without reading its
									   label — "is this the focused agent's own list, or somebody else's" is the
									   question the whole panel turns on. */
									data-kind={section.kind}
								>
									{/*
										The section label: a 20px line *inside* the list's rhythm, not a
										32px bar above it. Sentence case at 11.5px/500 — `.meta` in
										`styles/chrome.css` is that decision, made once.
									*/}
									{/* `.count` is the right-hand column the rows' dots and bins also stand in —
									    see `panel.css`. One column down the right edge, whatever is in it. */}
									<div class="panel-meta meta">
										<span class="truncate">{section.label}</span>
										<span class="flex-1" />
										<span class="count tabular-nums">{section.rows.length}</span>
									</div>
									<For each={section.rows.slice(0, allowance(index()))}>
										{(row) => (
											<Show
												when={row.pen}
												fallback={
													<BoardRow
														board={row.board}
														current={props.current === row.board.path}
														dim={row.dim}
														onCanvas={row.onCanvas}
														{...(props.news?.[row.board.path] ? { news: props.news[row.board.path] } : {})}
														{...(props.onDelete ? { onDelete: () => props.onDelete?.(row.board) } : {})}
														{...(props.onHide ? { onHide: () => props.onHide?.(row.board) } : {})}
														onPick={() => props.onPick(row.board)}
													/>
												}
											>
												{(pen) => (
													/* A .pen file among the boards: not a page, so a press places it on the stage as a ref. Named by its file, as a board's row is. */
													<div class="board-act">
														<button class="board-row" type="button" data-row data-pen={pen().path} title={`${pen().title}, ${pen().path}: place it on the stage`} onClick={() => props.onPlacePen?.(pen())}>
															<span class="board-thumb" aria-hidden="true" />
															<span class="row-name">{basenameOf(pen().path)}</span>
														</button>
													</div>
												)}
											</Show>
										)}
									</For>
								</div>
							)}
					</For>

					{/*
						An empty list is a real state and the commonest one on a fresh deck, so it
						says which empty it is. A panel that is blank for a good reason still looks
						broken if it does not give the reason.

						There is one of these now where there were two — a deck with no boards in it,
						and a search that matched none of them. The third case the tabs needed, "this
						agent holds nothing", is not an empty state at all any more: the list carries
						on into the deck below it.
					*/}
					<Show when={sections().length === 0}>
						<p class="m-0 px-1 py-2 text-ui leading-normal text-faint">
							{props.boards.length === 0
								? "This deck has no boards yet. Ask for one."
								: `Nothing in the deck matches “${query().trim()}”.`}
						</p>
					</Show>
					</Show>
				</div>

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

const LINES_KEY = "decks.agentLines";

/** The remembered line count for agent rows; two when nothing is stored. */
function readLines(): 1 | 2 {
	try {
		return localStorage.getItem(LINES_KEY) === "1" ? 1 : 2;
	} catch {
		return 2;
	}
}

/**
 * Whether the panel has to go over the canvas rather than beside it.
 *
 * A signal and not a media query, because what changes across this line is `data-inset` —
 * see the note at the top. `matchMedia` in a `try` for the same reason `lib/media.ts` does
 * it: a test environment without one should get the desktop answer, not an exception.
 */
function createSheet(): () => boolean {
	let query: MediaQueryList | undefined;
	try {
		query = window.matchMedia(`(max-width: ${SHEET}px)`);
	} catch {
		return () => false;
	}
	const [sheet, setSheet] = createSignal(query.matches);
	const sync = (event: MediaQueryListEvent) => setSheet(event.matches);
	query.addEventListener("change", sync);
	onCleanup(() => query?.removeEventListener("change", sync));
	return sheet;
}

/** Is a text field taking keys right now? Then this component's chord is not for it. */
function typing(): boolean {
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return false;
	return active.isContentEditable || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
}
