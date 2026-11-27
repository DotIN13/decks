import { formatAgo, m } from "@decks/i18n";
import type { CanvasRow } from "@decks/protocol";
import Layers from "lucide-solid/icons/layers";
import LayoutGrid from "lucide-solid/icons/layout-grid";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import { createSignal, For, Show, type JSX } from "solid-js";
import { api } from "../connections/connection.ts";
import { Icon, Popover } from "@decks/ui";
import { searchCanvases } from "../state/canvases.ts";
import { AuthedImg } from "../lib/authed.tsx";

/** How many canvases the switcher lists before a search: the recent few. All canvases has the rest. */
const RECENT = 5;

/**
 * The canvas switcher: what the canvas title opens, in the panel's head and in the top bar.
 *
 * As the "Menus and dialogs redesign" draws it: a find field, the canvases
 * you were in most lately with a small picture, the faces on each and how long ago it changed,
 * the one you are on washed; then New canvas and All canvases, which opens the canvas manager.
 *
 * The find field takes the typing at once with a mouse or a trackpad, so a letter typed after the menu
 * opens finds rather than going nowhere; on a touch screen it waits for a tap, so opening the menu does
 * not throw up the keyboard over it.
 */
/** What the switcher lists: the canvases matching the words typed, or the latest, the one you are on first. */
function listedCanvases(canvases: CanvasRow[], here: string | undefined, typed: string): CanvasRow[] {
	const q = typed.trim();
	if (q) return searchCanvases(canvases, q).filter((one) => one.hit).map((one) => one.canvas).slice(0, 8);
	const at = (one: CanvasRow) => (one.name === here ? Number.POSITIVE_INFINITY : (one.changedAt ?? 0));
	return [...canvases].sort((a, b) => at(b) - at(a)).slice(0, RECENT);
}

export function CanvasSwitcher(props: {
	canvases: CanvasRow[];
	here: string | undefined;
	scheme: "light" | "dark";
	onPick: (name: string) => void;
	onNew: () => void;
	onAll: () => void;
	trigger: (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element;
	placement?: "bottom-start" | "bottom-end" | "right-start";
	/** What the list is called, for a screen reader: "Canvases" unless it is for something else. */
	label?: string;
	/** Only what can be picked: no New canvas, no All canvases (a list that links to a canvas rather than going to one). */
	plain?: boolean;
	/** What else it lists after the canvases, given the words typed and how a pick shuts it: the + of the tabs lists what the other kinds offer (`tabs/OpenMore.tsx`). */
	more?: (find: () => string, pick: (run: () => void) => void) => JSX.Element;
	/** What the find field asks for, when it finds more than canvases. */
	findLabel?: string;
}) {
	const [find, setFind] = createSignal("");
	let field: HTMLInputElement | undefined;
	let dismiss: (() => void) | undefined;
	const pick = (run: () => void) => {
		dismiss?.();
		run();
	};
	const listed = () => listedCanvases(props.canvases, props.here, find());
	return (
		<Popover
			placement={props.placement ?? "bottom-start"}
			label={props.label ?? m.canvases_canvases()}
			class="w-[320px]"
			onOpenChange={(open) => {
				if (!open) setFind("");
				else if (matchMedia("(pointer: fine)").matches) requestAnimationFrame(() => field?.focus());
			}}
			trigger={(popover) => {
				dismiss = () => popover.open && popover.toggle();
				return props.trigger(popover);
			}}
		>
			<label class="field menu-find">
				<Icon of={Search} size={13} class="shrink-0 text-faint" />
				<input ref={field} type="text" placeholder={props.findLabel ?? m.canvases_find()} aria-label={props.findLabel ?? m.canvases_find()} value={find()} onInput={(event) => setFind(event.currentTarget.value)} />
			</label>
			<div class="menu-label">{find().trim() ? m.canvases_canvases() : m.canvases_recent()}</div>
			<Show when={listed().length > 0} fallback={<p class="m-0 px-2 py-2 text-note text-faint">{m.canvases_find_none()}</p>}>
				<For each={listed()}>
					{(canvas) => (
						<button type="button" role="menuitem" data-row data-flat="true" class="switcher-canvas" data-current={canvas.name === props.here ? "true" : undefined} onClick={() => pick(() => props.onPick(canvas.name))}>
							<span class="switcher-thumb" aria-hidden="true">
								{/* The canvas's mark, under its picture: what shows while the picture loads, and for a canvas with none. */}
								<Icon of={Layers} size={13} class="switcher-thumb-mark" />
								<Show when={canvas.cards > 0}>
									<AuthedImg alt="" loading="lazy" src={api(`/canvas-thumb/${encodeURIComponent(canvas.name)}?v=${canvas.shot ?? canvas.rev}&scheme=${props.scheme}`)} />
								</Show>
							</span>
							<span class="row-label min-w-0 flex-1 truncate">{canvas.title}</span>
							<span class="switcher-faces">
								<For each={canvas.agents.slice(0, 2)}>{(agent) => <span class="switcher-face" style={{ background: agent.color }} title={agent.name}>{agent.name.slice(0, 1).toUpperCase()}</span>}</For>
							</span>
							<span class="menu-note">{ago(canvas.changedAt)}</span>
						</button>
					)}
				</For>
			</Show>
			{props.more?.(find, pick)}
			<Show when={!props.plain}>
				<div class="rule" aria-hidden="true" />
				<button type="button" role="menuitem" data-row data-flat="true" onClick={() => pick(props.onNew)}>
					<Icon of={Plus} size={15} class="row-icon" />
					<span class="row-label flex-1">{m.canvases_new()}</span>
				</button>
				<button type="button" role="menuitem" data-row data-flat="true" onClick={() => pick(props.onAll)}>
					<Icon of={LayoutGrid} size={15} class="row-icon" />
					<span class="row-label flex-1">{m.canvases_all()}</span>
				</button>
			</Show>
		</Popover>
	);
}

/** How long ago, in the switcher's short words: 28m, 16h, 2d. */
function ago(at: number | undefined, now = Date.now()): string {
	if (!at) return "";
	return formatAgo(Math.min(at, now), now, "narrow");
}
