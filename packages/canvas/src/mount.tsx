import { baseTheme, parse, placements, serialize, type Frame, type PenDocument, type PenEdit } from "@decks/pen";
import type { Camera } from "@decks/protocol";
import { createMemo, createSignal, Show, untrack } from "solid-js";
import { render } from "solid-js/web";
import { fitInto } from "./camera/camera.ts";
import { canvasBox } from "./camera/insets.ts";
import { boardsOf, createDrawing } from "./drawing.ts";
import { setCanvasHost, type CanvasHost } from "./host.ts";
import { InkBar } from "./ink/InkBar.tsx";
import { setCanvasScheme } from "./lib/theme.ts";
import { PenBar } from "./pen/PenBar.tsx";
import { PlainBoard } from "./plain-board.tsx";
import { Stage, type StageComment } from "./Stage.tsx";
import { drawing as inkOn, setDrawing } from "./state/ink.ts";
import { setPenTool } from "./state/pen-tools.ts";

/** What a host gives `mountCanvas`. Only `text` is needed. */
export interface CanvasOptions {
	/** The drawing: a `.pen` file's text (`canvas.pen`). */
	text: string;
	/** Draw in the dark scheme. Default: light. */
	dark?: boolean;
	/**
	 * The person changed the drawing: the edits that make the last document into this one
	 * (`@decks/pen`'s `diff`), and the new document. The host saves them; the canvas has already
	 * drawn them. Undo and redo arrive here too, as the edits they make.
	 */
	onEdits?: (edits: PenEdit[], doc: PenDocument) => void;
	/**
	 * The boards on the drawing (its `browser` items with `metadata.type: "decks.board"`), by their
	 * deck path: the address of a board's live page, if it has one here, and of its picture, for
	 * the sheet that draws every board without a page. Absent: boards are drawn as empty frames.
	 */
	boards?: {
		page?(path: string): string | undefined;
		picture?(path: string, scheme: "light" | "dark"): string | undefined;
	};
	/**
	 * The folder the drawing's own relative addresses are read against (image fills, files on the
	 * canvas): normally the URL of the folder the `.pen` file is in. Default: the page's address.
	 */
	base?: string;
	/** Where a deck file is read (an image or a file opened in a tab). Default: `path` against `base`. */
	resolveUrl?: (path: string, rev?: number) => string;
	/** Where an icon's SVG is, before the CDN is asked. */
	icons?: (library: string, name: string, weight: number) => string | undefined;
	/** A link on the drawing that names a board this host opens on the canvas: that board's path. */
	boardLink?: (href: string, base: string) => string | undefined;
	/** `edit` (the default) to change the drawing, `browse` to read it and draw ink over it. */
	mode?: "edit" | "browse";
	/** Nothing can be changed: no tools, no edits. */
	readOnly?: boolean;
	/** Where the camera starts. Default: fit what is on the drawing. */
	camera?: Camera;
	/** The camera moved (a pan, a zoom, a fit). */
	onCamera?: (camera: Camera) => void;
	/** The board selected on the canvas, or none. */
	onSelect?: (path: string | undefined) => void;
	/** Comment on a board or on drawn items (the comment buttons; absent: none). */
	onComment?: (comment: StageComment) => void;
	/** Export drawn items as a picture (the properties panel's export; absent: nothing happens). */
	onExport?: (ids: string[]) => void;
}

/** A mounted canvas. */
export interface CanvasHandle {
	/** A newer drawing arrived from elsewhere (another device, an agent): draw it. Not an edit, so no `onEdits`. */
	setDocument(text: string | PenDocument): void;
	/** The drawing as it is now. */
	document(): PenDocument;
	/** The drawing as `.pen` text. */
	text(): string;
	setDark(dark: boolean): void;
	setMode(mode: "edit" | "browse"): void;
	/** Turn ink on (browse mode: pen, marker, eraser and lasso over the canvas) or off. */
	setDrawing(on: boolean): void;
	/** Apply pen operations as the person's edit (`@decks/pen`'s `Op`s): `onEdits` hears it. */
	edit(ops: unknown[]): void;
	undo(): void;
	redo(): void;
	/** The camera now, and moving it. */
	camera(): Camera;
	setCamera(camera: Camera): void;
	dispose(): void;
}

/** A camera that shows everything on the drawing, in a host this big. */
export function fitAll(doc: PenDocument, view: { width: number; height: number }, look: "light" | "dark" = "light"): Camera {
	const placed = placements(doc, { theme: baseTheme(doc, look) });
	const boxes = (doc.children ?? []).map((node) => placed.get(node.id)?.box).filter((box): box is Frame => box !== undefined && box.w > 0 && box.h > 0);
	return fitInto(boxes, view, canvasBox(view));
}

/** The empty picture: a board with no picture source is drawn as a blank sheet. */
const BLANK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/%3E";

/**
 * Mount the Decks canvas in `host`: the stage, its camera, the drawing's tools and properties,
 * and ink, editing a `.pen` document held here. Every change the person makes is applied here at
 * once and reported to `onEdits`; `setDocument` takes one from elsewhere.
 *
 * One canvas to a page: the tools and the host's answers are module state, as they are in the
 * Decks app.
 */
