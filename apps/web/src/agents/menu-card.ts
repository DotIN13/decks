import type { AgentChat } from "@decks/protocol";
import { createSignal, onCleanup } from "solid-js";
import { canHover } from "../lib/media.ts";

/** The box the card hangs off. */
type Anchor = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;

/**
 * The agent list's one hover card: which row it is describing, and where that row is.
 *
 * `held` keeps the last row after the pointer leaves so the card fades out with words
 * still in it: a card emptied the instant it starts fading is a card that fades out blank.
 *
 * At once, and it lingers 80ms on the way out.
 *
 * There was a 350ms wait before the card, to stop a pointer run down five rows from
 * flashing five cards. The fear was reasonable and the cure was worse: the same card
 * summoned from the corner arrives instantly, so one hover felt broken and the other
 * did not, and 350ms of nothing is long enough to conclude there is nothing to see.
 *
 * What actually stops the flashing is the grace on the way *out*: leaving a row does not
 * take the card down for 80ms, so entering the next one inside that window moves it
 * rather than replacing it. A card that slides down the list is not a card that blinks
 * five times — and it is the behaviour of the surface next to it.
 */
export function createMenuCard(chats: () => AgentChat[]) {
	const [over, setOver] = createSignal<{ id: string; at: Anchor } | undefined>();
	const [held, setHeld] = createSignal<{ id: string; at: Anchor } | undefined>();
	let exit: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(exit));

	/*
	 * Not on a touch screen, and not as a rule about small windows: the card is a *hover*
	 * card, and a finger cannot hover.
	 *
	 * `pointerenter` fires on a tap, so a list of agents on a phone answered the first tap
	 * with a card and needed a second one to switch — the card arriving instead of the
	 * thing you asked for. It reads as the tap being eaten, which is what it is. Everything
	 * the card says is on the row underneath it anyway; on a phone the row is the answer.
	 */
	const point = (id: string, row: HTMLElement) => {
		if (!canHover()) return;
		const at = anchorFor(row);
		clearTimeout(exit);
		setOver({ id, at });
		setHeld({ id, at });
	};

	const unpoint = (id: string) => {
		clearTimeout(exit);
		exit = setTimeout(() => setOver((was) => (was?.id === id ? undefined : was)), 80);
	};

	/** The chat the card is describing, while it is up and while it fades. */
	const describing = () => {
		const id = (over() ?? held())?.id;
		return id ? chats().find((chat) => chat.id === id) : undefined;
	};
	/** Where the card hangs, for the chat `describing` found. */
	const anchor = () => (over() ?? held())!.at;
	const shown = () => over() !== undefined;

	return { point, unpoint, describing, anchor, shown };
}

/**
 * The box the card hangs off: level with the row, clear of the *menu*.
 *
 * A row is inset from the popover's edge by its padding, so a card placed beside the row
 * overlapped the menu's own border by three pixels — visible as a card that looks stuck
 * to the list rather than beside it. Taking the row's vertical extent and the popover's
 * right edge is the anchor that means what the design says: beside the menu, aligned to
 * the row.
 */
function anchorFor(row: HTMLElement): Anchor {
	const at = row.getBoundingClientRect();
	const card = row.closest(".popover")?.getBoundingClientRect();
	return {
		top: at.top,
		bottom: at.bottom,
		height: at.height,
		left: card?.left ?? at.left,
		right: card?.right ?? at.right,
		width: (card?.right ?? at.right) - (card?.left ?? at.left),
	};
}
