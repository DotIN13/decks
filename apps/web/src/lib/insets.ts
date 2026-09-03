import { createSignal, onCleanup } from "solid-js";

/**
 * How much of the window the chrome is covering, on each edge.
 *
 * The chrome declares itself — `data-inset="left"` on the boards panel, `"top"` on the two
 * top clusters — and this **measures** what it declared. That
 * is the whole point and it is worth being blunt about it: the width of a panel must not be
 * stated twice. A constant beside a stylesheet drifts the first time someone changes the
 * padding, and every camera bug that follows looks like a camera bug.
 *
 * So: one `ResizeObserver` over everything carrying the attribute, and the largest extent
 * per edge wins. An element that is display:none, or transformed off-screen, measures zero
 * on its own — nothing has to remember to unregister it.
 *
 * ### What is deliberately *not* an inset
 *
 * The floating conversation. It is a column of cards over the boards with click-through
 * gaps, and a board is allowed to sit under it — see `boards/the-conversation-panel-drawn`.
 *
 * The inspector, which used to be the `"right"` in that list. The rule was *a surface that
 * arrives on its own must be subtracted; a surface you summoned may overlap*, and on that
 * reading the inspector qualified: it appears when you select something, asked for or not.
 * What the reading missed is that it is no longer a column — it is a 320px card in the
 * top-right corner, under the tool cluster — and subtracting its width moved the input bar
 * 160px sideways on every click on a component. So the rule the chrome actually keeps is
 * about geometry, not intent: **a surface that stands beside the canvas is subtracted; one
 * that floats over a corner of it is not.** The boards panel is a column and insets; the
 * cluster and the inspector float and do not.
 *
 * A bottom sheet on a phone is not an inset either, for the same reason. It covers the
 * canvas rather than standing beside it, and subtracting it fitted a 1600px board into the
 * strip above the sheet at 3.7%.
 */
export interface Insets {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

const ZERO: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

const [insets, setInsets] = createSignal<Insets>(ZERO);

/** What the chrome is covering right now. */
export { insets };

/**
 * The canvas's own width and height: the window, minus the chrome standing beside it.
 *
 * What `fit` should frame into, and what the dock centres on — a bar centred on the window
 * is a bar half under a panel, and one centred on this is a bar centred on what you are
 * looking at.
 */
export function canvasBox(view: { width: number; height: number }) {
	const i = insets();
	return {
		x: i.left,
		y: i.top,
		width: Math.max(0, view.width - i.left - i.right),
		height: Math.max(0, view.height - i.top - i.bottom),
	};
}

/**
 * Start watching. Called once, from `App`.
 *
 * A `MutationObserver` as well as the resize one, because the chrome comes and goes: the
 * inspector is mounted on selection and the panel is unmounted when folded, and an observer
 * that only watched the elements present at startup would keep measuring a panel that has
 * since left the document.
 */
export function watchInsets(root: HTMLElement = document.body): void {
	let sizes = new ResizeObserver(() => measure());
	const tracked = new Set<Element>();

	const measure = () => {
		const view = { width: window.innerWidth, height: window.innerHeight };
		const next: Insets = { ...ZERO };
		for (const el of tracked) {
			const edge = (el as HTMLElement).dataset.inset as keyof Insets | undefined;
			if (!edge) continue;
			/*
			 * The *layout* box, not the painted one — `offsetLeft`/`offsetTop` ignore
			 * transforms where `getBoundingClientRect` does not.
			 *
			 * That distinction is the whole of a bug. The panel is slid out with a `translate`
			 * rather than unmounted, so it animates; measured by its painted rect, a panel
			 * that had just been asked to open was still off-screen at the moment its
			 * `data-inset` came back, so the camera recorded nothing — and the ResizeObserver
			 * never fired again, because a transform is not a resize. The canvas kept the
			 * whole window for the rest of the session.
			 *
			 * Layout coordinates say where a surface *is* rather than where it is currently
			 * drawn, which is also the honest answer for a camera: a panel arriving is a panel
			 * the boards should already be making room for.
			 *
			 * These elements are all `position: fixed` with no positioned ancestor, so their
			 * offsets are viewport coordinates.
			 */
			const box = el as HTMLElement;
			const width = box.offsetWidth;
			const height = box.offsetHeight;
			// A surface that is `display: none` measures nothing, so nothing has to
			// deregister it — but one that is merely slid away still counts, which is the
			// point of reading the layout box.
			if (width === 0 || height === 0) continue;
			// Its own edge to the far side of it, gutter included: a panel inset 12px from the
			// window is 12px the canvas cannot use either.
			if (edge === "left") next.left = Math.max(next.left, box.offsetLeft + width);
			if (edge === "right") next.right = Math.max(next.right, view.width - box.offsetLeft);
			if (edge === "top") next.top = Math.max(next.top, box.offsetTop + height);
			if (edge === "bottom") next.bottom = Math.max(next.bottom, view.height - box.offsetTop);
		}
		const now = insets();
		if (now.left === next.left && now.right === next.right && now.top === next.top && now.bottom === next.bottom) return;
		setInsets(next);
		/*
		 * Published as custom properties as well as a signal, so that the parts of the
		 * layout which are genuinely CSS can stay CSS.
		 *
		 * The dock is the reason: it centres on the canvas column, and expressing that as
		 * `calc()` over these four numbers means the browser animates the slide and reflows
		 * it on resize without a single line of JavaScript in the path. A component that
		 * needs to *decide* something reads the signal; a rule that needs to *measure*
		 * something reads these.
		 */
		const root = document.documentElement.style;
		root.setProperty("--inset-left", `${next.left}px`);
		root.setProperty("--inset-right", `${next.right}px`);
		root.setProperty("--inset-top", `${next.top}px`);
		root.setProperty("--inset-bottom", `${next.bottom}px`);
	};

	const sync = () => {
		const found = new Set(root.querySelectorAll("[data-inset]"));
		for (const el of tracked) {
			if (!found.has(el)) {
				sizes.unobserve(el);
				tracked.delete(el);
			}
		}
		for (const el of found) {
			if (!tracked.has(el)) {
				sizes.observe(el);
				tracked.add(el);
			}
		}
		measure();
	};

	const tree = new MutationObserver(sync);
	tree.observe(root, { childList: true, subtree: true, attributeFilter: ["data-inset"] });
	window.addEventListener("resize", measure);
	sync();

	onCleanup(() => {
		tree.disconnect();
		sizes.disconnect();
		sizes = new ResizeObserver(() => {});
		window.removeEventListener("resize", measure);
	});
}
