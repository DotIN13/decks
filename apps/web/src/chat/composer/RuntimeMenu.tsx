import type { AgentKind } from "@decks/protocol";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { For, Show } from "solid-js";
import { AgentMark } from "../../chrome/agent-marks.tsx";
import { runtimes } from "../../state/deck.ts";
import { Icon } from "../../ui/icons.tsx";
import { Popover } from "../../ui/Popover.tsx";

/**
 * Which runtime the dispatcher is: Pi, Claude, opencode or antigravity.
 *
 * Only in the dashboard's bar. An agent's runtime is fixed when it is made, so on a stage
 * there is nothing to choose; the dispatcher is the one agent nobody makes, which left its
 * runtime as whatever the server defaulted to, and with it the models a task could be given.
 * Choosing here swaps which dispatcher answers the bar (the server keeps one per runtime), so
 * the model picker beside this changes to that runtime's models, and an agent the dispatcher
 * makes for a task opens on the same runtime.
 *
 * First in the row, before mode and model, because it decides what both of them offer. A
 * runtime this machine cannot start is listed and disabled, with the reason, the way the
 * new-agent menu lists it.
 */
export function RuntimeMenu(props: { kind: AgentKind | undefined; onKind: (kind: AgentKind) => void }) {
	const current = () => runtimes().find((runtime) => runtime.kind === props.kind);
	let dismiss: (() => void) | undefined;

	return (
		<Popover
			placement="top-start"
			class="w-[min(260px,calc(100vw-16px))]"
			label="The runtime the dispatcher runs on"
			trigger={(api) => {
				dismiss = () => {
					if (api.open) api.toggle();
				};
				return (
					<button
						ref={api.ref}
						class="chipbtn runtime-chip min-w-0 shrink-0"
						type="button"
						aria-haspopup="menu"
						aria-expanded={api.open}
						aria-label={`Dispatcher runtime: ${current()?.label ?? props.kind ?? "default"}`}
						title="The runtime the dispatcher runs on, and the one new agents it makes open on"
						onClick={api.toggle}
					>
						<Show when={props.kind}>{(kind) => <AgentMark class="flex-none" agent={kind()} size={13} />}</Show>
						<span class="max-w-[96px] truncate max-[560px]:hidden">{current()?.label ?? props.kind ?? "Runtime"}</span>
						<Icon of={ChevronDown} size={10} class="chev" />
					</button>
				);
			}}
		>
			<For each={runtimes()}>
				{(runtime) => (
					<button
						data-row
						data-flat="true"
						data-current={runtime.kind === props.kind}
						type="button"
						role="menuitemradio"
						aria-checked={runtime.kind === props.kind}
						disabled={!runtime.available}
						title={runtime.reason ?? ""}
						onClick={() => {
							if (runtime.kind !== props.kind) props.onKind(runtime.kind);
							dismiss?.();
						}}
					>
						<AgentMark class="flex-none" agent={runtime.kind} size={13} />
						<span class="lb flex-1">
							{runtime.label}
							<Show when={runtime.kind === props.kind}>
								<Icon of={Check} size={11} class="text-accent" />
							</Show>
						</span>
						<Show when={!runtime.available}>
							<span class="flex-none text-note text-faint">not installed</span>
						</Show>
					</button>
				)}
			</For>
		</Popover>
	);
}
