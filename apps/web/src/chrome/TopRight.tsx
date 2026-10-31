import type { AgentChat, AgentUsage, Identity } from "@decks/protocol";
import type { LucideIcon } from "lucide-solid";
import MoreHorizontal from "lucide-solid/icons/more-horizontal";
import Play from "lucide-solid/icons/play";
import Check from "lucide-solid/icons/check";
import { For, Show } from "solid-js";
import { AgentFace } from "../agents/AgentPill.tsx";
import { ContextRing } from "./ContextRing.tsx";
import { PictureProgress } from "./PictureProgress.tsx";
import { contextLevel, contextPercent } from "../lib/context-usage.ts";
import { Icon } from "../ui/icons.tsx";
import { Popover } from "../ui/Popover.tsx";

export type MoreItem = { label: string; icon: LucideIcon; note?: string; onPick: () => void; rule?: boolean; checked?: boolean; disabled?: boolean };

/**
 * The bar at the top right: who is on this canvas, present, and everything else behind `⋯`.
 *
 * The faces are the agents whose canvas this is, each pressed to talk to it. Present hides the
 * chrome and fills the screen with the canvas (Escape comes back). `⋯` holds the deck's commands
 * the old corner had: how full the context is, fitting and clearing the canvas, the shortcuts, the
 * settings and the theme, and how far the boards' pictures have got.
 */
export function TopRight(props: {
	here: AgentChat[];
	identities: Record<string, Identity>;
	unread: Record<string, number>;
	focused: string | undefined;
	onFocus: (id: string) => void;
	onPresent: () => void;
	usage?: AgentUsage;
	onContext: () => void;
	more: MoreItem[];
	/** Only the `⋯`, for the phone's top bar. */
	menuOnly?: boolean;
}) {
	const menu = () => (
		<Popover
			placement="bottom-end"
			label="More"
			class="w-max min-w-[200px] max-w-[260px]"
			trigger={(api) => (
				<button
					ref={api.ref}
					type="button"
					class="v3-icon"
					aria-haspopup="menu"
					aria-expanded={api.open}
					data-on={api.open ? "soft" : undefined}
					data-level={contextLevel(props.usage)}
					data-tip="More"
					aria-label="More"
					onClick={api.toggle}
				>
					<Icon of={MoreHorizontal} size={17} />
				</button>
			)}
		>
			{/* On a desk the context is the composer's dial; a phone has no room there, so it is here. */}
			<Show when={props.menuOnly && props.usage && contextPercent(props.usage) !== undefined}>
				<button type="button" role="menuitem" data-row data-flat="true" onClick={props.onContext}>
					<span class="row-icon">
						<ContextRing usage={props.usage} size={15} />
					</span>
					<span class="row-label flex-1">Context usage</span>
					<span class="meta flex-none tabular-nums">{Math.round(contextPercent(props.usage) ?? 0)}%</span>
				</button>
				<span class="rule block" />
			</Show>
			<For each={props.more}>
				{(item) => (
					<>
						<Show when={item.rule}>
							<span class="rule block" />
						</Show>
						<button
							type="button"
							role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
							aria-checked={item.checked}
							data-row
							data-flat={item.note ? undefined : "true"}
							data-keep-open={item.checked === undefined ? undefined : ""}
							disabled={item.disabled}
							onClick={item.onPick}
						>
							<span class="row-icon">
								<Icon of={item.icon} size={15} />
							</span>
							<span class="row-label flex-1">{item.label}</span>
							<Show when={item.note}>{(note) => <span class="row-note">{note()}</span>}</Show>
							<Show when={item.checked}>
								<span class="v3-more-check" aria-hidden="true">
									<Icon of={Check} size={14} />
								</span>
							</Show>
						</button>
					</>
				)}
			</For>
			<PictureProgress quietWhenDone />
		</Popover>
	);

	return (
		<Show when={!props.menuOnly} fallback={menu()}>
			<div class="v3-bar v3-topright float pill" data-inset="top">
				<Show when={props.here.length > 0}>
					<span class="v3-here" role="group" aria-label="Agents on this canvas">
						<For each={props.here.slice(0, 5)}>
							{(chat) => {
								const name = () => props.identities[chat.id]?.name ?? chat.name;
								return (
									<button type="button" class="v3-here-face" data-current={props.focused === chat.id ? "true" : undefined} data-tip={`${name()} is on this canvas`} aria-label={`Talk to ${name()}`} onClick={() => props.onFocus(chat.id)}>
										<AgentFace chat={chat} identity={props.identities[chat.id]} unread={props.unread[chat.id] ?? 0} size={24} ring={1.5} />
									</button>
								);
							}}
						</For>
						<Show when={props.here.length > 5}>
							<span class="v3-here-more">+{props.here.length - 5}</span>
						</Show>
					</span>
					<span class="v3-sep" aria-hidden="true" />
				</Show>
				<button type="button" class="v3-icon" data-tip="Present" data-key="⌥P" aria-label="Present" onClick={() => props.onPresent()}>
					<Icon of={Play} size={17} />
				</button>
				{menu()}
			</div>
		</Show>
	);
}
