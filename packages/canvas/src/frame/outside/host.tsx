import type { Camera } from "@decks/protocol";
import { createSignal, untrack, type JSX } from "solid-js";
import type { EditorState, CanvasComment } from "../../view/types.ts";
import type { PenTool } from "../../edit/pen-tools.ts";
import type { InkTool } from "../../ink/ink.ts";
import { type ComposerPart, type FrameCalls, type CardSlot, type PageEnd, type Rect } from "../protocol.ts";
import { createSurface } from "./surface.tsx";
import { createSync } from "./sync.ts";
import { createWire } from "./wire.ts";
import { createStart } from "./start.ts";
import { createFrameFocus } from "./focus.ts";
import { createFrameStores } from "./stores.ts";
import { forgetFrameZoom, mirrorTools } from "../tools-mirror.ts";


/** What the page answers for its frame beyond the editor's own options. */
export interface FrameHostOptions {
	/**
	 * A pass for one canvas (`server/src/auth/passes.ts`): the harness as the frame reaches it (`api`), the
	 * pass for its calls (`token`), the addresses its files and pictures are read at with the pass in them,
	 * and when it runs out. Asked for again at half its life, unseen: the frame reads, follows and edits
	 * its canvas on it.
	 */
	pass(canvas: string): Promise<CanvasPass>;
	/**
	 * Whether the frame showing `from` may move to `to` in place, keeping its loaded code rather than
	 * being made again: both must be yours alone (not a friend's, and nobody else may edit them), since
	 * a card's script can leave code running in the frame after its card is gone. Left out: never.
	 */
	inPlace?(from: string, to: string): boolean;
	/**
	 * The canvases to keep a frame for behind the one on screen, by name: each stays as it was, following
	 * its canvas out of sight, and comes forward at once when the page moves to it (`surface.tsx`). As
	 * many as the device can bear is the page's to say. Left out: none, and a move makes the frame again
	 * or moves it in place.
	 */
	kept?(): readonly string[];
	/**
	 * Keep one more frame spare, on no canvas, its code loaded and its drawing engine started while
	 * nothing waits for it: the next canvas that needs a new frame takes it, and another is made a
	 * moment later (`surface.tsx`). For a device with memory to spare. Left out: none.
	 */
	spare?(): boolean;
	/** Your role on the canvas on screen. */
	role?(canvas: string): "owner" | "edit" | "view";
	/** A card's agent call, or showing another canvas (`frame/card-calls.ts`): the page answers it with your token, asking first before a message goes to an agent. */
	agent?(call: FrameCalls["agent"]["data"]): Promise<unknown>;
	/** Where what the frame keeps between visits is kept: this page's own storage. */
	storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
	/** A comment written in the frame's popover: put in the composer as a draft, kept or to send, never sent from here. */
	comment?(comment: NonNullable<ComposerPart["comment"]>): void;
	/** A sketch to turn into something: a draft for the composer, never sent from here. */
	ink?(ink: NonNullable<ComposerPart["ink"]>): void;
	/** Open one of the app's panels: the apps list, or the file picker (`files`), whose file is put in the middle of the frame's view. */
	panel?(name: "apps" | "files"): void;
	/** Open an app in a tab of its own (`decks.app`), outside the canvas's sandbox. */
	openApp?(name: string): void;
	/** The page has tabs of its own: a card, a document or an app opened whole from its pill (New tab) comes here, by what it is. Without it the pill opens the browser's tab. */
	openTab?(item: { kind: "card" | "document" | "app"; target: string; browser?: true }): void;
	/** A link on the canvas to something in the deck, followed: its address in this window, `#canvas/…`, `#card/…`, `#doc/…` or `#app/…`, for the page to read and open as a tab. */
	openAt?(link: { address: string; browser?: true }): void;
	/** The page's composer: the frame is told where it is, so a drag let go over it mentions what it carries. */
	composer?(): HTMLElement | undefined;
	/** How far up from the bottom the page's dock reaches, in pixels: a phone's tool row goes above it. */
	dock?(): number;
	/** A sheet is open over the canvas's foot (the properties drawer on a phone), or closed again: the page's dock makes way for it. */
	sheet?(open: boolean): void;
	/** Each agent's name and colour, for what is new on the canvas. */
	agents?(): Record<string, { name: string; color: string }>;
	/** The conversation on screen, whose `decks view …` the frame carries out on its canvas. */
	focused?(): string | undefined;
	/** A view for another conversation, from an agent's `decks view …` on this canvas: the page keeps it for when that chat opens, and the harness hears it, to answer that agent's `view.camera`. `canvas` names the canvas the view is of, which is the frame's that said it: the one on screen, or one kept behind it (`kept`), where the chat on screen's own agent's view is kept this way too. */
	viewFor?(agent: string, camera: Camera, selected?: string, canvas?: string): void;
	/** Move a conversation to a canvas, as the page's canvas switcher does: an agent's `view.goto` the person said Go to. */
	moveTo?(agent: string, canvas: string): void;
	/** A card or item was taken off the canvas with its ×: say so, with `undo`, which puts it back. */
	hidden?(title: string, undo: () => void): void;
	/** A file dropped on the canvas, its bytes, for the page to upload and place. */
	upload?(drop: { files: File[]; at: { x: number; y: number }; card?: CardSlot }): void;
}

