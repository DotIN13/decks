import type { StageRow } from "@decks/protocol";
import LayoutGrid from "lucide-solid/icons/layout-grid";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import { createSignal, For, Show, type JSX } from "solid-js";
import { api } from "../connections/connection.ts";
import { Icon } from "../ui/icons.tsx";
import { Popover } from "../ui/Popover.tsx";
import { searchStages } from "../state/stages.ts";

/** How many canvases the switcher lists before a search: the recent few. All canvases has the rest. */
const RECENT = 5;

/**
 * The canvas switcher: what the canvas title opens, in the panel's head and in the top bar.
 *
 * As the "Menus and dialogs redesign" draws it: a find field (not focused on open), the canvases
 * you were in most lately with a small picture, the faces on each and how long ago it changed,
 * the one you are on washed; then New canvas and All canvases, which opens the canvas manager.
 */
export function CanvasSwitcher(props: {
	stages: StageRow[];
	here: string | undefined;
	scheme: "light" | "dark";
	onPick: (name: string) => void;
	onNew: () => void;
	onAll: () => void;
	trigger: (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element;
	placement?: "bottom-start" | "bottom-end";
}) {
	const [find, setFind] = createSignal("");
	let dismiss: (() => void) | undefined;
	const pick = (run: () => void) => {
		dismiss?.();
		run();
	};
	const listed = () => {
		const q = find().trim();
		if (q) return searchStages(props.stages, q).filter((one) => one.hit).map((one) => one.stage).slice(0, 8);
		const at = (one: StageRow) => (one.name === props.here ? Number.POSITIVE_INFINITY : (one.changedAt ?? 0));
		return [...props.stages].sort((a, b) => at(b) - at(a)).slice(0, RECENT);
	};
	return (
		<Popover
			placement={props.placement ?? "bottom-start"}
			label="Canvases"
			class="w-[320px]"
			onOpenChange={(open) => {
				if (!open) setFind("");
			}}
			trigger={(popover) => {
				dismiss = () => popover.open && popover.toggle();
				return props.trigger(popover);
			}}
		>
			<label class="field menu-find">
				<Icon of={Search} size={13} class="shrink-0 text-faint" />
				<input type="text" placeholder="Find a canvas" aria-label="Find a canvas" value={find()} onInput={(event) => setFind(event.currentTarget.value)} />
			</label>
			<div class="menu-label">{find().trim() ? "Canvases" : "Recent"}</div>
			<Show when={listed().length > 0} fallback={<p class="m-0 px-2 py-2 text-note text-faint">No canvas matches that</p>}>
				<For each={listed()}>
					{(stage) => (
						<button type="button" role="menuitem" data-row data-flat="true" class="switcher-canvas" data-current={stage.name === props.here ? "true" : undefined} onClick={() => pick(() => props.onPick(stage.name))}>
							<span class="switcher-thumb" aria-hidden="true">
								<Show when={stage.boards > 0}>
									<img alt="" loading="lazy" src={api(`/stage-thumb/${encodeURIComponent(stage.name)}?v=${stage.rev}&scheme=${props.scheme}`)} />
								</Show>
							</span>
							<span class="row-label min-w-0 flex-1 truncate">{stage.title}</span>
							<span class="switcher-faces">
								<For each={stage.agents.slice(0, 2)}>{(agent) => <span class="switcher-face" style={{ background: agent.color }} title={agent.name}>{agent.name.slice(0, 1).toUpperCase()}</span>}</For>
							</span>
							<span class="menu-note">{ago(stage.changedAt)}</span>
						</button>
					)}
				</For>
			</Show>
			<div class="rule" aria-hidden="true" />
			<button type="button" role="menuitem" data-row data-flat="true" onClick={() => pick(props.onNew)}>
				<Icon of={Plus} size={15} class="row-icon" />
				<span class="row-label flex-1">New canvas</span>
			</button>
			<button type="button" role="menuitem" data-row data-flat="true" onClick={() => pick(props.onAll)}>
				<Icon of={LayoutGrid} size={15} class="row-icon" />
				<span class="row-label flex-1">All canvases</span>
			</button>
		</Popover>
	);
}

/** How long ago, in the switcher's short words: 28m, 16h, 2d. */
function ago(at: number | undefined, now = Date.now()): string {
	if (!at) return "";
	const minutes = Math.max(0, Math.floor((now - at) / 60_000));
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}
