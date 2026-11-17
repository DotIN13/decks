import type { Setter } from "solid-js";
import { createEffect, createMemo, type Accessor } from "solid-js";
import { mediaOf } from "@decks/pen";
import type { CanvasEngine } from "../render/engine.ts";
import type { CanvasEditor } from "../edit/dom/index.ts";

/** What `createPlayingBox` reads of `createItemsLayer` (`items-layer.tsx`), each read when it is used. */
export interface PlayingBoxNeeds {
	readonly penDrawn: Accessor<number>;
	readonly playing: Accessor<{ id: string; kind: "video" | "audio"; file: string; } | undefined>;
	readonly penLayer: CanvasEngine;
	readonly editor: CanvasEditor;
	readonly setPlaying: Setter<{ id: string; kind: "video" | "audio"; file: string; } | undefined>;
}

export function createPlayingBox(d: PlayingBoxNeeds) {
	/**
	 * Where the player sits, while something is playing: the item's own drawn box.
	 *
	 * It plays on while you work elsewhere on the canvas: letting go of the item, panning or zooming
	 * out does not stop it, because one decoder costs nothing a frame notices and a sound you are
	 * listening to should not end because you clicked away. It goes when it ends, when another is
	 * started, or when the item is gone from the file.
	 */
	const playingBox = createMemo(() => {
		d.penDrawn();
		const now = d.playing();
		if (!now) return undefined;
		const node = d.penLayer.placed.get(now.id)?.node;
		const box = d.penLayer.bounds.get(now.id);
		const media = mediaOf(node);
		if (!node || !box || !media) return undefined;
		const drag = d.editor.itemShift(now.id);
		return {
			...now,
			name: String(node.name ?? media.file.split("/").pop() ?? ""),
			...(media.seconds === undefined ? {} : { seconds: media.seconds }),
			...(media.peaks ? { peaks: media.peaks } : {}),
			radius: typeof node.cornerRadius === "number" ? node.cornerRadius : 8,
			x: box.x + drag.dx,
			y: box.y + drag.dy,
			w: box.w,
			h: box.h,
		};
	});

	// What stopped it above is still holding the file open: let it go, so nothing decodes off screen.
	createEffect(() => {
		if (d.playing() && !playingBox()) d.setPlaying(undefined);
	});

	return {
		playingBox,
	};
}
