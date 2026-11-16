import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import { createMemo, Show } from "solid-js";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { AgentFace, AgentMenu } from "../../agents/index.ts";
import { Icon } from "@decks/ui";
import type { Destination } from "../bar/destination.ts";
import { menuActions } from "./actions.ts";
import { chipLabel, recipientChat, recipientName } from "./model.ts";

// Who gets the line, as a chip in the controls row that can change it.

export interface RecipientProps {
	chats: AgentChat[];
	identities: Record<string, Identity>;
	unread: Record<string, number>;
	focused: string | undefined;
	/** Where the line goes, as the bar decided it (`destination()`): the chip shows this. */
	dest: Destination;
	/** The word that goes with it, for the tooltip and for a check to read: "to Sable". */
	label: string;
	/** Go to an agent's canvas: picking one here is the same as pressing its row. */
	onPick: (id: string) => void;
	onNew: (kind: AgentKind) => void;
	onClose: (id: string) => void;
	/** Open the Agents panel, for the agents the list has no room for. */
	onMore?: () => void;
	/** In the composer's row: the chip alone, without "To". */
	compact?: boolean;
}

/** Who gets the line, as a control. */
export function Recipient(props: RecipientProps) {
	const agent = () => recipientChat(props.dest, props.chats);
	const name = () => recipientName(props.dest);
	/*
	 * The face stays mounted while the recipient stays the same. The destination is worked out
	 * again from the text on every keystroke, so a face made inside that computation was a new
	 * element, and a new image, per letter: the avatar flickered while you typed.
	 */
	const agentId = createMemo(() => agent()?.id);
	const face = (
		<Show when={agentId()}>
			{(id) => <AgentFace chat={props.chats.find((chat) => chat.id === id())!} identity={props.identities[id()]} size={props.compact ? 20 : 16} ring={1} />}
		</Show>
	);
	return (
		<span class="dock-to" data-dest={props.label} data-kind={props.dest.kind} data-compact={props.compact ? "true" : undefined}>
			<Show when={!props.compact}>
				<span class="dock-to-word">To</span>
			</Show>
			<AgentMenu
				chats={props.chats}
				identities={props.identities}
				focused={props.dest.kind === "prompt" ? props.dest.id : props.focused}
				unread={props.unread}
				{...menuActions(props)}
				placement="top-start"
				label="Who gets the line"
				trigger={(api: { ref: (el: HTMLElement) => void; open: boolean; toggle: () => void }) => (
					<button
						type="button"
						class="dock-to-chip"
						ref={api.ref}
						aria-haspopup="menu"
						aria-expanded={api.open}
						title={props.label}
						aria-label={chipLabel(props.label)}
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
