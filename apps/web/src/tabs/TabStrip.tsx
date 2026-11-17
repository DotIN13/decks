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
import { canvasOnScreen, closeTab, front, homeCanvas, homeInFront, openTab, showHome, showTab, tabs } from "./tabs.ts";

/**
 * The row folded: one chip with how many tabs are open beside home, washed while one of them is in
 * front, that opens them as a list: home first, then each with its ✕. What a phone's bar shows, and
 * any bar with more tabs than it has room for.
 */
function TabFold(): JSX.Element {
	const others = () => tabs().filter((tab) => tab.target !== undefined);
	const titleOf = (tab: Tab) => kindOf(tab.kind)?.title(tab) ?? tab.target ?? "";
	return (
		<Popover
			placement="bottom-start"
			label="Tabs"
			class="w-[300px]"
			trigger={(popover) => (
				<button type="button" class="tab-chip tab-fold" ref={popover.ref} aria-haspopup="menu" aria-expanded={popover.open} data-open={popover.open ? "true" : undefined} data-front={homeInFront() ? undefined : "true"} data-tip="Tabs" aria-label={`${others().length} ${others().length === 1 ? "tab" : "tabs"} open beside home`} onClick={popover.toggle}>
					<span class="tab-fold-count">{others().length}</span>
				</button>
			)}
		>
			<button type="button" role="menuitem" data-row data-flat="true" class="tab-row" data-current={homeInFront() ? "true" : undefined} onClick={() => showHome()}>
				<Dynamic component={kindOf("canvas")!.icon} size={15} />
				<span class="row-label min-w-0 flex-1 truncate">{homeCanvas()?.title ?? "Home"}</span>
				<span class="menu-note">Home</span>
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
 * The row of tabs in the top bar, after the home tab (the canvas chip, which the bar draws: it is the
 * conversation's canvas and opens the canvas list): each other tab with its kind's mark, its name and
 * a ✕, and the + that opens one. A press brings a tab forward; nothing here moves an agent.
 */
export function TabStrip(props: { /** How many chips the bar has room for: with more tabs than that, the row folds into one chip that lists them. None on a phone. */ room: number }): JSX.Element {
	const others = () => tabs().filter((tab) => tab.target !== undefined);
	const folded = () => others().length > props.room;
	return (
		<>
			<Show when={folded() && others().length > 0}>
				<TabFold />
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
			{/* The +: the canvases, to open one as a tab of its own, where the home tab's list moves the conversation to one; and after them what the other kinds offer (`OpenMore.tsx`). */}
			<CanvasSwitcher
				stages={stages()}
				here={canvasOnScreen()?.name}
				scheme={scheme()}
				onPick={(name) => openTab("canvas", name)}
				onNew={() => newCanvas()}
				onAll={() => void setStagesOpen(true)}
				findLabel="Find a canvas, an app, a card or a document"
				more={(find, pick) => <OpenMore find={find()} pick={pick} />}
				trigger={(popover) => (
					<button type="button" class="v3-icon tab-open" ref={popover.ref} aria-haspopup="menu" aria-expanded={popover.open} data-open={popover.open ? "true" : undefined} data-tip="Open a tab" aria-label="Open a tab" onClick={popover.toggle}>
						<Icon of={Plus} size={16} />
					</button>
				)}
			/>
		</>
	);
}
