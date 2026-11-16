import { onCleanup, untrack } from "solid-js";
import { canvasBox, fitInto } from "@decks/canvas/camera";
import { canvasItems, type CanvasItem } from "@decks/canvas/tools";
import type { FramedHandle } from "@decks/canvas";
import { setMineReader } from "../../chat/index.ts";
import { api } from "../../connections/connection.ts";
import { fileAddress } from "../../files/model.ts";
import { openAuthed } from "../../lib/authed.tsx";
import { aboutSent, readParts, readSent } from "./sent.ts";
import type { DraftMention } from "../draft/model.ts";
import { camera, moveCamera } from "../../state/camera.ts";
import type { WaitingComment } from "../../state/comments.ts";
import { state } from "../../state/deck.ts";
import { notice } from "../../state/notices.ts";
import { canvasOf } from "../../state/canvases.ts";
import { flyTo } from "../../camera/links.ts";

// Finding on the canvas what a pill or a Canvas-tab row names, and showing it: a card is played and framed,
// a drawn item selected and brought into view, a file opened; and a sent message read back into its pills.

/** What finding a named thing on the canvas reads of the page. */
interface PillInputs {
	canvasPen: () => { doc: Parameters<typeof canvasItems>[0] } | undefined;
	editorHandle: () => FramedHandle | undefined;
	setPenSelected: (ids: string[]) => void;
	playAndFrame: (path: string) => void;
}

/**
 * What a row, a pill or a message names, found on the canvas: the Canvas tab's rows, a pill's card
 * and its name, and a sent message read back into its pills.
 */
export function createPills({ canvasPen, editorHandle, setPenSelected, playAndFrame }: PillInputs) {
	/**
	 * A row of the Canvas tab: a card plays and is framed as from any list; a drawn item is selected
	 * and brought to the middle of the canvas, framed whole when it would not fit at this zoom.
	 */
	const pickItem = (item: CanvasItem) => {
		if (item.path) {
			const name = canvasOf(state.focused)?.name;
			const path = state.pages.find((one) => one.path === item.path || (name && one.path === `canvases/${name}/${item.path}`))?.path;
			if (path) return playAndFrame(path);
		}
		untrack(editorHandle)?.select([item.id]);
		setPenSelected([item.id]);
		const frame = document.querySelector(".stage, iframe.canvas-frame");
		if (!frame || item.box.w <= 0) return;
		const view = { width: frame.clientWidth, height: frame.clientHeight };
		const region = canvasBox(view);
		const fitted = fitInto([item.box], view, region);
		const zoom = Math.min(fitted.zoom, camera().zoom);
		const cx = item.box.x + item.box.w / 2;
		const cy = item.box.y + item.box.h / 2;
		moveCamera({ zoom, x: cx - (region.x + region.width / 2 - view.width / 2) / zoom, y: cy - (region.y + region.height / 2 - view.height / 2) / zoom }, { animate: true });
	};
	/** A card's title by its path, for the name on a pill's card. */
	const titleOf = (path: string) => state.pages.find((one) => one.path === path)?.title;
	/** A drawn item's name by its id, as the layers list calls it: its own name, or a few of its words. */
	const itemName = (id: string) => canvasItems(canvasPen()?.doc).items.find((one) => one.id === id)?.label;
	/**
	 * Show what a pill is about (its card's name): a file opens in a new tab; a card or a drawn
	 * item, or what a comment is on, is found on the canvas and framed as the side panel's rows do.
	 */
	const showPill = (node: DraftMention, comment?: WaitingComment) => {
		// Read with this tab's token, as every file is (`lib/authed.tsx`).
		if (node.kind === "file") return void openAuthed(fileAddress(node.id)).catch((error: unknown) => notice("warn", `${node.id} could not be opened: ${(error as Error).message}`));
		const target = comment ? (comment.items?.[0] ?? comment.path) : node.id;
		const name = canvasOf(state.focused)?.name;
		const item = canvasItems(canvasPen()?.doc).items.find(
			(one) => one.id === target || (!!one.path && (one.path === target || target.endsWith(`/${one.path}`) || (!!name && `canvases/${name}/${one.path}` === target))),
		);
		if (item) return pickItem(item);
		const page = state.pages.find((one) => one.path === target);
		if (page) return flyTo(page);
		notice("info", "That is not on this canvas.");
	};
	// A message you sent, read back into its pills: from the parts kept with it, or, sent before they were, from its text.
	setMineReader((text, parts) => {
		const reading = (parts?.length ? readParts(parts) : undefined) ?? readSent(text, titleOf);
		return reading && { draft: reading.draft, pills: { about: (node) => aboutSent(reading, node, titleOf), show: (node) => showPill(node, node.kind === "comment" ? reading.comments.get(node.id) : undefined) } };
	});
	onCleanup(() => setMineReader(undefined));
	return { pickItem, titleOf, itemName, showPill };
}
