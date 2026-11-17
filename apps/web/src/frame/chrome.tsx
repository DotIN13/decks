import type { FrameChrome } from "@decks/canvas";
import { insets } from "@decks/canvas/camera";
import { drawing } from "@decks/canvas/tools";
import { createEffect, Show } from "solid-js";
import { CommentPopup } from "../markup/CommentPopup.tsx";

/**
 * What the Decks app draws inside the canvas frame, beside the canvas (`@decks/canvas`, `frame/chrome.ts`):
 * an agent's offer to move the view, and the comment popover on words selected in a card. Both answer
 * something the frame alone knows at once. The tools are the page's (`app/canvas-tools.tsx`): the tool
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
						<span>An agent wants to {offer.what === "card" ? "show you a card" : offer.what === "canvas" ? "take you to another canvas" : "move the view"}</span>
						<button type="button" class="frame-offer-go" onClick={() => offer.go()}>
							Go
						</button>
						<button type="button" class="frame-offer-no" aria-label="Stay here" onClick={() => chrome.dismissOffer()}>
							Stay
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
