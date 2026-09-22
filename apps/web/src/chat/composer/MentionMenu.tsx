import type { AgentChat, Identity } from "@decks/protocol";
import { createEffect, For, Show } from "solid-js";
import { AgentFace } from "../../chrome/AgentPill.tsx";

/** Somebody an `@` in the line can name: an agent, or the dispatcher, which has no chat of its own on the list. */
export interface Mentionable {
	name: string;
	/** On the canvas on screen. Off it, the note says the agent will join. */
	here: boolean;
	chat?: AgentChat;
	/** The dispatcher: named like an agent, but the line becomes a task. */
	task?: boolean;
}

const MAX = 8;

export function filterMentionables(all: Mentionable[], query: string): Mentionable[] {
	const needle = query.toLowerCase();
	const prefix = all.filter((one) => one.name.toLowerCase().startsWith(needle));
	const contains = needle ? all.filter((one) => !one.name.toLowerCase().startsWith(needle) && one.name.toLowerCase().includes(needle)) : [];
	return [...prefix, ...contains].slice(0, MAX);
}

/**
 * The `@` completion: the same rows the recipient chip's menu shows, under the caret's word.
 *
 * Built like `SlashMenu` and drawn where it is drawn — above the whole composer, the full
 * width of the box — because it is the same kind of thing: a list completing what is being
 * typed. Picking puts `@Name` into the line, and the chip follows the words from there,
 * because the bar reads the line (`destination()`) and not this menu.
 */
export function MentionMenu(props: {
	matches: Mentionable[];
	identities: Record<string, Identity>;
	activeIndex: number;
	canvasName?: string;
	onHover: (index: number) => void;
	onPick: (one: Mentionable) => void;
}) {
	let list: HTMLDivElement | undefined;
	createEffect(() => {
		const index = props.activeIndex;
		list?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
	});
	return (
		<div
			ref={list}
			class="rowlist mention-menu absolute bottom-[calc(100%+6px)] left-0 z-[12] max-h-[min(40vh,300px)] w-full overflow-y-auto rounded-panel border border-line bg-panel p-[5px] shadow-panel"
			role="listbox"
			aria-label="Who to name"
		>
			<For each={props.matches}>
				{(one, index) => (
					<button
						type="button"
						role="option"
						data-row
						data-flat="true"
						data-index={index()}
						data-current={index() === props.activeIndex ? "true" : undefined}
						aria-selected={index() === props.activeIndex}
						onMouseEnter={() => props.onHover(index())}
						// Down, not click: a click waits for mouseup, by which time the field has lost focus and the menu is gone.
						onPointerDown={(event) => {
							event.preventDefault();
							props.onPick(one);
						}}
					>
						<Show when={one.chat} fallback={<span class="mention-mark" aria-hidden="true">D</span>}>
							{(chat) => <AgentFace chat={chat()} identity={props.identities[chat().id]} size={20} ring={1.5} />}
						</Show>
						<span class="lb nm block truncate">{one.name}</span>
						<Show when={one.chat && !one.task}>{(_) => <span class="kind">{one.chat!.kind}</span>}</Show>
						<span class="meta flex-none text-[10px]">{one.task ? "as a task" : one.here ? "here" : props.canvasName ? `joins ${props.canvasName}` : "elsewhere"}</span>
					</button>
				)}
			</For>
		</div>
	);
}
