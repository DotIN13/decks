import type { Camera } from "@decks/protocol";
import { createEffect, createMemo, on, type Accessor } from "solid-js";
import { LIVE_ZOOM, toScreen, type Viewport } from "../camera/camera.ts";
import { canvasHost, openInTab } from "../base/host.ts";
import { docIndex } from "../model/doc-index.ts";
import { type PenNode } from "@decks/pen";
import { isLiveFile } from "../model/card-frame.ts";
import type { CanvasEngine } from "../render/engine.ts";
import type { CanvasEditor } from "../edit/dom/index.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";
import { type LiveFile } from "./items-layer.tsx";

/** What `createLiveFiles` reads of `createItemsLayer` (`items-layer.tsx`), each read when it is used. */
export interface LiveFilesNeeds {
	readonly penDrawn: Accessor<number>;
	readonly restCamera: Accessor<Camera>;
	readonly props: CanvasViewProps;
	readonly view: () => Viewport;
	readonly penLayer: CanvasEngine;
	readonly LIVE_FILES: 12;
	readonly scaling: Accessor<boolean>;
	holesAsked: { ids: ReadonlySet<string>; mark: number; } | undefined;
	readonly editor: CanvasEditor;
}

export function createLiveFiles(d: LiveFilesNeeds) {
	/*
	 * SVGs shown live on the canvas (`liveFileItem`), each as an image. Each is an element in the cards' layer, under the sheet, which draws a hole
	 * where it is (`render/engine.ts`, `holes`): so it moves with the cards in the same frame, and what is drawn
	 * over it stays over it. As a card's page: only from the live zoom, only near the screen as of the
	 * camera's last rest, the nearest few; while a zoom moves, or the item is being moved or sized, the
	 * sheet draws its still over it instead, and the element waits underneath, still loaded.
	 */
	const liveFiles = createMemo(
		() => {
			d.penDrawn();
			const cam = d.restCamera();
			if (cam.zoom < LIVE_ZOOM || !d.props.pen) return [] as LiveFile[];
			const v = d.view();
			const mx = v.width * 0.25;
			const my = v.height * 0.25;
			const near: Array<LiveFile & { d: number }> = [];
			for (const placed of d.penLayer.placed.values()) {
				const node = placed.node;
				if (!isLiveFile(node) || node.metadata?.kind !== "svg" || typeof node.metadata.file !== "string") continue;
				const box = d.penLayer.bounds.get(node.id) ?? placed.box;
				const a = toScreen(cam, v, { x: box.x, y: box.y });
				const b = toScreen(cam, v, { x: box.x + box.w, y: box.y + box.h });
				if (b.x < -mx || a.x > v.width + mx || b.y < -my || a.y > v.height + my) continue;
				near.push({ id: node.id, file: node.metadata.file, name: String(node.name ?? node.metadata.file.split("/").pop()), d: Math.hypot((a.x + b.x - v.width) / 2, (a.y + b.y - v.height) / 2) });
			}
			return near.sort((p, q) => p.d - q.d).slice(0, d.LIVE_FILES).map(({ d: _d, ...file }) => file);
		},
		[],
		{ equals: (a, b) => a.length === b.length && a.every((file, k) => file.id === b[k]!.id && file.file === b[k]!.file && file.name === b[k]!.name) },
	);

	/**
	 * The items the sheet draws as holes: the live ones, and none while a zoom moves. A moved or sized one
	 * stays live: its element goes with the drag as the sheet's hole does (`liveBox`), so an animation being
	 * carried keeps playing, not its still.
	 */
	const fileHoles = createMemo(
		() => {
			if (d.scaling()) return new Set<string>();
			return new Set(liveFiles().map((file) => file.id));
		},
		new Set<string>(),
		{ equals: (a, b) => a.size === b.size && [...a].every((id) => b.has(id)) },
	);

	createEffect(
		on(fileHoles, (ids) => {
			d.penLayer.previews.holes(ids);
			d.holesAsked = { ids, mark: d.penLayer.tiles.mark() };
		}),
	);

	/** Where each live file is on the canvas, from the layout the sheet drew. */
	const liveBox = (id: string) => {
		d.penDrawn();
		const placed = d.penLayer.placed.get(id);
		const resized = d.editor.itemResize(id);
		if (resized) return { x: resized.x, y: resized.y, w: resized.w, h: resized.h, radius: Number(placed?.node.cornerRadius ?? 0) || 0 };
		const box = d.penLayer.bounds.get(id) ?? placed?.box;
		if (!box) return undefined;
		// Carried with the drag, from the frame the sheet carries it in (`shownDrag`).
		const drag = d.editor.itemShift(id);
		return { x: box.x + drag.dx, y: box.y + drag.dy, w: box.w, h: box.h, radius: Number(placed?.node.cornerRadius ?? 0) || 0 };
	};

	/** A double-click on a live SVG opens it in a tab. */
	const openLiveFile = (id: string): boolean => {
		const index = d.props.pen ? docIndex(d.props.pen.doc) : undefined;
		let node: PenNode | undefined;
		for (let at = index?.get(id); at && !node; at = at.parent ? index?.get(at.parent.id) : undefined) if (isLiveFile(at.node)) node = at.node;
		if (!node || typeof node.metadata?.file !== "string") return false;
		d.editor.select([node.id]);
		openInTab(canvasHost().fileUrl(node.metadata.file));
		return true;
	};

	return {
		liveFiles,
		liveBox,
		openLiveFile,
	};
}
