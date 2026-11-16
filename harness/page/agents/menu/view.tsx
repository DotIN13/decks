import ChevronRight from "lucide-solid/icons/chevron-right";
import PanelLeft from "lucide-solid/icons/panel-left";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { For, Show, type JSX } from "solid-js";
import { Icon, type Placement, Popover } from "@decks/ui";
import type { AgentChat, AgentKind, Identity } from "../../state/types/index.ts";
import { agentStatus, closeWords, rowWords } from "../agent-order.ts";
import { AgentHoverCard } from "../AgentHoverCard.tsx";
import { AgentChoices, AgentFace } from "../face/view.tsx";
import { anchorFor, createMenu } from "./actions.ts";
import { findAgents, listAgents, moreWords, runsOf } from "./model.ts";

// The agent menu: find an agent, pick one, close one, see more in the panel,
// or start a new one; a card beside the row says more about the one pointed at.

export type MenuProps = {
	chats: AgentChat[];
	identities: Record<string, Identity>;
	focused: string | undefined;
	unread: Record<string, number>;
	onFocus: (id: string) => void;
	onClose: (id: string) => void;
	trigger: (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element;
	placement?: Placement;
	label?: string;
	onMore?: () => void;
	onNew?: (kind: AgentKind) => void;
};
type P = { props: MenuProps; m: ReturnType<typeof createMenu> };

export function AgentMenu(props: MenuProps): JSX.Element {
	const m = createMenu();
	const listed = () => listAgents(props.chats, props.identities, props.unread, props.focused, m.find());
	const describing = () => props.chats.find((chat) => chat.id === m.pointed());
	return (
		<Popover placement={props.placement ?? "bottom-start"} label={props.label ?? "Agents"} class="w-[280px]" onOpenChange={(open) => !open && m.setFind("")} trigger={(api) => ((m.timers.dismiss = () => api.open && api.toggle()), props.trigger(api))}>
			<label class="field menu-find">
				<Icon of={Search} size={13} class="shrink-0 text-faint" />
				<input type="text" placeholder="Find an agent" aria-label="Find an agent" value={m.find()} onInput={(event) => m.setFind(event.currentTarget.value)} />
			</label>
			<Show when={m.find().trim() && findAgents(props.chats, props.identities, m.find()).length === 0}>
				<p class="m-0 px-2 py-2 text-note text-faint">No agent matches that</p>
			</Show>
			<For each={runsOf(listed().shown, props.identities)}>
				{(run) => (
					<>
						<Show when={run.label}>{(label) => <div class="group">{label()}</div>}</Show>
						<For each={run.chats}>{(chat) => <Row props={props} m={m} chat={chat} />}</For>
					</>
				)}
			</For>
			<Show when={listed().more > 0}>
				<More props={props} m={m} more={listed().more} />
			</Show>
			<Show when={props.onNew}>{(onNew) => <NewRow props={props} m={m} onNew={onNew()} />}</Show>
			<Show when={describing()}>{(chat) => <AgentHoverCard chat={chat()} identity={props.identities[chat().id]} unread={props.unread[chat().id] ?? 0} anchor={(m.over() ?? m.held())!.at} shown={m.over() !== undefined} beside />}</Show>
		</Popover>
	);
}

function Row(p: P & { chat: AgentChat }): JSX.Element {
	const { props, m, chat } = p;
	const status = () => agentStatus(chat.state, props.unread[chat.id] ?? 0);
	const name = () => props.identities[chat.id]?.name ?? chat.name;
	const close = () => closeWords(chat.state, name());
	const key = (event: KeyboardEvent) => {
		if (event.key !== "Delete" && event.key !== "Backspace") return;
		event.preventDefault();
		event.stopPropagation();
		if (close()) props.onClose(chat.id);
	};
	return (
		<div class="row-act">
			<button type="button" role="menuitem" data-row data-flat="true" data-agent="true" data-status={status()} data-current={props.focused === chat.id ? "true" : undefined} class="min-w-0 flex-1" onClick={() => m.pick(() => props.onFocus(chat.id))} onPointerEnter={(event) => m.point(chat.id, anchorFor(event.currentTarget))} onPointerLeave={() => m.unpoint(chat.id)} onFocus={(event) => m.point(chat.id, anchorFor(event.currentTarget))} onBlur={() => m.unpoint(chat.id)} onKeyDown={key}>
				<AgentFace chat={chat} identity={props.identities[chat.id]} unread={props.unread[chat.id] ?? 0} size={20} ring={1.5} />
				<span class="row-label row-name block truncate">{name()}</span>
				<span class="kind" data-dormant={chat.dormant ? "true" : undefined}>{chat.kind}</span>
				<span class="meta flex-none text-micro tabular-nums" data-yield>{rowWords(status(), chat.state, chat.lastAt)}</span>
			</button>
			<Show when={close()}>
				{(words) => (
					<button class="close" type="button" title={words()} aria-label={`Close ${name()}`} onClick={(event) => (event.stopPropagation(), props.onClose(chat.id))}>
						<Icon of={X} size={13} />
					</button>
				)}
			</Show>
		</div>
	);
}

function More(p: P & { more: number }): JSX.Element {
	return (
		<Show when={p.props.onMore} fallback={<p class="m-0 px-2 py-1.5 text-note leading-normal text-faint">{moreWords(p.more)} — open the Agents panel.</p>}>
			{(more) => (
				<button type="button" role="menuitem" data-row data-flat="true" class="agent-menu-more" onClick={() => more()()}>
					<Icon of={PanelLeft} size={13} class="flex-none text-muted" />
					<span class="row-label flex-1 whitespace-nowrap">{moreWords(p.more)}</span>
					<span class="meta flex-none text-micro">Agents panel</span>
				</button>
			)}
		</Show>
	);
}

function NewRow(p: P & { onNew: (kind: AgentKind) => void }): JSX.Element {
	const trigger = (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => (
		<button type="button" role="menuitem" data-row data-flat="true" class="agent-menu-new" ref={api.ref} aria-haspopup="menu" aria-expanded={api.open} data-on={api.open ? "soft" : undefined} onClick={api.toggle}>
			<Icon of={Plus} size={13} class="flex-none text-muted" />
			<span class="row-label flex-1">New agent</span>
			<Icon of={ChevronRight} size={13} class="flex-none text-faint" />
		</button>
	);
	return (
		<>
			<div class="rule" aria-hidden="true" />
			<Popover placement="right-start" label="New agent" class="w-[248px]" trigger={trigger}>
				<AgentChoices onPick={(kind) => (p.m.timers.dismiss?.(), p.onNew(kind))} />
			</Popover>
		</>
	);
}
