import type { JSX } from "solid-js";
import { ItemFrame, type ItemFrameProps } from "../kind-host.tsx";
import type { CardShown, CardWords } from "./protocol.ts";

/** What the page gives a card's frame: the card to show, read again whenever it changes (its file's revision, its width). */
export interface CardFrameProps extends ItemFrameProps {
	card: CardShown;
}

/**
 * A card whole, in a frame of its own on the page (`kind-host.tsx`), with the card kind inside it
 * (`guest.tsx`). Told again when the card's file changes.
 */
export function CardFrame(props: CardFrameProps): JSX.Element {
	let said: string | undefined;
	return (
		<ItemFrame<CardWords>
			{...props}
			kind="card"
			title={props.card.title}
			start={() => {
				said = `${props.card.rev}/${props.card.w}`;
				return { card: { ...props.card } };
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
