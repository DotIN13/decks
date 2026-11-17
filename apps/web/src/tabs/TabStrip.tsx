import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { For, Show, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Icon } from "@decks/ui";
import { CanvasSwitcher } from "../canvases/CanvasSwitcher.tsx";
import { scheme } from "../lib/theme.ts";
import { newCanvas, setStagesOpen } from "../app/person.ts";
import { stages } from "../state/canvases.ts";
import { kindOf } from "./kinds.ts";
import { OpenMore } from "./OpenMore.tsx";
import { canvasOnScreen, closeTab, front, openTab, showTab, tabs } from "./tabs.ts";

/**
 * The row of tabs in the top bar, after the home tab (the canvas chip, which the bar draws: it is the
 * conversation's canvas and opens the canvas list): each other tab with its kind's mark, its name and
 * a ✕, and the + that opens one. A press brings a tab forward; nothing here moves an agent.
 */
export function TabStrip(): JSX.Element {
	const others = () => tabs().filter((tab) => tab.target !== undefined);
	return (
		<>
			<For each={others()}>
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
