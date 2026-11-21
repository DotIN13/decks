import ExternalLink from "lucide-solid/icons/external-link";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import ScanSearch from "lucide-solid/icons/scan-search";
import { Show } from "solid-js";
import { Icon } from "@decks/ui";
import { m } from "@decks/i18n";
import type { Tab } from "./kind.ts";
import { kindOf } from "./kinds.ts";
import { openItem } from "./open.ts";
import { front, reloadTab } from "./tabs.ts";

/** The kinds of tab that hold one item whole, which is what these actions are about. */
const ITEMS = new Set(["card", "document", "app"]);

/**
 * What the header offers for the tab in front, when it holds an item whole (a card, a document or an
 * app): Reload, which makes its frame again so its page starts from nothing (a document is edited
 * live, and has none); On canvas, which goes to where it sits on a canvas; and the browser's own tab.
 * With a canvas in front there is nothing here: a canvas's own controls are on the canvas.
 */
export function TabActs(props: { onShow: (tab: Tab) => void }) {
	const item = () => (ITEMS.has(front().kind) && front().target ? front() : undefined);
	const name = (tab: Tab) => kindOf(tab.kind)?.title(tab) ?? tab.target ?? "";
	return (
		<Show when={item()}>
			{(tab) => (
				<span class="tab-acts" role="group" aria-label={m.tabs_actions({ name: name(tab()) })}>
					<Show when={tab().kind !== "document"}>
						<button type="button" class="tab-act" data-act="reload" data-tip={m.tabs_reload_tip()} aria-label={m.tabs_reload()} onClick={() => reloadTab(tab().id)}>
							<Icon of={RefreshCw} size={15} />
							<span>{m.tabs_reload()}</span>
						</button>
					</Show>
					<button type="button" class="tab-act" data-act="canvas" data-tip={m.tabs_on_canvas_tip()} aria-label={m.tabs_on_canvas()} onClick={() => props.onShow(tab())}>
						<Icon of={ScanSearch} size={15} />
						<span>{m.tabs_on_canvas()}</span>
					</button>
					<button
						type="button"
						class="v3-icon"
						data-act="browser"
						data-tip={m.tabs_open_in_browser()}
						aria-label={m.tabs_open_in_browser()}
						onClick={() => openItem({ kind: tab().kind as "card" | "document" | "app", target: tab().target!, browser: true })}
					>
						<Icon of={ExternalLink} size={16} />
					</button>
					<span class="v3-sep" aria-hidden="true" />
				</span>
			)}
		</Show>
	);
}
