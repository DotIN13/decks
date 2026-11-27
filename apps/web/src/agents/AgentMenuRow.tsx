import { m } from "@decks/i18n";
import type { AgentChat, Identity } from "@decks/protocol";
import X from "lucide-solid/icons/x";
import { Show } from "solid-js";
import { Icon } from "@decks/ui";
import { agentStatus, closeWords, rowWords } from "./agent-order.ts";
import { AgentFace } from "./AgentPill.tsx";

/**
 * One agent in the agent list (`AgentMenu`): its face, name, runtime and state as a row that
 * focuses it, and the × that closes it, which Delete or Backspace on the row also does.
 */
export function AgentMenuRow(props: {
	chat: AgentChat;
	identity: Identity | undefined;
	unread: number;
	/** The row describes the conversation already on screen. */
	current: boolean;
	/** The row pressed: the menu closes and the agent is focused. */
	onPick: () => void;
	onClose: () => void;
	/** The pointer or the focus came to the row, or left it: the menu's hover card follows. */
	onPoint: (row: HTMLElement) => void;
	onUnpoint: () => void;
}) {
	const chat = props.chat;
	const status = () => agentStatus(chat.state, props.unread);
	const name = () => props.identity?.name ?? chat.name;
	/** The tooltip if this chat can be closed, and `undefined` if it cannot. */
	const close = () => closeWords(chat.state, name());
	return (
		/*
		 * The row and its × in one box, which is `.row-act` in `chrome.css` — a
		 * `<button>` cannot contain a `<button>`, and the wash has to belong to the
		 * box or it stops 22px short of the row's own right edge.
		 */
		<div class="row-act">
			<button
				type="button"
				role="menuitem"
				data-row
				data-flat="true"
				data-agent="true"
				data-status={status()}
				/* Washed rather than ticked: the row is describing the window you are
				   already in, and a tick would imply the list is a setting. */
				data-current={props.current ? "true" : undefined}
				class="min-w-0 flex-1"
				onClick={() => props.onPick()}
				/*
				 * The card is summoned by pointing and by focus, which is the keyboard's
				 * equivalent — the arrows rove this list, so without the focus half the
				 * detail would be mouse-only, and the roving exists precisely so the list
				 * can be used without one.
				 */
				onPointerEnter={(event) => props.onPoint(event.currentTarget)}
				onPointerLeave={() => props.onUnpoint()}
				onFocus={(event) => props.onPoint(event.currentTarget)}
				onBlur={() => props.onUnpoint()}
				/*
				 * Delete is the × for the keyboard, and it is on the row because the row
				 * is what the arrows rove onto. `Popover`'s own handler reads Escape and
				 * the arrows off the document and ignores these two, so nothing has to
				 * be coordinated — but the event still stops here, or a Backspace meant
				 * for a chat would also be the browser's go-back.
				 */
				onKeyDown={(event) => {
					if (event.key !== "Delete" && event.key !== "Backspace") return;
					event.preventDefault();
					event.stopPropagation();
					if (close()) props.onClose();
				}}
			>
				<AgentFace chat={chat} identity={props.identity} unread={props.unread} size={20} ring={1.5} />
				{/*
					`block`, because `.row-label` is a flex row and `text-overflow` does not apply to
					one — a long name would have overflowed the row rather than ellipsing.

					`nm` keeps the name at 600 where the rest of this menu's labels are 400: a
					row you pick an *agent* from is not a row you pick a command from. See
					`chrome.css`, where both halves of that are stated together.
				*/}
				<span class="row-label row-name block truncate">{name()}</span>
				{/*
					Which runtime, in the word the server uses. The chip the panel row and the
					hover card also wear, so the three surfaces name a runtime identically —
					`.kind` in `styles/chrome.css` argues for the word over a badge on the face.
				*/}
				<span class="kind" data-dormant={chat.dormant ? "true" : undefined}>{chat.outside?.client ?? chat.kind}</span>
				{/*
					`data-yield` says these words give ground for the × rather than a square
					standing empty beside them until it arrives: the last column of a row is one
					short status, and 22px reserved there is a ragged gutter down the whole list.
					So the slot opens on approach and the words slide left by it — see `.row-act`
					in `chrome.css`, which is also where the touch case lives, since there is
					nothing to approach with on a phone and the slot simply stays open.
				*/}
				<span class="meta flex-none text-micro tabular-nums" data-yield>{rowWords(status(), chat.state, chat.lastAt)}</span>
			</button>

			{/*
				Not a `[data-row]`, and that is the whole reason the arrows still work: the
				rove list is built from that attribute, so an × carrying it would make every
				journey through the list twice as long. It is also why picking it does not
				close the menu — `Popover` closes on a row click and this is not one — which
				is right on its own terms, since closing three chats is one visit to the list.

				**Absent, rather than disabled, on a chat that cannot be closed.** The
				registry refuses anything mid-turn, and the row already says why: it keeps its
				words instead of swapping them for a greyed-out button whose tooltip repeats
				"still working". A control that cannot be pressed is worth drawing when its
				absence would be a mystery, and "typing…" is not a mystery.
			*/}
			<Show when={close()}>
				{(words) => (
					<button
						class="close"
						type="button"
						title={words()}
						aria-label={m.agents_close({ name: name() })}
						onClick={(event) => {
							event.stopPropagation();
							props.onClose();
						}}
					>
						<Icon of={X} size={13} />
					</button>
				)}
			</Show>
		</div>
	);
}
