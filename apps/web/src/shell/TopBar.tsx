import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Layers from "lucide-solid/icons/layers";
import PanelLeftOpen from "lucide-solid/icons/panel-left-open";
import { Show, untrack, type JSX } from "solid-js";
import { AgentFace, AgentMenu } from "../agents/AgentPill.tsx";
import { Switcher } from "../connections/Switcher.tsx";
import { Icon } from "@decks/ui";
import { m } from "@decks/i18n";

/**
 * The bar at the top left: whose canvas this is, and which canvas.
 *
 * With the side panel folded it also carries the way back to it and the deck's mark, which the
 * panel's head holds while it is open. Then the agent, as one chip (its face and its name, opening
 * the agent list; not its runtime, which the agent list says), a hairline, the canvas (opening the
 * canvas manager), and a `+` for a new canvas. On a phone the `+` gives its room to the canvas's
 * name, which moves to the right end of the bar.
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
	/** The mark before the name: a touch bar's chip names the tab in front, by its kind's own. Left out, the canvas's. */
	mark?: () => JSX.Element;
	onStages?: () => void;
	stagesOpen?: boolean;
	/** A touch bar's chip: whether a canvas is in front, and what a press does while a card, a document or an app is. With a canvas in front a press opens the canvas list. */
	canvas?: { front: boolean; show: () => void };
	/** The tabs and the + that opens one (`tabs/TabStrip.tsx`). */
	tabs?: JSX.Element;
	/** A desktop's bar: the tabs are a row, the canvas among them, so the bar draws no chip of its own. A touch bar's chip names the tab in front. */
	row?: boolean;
	viewOnly?: string;
	onCopy?: () => void;
	/** The phone's bar: full width, the canvas at the right end. */
	phone?: boolean;
	/** The canvas switcher around a touch bar's chip; left out, the chip opens the canvas manager. */
	canvasMenu?: (trigger: (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element) => JSX.Element;
	/** On a desktop the deck lives in the panel's head, so folded the bar brings back only the panel. */
	desktop?: boolean;
}) {
	const active = () => props.chats.find((chat) => chat.id === props.focused);
	const name = () => {
		const chat = active();
		return chat ? (props.identities[chat.id]?.name ?? chat.name) : undefined;
	};

	return (
		<div class="v3-bar v3-topbar float pill" data-inset="top" data-phone={props.phone ? "true" : undefined}>
			<Show when={!props.panelOpen}>
				<Show
					when={props.desktop}
					fallback={
						<>
							<button type="button" class="v3-icon v3-unfold" data-tip={m.shell_show_panel()} data-key="⌘\" aria-label={m.shell_show_panel()} onClick={() => props.onTogglePanel()}>
								<Icon of={PanelLeftOpen} size={17} />
							</button>
							<span class="v3-deck">
								<Switcher />
							</span>
						</>
					}
				>
					{/* The panel folded on a desktop: one drawer-open button that brings it back on its last tab. */}
					<button type="button" class="v3-icon v3-unfold" data-tip={m.shell_show_panel()} data-key="⌘\" aria-label={m.shell_show_panel()} onClick={() => props.onTogglePanel()}>
						<Icon of={PanelLeftOpen} size={17} />
					</button>
				</Show>
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
				label={m.shell_agents()}
				trigger={(api) => (
					<button
						type="button"
						class="v3-agent-chip"
						ref={api.ref}
						aria-haspopup="menu"
						aria-expanded={api.open}
						data-open={api.open ? "true" : undefined}
						data-tip={m.shell_switch_agent()}
						aria-label={name() ? m.shell_agents_current({ name: name()! }) : m.shell_agents()}
						onClick={api.toggle}
					>
						<Show when={active()} fallback={<span class="v3-agent-name">{m.shell_no_agent()}</span>}>
							{(chat) => <AgentFace chat={chat()} identity={props.identities[chat().id]} unread={props.unread[chat().id] ?? 0} size={22} ring={1.5} />}
						</Show>
						<Show when={name()}>{(label) => <span class="v3-agent-name">{label()}</span>}</Show>
						<Icon of={ChevronDown} size={13} class="v3-chev" />
					</button>
				)}
			/>
			<Show when={props.onStages}>
				<span class="v3-sep" aria-hidden="true" data-phone-hide />
				<Show when={props.phone}>
					<span class="flex-1" />
				</Show>
				{/* A desktop's bar draws no chip of its own: the canvas is a tab in the row like the others (`tabs/TabStrip.tsx`). */}
				<Show when={!props.row}>
					<TouchChip stage={props.stage} mark={props.mark} canvas={props.canvas} stagesOpen={props.stagesOpen} onStages={props.onStages} canvasMenu={props.canvasMenu} />
				</Show>
				{/*
				 * The tabs and the + that opens one (`tabs/TabStrip.tsx`). Read once: this bar's props are
				 * merged from parts that follow the canvas list, so read where it is tracked the row would
				 * be built again on every canvases frame, and a tab's open menu would vanish under the pointer.
				 * The row reads what changes itself.
				 */}
				{untrack(() => props.tabs)}
				<Show when={props.viewOnly}>
					{(owner) => (
						<button type="button" class="v3-viewonly" title={m.shell_view_only_title({ owner: owner() })} onClick={() => props.onCopy?.()}>
							{m.shell_view_only()}
						</button>
					)}
				</Show>
			</Show>
		</div>
	);
}

/** What a canvas menu is opened from, as the menu's owner hands it to the button. */
type MenuTrigger = { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void };

/**
 * A touch bar's one chip: the name of what is in front, with its kind's mark. With a canvas in front
 * a press opens the canvas list (the switcher where it is given, the canvas manager otherwise); with
 * a card, a document or an app in front it does what `canvas.show` says, which opens the tabs.
 */
function TouchChip(props: { stage: string | undefined; mark: (() => JSX.Element) | undefined; canvas: { front: boolean; show: () => void } | undefined; stagesOpen: boolean | undefined; onStages: (() => void) | undefined; canvasMenu: ((trigger: (api: MenuTrigger) => JSX.Element) => JSX.Element) | undefined }): JSX.Element {
	const chip = (popover?: MenuTrigger) => (
		<button
			type="button"
			class="v3-canvas-chip"
			ref={popover?.ref}
			data-open={(popover ? popover.open : props.stagesOpen) ? "true" : undefined}
			aria-haspopup={popover ? "menu" : "dialog"}
			aria-expanded={popover ? popover.open : (props.stagesOpen ?? false)}
			data-tip={m.shell_canvases()}
			aria-label={props.stage ? m.shell_canvases_current({ name: props.stage }) : m.shell_canvases_none()}
			data-front={props.canvas && !props.canvas.front ? undefined : "true"}
			onClick={() => (props.canvas && !props.canvas.front ? props.canvas.show() : popover ? popover.toggle() : props.onStages?.())}
		>
			<Show when={props.mark} fallback={<Icon of={Layers} size={16} />}>
				{props.mark!()}
			</Show>
			<span class="v3-canvas-name">{props.stage ?? m.shell_no_canvas()}</span>
			<Icon of={ChevronDown} size={13} class="v3-chev" />
		</button>
	);
	/*
	 * `canvasMenu` comes as a fresh function each time the canvas list changes, so only whether it
	 * is given may rebuild the chip: built again on every canvases frame, the chip and its open menu
	 * would vanish under the pointer. The switcher reads the list itself, so the first one keeps up.
	 */
	return (
		<Show when={props.canvasMenu !== undefined} fallback={chip()}>
			{untrack(() => props.canvasMenu!((popover) => chip(popover)))}
		</Show>
	);
}
