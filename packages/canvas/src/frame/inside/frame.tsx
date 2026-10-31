import { render } from "solid-js/web";
import { createEditor } from "../../editor.tsx";
import type { Editor } from "../../types.ts";
import type { FrameChromeView } from "../chrome.ts";
import { AgentCursor } from "../../ui/AgentCursor.tsx";
import { openFrame } from "./boot.ts";
import { editorOptions, installHost } from "./options.ts";
import { wireFrame } from "./events.ts";
import { PROTOCOL, peer, type FrameEnd, type Hello, type Start, type StartMessage } from "../protocol.ts";

/**
 * The canvas, run inside its frame: says `hello` to its parent, takes `start` and the port, reads its
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
export function bootFrame(root: HTMLElement, options: { chrome?: FrameChromeView } = {}): void {
	const parent = window.parent;
	if (parent === window) throw new Error("The canvas frame runs inside the app's page.");
	// The canvas's own styles are scoped to it (`canvas.css`, `.decks-canvas`), as the editor's root is.
	root.classList.add("decks-canvas");
	const onStart = (event: MessageEvent<StartMessage>) => {
		// Only the parent's answer, with its port: nothing else is read, then or later.
		if (event.source !== parent || event.data?.t !== "start" || !event.ports[0]) return;
		removeEventListener("message", onStart);
		void run(root, event.data.start, peer(event.ports[0]) as FrameEnd, options.chrome);
	};
	addEventListener("message", onStart);
	parent.postMessage({ t: "hello", protocol: PROTOCOL } satisfies Hello, "*");
}

async function run(root: HTMLElement, start: Start, end: FrameEnd, chrome: FrameChromeView | undefined): Promise<void> {
	const ctx = await openFrame(root, start, end, chrome);
	const { camera, pages, cursor } = ctx;
	installHost(ctx);

	let reread = () => {};
	const editor: Editor = createEditor(editorOptions(ctx, () => reread()));
	const { handle } = editor;
	ctx.setMade(editor);
	ctx.changed();
	// For the checks: the drawing as this frame has it (a card can read it anyway, with canvas.read).
	(globalThis as { __decksFrameDrawn?: () => unknown }).__decksFrameDrawn = () => handle.drawn();
	(globalThis as { __decksFrameNews?: () => unknown }).__decksFrameNews = () => ctx.news();
	(globalThis as { __decksFrameSelect?: (ids: string[]) => void }).__decksFrameSelect = (ids) => handle.select(ids);
	(globalThis as { __decksFrameCamera?: () => unknown }).__decksFrameCamera = () => handle.camera();
	(globalThis as { __decksFrameState?: () => unknown }).__decksFrameState = () => ({ dock: ctx.dock(), agents: Object.keys(ctx.agents()).length, agent: ctx.agent(), cursor: cursor(), pages: pages().length });

	reread = wireFrame(ctx).reread;

	/*
	 * The agent's cursor, over the canvas on a layer that follows the camera: the card's place plus the
	 * point on it, drifting from one place to the next and one size on the screen at any zoom.
	 */
	const cursorAt = () => {
		const at = cursor();
		const card = at ? pages().find((page) => page.path === at.path) : undefined;
		return at && card ? { x: card.x + at.x, y: card.y + at.y, label: at.label, color: at.color } : null;
	};
	const cursors = () => (
		<div class="frame-cursors" style={{ position: "absolute", inset: "0", overflow: "hidden", "pointer-events": "none", "z-index": "5" }}>
			<div style={{ position: "absolute", left: "0", top: "0", "transform-origin": "0 0", transform: `translate(${innerWidth / 2}px, ${innerHeight / 2}px) scale(${camera().zoom}) translate(${-camera().x}px, ${-camera().y}px)` }}>
				<AgentCursor cursor={cursorAt()} zoom={camera().zoom} />
			</div>
		</div>
	);

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
		render(() => (
			<>
				{editor.surface()}
				{cursors()}
				{view()}
			</>
		), root);
		return;
	}

	/*
	 * No chrome of its own (Studio, until it brings one): the editor's own bars, or none. Nothing of the
	 * tools crosses the frame line: an app's chrome lives in the frame beside the canvas.
	 */
	render(() => (
		<>
			{start.look.toolbar ? editor.root() : editor.surface()}
			{cursors()}
		</>
	), root);
}
