import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { AgentFace, AgentMenu, NewAgentButton } from "../../agents/AgentPill.tsx";
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
	const face = () => {
		const chat = agent();
		return chat ? <AgentFace chat={chat} identity={props.identities[chat.id]} size={16} ring={1} /> : undefined;
	};
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
						{face()}
						<span class="dock-to-name">{name()}</span>
						<Icon of={ChevronDown} size={11} />
					</button>
				)}
			/>
			<NewAgentButton onNew={props.onNew} placement="top-start" size={12} class="dock-to-new" />
		</span>
	);
}
