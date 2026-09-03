import type { AgentModel, ModelOption, ThinkingLevel } from "@decks/protocol";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Search from "lucide-solid/icons/search";
import Sparkles from "lucide-solid/icons/sparkles";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Icon } from "../../icons.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { levelsFor, nearestLevel, optionFor } from "./thinking.ts";

/**
 * Button three of three, inside the box: which model, and how hard it thinks.
 *
 * One chip carrying two facts — the sparkle, the model's name, and the thinking level in
 * faint beside it — because they are one decision made in one place, and because the
 * alternative was what this replaces: two native `<select>`s, whose platform chevrons were
 * the least Decks-like thing on screen and which read as a settings form bolted under the
 * input rather than as part of it.
 *
 * The popover is picone's: a search field over a list of `provider/id` rows, a rule, and
 * the thinking scale as a row of chips underneath. The search field earns its place from
 * the list it filters — a deck with three providers signed in offers a few dozen models,
 * and `gpt-4` exists under three of them.
 */
export function ModelPicker(props: {
	model: AgentModel | undefined;
	models: ModelOption[];
	/**
	 * `thinking` is the third argument the old signature did not have.
	 *
	 * It carries what `nearestLevel` worked out, so the model and the level change in one
	 * message — `agent.setModel` already takes an optional `thinking`, and sending it
	 * separately afterwards would run one turn's worth of race between the two.
	 */
	onModel: (provider: string, model: string, thinking?: ThinkingLevel) => void;
	onThinking: (level: ThinkingLevel) => void;
	disabled?: boolean;
}) {
	const [filter, setFilter] = createSignal("");
	let dismiss: (() => void) | undefined;

	/** What the running model can be asked for, which is not always all seven levels. */
	const levels = createMemo(() => levelsFor(optionFor(props.models, props.model)));
	const isCurrent = (option: ModelOption) => props.model?.provider === option.provider && props.model?.model === option.model;

	/** The label the chip shows: the model's own name, not `provider/name`, which is twice
	 *  as long and disambiguates something the list already disambiguates. */
	const label = () => optionFor(props.models, props.model)?.label ?? props.model?.model ?? "default model";

	const matches = createMemo(() => {
		const needle = filter().toLowerCase().trim();
		if (!needle) return props.models;
		// Over `provider/id`, so typing "anthropic" narrows to a provider and "opus" to a
		// name — one field for both questions, since nobody knows which they are asking.
		return props.models.filter((option) => `${option.provider}/${option.model}`.toLowerCase().includes(needle));
	});

	const pick = (option: ModelOption) => {
		// The level comes across only as far as the new model allows (`thinking.ts`).
		props.onModel(option.provider, option.model, nearestLevel(props.model?.thinking, levelsFor(option)));
		setFilter("");
		dismiss?.();
	};

	return (
		<Popover
			placement="top"
			class="w-[min(320px,calc(100vw-16px))]"
			label="Model and thinking level"
			trigger={(api) => {
				dismiss = () => {
					if (api.open) api.toggle();
				};
				return (
					<button
						ref={api.ref}
						class="chipbtn min-w-0"
						type="button"
						disabled={props.disabled || props.models.length === 0}
						aria-haspopup="menu"
						aria-expanded={api.open}
						/* The name truncates in a narrow bar, so the whole of it stays reachable. */
						title={`${props.model?.provider ?? ""}${props.model ? "/" : ""}${label()}`}
						onClick={api.toggle}
					>
						<Icon of={Sparkles} size={13} />
						<span class="truncate">{label()}</span>
						{/* The level only when there is one to show. "off" is a real answer and
						    stays; a model with no scale at all has nothing to say here. */}
						<Show when={levels().length > 0 ? props.model?.thinking : undefined}>
							{(level) => <span class="sub max-[470px]:hidden">{level()}</span>}
						</Show>
						<Icon of={ChevronDown} size={10} class="chev" />
					</button>
				);
			}}
		>
			<label class="field mb-1 h-7">
				<Icon of={Search} size={13} class="shrink-0 text-faint" />
				<input
					ref={(el) => {
						/*
						 * Two frames, matching `Popover`'s own placement pass.
						 *
						 * The card is `visibility: hidden` until it has been measured and put in
						 * its corner, and a hidden element cannot take focus — `onMount` focused
						 * nothing at all and the search field looked broken on a keyboard.
						 */
						onMount(() => requestAnimationFrame(() => requestAnimationFrame(() => el.focus())));
					}}
					type="text"
					placeholder="Search models"
					aria-label="Search models"
					value={filter()}
					onInput={(event) => setFilter(event.currentTarget.value)}
				/>
			</label>

			<div class="flex max-h-[220px] flex-col overflow-y-auto">
				<Show when={matches().length > 0} fallback={<p class="meta m-0 px-2 py-2.5">No model matches that</p>}>
					<For each={matches()}>
						{(option) => (
							<button
								data-row
								data-flat="true"
								data-current={isCurrent(option)}
								type="button"
								role="menuitemradio"
								aria-checked={isCurrent(option)}
								onClick={() => pick(option)}
							>
								<span class="pv">{option.provider}</span>
								<span class="min-w-0 flex-1 truncate">{option.label}</span>
								<Show when={isCurrent(option)}>
									<Icon of={Check} size={13} class="shrink-0 text-accent" />
								</Show>
							</button>
						)}
					</For>
				</Show>
			</div>

			{/* Only the levels this model accepts, and nothing at all when it has none — a row
			    explaining its own absence is noise in a card this small. */}
			<Show when={levels().length > 0}>
				<div class="rule" />
				{/*
					The label above the scale rather than beside it, which is where the mockup put
					it and where it did not fit: Decks offers seven levels where picone's mockup
					drew five, and a label plus seven words is wider than a 320px card. Given its
					own line the row becomes what it actually is — a scale from `off` to `max`,
					evenly divided, read left to right.
				*/}
				<div class="px-2 py-1">
					<span class="meta">Thinking</span>
					<div class="seg mt-1 w-full" data-scale="true">
						<For each={levels()}>
							{(level) => (
								<button
									/* `.seg`'s buttons carry no side padding of their own, being sized by
									   the row they divide; seven words at 10px need it or the scale reads
									   as one long run rather than as seven chips. */
									class="px-1.5"
									type="button"
									data-on={props.model?.thinking === level}
									aria-pressed={props.model?.thinking === level}
									onClick={() => props.onThinking(level)}
								>
									{level}
								</button>
							)}
						</For>
					</div>
				</div>
			</Show>
		</Popover>
	);
}
