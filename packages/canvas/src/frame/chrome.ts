import type { Camera } from "@decks/protocol";
import type { Accessor, JSX, Setter } from "solid-js";
import type { CanvasHandle } from "../mount.tsx";
import type { StageComment } from "../stage/Stage.tsx";
import type { ComposerPart } from "./protocol.ts";

/**
 * The editor's chrome, drawn inside the canvas frame by the app that made it: its tools, the pen tray,
 * the zoom, the properties and layers panels, the comment popover. Each app brings its own look (the
 * Decks app's `frame/chrome.tsx`, Studio's), and runs it in the frame beside the canvas, so a press
 * there never crosses to the page. What does cross is what only the page can do: a draft for the
 * composer, opening one of its panels.
 */
export interface FrameChrome {
	/** The editor: undo, redo, fit, the camera, edits as yours, the drawing. */
	handle: CanvasHandle;
	/** Counts up each time the drawing changes, by the stream or by your edit: what to read `handle.drawn()` again on. */
	revision: Accessor<number>;
	/** An agent on screen asked to move the view while the person was using the canvas: offered, with a Go. */
	offer: Accessor<ViewOffer | undefined>;
	dismissOffer(): void;
	/** The camera as it moves, step by step. */
	camera: Accessor<Camera>;
	/** Browse or edit; the chrome's toggle sets it, and the canvas follows. */
	mode: Accessor<"edit" | "browse">;
	setMode(mode: "edit" | "browse"): void;
	/** Whether you may change this canvas: a canvas shared to view has no edit mode and no pen. */
	canWrite(): boolean;
	dark: Accessor<boolean>;
	/** Words selected in a card, being commented on: the popover's, set by the canvas. */
	comment: Accessor<StageComment | undefined>;
	setComment: Setter<StageComment | undefined>;
	/** Hand the composer a draft (`ComposerPart`); the page never sends it on the frame's word. */
	compose(part: ComposerPart): void;
	/** A picture of these items to download, taken by the page (it holds the token that can). */
	exportPicture(ids: string[]): void;
	/** Open one of the app's own panels. */
	panel(name: "apps"): void;
	/** Whether the frame is a phone's width: the tools are a row then, above the page's dock. */
	narrow: Accessor<boolean>;
	/** How far up from the bottom the page's dock reaches, in pixels. */
	dock: Accessor<number>;
	/** The canvas's name, and the frame's own width, for a chrome that lays out by it. */
	canvas: string;
}

/** A view an agent asked for while the person was at the canvas: theirs to take (`go`) or leave. */
export interface ViewOffer {
	agent: string;
	what: "board" | "view";
	go(): void;
}

/** What an app draws around the canvas in the frame. */
export type FrameChromeView = (chrome: FrameChrome) => JSX.Element;
