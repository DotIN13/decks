import type { FrameChrome } from "@decks/canvas/page";
import { insets } from "@decks/canvas/camera";
import { drawing } from "@decks/canvas/tools";
import { createEffect, Show } from "solid-js";
import { m } from "@decks/i18n";
import { CommentPopup } from "../markup/CommentPopup.tsx";

/**
 * What the Decks app draws inside the canvas frame, beside the canvas (`@decks/canvas`, `frame/chrome.ts`):
 * an agent's offer to move the view, and the comment popover on words selected in a card. Both answer
 * something the frame alone knows at once. The tools are the page's (`tabs/kinds/canvas-tools.tsx`): the tool
 * column, the pen tray, the properties and the zoom, drawn over the frame, where a float can go anywhere.
 */
export function DecksFrameChrome(chrome: FrameChrome) {
	// Taking up the pen puts the popover away.
	createEffect(() => {
		if (drawing() && chrome.comment()) chrome.setComment(undefined);
	});
	const comment = (text: string, send: boolean) => {
		const target = chrome.comment();
		if (!target) return;
		chrome.compose({ comment: { path: target.path, title: target.title, quote: target.quote, text, send, ...(target.component ? { component: target.component } : {}), ...(target.items?.length ? { items: target.items } : {}) } });
		chrome.setComment(undefined);
	};
	return (
		<>
			<Show when={chrome.offer()} keyed>
				{(offer) => (
					<div class="v3-bar float pill frame-offer" role="status">
						<span>{offer.what === "card" ? m.frame_offer_card() : offer.what === "canvas" ? m.frame_offer_canvas() : m.frame_offer_view()}</span>
						<button type="button" class="frame-offer-go" onClick={() => offer.go()}>
							{m.frame_offer_go()}
						</button>
						<button type="button" class="frame-offer-no" aria-label={m.frame_offer_stay_here()} onClick={() => chrome.dismissOffer()}>
							{m.frame_offer_stay()}
						</button>
					</div>
				)}
			</Show>
			<Show when={chrome.comment()} keyed>
				{(target) => (
					<CommentPopup
						target={{ ...target, anchor: () => target.anchor() }}
						moved={() => [chrome.camera(), insets()]}
						left={insets().left}
						canSend
						onKeep={(text) => comment(text, false)}
						onSend={(text) => comment(text, true)}
						onClose={() => chrome.setComment(undefined)}
					/>
				)}
			</Show>
		</>
	);
}
