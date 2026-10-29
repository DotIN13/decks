import type { FrameChrome } from "@decks/canvas";
import { insets } from "@decks/canvas/camera";
import { PenBar } from "@decks/canvas/host";
import { drawing, setDrawing } from "@decks/canvas/tools";
import { createEffect, Show } from "solid-js";
import { CommentPopup } from "../markup/CommentPopup.tsx";
import { PenTray } from "../v3/PenTray.tsx";
import { ToolColumn } from "../v3/ToolColumn.tsx";
import { ZoomBar } from "../v3/ZoomBar.tsx";

/**
 * The Decks app's chrome, drawn inside the canvas frame beside the canvas (`@decks/canvas`, `frame/chrome.ts`):
 * the tool column, the pen tray, the drawing's properties, the zoom and the comment popover (the layers stay in the page's sidebar), the same
 * components the page draws around a canvas it holds itself. A press on any of them stays in the frame;
 * what crosses to the page is a draft for the composer, or opening the apps panel.
 */
export function DecksFrameChrome(chrome: FrameChrome) {
	const { handle } = chrome;
	const step = (direction: "undo" | "redo") => (direction === "undo" ? handle.undo() : handle.redo());
	const setPen = (on: boolean) => {
		if (on && !chrome.canWrite()) return;
		if (on && chrome.mode() === "edit") chrome.setMode("browse");
		setDrawing(on);
	};
	// A canvas you may not change has no edit mode and no pen, whatever asked for them.
	createEffect(() => {
		if (chrome.canWrite()) return;
		if (chrome.mode() !== "browse") chrome.setMode("browse");
		if (drawing()) setDrawing(false);
	});
	// Taking up the pen puts the popover away.
	createEffect(() => {
		if (drawing() && chrome.comment()) chrome.setComment(undefined);
	});
	const comment = (text: string, send: boolean) => {
		const target = chrome.comment();
		if (!target) return;
		chrome.compose({ comment: { path: target.path, title: target.title, quote: target.quote, text, send, ...(target.component ? { component: target.component } : {}), ...(target.items?.length ? { items: target.items } : {}) } });
		chrome.setComment(undefined);
	};
	return (
		<>
			<Show when={drawing() && chrome.mode() === "browse"}>
				<PenTray onDone={() => setDrawing(false)} onStep={step} onDelete={(ids) => handle.edit(ids.map((id) => ({ op: "delete", id })))} />
			</Show>
			<Show when={!(drawing() && chrome.mode() === "browse")}>
				<PenBar tools={false} doc={(chrome.revision(), handle.drawn())} onEdit={(ops) => handle.edit(ops)} onStep={step} onArm={() => {}} onExport={(ids) => chrome.exportPicture(ids)} />
			</Show>
			{/* A column at the left; on a phone, a row just above the page's dock, as the page drew it there. */}
			<Show
				when={chrome.narrow()}
				fallback={<ToolColumn onStep={step} onApps={() => chrome.panel("apps")} onPen={setPen} mode={chrome.mode()} onMode={(next) => chrome.setMode(next)} />}
			>
				<div class="frame-tool-row" style={{ bottom: `${chrome.dock() + 8}px` }}>
					<ToolColumn row onStep={step} onApps={() => chrome.panel("apps")} onPen={setPen} mode={chrome.mode()} onMode={(next) => chrome.setMode(next)} />
				</div>
			</Show>
			<ZoomBar zoom={chrome.camera().zoom} onZoom={(zoom) => handle.setCamera({ ...chrome.camera(), zoom })} onFit={() => handle.fit()} />
			<Show when={chrome.offer()} keyed>
				{(offer) => (
					<div class="v3-bar float pill frame-offer" role="status">
						<span>An agent wants to {offer.what === "board" ? "show you a board" : "move the view"}</span>
						<button type="button" class="frame-offer-go" onClick={() => offer.go()}>
							Go
						</button>
						<button type="button" class="frame-offer-no" aria-label="Stay here" onClick={() => chrome.dismissOffer()}>
							Stay
						</button>
					</div>
				)}
			</Show>
			<Show when={chrome.comment()} keyed>
				{(target) => (
					<CommentPopup
						target={{ ...target, anchor: () => target.anchor() }}
						moved={() => [chrome.camera(), insets()]}
						left={insets().left}
						canSend
						onKeep={(text) => comment(text, false)}
						onSend={(text) => comment(text, true)}
						onClose={() => chrome.setComment(undefined)}
					/>
				)}
			</Show>
		</>
	);
}