/** One canvas's pass, as the frame is given it. */
export interface CanvasPass {
	api: string;
	token: string;
	files: string;
	pictures: string;
	expires: number;
	kind?: "harness" | "studio";
	/** The deck's import map (`/api/passes`): names to another site's addresses, or to paths under `assets/`, read beside the canvas's cards. Left out (Studio's), each card looks for one itself. */
	imports?: Record<string, string>;
}


/** What a page gives `createFramedEditor`: how the canvas looks, the page's state kept in step with it, and what it hears from it. */
export interface FramedEditorOptions {
	/** The canvas on screen, by name: the frame is made again, on a pass for it, when it changes. */
	canvasName: () => string | undefined;
	/** Draw in the dark scheme. Default: light. */
	dark?: boolean;
	/** `edit` (the default) to change the drawing, `browse` to read it and draw ink over it. */
	mode?: "edit" | "browse";
	/** Nothing can be changed: no tools, no edits. */
	readOnly?: boolean;
	/** The frame draws the canvas's own column of tools (when it has no chrome of its own). Default: true. */
	toolbar?: boolean;
	/**
	 * The page draws the tools itself (the tool column, the pen tray, the properties, the zoom), on its own
	 * page over the frame, from the same components and the same signals (`@decks/canvas/tools`): the frame
	 * draws none, and the two ends' signals are kept in step (`frame/tools-mirror.ts`). Default: false.
	 */
	pageTools?: boolean;
	/**
	 * The bare keys the page's own tools take, a letter each (the Decks app's hand, pen and line): pressed
	 * with the keyboard on the canvas and not taken by it or typed into anything, they are played on the
	 * page as a key with a modifier already is. Only with `pageTools`.
	 */
	pageKeys?: readonly string[];
	/**
	 * Keys the page's tools take ahead of the canvas's own, where an app's tools mean something else by a
	 * letter than the canvas does (Studio's V, H, P and C, its + and −, ⇧1 and ⇧0): pressed with the
	 * keyboard on the canvas, not typed into anything and not in a card, they are heard first, played on
	 * the page, and the canvas does nothing with them. Each is a key as typed, in lower case (`"v"`, `"+"`),
	 * or a key's code with its Shift (`"shift+Digit1"`). Only with `pageTools`.
	 */
	pageKeysFirst?: readonly string[];
	/** Where the camera starts, unless `state.camera` says. */
	camera?: Camera;
	/** The page's own camera, selection, mode and ink (and its copy of the drawing), kept in step with the frame. */
	state?: EditorState;
	pages?: {
		/** A link on a card to another of the deck: open it, and say whether this page has it. */
		onOpenLink?(path: string, from: string): boolean;
	};
	/** The camera came to rest after the person moved it. */
	onCamera?: (camera: Camera) => void;
	/** The card selected, or none. */
	onSelect?: (path: string | undefined) => void;
	/** The drawn items selected changed (their ids). */
	onSelection?: (ids: readonly string[]) => void;
	/** How big the canvas is on screen, when it changes. */
	onViewport?: (viewport: { width: number; height: number }) => void;
	/** Cards or items dragged onto the page's composer, to talk about them. */
	onRefer?: (pills: Array<{ kind: "card" | "item"; id: string; label: string; name?: string }>) => void;
	/** A comment from a frame with no chrome of its own (its pill's Comment): the page opens its own box. */
	onComment?: (comment: CanvasComment) => void;
	/** Export drawn items as a picture. */
	onExport?: (ids: string[], format?: "png" | "pdf") => void;
	frame: FrameHostOptions;
}

