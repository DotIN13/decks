import type { SlashCommand } from "@decks/protocol";
import { createEffect, For, Show } from "solid-js";
import { keepInView } from "./actions.ts";
import { badge } from "./model.ts";

/** The `/` menu, above the composer. */
export function SlashMenu(props: {
	commands: SlashCommand[];
	activeIndex: number;
	/** Which runtime is answering, so a runtime command is badged with whose it is. */
	runtime: string;
	onHover: (index: number) => void;
	onPick: (command: SlashCommand) => void;
}) {
	let list: HTMLDivElement | undefined;

	createEffect(() => {
		// Keep the highlighted row in view while arrowing through fifty of them.
		keepInView(list, props.activeIndex);
	});

	return (
		/*
		 * The menu floats *above* the whole composer stack rather than below it, because below is where the
		 * keyboard is on a phone and where the canvas is everywhere else, and above the stack rather than
		 * inside the controls row, because a completion list is about the text and not about the controls.
		 */
		<div
			class="row-list absolute bottom-[calc(100%+6px)] left-0 z-[12] max-h-[min(40vh,300px)] w-full overflow-y-auto rounded-panel border border-line bg-panel p-[5px] shadow-panel"
			ref={list}
			role="listbox"
			aria-label="Commands"
		>
			<For each={props.commands}>
				{(command, index) => (
					<button
						data-row
						data-flat="true"
						data-current={props.activeIndex === index()}
						data-index={index()}
						class="pointer-coarse:min-h-[40px]"
						type="button"
						role="option"
						aria-selected={props.activeIndex === index()}
						title={command.hint}
						onMouseEnter={() => props.onHover(index())}
						/* The field keeps focus, so picking with the mouse and then typing the
						   argument is one gesture rather than two. */
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => props.onPick(command)}
					>
						<span class="flex-none font-mono text-ui text-accent">
							/{command.name}
							{command.arg ? ` ${command.arg}` : ""}
						</span>
						<Show when={command.hint}>
							<span class="min-w-0 flex-1 truncate text-ui text-muted">{command.hint}</span>
						</Show>
						<Show when={badge(command, props.runtime)}>
							{(label) => <span class="ml-auto flex-none text-micro tracking-wider text-faint uppercase">{label()}</span>}
						</Show>
					</button>
				)}
			</For>
		</div>
	);
}
