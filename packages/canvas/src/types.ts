import type { Frame, PenDocument, PenEdit } from "@decks/pen";
import type { Board, Camera } from "@decks/protocol";
import type { Accessor, JSX } from "solid-js";
import type { ViewStorage } from "./camera/agent-views.ts";
import type { DocEdits, DrawingWriter } from "./render/types.ts";
import type { InkTool } from "./edit/ink.ts";
import type { PenTool } from "./edit/pen-tools.ts";

/*
 * The editor's types, apart from the code that makes it: what a host gives it and gets back
 * (`editor.tsx`, `createEditor`), and what the stage reports (`stage/Stage.tsx`).
 * The frame's protocol and an app's chrome read these without importing either.
 */

/** Where the stage's pictures of boards come from (`Stage`'s `shots`). */
export interface StageShots {
	/** The picture of a board or a card, as an address the sheet can fetch. */
	picture(board: Pick<Board, "path" | "rev">, scheme: "light" | "dark"): string;
}

/** What a comment is about (`Stage`'s `onComment`). */
export interface StageComment {
	path: string;
	title: string;
	quote: string;
	/** The `data-id` of the block the selected words are in, for a comment on words in a board. */
	component?: string;
	items?: string[];
	anchor: () => DOMRect | undefined;
	/** From a pill's Comment: the box opens at once. Words selected show only the small button first. */
	open?: boolean;
}

/** What the pill's ink actions ask for (`onInk`): the strokes, their canvas and where they are. */
export type InkRequest = { action: "drawing" | "board" | "send"; ids: string[]; canvas: string; box: { x: number; y: number; w: number; h: number } };

