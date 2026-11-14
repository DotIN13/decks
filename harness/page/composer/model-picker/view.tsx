import type { AgentModel, ClaudeAccount, ModelOption, ThinkingLevel } from "@decks-next/protocol";
import FiveHour from "../../settings/index.ts";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Search from "lucide-solid/icons/search";
import Sparkles from "lucide-solid/icons/sparkles";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Icon, Popover } from "@decks/ui";
import { levelsFor, nearestLevel, optionFor } from "./model.ts";

/** Button three of three, inside the box: which model, and how hard it thinks. */
/** A maker's id as people write it: anthropic is Anthropic, openai is OpenAI. */
const MAKERS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", deepseek: "DeepSeek", openrouter: "OpenRouter", xai: "xAI", mistral: "Mistral", groq: "Groq" };
function makerName(id: string): string {
	return MAKERS[id.toLowerCase()] ?? (id ? id[0]!.toUpperCase() + id.slice(1) : id);
}

export function ModelPicker(props: {
	model: AgentModel | undefined;
	models: ModelOption[];
	/** `thinking` is the third argument the old signature did not have. */
	onModel: (provider: string, model: string, thinking?: ThinkingLevel) => void;
	onThinking: (level: ThinkingLevel) => void;
	/**
	 * The Claude subscriptions this install can use, and which one this conversation spends
	 * (`claude/accounts.ts`).
	 */
	accounts?: ClaudeAccount[];
	account?: string;
	onAccount?: (id: string) => void;
	/** The picker opened with the accounts in it: read their 5-hour figures again. */
	onAccountsOpen?: () => void;
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
		// name, one field for both questions, since nobody knows which they are asking.
		return props.models.filter((option) => `${option.provider}/${option.model}`.toLowerCase().includes(needle));
	});


	const pick = (option: ModelOption) => {
		// The level comes across only as far as the new model allows (`thinking.ts`).
		props.onModel(option.provider, option.model, nearestLevel(props.model?.thinking, levelsFor(option)));
		setFilter("");
		dismiss?.();
	};

	/** The makers in the list, in the order their first model appears, each capitalised as a label. */
	const makers = () => [...new Set(matches().map((option) => option.provider))];
	return (
		<Popover
			placement="top"
			// Opened: the accounts' 5-hour figures are about to be looked at, so they are read again.
			onOpenChange={(open) => open && (props.accounts?.length ?? 0) > 1 && props.onAccountsOpen?.()}
			/*
			 * 344 rather than 320: a little more room for a model name, which is what the card is mostly made
			 * of.
			 */
			class="w-[min(344px,calc(100vw-16px))]"
			label="Model and thinking level"
			trigger={(api) => {
				dismiss = () => {
					if (api.open) api.toggle();
				};
				return (
					<button
						ref={api.ref}
						/* `shrink-[100]`: when the row runs out of room, this is the chip that gives. */
						class="chip-button min-w-0 shrink-[100]"
						data-picker="model"
						type="button"
						disabled={props.disabled || props.models.length === 0}
						aria-haspopup="menu"
						aria-expanded={api.open}
						/* The name truncates in a narrow bar, so the whole of it stays reachable. */
						title={`${props.model?.provider ?? ""}${props.model ? "/" : ""}${label()}`}
						onClick={api.toggle}
					>
						<Icon of={Sparkles} size={13} />
						{/* 180px, which is about twenty-eight characters at 11px. */}
						<span class="max-w-[180px] truncate">{label()}</span>
						{/* The level only when there is one to show. "off" is a real answer and
						    stays; a model with no scale at all has nothing to say here. */}
						<Show when={levels().length > 0 ? props.model?.thinking : undefined}>
							{(level) => <span class="chip-sub">{level()}</span>}
						</Show>
						<Icon of={ChevronDown} size={10} class="chevron" />
					</button>
				);
			}}
		>
			{/*
			 * `mt-1.5`, because the field was 6px under the card's top edge, measurably, and visibly: a search
			 * box jammed against the edge of its own card reads as a mistake rather than as a tight layout.
			 */}
				{/* `m-1.5`: the thinking strip's own inset, applied on all four sides. */}
				<label class="field m-1.5 h-7">
				<Icon of={Search} size={13} class="shrink-0 text-faint" />
				<input
					/* No autofocus. */
					type="text"
					placeholder="Find a model"
					aria-label="Search models"
					value={filter()}
					onInput={(event) => setFilter(event.currentTarget.value)}
				/>
			</label>

			{/* The list, and its *height* has been wrong twice, in opposite directions. */}
			{/* `px-1.5`: the rows stand in from the card's edge as the search field and the subscription rows do. */}
			<div class="max-h-[min(33vh,300px)] overflow-y-auto px-1.5">
				<Show when={matches().length > 0} fallback={<p class="meta m-0 px-2 py-2.5">No model matches that</p>}>
					{/* By maker, each under its own label: the maker is said once, not on every row. */}
					<For each={makers()}>
						{(maker) => (
							<>
								<div class="menu-label">{makerName(maker)}</div>
								<For each={matches().filter((option) => option.provider === maker)}>
									{(option) => (
										<button
											data-row
											data-flat="true"
											data-current={isCurrent(option)}
											type="button"
											role="menuitemradio"
											aria-checked={isCurrent(option)}
											title={`${option.provider}/${option.label}`}
											onClick={() => pick(option)}
										>
											<span class="min-w-0 flex-1 truncate">{option.label}</span>
										</button>
									)}
								</For>
							</>
						)}
					</For>
				</Show>
			</div>

			{/* Only the levels this model accepts, and nothing at all when it has none, a row
			    explaining its own absence is noise in a card this small. */}
			<Show when={levels().length > 0}>
				<div class="rule" />
				{/*
				 * The label above the scale rather than beside it, which is where the mockup put it and where it
				 * did not fit: Decks offers seven levels where picone's mockup drew five, and a label plus seven
				 * words is wider than a 320px card.
				 */}
				<div class="px-1.5 py-1">
					<span class="menu-label" style={{ padding: "4px 2px 4px" }}>Thinking</span>
					<div class="segmented mt-1 w-full" data-scale="true">
						<For each={levels()}>
							{(level) => (
								<button
									/* `.segmented`'s buttons carry no side padding of their own, being sized by
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

			{/* Which subscription answers, for this conversation alone. */}
			<Show when={(props.accounts?.length ?? 0) > 1 && props.onAccount}>
				<div class="rule" />
				<div class="px-1.5 py-1">
					<span class="menu-label" style={{ padding: "4px 2px 4px" }}>Account</span>
					<div class="mt-1">
						<For each={props.accounts ?? []}>
							{(account) => (
								<button
									type="button"
									data-row
									data-flat="true"
									data-current={props.account === account.id ? "true" : undefined}
									/* Every signed-in row is choosable, and none of them says "spent". */
									title={account.signedIn ? undefined : "This account has no credentials behind it. Add it again in settings"}
									disabled={!account.signedIn}
									onClick={() => props.onAccount?.(account.id)}
								>
									<span class="row-label flex-1 truncate">{account.email ?? account.id}</span>
									<Show when={!account.signedIn} fallback={<FiveHour reading={account.fiveHour} />}>
										<span class="meta flex-none text-micro">signed out</span>
									</Show>
								</button>
							)}
						</For>
					</div>
				</div>
			</Show>
		</Popover>
	);
}
