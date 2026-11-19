import { probes } from "../../base/debug.ts";
import { warmCanvasEngine } from "../../render/engine.ts";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { createEditor } from "../../view/editor.tsx";
import type { Editor } from "../../view/types.ts";
import type { FrameChromeView } from "../chrome.ts";
import { openFrame } from "./boot.ts";
import { createOthersLayer } from "./others-layer.tsx";
import { editorOptions, installHost } from "./options.ts";
import { wireFrame } from "./events.ts";
import type { FrameEnd, Start } from "../protocol.ts";
import { useShippedFonts } from "../../look/font-files.ts";

/**
 * The canvas, run inside its frame (`frame.tsx` says hello and takes the start): reads its
 * drawing from the harness on the canvas token (`backend.ts`), makes the editor, follows the canvas's
 * stream and sends your edits itself. With the page it trades only what is the page's: its chrome, the
 * composer, your storage (`protocol.ts`).
 *
 * What a host answered with a function (a board's address, its picture, its storage) is worked out
 * here from `start`: the files' ticketed address, the pages' trust, the page's kept values.
 *
 * In parts: what the frame holds once started (`boot.ts`), what the host and the editor are told
 * (`options.ts`), and what the frame hears from the harness, the page and the window (`events.ts`).
 */

/** Kept spare by the page for the next canvas: the drawing engine starts now, with nothing to draw (`render/warm.ts`). */
export const warm = warmCanvasEngine;

/** Run one canvas in the frame, and answer how to stop it: its editor, its views and what they made. */
export async function run(root: HTMLElement, start: Start, end: FrameEnd, chrome: FrameChromeView | undefined, fonts?: { base: string; files: readonly string[] }): Promise<() => void> {
	// Before the engine asks for any font: the faces the app serves itself are asked of it first.
	if (fonts) useShippedFonts(fonts.base, fonts.files);
	const ctx = await openFrame(root, start, end, chrome);
	return createRoot((disposeRoot) => {
	const { camera, pages, cursor } = ctx;
	installHost(ctx);

	const { cursors, rings } = createOthersLayer(ctx);
	let reread = () => {};
	const editor: Editor = createEditor(editorOptions(ctx, () => reread(), cursors, rings));
	const { handle } = editor;
	ctx.setMade(editor);
	ctx.changed();
	// For the checks: the drawing as this frame has it (a card can read it anyway, with canvas.read).
	probes.frameDrawn = () => handle.drawn();
	probes.frameNews = () => ctx.news();
	probes.frameSelect = (ids) => handle.select(ids);
	probes.frameCamera = () => handle.camera();
	probes.frameState = () => ({ dock: ctx.dock(), agents: Object.keys(ctx.agents()).length, agent: ctx.agent(), cursor: cursor(), pages: pages().length, cardsReads: ctx.cardsReads(), cards: pages().map((page) => ({ path: page.path.split("/").at(-2) ?? page.path, rev: page.rev, sized: page.sized })) });

	reread = wireFrame(ctx).reread;


	if (chrome) {
		const { canWrite, setMode } = ctx;
		// The app's own chrome, here beside the canvas: its tools are this frame's, and nothing of them crosses.
		// Made inside the render's root, so its effects and its parts' onMount run (a float's grip, the pen's state).
		const view = () => chrome({
			handle,
			revision: ctx.revision,
			offer: ctx.offer,
			dismissOffer: () => ctx.setOffer(undefined),
			camera,
			mode: ctx.mode,
			setMode: (next) => {
				if (next === "edit" && !canWrite()) return;
				setMode(next);
			},
			canWrite,
			dark: ctx.dark,
			comment: ctx.comment,
			setComment: ctx.setComment,
			compose: (part) => end.emit("composer", part),
			exportPicture: (ids) => end.emit("export", { ids }),
			narrow: ctx.narrow,
			dock: ctx.dock,
			panel: (name) => end.emit("panel", { name }),
			storage: ctx.storage,
			canvas: start.canvas.name,
		});
		const unrender = render(() => (
			<>
				{editor.surface()}
				{view()}
			</>
		), root);
		return () => {
			unrender();
			editor.dispose();
			disposeRoot();
		};
	}

	/*
	 * No chrome of its own (Studio, until it brings one): the editor's own bars, or none. Nothing of the
	 * tools crosses the frame line: an app's chrome lives in the frame beside the canvas.
	 */
	const unrender = render(() => (
		<>
			{start.look.toolbar ? editor.root() : editor.surface()}
		</>
	), root);
	return () => {
		unrender();
		editor.dispose();
		disposeRoot();
	};
	});
}
