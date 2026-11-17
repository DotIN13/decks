import type { JSX } from "solid-js";
import type { CanvasPass } from "../outside/host.tsx";
import { ItemFrame, type ItemLookProps } from "../kind-host.tsx";
import type { CardShown, CardWords } from "./protocol.ts";

/** What the page gives a card's frame: the card to show, read again whenever it changes (its file's revision, its width). */
export interface CardFrameProps extends ItemLookProps {
	card: CardShown;
	/** The canvas the card is on, and the pass for it (the one its canvas's frame is given). */
	canvas: string;
	pass: (canvas: string) => Promise<CanvasPass>;
}

/**
 * A card whole, in a frame of its own on the page (`kind-host.tsx`), with the card kind inside it
 * (`guest.tsx`). Told again when the card's file changes.
 */
export function CardFrame(props: CardFrameProps): JSX.Element {
	let said: string | undefined;
	return (
		<ItemFrame<CardWords>
			dark={props.dark}
			foot={props.foot}
			agent={props.agent}
			kind="card"
			title={props.card.title}
			pass={() => props.pass(props.canvas)}
			start={() => {
				said = `${props.card.rev}/${props.card.w}`;
				return { canvas: props.canvas, card: { ...props.card } };
			}}
			say={(end) => {
				const now = `${props.card.rev}/${props.card.w}`;
				if (now === said) return;
				said = now;
				end.emit("card", { rev: props.card.rev, w: props.card.w });
			}}
		/>
	);
}
