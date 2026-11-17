import { insets } from "@decks/canvas/camera";
import { setPenToolsAt } from "@decks/canvas/tools";
import { makeFloat } from "@decks/ui/float";
import { createEffect, onCleanup } from "solid-js";

/**
 * The tool column as a float: dragged by the grip at its head anywhere on the window, and a hard
 * throw at either edge tucks it behind that edge with its tab showing. Home is where the stylesheet
 * puts it, measured while it stands there, clear of the side panel.
 */
export function createToolsFloat(dockCover: () => number) {
	return (tools: HTMLElement, grip: HTMLElement): { unstow: () => void } => {
		let seen: { x: number; y: number } | undefined;
		const bounds = () => ({ x: 0, y: 0, w: innerWidth, h: innerHeight - dockCover() });
		const home = () => {
			if (!tools.hasAttribute("data-floating") && !tools.hasAttribute("data-stowed")) {
				const r = tools.getBoundingClientRect();
				seen = { x: r.left, y: r.top };
			}
			const { left, top } = insets();
			return seen ?? { x: left + 12, y: top + (innerHeight - top) / 2 - tools.offsetHeight / 2 };
		};
		const cssPx = (name: string, fallback: number) => parseFloat(getComputedStyle(tools).getPropertyValue(name)) || fallback;
		/*
		 * Where the column stands, said to the canvas: a card's style bar keeps clear of it (`penToolsAt`).
		 * On the canvas's own screen, so less where the frame is; nothing while it is tucked away.
		 */
		let saying = 0;
		let again: ReturnType<typeof setTimeout> | undefined;
		const measure = () => {
			// The frame fills the canvas's layer, which is there before the frame is.
			const frame = (document.querySelector("iframe.canvas-frame") ?? document.querySelector(".surface-layer[data-layer='stage']"))?.getBoundingClientRect() ?? { left: 0, top: 0 };
			const at = tools.getBoundingClientRect();
			setPenToolsAt(!at.width || tools.hasAttribute("data-stowed") ? undefined : { left: at.left - frame.left, top: at.top - frame.top, right: at.right - frame.left, bottom: at.bottom - frame.top });
		};
		/* Now, and once more when things have come to rest: the side panel slides in and the column glides home, and a place measured mid-way is not where either ends up. */
		const sayWhere = () => {
			cancelAnimationFrame(saying);
			saying = requestAnimationFrame(measure);
			clearTimeout(again);
			again = setTimeout(measure, 600);
		};
		const float = makeFloat(tools, {
			key: "pen-tools",
			handle: grip,
			ignore: "button, input, label",
			home,
			bounds,
			size: () => ({ w: tools.offsetWidth, h: tools.offsetHeight }),
			read: () => ({ x: tools.offsetLeft, y: tools.offsetTop }),
			stow: { tab: () => cssPx("--stowtab-w", 20), tabHeight: () => cssPx("--stowtab-h", 48) },
			apply: (p, atHome, stowed) => {
				sayWhere();
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
			sayWhere();
		});
		const sized = new ResizeObserver(sayWhere);
		sized.observe(tools);
		addEventListener("resize", sayWhere);
		addEventListener("transitionend", sayWhere, true);
		onCleanup(() => {
			cancelAnimationFrame(saying);
			clearTimeout(again);
			sized.disconnect();
			removeEventListener("resize", sayWhere);
			removeEventListener("transitionend", sayWhere, true);
			setPenToolsAt(undefined);
			float.dispose();
		});
		return { unstow: () => float.unstow() };
	
	};
}
