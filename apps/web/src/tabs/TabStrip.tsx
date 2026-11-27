import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { For, Show, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Icon, Popover } from "@decks/ui";
import { m } from "@decks/i18n";
import { CanvasSwitcher } from "../canvases/CanvasSwitcher.tsx";
import { scheme } from "../lib/theme.ts";
import { canvasMenu } from "../app/canvas-menu.tsx";
import { newCanvas, setCanvasesOpen } from "../app/person.ts";
import { canvases } from "../state/canvases.ts";
import { kindOf } from "./kinds.ts";
import { dragToCanvas } from "./drag-link.ts";
import { OpenMore } from "./OpenMore.tsx";
import type { Tab } from "./kind.ts";
import { cameraCanvasTab, canClose, canvasOnScreen, closeTab, front, openTab, showTab, tabs } from "./tabs.ts";

/*
 * The list of what can be opened (the +) and the list of the tabs open (the count) are also opened
 * from where a touch bar has put them: the + from the bar's ⋯ menu, the tabs from the bar's title
 * while a card, a document or an app is in front.
 */
let togglePlus: (() => void) | undefined;
let toggleList: (() => void) | undefined;
/** Open the list of what can be opened as a tab, as the + does. A moment later, so the menu it is picked from has shut. */
export const openPlus = (): void => void setTimeout(() => togglePlus?.(), 0);
/** Open the list of the tabs open, as the count does. */
export const openTabsList = (): void => void setTimeout(() => toggleList?.(), 0);

/** What a tab is called: its kind's name for it, and a chat on no canvas says so. */
const titleOf = (tab: Tab): string => kindOf(tab.kind)?.title(tab) ?? tab.target ?? m.tabs_no_canvas();

/** A tab's ✕: in the row's chip, or at the end of its row in the list. The press is its own, not also a press on what it sits in. */
function CloseTab(props: { tab: Tab; in: "chip" | "list" }): JSX.Element {
	return (
		<button
			type="button"
			class={props.in === "chip" ? "tab-chip-close" : "close"}
			aria-label={m.tabs_close_named({ name: titleOf(props.tab) })}
			data-tip={props.in === "chip" ? m.tabs_close_tab() : undefined}
			on:click={(event) => {
				event.stopPropagation();
				closeTab(props.tab.id);
			}}
		>
			<Icon of={X} size={13} />
		</button>
	);
}

/**
 * One tab in the row: its kind's mark, its name and its ✕, washed when it is in front. Every tab is
 * drawn the same, the canvas the chat's camera is on among them, in its place. A press puts the
 * camera of the chat on screen on it; a press on a canvas tab that is already in front opens the
 * canvas list, to take that tab to another canvas. Dragged down onto the canvas, a tab leaves a link
 * to itself there (`drag-link.ts`).
 */
