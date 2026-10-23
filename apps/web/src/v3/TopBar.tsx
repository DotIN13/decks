import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Layers from "lucide-solid/icons/layers";
import PanelLeftOpen from "lucide-solid/icons/panel-left-open";
import Plus from "lucide-solid/icons/plus";
import { Show } from "solid-js";
import { AgentFace, AgentMenu } from "../agents/AgentPill.tsx";
import { Switcher } from "../connections/Switcher.tsx";
import { Icon } from "../ui/icons.tsx";

/**
 * The bar at the top left: whose canvas this is, and which canvas.
 *
 * With the side panel folded it also carries the way back to it and the deck's mark, which the
 * panel's head holds while it is open. Then the agent, as one chip (its face, its name and its
 * kind, opening the agent list), a hairline, the canvas (opening the canvas manager), and a `+`
 * for a new canvas. On a phone the kind and the `+` give their room to the canvas's name, which
 * moves to the right end of the bar.
 */
export function TopBar(props: {
	panelOpen: boolean;
	onTogglePanel: () => void;
	chats: AgentChat[];
	identities: Record<string, Identity>;
	focused: string | undefined;
	unread: Record<string, number>;
	onFocus: (id: string) => void;
	onNew: (kind: AgentKind) => void;
	onClose: (id: string) => void;
	onMoreAgents?: () => void;
	stage?: string;
	onStages?: () => void;
	stagesOpen?: boolean;
	onNewCanvas?: () => void;
	viewOnly?: string;
	onCopy?: () => void;
	/** The phone's bar: full width, the canvas at the right end. */
	phone?: boolean;
}) {
	const active = () => props.chats.find((chat) => chat.id === props.focused);
	const name = () => {
		const chat = active();
		return chat ? (props.identities[chat.id]?.name ?? chat.name) : undefined;
	};

	return (
		<div class="v3-bar v3-topbar float pill" data-inset="top" data-phone={props.phone ? "true" : undefined}>
			<Show when={!props.panelOpen}>
				<button type="button" class="v3-icon v3-unfold" data-tip="Show the side panel" data-key="⌘\" aria-label="Show the side panel" onClick={() => props.onTogglePanel()}>
					<Icon of={PanelLeftOpen} size={17} />
				</button>
				<span class="v3-deck">
					<Switcher />
				</span>
			</Show>
			<AgentMenu
				chats={props.chats}
				identities={props.identities}
				focused={props.focused}
				unread={props.unread}
				onFocus={props.onFocus}
				onClose={props.onClose}
				onNew={props.onNew}
				{...(props.onMoreAgents ? { onMore: props.onMoreAgents } : {})}
				label="Agents"
				trigger={(api) => (
					<button
						type="button"
						class="v3-agent-chip"
						ref={api.ref}
						aria-haspopup="menu"
						aria-expanded={api.open}
						data-open={api.open ? "true" : undefined}
						data-tip="Switch agent"
						aria-label={name() ? `Agents, currently ${name()}` : "Agents"}
						onClick={api.toggle}
					>
						<Show when={active()} fallback={<span class="v3-agent-name">No agent</span>}>
							{(chat) => <AgentFace chat={chat()} identity={props.identities[chat().id]} unread={props.unread[chat().id] ?? 0} size={22} ring={1.5} />}
						</Show>
						<Show when={name()}>{(label) => <span class="v3-agent-name">{label()}</span>}</Show>
						<Show when={active() && !props.phone}>
							<span class="v3-agent-kind">{active()!.kind}</span>
						</Show>
						<Icon of={ChevronDown} size={13} class="v3-chev" />
					</button>
				)}
			/>
			<Show when={props.onStages}>
				<span class="v3-sep" aria-hidden="true" data-phone-hide />
				<Show when={props.phone}>
					<span class="flex-1" />
				</Show>
				<button
					type="button"
					class="v3-canvas-chip"
					data-open={props.stagesOpen ? "true" : undefined}
					aria-haspopup="dialog"
					aria-expanded={props.stagesOpen ?? false}
					data-tip="Canvases"
					aria-label={props.stage ? `Canvases, currently ${props.stage}` : "Canvases, this chat is on none"}
					onClick={() => props.onStages?.()}
				>
					<Icon of={Layers} size={16} />
					<span class="v3-canvas-name">{props.stage ?? "No canvas"}</span>
					<Icon of={ChevronDown} size={13} class="v3-chev" />
				</button>
				<Show when={props.viewOnly}>
					{(owner) => (
						<button type="button" class="v3-viewonly" title={`Shared with you to view by ${owner()}: it follows their copy. Make your own copy to change it.`} onClick={() => props.onCopy?.()}>
							View only · Make a copy
						</button>
					)}
				</Show>
				<Show when={props.onNewCanvas && !props.phone}>
					<button type="button" class="v3-icon" data-tip="New canvas" aria-label="New canvas" onClick={() => props.onNewCanvas?.()}>
						<Icon of={Plus} size={16} />
					</button>
				</Show>
			</Show>
		</div>
	);
}