export function mountCanvas(host: HTMLElement, options: CanvasOptions): CanvasHandle {
	const base = options.base ?? (typeof location === "undefined" ? "/" : location.href);
	const answers: Partial<CanvasHost> = {
		fileUrl: options.resolveUrl ?? ((path) => new URL(path, new URL(base, typeof location === "undefined" ? "http://canvas.invalid/" : location.href)).href),
		canWrite: () => !options.readOnly,
		boardLink: options.boardLink ?? (() => undefined),
		iconUrl: options.icons,
	};
	setCanvasHost(answers);

	const opening = options.camera ?? fitAll(parse(options.text), { width: host.clientWidth, height: host.clientHeight }, options.dark ? "dark" : "light");
	const [camera, setCameraSignal] = createSignal<Camera>(opening);
	const [mode, setModeSignal] = createSignal<"edit" | "browse">(options.mode ?? "edit");
	const [selected, setSelected] = createSignal<string | undefined>();
	const [dark, setDarkSignal] = createSignal(options.dark === true);
	const look = () => (dark() ? "dark" : "light");
	/*
	 * On the host, and on the page's root as the Decks app does: the menus and panels the canvas
	 * opens in a portal on <body> read their colours from there.
	 */
	const rootScheme = document.documentElement.dataset.colorScheme;
	const paintScheme = () => {
		setCanvasScheme(look());
		host.dataset.colorScheme = look();
		document.documentElement.dataset.colorScheme = look();
	};
	paintScheme();

	const drawing = createDrawing(options.text, { look, readOnly: options.readOnly === true, ...(options.onEdits ? { onEdits: options.onEdits } : {}) });
	const { doc, edit, step, moveBoard, resizeBoard } = drawing;
	const boards = createMemo(() => boardsOf(doc()));

	const setCamera = (next: Camera) => {
		setCameraSignal(next);
		options.onCamera?.(next);
	};

	const editable = !options.readOnly;
	/* Fixed for the canvas's life: plain objects, so no prop of the stage is a computation of its own. */
	const editing = editable ? { onPenEdit: edit, onResize: resizeBoard } : {};
	const commenting = options.onComment ? { onComment: options.onComment } : {};

	const dispose = render(() => {
		const pen = createMemo(() => ({ doc: doc(), base }));
		/* Memos rather than `a() && b()` in the props: the stage reads them in its pointer handlers, outside any owner. */
		const inking = createMemo(() => inkOn() && mode() === "browse");
		return (
			<div class="decks-canvas app" data-mode={mode()}>
				<div class="work">
					<div class="surface" data-surface="stage">
						<div class="surface-layer" data-layer="stage">
							<Stage
								mode={mode()}
								renderer="dom"
								boardsMayStart={true}
								opening={{ camera: opening }}
								boards={boards()}
								pen={pen()}
								{...editing}
								onPenStep={step}
								drawing={inking()}
								camera={camera()}
								setCamera={setCamera}
								selected={selected()}
								onSelect={(path) => {
									setSelected(path);
									options.onSelect?.(path);
									/* A press on bare canvas takes the focus, which is how an edit in a note or a board ends (as in the Decks app). */
									if (!path) host.querySelector<HTMLElement>(".stage")?.focus();
								}}
								onMove={moveBoard}
								frame={(slot) => <PlainBoard {...slot} page={options.boards?.page?.(slot.board.path)} />}
								shots={() => ({
									picture: (board, scheme) => options.boards?.picture?.(board.path, scheme) ?? BLANK,
									ownPicture: true,
								})}
								{...commenting}
							/>
						</div>
					</div>
				</div>
				<Show when={editable && !inking()}>
					<PenBar doc={doc()} onEdit={edit} onStep={step} onArm={() => {}} onExport={(ids) => options.onExport?.(ids)} />
				</Show>
				<Show when={editable && inking()}>
					<InkBar onDone={() => setDrawing(false)} onStep={step} onDelete={(ids) => edit(ids.map((id) => ({ op: "delete", id })))} />
				</Show>
			</div>
		);
	}, host);

	return {
		setDocument: (next) => drawing.set(next),
		document: () => untrack(doc),
		text: () => serialize(untrack(doc)),
		setDark(on) {
			setDarkSignal(on);
			paintScheme();
		},
		setMode(next) {
			if (next === "edit") setDrawing(false);
			setPenTool("select");
			setModeSignal(next);
		},
		setDrawing(on) {
			if (on) setModeSignal("browse");
			setDrawing(on);
		},
		edit,
		undo: () => step("undo"),
		redo: () => step("redo"),
		camera: () => untrack(camera),
		setCamera,
		dispose() {
			dispose();
			setDrawing(false);
			setPenTool("select");
			delete host.dataset.colorScheme;
			if (rootScheme === undefined) delete document.documentElement.dataset.colorScheme;
			else document.documentElement.dataset.colorScheme = rootScheme;
		},
	};
}
