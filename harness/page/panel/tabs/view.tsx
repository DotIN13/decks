import Circle from "lucide-solid/icons/circle";
import FileText from "lucide-solid/icons/file-text";
import MoveUpRight from "lucide-solid/icons/move-up-right";
import PenLine from "lucide-solid/icons/pen-line";
import Square from "lucide-solid/icons/square";
import StickyNote from "lucide-solid/icons/sticky-note";
import Type from "lucide-solid/icons/type";
import { For, Show, type JSX } from "solid-js";
import type { CanvasItem, ItemKind } from "@decks/canvas/tools";
import { Icon } from "@decks/ui";
import { AppLogs, AppRow, type AppAction, type PanelApp } from "../AppRow.tsx";
import { createAppsTab } from "./actions.ts";
import { cardsOf, drawnOf, itemLit, noAppsWords, noItemsWords } from "./model.ts";

// The side panel's Canvas tab (the cards and the drawing on the canvas, by
// name) and its Apps tab (the deck's apps, each with its menu and logs).

const ITEM_ICON: Record<ItemKind, typeof FileText> = { board: FileText, note: StickyNote, text: Type, shape: Circle, frame: Square, ink: PenLine, other: Square };

type CanvasTabProps = { items: { items: CanvasItem[]; arrows: string[] }; selected: ReadonlySet<string>; current: string | undefined; query: string; onPick: (item: CanvasItem) => void; onPickArrows: (ids: string[]) => void };

function ItemRow(p: { item: CanvasItem; lit: boolean; onPick: (item: CanvasItem) => void }): JSX.Element {
	return (
		<button type="button" class="v3-item" data-row data-kind={p.item.kind} data-on={p.lit ? "true" : undefined} title={p.item.label} onClick={() => p.onPick(p.item)}>
			<Icon of={ITEM_ICON[p.item.kind]} size={14} class="v3-item-icon" />
			<span class="v3-item-name truncate">{p.item.label}</span>
		</button>
	);
}

function Section(p: { label: string; count: number }): JSX.Element {
	return (
		<div class="v3-sec">
			<span>{p.label}</span>
			<span class="flex-1" />
			<span class="v3-sec-n tabular-nums">{p.count}</span>
		</div>
	);
}

export function CanvasTab(props: CanvasTabProps): JSX.Element {
	const cards = () => cardsOf(props.items.items);
	const drawn = () => drawnOf(props.items.items);
	const row = (item: CanvasItem) => <ItemRow item={item} lit={itemLit(item, props.selected, props.current)} onPick={props.onPick} />;
	return (
		<div class="panel-section v3-items" data-kind="canvas">
			<Show when={cards().length > 0}>
				<Section label="Cards" count={cards().length} />
				<For each={cards()}>{row}</For>
			</Show>
			<Show when={drawn().length > 0 || props.items.arrows.length > 0}>
				<Section label="Drawing" count={drawn().length} />
				<For each={drawn()}>{row}</For>
				<Show when={props.items.arrows.length > 0}>
					<button type="button" class="v3-item" data-row onClick={() => props.onPickArrows(props.items.arrows)}>
						<Icon of={MoveUpRight} size={14} class="v3-item-icon" />
						<span class="v3-item-name truncate">Arrows</span>
						<span class="v3-item-n tabular-nums">{props.items.arrows.length}</span>
					</button>
				</Show>
			</Show>
			<Show when={props.items.items.length === 0 && props.items.arrows.length === 0}>
				<p class="m-0 px-1 py-2 text-ui leading-normal text-faint">{noItemsWords(props.query)}</p>
			</Show>
		</div>
	);
}

type AppsTabProps = { apps: PanelApp[]; known: PanelApp[] | undefined; query: string; onApp?: (app: PanelApp, action: AppAction) => Promise<unknown> | void; onAppLogs?: (app: PanelApp) => Promise<string[] | undefined> };

export function AppsTab(props: AppsTabProps): JSX.Element {
	const t = createAppsTab();
	return (
		<div class="panel-section v3-apps" data-kind="apps">
			<For each={props.apps}>{(app) => <AppRow app={app} picked={t.picked() === app.name} onPick={() => t.setPicked(app.name)} onAct={(action) => props.onApp?.(app, action)} onLogs={() => t.setLogsOf(app)} />}</For>
			<Show when={props.apps.length === 0}>
				<p class="m-0 px-2 py-2 text-ui leading-normal text-faint">{noAppsWords(props.known, props.query)}</p>
			</Show>
			<Show when={t.logsOf()}>{(app) => <AppLogs title={app().title} read={() => props.onAppLogs?.(app()) ?? Promise.resolve(undefined)} onClose={() => t.setLogsOf(undefined)} />}</Show>
		</div>
	);
}
