import { createSignal, onCleanup } from "solid-js";

/**
 * How much of the window the chrome is covering, on each edge.
 *
 * The chrome declares itself — `data-inset="left"` on the boards panel, `"right"` on the
 * inspector, `"top"` on the two top clusters — and this **measures** what it declared. That
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
 * The rule the boards settle on: *a surface that arrives on its own must be subtracted; a
 * surface you summoned may overlap.* The inspector appears on selection whether you asked
 * or not, so it insets; the conversation you pressed a button for, so it does not.
 *
 * A bottom sheet on a phone is not an inset either. It covers the canvas rather than
 * standing beside it, and subtracting it fitted a 1600px board into the strip above the
 * sheet at 3.7%.
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
			const r = el.getBoundingClientRect();
			// A hidden or slid-away surface measures nothing, so nothing has to deregister it.
			if (r.width === 0 || r.height === 0) continue;
			// Distance from its own edge to the far side of the element, plus its margin —
			// which is why this reads the rect rather than the offsetWidth: a panel inset 12px
			// from the edge is 12px of gutter the canvas cannot use either.
			if (edge === "left") next.left = Math.max(next.left, r.right);
			if (edge === "right") next.right = Math.max(next.right, view.width - r.left);
			if (edge === "top") next.top = Math.max(next.top, r.bottom);
			if (edge === "bottom") next.bottom = Math.max(next.bottom, view.height - r.top);
		}
		const now = insets();
		if (now.left !== next.left || now.right !== next.right || now.top !== next.top || now.bottom !== next.bottom) {
			setInsets(next);
		}
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
