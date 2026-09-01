import type { AgentMode, AgentModel, AgentUsage, ModelOption, SlashCommand, ThinkingLevel } from "@decks/protocol";
import ArrowUp from "lucide-solid/icons/arrow-up";
import Square from "lucide-solid/icons/square";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Icon } from "../icons.tsx";

const THINKING: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** What each mode means to someone deciding, rather than the CLI's own word for it. */
const LABEL: Record<AgentMode, string> = {
	manual: "ask first",
	acceptEdits: "edit freely",
	plan: "plan only",
	auto: "auto",
};

/**
 * The input bar, floating over the canvas.
 *
 * Enter sends and Shift+Enter makes a newline, which is the convention people
 * arrive with. The send button becomes the stop button while the agent is working,
 * because they are the same intention — "the thing I want is not what is happening"
 * — and one control that changes meaning is easier to hit than two that swap places.
 */
export function Composer(props: {
	busy: boolean;
	model: AgentModel | undefined;
	models: ModelOption[];
	/** What `/` completes to on the focused agent's runtime. */
	commands: SlashCommand[];
	usage: AgentUsage | undefined;
	/** Clicking the meter: the runtime's usage in a modal. */
	onUsage: () => void;
	/**
	 * What the agent's runtime asks before acting, and the modes it has.
	 *
	 * Empty for Pi, where permissions are an extension's business (§6.8), so the control
	 * is absent rather than present and inert.
	 */
	modes: AgentMode[];
	mode: AgentMode | undefined;
	onMode: (mode: AgentMode) => void;
	onSend: (text: string) => void;
	onAbort: () => void;
	onModel: (provider: string, model: string) => void;
	onThinking: (level: ThinkingLevel) => void;
}) {
	const [text, setText] = createSignal("");
	let input!: HTMLTextAreaElement;
	let picker!: HTMLSelectElement;

	/** A draft that is exactly `/` followed by a command fragment, while nothing is typed after it. */
	const SLASH = /^\/([a-z0-9_-]*)$/i;
	const fragment = createMemo(() => {
		const match = SLASH.exec(text());
		return match ? match[1]!.toLowerCase() : "";
	});
	const matches = createMemo(() => {
		// Only a draft that actually starts with `/` is a command draft; anything
		// else is prose and gets no menu.
		if (!text().startsWith("/")) return [];
		if (!fragment()) return props.commands;
		return props.commands.filter((command) => command.name.startsWith(fragment()));
	});
	const menuOpen = createMemo(() => matches().length > 0);

	const pick = (command: SlashCommand) => {
		// The argument placeholder stays for them to type over; a bare command sends
		// fine as-is.
		const value = `/${command.name}${command.arg ? ` ${command.arg}` : " "}`;
		setText(value);
		input.value = value;
		input.focus();
	};

	const send = () => {
		// Enter with a command menu open completes the command instead of sending the
		// fragment — "/lo" Enter is "login", not an unknown command. A command typed
		// in full is already exact, so Enter sends it.
		const menu = matches();
		if (menu.length > 0 && menu[0]!.name !== fragment()) {
			pick(menu[0]!);
			return;
		}
		const value = text().trim();
		if (!value) return;
		props.onSend(value);
		setText("");
		input.value = "";
	};

	const current = () => (props.model ? `${props.model.provider}/${props.model.model}` : "");

	/*
	 * A `<select>` whose value is set while its options are still being created keeps
	 * the first option instead — so the picker read "GPT-4" while the agent was on
	 * something else entirely. Setting it after both have settled is the fix, and it
	 * has to depend on the list as well as the value.
	 */
	createEffect(() => {
		const value = current();
		props.models.length;
		if (picker && value) picker.value = value;
	});

	const reasoning = () =>
		props.models.find((option) => option.provider === props.model?.provider && option.model === props.model?.model)?.reasoning ?? true;

	/**
	 * Grouped by provider, because a flat list of a hundred models is not a list.
	 *
	 * The provider is also the disambiguator: `gpt-4` exists under three of them, and
	 * the model name alone does not say which one a turn will be billed to.
	 */
	const byProvider = createMemo(() => {
		const groups = new Map<string, ModelOption[]>();
		for (const option of props.models) {
			const group = groups.get(option.provider) ?? [];
			group.push(option);
			groups.set(option.provider, group);
		}
		return [...groups].sort(([a], [b]) => a.localeCompare(b));
	});

	return (
		// `composer` stays: the narrow-width rules and the `(pointer: coarse)` sizing find it.
		<section class="panel-float composer relative w-auto transform-none p-2">
			<Show when={menuOpen()}>
				{/*
					The menu floats *above* the bar rather than below it, because below is where the
					keyboard is on a phone and where the canvas is everywhere else.
				*/}
				<div
					class="absolute bottom-[calc(100%+6px)] left-2 z-[12] flex max-h-[230px] w-[min(360px,calc(100%-16px))] flex-col gap-0.5 overflow-y-auto rounded-panel border border-line bg-panel p-[5px] shadow-panel backdrop-blur-md"
					role="listbox"
					aria-label="Commands"
				>
					<For each={matches()}>
						{(command) => (
							<button
								class="flex cursor-pointer items-baseline gap-2.5 rounded-control border-0 bg-transparent px-[9px] py-[7px] text-left text-[13px] text-fg hover:bg-line"
								type="button"
								role="option"
								title={command.hint}
								onClick={() => pick(command)}
							>
								<span class="flex-none font-mono text-accent">/{command.name}{command.arg ? ` ${command.arg}` : ""}</span>
								<Show when={command.hint}>
									<span class="overflow-hidden text-[12px] text-ellipsis whitespace-nowrap text-muted">{command.hint}</span>
								</Show>
							</button>
						)}
					</For>
				</div>
			</Show>

			<textarea
				/*
				 * 16px on a touch keyboard or the browser zooms the page when the field takes
				 * focus, which leaves the canvas at a scale nobody chose and the chrome half
				 * off screen.
				 */
				class="block max-h-[180px] w-full resize-none border-0 bg-none px-1.5 py-1 text-[13px] text-fg pointer-coarse:text-[16px] [field-sizing:content]"
				ref={input}
				rows="1"
				// The field had no accessible name at all; the placeholder is not one.
				aria-label="Message this agent"
				placeholder="Draft something on a board, or ask…"
				value={text()}
				onInput={(event) => setText(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						setText("");
						input.value = "";
						return;
					}
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						send();
					}
				}}
			/>

			{/* `controls` stays: the narrow-width rule stops it wrapping onto a second row. */}
			<div class="controls flex items-center gap-1.5 pt-1.5">
				<select
					ref={picker}
					value={current()}
					title="Model"
					onChange={(event) => {
						const [provider, ...rest] = event.currentTarget.value.split("/");
						if (provider && rest.length > 0) props.onModel(provider, rest.join("/"));
					}}
				>
					<Show when={props.models.length === 0}>
						<option value="">no models</option>
					</Show>
					<For each={byProvider()}>
						{([provider, options]) => (
							<optgroup label={provider}>
								<For each={options}>
									{(option) => <option value={`${option.provider}/${option.model}`}>{option.label}</option>}
								</For>
							</optgroup>
						)}
					</For>
				</select>

				<Show when={reasoning()}>
					<select
						value={props.model?.thinking ?? "medium"}
						title="Thinking level"
						onChange={(event) => props.onThinking(event.currentTarget.value as ThinkingLevel)}
					>
						<For each={THINKING}>{(level) => <option value={level}>{level}</option>}</For>
					</select>
				</Show>

				<Show when={props.modes.length > 0}>
					<select
						class="mode"
						value={props.mode ?? "acceptEdits"}
						title="How much this agent asks before acting"
						onChange={(event) => props.onMode(event.currentTarget.value as AgentMode)}
					>
						<For each={props.modes}>{(mode) => <option value={mode}>{LABEL[mode]}</option>}</For>
					</select>
				</Show>

				<span class="flex-1" />

				<Show when={props.usage?.contextTokens != null && props.usage!.contextWindow > 0}>
					<button class="usage" type="button" title="Session usage — click for details" onClick={props.onUsage}>
						{Math.round((props.usage!.contextTokens! / props.usage!.contextWindow) * 100)}% ctx
						{props.usage!.cost > 0 ? ` · $${props.usage!.cost.toFixed(3)}` : ""}
					</button>
				</Show>

				{/*
				 * One control, two meanings, and the icon is whichever one applies: an arrow
				 * up out of the box you have just typed in, or the square that means stop
				 * everywhere else. The words "send" and "stop" said the same thing in a
				 * different alphabet from the rest of the chrome. `data-busy` still carries
				 * the state, so the colour and the browser checks are unchanged.
				 */}
				<button
					class="send"
					type="button"
					data-busy={props.busy}
					title={props.busy ? "Stop this turn" : "Send"}
					aria-label={props.busy ? "Stop this turn" : "Send"}
					onClick={() => (props.busy ? props.onAbort() : send())}
				>
					{props.busy ? <Icon of={Square} size={14} /> : <Icon of={ArrowUp} size={16} />}
				</button>
			</div>
		</section>
	);
}
