import { m } from "@decks/i18n";
import { onCleanup, untrack } from "solid-js";
import { canvasBox, fitInto } from "@decks/canvas/camera";
import { canvasItems, type CanvasItem } from "@decks/canvas/tools";
import type { FramedHandle } from "@decks/canvas/page";
import { setMineReader } from "@decks/agent-ui/chat";
import { api } from "../connections/connection.ts";
import { openAuthed } from "../lib/authed.tsx";
import { aboutSent, readParts, readSent } from "../composer/pill-about.ts";
import type { DraftMention } from "@decks/agent-ui/composer";
import { camera, moveCamera } from "../state/camera.ts";
import type { WaitingComment } from "../state/comments.ts";
import { state } from "../state/deck.ts";
import { notice } from "../state/notices.ts";
import { flyTo } from "./links.ts";
import { canvasOnScreen } from "../tabs/tabs.ts";

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
		if (item.card) {
			const name = canvasOnScreen()?.name;
			const path = state.pages.find((one) => one.path === item.card || (name && one.path === `canvases/${name}/${item.card}`))?.path;
			if (path) return playAndFrame(path);
		}
		untrack(editorHandle)?.select([item.id]);
		setPenSelected([item.id]);
		const canvas = document.querySelector(".stage, iframe.canvas-frame");
		if (!canvas || item.box.w <= 0) return;
		const view = { width: canvas.clientWidth, height: canvas.clientHeight };
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
	 * Show what a pill is about (its card's name): a file opens in a new tab; a card, a card or a drawn
	 * item, or what a comment is on, is found on the canvas and framed as the side panel's rows do.
	 */
	const showPill = (node: DraftMention, comment?: WaitingComment) => {
		// Read with this tab's token, as every file is (`lib/authed.tsx`).
		if (node.kind === "file") return void openAuthed(api(`/file?path=${encodeURIComponent(node.id)}`)).catch((error: unknown) => notice("warn", m.app_file_open_failed({ name: node.id, error: (error as Error).message })));
		const target = comment ? (comment.items?.[0] ?? comment.card) : node.id;
		const name = canvasOnScreen()?.name;
		const item = canvasItems(canvasPen()?.doc).items.find(
			(one) => one.id === target || (!!one.card && (one.card === target || target.endsWith(`/${one.card}`) || (!!name && `canvases/${name}/${one.card}` === target))),
		);
		if (item) return pickItem(item);
		const card = state.pages.find((one) => one.path === target);
		if (card) return flyTo(card);
		notice("info", m.app_not_on_canvas());
	};
	// A message you sent, read back into its pills: from the parts kept with it, or, sent before they were, from its text.
	setMineReader((text, parts) => {
		const reading = (parts?.length ? readParts(parts) : undefined) ?? readSent(text, titleOf);
		return reading && { draft: reading.draft, pills: { about: (node) => aboutSent(reading, node, titleOf), show: (node) => showPill(node, node.kind === "comment" ? reading.comments.get(node.id) : undefined) } };
	});
	onCleanup(() => setMineReader(undefined));
	return { pickItem, titleOf, itemName, showPill };
}
