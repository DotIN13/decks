import type { AgentModel, ClaudeAccount, ModelOption, ThinkingLevel } from "@decks/protocol";
import { agentUiHost } from "../host.ts";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Search from "lucide-solid/icons/search";
import Sparkles from "lucide-solid/icons/sparkles";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Icon, Popover } from "@decks/ui";
import { pickModel } from "./actions.ts";
import { isCurrent, levelsFor, makerName, makersOf, matchModels, modelLabel, optionFor } from "./model.ts";

// The model chip and its card: which model, how hard it thinks, and which account it spends.

/** What the shell gives the model chip. */
export interface ModelPickerProps {
	model: AgentModel | undefined;
	models: ModelOption[];
	/** `thinking` is what the nearest-level rule kept when the model changed under it. */
	onModel: (provider: string, model: string, thinking?: ThinkingLevel) => void;
	onThinking: (level: ThinkingLevel) => void;
	/** The Claude subscriptions this install can use, and which one this conversation spends. */
	accounts?: ClaudeAccount[];
	account?: string;
	onAccount?: (id: string) => void;
	/** The picker opened with the accounts in it: read their 5-hour figures again. */
	onAccountsOpen?: () => void;
	disabled?: boolean;
}

/** Button three of three, inside the box: which model, and how hard it thinks. */
export function ModelPicker(props: ModelPickerProps) {
	const [filter, setFilter] = createSignal("");
	let dismiss: (() => void) | undefined;
	/** What the running model can be asked for, which is not always all seven levels. */
	const levels = createMemo(() => levelsFor(optionFor(props.models, props.model)));
	const matches = createMemo(() => matchModels(props.models, filter()));
	const pick = (option: ModelOption) =>
		pickModel(option, props.model?.thinking, props.onModel, () => {
			setFilter("");
			dismiss?.();
		});
	return (
		<Popover
			placement="top"
			// Opened: the accounts' 5-hour figures are about to be looked at, so they are read again.
			onOpenChange={(open) => open && (props.accounts?.length ?? 0) > 1 && props.onAccountsOpen?.()}
			class="w-[min(344px,calc(100vw-16px))]"
			label="Model and thinking level"
			trigger={(api) => {
				dismiss = () => {
					if (api.open) api.toggle();
				};
				return <ModelChip api={api} props={props} levels={levels()} />;
			}}
		>
			<label class="field m-1.5 h-7">
				<Icon of={Search} size={13} class="shrink-0 text-faint" />
				<input type="text" placeholder="Find a model" aria-label="Search models" value={filter()} onInput={(event) => setFilter(event.currentTarget.value)} />
			</label>
			<ModelList matches={matches()} model={props.model} onPick={pick} />
			{/* Only the levels this model accepts, and nothing at all when it has none. */}
			<Show when={levels().length > 0}>
				<div class="rule" />
				<ThinkingScale levels={levels()} current={props.model?.thinking} onThinking={props.onThinking} />
			</Show>
			{/* Which subscription answers, for this conversation alone. */}
			<Show when={(props.accounts?.length ?? 0) > 1 && props.onAccount}>
				<div class="rule" />
				<AccountRows accounts={props.accounts ?? []} account={props.account} onAccount={(id) => props.onAccount?.(id)} />
			</Show>
		</Popover>
	);
}

type TriggerApi = { ref: (el: HTMLElement) => void; open: boolean; toggle: () => void };

/** The chip: the model's own name, truncated with its whole name as the title, and the level when there is a scale. */
function ModelChip(p: { api: TriggerApi; props: ModelPickerProps; levels: readonly ThinkingLevel[] }) {
	const label = () => modelLabel(p.props.models, p.props.model);
	return (
		<button
			ref={p.api.ref}
			/* `shrink-[100]`: when the row runs out of room, this is the chip that gives. */
			class="chip-button min-w-0 shrink-[100]"
			data-picker="model"
			type="button"
			disabled={p.props.disabled || p.props.models.length === 0}
			aria-haspopup="menu"
			aria-expanded={p.api.open}
			title={`${p.props.model?.provider ?? ""}${p.props.model ? "/" : ""}${label()}`}
			onClick={p.api.toggle}
		>
			<Icon of={Sparkles} size={13} />
			<span class="max-w-[180px] truncate">{label()}</span>
			<Show when={p.levels.length > 0 ? p.props.model?.thinking : undefined}>{(level) => <span class="chip-sub">{level()}</span>}</Show>
			<Icon of={ChevronDown} size={10} class="chevron" />
		</button>
	);
}

/** The models by maker, each maker said once as a label over its rows. */
function ModelList(p: { matches: readonly ModelOption[]; model: AgentModel | undefined; onPick: (option: ModelOption) => void }) {
	return (
		<div class="max-h-[min(33vh,300px)] overflow-y-auto px-1.5">
			<Show when={p.matches.length > 0} fallback={<p class="meta m-0 px-2 py-2.5">No model matches that</p>}>
				<For each={makersOf(p.matches)}>
					{(maker) => (
						<>
							<div class="menu-label">{makerName(maker)}</div>
							<For each={p.matches.filter((option) => option.provider === maker)}>
								{(option) => (
									<button data-row data-flat="true" data-current={isCurrent(p.model, option)} type="button" role="menuitemradio" aria-checked={isCurrent(p.model, option)} title={`${option.provider}/${option.label}`} onClick={() => p.onPick(option)}>
										<span class="min-w-0 flex-1 truncate">{option.label}</span>
									</button>
								)}
							</For>
						</>
					)}
				</For>
			</Show>
		</div>
	);
}

/** The thinking scale, its label above it, one chip per level the model takes. */
function ThinkingScale(p: { levels: readonly ThinkingLevel[]; current: ThinkingLevel | undefined; onThinking: (level: ThinkingLevel) => void }) {
	return (
		<div class="px-1.5 py-1">
			<span class="menu-label" style={{ padding: "4px 2px 4px" }}>Thinking</span>
			<div class="segmented mt-1 w-full" data-scale="true">
				<For each={p.levels}>
					{(level) => (
						<button class="px-1.5" type="button" data-on={p.current === level} aria-pressed={p.current === level} onClick={() => p.onThinking(level)}>
							{level}
						</button>
					)}
				</For>
			</div>
		</div>
	);
}

/** The subscriptions: every signed-in one can be chosen, and none of them says "spent". */
function AccountRows(p: { accounts: ClaudeAccount[]; account: string | undefined; onAccount: (id: string) => void }) {
	return (
		<div class="px-1.5 py-1">
			<span class="menu-label" style={{ padding: "4px 2px 4px" }}>Account</span>
			<div class="mt-1">
				<For each={p.accounts}>
					{(account) => (
						<button
							type="button"
							data-row
							data-flat="true"
							data-current={p.account === account.id ? "true" : undefined}
							title={account.signedIn ? undefined : "This account has no credentials behind it. Add it again in settings"}
							disabled={!account.signedIn}
							onClick={() => p.onAccount(account.id)}
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
	);
}

/** A subscription's five-hour reading, drawn by the host when it gives one. */
function FiveHour(props: { reading: ClaudeAccount["fiveHour"] }) {
	const Draw = agentUiHost().FiveHour;
	return <>{Draw ? Draw(props) : null}</>;
}