/** What the canvas frame gives `createEditor`. Only `text` is needed. */
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
	 * The cards and boards on the drawing (its `browser` items with `metadata.type` `decks.card` or
	 * `decks.board`), by their deck path: the address of a card's file, and the picture of each, for
	 * the sheet that draws every board and every card not awake. A board is only ever its picture: the
	 * canvas runs no board's page. Absent: they are drawn as empty frames.
	 */
	boards?: {
		/** A card's address (its `index.html`); for a document or an app item, anything at all. */
		page?(path: string): string | undefined;
		picture?(path: string, scheme: "light" | "dark"): string | undefined;
		/**
		 * Whether a card's scripts run (`card.ts`): a card is drawn in this page, so its script acts as this
		 * page does. Left out, a card runs its scripts unless it is on a canvas a friend shared (`shared/`);
		 * a host whose sandbox comes from its own server's headers (Studio's copy of a friend's canvas)
		 * says no here instead.
		 */
		cardScripts?(path: string): boolean;
		/** Turn on the scripts of a card whose scripts are off here (a card pasted from a friend's canvas): a button on it says so. */
		onScriptsOn?(path: string): void;
		/**
		 * The host's own records of the boards (their revision, format and title), as its server keeps
		 * them, in place of the ones read off the drawing. Read reactively.
		 */
		list?(): Board[];
		/** A card measured itself: its size and how it reads, for the host's agents (`decks.canvas.fit`). */
		onExtent?(path: string, extent: { rev: number; w: number; h: number; at?: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }): void;
		/** A link on a card to a board or card of the deck: open it, and say whether this host has it. */
		onOpenLink?(path: string, from: string): boolean;
		/** Boards written since the person last looked (path to who wrote them): each shows a dot. Read reactively. */
		news?(): Record<string, string>;
		/** The person looked at a board with a dot. */
		onRead?(path: string): void;
		/** A board's Hide, when the host takes it off the canvas itself (its server); absent: taken off this drawing. */
		onHide?(path: string): void;
	};
	/**
	 * The folder the drawing's own relative addresses are read against (image fills, files on the
	 * canvas): normally the URL of the folder the `.pen` file is in. Default: the page's address.
	 */
	base?: string;
	/** `edit` (the default) to change the drawing, `browse` to read it and draw ink over it. */
	mode?: "edit" | "browse";
	/** Nothing can be changed: no tools, no edits. */
	readOnly?: boolean;
	/** Where the camera starts. Default: the view kept for `views.scope`, else a fit of what is on the drawing. */
	camera?: Camera;
	/**
	 * Keep where the person was looking, on this device, per scope: the host says what a view
	 * belongs to and the editor parks and restores it. The Decks app's scope is an agent on a canvas
	 * (`agent@canvas`), so each conversation has its own view; Studio's is the canvas. When the scope
	 * changes, the view is parked under the old one and the new one's comes back, if it still shows
	 * something on the drawing; a scope seen for the first time leaves the camera where it is.
	 */
	views?: {
		scope: () => string | undefined;
		/** Where views are kept: `localStorage` unless said (a test passes its own). */
		storage?: ViewStorage;
		/** What the store is called, so two hosts on one origin keep theirs apart. Default "canvas". */
		key?: string;
	};
	/** The camera moved (a pan, a zoom, a fit). */
	onCamera?: (camera: Camera) => void;
	/** The canvas shown, by name: the stage lands on a new one, and each board's token names it. */
	canvasName?: () => string | undefined;
	/** How big the canvas is on screen, when it changes: a host whose agents ask what the person sees. */
	onViewport?: (viewport: { width: number; height: number }) => void;
	/** Boards or items dragged onto the host's composer, to talk about them. */
	onRefer?: (pills: Array<{ kind: "board" | "item"; id: string; label: string; name?: string }>) => void;
	/**
	 * A drawing the host owns (its server): edits go to `send` as pen operations, each with a name
	 * (`edit`) the host's server sends back with the drawing that has it (`setDocument`'s `made`); undo and redo are `step`'s. Each edit is shown at once and kept on top of
	 * the drawings the host gives until one has it (`drawing.ts`). `send` may answer whether the edit was
	 * made. Absent: the drawing is this page's, and `onEdits` hears every change.
	 */
	document?: { send(ops: unknown[], edit?: string): void | Promise<boolean>; step(direction: "undo" | "redo", edit?: string): void };
	/** The board selected on the canvas, or none. */
	onSelect?: (path: string | undefined) => void;
	/** Comment on a board or on drawn items (the comment buttons; absent: none). */
	onComment?: (comment: StageComment) => void;
	/** Export drawn items as a picture (the properties panel's export; absent: nothing happens). */
	onExport?: (ids: string[]) => void;
	/**
	 * Draw the canvas's own column of tools. Default: true. A host with its own tools turns it off
	 * and drives them with `setTool`; the properties panel still shows for what is selected.
	 */
	toolbar?: boolean;
	/**
	 * A board's file to delete, from the board pill's Delete: the host deletes it (asking first, if it
	 * likes) and says whether it did; the board then leaves the drawing. Absent: no Delete on the pill.
	 */
	onDeleteBoard?: (path: string) => boolean | void | Promise<boolean | void>;
	/**
	 * Ink selected, and the pill's Make a drawing, Make a board or Send pressed (`Stage`'s `onInk`): the host
	 * hands it to `inkAgent`, the agent on screen, by name; without either, the pill has no such actions.
	 */
	onInk?: (request: InkRequest) => void;
	inkAgent?: () => string | undefined;
	/** The drawn items selected changed (their ids), by the person or by `select`. */
	onSelection?: (ids: readonly string[]) => void;
}

