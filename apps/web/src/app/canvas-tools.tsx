import { PenBar } from "@decks/canvas/host";
import { frameZoom } from "@decks/canvas";
import { drawing, Insert, insertPanel, penPicked, setDrawing, setInsertPanel, setPenTool } from "@decks/canvas/tools";
import { createEffect, onCleanup, onMount, Show, type JSX } from "solid-js";
import { createToolsFloat } from "./tools-float.ts";
import { PenTray } from "../frame/PenTray.tsx";
import { ToolColumn } from "../frame/ToolColumn.tsx";
import { ZoomBar } from "../frame/ZoomBar.tsx";
import { camera } from "../state/camera.ts";
import { mode, setMode, setSelected } from "../state/selection.ts";
import { exportPicture } from "./frame-handoffs.ts";
import type { Parts } from "./parts.ts";
import { viewOnlyStage } from "./person.ts";

/**
 * The canvas's tools, drawn on this page over the canvas frame: the tool column, the pen tray, the
 * drawing's properties, the insert panel beside the column, and the zoom.
 *
 * They stood inside the frame, beside the canvas, where a float could go no further than the frame's
 * own edge. Here each is the page's, as the top bars, the side panel and the composer are: the tool
 * column and the pen tray are floats beside the composer and the conversation (`tools-float.ts`). They read and set the same signals as before
 * (`@decks/canvas/tools`), which the canvas package keeps the same on this page and in the frame
 * (`frame/tools-mirror.ts`), with what is selected as the canvas has it now (`penPicked`), your own edits
 * in it before the server confirms them; what they ask of the canvas itself (an edit, undo, a fit, the camera) goes
 * through the page's handle on the frame (`FramedHandle`). What is attached to the drawing stays in
 * the frame: the selection's pill, its outlines and handles, the menu at a point, a card's style bar.
 *
 * A press on a tool gives the keyboard to the canvas, or leaves it there: a tool armed here, its key and
 * the canvas's other keys go on working without a click on the canvas first. A field that is typed into takes the
 * keyboard, and gives it back when it is left.
 */
export function CanvasTools(props: { parts: Parts }): JSX.Element {
	const { layout, dock, floats, editorHandle, stagePen, canvasHost } = props.parts;
	const handle = () => editorHandle();
	const canWrite = () => !viewOnlyStage();
	const step = (direction: "undo" | "redo") => handle()?.step(direction);
	const setPen = (on: boolean) => {
		if (on && !canWrite()) return;
		if (on && mode() === "edit") setMode("browse");
		setDrawing(on);
	};
	// A canvas you may not change has no edit mode and no pen, whatever asked for them.
	createEffect(() => {
		if (canWrite()) return;
		if (mode() !== "browse") setMode("browse");
		if (drawing()) setDrawing(false);
	});
	// A sheet open over the foot of the screen (a phone's properties drawer): the dock makes way for it.
	onMount(() => {
		const sheet = (event: Event) => canvasHost.underSheet(!!(event as CustomEvent<{ open?: boolean }>).detail?.open);
		document.addEventListener("decks-sheet", sheet);
		onCleanup(() => document.removeEventListener("decks-sheet", sheet));
	});

	const floatTools = createToolsFloat(floats, () => layout.phone());

	/** A file of any kind, chosen in the file picker and placed in the middle of the view by what it is. */
	const openFile = () => {
		const stage = document.querySelector("iframe.canvas-frame");
		if (!stage) return;
		void canvasHost.files.fileAt({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, false).then((path) => {
			if (!path) return;
			setSelected(path);
			canvasHost.frameWhenPlaced(path);
		});
	};

	/** Something that is typed into or chosen from with the keyboard: it may take it. */
	const typedInto = (target: EventTarget | null) => target instanceof Element && !!target.closest("input, textarea, select, [contenteditable]");
	/** A press on a tool gives the keyboard to the canvas, or leaves it there: its keys act next, as when the tools stood in its frame. */
	const keepKeys = (event: MouseEvent) => {
		if (typedInto(event.target)) return;
		event.preventDefault();
		if (document.activeElement?.tagName !== "IFRAME") handle()?.focus();
	};
	/** A field left for nothing else on this page: the keyboard goes back to the canvas. */
	const giveKeysBack = (event: FocusEvent) => {
		if (event.relatedTarget || !typedInto(event.target)) return;
		queueMicrotask(() => {
			if (document.activeElement === document.body) handle()?.focus();
		});
	};
	/** The insert panel beside the tool column; the one opened at a point on the canvas is the frame's. */
	const beside = () => {
		const open = insertPanel();
		return open && !open.at && !open.replace ? open : undefined;
	};
	const zoom = () => frameZoom() ?? camera().zoom;

	return (
		<div class="canvas-tools" style={{ display: "contents" }} onMouseDown={keepKeys} on:focusout={giveKeysBack}>
			<Show when={drawing() && mode() === "browse"}>
				<PenTray onFloat={(tray, grip) => floatTools(tray, grip, "pen-tray")} onDone={() => setDrawing(false)} onStep={step} onDelete={(ids) => handle()?.edit(ids.map((id) => ({ op: "delete", id })))} />
			</Show>
			<Show when={!(drawing() && mode() === "browse")}>
				{/* The dock's height as a variable, for the properties sheet on a phone to sit above the composer (`properties.css`). */}
				<div style={{ display: "contents", "--dock": `${dock.dockCover()}px` }}>
					<PenBar tools={false} doc={penPicked() ?? stagePen()?.doc} onEdit={(ops) => handle()?.edit(ops)} onStep={step} onArm={() => {}} onExport={(ids) => exportPicture(ids)} />
				</div>
			</Show>
			{/* A column at the left; on a phone, a row just above the dock. */}
			<Show
				when={layout.phone()}
				fallback={<ToolColumn onStep={step} onFloat={floatTools} onApps={canvasHost.openAppsPanel} onOpenFile={openFile} onPen={setPen} mode={mode()} onMode={(next) => (next === "edit" && !canWrite() ? undefined : setMode(next))} />}
			>
				<div class="frame-tool-row" style={{ bottom: `${dock.dockCover() + 8}px` }}>
					<ToolColumn row onStep={step} onApps={canvasHost.openAppsPanel} onOpenFile={openFile} onPen={setPen} mode={mode()} onMode={(next) => (next === "edit" && !canWrite() ? undefined : setMode(next))} />
				</div>
			</Show>
			<Show when={beside()} keyed>
				{(open) => (
					<Insert
						open={open}
						onPick={(tool) => {
							setInsertPanel(undefined);
							setPenTool(tool);
						}}
						onClose={() => setInsertPanel(undefined)}
					/>
				)}
			</Show>
			<ZoomBar zoom={zoom()} onZoom={(next) => handle()?.setCamera({ ...camera(), zoom: next })} onFit={() => handle()?.fit()} />
		</div>
	);
}
