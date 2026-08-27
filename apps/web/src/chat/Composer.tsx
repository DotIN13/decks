import type { AgentModel, AgentUsage, ModelOption, ThinkingLevel } from "@decks/protocol";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

const THINKING: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

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
	usage: AgentUsage | undefined;
	onSend: (text: string) => void;
	onAbort: () => void;
	onModel: (provider: string, model: string) => void;
	onThinking: (level: ThinkingLevel) => void;
}) {
	const [text, setText] = createSignal("");
	let input!: HTMLTextAreaElement;
	let picker!: HTMLSelectElement;

	const send = () => {
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
		<section class="panel-float composer">
			<textarea
				ref={input}
				rows="1"
				placeholder="Draft something on a board, or ask…"
				value={text()}
				onInput={(event) => setText(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						send();
					}
				}}
			/>

			<div class="controls">
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

				<span class="spacer" />

				<Show when={props.usage?.contextTokens != null && props.usage!.contextWindow > 0}>
					<span class="usage">
						{Math.round((props.usage!.contextTokens! / props.usage!.contextWindow) * 100)}% ctx
						{props.usage!.cost > 0 ? ` · $${props.usage!.cost.toFixed(3)}` : ""}
					</span>
				</Show>

				<button
					class="send"
					type="button"
					data-busy={props.busy}
					onClick={() => (props.busy ? props.onAbort() : send())}
				>
					{props.busy ? "stop" : "send"}
				</button>
			</div>
		</section>
	);
}
