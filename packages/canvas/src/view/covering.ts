import { BoxIndex } from "../render/spatial.ts";
import { probes } from "../base/debug.ts";
import { createEffect, createMemo, untrack, type Accessor } from "solid-js";
import { appShowing } from "../items/item-surfaces.tsx";
import { missing } from "../base/missing.ts";
import type { SceneCard } from "../render/types.ts";
import { scheme } from "../base/theme.ts";
import type { CanvasEngine } from "../render/engine.ts";
import type { CanvasEditor } from "../edit/dom/index.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";

/** What `createCovering` reads of `createItemsLayer` (`items-layer.tsx`), each read when it is used. */
export interface CoveringNeeds {
	readonly COVER: { app: boolean; document: boolean; };
	readonly moving: Accessor<boolean>;
	readonly panning: Accessor<boolean>;
	readonly scaling: Accessor<boolean>;
	readonly gliding: Accessor<boolean>;
	readonly liveCards: Accessor<ReadonlyMap<string, number>>;
	readonly cardPictures: Accessor<boolean>;
	readonly appStates: Accessor<ReadonlyMap<string, string>>;
	readonly editor: CanvasEditor;
	readonly penLayer: CanvasEngine;
	readonly pageIndex: Accessor<BoxIndex>;
	readonly props: CanvasViewProps;
	readonly resolveColour: (colour: string) => string;
	readonly isLive: (key: string) => boolean;
}

export function createCovering(d: CoveringNeeds) {
	/**
	 * Whether the camera's motion covers an app or a document with its picture (`COVER`): read by the list
	 * below through this memo, so where neither kind is covered (Chromium) the list does not depend on the
	 * motion at all. Read directly, every pan and zoom rebuilt the whole list twice, at its first step and
	 * at rest, to the same 112 cards: 17 ms each on a 4× slowed CPU, a dropped frame at either end.
	 */
	const covering = createMemo(() => (d.COVER.app || d.COVER.document) && (d.moving() || d.panning() || d.scaling() || d.gliding()));

	/**
	 * Each card as the sheet draws it: where it is, and whether it is a hole or a picture.
	 *
	 * A dragged card is where it was picked up, here: the sheet draws its picture once on the carried
	 * layer and the page slides that with the pointer (`carry` below), so a move redraws nothing.
	 */
	createEffect(() => {
		const live = d.liveCards();
		const look = scheme();
		const pictures = d.cardPictures();
		const states = d.appStates();
		/*
		 * An awake card being sized is its surface, drawn over the sheet at the new box, so the sheet
		 * keeps it where it was until the file has the size: each step otherwise painted the whole
		 * sheet again, about 10 ms of the worker's time, to move a hole nobody can see. A card
		 * shown as a picture is drawn by the sheet, and one an arrow ends on is followed by the
		 * arrow, so those two are still sent at every step.
		 */
		const resize = d.editor.sheetResize((path) => live.has(path));
		// How often this list is rebuilt, for `awake-bench.mjs` (`cardLists`): a camera step should not rebuild it.
		probes.cardLists++;
		const sendCards = (cards: SceneCard[]) => {
			/*
			 * The engine draws the cards' pictures, and hears of every card: an arrow follows the card it
			 * ends on, and a drawn item over a card gets the click shape that lets it be pressed there. It
			 * is handed the canvas's own index over them (`pageIndex`, the same order), so it builds none;
			 * not while one is being sized, when the boxes it holds are not the index's.
			 */
			d.penLayer.cardLayer.setCards(cards, resize ? undefined : untrack(d.pageIndex));
		};
		const inMotion = covering();
		// Each card's item on the drawing, by its path: what the engine keeps a glide's offset under.
		const itemIds = new Map<string, string>();
		for (const placed of d.penLayer.placed.values()) {
			const path = (placed.node.metadata as { path?: unknown } | undefined)?.path;
			if (typeof path === "string") itemIds.set(path, placed.node.id);
		}
		// Read once: the host works it out over every page each time it is asked, and it was asked once per card.
		const news = d.props.news;
		sendCards(
			d.props.cards
				.map((card) => {
					const sized = resize?.path === card.path ? resize : undefined;
					// The drawing names a card from its canvas (`cards/x/index.html`), the canvas from the deck: one look-up
					// each way, where a scan of every item per card made each rebuild O(n²) (about 30 ms at 1,000 cards).
					const id = itemIds.get(card.path) ?? itemIds.get(card.path.replace(/^canvases\/[^/]+\//, ""));
					return {
						path: card.path,
						...(id ? { id } : {}),
						...(card.corners ? { corners: card.corners } : {}),
						x: sized?.x ?? card.x,
						y: sized?.y ?? card.y,
						w: sized?.w ?? card.w,
						h: sized?.h ?? card.h,
						// Every kind by one rule: live while its slot says its surface shows (`onLive`: awake and not asleep); an app besides only once its window
						// has loaded the app, and an app or a document only while the camera is still (`MOVING`), its picture otherwise: an app that
						// animates repainted its window at every step of a pan, and a document's editor laid out at every step of a zoom.
						live: card.item === "app" ? live.has(card.path) && appShowing(card.path) && !(d.COVER.app && inMotion) : card.item === "document" ? live.has(card.path) && !(d.COVER.document && inMotion) : live.has(card.path),
						// An awake item's picture is kept ready, for a zoom on WebKit or a drag to show at once.
						...(live.has(card.path) ? { ready: true } : {}),
						// An item not live is its picture: a card's own, an app's as the frame runs it, a document's of its file.
						picture: card.item === "app" && card.app ? d.props.shots().picture({ ...card, path: `apps/${card.app}` }, look) : card.item === "document" && card.file ? d.props.shots().picture({ path: card.file, rev: card.rev }, look) : card.item ? "" : d.props.shots().picture(card, look),
						// Painted on its paper until its picture comes; an app's window carries its name and status in every state.
						title: card.title,
						kind: card.item ?? (missing().has(card.path) ? "missing" : "card"),
						...(card.item === "app" && card.app ? { status: states.get(card.app) ?? "" } : {}),
						...(news?.[card.path] ? { news: d.resolveColour(news[card.path]!), glow: !d.isLive(card.path) } : {}),
					};
				}),
		);
	});

}