/** What the page can do to its framed canvas: what the Decks app and Decks Studio call. */
export interface FramedHandle {
	/** Apply pen operations as the person's edit. */
	edit(ops: unknown[]): void;
	/** Select these drawn items, or none. */
	select(ids: readonly string[]): void;
	setDark(dark: boolean): void;
	setMode(mode: "edit" | "browse"): void;
	/** Ink on or off. */
	setDrawing(on: boolean, tool?: InkTool): void;
	/** Take a tool in hand: `select` puts it down. */
	setTool(tool: PenTool): void;
	/** Paste what this page's clipboard had: a copy of items (`@decks/pen`'s clip, as JSON) or words. */
	paste(data: { clip?: string; text?: string }): void;
	/** Move the camera there, gliding unless `ms` is 0. */
	glide(camera: Camera, ms?: number): void;
	/** The camera as the frame last said it, and moving it. */
	camera(): Camera;
	setCamera(camera: Camera): void;
	/** A card's file changed: it loads again. */
	reloadCard(path: string): void;
	/** Undo or redo the person's last edit, as the canvas's own keys do. */
	step(direction: "undo" | "redo"): void;
	/** Fit everything on the canvas into view. */
	fit(): void;
	/** Give the canvas the keyboard: after a press on the page's tools, its keys go on working. */
	focus(): void;
	/** Always false: the page keeps the views, not the frame. */
	readonly restored: boolean;
	dispose(): void;
}

/** The framed editor: its handle, and the frame to put where the canvas goes. */
export interface FramedEditor {
	handle: FramedHandle;
	surface: () => JSX.Element;
	dispose(): void;
}

type Options = FramedEditorOptions;

/**
 * The editor in a sandboxed frame (`protocol.ts`): the canvas runs in the frame (`bootFrame`); this end
 * keeps it in step with the host's state, turns its messages into the host's callbacks, and answers
 * what it asks.
 *
 * One frame for one canvas: when the host moves to another canvas the frame is made again or moved in
 * place, on a pass for that canvas, or, for a canvas the host keeps a frame for (`kept`), the frame
 * held for it comes forward (`surface.tsx`). The page talks on one line at a time, the frame in front's.
 */
