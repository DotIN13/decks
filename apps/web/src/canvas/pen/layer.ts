import type { CanvasKit, Image, SkPicture as Picture, Surface } from "canvaskit-wasm";
import { baseTheme, expand, isArrow, layout, reroute, walk, textStyleOf, type Frame, type PenDocument, type PenNode, type Placed } from "@decks/pen";
import type { Camera } from "@decks/protocol";
import { canvasKit } from "./canvaskit.ts";
import { PenFonts, type FontNeed } from "./fonts.ts";
import { paintDocument } from "./paint.ts";

/**
 * The stage's drawing layer: one `<canvas>` under the boards, drawn by CanvasKit.
 *
 * The document is laid out and recorded **once per change** into a Skia picture in stage
 * coordinates; every frame after that only replays the picture under the camera — a translate and
 * a scale — so a pan or a pinch costs the same whether the drawing has five items or five hundred,
 * and stays sharp at any zoom because the picture is vectors, not pixels.
 *
 * It follows the camera by being told, in the same call that moves the boards' transform
 * (`Stage.writeTransform`), and draws at most once per animation frame. Pointer events pass
 * through it: the drawing is read-only to the person for now.
 *
 * CanvasKit is loaded the first time a document has anything in it, never for an empty stage.
 */

export class PenLayer {
	private element: HTMLCanvasElement | undefined;
	private ck: CanvasKit | undefined;
	private fonts: PenFonts | undefined;
	private surface: Surface | undefined;
	private surfaceSize = "";
	private picture: Picture | undefined;
	private doc: PenDocument | undefined;
	private base = "";
	private scheme: "light" | "dark" = "light";
	private camera: Camera = { x: 0, y: 0, zoom: 1 };
	private view = { width: 0, height: 0 };
	private dirty = true;
	private frame = 0;
	private starting: Promise<void> | undefined;
	private readonly images = new Map<string, Image | "loading" | "failed">();
	/** Where the boards are, for an arrow that ends on one. */
	private boards = new Map<string, Frame>();
	private boardKey = "";
	private disposed = false;
	/** The layout last drawn, by id, for whoever needs to know where an item is. */
	placed: ReadonlyMap<string, Placed> = new Map();

	attach(element: HTMLCanvasElement): void {
		this.element = element;
		this.surfaceSize = "";
		this.schedule();
	}

	setDoc(doc: PenDocument | undefined, base: string): void {
		if (doc === this.doc && base === this.base) return;
		this.doc = doc;
		this.base = base;
		this.dirty = true;
		if (doc && doc.children.length > 0) void this.start();
		this.schedule();
	}

	/** The boards on this stage, by path: an arrow may end on one, and follows it when it moves. */
	setBoards(boards: ReadonlyArray<{ path: string; x: number; y: number; w: number; h: number }>): void {
		const key = boards.map((b) => `${b.path}@${b.x},${b.y},${b.w},${b.h}`).join("|");
		if (key === this.boardKey) return;
		this.boardKey = key;
		this.boards = new Map(boards.map((b) => [b.path, { x: b.x, y: b.y, w: b.w, h: b.h }]));
		if (this.doc && [...walk(this.doc.children)].some((node) => isArrow(node))) {
			this.dirty = true;
			this.schedule();
		}
	}

	setScheme(scheme: "light" | "dark"): void {
		if (scheme === this.scheme) return;
		this.scheme = scheme;
		this.dirty = true;
		this.schedule();
	}

	setCamera(camera: Camera): void {
		this.camera = camera;
		this.schedule();
	}

	setView(view: { width: number; height: number }): void {
		if (view.width === this.view.width && view.height === this.view.height) return;
		this.view = view;
		this.schedule();
	}

	dispose(): void {
		this.disposed = true;
		cancelAnimationFrame(this.frame);
		this.picture?.delete();
		this.picture = undefined;
		this.surface?.delete();
		this.surface = undefined;
		for (const image of this.images.values()) if (typeof image === "object") image.delete();
		this.images.clear();
	}

	private start(): Promise<void> {
		this.starting ??= canvasKit().then((ck) => {
			if (this.disposed) return;
			this.ck = ck;
			this.fonts = new PenFonts(ck);
			this.dirty = true;
			this.schedule();
		});
		return this.starting;
	}

