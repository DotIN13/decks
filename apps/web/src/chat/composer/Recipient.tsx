import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { Show } from "solid-js";
import { AgentFace, AgentMenu } from "../../chrome/AgentPill.tsx";
import { Icon } from "../../ui/icons.tsx";
import type { Destination } from "../../app/send-from-bar.ts";

export interface RecipientProps {
	chats: AgentChat[];
	identities: Record<string, Identity>;
	unread: Record<string, number>;
	focused: string | undefined;
	/** Who is on the canvas on screen: the menu's *Here* section, and what "joins" is measured against. */
	here: string[];
	/** Where the line goes, as the bar decided it (`destination()`): the chip shows this. */
	dest: Destination;
	/** The word that goes with it, for the tooltip and for a check to read: "to Sable, on Decks". */
	label: string;
	/** The dispatcher's own chat, for its face and its row. */
	dispatcher?: AgentChat;
	/** The canvas on screen, named, for "joins Decks". */
	canvasName?: string;
	onPick: (id: string) => void;
	onDispatcher: () => void;
	onNew: (kind?: AgentKind) => void;
	onClose: (id: string) => void;
	/** Open the Agents panel, for the agents the list has no room for. */
	onMore?: () => void;
}

/**
 * Who gets the line, as a control.
 *
 * It was a label — `TO AGENT 2, ON I LOVE CANDY`, ten-pixel caps above the field — that read
 * the bar's decision back and could not change it; the one way to address somebody else
 * from the composer was to type their name after an `@`. Now the label is a chip with the
 * agent's face on it, and pressing it opens the pill's own agent list (`AgentMenu`: Here,
 * Anywhere, New agent) with the dispatcher added under the rule, since it is the one
 * recipient that is not an agent on the list.
 *
 * ### The chip brings the agent to you; the pill takes you to the agent
 *
 * Both open the same list, and they do opposite things with a choice. The pill's face and
 * chevron *follow* an agent: you go to the canvas it works on, and keep going as it moves.
 * The chip *addresses* one: the line carries this canvas with it (`canvas.use` before the
 * prompt), so an agent picked from *Anywhere* joins the canvas you are on when you send.
 * The chip never moves you, and it says what sending will do — *joins Decks* — beside the
 * name, the moment an agent from elsewhere is chosen.
 */
export function Recipient(props: RecipientProps) {
	const agent = () => {
		const dest = props.dest;
		return dest.kind === "prompt" ? props.chats.find((chat) => chat.id === dest.id) : undefined;
	};
	const name = () => {
		if (props.dest.kind === "prompt") return props.dest.name;
		if (props.dest.kind === "task") return "Dispatcher";
		if (props.dest.kind === "note") return "a board";
		return "No agent";
	};
	const face = () => {
		const chat = props.dest.kind === "task" ? props.dispatcher : agent();
		return chat ? <AgentFace chat={chat} identity={props.identities[chat.id]} size={16} ring={1} /> : undefined;
	};
	const joins = () => {
		const dest = props.dest;
		return dest.kind === "prompt" && props.canvasName !== undefined && props.here.length > 0 && !props.here.includes(dest.id);
	};
	return (
		<span class="dock-to" data-dest={props.label} data-kind={props.dest.kind}>
			<span class="dock-to-word">To</span>
			<AgentMenu
				chats={props.chats}
				identities={props.identities}
				focused={props.dest.kind === "prompt" ? props.dest.id : props.focused}
				unread={props.unread}
				here={props.here}
				onFocus={props.onPick}
				onNew={props.onNew}
				onClose={props.onClose}
				{...(props.onMore ? { onMore: props.onMore } : {})}
				placement="top-start"
				label="Who gets the line"
				foot={
					<Show when={props.dispatcher}>
						{(dispatcher) => (
							<button
								type="button"
								role="menuitem"
								data-row
								data-flat="true"
								data-current={props.dest.kind === "task" ? "true" : undefined}
								class="dock-to-dispatcher"
								onClick={props.onDispatcher}
							>
								<AgentFace chat={dispatcher()} identity={props.identities[dispatcher().id]} size={20} ring={1.5} />
								<span class="lb nm block truncate">Dispatcher</span>
							</button>
						)}
					</Show>
				}
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
			<Show when={joins()}>
				<span class="dock-to-joins">joins {props.canvasName}</span>
			</Show>
		</span>
	);
}
