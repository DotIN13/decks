import type { Pt } from "../core/model.ts";
import { type EffectHost } from "./effects.ts";

/** What `createGhost` reads of `createEffects` (`effects.ts`). */
export interface GhostNeeds {
	readonly host: EffectHost;
}

/** The ghost of what is dragged towards the composer: a small picture of the items that follows the pointer. */
export function createGhost(d: GhostNeeds) {
	/*
	 * The ghost of what a drag carries over a card: a picture of the items cut from the sheet as the
	 * drag starts, laid beside the pointer with a shadow and a slight tilt, as the card's own pieces are
	 * (`pen/CardEditor.tsx`), while the carried picture and the selection's handles stand aside.
	 */
	let ghost: { el?: HTMLCanvasElement; rect: { left: number; top: number; width: number; height: number } } | undefined;

	/** Where the carried items lie on screen as the drag starts: the ghost is cut from there. */
	const ghostTake = (ids: readonly string[]) => {
		ghostDrop();
		const element = d.host.element();
		if (!element || !ids.length) return;
		const r = element.getBoundingClientRect();
		const boxes = ids.map((id) => d.host.box(id)).filter((b): b is NonNullable<typeof b> => !!b);
		if (!boxes.length) return;
		const a = d.host.toScreen({ x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)) });
		const b = d.host.toScreen({ x: Math.max(...boxes.map((b) => b.x + b.w)), y: Math.max(...boxes.map((b) => b.y + b.h)) });
		ghost = { rect: { left: r.left + a.x, top: r.top + a.y, width: b.x - a.x, height: b.y - a.y } };
	};

	/** Over a card, the ghost beside the pointer `gap` px off; elsewhere, the carried picture as before. */
	const ghostShow = (over: boolean, client?: Pt, gap = 12) => {
		if (over && ghost && !ghost.el) {
			const el = d.host.cutFromCarried(ghost.rect);
			if (el) {
				el.className = "pen-drag-ghost";
				// A large item rides at most about a card's width, so the slot it is aimed at stays in view.
				const scale = Math.min(1, 220 / Math.max(ghost.rect.width, 1));
				el.style.width = `${ghost.rect.width * scale}px`;
				el.style.height = `${ghost.rect.height * scale}px`;
				document.body.append(el);
				ghost.el = el;
			}
		}
		const showing = over && !!ghost?.el;
		d.host.element()?.toggleAttribute("data-ghosting", showing);
		d.host.showCarriedLayer(!showing);
		if (!ghost?.el) return;
		ghost.el.hidden = !over;
		if (over && client) {
			ghost.el.style.left = `${client.x + gap}px`;
			ghost.el.style.top = `${client.y + gap}px`;
		}
	};

	const ghostDrop = () => {
		ghost?.el?.remove();
		ghost = undefined;
		d.host.element()?.removeAttribute("data-ghosting");
		d.host.showCarriedLayer(true);
	};

	return {
		ghostTake,
		ghostShow,
		ghostDrop,
	};
}
