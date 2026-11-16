import { createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { insetsOnly } from "@decks/canvas/camera";
import { canvasItems } from "@decks/canvas/tools";
import { agentSections, recentAgents, type AgentRow as AgentListRow, type AgentSection } from "../agents/agent-sections.ts";
import type { AgentChat } from "../state/types/index.ts";
import type { SidePanelProps } from "./LeftPanel.tsx";
import type { Lists } from "./lists/view.tsx";
import { FOLDED_KEY, foldedOf, TAB_KEY, tabOf, toggled, type PanelTab } from "./model.ts";
import { clampPanelWidth, loadPanelWidth, PANEL_WIDTH, savePanelWidth } from "./panel-width.ts";

// The side panel's state and behaviour: its width and tab, kept in this browser; its two agent
// lists, the rows it draws, its tab strip and keys, all joined by createSidePanel.

export function createPanelWidth() {
	const [width, setWidth] = createSignal(clampPanelWidth(loadPanelWidth(), window.innerWidth));
	const [resizing, setResizing] = createSignal(false);
	const resizeTo = (next: number) => setWidth(clampPanelWidth(next, window.innerWidth));
	onMount(() => {
		const onResize = () => setWidth(clampPanelWidth(loadPanelWidth(), window.innerWidth));
		window.addEventListener("resize", onResize);
		onCleanup(() => window.removeEventListener("resize", onResize));
	});
	const onHandleDown = (event: PointerEvent) => event.button === 0 && dragEdge(event, width, resizeTo, setResizing);
	const onHandleKey = (event: KeyboardEvent) => {
		const step = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
		if (event.key === "Home") resizeTo(PANEL_WIDTH);
		else if (step !== 0) resizeTo(width() + step);
		else return;
		event.preventDefault();
		savePanelWidth(width());
	};
	const reset = () => (resizeTo(PANEL_WIDTH), savePanelWidth(width()));
	return { width, resizing, onHandleDown, onHandleKey, reset };
}

/** One drag of the edge: the width follows the pointer, and ends however the button comes up. */
function dragEdge(event: PointerEvent, width: () => number, resizeTo: (next: number) => void, setResizing: (on: boolean) => void): void {
	const handle = event.currentTarget as HTMLElement;
	const from = width();
	const start = event.clientX;
	event.preventDefault();
	try {
		handle.setPointerCapture(event.pointerId);
	} catch {
		// A synthetic event has no pointer to capture.
	}
	setResizing(true);
	document.documentElement.dataset.panelResizing = "true";
	const shell = handle.closest<HTMLElement>(".panel-shell");
	const beside = shell?.parentElement ? [...shell.parentElement.children].filter((one): one is HTMLElement => one !== shell && one instanceof HTMLElement) : [];
	insetsOnly(() => beside);
	const state = { done: false };
	const move = (moved: PointerEvent) => (moved.pointerType === "mouse" && moved.buttons === 0 ? end() : resizeTo(from + moved.clientX - start));
	const end = () => {
		if (state.done) return;
		state.done = true;
		for (const [name, fn] of [["pointermove", move], ["pointerup", end], ["pointercancel", end]] as const) window.removeEventListener(name, fn as EventListener, true);
		window.removeEventListener("blur", end);
		handle.removeEventListener("lostpointercapture", end);
		try {
			handle.releasePointerCapture(event.pointerId);
		} catch {
			// Already released.
		}
		setResizing(false);
		delete document.documentElement.dataset.panelResizing;
		insetsOnly(undefined);
		savePanelWidth(width());
	};
	for (const [name, fn] of [["pointermove", move], ["pointerup", end], ["pointercancel", end]] as const) window.addEventListener(name, fn as EventListener, true);
	window.addEventListener("blur", end);
	handle.addEventListener("lostpointercapture", end);
}

export function createPanelTab() {
	const [tab, setRaw] = createSignal<PanelTab>(tabOf(kept(TAB_KEY)));
	const setTab = (next: PanelTab) => (setRaw(next), keep(TAB_KEY, next));
	const [folded, setFolded] = createSignal<Set<string>>(foldedOf(kept(FOLDED_KEY)));
	const toggleFolder = (id: string) => {
		const next = toggled(folded(), id);
		setFolded(next);
		keep(FOLDED_KEY, JSON.stringify([...next]));
	};
	return { tab, setTab, folded, toggleFolder };
}

const keep = (key: string, value: string) => {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Private mode: it opens as it did before next time.
	}
};
const kept = (key: string) => {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
};

// --- the whole panel: one object every section is given -----------------------------------

/** Where the panel's elements are, once drawn: the list, the search field, the tab strip and its marker. */
type Refs = { list?: HTMLDivElement; field?: HTMLInputElement; nav?: HTMLDivElement; navMark?: HTMLSpanElement };

/** Everything a section of the panel reads and does. */
export type SidePanel = ReturnType<typeof createSidePanel>;

