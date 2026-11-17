import type { Rect } from "../edit/core/model.ts";
import type { Accessor } from "solid-js";
import type { PenNode } from "@decks/pen";
import { probes } from "../base/debug.ts";
import { toScreen, toWorld, type Viewport } from "../camera/camera.ts";
import { createCameraController } from "../camera/controller.ts";
import { viewPoint } from "../camera/coords.ts";
import { isCard } from "@decks/pen";
import { CanvasEngine } from "../render/engine.ts";
import { createCanvasEditor } from "../edit/dom/index.ts";

/** What `setViewProbes` reads of `CanvasView` (`CanvasView.tsx`), each read when it is used. */
export interface SetViewProbesNeeds {
	readonly penLayer: CanvasEngine;
	readonly element: HTMLDivElement;
	readonly ctl: ReturnType<typeof createCameraController>;
	readonly view: Accessor<Viewport>;
	readonly worldAt: (event: { clientX: number; clientY: number; }) => { x: number; y: number; };
	readonly frameUnder: (point: { x: number; y: number; }, carrying: readonly string[]) => string | null;
	readonly editor: ReturnType<typeof createCanvasEditor>;
	readonly penNode: (id: string) => PenNode | undefined;
	readonly dropSlot: (frameId: string, point: { x: number; y: number; }, carrying: readonly string[]) => { index: number; line: Rect; } | undefined;
}

export function setViewProbes(d: SetViewProbesNeeds) {
	/** For the browser checks: where a drawn item is on screen, since most have no click shape to measure. */
	probes.penBox = (id) => {
		const placed = d.penLayer.placed.get(id);
		if (!placed || !d.element) return undefined;
		const box = d.penLayer.bounds.get(id) ?? placed.box;
		const a = toScreen(d.ctl.now(), d.view(), { x: box.x, y: box.y });
		const b = toScreen(d.ctl.now(), d.view(), { x: box.x + box.w, y: box.y + box.h });
		const r = d.element.getBoundingClientRect();
		return new DOMRect(r.left + a.x, r.top + a.y, b.x - a.x, b.y - a.y);
	};

	/** For the browser checks: the frame a drop at a point on the screen would go into, and its box. */
	probes.frameUnder = (clientX, clientY) => {
		const world = d.worldAt({ clientX, clientY });
		return { frame: d.frameUnder(world, []), world };
	};

	probes.pictureAt = (x, y) => (d.element ? d.editor.pictureUnder({ clientX: x, clientY: y }) : undefined);

	/*
	 * The card under a screen point and the slot between its blocks there, for files dropped from the
	 * desktop (`app/files.ts`): they go into the card where they land, as a picture or a file dragged
	 * from the canvas does.
	 */
	probes.cardAt = (x, y) => {
		if (!d.element) return undefined;
		const at = toWorld(d.ctl.now(), d.view(), viewPoint({ clientX: x, clientY: y } as MouseEvent));
		const id = d.frameUnder(at, []);
		const card = id ? d.penNode(id) : undefined;
		if (!id || !card || !isCard(card)) return undefined;
		return { card: id, index: d.dropSlot(id, at, [])?.index ?? (card.children ?? []).length, inner: d.editor.textEditing.cardInner(card) };
	};

}
