import { probes } from "../base/debug.ts";
import { isShape, shapeKind, shapeOutline, shapeRadius, type PenNode } from "@decks/pen";
import { docIndex } from "../model/doc-index.ts";
import type { LiveInk, PenPreview } from "./types.ts";
import type { CanvasEngine } from "./engine.ts";

/**
 * What is shown over the drawing as it is saved: the items a gesture is moving, drawn fresh each
 * frame; the stroke under the pen; and the items hidden, muted or cut out while something else
 * (a text editor, a live page) stands in their place. A part of the engine (`engine.ts`), which it
 * reaches through `of`.
 */
export class EnginePreviews {
	constructor(private readonly of: CanvasEngine) {}

	/**
	 * Items a gesture is moving or reshaping: lifted out of the worker's tiles and drawn here each
	 * frame, moved and with the fields shown, until the gesture ends (`undefined`) and the saved
	 * drawing has been painted into the tiles again.
	 */
	preview(moving: ReadonlyMap<string, PenPreview> | undefined): void {
		// A gesture's own preview ends a glide still in hand: what it shows is where things are now.
		this.of.glides.endGlide();
		this.showPreview(moving);
	}

	showPreview(moving: ReadonlyMap<string, PenPreview> | undefined): void {
		if (!this.of.page) return;
		// Only moved: nothing the canvas reads of the layout changes but the arrows bent, so it is told at the end.
		// A fade in (`opacity` alone) changes no layout either.
		this.moveOnly = !!moving?.size && [...moving.values()].every((one) => one.w === undefined && one.h === undefined && one.radius === undefined && (!one.set || Object.keys(one.set).every((key) => key === "opacity")));
		if (moving?.size) {
			const fresh = [...moving.keys()].filter((id) => !this.of.cardLayer.lifted.has(id));
			if (fresh.length) {
				for (const id of fresh) this.of.cardLayer.lifted.add(id);
				this.of.page.lift(JSON.stringify(fresh));
				this.of.post({ type: "lift", ids: fresh });
			}
			const first = moving.values().next().value;
			this.of.cardLayer.offset = { dx: first?.dx ?? 0, dy: first?.dy ?? 0 };
			// The arrows joined to what moves bend with it, routed by the page's engine: lifted out of the tiles too.
			this.of.cardLayer.shown = JSON.stringify(this.withOutlines(moving));
			this.of.cardLayer.cardsOnly = false;
			this.of.glides.settling = false;
			this.of.cardLayer.lift(this.of.page.setPreview(this.of.cardLayer.shown));
		} else {
			this.of.cardLayer.shown = undefined;
			this.of.cardLayer.cardsOnly = false;
			this.of.page.setPreview("null");
			this.of.cardLayer.offset = { dx: 0, dy: 0 };
			if (this.of.cardLayer.lifted.size) this.of.post({ type: "drop", ids: [...this.of.cardLayer.lifted] });
		}
		this.of.layout.laidOut(this.moveOnly);
		this.of.frames.draw();
	}

	/** The gesture shown only moves what it carries (`showPreview`). */
	moveOnly = false;

	/**
	 * A library shape being resized or rounded shows its outline as the saved drawing will have it
	 * (`fitShapes`): sized to the shape, and built at that size by its kind (`build`) so a curve stays
	 * a circle, rather than left at its old size. Its radius is the shape's own, not a frame corner.
	 */
	private withOutlines(moving: ReadonlyMap<string, PenPreview>): Array<[string, PenPreview]> {
		const list = [...moving];
		if (!this.of.doc) return list;
		for (const [at, [id, change]] of list.entries()) {
			if (change.w === undefined && change.h === undefined && change.radius === undefined) continue;
			const node = docIndex(this.of.doc).get(id)?.node;
			const outline = node && isShape(node) ? shapeOutline(node) : undefined;
			if (!node || !outline) continue;
			const w = change.w ?? node.width;
			const h = change.h ?? node.height;
			if (typeof w !== "number" || typeof h !== "number") continue;
			const set: Record<string, unknown> = { x: 0, y: 0, width: w, height: h };
			const build = shapeKind(node.metadata?.kind)?.build;
			if (build) {
				const metadata = change.radius === undefined ? node.metadata : ({ ...node.metadata, radius: change.radius ?? undefined } as PenNode["metadata"]);
				set.geometry = build(w, h, shapeRadius({ ...node, width: w, height: h, metadata }) ?? 0);
				set.viewBox = [0, 0, w, h];
			}
			if (change.radius !== undefined) {
				const { radius: _, ...rest } = change;
				list[at] = [id, rest];
			}
			list.push([outline.id, { dx: 0, dy: 0, set }]);
		}
		return list;
	}

	/** Strokes to draw over everything until they are in the drawing, at the next frame however often they change. */
	ink(strokes: readonly LiveInk[], _warm?: boolean): void {
		probes.sheet.ink = strokes.length;
		this.of.page?.setInk(JSON.stringify(strokes));
		this.of.frames.drawSoon();
	}

	hide(ids: ReadonlySet<string> | undefined): void {
		this.viewState.hidden = [...(ids ?? [])];
		this.sendView();
	}

	muteText(ids: ReadonlySet<string> | undefined): void {
		this.viewState.mute = [...(ids ?? [])];
		this.sendView();
	}

	holes(ids: ReadonlySet<string>): void {
		this.viewState.holes = [...ids];
		this.sendView();
	}

	/**
	 * Who last wrote the drawing: its placeholder frames (`placeholder: true`) are drawn unfinished,
	 * a dashed outline in `color` (a CSS colour the engine reads: hex, rgb() or hsl(), not a `var()`)
	 * with `name` on a tag in their top-left corner. None: the accent, no name.
	 */
	setWriter(writer: { name?: string; color: string } | undefined): void {
		if (writer) this.viewState.writer = writer.name ? { name: writer.name, color: writer.color } : { color: writer.color };
		else delete this.viewState.writer;
		this.sendView();
	}

	viewState: { hidden: string[]; mute: string[]; holes: string[]; scrolls: Record<string, number>; writer?: { name?: string; color: string } } = { hidden: [], mute: [], holes: [], scrolls: {} };

	viewKey = "";

	sendView(): void {
		this.viewState.scrolls = Object.fromEntries(this.of.questions.scrolls);
		const key = JSON.stringify(this.viewState);
		if (key === this.viewKey) return;
		this.viewKey = key;
		this.of.page?.setView(key);
		this.of.post({ type: "view", view: key });
		this.of.frames.draw();
	}
}
