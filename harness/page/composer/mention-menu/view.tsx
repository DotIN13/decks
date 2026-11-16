import type { Identity } from "@decks/protocol";
import { createEffect, For } from "solid-js";
import { AgentFace } from "../../agents/index.ts";
import { keepInView } from "./actions.ts";
import type { Mentionable } from "./model.ts";

// The @ menu: the agents an @ can name, under the caret's word.

export type { Mentionable };

/** The `@` completion: the same rows the recipient chip's menu shows, under the caret's word. */
export function MentionMenu(props: {
	matches: Mentionable[];
	identities: Record<string, Identity>;
	activeIndex: number;
	onHover: (index: number) => void;
	onPick: (one: Mentionable) => void;
}) {
	let list: HTMLDivElement | undefined;
	createEffect(() => {
		keepInView(list, props.activeIndex);
	});
	return (
		<div
			ref={list}
			class="row-list mention-menu absolute bottom-[calc(100%+6px)] left-0 z-[12] max-h-[min(40vh,300px)] w-full overflow-y-auto rounded-panel border border-line bg-panel p-[5px] shadow-panel"
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
						<AgentFace chat={one.chat} identity={props.identities[one.chat.id]} size={20} ring={1.5} />
						<span class="row-label row-name block truncate">{one.name}</span>
						<span class="kind">{one.chat.kind}</span>
					</button>
				)}
			</For>
		</div>
	);
}
