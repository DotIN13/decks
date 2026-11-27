import type { Page, Camera } from "@decks/protocol";
import { createEffect, createSelector, createSignal, on, untrack, type Accessor, type Component } from "solid-js";
import { boxOf } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import type { ItemSlotProps } from "../items/item-slot-props.ts";
import { drawing } from "../ink/ink.ts";
import type { CanvasEditor } from "../edit/dom/index.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";

/** What `createPageNode` reads of `createItemsLayer` (`items-layer.tsx`), each read when it is used. */
export interface PageNodeNeeds {
	readonly props: CanvasViewProps;
	readonly Frame: Component<ItemSlotProps>;
	readonly ctl: CameraController;
	readonly isLive: (key: string) => boolean;
	readonly isKept: (key: string) => boolean;
	readonly isLeaving: (key: string) => boolean;
	readonly isPictured: (key: string) => boolean;
	readonly isNear: (key: string) => boolean;
	readonly markLive: (path: string, on: boolean) => void;
	readonly carriedPages: Accessor<ReadonlySet<string>>;
	readonly draggedAsPicture: Accessor<ReadonlySet<string>>;
	readonly gestures: { claimTouch(id: number): void; pinching(): boolean; panTouch(id: number): void; caught(): boolean; };
	readonly editor: CanvasEditor;
	readonly pushCamera: (cam: Camera) => void;
	readonly frame: (boxes: Array<{ x: number; y: number; w: number; h: number; }>) => Camera;
}

export function createPageNode(d: PageNodeNeeds) {
	/**
	 * On a touch screen, the one item whose page takes the fingers (`item-slot.tsx`, `active`): activated by
	 * a second tap on the selected item, and let go when the selection moves to anything else.
	 */
	const [activeItem, setActiveItem] = createSignal<string | undefined>();

	createEffect(on(() => d.props.selected, (selected) => { if (selected !== untrack(activeItem)) setActiveItem(undefined); }));

	/*
	 * Which item is selected, and which is active, asked per item through a selector: a change wakes only
	 * the item that lost it and the one that gained it, not every item on the canvas. Each item's
	 * `selected` feeds its outline, its card's `card.active` (`card.ts`) and its app's input, so a plain
	 * `selected === path` re-ran all of those on every item at each click, on a canvas of hundreds.
	 */
	const isSelected = createSelector(() => d.props.selected);
	const isActive = createSelector(activeItem);

	/** One placed item's slot: the host's, told where it is and what it may do. */
	const pageNode = (card: Page) => (
		<d.Frame
			card={card}
			zoom={d.ctl.zoom()}
			mounted={d.isLive(card.path) || d.isKept(card.path) || d.isLeaving(card.path)}
			asleep={d.isKept(card.path) || d.isLeaving(card.path)}
			kept={d.isKept(card.path)}
			covered={d.isPictured(card.path)}
			visible={d.isNear(card.path)}
			onLive={(on: boolean) => d.markLive(card.path, on)}
			carried={d.carriedPages().has(card.path) || d.draggedAsPicture().has(card.path)}
			selected={isSelected(card.path)}
			active={isActive(card.path)}
			onActivate={() => setActiveItem(card.path)}
			gestures={d.gestures}
			{...(d.props.onOpenPage ? { onOpenPage: d.props.onOpenPage } : {})}
			view={d.editor.pageView(card.path)}
			{...(d.props.onExtent ? { onExtent: (extent) => d.props.onExtent?.(card.path, extent) } : {})}
			onMove={(x, y) => d.props.onMove(card.path, x, y)}
			onOpen={() => d.pushCamera(d.frame([boxOf(card)]))}
			{...(d.props.onHide ? { onClose: () => d.props.onHide?.(card.path) } : {})}
			{...(d.props.onCollapse ? { onCollapse: () => d.props.onCollapse?.(card.path) } : {})}
			{...(d.props.onComment
				? {
						// Words selected in a card while browsing: a comment on them.
						onWords: (words: { quote: string; component?: string; anchor: () => DOMRect | undefined }) => {
							if (d.props.mode !== "browse" || drawing()) return;
							d.props.onComment?.({ path: card.path, title: card.title, quote: words.quote, ...(words.component ? { component: words.component } : {}), anchor: words.anchor });
						},
					}
				: {})}
		/>
	);

	return {
		pageNode,
	};
}
