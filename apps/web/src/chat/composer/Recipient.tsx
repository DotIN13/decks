import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import { createMemo, Show } from "solid-js";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { AgentFace, AgentMenu } from "../../agents/AgentPill.tsx";
import { Icon } from "../../ui/icons.tsx";
import type { Destination } from "../../app/send-from-bar.ts";

export interface RecipientProps {
	chats: AgentChat[];
	identities: Record<string, Identity>;
	unread: Record<string, number>;
	focused: string | undefined;
	/** Where the line goes, as the bar decided it (`destination()`): the chip shows this. */
	dest: Destination;
	/** The word that goes with it, for the tooltip and for a check to read: "to Sable". */
	label: string;
	/** Go to an agent's stage: picking one here is the same as pressing its row. */
	onPick: (id: string) => void;
	onNew: (kind: AgentKind) => void;
	onClose: (id: string) => void;
	/** Open the Agents panel, for the agents the list has no room for. */
	onMore?: () => void;
}

/**
 * Who gets the line, as a control.
 *
 * A chip with the agent's face on it. Pressing it opens the pill's own agent list
 * (`AgentMenu`), and picking one goes to that agent's stage, where the line then goes. A
 * typed `@Name` sends one line to another agent without moving you, and the chip follows the
 * words, because the bar reads the line (`destination()`) and not this menu.
 */
export function Recipient(props: RecipientProps) {
	const agent = () => {
		const dest = props.dest;
		return dest.kind === "prompt" ? props.chats.find((chat) => chat.id === dest.id) : undefined;
	};
	const name = () => {
		if (props.dest.kind === "prompt") return props.dest.name;
		if (props.dest.kind === "note") return "a board";
		return "No agent";
	};
	/*
	 * The face stays mounted while the recipient stays the same. The destination is worked out
	 * again from the text on every keystroke, so a face made inside that computation was a new
	 * element, and a new image, per letter: the avatar flickered while you typed.
	 */
	const agentId = createMemo(() => agent()?.id);
	const face = (
		<Show when={agentId()}>
			{(id) => <AgentFace chat={props.chats.find((chat) => chat.id === id())!} identity={props.identities[id()]} size={16} ring={1} />}
		</Show>
	);
	return (
		<span class="dock-to" data-dest={props.label} data-kind={props.dest.kind}>
			<span class="dock-to-word">To</span>
			<AgentMenu
				chats={props.chats}
				identities={props.identities}
				focused={props.dest.kind === "prompt" ? props.dest.id : props.focused}
				unread={props.unread}
				onFocus={props.onPick}
				onClose={props.onClose}
				{...(props.onMore ? { onMore: props.onMore } : {})}
				onNew={props.onNew}
				placement="top-start"
				label="Who gets the line"
				trigger={(api) => (
					<button
						type="button"
						class="dock-to-chip"
						ref={api.ref}
						aria-haspopup="menu"
						aria-expanded={api.open}
						title={props.label}
						aria-label={`Who gets the line: ${props.label}. Press to choose.`}
						onClick={api.toggle}
					>
						{face}
						<span class="dock-to-name">{name()}</span>
						<Icon of={ChevronDown} size={11} />
					</button>
				)}
			/>
		</span>
	);
}
