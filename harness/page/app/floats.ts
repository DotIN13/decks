import { makeFloat } from "@decks/ui/float";
import { insets, insetsMoving } from "@decks/canvas/camera";

/*
 * The two floats: the composer and the conversation.
 *
 * Both are the app's own chrome, kept where they are by default. Taken by the grip or
 * the header they go where they are put, clamped to the surface, snapping home within
 * 24px, remembered per person in localStorage as a corner and an offset so a narrower
 * window keeps them on screen. Neither is an inset: a float over the canvas does not move
 * what is centred on the canvas, which is the rule `camera/insets.ts` keeps.
 */
export function createFloats() {
	/*
	 * The canvas column the floats may move in. The insets come from the signal, not from
	 * the `--inset-*` variables: the variables are written after the signal settles, so an
	 * effect on `insets()` that read them got the previous fold's numbers, and a float
	 * parked on the left stood still when the sidebar folded and then moved when it opened.
	 */
	let workRect: { width: number; height: number } | undefined;
	/*
	 * What the foot of the screen keeps for itself: as much of the home indicator's strip
	 * (`env(safe-area-inset-bottom)`, 25px on an iPad in Safari) as the composer's 12px does not already
	 * clear, and the keyboard while it is up. The stylesheet rests the composer there, so the floats'
	 * box stops there too:
	 * measured from the screen's own edge, home was 25px below where the composer rests, a drop near
	 * it landed low and then jumped, and a drop at the foot went under the home indicator.
	 */
	let footProbe: HTMLDivElement | undefined;
	const footInset = () => {
		if (!footProbe) {
			footProbe = document.createElement("div");
			footProbe.setAttribute("aria-hidden", "true");
			footProbe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:calc(max(12px, env(safe-area-inset-bottom, 0px)) - 12px + var(--keyboard, 0px))";
			document.body.appendChild(footProbe);
		}
		return parseFloat(getComputedStyle(footProbe).paddingBottom) || 0;
	};
	const workBox = () => {
		/* While the side panel is dragged the column's own box does not change, only its insets: the
		   box measured before is used, so a step reads nothing from a layout the drag has just dirtied. */
		if (!insetsMoving() || !workRect) {
			const rect = document.querySelector(".work")?.getBoundingClientRect();
			workRect = { width: rect?.width ?? window.innerWidth, height: rect?.height ?? window.innerHeight };
		}
		const { left, right } = insets();
		return { x: left, y: 0, w: workRect.width - left - right, h: workRect.height - footInset() };
	};
	/*
	 * What a float must not land on: the other floats, as they stand now, in `workBox`'s frame.
	 * Measured from the page rather than kept as state, so a float that has not been dragged,
	 * a conversation that is shut and a toolbar that is not mounted all say so on their own.
	 * Of a tucked float only its tab shows, so its tab is what there is to run into.
	 */
	const FLOATS = ".dock, .stream[data-shown='true']";
	const otherFloats = (el: HTMLElement) => () => {
		const work = document.querySelector(".work")?.getBoundingClientRect();
		return [...document.querySelectorAll<HTMLElement>(FLOATS)]
			.filter((other) => other !== el && other.offsetParent !== null)
			.map((other) => {
				const shown = other.hasAttribute("data-stowed") ? other.querySelector(":scope > .stowtab") : null;
				const r = (shown ?? other).getBoundingClientRect();
				return { x: r.left - (work?.left ?? 0), y: r.top - (work?.top ?? 0), w: r.width, h: r.height };
			});
	};
	/* Every mounted float, so one that has just landed can have the others step out of its way. */
	const floats = new Map<HTMLElement, { restore: () => void }>();
	/*
	 * `pin: "bottom"` writes the position as a `bottom` rather than a `top`. The composer is
	 * a column whose status row comes and goes above the box (it leaves when the conversation
	 * opens), and pinned by its top the box slid up into the row's place. Pinned by its
	 * bottom, the box stays where it was put and the row appears above it, which is what the
	 * dock's own CSS does at home. `read` is what a drag then starts from, because the top
	 * the float remembers is stale the moment the height changes.
	 */
	const mountFloat = (el: HTMLElement, key: string, handle: HTMLElement, ignore: string, home: () => { x: number; y: number }, pin: "top" | "bottom" = "top", stow?: { tab: number | (() => number); initially?: "left" | "right" }, disabled?: () => boolean) => {
		/* How tall the tab is (`--stowtab-h`, `shell.css`): a tucked float is only its tab. */
		const tabHeight = () => parseFloat(getComputedStyle(el).getPropertyValue("--stowtab-h")) || 48;
		let sized: { w: number; h: number } | undefined;
		const float = makeFloat(el, {
			...(stow ? { stow: { ...stow, tabHeight } } : {}),
			others: otherFloats(el),
			...(disabled ? { disabled } : {}),
			onSettled: () => {
				for (const [other, handle] of floats) if (other !== el) handle.restore();
			},
			key,
			handle,
			ignore,
			home,
			bounds: workBox,
			size: () => (sized = { w: el.offsetWidth, h: el.offsetHeight }),
			pin,
			read: () => ({ x: el.offsetLeft, y: el.offsetTop }),
			apply: (p, atHome, stowed) => {
				/*
				 * Put away, everything but the tab is out of reach as well as out of sight:
				 * `inert`, so Tab does not walk into a text box that is off the screen.
				 */
				if (stowed) el.setAttribute("data-stowed", stowed);
				else el.removeAttribute("data-stowed");
				for (const child of el.children) if (!child.hasAttribute("data-stowtab")) child.toggleAttribute("inert", stowed !== undefined);
				if (atHome || !p) {
					el.removeAttribute("data-floating");
					el.style.left = "";
					el.style.top = "";
					el.style.bottom = "";
					return;
				}
				el.setAttribute("data-floating", "true");
				el.style.left = `${p.x}px`;
				if (pin === "bottom") {
					el.style.top = "";
					// The height last measured: a step of a panel's resize places it without reading the layout.
					// From the column's own foot, not the box's: the box stops above the home indicator, the CSS `bottom` does not.
					const full = workRect?.height ?? workBox().h + footInset();
					el.style.bottom = `${full - (p.y + (sized?.h ?? el.offsetHeight))}px`;
				} else {
					el.style.bottom = "";
					el.style.top = `${p.y}px`;
				}
			},
		});
		floats.set(el, float);
		const dispose = float.dispose;
		return { ...float, dispose: () => { floats.delete(el); dispose(); } };
	};
	return { workBox, mountFloat };
}

export type Floats = ReturnType<typeof createFloats>;
