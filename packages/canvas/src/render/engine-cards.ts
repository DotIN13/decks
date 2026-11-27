import { type PenDocument } from "@decks/pen";
import { fontFiles } from "../look/font-files.ts";
import { BoxIndex } from "./spatial.ts";
import type { SceneCard } from "./types.ts";
import { pictureKey } from "./engine-pictures.ts";
import type { CanvasEngine } from "./engine.ts";

/** Whether a top-level item of the drawing frames itself: its own outline or shadow (`paint`'s `has_frame`). */
function framesItself(doc: PenDocument | undefined, id: string): boolean {
	const node = doc?.children?.find((one) => one.id === id) as { stroke?: unknown; strokeWidth?: unknown; effect?: unknown } | undefined;
	return !!node && ((node.stroke !== undefined && node.stroke !== null) || node.strokeWidth !== undefined || (node.effect !== undefined && node.effect !== null));
}

/**
 * The cards on the canvas as the engines draw them: where each is, which are live pages and which
 * are pictures, and the cards a drag is carrying, lifted onto a layer of their own until they land.
 * A part of the engine (`engine.ts`), which it reaches through `of`.
 */
export class EngineCards {
	constructor(private readonly of: CanvasEngine) {}

	setCards(cards: readonly SceneCard[], index?: BoxIndex): void {
		const was = this.placedCards;
		this.placedCards = cards;
		if (!this.of.page) return;
		const key = JSON.stringify(cards.map((b) => [b.path, b.id, b.x, b.y, b.w, b.h, b.news, b.glow, b.picture, b.title, b.kind, b.status, b.corners]));
		const live = JSON.stringify(cards.filter((b) => b.live).map((b) => b.path));
		if (key === this.cardKey) {
			// The same boxes as the ones the index was made for: it answers for these too.
			if (this.of.questions.indexed === was) this.of.questions.indexed = cards;
			if (live !== this.liveKey) {
				this.liveKey = live;
				this.cardsSent.calls++;
				this.cardsSent.bytes += live.length;
				this.of.page.setLive(live);
				// An item let go wants its picture drawn now, and one gone live its hole: a frame, as the whole list gets one.
				this.of.cardPictures.wantCardPictures();
				this.of.frames.draw();
			}
			return;
		}
		this.cardKey = key;
		this.liveKey = live;
		// Its item's id and corners too: the engine cuts its picture to the corners, and draws the frame of a carried card from its item (`engine.rs`, `carried_frame`).
		const sent = JSON.stringify(cards.map((b) => ({ path: b.path, id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, live: b.live, news: b.news, glow: b.glow, title: b.title, kind: b.kind, status: b.status, corners: b.corners })));
		this.cardsSent.calls++;
		this.cardsSent.bytes += sent.length;
		this.of.page.setCards(sent);
		/*
		 * The fonts the engine paints cards' own words in, over and above the drawing's: their titles and a
		 * placeholder's kind (Inter 600, `engine.rs`, `paint_placeholder`, `paint_title`) and a missing card's
		 * why (Inter 500), with the fallbacks their characters need. A canvas whose drawing has no words of
		 * its own was never given them, so no card title or placeholder was ever painted on it.
		 */
		const titles = cards.map((b) => b.title ?? "").join(" ");
		this.of.faces.fetchFonts(
			fontFiles([
				{ family: "Inter", weight: 600, italic: false, text: `${titles} Card App Document Board · missing` },
				...(cards.some((b) => b.kind === "missing") ? [{ family: "Inter", weight: 500, italic: false, text: "Studio has no copy of this card yet, and no harness of yours with it is in reach." }] : []),
			]),
		);
		const boxes = cards.map((b) => `${b.x},${b.y},${b.w},${b.h}`).join("|");
		this.of.questions.indexed = cards;
		if (boxes !== this.cardBoxes) {
			this.cardBoxes = boxes;
			this.of.questions.cardIndex = index ?? new BoxIndex(cards.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })));
			this.of.questions.indexNodes();
			this.of.questions.writeHits();
		}
		/*
		 * A card whose picture changed (a new revision) is asked for again, against the card's own
		 * address: the one fetched carries a rung (`&w=480`). The old picture stays drawn until the new
		 * one replaces it.
		 */
		this.of.cardPictures.cardByKey = new Map(cards.map((card) => [pictureKey(card.path), card]));
		for (const card of cards) {
			const key = pictureKey(card.path);
			const asked = this.of.cardPictures.picturesAsked.get(key);
			if (asked && card.picture && asked.source !== card.picture) {
				this.of.cardPictures.picturesAsked.delete(key);
				this.of.cardPictures.heldWidth.delete(key);
			}
			if (!(this.of.cardPictures.picturesAsked.get(key)?.size ?? 0) && !this.of.cardPictures.heldWidth.get(key)) this.of.cardPictures.unpictured.add(key);
		}
		// A card taken off the canvas lets go of its picture on the GPU: nothing else ever did.
		if (this.of.cardPictures.pictureBytes.size > 0) {
			const here = new Set(cards.map((card) => pictureKey(card.path)));
			for (const key of [...this.of.cardPictures.pictureBytes.keys()]) {
				if (here.has(key)) continue;
				this.of.cardPictures.pictureBytes.delete(key);
				this.of.cardPictures.heldWidth.delete(key);
				this.of.cardPictures.picturesAsked.delete(key);
				this.of.page?.forgetPicture(key);
			}
		}
		this.of.cardPictures.wantCardPictures();
		this.of.frames.draw();
	}

	carriedBy = { dx: 0, dy: 0 };

	/**
	 * The cards a drag carries, and how far. An arrow with an end on one bends with it: the gesture's
	 * preview is sent again with the cards where they are now, or, when only cards are dragged, a
	 * preview of nothing but them. Such a drag's arrows stay as last routed when it is let go, until
	 * the server's drawing comes back routed to where the cards landed (`setDoc`), or two seconds pass.
	 */
	carry(paths: readonly string[], offset: { dx: number; dy: number }): void {
		this.carriedBy = { dx: offset.dx, dy: offset.dy };
		this.carriedCount = paths.length;
		this.carriedPaths = [...paths];
		if (!this.of.page) return;
		this.of.page.carry(JSON.stringify(paths), offset.dx, offset.dy);
		if (paths.length) {
			// A drag of cards is a gesture too: a glide still in hand would put its arrows down under it.
			this.of.glides.endGlide();
			this.cardsAnswered = false;
			if (this.shown === undefined) {
				this.cardsOnly = true;
				clearTimeout(this.cardsLanding);
			}
			this.lift(this.of.page.setPreview(this.shown ?? "[]"));
			// A card that frames itself (its own outline or shadow, painted with the drawing) is left out of the tiles while it is carried, once: the canvas draws its frame round its picture where the drag has it (`engine.rs`, `carried_frame`), and it goes back with the rest when the drag lands.
			const framed = paths
				.map((path) => this.placedCards.find((card) => card.path === path)?.id)
				.filter((id): id is string => !!id && !this.lifted.has(id) && framesItself(this.of.doc, id));
			if (framed.length) this.lift(JSON.stringify(framed));
			this.of.layout.laidOut(this.shown === undefined || this.of.previews.moveOnly);
		} else if (this.cardsOnly && this.shown === undefined) {
			clearTimeout(this.cardsLanding);
			// The drawing that answers the drop came while the cards were held where they were dropped (`editor/core/gesture.ts`, `holdPages`): its arrows are routed already.
			if (this.cardsAnswered) this.landCards();
			else this.cardsLanding = setTimeout(() => this.landCards(), 2000);
		}
		this.of.frames.draw();
	}

	/** The preview a gesture on drawn items is showing, as sent to the engine; undefined when none. */
	shown: string | undefined;

	carriedCount = 0;

	/** The cards the last `carry` names (`probes.engine.carried`). */
	carriedPaths: string[] = [];

	/** A drag of cards alone is showing its arrows, or has let go and waits for the drawing. */
	cardsOnly = false;

	/** A drawing came since the cards were last carried a step: the one that answers their drop, if they are let go of now. */
	cardsAnswered = false;

	private cardsLanding: ReturnType<typeof setTimeout> | undefined;

	landCards(): void {
		clearTimeout(this.cardsLanding);
		if (!this.cardsOnly) return;
		this.cardsOnly = false;
		if (this.shown !== undefined || !this.of.page) return;
		this.of.page.setPreview("null");
		if (this.lifted.size) this.of.post({ type: "drop", ids: [...this.lifted] });
		this.of.layout.laidOut();
		this.of.frames.draw();
	}

	/**
	 * What `setPreview` newly lifted (its answer): the arrows it bent, and a shape's outline resized
	 * with it. The worker leaves them out of its tiles too, and they are put down with the rest.
	 */
	lift(answer: string): void {
		const bent = JSON.parse(answer) as string[];
		if (!bent.length) return;
		for (const id of bent) this.lifted.add(id);
		this.of.post({ type: "lift", ids: bent });
	}

	/**
	 * A picture of what a drag carries, for the ghost a drag over a card shows (`CanvasView.tsx`): the lifted
	 * items drawn alone for one frame and copied off the canvas in the same task, then the canvas drawn
	 * whole again. `rect` is where they lay on screen before the drag; they are now the drag's offset on.
	 */
	cutFromCarried(rect: { left: number; top: number; width: number; height: number }): HTMLCanvasElement | undefined {
		const canvas = this.of.over;
		if (!this.of.page || !canvas || !this.lifted.size || rect.width < 1 || rect.height < 1) return undefined;
		const drawn = this.of.drawRect();
		this.of.page.frameLifted(drawn.x, drawn.y, drawn.zoom, Math.min(2, devicePixelRatio || 1), drawn.width, drawn.height);
		this.of.drawnAt = { x: drawn.x, y: drawn.y, zoom: drawn.zoom };
		this.of.place();
		const at = canvas.getBoundingClientRect();
		if (!at.width || !at.height) {
			this.of.frames.drawNow();
			return undefined;
		}
		const sx = canvas.width / at.width;
		const sy = canvas.height / at.height;
		const left = rect.left + this.offset.dx * this.of.camera.zoom - at.left;
		const top = rect.top + this.offset.dy * this.of.camera.zoom - at.top;
		const out = document.createElement("canvas");
		out.width = Math.max(1, Math.round(rect.width * sx));
		out.height = Math.max(1, Math.round(rect.height * sy));
		out.getContext("2d")?.drawImage(canvas, left * sx, top * sy, rect.width * sx, rect.height * sy, 0, 0, out.width, out.height);
		// Drawn whole again before the browser paints, whatever frame this is.
		this.of.frames.drawNow();
		return out;
	}

	/** The lifted items drawn or not, while a ghost of them stands in. */
	showCarriedLayer(on: boolean): void {
		this.of.page?.showLifted(on);
		this.of.frames.draw();
	}

	/** How far the drag has moved what it carries. */
	offset = { dx: 0, dy: 0 };

	placedCards: readonly SceneCard[] = [];

	cardKey = "";

	/** The live paths last sent (`setLive`). */
	liveKey = "";

	lifted = new Set<string>();

	picturedKey = "";

	carryingKey = "";

	/** How often, and how much, the cards have been sent to the page engine (`setCards`): for `awake-bench.mjs`. */
	cardsSent = { calls: 0, bytes: 0 };

	private cardBoxes = "";
}
