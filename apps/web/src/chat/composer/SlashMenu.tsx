import type { SlashCommand } from "@decks/protocol";
import { createEffect, For, Show } from "solid-js";

/**
 * Fifty at a time.
 *
 * Claude Code declares around sixty commands once its skills and the project's own
 * `commands/` are counted, and pi adds its prompts and extensions on top — so an
 * unfiltered menu has a tail nobody will scroll to. The trade is that two letters reach
 * anything, which is cheaper than a list long enough to hold everything.
 */
const MAX_MATCHES = 50;

/**
 * Filter and rank: the exact name first, then prefixes, then substrings.
 *
 * The exact match is not a nicety. Claude offers both `/usage` and `/usage-credits` and
 * declares the longer one first, so a plain prefix filter had Enter send a different
 * command from the one typed out in full. Whatever else the ranking does, **what
 * somebody typed in full is what Enter picks.**
 *
 * Aliases are searched and not shown: `/stats` finds the command it resolves to, and the
 * row that comes back is the one the runtime will actually run.
 */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
	const needle = query.toLowerCase();
	if (!needle) return commands.slice(0, MAX_MATCHES);
	const exact: SlashCommand[] = [];
	const prefix: SlashCommand[] = [];
	const contains: SlashCommand[] = [];
	for (const command of commands) {
		const names = [command.name, ...(command.aliases ?? [])].map((name) => name.toLowerCase());
		if (names.includes(needle)) exact.push(command);
		else if (names.some((name) => name.startsWith(needle))) prefix.push(command);
		else if (names.some((name) => name.includes(needle))) contains.push(command);
	}
	return [...exact, ...prefix, ...contains].slice(0, MAX_MATCHES);
}

/**
 * What the badge at the end of a row says.
 *
 * `deck` is labelled with the app's name because that is the point of the badge: a
 * `/cost` that opens Decks' usage panel and a `/cost` the CLI would print are different
 * commands, and which one you are about to run is worth one word. The runtime's own are
 * labelled with whose runtime it is, so the same list read in a pi chat and a Claude chat
 * says who is answering.
 */
function badge(command: SlashCommand, runtime: string): string {
	switch (command.source) {
		case "deck":
			return "decks";
		case "skill":
			return "skill";
		case "prompt":
			return "prompt";
		case "extension":
			return "ext";
		case "runtime":
			return runtime;
		default:
			return "";
	}
}

/**
 * The `/` menu, above the composer.
 *
 * Picone's shape: a mono name, a one-line description that truncates, and a source badge
 * pushed to the end. What it adds over the list this replaced is the thing the hint row
 * under the box had been promising all along — a **selection**, moved with the arrows,
 * completed with Tab or Enter — which without a highlighted row was three keys that did
 * nothing.
 */
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
		const index = props.activeIndex;
		list?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
	});

	return (
		/*
			The menu floats *above* the whole composer stack rather than below it, because below
			is where the keyboard is on a phone and where the canvas is everywhere else — and
			above the stack rather than inside the controls row, because a completion list is
			about the text and not about the controls.

			`rowlist` rather than a private set of row rules: `[data-row][data-flat]` is the
			app's single-line menu row, hover wash and 30px minimum included, and a second
			spelling of it is how two lists that are meant to match stop matching.

			The full width of the box, which is picone's `inset-inline: 0` and not a
			preference: a hint is a sentence, and at 420px two thirds of them ended in an
			ellipsis. The box is what bounds it, so the menu is as wide as the thing it is
			completing and no wider.
		*/
		<div
			class="rowlist absolute bottom-[calc(100%+6px)] left-0 z-[12] max-h-[min(40vh,300px)] w-full overflow-y-auto rounded-panel border border-line bg-panel p-[5px] shadow-panel"
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
						<span class="flex-none font-mono text-[12px] text-accent">
							/{command.name}
							{command.arg ? ` ${command.arg}` : ""}
						</span>
						<Show when={command.hint}>
							<span class="min-w-0 flex-1 truncate text-[12px] text-muted">{command.hint}</span>
						</Show>
						<Show when={badge(command, props.runtime)}>
							{(label) => <span class="ml-auto flex-none text-[10px] tracking-wider text-faint uppercase">{label()}</span>}
						</Show>
					</button>
				)}
			</For>
		</div>
	);
}