export function createFramedEditor(options: Options): FramedEditor {
	const state = options.state;
	const [end, setEnd] = createSignal<PageEnd>();
	const [frameAt, setFrameAt] = createSignal<HTMLIFrameElement>();
	/** The last of each the frame said, so this end does not say it back. */
	let fromFrame: { camera?: Camera; selected?: string; mode?: "edit" | "browse" } = {};
	let localCamera: Camera = untrack(() => state?.camera?.[0]()) ?? options.camera ?? { x: 0, y: 0, zoom: 1 };
	let darkNow = options.dark === true;
	let modeNow: "edit" | "browse" = options.mode ?? "edit";
	const { storage, storeKey, appStoredNow } = createFrameStores({
		options,
	});

	/** A rectangle on the frame's screen, on this page's. */
	const onPage = (at: Rect | undefined): DOMRect | undefined => {
		const frame = frameAt();
		if (!at || !frame) return undefined;
		const box = frame.getBoundingClientRect();
		return new DOMRect(box.x + at.x, box.y + at.y, at.w, at.h);
	};

	const { frameInUse } = createFrameFocus({
		frameAt,
	});

	const { startFrame } = createStart({
		options, state, storage, storeKey, appStoredNow,
		get darkNow() { return darkNow; },
		get modeNow() { return modeNow; },
		get localCamera() { return localCamera; },
		get wire() { return wire; },
	});

	/** Stops the tools' mirror on the line the page talks on now. */
	let stopMirror: (() => void) | undefined;
	/**
	 * Make a frame's line the one the page talks on, or none (`surface.tsx`). What the page keeps in step
	 * with a frame follows whichever line this is (`sync.ts`), so most of it is said to the new one by
	 * itself: the camera, the selection, the chat on screen, what the page's chrome covers. The rest is
	 * said here: the tools' state has one mirror, on this line alone, and a frame that was in front
	 * before is told the scheme and the mode as they are now, and asked for what only it knows (its
	 * selection, its zoom), which the page last heard from another frame.
	 */
	const attach = (page: PageEnd | undefined, how: { again: boolean; selected?: string | undefined }) => {
		stopMirror?.();
		stopMirror = undefined;
		forgetFrameZoom();
		/*
		 * A frame that has just started was given the page's selection (`start.selected`), so it is not
		 * sent again. One coming forward again keeps the view it has: the page's camera is still the
		 * canvas's it is leaving, and is not said to this one; where the page lands on this canvas
		 * (`camera/landing.ts`) is said when it lands.
		 */
		fromFrame = how.again ? { camera: untrack(() => state?.camera?.[0]()) } : how.selected ? { selected: how.selected } : {};
		if (page) {
			if (options.pageTools) stopMirror = mirrorTools("page", page, { frameAt: () => frameAt()?.getBoundingClientRect() });
			if (how.again) {
				page.emit("look", { dark: darkNow, mode: modeNow });
				if (options.pageTools) page.emit("tools", { again: true });
			}
		}
		setEnd(() => page);
	};

	const { wire } = createWire({
		state, options, frameInUse, onPage, storage, storeKey, frameAt,
		inFront: (page) => untrack(end) === page,
		get fromFrame() { return fromFrame; },
		get localCamera() { return localCamera; },
		set localCamera(next) { localCamera = next; },
	});

	const { keepInStep } = createSync({
		state, end, options, frameAt,
		get localCamera() { return localCamera; },
		set localCamera(next) { localCamera = next; },
		get fromFrame() { return fromFrame; },
		get modeNow() { return modeNow; },
		set modeNow(next) { modeNow = next; },
	});

	const { surface } = createSurface({ keepInStep, startFrame, end, attach, options, frameAt, setFrameAt });

	// The frame follows the drawing itself, from the harness or Studio: nothing of it is passed on from here.
	const handle: FramedHandle = {
		glide: (camera, ms) => end()?.emit("camera", { camera, glide: ms ?? 400 }),
		setDark: (dark) => {
			darkNow = dark;
			end()?.emit("look", { dark });
		},
		setMode: (mode) => {
			modeNow = mode;
			end()?.emit("look", { mode });
		},
		setDrawing: (onOff) => end()?.emit("tool", { ink: { on: onOff } }),
		setTool: (next) => end()?.emit("tool", { tool: next }),
		select: (ids) => end()?.emit("select", { ids: [...ids] }),
		edit: (ops) => void end()?.call("edit", { ops }),
		camera: () => localCamera,
		setCamera: (camera) => {
			localCamera = camera;
			end()?.emit("camera", { camera });
		},
		reloadCard: (path) => end()?.emit("reload", { path }),
		step: (direction) => end()?.emit("step", { direction }),
		fit: () => end()?.emit("fit", {}),
		focus: () => frameAt()?.focus({ preventScroll: true }),
		paste: (data) => end()?.emit("paste", data),
		restored: false,
		dispose: () => {
			stopMirror?.();
			stopMirror = undefined;
			end()?.close();
			setEnd(undefined);
		},
	};
	return { handle, surface, dispose: () => handle.dispose() };
}
