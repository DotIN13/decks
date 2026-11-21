import FileText from "lucide-solid/icons/file-text";
import { CardFrame } from "@decks/canvas/page";
import { Icon } from "@decks/ui";
import { m } from "@decks/i18n";
import { For, Show } from "solid-js";
import { canvasPass, cardAgentCall } from "../../canvases/pass.ts";
import { scheme } from "../../lib/theme.ts";
import { state } from "../../state/deck.ts";
import { act } from "../../state/decks.ts";
import type { Tab, TabKind } from "../kind.ts";
import { ITEM_KINDS, ITEMS_BEHIND } from "../budget.ts";
import { aliveAmong, reloadsOf } from "../tabs.ts";
import { openAt } from "../open.ts";

/** The canvas a card or a file is in, by its path: `canvases/<name>/…` is `<name>`'s, `shared/canvases/<owner>/<name>/…` is `shared/<owner>/<name>`'s. */
export function canvasOfPath(path: string): string | undefined {
	const own = /^canvases\/([^/]+)\//.exec(path);
	if (own) return own[1];
	const shared = /^shared\/canvases\/([^/]+)\/([^/]+)\//.exec(path);
	return shared ? `shared/${shared[1]}/${shared[2]}` : undefined;
}

/** A card as the deck has it now, by its path. */
const cardAt = (path: string | undefined) => state.pages.find((one) => one.path === path);

/**
 * A card, as a kind of tab: the card whole, in a frame of its own (`@decks/canvas`, `CardFrame`: the
 * frame every kind runs in, with the card kind inside), on its canvas's pass. Its buttons work as on
 * its canvas: its calls take the same roads. Kept alive behind the tab in front, within the device's
 * budget (`budget.ts`), so coming back to it is showing it; one past the budget is put away, and
 * loads again from its files.
 */
export const cardKind: TabKind = {
	name: "card",
	address: "card",
	title: (tab) => cardAt(tab.target)?.title,
	offers: {
		get label() {
			return m.tabs_cards();
		},
		list: async () => ((await act<Array<{ path: string; title: string }>>("card.list", [])) ?? []).map((card) => ({ target: card.path, title: card.title || card.path, note: canvasOfPath(card.path) })),
	},
	has: (target) => cardAt(target) !== undefined,
	icon: (props) => <Icon of={FileText} size={props.size ?? 16} />,
	view: (tab, parts) => <For each={aliveAmong(ITEM_KINDS, ITEMS_BEHIND).filter((one) => one.kind === "card")}>{(one) => <CardTab tab={one} shown={tab()?.id === one.id} foot={parts.dock.dockCover()} />}</For>,
};

function CardTab(props: { tab: Tab; shown: boolean; foot: number }) {
	const path = props.tab.target ?? "";
	const canvas = canvasOfPath(path);
	return (
		// Hidden, not taken out of the layout: the frame keeps its size, so the card is as it was when it shows again.
		<div class="surface" data-surface="card" data-kept={props.shown ? undefined : "true"} style={{ visibility: props.shown ? undefined : "hidden", "pointer-events": props.shown ? undefined : "none" }}>
			<Show when={canvas && cardAt(path)} fallback={<p class="tab-missing">{m.tabs_card_gone()}</p>}>
				{/* Made again at the header's Reload: a new frame is how a card's page and its scripts start again. */}
				<Show when={[reloadsOf(props.tab.id)]} keyed>
					{(_load) => (
						<CardFrame
							card={{ path, title: cardAt(path)?.title ?? path, rev: cardAt(path)?.rev ?? 0, w: cardAt(path)?.w ?? 600, trusted: !path.startsWith("shared/") }}
							canvas={canvas!}
							pass={canvasPass}
							dark={scheme() === "dark"}
							foot={props.foot}
							agent={cardAgentCall}
							openAt={openAt}
						/>
					)}
				</Show>
			</Show>
		</div>
	);
}