function TabChip(props: { tab: Tab }): JSX.Element {
	const tab = props.tab;
	const inFront = () => front().id === tab.id;
	const drag = dragToCanvas(tab, () => titleOf(tab));
	const name = (list?: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => (
		<button
			type="button"
			class="tab-chip-name"
			ref={list?.ref}
			aria-haspopup={list ? "menu" : undefined}
			aria-expanded={list ? list.open : undefined}
			data-open={list?.open ? "true" : undefined}
			data-tip={list && inFront() ? m.tabs_canvases() : titleOf(tab)}
			aria-label={m.tabs_a_tab({ name: titleOf(tab) })}
			onPointerDown={drag.press}
			onClick={() => (drag.wasDrag() ? undefined : list && inFront() ? list.toggle() : showTab(tab.id))}
		>
			<Show when={kindOf(tab.kind)}>{(kind) => <Dynamic component={kind().icon} size={16} />}</Show>
			<span class="v3-canvas-name">{titleOf(tab)}</span>
		</button>
	);
	return (
		<span class="tab-chip" role="tab" data-tab={tab.id} data-kind={tab.kind} aria-selected={inFront()} data-front={inFront() ? "true" : undefined} data-camera={tab === cameraCanvasTab() ? "true" : undefined}>
			{tab.kind === "canvas" ? canvasMenu((list) => name(list)) : name()}
			<Show when={canClose(tab)}>
				<CloseTab tab={tab} in="chip" />
			</Show>
		</span>
	);
}

/**
 * The tabs as a list, opened from a small square with how many are open, as a phone's browser shows
 * it: every tab a row, with its ✕ at the row's end. What a touch bar has in place of the row, and what a
 * desktop's bar adds when there are more tabs than it has room for.
 */
function TabFold(): JSX.Element {
	return (
		<Popover
			placement="bottom-start"
			label={m.tabs_tabs()}
			class="w-[300px]"
			trigger={(popover) => {
				toggleList = popover.toggle;
				return (
					<button type="button" class="tab-chip tab-fold" ref={popover.ref} aria-haspopup="menu" aria-expanded={popover.open} data-open={popover.open ? "true" : undefined} data-tip={m.tabs_all_tabs()} aria-label={m.tabs_open_count({ count: tabs().length })} onClick={popover.toggle}>
						<span class="tab-fold-count">{tabs().length}</span>
					</button>
				);
			}}
		>
			<For each={tabs()}>
				{(tab) => (
					/* The row and its ✕ in one box (`.row-act`, `kit/chrome.css`): the wash is the box's, so it is under both. */
					<div class="row-act">
						<button type="button" role="menuitem" data-row data-flat="true" class="tab-row min-w-0 flex-1" data-tab={tab.id} data-kind={tab.kind} data-current={front().id === tab.id ? "true" : undefined} onClick={() => showTab(tab.id)}>
							<Show when={kindOf(tab.kind)}>{(kind) => <Dynamic component={kind().icon} size={15} />}</Show>
							<span class="row-label min-w-0 flex-1 truncate">{titleOf(tab)}</span>
						</button>
						<Show when={canClose(tab)}>
							<CloseTab tab={tab} in="list" />
						</Show>
					</div>
				)}
			</For>
		</Popover>
	);
}

/**
 * The row of tabs in the top bar: every tab the same, in the order they were opened, the one in
 * front washed, then the + that opens one. With more tabs than the bar has room for, the row shows
 * the first of them, the one in front always among them, and a count lists them all. A touch bar
 * shows no row: its own chip names the tab in front (`shell/TopBar.tsx`), and the count lists them.
 * A press puts the camera of the chat on screen on the tab; a canvas tab moves it to that canvas.
 * Nothing here changes where an agent's calls act.
 */
export function TabStrip(props: { /** How many tabs the bar has room for beside the first. */ room: number; /** A phone's or a tablet's bar: the tabs are the one count, and the bar's own chip names the tab in front. */ touch: boolean }): JSX.Element {
	const over = () => tabs().length > props.room + 1;
	const shown = (): Tab[] => {
		if (props.touch) return [];
		if (!over()) return tabs();
		// The count takes a tab's room. The tab in front is always in the row: in the last place when it is not among the first.
		const first = tabs().slice(0, Math.max(1, props.room));
		return first.includes(front()) ? first : [...first.slice(0, -1), front()];
	};
	return (
		<>
			<For each={shown()}>{(tab) => <TabChip tab={tab} />}</For>
			<Show when={props.touch ? tabs().length > 1 : over()}>
				<TabFold />
			</Show>
			{/* The +: the canvases, to open one as a tab and keep the one the camera leaves, where the list a canvas tab in front opens only takes that tab to one; and after them what the other kinds offer (`OpenMore.tsx`). */}
			<CanvasSwitcher
				canvases={canvases()}
				here={canvasOnScreen()?.name}
				scheme={scheme()}
				onPick={(name) => openTab("canvas", name)}
				onNew={() => newCanvas()}
				onAll={() => void setCanvasesOpen(true)}
				findLabel={m.tabs_find()}
				more={(find, pick) => <OpenMore find={find()} pick={pick} />}
				trigger={(popover) => {
					togglePlus = popover.toggle;
					return (
						<button type="button" class="v3-icon tab-open" ref={popover.ref} aria-haspopup="menu" aria-expanded={popover.open} data-open={popover.open ? "true" : undefined} data-tip={m.tabs_open_a_tab()} aria-label={m.tabs_open_a_tab()} onClick={popover.toggle}>
							<Icon of={Plus} size={16} />
						</button>
					);
				}}
			/>
		</>
	);
}
