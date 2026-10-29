import type { FrameChrome } from "@decks/canvas";
import { canvasBox, fitInto } from "@decks/canvas/camera";
import { penSelection, setPenSelection } from "@decks/canvas/tools";
import MoveUpRight from "lucide-solid/icons/move-up-right";
import { createMemo, createSignal, For, Show } from "solid-js";
import { canvasItems, type CanvasItem } from "../panel/canvas-items.ts";
import { ITEM_ICON } from "../panel/LeftPanel.tsx";
import { Icon } from "../ui/icons.tsx";

/**
 * The drawing's layers, in the canvas frame beside its tools: what was the side panel's Canvas tab,
 * now the editor's own, so a pick here selects and frames the item without leaving the frame.
 */
export function FrameLayers(props: { chrome: FrameChrome; onClose: () => void }) {
	const { handle } = props.chrome;
	const [query, setQuery] = createSignal("");
	const items = createMemo(() => {
		props.chrome.revision();
		return canvasItems(handle.drawn(), query());
	});
	const cards = () => items().items.filter((item) => item.board !== undefined);
	const drawn = () => items().items.filter((item) => item.board === undefined);
	const picked = createMemo(() => new Set(penSelection()));

	/** Select it, and bring it into view no closer than it is now. */
	const pick = (item: CanvasItem) => {
		handle.select([item.id]);
		setPenSelection([item.id]);
		if (item.box.w <= 0) return;
		const view = { width: innerWidth, height: innerHeight };
		const region = canvasBox(view);
		const fitted = fitInto([item.box], view, region);
		const zoom = Math.min(fitted.zoom, props.chrome.camera().zoom);
		const cx = item.box.x + item.box.w / 2;
		const cy = item.box.y + item.box.h / 2;
		handle.glide({ zoom, x: cx - (region.x + region.width / 2 - view.width / 2) / zoom, y: cy - (region.y + region.height / 2 - view.height / 2) / zoom }, 400);
	};
	const row = (item: CanvasItem) => (
		<button type="button" class="v3-item" data-row data-kind={item.kind} data-on={picked().has(item.id) ? "true" : undefined} title={item.label} onClick={() => pick(item)}>
			<Icon of={ITEM_ICON[item.kind]} size={14} class="v3-item-icon" />
			<span class="v3-item-name truncate">{item.label}</span>
		</button>
	);
	return (
		<div class="frame-layers float" role="dialog" aria-label="Layers" onKeyDown={(event) => event.key === "Escape" && props.onClose()}>
			<input class="frame-layers-search" type="search" placeholder="Find on this canvas" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
			<div class="frame-layers-list">
				<Show when={cards().length > 0}>
					<div class="v3-sec">
						<span>Cards</span>
						<span class="flex-1" />
						<span class="v3-sec-n tabular-nums">{cards().length}</span>
					</div>
					<For each={cards()}>{row}</For>
				</Show>
				<Show when={drawn().length > 0 || items().arrows.length > 0}>
					<div class="v3-sec">
						<span>Drawing</span>
						<span class="flex-1" />
						<span class="v3-sec-n tabular-nums">{drawn().length}</span>
					</div>
					<For each={drawn()}>{row}</For>
					<Show when={items().arrows.length > 0}>
						<button
							type="button"
							class="v3-item"
							data-row
							onClick={() => {
								handle.select(items().arrows);
								setPenSelection(items().arrows);
							}}
						>
							<Icon of={MoveUpRight} size={14} class="v3-item-icon" />
							<span class="v3-item-name truncate">Arrows</span>
							<span class="v3-item-n tabular-nums">{items().arrows.length}</span>
						</button>
					</Show>
				</Show>
				<Show when={items().items.length === 0 && items().arrows.length === 0}>
					<p class="frame-layers-empty">{query().trim() ? `Nothing on this canvas matches “${query().trim()}”.` : "Nothing on this canvas yet."}</p>
				</Show>
			</div>
		</div>
	);
}
