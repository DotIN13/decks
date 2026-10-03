import { DecksMark } from "../ui/icons.tsx";
import { Switcher } from "./Switcher.tsx";

/**
 * What a tab shows when it is on no backend it can open: the public Decks before anything has been
 * opened, an address naming a connection this browser has forgotten, or a page that cannot run the
 * service worker another backend needs. One sentence of why, and the switcher, which is every way on.
 */
export function Start(props: { why: string }) {
	return (
		<div class="start-page">
			<div class="start-card float">
				<span class="panel-mark-glyph start-mark" aria-hidden="true">
					<DecksMark size={22} />
				</span>
				<h1>Decks</h1>
				<p>{props.why}</p>
				<div class="panel-mark start-switcher">
					<Switcher label="Open a file or connect a server" />
				</div>
			</div>
		</div>
	);
}