/** The panel's whole state, made once: the tab, the search, the width, both agent lists and the rows drawn. */
export function createSidePanel(props: SidePanelProps) {
	const refs: Refs = {};
	const [query, setQuery] = createSignal("");
	const tabs = createPanelTab();
	const width = createPanelWidth();
	const agents = createAgentLists(props, query, refs, tabs.tab);
	const strip = createTabStrip(props, query, setQuery, refs, tabs, agents.agentCount);
	const rows = createRows(props, tabs.tab, agents, refs);
	watchPanelKeys(props, refs);
	return { props, ids: createUniqueId(), refs, query, setQuery, ...tabs, ...width, ...agents, ...strip, ...rows };
}

/** Both agent lists, held in stores, and the one hover card they share. */
function createAgentLists(props: SidePanelProps, query: () => string, refs: Refs, tab: () => PanelTab) {
	/* Two lines per agent, as v3 draws them: the name, kind and state, then the tags. */
	const lines = (): 1 | 2 => 2;
	type At = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;
	/* The row under the pointer, for the one hover card the list shares, in the one-line view. */
	const [hovered, setHovered] = createSignal<{ id: string; at: At } | undefined>();
	/* The card keeps its last agent while it fades, so it is mounted once and travels from row to row. */
	const card = createMemo<{ chat: AgentChat; at: At } | undefined>((previous) => {
		const over = hovered();
		if (!over) return previous;
		const chat = (props.chats ?? []).find((one) => one.id === over.id);
		return chat ? { chat, at: over.at } : previous;
	});
	const cardShown = () => (tab() === "agents" || tab() === "recent") && lines() === 1 && hovered() !== undefined;
	/* Beside the panel and level with the row: the row's height, the panel's sides. */
	const besideRow = (row: DOMRect, element: Element | null) => {
		const side = element?.getBoundingClientRect() ?? row;
		return { left: side.left, right: side.right, width: side.width, top: row.top, bottom: row.bottom, height: row.height };
	};
	/** The section a dragged agent is over, by its id; no section once any drag ends, here or elsewhere. */
	const [over, setOver] = createSignal<string | undefined>(undefined);
	onMount(() => {
		const done = () => setOver(undefined);
		window.addEventListener("dragend", done);
		window.addEventListener("drop", done);
		onCleanup(() => {
			window.removeEventListener("dragend", done);
			window.removeEventListener("drop", done);
		});
	});
	/** The workspaces in use, read off the identities the panel holds: the edit window's suggestions. */
	const workspaceNames = createMemo(() => {
		const names = new Set<string>();
		for (const identity of Object.values(props.identities ?? {})) if (identity.workspace) names.add(identity.workspace);
		return [...names].sort();
	});
	const agentInput = () => ({ chats: props.chats ?? [], identities: props.identities ?? {}, unread: props.unread ?? {}, focused: props.focused, query: query() });
	/* Stores reconciled by id, so a state change updates its row instead of drawing the list again (`panel-steady.mjs`). */
	const [agentList, setAgentList] = createStore<AgentSection[]>(agentSections(agentInput()));
	createEffect(() => setAgentList(reconcile(agentSections(agentInput()))));
	const [recentList, setRecentList] = createStore<AgentListRow[]>(recentAgents(agentInput()));
	createEffect(() => setRecentList(reconcile(recentAgents(agentInput()), { key: "id" })));
	/* Every name but the agent's own: the edit window's red line comes before the server's refusal. */
	const nameTaken = (name: string, self: string) => {
		const wanted = name.trim().toLowerCase();
		return (props.chats ?? []).some((chat) => chat.id !== self && (props.identities?.[chat.id]?.name ?? chat.name).trim().toLowerCase() === wanted);
	};
	/** Every agent, unfiltered: what the placeholder and the empty state count. */
	const agentCount = () => props.chats?.length ?? 0;
	/** What both agent lists need from the panel. */
	const lists = (): Lists => ({
		identities: props.identities,
		workspaces: workspaceNames(),
		lines: lines(),
		count: agentCount(),
		query: query(),
		taken: nameTaken,
		hover: (id, at) => setHovered((was) => (at ? { id, at: besideRow(at, refs.list?.closest(".panel-shell") ?? null) } : was?.id === id ? undefined : was)),
		...(props.onFocusAgent ? { onFocusAgent: props.onFocusAgent } : {}),
		...(props.onCloseAgent ? { onCloseAgent: props.onCloseAgent } : {}),
		...(props.onNewAgent ? { onNewAgent: props.onNewAgent } : {}),
		...(props.onAgentTags ? { onAgentTags: props.onAgentTags } : {}),
		...(props.onAgentWorkspace ? { onAgentWorkspace: props.onAgentWorkspace } : {}),
		...(props.onAgentRename ? { onAgentRename: props.onAgentRename } : {}),
		...(props.onAbortAgent ? { onAbortAgent: props.onAbortAgent } : {}),
	});
	return { card, cardShown, over, setOver, agentList, recentList, agentCount, lists };
}

