import { onCleanup } from "solid-js";
import { decideHover } from "../core/dispatch.ts";
import type { Pt } from "../core/model.ts";
import { type Picked, type PickOptions } from "../core/pick.ts";
import { type Editor } from "./controller.ts";
import type { Client, PointerHost } from "./pointer.ts";
import { pressTarget } from "./press-target.ts";

/** What `createHover` reads of `createPointer` (`pointer.ts`), each read when it is used. */
export interface HoverNeeds {
	readonly editor: Editor;
	readonly host: PointerHost;
	readonly worldAt: (event: Client) => Pt;
	readonly blockUnder: (at: Pt) => string | undefined;
	readonly pictureUnder: (event: Client) => string | undefined;
	readonly pickAtHere: (at: Pt, options?: PickOptions) => Picked | undefined;
}

export function createHover(d: HoverNeeds) {
	/**
	 * The outline a design tool draws round what the pointer is over, before anything is pressed:
	 * what a press there would select, and a card block's grip. The outline is edit mode's
	 * (`decideHover`): browsing selects and edits the drawing all the same, and before a press only
	 * the hand over a link and a card block's grip answer the pointer. A mouse or a pen with no button down, over the drawing; a
	 * board says when it is under the pointer (`PageFrame`), and anything else clears the item's.
	 * Once per frame at most.
	 */
	let hoverFrame: number | undefined;

	let hoverAt: Pt | undefined;

	let hoverPoint: Client | undefined;

	let hoverLights = false;

	/** The sleeping item whose node the pointer is on (`onHover`). */
	let hoverNode: string | undefined;

	const onHover = (event: PointerEvent) => {
		if (event.pointerType !== "touch") d.editor.hover({ alt: event.altKey });
		/*
		 * The pointer on a sleeping item's own node (its bar above the box, its edge band): the item
		 * stays hovered, though the point is outside its picture and the target is not the canvas, or
		 * the node would go as the pointer reached the bar it is there for.
		 */
		hoverNode = (event.target as Element | null)?.closest?.(".card-node[data-state='picture']")?.getAttribute("data-path") ?? undefined;
		const decided = decideHover({
			pointer: event.pointerType === "touch" ? "touch" : event.pointerType === "pen" ? "pen" : "mouse",
			editable: d.host.editable(),
			editing: d.host.mode() === "edit",
			drawing: d.host.drawing(),
			// The pointer on a block's grip keeps the grip, and the block it belongs to.
			onGrip: !!(event.target as Element | null)?.closest?.(".pen-grip"),
			buttons: event.buttons,
			tool: d.host.tool(),
			target: pressTarget(d.host.element(), event.target),
			hand: d.host.spaceHeld(),
		});
		if (decided.do === "none") return;
		if (decided.do === "clear") {
			hoverAt = undefined;
			/*
			 * The sleeping item under the pointer keeps its node through a press: its bar is what the press
			 * is on, and the bar's own handler runs after this one (Solid delegates it to the document), so
			 * clearing it here took the node away before the press could move or select the item.
			 */
			d.editor.hover({ ...(decided.block ? { block: undefined } : {}), item: undefined, ...(event.buttons === 0 ? { picture: hoverNode } : {}), link: false });
			return;
		}
		hoverAt = d.worldAt(event);
		hoverPoint = { clientX: event.clientX, clientY: event.clientY };
		hoverLights = decided.outlines;
		hoverFrame ??= requestAnimationFrame(() => {
			hoverFrame = undefined;
			const href = hoverAt ? d.host.linkAt(hoverAt) : undefined;
			// Browsing, the hand over a link and a card block's grip, but no outline; the sleeping item under the pointer still, which gets its bar to move it by (`items-layer.tsx`, `rendered`).
			if (!hoverLights) {
				d.editor.hover({ link: !!href && d.host.mode() === "browse", block: hoverAt ? d.blockUnder(hoverAt) : undefined, item: undefined, picture: (hoverAt && hoverPoint && d.host.mode() !== "edit" ? d.pictureUnder(hoverPoint) : undefined) ?? hoverNode });
				return;
			}
			d.editor.hover({ link: !!href && d.host.mode() === "browse", block: hoverAt ? d.blockUnder(hoverAt) : undefined });
			const hit = hoverAt ? d.pickAtHere(hoverAt) : undefined;
			// A board with no node says nothing when the pointer is over it, so the stage asks.
			d.editor.hover({ item: hit && !d.editor.items().includes(hit.id) ? hit.id : undefined, picture: (!hit && hoverAt && hoverPoint ? d.pictureUnder(hoverPoint) : undefined) ?? hoverNode });
		});
	};

	onCleanup(() => {
		if (hoverFrame !== undefined) cancelAnimationFrame(hoverFrame);
	});

	/*
	 * Alt, held or let go, for the distances it shows from the selection to what is hovered
	 * (`core/overlay.ts`, `distances`): from the keys, and from each pointer move, which also says
	 * so when the key went down or up while the window was not listening.
	 */
	const altKey = (event: KeyboardEvent) => {
		if (event.key === "Alt") d.editor.hover({ alt: event.type === "keydown" });
	};

	const altGone = () => d.editor.hover({ alt: false });

	addEventListener("keydown", altKey);

	addEventListener("keyup", altKey);

	addEventListener("blur", altGone);

	onCleanup(() => {
		removeEventListener("keydown", altKey);
		removeEventListener("keyup", altKey);
		removeEventListener("blur", altGone);
	});

	const onLeave = () => {
		d.editor.hover({ item: undefined, link: false });
	};

	return {
		onHover,
		onLeave,
	};
}
