import type { FrameChrome } from "@decks/canvas";
import { insets } from "@decks/canvas/camera";
import { PenBar } from "@decks/canvas/host";
import { drawing, setDrawing } from "@decks/canvas/tools";
import { makeFloat } from "@decks/ui/float";
import { createEffect, onCleanup, Show } from "solid-js";
import { CommentPopup } from "../markup/CommentPopup.tsx";
import { PenTray } from "./PenTray.tsx";
import { ToolColumn } from "./ToolColumn.tsx";
import { ZoomBar } from "./ZoomBar.tsx";

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
	/*
	 * The tool column as a float, as it was on the page: dragged by the grip at its head, and a hard throw
	 * at either edge tucks it behind that edge with its tab showing. Home is where the stylesheet puts it,
	 * measured while it stands there; where it was put is kept by the page, as the frame's other values are.
	 */
	const floatTools = (tools: HTMLElement, grip: HTMLElement): { unstow: () => void } => {
		let seen: { x: number; y: number } | undefined;
		const bounds = () => {
			const { left, right, top } = insets();
			return { x: left, y: top, w: innerWidth - left - right, h: innerHeight - top - chrome.dock() };
		};
		const home = () => {
			if (!tools.hasAttribute("data-floating") && !tools.hasAttribute("data-stowed")) {
				const r = tools.getBoundingClientRect();
				seen = { x: r.left, y: r.top };
			}
			const box = bounds();
			return seen ?? { x: box.x + 12, y: box.y + box.h / 2 - tools.offsetHeight / 2 };
		};
		const cssPx = (name: string, fallback: number) => parseFloat(getComputedStyle(tools).getPropertyValue(name)) || fallback;
		const float = makeFloat(tools, {
			key: "pen-tools",
			handle: grip,
			ignore: "button, input, label",
			home,
			bounds,
			size: () => ({ w: tools.offsetWidth, h: tools.offsetHeight }),
			read: () => ({ x: tools.offsetLeft, y: tools.offsetTop }),
			stow: { tab: () => cssPx("--stowtab-w", 20), tabHeight: () => cssPx("--stowtab-h", 48) },
			storage: chrome.storage as Storage,
			apply: (p, atHome, stowed) => {
				// Put away, everything but the tab is out of reach as well as out of sight.
				if (stowed) tools.setAttribute("data-stowed", stowed);
				else tools.removeAttribute("data-stowed");
				for (const child of tools.children) if (!child.hasAttribute("data-stowtab")) child.toggleAttribute("inert", stowed !== undefined);
				if (atHome || !p) {
					tools.removeAttribute("data-floating");
					tools.style.left = "";
					tools.style.top = "";
					return;
				}
				tools.setAttribute("data-floating", "true");
				tools.style.left = `${p.x}px`;
				tools.style.top = `${p.y}px`;
			},
		});
		createEffect(() => {
			insets();
			float.restore();
		});
		onCleanup(() => float.dispose());
		return { unstow: () => float.unstow() };
	};
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
				fallback={<ToolColumn onStep={step} onFloat={floatTools} onApps={() => chrome.panel("apps")} onOpenFile={() => chrome.panel("files")} onPen={setPen} mode={chrome.mode()} onMode={(next) => chrome.setMode(next)} />}
			>
				<div class="frame-tool-row" style={{ bottom: `${chrome.dock() + 8}px` }}>
					<ToolColumn row onStep={step} onApps={() => chrome.panel("apps")} onOpenFile={() => chrome.panel("files")} onPen={setPen} mode={chrome.mode()} onMode={(next) => chrome.setMode(next)} />
				</div>
			</Show>
			<ZoomBar zoom={chrome.camera().zoom} onZoom={(zoom) => handle.setCamera({ ...chrome.camera(), zoom })} onFit={() => handle.fit()} />
			<Show when={chrome.offer()} keyed>
				{(offer) => (
					<div class="v3-bar float pill frame-offer" role="status">
						<span>An agent wants to {offer.what === "card" ? "show you a card" : "move the view"}</span>
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