/** The editor's handle, inside the canvas frame (and to an app's chrome there, `frame/chrome.ts`). */
export interface CanvasHandle {
	/**
	 * A newer drawing arrived from elsewhere (another device, an agent): draw it. Not an edit, so no
	 * `onEdits`. `made`: with `document`, the names of the person's edits it is the first to have.
	 */
	setDocument(text: string | PenDocument, base?: string, made?: readonly string[]): void;
	/**
	 * What changed in the drawing elsewhere, as edits (`@decks/pen`'s `PenEdit`s, what a host hears as
	 * a delta): applied to the drawing shown, and by the stage's engines to theirs, so a change costs
	 * what it touched rather than the whole drawing parsed, compared and laid out again. Not an edit,
	 * so no `onEdits`. False when they do not apply to the drawing shown: send it whole with `setDocument`.
	 */
	applyEdits(edits: readonly PenEdit[], base?: string, made?: readonly string[]): boolean;
	/** With `document`: the host's server did not make the person's edit of this name (`send`'s `edit`); it stops being shown. */
	refused(edit: string): void;
	/** The drawing as it is shown now, the person's edits on their way included: read reactively. */
	drawn(): PenDocument;
	/** Move the camera there, gliding unless `ms` is 0: an agent showing the person something. */
	glide(camera: Camera, ms?: number): void;
	/** The drawing as it is now. */
	document(): PenDocument;
	/** The drawing as `.pen` text. */
	text(): string;
	setDark(dark: boolean): void;
	setMode(mode: "edit" | "browse"): void;
	/** Turn ink on (browse mode: pen, marker, eraser and lasso over the canvas) or off, with that ink tool in hand. */
	setDrawing(on: boolean, tool?: InkTool): void;
	/** Take a tool in hand, in edit mode: `select` puts it down. */
	setTool(tool: PenTool): void;
	/** The tool in hand now. */
	tool(): PenTool;
	/** Fit everything on the drawing in the host. */
	fit(): void;
	/** Select these drawn items (a host's list of layers), or none; with `page`, that card or board is the one selected, as a press on it makes it. */
	select(ids: readonly string[], page?: string): void;
	/** What is selected, by id: the drawn items, and the card or board selected by a press on it. */
	selection?(): string[];
	/**
	 * Paste what the page's clipboard had, when the page had the focus: a copy of items (`@decks/pen`'s
	 * clip, as JSON) or words, put in where the pointer is over the canvas, else in the middle of the view.
	 */
	paste?(data: { clip?: string; text?: string }): void;
	/** Apply pen operations as the person's edit (`@decks/pen`'s `Op`s): `onEdits` hears it. */
	edit(ops: unknown[]): void;
	undo(): void;
	redo(): void;
	/** The camera now, and moving it. */
	camera(): Camera;
	setCamera(camera: Camera): void;
	/** A card's file changed where it comes from (a drop, an agent's edit): it loads again. */
	reloadBoard(path: string): void;
	/** The canvas opened on the view kept for its scope (`views`), rather than on a fit. */
	readonly restored: boolean;
	dispose(): void;
}


/**
 * State a host keeps itself and the editor reads and writes (the Decks app's camera, selection and
 * mode are the app's own): each a getter and a setter. What is not given, the editor keeps. The
 * framed editor (`frame/outside/host.tsx`) keeps all of it in step with its frame; `createEditor` itself
 * takes only the mode and the ink (`EditorOwnState`), which is what the canvas frame keeps.
 */
export interface EditorState {
	camera?: [Accessor<Camera>, (camera: Camera) => void];
	/** A glide the host asked for, with the camera it set: the stage animates to it while the token is new. */
	glide?: Accessor<{ token: number; ms: number } | undefined>;
	selected?: [Accessor<string | undefined>, (path: string | undefined) => void];
	mode?: [Accessor<"edit" | "browse">, (mode: "edit" | "browse") => void];
	/** Whether ink is in hand. */
	inking?: Accessor<boolean>;
	/**
	 * The drawing as the host has it (with `document`, the host owns it), and the folder its own
	 * addresses are read against; undefined while there is none to show.
	 */
	/**
	 * `edits`, when the host has them: what made this drawing from the one it gave before (`DocEdits`).
	 * With `document`: `made`, the person's edits it is the first to have (by the names `send` was given),
	 * and `scope`, which drawing it is (the canvas): one of another scope drops the edits on their way.
	 */
	pen?: Accessor<{ doc: PenDocument; base: string; edits?: DocEdits; made?: readonly string[]; scope?: string; writer?: DrawingWriter } | undefined>;
}

/** What of `EditorState` the editor made in a host's own tree reads: the mode and the ink. */
export type EditorOwnState = Pick<EditorState, "mode" | "inking">;

/** The editor, made in the host's own tree (`createEditor`): its handle, and what it draws. */
export interface Editor {
	handle: CanvasHandle;
	/** The stage alone, for a host that lays out its own work area and tool bars (the Decks app). */
	surface: () => JSX.Element;
	/** The whole editor: the stage in its work area, the drawing's tools and ink (the frame with no chrome of its own). */
	root: () => JSX.Element;
	dispose(): void;
}
