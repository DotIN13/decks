import type { AgentChat, Identity } from "@decks/protocol";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronsDownUp from "lucide-solid/icons/chevrons-down-up";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import { onMount, Show, type JSX } from "solid-js";
import { AgentFace } from "../../agents/index.ts";
import { Icon } from "@decks/ui";
import { keyResize, resetHeight, restoreHeight, revealSheet, startResize, startSheetDrag, type SectionHost } from "./actions.ts";
import { foldWords, stateWords } from "./model.ts";

// The conversation as the lower half of the side panel or the phone's sheet,
// and the pill over the composer that says what the agent is doing while it is out of sight.

export { stateWords };

/**
 * The conversation, as the lower half of the side panel: whose it is and what it is doing, then the
 * turns. Folded, it is one line pinned to the panel's foot that says how many turns arrived since, and
 * opens again.
 */
export function ChatSection(props: {
	chat: AgentChat | undefined;
	identity: Identity | undefined;
	unread: number;
	folded: boolean;
	onFold: (folded: boolean, gone?: boolean) => void;
	sheet?: boolean;
	/** On a phone: the pill the sheet opens out of. The sheet uncovers its history from that shape, rather than scaling it. */
	from?: DOMRect;
	/** On a phone: the sheet is on its way out. */
	leaving?: boolean;
	children: JSX.Element;
}) {
	let section: HTMLElement | undefined;
	// The conversation's height in the panel is the person's: the line above it is a handle.
	const host: SectionHost = { section: () => section, folded: () => props.folded, sheet: () => !!props.sheet, onFold: (f, gone) => props.onFold(f, gone) };
	onMount(() => restoreHeight(host));
	onMount(() => props.sheet && revealSheet(section, props.from));
	const fold = () => foldWords({ sheet: props.sheet, folded: props.folded });
	const name = () => props.identity?.name ?? props.chat?.name ?? "No agent";
	return (
		<section ref={section} class="v3-chat" data-leaving={props.leaving ? "true" : undefined} data-folded={props.folded ? "true" : undefined} data-sheet={props.sheet ? "true" : undefined} aria-label="The conversation" onPointerDown={(event) => startSheetDrag(host, event)}>
			<Show when={props.sheet}>
				<span class="v3-sheet-handle" aria-hidden="true" />
			</Show>
			<Show when={!props.sheet && !props.folded}>
				<div
					class="v3-chat-resize"
					role="separator"
					aria-orientation="horizontal"
					aria-label="Conversation height"
					tabindex="0"
					onPointerDown={(event) => startResize(host, event)}
					onKeyDown={(event) => keyResize(host, event)}
					onDblClick={() => resetHeight(host)}
				/>
			</Show>
			<div class="v3-chat-head">
				<Show when={props.chat}>{(chat) => <AgentFace chat={chat()} identity={props.identity} unread={props.unread} size={24} ring={1.5} />}</Show>
				<button type="button" class="v3-chat-title" title={fold().label} onClick={() => props.onFold(!props.folded)}>
					<span class="v3-chat-name">{name()}</span>
					<Show when={props.chat && stateWords(props.chat.state, name())}>{(words) => <span class="v3-chat-state">{words()}</span>}</Show>
				</button>
				<span class="flex-1" />
				<button
					type="button"
					class="v3-icon"
					aria-expanded={!props.folded}
					data-tip={fold().tip}
					aria-label={fold().label}
					onClick={() => props.onFold(!props.folded)}
				>
					<Icon of={props.sheet ? ChevronDown : props.folded ? ChevronsUpDown : ChevronsDownUp} size={16} />
				</button>
			</div>
			<div class="v3-chat-body">{props.children}</div>
		</section>
	);
}

/**
 * The agent's state as a pill over the composer, while the conversation is out of sight: "✻ Loom
 * is running tools…". Pressing it shows the conversation.
 */
export function StatusPill(props: { chat: AgentChat | undefined; identity: Identity | undefined; onOpen: () => void }) {
	const name = () => props.identity?.name ?? props.chat?.name ?? "";
	const words = () => (props.chat ? stateWords(props.chat.state, name()) : undefined);
	return (
		<Show when={words()}>
			{(said) => (
				<button type="button" class="v3-status float" data-waiting={props.chat?.state === "waiting" ? "true" : undefined} title="Show the conversation" onClick={() => props.onOpen()} aria-live="polite">
					<span class="v3-status-sign" aria-hidden="true">
						✻
					</span>
					<span class="truncate">
						{name()} is {said()}
					</span>
				</button>
			)}
		</Show>
	);
}
