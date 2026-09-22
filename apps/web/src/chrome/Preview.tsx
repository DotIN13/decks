/**
 * A board, live, beside the dashboard.
 *
 * Looking at a board should not cost the camera position: the preview is a frame of the
 * real document in a panel that takes the right of the dashboard, full height, while the
 * gallery narrows to a column on the left so the next card is still a click away. "Open on
 * canvas" is the deliberate step from looking to going. The frame is the same origin as the
 * app and needs no sandbox — it is the same document `BoardFrame` shows, at the same URL
 * (`boardUrl`).
 *
 * A panel, not a popup: nothing is dimmed and the composer and the conversation float over
 * it as they do over everything else. Escape closes it, as does the × and the Close button.
 *
 * **It zooms, and the zoom is its own.** The board is drawn fitted to the panel's width, and a
 * board 1100 wide in a 600 pixel panel is a board nobody can read. So a pinch, a ⌘-wheel,
 * ⌘+ / ⌘− / ⌘0 and the three buttons in the header all scale it, about the point under the
 * cursor, inside the same scroll box. None of it touches the canvas camera, which is not on
 * screen here. The gestures have to be heard *inside* the frame as well as around it: the frame
 * is a separate document, and a wheel or a finger over it never reaches this one.
 */
import type { Board, Identity } from "@decks/protocol";
import ExternalLink from "lucide-solid/icons/external-link";
import X from "lucide-solid/icons/x";
import ZoomIn from "lucide-solid/icons/zoom-in";
import ZoomOut from "lucide-solid/icons/zoom-out";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { zoomKey } from "../canvas/zoom-keys.ts";
import { boardUrl, deckFileUrl } from "../lib/api.ts";
import { Icon } from "../ui/icons.tsx";
import { holderNames } from "./dispatch-view.ts";
import { clampPreviewZoom, scrollToHold, wheelFactor } from "./preview-zoom.ts";

export interface PreviewProps {
	path: string;
	boards: Board[];
	identities: Record<string, Identity>;
	contexts: Record<string, string[]>;
	onOpenOnCanvas: (path: string) => void;
	onClose: () => void;
}

