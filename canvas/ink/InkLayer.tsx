import { inkBounds } from "./index.ts";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { inkSelection, inkTool, penSeen, setInkSelection } from "./ink.ts";
import { dropLive, handOver, liveState } from "./live-ink.ts";
import { cancel, fingerDown, listenTaps, onDown, onMove, onUp, palm, STAGE_INK, startScale, takePalm, zoom, type Corner, type InkCtx, type InkProps } from "./ink-gestures.ts";

/**
 * Drawing on the stage: a sheet of glass over the whole canvas while the draw tool is on.
 *
 * What is drawn goes into the stage's `.pen` file as ink (`ink.ts`), one pen `path` per stroke,
 * through the same edits an agent sends. The strokes in the file are drawn on the stage's one sheet
 * (`scene.ts`) as items. The stroke under the pen, before it is in the file, is drawn here, on this
 * glass, as SVG paths shaped as the sheet shapes ink, at most once a frame: handing it to the sheet
 * redrew the whole sheet, three screens of pixels, for every sample, and on an iPad that is two
 * samples a frame (Safari gives no coalesced events). The glass also takes the pointer, and shows
 * the lasso's loop and the box round what the lasso took.
 *
 * **Which pointer draws.** A pen, with its pressure, and a mouse. A finger draws only on a device
 * that has never shown a pencil (a phone, an iPad without one; remembered, `ink.ts`), and a
 * second finger ends its stroke; once a pencil has been seen, a finger is the canvas's and goes on up
 * to the stage, one finger to pan, two to pan and pinch. A palm is ignored as far as it can be while
 * the pencil is in use: any touch while the pencil is on the glass or has just left it
 * (`PALM_AFTER_MS`) does nothing at all, neither drawing nor moving the canvas. iPadOS turns away a
 * resting palm by itself.
 */
export function CanvasInk(props: InkProps) {
	const [resizing, setResizing] = createSignal<{ anchor: { x: number; y: number }; by: number } | undefined>();
	const held = createMemo(() => {
		const picked = inkSelection();
		return picked?.path === STAGE_INK ? picked.ids : [];
	});
	const c: InkCtx = {
		...liveState(props.layer),
		props,
		setResizing,
		held,
		selection: () => selection(),
		fingers: new Map(),
		tapStarted: 0,
		tapMost: 0,
		tapSpoiled: false,
		penDown: false,
		penUpAt: Number.NEGATIVE_INFINITY,
		palms: new Set(),
	};
	const selection = createMemo(() => {
		const ids = new Set(held());
		if (ids.size === 0) return undefined;
		const box = inkBounds(props.strokes().filter((stroke) => ids.has(stroke.id)));
		const moving = c.gesture?.kind === "move" ? c.gesture : undefined;
		const scale = resizing();
		if (box && scale) {
			const x = scale.anchor.x + (box.x - scale.anchor.x) * scale.by;
			const y = scale.anchor.y + (box.y - scale.anchor.y) * scale.by;
			return { x, y, w: box.w * scale.by, h: box.h * scale.by };
		}
		return box && moving ? { ...box, x: box.x + moving.dx, y: box.y + moving.dy } : box;
	});
	createEffect(() => {
		const drawn = new Set(props.strokes().map((stroke) => stroke.id));
		for (const id of c.waiting.keys()) if (drawn.has(id)) handOver(c, id);
	});
	onCleanup(listenTaps(c));
	let sheet: SVGSVGElement | undefined;
	onMount(() => sheet && onCleanup(catchPencil(c, sheet)));
	onCleanup(() => {
		cancel(c);
		setInkSelection(undefined);
		dropLive(c);
	});
	const transform = () => {
		const { x, y } = props.camera;
		return `translate(${props.view.width / 2} ${props.view.height / 2}) scale(${zoom(c)}) translate(${-x} ${-y})`;
	};
	const up = (event: PointerEvent) => onUp(c, event);
	return (
		<svg
			ref={sheet}
			class="stage-ink"
			data-tool={inkTool()}
			data-pencil={penSeen() ? "true" : undefined}
			width={props.view.width}
			height={props.view.height}
			onPointerDown={(event) => onDown(c, event)}
			onPointerMove={(event) => onMove(c, event)}
			onPointerUp={up}
			onPointerCancel={up}
			// The capture taken away mid-stroke (the browser's, not the pen's lift): the stroke ends there.
			onLostPointerCapture={up}
			// A long press with a pencil or a finger is not a request for the browser's menu.
			onContextMenu={(event) => event.preventDefault()}
		>
			<g transform={transform()}>
				<g ref={(el) => (c.inkLayer = el)} class="ink-live-layer" pointer-events="none" />
				<path ref={(el) => (c.loop = el)} class="ink-loop" d="" />
				<Show when={selection()}>{(box) => <HeldBox box={box()} zoom={zoom(c)} onCorner={(event, corner) => startScale(c, event, corner)} />}</Show>
			</g>
		</svg>
	);
}



