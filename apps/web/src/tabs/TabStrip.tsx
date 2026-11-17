import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { For, Show, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Icon, Popover } from "@decks/ui";
import { CanvasSwitcher } from "../canvases/CanvasSwitcher.tsx";
import { scheme } from "../lib/theme.ts";
import { newCanvas, setStagesOpen } from "../app/person.ts";
import { stages } from "../state/canvases.ts";
import { kindOf } from "./kinds.ts";
import { OpenMore } from "./OpenMore.tsx";
import type { Tab } from "./kind.ts";
import { cameraCanvasTab, canvasOnScreen, closeTab, front, onCanvas, openTab, showTab, tabs } from "./tabs.ts";

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

/**
 * The row folded: one chip with how many tabs are open beside the camera's canvas, washed while one
 * of them is in front and, off a phone, naming that one, that opens them all as a list, each of the
 * others with its ✕. What a phone's bar shows, and any bar with more tabs than it has room for.
 */
function TabFold(props: { /** Name the tab in front beside the count: where the bar's own chip does not (a desktop's folded row). */ named: boolean; /** Count the canvas chip's tab too: every tab open, as a touch bar says it. */ all: boolean }): JSX.Element {
	const others = () => tabs().filter((tab) => tab !== cameraCanvasTab());
	const titleOf = (tab: Tab) => kindOf(tab.kind)?.title(tab) ?? tab.target ?? "";
	return (
		<Popover
			placement="bottom-start"
			label="Tabs"
			class="w-[300px]"
			trigger={(popover) => {
				toggleList = popover.toggle;
				return (
				<button type="button" class="tab-chip tab-fold" ref={popover.ref} aria-haspopup="menu" aria-expanded={popover.open} data-open={popover.open ? "true" : undefined} data-front={onCanvas() ? undefined : "true"} data-tip="Tabs" aria-label={`${others().length + 1} tabs open`} onClick={popover.toggle}>
					<span class="tab-fold-count">{others().length + (props.all ? 1 : 0)}</span>
					{/* Which of them is in front, where the bar has room to say: its mark and its name. */}
					<Show when={props.named && !onCanvas()}>
						<Show when={kindOf(front().kind)}>{(kind) => <Dynamic component={kind().icon} size={16} />}</Show>
						<span class="v3-canvas-name">{titleOf(front())}</span>
					</Show>
				</button>
				);
			}}
		>
			{/* The canvas the chat's camera is on, first: where the others are opened from. */}
			<button type="button" role="menuitem" data-row data-flat="true" class="tab-row" data-kind="canvas" data-current={onCanvas() ? "true" : undefined} onClick={() => showTab(cameraCanvasTab().id)}>
				<Dynamic component={kindOf("canvas")!.icon} size={15} />
				<span class="row-label min-w-0 flex-1 truncate">{canvasOnScreen()?.title ?? "No canvas"}</span>
			</button>
			<For each={others()}>
				{(tab) => (
					<div class="tab-row-line">
						<button type="button" role="menuitem" data-row data-flat="true" class="tab-row" data-tab={tab.id} data-kind={tab.kind} data-current={front().id === tab.id ? "true" : undefined} onClick={() => showTab(tab.id)}>
							<Show when={kindOf(tab.kind)}>{(kind) => <Dynamic component={kind().icon} size={15} />}</Show>
							<span class="row-label min-w-0 flex-1 truncate">{titleOf(tab)}</span>
						</button>
						<button type="button" class="tab-chip-close" aria-label={`Close ${titleOf(tab)}`} onClick={() => closeTab(tab.id)}>
							<Icon of={X} size={13} />
						</button>
					</div>
				)}
			</For>
		</Popover>
	);
}

/**
 * The row of tabs in the top bar, after the canvas chip (which the bar draws: the canvas the camera
 * of the chat on screen is on, which opens the canvas list): each other tab with its kind's mark, its
 * name and a ✕, and the + that opens one. A press puts that chat's camera on the tab; a canvas tab
 * moves it to that canvas. Nothing here changes where an agent's calls act.
 */
export function TabStrip(props: { /** How many chips the bar has room for: with more tabs than that, the row folds into one chip that lists them. */ room: number; /** A phone's or a tablet's bar: the tabs are always the one count, and the bar's own chip names the tab in front. */ touch: boolean }): JSX.Element {
	// The canvas the chat's camera is on is the bar's own chip (`shell/TopBar.tsx`); these are the others.
	const others = () => tabs().filter((tab) => tab !== cameraCanvasTab());
	const folded = () => props.touch || others().length > props.room;
	return (
		<>
			<Show when={folded() && others().length > 0}>
				<TabFold named={!props.touch} all={props.touch} />
			</Show>
			<For each={folded() ? [] : others()}>
				{(tab) => {
					const kind = () => kindOf(tab.kind);
					const title = () => kind()?.title(tab) ?? tab.target ?? "";
					return (
						<span class="tab-chip" role="tab" data-tab={tab.id} data-kind={tab.kind} aria-selected={front().id === tab.id} data-front={front().id === tab.id ? "true" : undefined}>
							<button type="button" class="tab-chip-name" data-tip={title()} aria-label={`${title()}, a tab`} onClick={() => showTab(tab.id)}>
								<Show when={kind()}>{(shown) => <Dynamic component={shown().icon} size={16} />}</Show>
								<span class="v3-canvas-name">{title()}</span>
							</button>
							<button type="button" class="tab-chip-close" aria-label={`Close ${title()}`} data-tip="Close the tab" onClick={() => closeTab(tab.id)}>
								<Icon of={X} size={13} />
							</button>
						</span>
					);
				}}
			</For>
			{/* The +: the canvases, to open one as a tab and keep the one the camera leaves, where the canvas chip's list only goes to one; and after them what the other kinds offer (`OpenMore.tsx`). */}
			<CanvasSwitcher
				stages={stages()}
				here={canvasOnScreen()?.name}
				scheme={scheme()}
				onPick={(name) => openTab("canvas", name)}
				onNew={() => newCanvas()}
				onAll={() => void setStagesOpen(true)}
				findLabel="Find a canvas, an app, a card or a document"
				more={(find, pick) => <OpenMore find={find()} pick={pick} />}
				trigger={(popover) => {
					togglePlus = popover.toggle;
					return (
						<button type="button" class="v3-icon tab-open" ref={popover.ref} aria-haspopup="menu" aria-expanded={popover.open} data-open={popover.open ? "true" : undefined} data-tip="Open a tab" aria-label="Open a tab" onClick={popover.toggle}>
							<Icon of={Plus} size={16} />
						</button>
					);
				}}
			/>
		</>
	);
}
