import type { Page, Camera } from "@decks/protocol";
import { createEffect, createSignal, on, untrack, type Accessor, type Component } from "solid-js";
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
	readonly markLive: (path: string, on: boolean) => Map<string, number>;
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

	/** One placed item's slot: the host's, told where it is and what it may do. */
	const pageNode = (board: Page) => (
		<d.Frame
			board={board}
			zoom={d.ctl.zoom()}
			mounted={d.isLive(board.path) || d.isKept(board.path) || d.isLeaving(board.path)}
			asleep={d.isKept(board.path) || d.isLeaving(board.path)}
			kept={d.isKept(board.path)}
			covered={d.isPictured(board.path)}
			visible={d.isNear(board.path)}
			onLive={(on: boolean) => d.markLive(board.path, on)}
			carried={d.carriedPages().has(board.path) || d.draggedAsPicture().has(board.path)}
			selected={d.props.selected === board.path}
			active={activeItem() === board.path}
			onActivate={() => setActiveItem(board.path)}
			gestures={d.gestures}
			{...(d.props.onOpenPage ? { onOpenPage: d.props.onOpenPage } : {})}
			view={d.editor.pageView(board.path)}
			{...(d.props.onExtent ? { onExtent: (extent) => d.props.onExtent?.(board.path, extent) } : {})}
			onMove={(x, y) => d.props.onMove(board.path, x, y)}
			onOpen={() => d.pushCamera(d.frame([boxOf(board)]))}
			{...(d.props.onHide ? { onClose: () => d.props.onHide?.(board.path) } : {})}
			{...(d.props.onCollapse ? { onCollapse: () => d.props.onCollapse?.(board.path) } : {})}
			{...(d.props.onComment
				? {
						// Words selected in a card while browsing: a comment on them, as on a board's page before.
						onWords: (words: { quote: string; component?: string; anchor: () => DOMRect | undefined }) => {
							if (d.props.mode !== "browse" || drawing()) return;
							d.props.onComment?.({ path: board.path, title: board.title, quote: words.quote, ...(words.component ? { component: words.component } : {}), anchor: words.anchor });
						},
					}
				: {})}
		/>
	);

	return {
		pageNode,
	};
}
