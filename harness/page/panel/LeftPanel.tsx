// The side panel at the left: its props, the panel that lays its sections out, and each section,
// given the panel's state as one object (`createSidePanel`, in actions.ts).
import type { PenDocument } from "@decks/pen";
import type { AgentChat, AgentKind, Identity } from "../state/types/index.ts";
import type { AppAction, PanelApp } from "./AppRow.tsx";
import { createSidePanel, type SidePanel } from "./actions.ts";
import ChevronDown from "lucide-solid/icons/chevron-down";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import Search from "lucide-solid/icons/search";
import SettingsIcon from "lucide-solid/icons/settings";
import X from "lucide-solid/icons/x";
import AppWindow from "lucide-solid/icons/app-window";
import Clock from "lucide-solid/icons/clock";
import Layers from "lucide-solid/icons/layers";
import Sparkles from "lucide-solid/icons/sparkles";
import { For, Show, untrack, type JSX } from "solid-js";
import { Icon } from "@decks/ui";
import { canvasItems, type CanvasItem } from "@decks/canvas/tools";
import { Switcher } from "../connections/Switcher.tsx";
import { can } from "../connections/backend.ts";
import { AgentHoverCard } from "../agents/AgentHoverCard.tsx";
import { DecksLineMark } from "./DecksLineMark.tsx";
import { PANEL_TABS, tabBeside, type PanelTab } from "./model.ts";
import { PANEL_MAX, PANEL_MIN } from "./panel-width.ts";
import { AppsTab, CanvasTab } from "./tabs/view.tsx";
import { AgentsTab, RecentTab } from "./lists/view.tsx";
/**
 * The side panel at the left: a head, four tabs (Recent, Canvas, Agents, Apps), one search over the
 * tab showing, the list, and the conversation under it. Opened and folded by the top bar's button and
 * by `⌘\`; folded, it is slid out and draws no rows, and stays mounted so the shortcut still works.
 */

export type { PanelTab } from "./model.ts";
/** An app in the deck's `apps/` folder, as `apps.list` answers it. */
export type { PanelApp } from "./AppRow.tsx";

export type SidePanelProps = {
	/** A tab asked for from outside: the agent menu's overflow row opens Agents. A new `at` is a new ask. */
	ask?: { tab: PanelTab; at: number };
	/** Whether the rows below the first screenful may be drawn yet: after the page's first paint. Left out, they may. */
	listMayGrow?: boolean;
	/** The card the canvas is centred on. */
	current?: string;
	/** The agent you are talking to, for the Agents tab. */
	focused?: string;
	/** Folded is gone. Owned by the top bar's button, so the two can never disagree. */
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** A stamp that means "find now": `⌘K` takes the cursor into the search, once per stamp. */
	findAt?: number;

	// --- the Agents tab ---------------------------------------------------------------
	/** Every chat, for the Agents and Recent tabs. */
	chats?: AgentChat[];
	identities?: Record<string, Identity>;
	unread?: Record<string, number>;
	onFocusAgent?: (id: string) => void;
	/** Make an agent in a workspace (`undefined` for none): the `+` on a workspace's heading. */
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

	/** The desktop head: the canvas, Settings and Hide over a row of tabs. Left out on a phone. */
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
	/** The canvas switcher around the head's canvas title (`canvases/CanvasSwitcher.tsx`). */
	canvasMenu?: (trigger: (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element) => JSX.Element;

	// --- the Apps tab -----------------------------------------------------------------
	/** The deck's apps; asked for when the tab opens. */
	apps?: PanelApp[];
	onAppsOpen?: () => void;
	/** Show, start, stop, restart or delete an app (`panel/AppRow.tsx`); its promise ends the row's wait. */
	onApp?: (app: PanelApp, action: AppAction) => Promise<unknown> | void;
	/** An app's recent output, for its Logs panel. */
	onAppLogs?: (app: PanelApp) => Promise<string[] | undefined>;

	/** The conversation, under the list. */
	chat?: JSX.Element;
};

export function LeftPanel(props: SidePanelProps) {
	const panel = createSidePanel(props);
	return (
		<aside
			/* `data-inset` only while open: it tells the camera there is a panel to subtract (`camera/insets.ts`). */
			data-inset={props.open ? "left" : undefined}
			data-open={props.open ? "true" : "false"}
			aria-hidden={!props.open}
			aria-label="Side panel"
			style={{ width: `${panel.width()}px` }}
			data-resizing={panel.resizing() ? "true" : undefined}
			data-desktop={props.desktop ? "true" : undefined}
			class="panel-shell v3-panel fixed z-10 top-0 bottom-0 left-0 flex max-w-[86vw] flex-col"
		>
			<PanelResize panel={panel} />
			<PanelHead panel={panel} />
			<PanelTabs panel={panel} />
			<PanelSearch panel={panel} />
			<PanelList panel={panel} />
			{props.chat}
			<PanelHoverCard panel={panel} />
		</aside>
	);
}

/** The strip's tabs, each with its label and icon. */
const PANEL_TAB_LABEL: Record<PanelTab, string> = { recent: "Recent", canvas: "Canvas", agents: "Agents", apps: "Apps" };
const PANEL_TAB_ICON = { recent: Clock, canvas: Layers, agents: Sparkles, apps: AppWindow };

/** The right edge, to take hold of: a separator the arrow keys move, which Home or a double-click resets. */
export function PanelResize(own: { panel: SidePanel }) {
	const { props, width, onHandleDown, onHandleKey, reset } = own.panel;
	return (
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
	);
}

/** The head: on a desk the canvas (its switcher), the deck and what the tab holds, Settings and Hide; else the deck's mark and Hide. */
export function PanelHead(own: { panel: SidePanel }) {
	const { props, headWords } = own.panel;
	return (
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
	);
}

/** The tab strip, with a marker that slides under the tab showing; no Agents or Recent where there are no agents. */
export function PanelTabs(own: { panel: SidePanel }) {
	const { props, ids, refs, tab, goTab } = own.panel;
	return (
		<div class="v3-nav" role="tablist" aria-label="Panel" ref={(el) => (refs.nav = el)}>
			<span class="v3-nav-mark" ref={(el) => (refs.navMark = el)} aria-hidden="true" />
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
	);
}

/** The search over the tab showing: Escape clears it, then leaves it; down steps onto the first row. */
export function PanelSearch(own: { panel: SidePanel }) {
	const { props, refs, tab, query, setQuery: type, focusRow, rows } = own.panel;
	return (
		<div class="v3-search-wrap">
			<label class="v3-search">
				<Icon of={Search} class="flex-none" size={14} />
				<input
					ref={(el) => (refs.field = el)}
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
							refs.field?.focus();
						}}
					>
						<Icon of={X} size={12} />
					</button>
				</Show>
			</label>
		</div>
	);
}

/** The list of the tab showing, its rows drawn a chunk at a time. `data-tab` names which list it is. */
export function PanelList(own: { panel: SidePanel }) {
	const { props, ids, refs, tab, query, agentList, recentList, lists, folded, toggleFolder, over, setOver, allowance, items, selectedItems, apps, rove, growIfNearEnd } = own.panel;
	return (
		<div
			ref={(el) => (refs.list = el)}
			id={`${ids}-list`}
			class="panel-list"
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
	);
}

/** The one hover card the agent rows share, in the one-line view. */
export function PanelHoverCard(own: { panel: SidePanel }) {
	const { props, card, cardShown } = own.panel;
	return (
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
	);
}