	private schedule(): void {
		if (this.frame || this.disposed) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.render();
		});
	}

	/** What the document's words need from the font CDN; asked before the first layout, and again when it changes. */
	private fontsFor(nodes: readonly PenNode[], doc: PenDocument, theme: ReturnType<typeof baseTheme>): FontNeed[] {
		const needs: FontNeed[] = [];
		for (const node of walk(nodes)) {
			if (typeof node.content !== "string" || !node.content) continue;
			const style = textStyleOf(doc, node, theme);
			needs.push({ family: style.fontFamily, weight: style.fontWeight, italic: style.fontStyle === "italic", text: node.content });
		}
		return needs;
	}

	private rebuild(): void {
		const { ck, fonts } = this;
		let doc = this.doc;
		if (!ck || !fonts) return;
		this.picture?.delete();
		this.picture = undefined;
		this.placed = new Map();
		if (!doc || doc.children.length === 0) return;
		const theme = baseTheme(doc, this.scheme);
		/*
		 * Arrows are routed here as well as on the server: a file written by hand, or a board dragged
		 * a moment ago, has arrows whose geometry the server has not redrawn yet. The copy is only for
		 * drawing; the file is the server's to rewrite.
		 */
		if ([...walk(doc.children)].some((node) => isArrow(node))) {
			const copy = structuredClone(doc);
			if (reroute(copy, layout(copy, expand(copy), { theme, measure: fonts.measure }), (path) => this.boards.get(path))) doc = copy;
		}
		const nodes = expand(doc);
		const generation = fonts.generation;
		void fonts.need(this.fontsFor(nodes, doc, theme)).then((fresh) => {
			// A font landed after this picture was drawn without it: lay out and draw again.
			if (fresh && fonts.generation !== generation && !this.disposed) {
				this.dirty = true;
				this.schedule();
			}
		});
		const placed = layout(doc, nodes, { theme, measure: fonts.measure });
		this.placed = placed;
		const recorder = new ck.PictureRecorder();
		const canvas = recorder.beginRecording(ck.LTRBRect(-1e7, -1e7, 1e7, 1e7));
		paintDocument(canvas, nodes, { ck, fonts, doc, placed, scheme: this.scheme, image: (url) => this.image(url) });
		this.picture = recorder.finishRecordingAsPicture();
		recorder.delete();
	}

	/** An image fill's picture, fetched once; the drawing is redone when it arrives. */
	private image(url: string): Image | undefined {
		const absolute = new URL(url, new URL(this.base || "/", location.href)).href;
		const known = this.images.get(absolute);
		if (known === "loading" || known === "failed") return undefined;
		if (known) return known;
		this.images.set(absolute, "loading");
		void fetch(absolute)
			.then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
			.then((bytes) => {
				const image = this.ck?.MakeImageFromEncoded(new Uint8Array(bytes));
				this.images.set(absolute, image ?? "failed");
				this.dirty = true;
				this.schedule();
			})
			.catch(() => this.images.set(absolute, "failed"));
		return undefined;
	}

	private render(): void {
		const { element, ck } = this;
		if (!element || this.disposed) return;
		const empty = !this.doc || this.doc.children.length === 0;
		element.hidden = empty;
		if (empty || !ck) return;
		const dpr = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(this.view.width * dpr));
		const height = Math.max(1, Math.round(this.view.height * dpr));
		const size = `${width}x${height}`;
		if (!this.surface || size !== this.surfaceSize) {
			this.surface?.delete();
			element.width = width;
			element.height = height;
			this.surface = ck.MakeWebGLCanvasSurface(element) ?? ck.MakeSWCanvasSurface(element) ?? undefined;
			this.surfaceSize = size;
			if (!this.surface) return;
		}
		if (this.dirty) {
			this.dirty = false;
			this.rebuild();
		}
		const canvas = this.surface.getCanvas();
		canvas.clear(ck.TRANSPARENT);
		if (this.picture) {
			canvas.save();
			canvas.scale(dpr, dpr);
			canvas.translate(this.view.width / 2, this.view.height / 2);
			canvas.scale(this.camera.zoom, this.camera.zoom);
			canvas.translate(-this.camera.x, -this.camera.y);
			canvas.drawPicture(this.picture);
			canvas.restore();
		}
		this.surface.flush();
	}
}