export function Preview(props: PreviewProps) {
	const board = createMemo(() => props.boards.find((one) => one.path === props.path));
	// With the rev when the board is known, so the frame busts its cache the way the canvas
	// does; without it the file is still there to show.
	const src = () => {
		const one = board();
		return one ? boardUrl(one) : deckFileUrl(props.path);
	};
	const holders = createMemo(() => holderNames(props.path, props.identities, props.contexts));

	/*
	 * The board at the panel's width, not at its own: the document is laid out at the size
	 * its file says (`board.w` × `board.h`) and scaled down to fit the room, the way the canvas
	 * draws it, so a 1400px board is a whole picture rather than its top-left corner. Never
	 * scaled up; a small board sits centred at life size.
	 */
	let wrap: HTMLDivElement | undefined;
	const [avail, setAvail] = createSignal(0);
	const size = () => ({ w: board()?.w ?? 1000, h: board()?.h ?? 700 });
	const fitted = () => {
		const room = avail() - 24;
		return room > 0 && size().w > 0 ? Math.min(1, room / size().w) : 1;
	};
	/** A multiplier on the fitted scale: 1 is the whole width of the board, whatever the panel is. */
	const [zoom, setZoom] = createSignal(1);
	const scale = () => fitted() * zoom();
	// Another board is another reading; it starts fitted.
	createEffect(on(() => props.path, () => setZoom(1), { defer: true }));

	let fit: HTMLDivElement | undefined;
	let frame: HTMLIFrameElement | undefined;

	/**
	 * Zoom by a factor, holding the point at (`x`, `y`) — this document's client pixels — still.
	 *
	 * The signal is set first and the box measured after: Solid writes the new size into the
	 * style synchronously, so the second `getBoundingClientRect` is the box at the new scale,
	 * wherever centring or the scroll limits put it, and the scroll is corrected from that.
	 */
	const zoomAt = (factor: number, x: number, y: number) => {
		if (!wrap || !fit) return;
		const from = scale();
		const next = clampPreviewZoom(zoom() * factor);
		if (next === zoom()) return;
		const before = fit.getBoundingClientRect();
		setZoom(next);
		const after = fit.getBoundingClientRect();
		wrap.scrollLeft += scrollToHold(x, x - before.left, from, scale(), after.left);
		wrap.scrollTop += scrollToHold(y, y - before.top, from, scale(), after.top);
	};
	/** The middle of the room, for a zoom that has no cursor: a key or a button. */
	const zoomStep = (direction: "in" | "out" | "fit") => {
		if (direction === "fit") {
			setZoom(1);
			return;
		}
		const room = wrap?.getBoundingClientRect();
		if (room) zoomAt(direction === "in" ? 1.2 : 1 / 1.2, room.left + room.width / 2, room.top + room.height / 2);
	};

	/** A point in the frame's own pixels, which are the board's, as this document's. */
	const fromFrame = (x: number, y: number) => {
		const at = frame?.getBoundingClientRect();
		return at ? { x: at.left + x * scale(), y: at.top + y * scale() } : { x, y };
	};

	/**
	 * The same listeners on two documents: this one, where the point is already ours, and the
	 * board's, where it has to be converted. Returns the undo.
	 */
	const listen = (target: Document | HTMLElement, point: (x: number, y: number) => { x: number; y: number }) => {
		const onWheel = (event: WheelEvent) => {
			if (!(event.ctrlKey || event.metaKey)) {
				// A scaled frame inside a scroll box is not scrolled by the browser on its
				// own account, so a wheel over the board moves the box by hand.
				if (target !== wrap && wrap && !event.defaultPrevented) {
					event.preventDefault();
					wrap.scrollLeft += event.deltaX;
					wrap.scrollTop += event.deltaY;
				}
				return;
			}
			event.preventDefault();
			const at = point(event.clientX, event.clientY);
			zoomAt(wheelFactor(event.deltaY), at.x, at.y);
		};
		/*
		 * Two fingers. Touch events rather than pointer events, because the first finger is
		 * already scrolling the box by the time the second lands, and a scroll in progress
		 * cancels the pointer stream while the touch stream carries on. Each step is measured
		 * against the last one, in this document's pixels, which is the one frame of reference
		 * that stays put while the board under the fingers changes size.
		 */
		let last: { x: number; y: number; spread: number } | undefined;
		const pair = (event: TouchEvent) => {
			const [a, b] = [event.touches[0], event.touches[1]];
			if (!a || !b) return undefined;
			const one = point(a.clientX, a.clientY);
			const two = point(b.clientX, b.clientY);
			return { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2, spread: Math.hypot(two.x - one.x, two.y - one.y) };
		};
		const onTouch = (event: TouchEvent) => {
			const now = pair(event);
			if (!now) {
				last = undefined;
				return;
			}
			if (event.cancelable) event.preventDefault();
			if (last && wrap) {
				// The midpoint travelling is a pan, the spread changing is a zoom, and a hand does both.
				wrap.scrollLeft -= now.x - last.x;
				wrap.scrollTop -= now.y - last.y;
				if (last.spread > 0.5) zoomAt(now.spread / last.spread, now.x, now.y);
			}
			last = now;
		};
		const onKey = (event: KeyboardEvent) => {
			const key = zoomKey(event);
			if (!key) return;
			// Before the stage's own handler, which would zoom a camera nobody can see.
			event.preventDefault();
			event.stopImmediatePropagation();
			zoomStep(key);
		};
		const options = { passive: false, capture: true } as const;
		const touches = ["touchstart", "touchmove", "touchend", "touchcancel"];
		target.addEventListener("wheel", onWheel as EventListener, options);
		for (const name of touches) target.addEventListener(name, onTouch as EventListener, options);
		const keys = target === wrap ? window : target;
		keys.addEventListener("keydown", onKey as EventListener, true);
		return () => {
			target.removeEventListener("wheel", onWheel as EventListener, options);
			for (const name of touches) target.removeEventListener(name, onTouch as EventListener, options);
			keys.removeEventListener("keydown", onKey as EventListener, true);
		};
	};

	/** The board's document is replaced every time the frame loads, and its listeners with it. */
	let unlistenFrame = () => {};
	const onFrameLoad = () => {
		unlistenFrame();
		const inside = frame?.contentDocument;
		unlistenFrame = inside ? listen(inside, fromFrame) : () => {};
	};
	onCleanup(() => unlistenFrame());

	onMount(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			props.onClose();
		};
		document.addEventListener("keydown", onKey);
		onCleanup(() => document.removeEventListener("keydown", onKey));
		if (wrap) onCleanup(listen(wrap, (x, y) => ({ x, y })));
		if (wrap && typeof ResizeObserver !== "undefined") {
			const observer = new ResizeObserver(() => setAvail(wrap?.clientWidth ?? 0));
			observer.observe(wrap);
			setAvail(wrap.clientWidth);
			onCleanup(() => observer.disconnect());
		}
	});

	return (
		<section class="dispatch-preview" aria-label={`Preview of ${props.path}`}>
			<div class="dispatch-preview-panel">
				<header class="dispatch-preview-head">
					{/* The controls at the left end, and in the header rather than a footer: the
					    conversation floats over the panel's top-right corner at home and the
					    composer over its foot, and a button under a float is a button nobody finds. */}
					<button type="button" class="icon-button" aria-label="Close preview" title="Close (Esc)" onClick={() => props.onClose()}>
						<Icon of={X} size={14} />
					</button>
					<button type="button" class="dispatch-act" data-primary onClick={() => props.onOpenOnCanvas(props.path)}>
						Open on canvas
					</button>
					{/* The same document in a tab of its own: for reading it at full size, or for
					    keeping it open while the dashboard moves on. A link, so the browser's own
					    middle-click and "copy link" work on it. */}
					<a class="icon-button" href={src()} target="_blank" rel="noopener" title="Open in a new tab" aria-label="Open in a new tab">
						<Icon of={ExternalLink} size={14} />
					</a>
					{/* For a mouse with no pinch and nobody's habit of ⌘-wheel. The middle one says
					    where the zoom is and puts it back. */}
					<span class="dispatch-preview-zoom" role="group" aria-label="Zoom">
						<button type="button" class="icon-button" aria-label="Zoom out" title="Zoom out (⌘−)" onClick={() => zoomStep("out")}>
							<Icon of={ZoomOut} size={14} />
						</button>
						<button type="button" class="dispatch-preview-percent" aria-label="Fit to width" title="Fit to width (⌘0)" onClick={() => zoomStep("fit")}>
							{Math.round(scale() * 100)}%
						</button>
						<button type="button" class="icon-button" aria-label="Zoom in" title="Zoom in (⌘+)" onClick={() => zoomStep("in")}>
							<Icon of={ZoomIn} size={14} />
						</button>
					</span>
					<span class="dispatch-preview-path">{props.path}</span>
					<span class="dispatch-preview-held">{holders().length > 0 ? `held by ${holders().join(", ")}` : "held by nobody"}</span>
				</header>
				<div class="dispatch-preview-scroll" ref={wrap}>
					<div class="dispatch-preview-fit" ref={fit} style={{ width: `${Math.round(size().w * scale())}px`, height: `${Math.round(size().h * scale())}px` }}>
						<iframe
							class="dispatch-preview-frame"
							ref={frame}
							onLoad={onFrameLoad}
							src={src()}
							title={board()?.title ?? props.path}
							style={{ width: `${size().w}px`, height: `${size().h}px`, transform: `scale(${scale()})` }}
						/>
					</div>
				</div>
			</div>
		</section>
	);
}
