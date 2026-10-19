import { apply, baseTheme, diff, parse, placements, reroute, serialize, walk, type Frame, type PenDocument, type PenEdit, type PenNode } from "@decks/pen";
import type { Board, Camera } from "@decks/protocol";
import { batch, createMemo, createSignal, Show, untrack } from "solid-js";
import { render } from "solid-js/web";
import { fitInto } from "./camera/camera.ts";
import { canvasBox } from "./camera/insets.ts";
import { setCanvasHost, type CanvasHost } from "./host.ts";
import { InkBar } from "./ink/InkBar.tsx";
import { setCanvasScheme } from "./lib/theme.ts";
import { PenBar } from "./pen/PenBar.tsx";
import { PlainBoard } from "./plain-board.tsx";
import { Stage, type StageComment } from "./Stage.tsx";
import { drawing, setDrawing } from "./state/ink.ts";
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

const isBoard = (node: PenNode) => node.type === "browser" && (node.metadata as { type?: string } | undefined)?.type === "decks.board";
const boardPath = (node: PenNode) => String((node.metadata as { path?: unknown }).path ?? node.id);
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** The drawing's boards, as the stage takes them. Top-level only: a board's x and y are the canvas's. */
export function boardsOf(doc: PenDocument): Board[] {
	const boards: Board[] = [];
	for (const node of doc.children ?? []) {
		if (!isBoard(node)) continue;
		boards.push({
			path: boardPath(node),
			title: typeof node.name === "string" && node.name ? node.name : boardPath(node),
			format: "board",
			x: num(node.x, 0),
			y: num(node.y, 0),
			w: num(node.width, 960),
			h: num(node.height, 640),
			rev: 0,
			inContext: [],
		});
	}
	return boards;
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

	const [doc, setDoc] = createSignal<PenDocument>(parse(options.text));
	const opening = options.camera ?? fitAll(untrack(doc), { width: host.clientWidth, height: host.clientHeight }, options.dark ? "dark" : "light");
	const [camera, setCameraSignal] = createSignal<Camera>(opening);
	const [mode, setModeSignal] = createSignal<"edit" | "browse">(options.mode ?? "edit");
	const [selected, setSelected] = createSignal<string | undefined>();
	const [dark, setDarkSignal] = createSignal(options.dark === true);
	const look = () => (dark() ? "dark" : "light");
	const paintScheme = () => {
		setCanvasScheme(look());
		host.dataset.colorScheme = look();
	};
	paintScheme();

	/** The person's own edits, to step back and forward through: each entry is the document before (undo) or after (redo). */
	const undoStack: PenDocument[] = [];
	const redoStack: PenDocument[] = [];

	/** Arrows follow what they join: the drawing's arrows are routed again after every edit, as the Decks server does. */
	const rerouted = (next: PenDocument) => {
		const placed = placements(next, { theme: baseTheme(next, look()) });
		const byPath = new Map<string, string>();
		for (const node of walk(next.children ?? [])) if (isBoard(node)) byPath.set(boardPath(node), node.id);
		reroute(next, placed, (name): Frame | undefined => {
			const id = byPath.get(name);
			return id ? placed.get(id)?.box : undefined;
		});
		return next;
	};

	/** Show `next` and tell the host what changed. */
	const commit = (prev: PenDocument, next: PenDocument) => {
		const edits = diff(prev, next);
		if (edits.length === 0) return false;
		setDoc(next);
		options.onEdits?.(edits, next);
		return true;
	};

	const edit = (ops: unknown[]) => {
		if (options.readOnly || ops.length === 0) return;
		const prev = untrack(doc);
		let next: PenDocument;
		try {
			next = rerouted(apply(prev, ops as Parameters<typeof apply>[1], { theme: baseTheme(prev, look()) }).doc);
		} catch (error) {
			console.warn("[canvas] an edit was refused:", error instanceof Error ? error.message : error);
			return;
		}
		if (commit(prev, next)) {
			undoStack.push(prev);
			if (undoStack.length > 200) undoStack.shift();
			redoStack.length = 0;
		}
	};

	const step = (direction: "undo" | "redo") => {
		const from = direction === "undo" ? undoStack : redoStack;
		const to = direction === "undo" ? redoStack : undoStack;
		const target = from.pop();
		if (!target) return;
		const now = untrack(doc);
		to.push(now);
		commit(now, target);
	};

	const boards = createMemo(() => boardsOf(doc()));
	/** A board moved or resized on the canvas is its item on the drawing moved or resized. */
	const boardId = (path: string) => untrack(doc).children?.find((node) => isBoard(node) && boardPath(node) === path)?.id;
	const moveBoard = (path: string, x: number, y: number) => {
		const id = boardId(path);
		if (id) edit([{ op: "update", id, set: { x: Math.round(x), y: Math.round(y) } }]);
	};
	const resizeBoard = (path: string, size: { w: number; h: number }) => {
		const id = boardId(path);
		if (id) edit([{ op: "update", id, set: { width: Math.round(size.w), height: Math.round(size.h) } }]);
	};

	const setCamera = (next: Camera) => {
		setCameraSignal(next);
		options.onCamera?.(next);
	};

	const pen = createMemo(() => ({ doc: doc(), base }));
	const editable = () => !options.readOnly;

	const dispose = render(
		() => (
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
								{...(editable() ? { onPenEdit: edit } : {})}
								onPenStep={step}
								drawing={drawing() && mode() === "browse"}
								camera={camera()}
								setCamera={setCamera}
								selected={selected()}
								onSelect={(path) => {
									setSelected(path);
									options.onSelect?.(path);
								}}
								onMove={moveBoard}
								{...(editable() ? { onResize: resizeBoard } : {})}
								frame={(slot) => <PlainBoard {...slot} page={options.boards?.page?.(slot.board.path)} />}
								shots={() => ({
									picture: (board, scheme) => options.boards?.picture?.(board.path, scheme) ?? BLANK,
									ownPicture: true,
								})}
								{...(options.onComment ? { onComment: options.onComment } : {})}
							/>
						</div>
					</div>
				</div>
				<Show when={editable() && !(drawing() && mode() === "browse")}>
					<PenBar
						doc={doc()}
						onEdit={edit}
						onStep={step}
						onArm={() => {}}
						onExport={(ids) => options.onExport?.(ids)}
					/>
				</Show>
				<Show when={editable() && drawing() && mode() === "browse"}>
					<InkBar onDone={() => setDrawing(false)} onStep={step} onDelete={(ids) => edit(ids.map((id) => ({ op: "delete", id })))} />
				</Show>
			</div>
		),
		host,
	);

	return {
		setDocument(next) {
			const value = typeof next === "string" ? parse(next) : next;
			batch(() => setDoc(value));
		},
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
		},
	};
}