/** The box round what the lasso holds, with the corners that resize it. */
function HeldBox(props: { box: { x: number; y: number; w: number; h: number }; zoom: number; onCorner: (event: PointerEvent, corner: Corner) => void }) {
	const box = () => props.box;
	const zoom = () => props.zoom;
	return (
		<>
			<rect class="ink-selection" x={box().x - 4 / zoom()} y={box().y - 4 / zoom()} width={box().w + 8 / zoom()} height={box().h + 8 / zoom()} rx={4 / zoom()} />
			<For each={["nw", "ne", "sw", "se"] as const}>
				{(corner) => {
					const size = () => 12 / zoom();
					return (
						<rect
							class="ink-corner"
							data-corner={corner}
							x={(corner.includes("w") ? box().x - 4 / zoom() : box().x + box().w + 4 / zoom()) - size() / 2}
							y={(corner.includes("n") ? box().y - 4 / zoom() : box().y + box().h + 4 / zoom()) - size() / 2}
							width={size()}
							height={size()}
							rx={2 / zoom()}
							stroke-width={1.5 / zoom()}
							onPointerDown={(event) => props.onCorner(event, corner)}
						/>
					);
				}}
			</For>
		</>
	);
}

/*
 * The pencil's touches are this sheet's alone. Safari on an iPad keeps a pencil press that comes
 * hard after a stroke for its own gestures (Scribble's handwriting, a double tap) and never hands
 * the page its pointerdown: the next stroke did nothing. Cancelling the browser's default for the
 * stylus's touch events, which pointer events cannot do, keeps every press a stroke. Fingers pan.
 */
function catchPencil(c: InkCtx, sheet: SVGSVGElement): () => void {
	const own = (event: TouchEvent) => {
		for (const touch of Array.from(event.changedTouches)) {
			if ((touch as Touch & { touchType?: string }).touchType === "stylus") {
				if (event.cancelable) event.preventDefault();
				return;
			}
		}
	};
	const options = { passive: false } as const;
	/*
	 * Once a pencil has been used the glass lets fingers through (`data-pencil`, ink.css), so a finger
	 * pans by the canvas's own scrolling and presses a card: the glass's `touch-action: none` had
	 * stopped every finger pan. The pencil (and a mouse) is caught on its way down instead, on the
	 * canvas it now lands on, and the stylus's touches are still kept from scrolling it there.
	 */
	const under = (sheet.closest(".stage") ?? sheet.parentElement ?? sheet) as HTMLElement;
	const onGlass = (event: Event) => event.target instanceof Node && sheet.contains(event.target);
	const caught = (event: PointerEvent) => {
		if (!penSeen() || onGlass(event)) return;
		if (event.pointerType !== "touch") return onDown(c, event);
		if (palm(c)) takePalm(c, event);
		else fingerDown(c, event);
	};
	const followed = (event: PointerEvent) => {
		if (!penSeen() || onGlass(event)) return;
		if (event.type === "pointermove") onMove(c, event);
		else onUp(c, event);
	};
	// A palm while the pencil is on the glass, or a moment after, does not scroll the canvas either.
	const palmScroll = (event: TouchEvent) => {
		if (penSeen() && palm(c) && event.cancelable) event.preventDefault();
	};
	const touches = ["touchstart", "touchmove", "touchend"] as const;
	const follows = ["pointermove", "pointerup", "pointercancel", "lostpointercapture"] as const;
	for (const type of touches) {
		sheet.addEventListener(type, own, options);
		under.addEventListener(type, own, options);
	}
	under.addEventListener("touchmove", palmScroll, options);
	under.addEventListener("pointerdown", caught, true);
	for (const type of follows) under.addEventListener(type, followed, true);
	return () => {
		for (const type of touches) {
			sheet.removeEventListener(type, own);
			under.removeEventListener(type, own);
		}
		under.removeEventListener("touchmove", palmScroll);
		under.removeEventListener("pointerdown", caught, true);
		for (const type of follows) under.removeEventListener(type, followed, true);
	};
}
