import type { Editor } from "./controller.ts";
import { untrack } from "solid-js";
import { glideShift } from "../core/overlay.ts";
import type { PageView } from "../../items/page-view.ts";
import { type PointerHost } from "./pointer.ts";

/** What `createPageViews` reads of `createPointer` (`pointer.ts`), each read when it is used. */
export interface PageViewsNeeds {
	readonly host: PointerHost;
	readonly editor: Editor;
	readonly dragPage: (path: string, event: PointerEvent, on?: HTMLElement) => boolean;
	readonly selectPage: (path: string) => void;
}

export function createPageViews(d: PageViewsNeeds) {
	/** What a board's frame reads of the editor and says back to it (`PageView`). */
	/** The item on the drawing that is this page, by its path as the item names it or by its end. */
	const pageItemId = (path: string): string | undefined => {
		if (d.host.scene.pageItem) return d.host.scene.pageItem(path);
		let ends: string | undefined;
		for (const one of d.host.scene.items()) {
			const own = (one.node.metadata as { path?: unknown } | undefined)?.path;
			if (typeof own !== "string") continue;
			if (own === path) return one.node.id;
			if (!ends && path.endsWith(own)) ends = one.node.id;
		}
		return ends;
	};

	const pageView = (path: string): PageView => ({
		// Carried by the page drag in hand, or gliding to where a change put its item (`editor.glide`, by the item or an ancestor's shift).
		shift: () => {
			const drag = d.editor.pageDrag()?.paths.includes(path) ? d.editor.pageDrag() : undefined;
			const glide = d.editor.glide();
			if (!glide?.size) return drag;
			const id = pageItemId(path);
			const gliding = id ? glideShift(glide, d.host.scene, id) : undefined;
			if (!gliding || (!gliding.dx && !gliding.dy)) return drag;
			return { dx: (drag?.dx ?? 0) + gliding.dx, dy: (drag?.dy ?? 0) + gliding.dy };
		},
		resized: () => (d.editor.pageResize()?.path === path ? d.editor.pageResize() : undefined),
		hover: (on) => {
			if (on) d.editor.hover({ board: path });
			else if (untrack(d.editor.hoverPage) === path) d.editor.hover({ board: undefined });
		},
		press: (event, on) => (d.host.editable() ? d.dragPage(path, event, on) : false),
		dragging: (at) => d.editor.setOwnDrag(at ? { path, ...at } : undefined),
		select: () => d.selectPage(path),
	});

	return {
		pageView,
	};
}
