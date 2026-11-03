import type { Camera } from "@decks/protocol";
import { createSignal, onCleanup, Show, untrack, type JSX } from "solid-js";
import { createFramedEditor, type FramedEditorOptions, type FramedHandle } from "@decks/canvas";
import { drawing } from "@decks/canvas/tools";
import { canvasPass, cardAgentCall } from "../canvases/pass.ts";
import { scheme } from "../lib/theme.ts";
import { camera, glide } from "../state/camera.ts";
import { state } from "../state/deck.ts";
import { stageOf, stages } from "../state/canvases.ts";
import { setDrawingEditor } from "../state/decks.ts";
import { mode, selected, setMode, setSelected } from "../state/selection.ts";
import { reportCameraSoon } from "./camera-report.ts";
import { exportPicture, frameComment, frameInk, frameRefer, pageComment } from "./frame-handoffs.ts";
import { CommentPopup } from "../markup/CommentPopup.tsx";
import type { StageComment } from "@decks/canvas";
import type { createFileDrops } from "./files/drops.ts";
import { rememberView } from "./socket-messages.ts";
import { openLinkedPage } from "./links.ts";

/** What the canvas host needs of the page around it. */
export interface CanvasHostInputs {
	stagePen: NonNullable<FramedEditorOptions["state"]>["pen"];
	personMoved: (next: Camera) => void;
	setPenSelected: (ids: string[]) => void;
	setEditorHandle: (handle: FramedHandle | undefined) => void;
	/** How far up from the bottom the dock reaches, and the composer's box. */
	dockCover: () => number;
	composerBox: () => HTMLElement | undefined;
	/** A sheet in the canvas frame is open over the foot of the screen (a phone's properties drawer): the dock makes way. */
	underSheet: (open: boolean) => void;
	openAppsPanel: () => void;
	files: ReturnType<typeof createFileDrops>;
	frameWhenPlaced: (path: string) => void;
}

/** The canvas: made once, as a component, so nothing read while it is made makes it again. */
export function CanvasHost(props: { host: CanvasHostInputs }): JSX.Element {
	const { stagePen, personMoved, setPenSelected, setEditorHandle, dockCover, composerBox, underSheet, openAppsPanel, files, frameWhenPlaced } = props.host;
	/**
	 * A file of any kind, chosen in the file picker and placed in the middle of the view by what it is:
	 * the frame's tool column's "Add a file" (`frame/chrome.tsx`), which asks the page for its picker.
	 */
	const openFileAtMiddle = () => {
		const stage = document.querySelector(".stage, iframe.canvas-frame");
		if (!stage) return;
		void files.fileAt({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, false).then((path) => {
			if (!path) return;
			setSelected(path);
			frameWhenPlaced(path);
		});
	};
	/*
	 * The shared editor in a sandboxed frame of its own (`@decks/canvas`, `frame/`): the frame reads,
	 * follows and edits the canvas on screen on a ticket and a token for it, and draws this app's tools
	 * beside it (`frame/chrome.tsx`). This page keeps what is its own: the camera, selection, mode and
	 * ink are this app's state, kept in step with the frame, so the agent-centric camera (per agent and
	 * canvas, on this device) and agents moving the view work as before; and it answers what the frame
	 * hands over: drafts for the composer, a card's agent calls, apps, uploads, views for other agents.
	 */
	/** The comment box, drawn here on the page where the frame says (`onComment`): its Send now is yours to send. */
	const [commenting, setCommenting] = createSignal<StageComment>();
	/*
	 * What the frame says is quoted and named is the frame's, so a card's script can write it: it is cut short
	 * here, and the box shows the whole of what is left (`.comment-quote` scrolls rather than clamps), so what
	 * Send now sends is what you saw. The words are yours, typed in this page.
	 */
	const QUOTE_MAX = 280;
	const TITLE_MAX = 120;
	const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
	const editor = createFramedEditor({
		// The app's scheme (`lib/theme.ts`): left out, the editor painted light over it on mount.
		dark: untrack(scheme) === "dark",
		toolbar: false,
		onSelection: (ids) => setPenSelected([...ids]),
		state: {
			pen: stagePen,
			camera: [camera, personMoved],
			glide,
			selected: [selected, (path) => setSelected(path)],
			mode: [mode, setMode],
			inking: drawing,
		},
		canvasName: () => stageOf(state.focused)?.name,
		pages: { onOpenLink: openLinkedPage },
		onViewport: () => reportCameraSoon(camera()),
		onExport: exportPicture,
		onRefer: frameRefer,
		onComment: (target) => setCommenting(target),
		frame: {
			pass: canvasPass,
			// Between canvases that are yours alone the frame moves in place; a friend's, or one someone else may edit, gets a frame of its own.
			inPlace: (from, to) => [from, to].every((name) => {
				const row = stages().find((one) => one.name === name);
				return !!row && !row.shared && !row.othersEdit;
			}),
			comment: frameComment,
			ink: frameInk,
			panel: (name) => (name === "files" ? openFileAtMiddle() : openAppsPanel()),
			agent: cardAgentCall,
			dock: dockCover,
			composer: composerBox,
			sheet: underSheet,
			openApp: (name) => window.open(`/app/${encodeURIComponent(name)}/`, "_blank", "noopener"),
			upload: ({ files: dropped, at, card }) => files.dropAt(at, dropped, card),
			focused: () => state.focused,
			agents: () => Object.fromEntries(Object.entries(state.identities).map(([id, one]) => [id, { name: one.name, color: one.color }])),
			viewFor: rememberView,
		},
	});
	setEditorHandle(editor.handle);
	// Every edit to the drawing on screen goes through the canvas, which shows it at once (`state/decks.ts`).
	setDrawingEditor({ agentId: () => state.focused, edit: (ops) => editor.handle.edit(ops) });
	onCleanup(() => {
		setDrawingEditor(undefined);
		setEditorHandle(undefined);
		editor.dispose();
	});
	const canvasLeft = () => document.querySelector("iframe.canvas-frame")?.getBoundingClientRect().left ?? 0;
	return (
		<>
			{editor.surface()}
			<Show when={commenting()} keyed>
				{(target) => (
					<CommentPopup
						target={{ path: target.path, title: cut(target.title, TITLE_MAX), quote: cut(target.quote, QUOTE_MAX), ...(target.component ? { component: target.component } : {}), ...(target.items ? { items: target.items } : {}), anchor: () => target.anchor(), ...(target.open ? { open: true } : {}) }}
						moved={() => camera()}
						left={canvasLeft()}
						canSend={!!state.focused}
						onKeep={(text) => {
							pageComment({ ...target, title: cut(target.title, TITLE_MAX), quote: cut(target.quote, QUOTE_MAX) }, text, false);
							setCommenting(undefined);
						}}
						onSend={(text) => {
							pageComment({ ...target, title: cut(target.title, TITLE_MAX), quote: cut(target.quote, QUOTE_MAX) }, text, true);
							setCommenting(undefined);
						}}
						onClose={() => setCommenting(undefined)}
					/>
				)}
			</Show>
		</>
	);
}