/** The tab strip and what each tab lists: switching clears the search, and the marker slides under the tab. */
function createTabStrip(props: SidePanelProps, query: () => string, setQuery: (q: string) => void, refs: Refs, tabs: ReturnType<typeof createPanelTab>, agentCount: () => number) {
	const { tab, setTab } = tabs;
	createEffect(() => {
		if (tab() === "apps" && props.open) props.onAppsOpen?.();
	});
	createEffect(() => {
		const ask = props.ask;
		if (ask) setTab(ask.tab);
	});
	/* The two lists differ, so a query left from the other tab would be a filter whose cause is off screen. */
	const goTab = (next: PanelTab) => {
		if (next === tab()) return;
		setTab(next);
		setQuery("");
	};
	const apps = createMemo(() => {
		const q = query().trim().toLowerCase();
		return (props.apps ?? []).filter((app) => !q || app.title.toLowerCase().includes(q) || app.name.toLowerCase().includes(q));
	});
	/* The Canvas tab's rows, listed without laying the drawing out; the one picked is read again with its box. */
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
	/* The marker slides under the tab showing, and again whenever the strip changes width. */
	const placeNavMark = () => {
		const on = refs.nav?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
		if (!on || !refs.navMark) return;
		refs.navMark.style.width = `${on.offsetWidth}px`;
		refs.navMark.style.transform = `translateX(${on.offsetLeft}px)`;
	};
	createEffect(() => {
		tab();
		props.open;
		requestAnimationFrame(placeNavMark);
	});
	onMount(() => {
		if (!refs.nav || typeof ResizeObserver === "undefined") return;
		const watch = new ResizeObserver(() => placeNavMark());
		watch.observe(refs.nav);
		onCleanup(() => watch.disconnect());
	});
	return { goTab, apps, items, selectedItems, headWords };
}

/** How many rows are drawn: a screenful at once, a chunk more near the bottom, none while the panel is shut. */
function createRows(props: SidePanelProps, tab: () => PanelTab, agents: { agentList: AgentSection[]; recentList: AgentListRow[] }, refs: Refs) {
	const FIRST_ROWS = 40;
	const MORE_ROWS = 60;
	/** How close to the bottom, in pixels, before the next chunk is drawn. */
	const LOAD_MORE_AT = 400;
	const [rowBudget, setRowBudget] = createSignal(FIRST_ROWS);
	/* A shut panel lets its rows go, and their pictures with them, after its slide out. */
	const [listed, setListed] = createSignal(props.open);
	createEffect(() => {
		if (props.open) {
			setListed(true);
			return;
		}
		const timer = setTimeout(() => setListed(false), 260);
		onCleanup(() => clearTimeout(timer));
	});
	const groups = (): Array<{ rows: unknown[] }> => (tab() === "agents" ? agents.agentList : tab() === "recent" ? [{ rows: agents.recentList }] : []);
	const visibleRows = () => groups().reduce((sum, section) => sum + section.rows.length, 0);
	/** How many of the section at `index`'s rows fit in what the sections above it left. */
	const allowance = (index: number): number => {
		if (!listed()) return 0;
		const all = groups();
		let before = 0;
		for (let i = 0; i < index; i += 1) before += all[i]?.rows.length ?? 0;
		return Math.max(0, rowBudget() - before);
	};
	const grow = () => {
		if (rowBudget() >= visibleRows()) return;
		setRowBudget((n) => n + MORE_ROWS);
	};
	/** One chunk closer to the end, once the page says its first paint is done (`listMayGrow`). */
	const growIfNearEnd = () => {
		if (!(props.listMayGrow ?? true) || !refs.list) return;
		if (refs.list.scrollHeight - refs.list.scrollTop - refs.list.clientHeight < LOAD_MORE_AT) grow();
	};
	/** The rows, in document order, for the arrow keys to walk. */
	const rows = () => [...(refs.list?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
	const focusRow = (index: number) => {
		const all = rows();
		if (all.length === 0) return;
		all[Math.min(Math.max(0, index), all.length - 1)]?.focus();
	};
	/* Up and down walk the rows; down off the last drawn row draws another chunk and steps onto it. */
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
			if (here === 0) refs.field?.focus();
			else focusRow(here - 1);
		} else if (event.key === "Home") focusRow(0);
		else if (event.key === "End") focusRow(all.length - 1);
		else return;
		event.preventDefault();
	};
	return { allowance, growIfNearEnd, rows, focusRow, rove };
}

/** `⌘\` folds the panel from anywhere but a text field, and `⌘K` (`findAt`) takes the cursor to the search. */
function watchPanelKeys(props: SidePanelProps, refs: Refs): void {
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
	createEffect(() => {
		if (!props.findAt) return;
		// Next frame, or there is nothing to focus yet on a panel that was closed.
		requestAnimationFrame(() => {
			refs.field?.focus();
			refs.field?.select();
		});
	});
}

/** Is a text field taking keys right now? Then the panel's chord is not for it. */
function typing(): boolean {
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return false;
	return active.isContentEditable || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
}
