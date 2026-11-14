import Plus from "lucide-solid/icons/plus";
import { For, Show, type JSX } from "solid-js";
import { AgentMark } from "@decks/ui/agent-marks";
import { Icon, type Placement, Popover } from "@decks/ui";
import { AuthedImg } from "../../lib/authed.tsx";
import { runtimes } from "../../state/deck.ts";
import type { AgentChat, AgentKind, Identity } from "../../state/types/index.ts";
import { agentStatus } from "../agent-order.ts";
import { createDismiss } from "./actions.ts";
import { faceStyle, initialOf } from "./model.ts";

// An agent's face, the runtimes a new agent can be started on, and the button
// that offers them.

export function AgentFace(props: { chat: AgentChat; identity: Identity | undefined; unread?: number; size?: number; ring?: number; class?: string }): JSX.Element {
	return (
		<span class={`agent-face ${props.class ?? ""}`} data-status={agentStatus(props.chat.state, props.unread ?? 0)} style={faceStyle(props.identity, props.size, props.ring)} aria-hidden="true">
			<Show when={props.identity?.avatar} fallback={initialOf(props.identity, props.chat.name)}>
				{(src) => <AuthedImg src={src()} alt="" />}
			</Show>
		</span>
	);
}

export function AgentChoices(props: { onPick: (kind: AgentKind) => void }): JSX.Element {
	return (
		<For each={runtimes()}>
			{(runtime) => (
				<button type="button" role="menuitem" data-row data-flat="true" disabled={!runtime.available} title={runtime.reason ?? ""} onClick={() => props.onPick(runtime.kind)}>
					<span class="menu-tile" aria-hidden="true">
						<AgentMark class="flex-none" agent={runtime.kind as Parameters<typeof AgentMark>[0]["agent"]} size={13} />
					</span>
					<span class="row-label flex-1">{runtime.label}</span>
					<Show when={!runtime.available}>
						<span class="menu-note">not installed</span>
					</Show>
				</button>
			)}
		</For>
	);
}

export function NewAgentButton(props: { onNew: (kind: AgentKind) => void; placement?: Placement; label?: string; class?: string; size?: number; text?: string }): JSX.Element {
	const d = createDismiss();
	const label = () => props.label ?? "Add an agent";
	const trigger = (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => {
		d.hold(api);
		return (
			<button type="button" class={`icon-button new-agent ${props.class ?? ""}`} ref={api.ref} aria-haspopup="menu" aria-expanded={api.open} data-on={api.open ? "soft" : undefined} title={`${label()}: pick its runtime`} aria-label={label()} onClick={api.toggle}>
				<Icon of={Plus} size={props.size ?? 15} />
				<Show when={props.text}>{(text) => <span class="new-agent-text">{text()}</span>}</Show>
			</button>
		);
	};
	return (
		<Popover placement={props.placement ?? "bottom-start"} label="Add an agent" class="w-[248px]" trigger={trigger}>
			<AgentChoices onPick={(kind) => d.pick(() => props.onNew(kind))} />
		</Popover>
	);
}
