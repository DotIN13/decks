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
	 * Each board as the sheet draws it: where it is, and whether it is a hole or a picture.
	 *
	 * A dragged board is where it was picked up, here: the sheet draws its picture once on the carried
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
		 * sheet again, about 10 ms of the worker's time, to move a hole nobody can see. A board
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
			 * is handed the stage's own index over them (`pageIndex`, the same order), so it builds none;
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
			d.props.boards
				.map((board) => {
					const sized = resize?.path === board.path ? resize : undefined;
					const id = itemIds.get(board.path) ?? [...itemIds].find(([path]) => board.path.endsWith(path))?.[1];
					return {
						path: board.path,
						...(id ? { id } : {}),
						...(board.corners ? { corners: board.corners } : {}),
						x: sized?.x ?? board.x,
						y: sized?.y ?? board.y,
						w: sized?.w ?? board.w,
						h: sized?.h ?? board.h,
						// Every kind by one rule: live while its slot says its surface shows (`onLive`: awake and not asleep); an app besides only once its window
						// has loaded the app, and an app or a document only while the camera is still (`MOVING`), its picture otherwise: an app that
						// animates repainted its window at every step of a pan, and a document's editor laid out at every step of a zoom.
						live: board.item === "app" ? live.has(board.path) && appShowing(board.path) && !(d.COVER.app && inMotion) : board.item === "document" ? live.has(board.path) && !(d.COVER.document && inMotion) : live.has(board.path),
						// An awake item's picture is kept ready, for a zoom on WebKit or a drag to show at once.
						...(live.has(board.path) ? { ready: true } : {}),
						// An item not live is its picture: a card's own, an app's as the frame runs it, a document's of its file.
						picture: board.item === "app" && board.app ? d.props.shots().picture({ ...board, path: `apps/${board.app}` }, look) : board.item === "document" && board.file ? d.props.shots().picture({ path: board.file, rev: board.rev }, look) : board.item ? "" : d.props.shots().picture(board, look),
						// Painted on its paper until its picture comes; an app's window carries its name and status in every state.
						title: board.title,
						kind: board.item ?? (missing().has(board.path) ? "missing" : "card"),
						...(board.item === "app" && board.app ? { status: states.get(board.app) ?? "" } : {}),
						...(news?.[board.path] ? { news: d.resolveColour(news[board.path]!), glow: !d.isLive(board.path) } : {}),
					};
				}),
		);
	});

}
