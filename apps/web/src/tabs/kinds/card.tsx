import FileText from "lucide-solid/icons/file-text";
import { CardFrame } from "@decks/canvas";
import { Icon } from "@decks/ui";
import { Show } from "solid-js";
import { canvasPass, cardAgentCall } from "../../canvases/pass.ts";
import { scheme } from "../../lib/theme.ts";
import { state } from "../../state/deck.ts";
import { act } from "../../state/decks.ts";
import type { Tab, TabKind } from "../kind.ts";

/** The canvas a card is in, by its path: `canvases/<name>/…` is `<name>`'s, `shared/canvases/<owner>/<name>/…` is `shared/<owner>/<name>`'s. */
function canvasOfPath(path: string): string | undefined {
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
 * its canvas: its calls take the same roads. Put away while it is not in front.
 */
export const cardKind: TabKind = {
	name: "card",
	address: "card",
	title: (tab) => cardAt(tab.target)?.title,
	offers: {
		label: "Cards",
		list: async () => ((await act<Array<{ path: string; title: string }>>("card.list", [])) ?? []).map((card) => ({ target: card.path, title: card.title || card.path, note: canvasOfPath(card.path) })),
	},
	icon: (props) => <Icon of={FileText} size={props.size ?? 16} />,
	view: (tab, parts) => (
		<Show when={tab()} keyed>
			{(shown) => <CardTab tab={shown} foot={parts.dock.dockCover()} />}
		</Show>
	),
};

function CardTab(props: { tab: Tab; foot: number }) {
	const path = props.tab.target ?? "";
	const canvas = canvasOfPath(path);
	return (
		<div class="surface" data-surface="card">
			<Show when={canvas && cardAt(path)} fallback={<p class="tab-missing">This card is not in the deck any more.</p>}>
				<CardFrame
					card={{ path, title: cardAt(path)?.title ?? path, rev: cardAt(path)?.rev ?? 0, w: cardAt(path)?.w ?? 600, trusted: !path.startsWith("shared/") }}
					canvas={canvas!}
					pass={canvasPass}
					dark={scheme() === "dark"}
					foot={props.foot}
					agent={cardAgentCall}
				/>
			</Show>
		</div>
	);
}
