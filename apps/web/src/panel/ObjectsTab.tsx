import Circle from "lucide-solid/icons/circle";
import FileText from "lucide-solid/icons/file-text";
import Layers from "lucide-solid/icons/layers";
import MoveUpRight from "lucide-solid/icons/move-up-right";
import PenLine from "lucide-solid/icons/pen-line";
import Square from "lucide-solid/icons/square";
import StickyNote from "lucide-solid/icons/sticky-note";
import Type from "lucide-solid/icons/type";
import { createMemo, For, Show } from "solid-js";
import type { PenDocument } from "@decks/pen";
import { Icon } from "@decks/ui";
import { m } from "@decks/i18n";
import { canvasItems, type CanvasItem, type ItemKind } from "@decks/canvas/tools";

const ITEM_ICON: Record<ItemKind, typeof Layers> = { card: FileText, note: StickyNote, text: Type, shape: Circle, frame: Square, ink: PenLine, other: Square };

/**
 * The side panel's Objects tab (once called Canvas, and still `canvas` to the code): an outline of
 * the drawing on screen, as Studio's editor lists its layers. Cards first, then what is drawn, then
 * the arrows as one row.
 *
 * Mounted once by the panel and drawn only while `shown`, as the other tabs are.
 */
export function ObjectsTab(props: {
	shown: boolean;
	query: string;
	/** The drawing on screen: the tab lists its top-level items. */
	canvasDoc?: PenDocument;
	/** The drawn items selected on the canvas, by id. */
	selectedItems?: string[];
	/** The board the canvas is centred on. */
	current?: string;
	/** A row pressed: select that item and bring it into view. */
	onPickItem?: (item: CanvasItem) => void;
	onPickArrows?: (ids: string[]) => void;
}) {
	// Listed without laying the drawing out (it ran on every change, whichever tab showed); the one picked is read again with its box, to fly to it.
	const items = createMemo(() => canvasItems(props.canvasDoc, props.query, { boxes: false }));
	const selectedItems = createMemo(() => new Set(props.selectedItems ?? []));
	const cardItems = () => items().items.filter((item) => item.card !== undefined);
	const drawnItems = () => items().items.filter((item) => item.card === undefined);
	const itemRow = (item: CanvasItem) => (
		<button
			type="button"
			class="v3-item"
			data-row
			data-kind={item.kind}
			data-on={selectedItems().has(item.id) || (item.card !== undefined && props.current !== undefined && props.current.endsWith(item.card)) ? "true" : undefined}
			title={item.label}
			onClick={() => props.onPickItem?.(canvasItems(props.canvasDoc, props.query).items.find((one) => one.id === item.id) ?? item)}
		>
			<Icon of={ITEM_ICON[item.kind]} size={14} class="v3-item-icon" />
			<span class="v3-item-name truncate">{item.label}</span>
		</button>
	);

	return (
		<Show when={props.shown}>
			<div class="panel-section v3-items" data-kind="canvas">
				<Show when={cardItems().length > 0}>
					<div class="v3-sec">
						<span>{m.panel_cards()}</span>
						<span class="flex-1" />
						<span class="v3-sec-n tabular-nums">{cardItems().length}</span>
					</div>
					<For each={cardItems()}>{(item) => itemRow(item)}</For>
				</Show>
				<Show when={drawnItems().length > 0 || items().arrows.length > 0}>
					<div class="v3-sec">
						<span>{m.panel_drawing()}</span>
						<span class="flex-1" />
						<span class="v3-sec-n tabular-nums">{drawnItems().length}</span>
					</div>
					<For each={drawnItems()}>{(item) => itemRow(item)}</For>
					<Show when={items().arrows.length > 0}>
						<button type="button" class="v3-item" data-row onClick={() => props.onPickArrows?.(items().arrows)}>
							<Icon of={MoveUpRight} size={14} class="v3-item-icon" />
							<span class="v3-item-name truncate">{m.panel_arrows()}</span>
							<span class="v3-item-n tabular-nums">{items().arrows.length}</span>
						</button>
					</Show>
				</Show>
				<Show when={items().items.length === 0 && items().arrows.length === 0}>
					<p class="m-0 px-1 py-2 text-ui leading-normal text-faint">{props.query.trim() ? m.panel_canvas_no_match({ query: props.query.trim() }) : m.panel_canvas_empty()}</p>
				</Show>
			</div>
		</Show>
	);
}
