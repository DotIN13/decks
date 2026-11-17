import { createResource, For, Show, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { Offer, TabKind } from "./kind.ts";
import { allKinds } from "./kinds.ts";
import { openTab } from "./tabs.ts";

/** How many of a kind the + lists at once: the rest are a few more letters away. */
const SHOWN = 6;

/**
 * What the + lists after the canvases: for each other kind, what can be opened as a tab of it
 * (`TabKind.offers`), under the kind's own word. The lists are asked for when the + opens. Before
 * anything is typed only a kind that says so shows its first few (the apps); typed words find the
 * rest, by title, by path and by where they are.
 */
export function OpenMore(props: { find: string; pick: (run: () => void) => void }): JSX.Element {
	const kinds = allKinds().filter((kind) => kind.offers);
	return <For each={kinds}>{(kind) => <KindOffers kind={kind} find={props.find} pick={props.pick} />}</For>;
}

function KindOffers(props: { kind: TabKind; find: string; pick: (run: () => void) => void }) {
	const offers = props.kind.offers!;
	const [all] = createResource(() => offers.list().catch(() => [] as Offer[]));
	const listed = () => {
		const words = props.find.trim().toLowerCase().split(/\s+/).filter(Boolean);
		if (words.length === 0) return offers.always ? (all() ?? []).slice(0, SHOWN) : [];
		return (all() ?? []).filter((one) => words.every((word) => `${one.title} ${one.target} ${one.note ?? ""}`.toLowerCase().includes(word))).slice(0, SHOWN);
	};
	return (
		<Show when={listed().length > 0}>
			<div class="menu-label">{offers.label}</div>
			<For each={listed()}>
				{(offer) => (
					<button type="button" role="menuitem" data-row data-flat="true" class="open-offer" data-kind={props.kind.name} onClick={() => props.pick(() => openTab(props.kind.name, offer.target))}>
						<span class="row-icon">
							<Dynamic component={props.kind.icon} size={15} />
						</span>
						<span class="row-label min-w-0 flex-1 truncate">{offer.title}</span>
						<Show when={offer.note}>
							<span class="menu-note max-w-[110px] truncate">{offer.note}</span>
						</Show>
					</button>
				)}
			</For>
		</Show>
	);
}
