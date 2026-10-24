import ChevronDown from "lucide-solid/icons/chevron-down";
import { For, Show, type JSX } from "solid-js";
import { Icon } from "../ui/icons.tsx";
import { Popover } from "../ui/Popover.tsx";

/*
 * The rows Settings is made of (`settings/Settings.tsx`, `alerts/AlertSettings.tsx`): a group's
 * grey label over hairline rows, each row its words on the left and one control on the right.
 * `styles/settings.css` lays them out, and stacks a row's control under its words on a phone.
 */

/** A group: a small grey label over rows divided by hairlines. */
export function SetGroup(props: { label?: string; foot?: JSX.Element; children: JSX.Element; group?: string }) {
	return (
		<section class="sw-group" data-group={props.group}>
			<Show when={props.label}>
				<span class="sw-label">{props.label}</span>
			</Show>
			<div class="sw-rows">{props.children}</div>
			<Show when={props.foot}>
				<span class="sw-foot">{props.foot}</span>
			</Show>
		</section>
	);
}

/** A row: what it is on the left (a name, and a sentence under it), its control on the right. */
export function SetRow(props: { title: JSX.Element; sub?: JSX.Element; children?: JSX.Element; lead?: JSX.Element; wide?: boolean }) {
	return (
		<div class="sw-row" data-wide={props.wide || undefined}>
			{props.lead}
			<span class="sw-words">
				<span class="sw-name">{props.title}</span>
				<Show when={props.sub}>
					<span class="sw-sub">{props.sub}</span>
				</Show>
			</span>
			<Show when={props.children}>
				<span class="sw-ctl">{props.children}</span>
			</Show>
		</div>
	);
}

/** A segmented choice: the grey track with the open one raised. */
export function SetSegments<T extends string | number>(props: { options: ReadonlyArray<{ id: T; label: string; note?: string }>; value: T; onPick: (id: T) => void; label: string }) {
	return (
		<span class="sw-seg" role="radiogroup" aria-label={props.label}>
			<For each={props.options}>
				{(option) => (
					<button type="button" role="radio" aria-checked={props.value === option.id} data-on={props.value === option.id} title={option.note} onClick={() => props.onPick(option.id)}>
						{option.label}
					</button>
				)}
			</For>
		</span>
	);
}

/** A select: a grey field with a chevron, opening the app's menu (no ticks; the chosen row is washed). */
export function SetSelect(props: { options: ReadonlyArray<{ id: string; label: string }>; value: string; onPick: (id: string) => void; label: string }) {
	let close: (() => void) | undefined;
	return (
		<Popover
			placement="bottom-start"
			label={props.label}
			class="sw-menu"
			trigger={(api) => {
				close = () => api.open && api.toggle();
				return (
					<button class="sw-sel" type="button" ref={api.ref} aria-expanded={api.open} onClick={api.toggle}>
						<span class="truncate">{props.options.find((one) => one.id === props.value)?.label ?? props.value}</span>
						<Icon of={ChevronDown} size={14} />
					</button>
				);
			}}
		>
			<For each={props.options}>
				{(option) => (
					<button
						type="button"
						data-row
						data-flat="true"
						data-current={option.id === props.value}
						onClick={() => {
							close?.();
							props.onPick(option.id);
						}}
					>
						<span class="row-label">{option.label}</span>
					</button>
				)}
			</For>
		</Popover>
	);
}

