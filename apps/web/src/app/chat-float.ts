import { panelOpen, setPanelOpen } from "../state/ui.ts";
import type { Floats } from "./floats.ts";

/**
 * The conversation out of the side panel: a float over the canvas, taken out and put back by hand.
 *
 * In the panel the conversation is its lower half (`shell/ChatSection.tsx`). Its head dragged takes
 * it out: once the press has moved a little the section leaves the panel, and the same press
 * carries it on as a float (`@decks/ui/float`, `grab`), so it is one gesture from the panel to
 * wherever it is let go. Out, it is a float like the composer: moved by its head, kept clear of the
 * other floats, a double-click on its head sending it home to the canvas's top right, its place
 * remembered on this device, and its size the person's by its corner. Let go over the open side
 * panel it goes back in, and while it is held there the panel shows where it will land
 * (`data-chat-drop`). Each head has a button for the same, for a finger and for the keyboard.
 *
 * Out, it shows whether the side panel is open or folded (`chat-layout.ts`, `chatShown`), which is
 * what taking it out is for: the canvas at its full width, with the conversation beside the work.
 */

interface ChatFloatLayout {
	setChatOut: (out: boolean) => void;
	setChatFolded: (folded: boolean) => void;
	holdHistory: () => void;
}

type Point = { x: number; y: number };
type Size = { w: number; h: number };
type Box = Point & Size;

/** Less movement than this and a press on a head was a click: on its title, which folds it. */
const LIFT = 6;
/** The float's size until the person gives it one, and what a size is kept within. */
const SIZE = { w: 380, h: 520 };
const LEAST = { w: 300, h: 220 };
const MOST_W = 760;
/** Where it rests at home: under the top bar, a margin in from the canvas's right edge. */
const HOME = { top: 64, right: 12 };
const SIZE_KEY = "decks.chatFloatSize";

export function createChatFloat(layout: ChatFloatLayout, { workBox, mountFloat }: Floats) {
	/** The press that is taking the conversation out of the panel, until the float is there to take it over. */
	let carried: { event: PointerEvent; grab: Point } | undefined;
	/** The float, while the conversation is out. */
	let float: ReturnType<Floats["mountFloat"]> | undefined;

	// --- taking it out, and putting it back ---------------------------------------------------

	const takeOut = () => {
		layout.setChatFolded(false);
		layout.setChatOut(true);
	};
	const putBack = () => {
		layout.setChatOut(false);
		layout.setChatFolded(false);
		setPanelOpen(true);
		layout.holdHistory();
	};

	const shell = () => document.querySelector<HTMLElement>(".panel-shell");
	/** Whether a pointer is over the side panel, open: where a held conversation is put back. */
	const overPanel = (event: PointerEvent): boolean => {
		const box = panelOpen() ? shell()?.getBoundingClientRect() : undefined;
		return !!box && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
	};
	const showLanding = (on: boolean) => {
		const panel = shell();
		if (!panel) return;
		if (on) panel.dataset.chatDrop = "true";
		else delete panel.dataset.chatDrop;
	};

	/**
	 * One press of a head, followed to its end. From the panel (`docked` is the section there) the
	 * conversation is taken out once the press has moved by `LIFT`; from the float it is already out
	 * and the float moves itself. Either way the panel shows the landing while the pointer is over it,
	 * and a release there puts the conversation back.
	 *
	 * Heard on the window before the float hears the same release, so a conversation put back is gone
	 * before its float would remember the place over the panel it was dropped at. A press that moved
	 * is not also a click on the title under it.
	 */
	const follow = (down: PointerEvent, docked?: HTMLElement) => {
		const from = docked?.getBoundingClientRect();
		let moved = false;
		let out = !docked;
		const move = (event: PointerEvent) => {
			if (event.pointerId !== down.pointerId) return;
			// A mouse moved with no button held was let go of somewhere that did not say so.
			if (event.pointerType === "mouse" && (event.buttons & 1) === 0) return end(event);
			if (!moved && Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) < LIFT) return;
			moved = true;
			if (!out && from) {
				out = true;
				carried = { event, grab: { x: down.clientX - from.left, y: down.clientY - from.top } };
				takeOut();
			}
			showLanding(overPanel(event));
		};
		const end = (event: PointerEvent) => {
			if (event.pointerId !== down.pointerId) return;
			window.removeEventListener("pointermove", move, true);
			window.removeEventListener("pointerup", end, true);
			window.removeEventListener("pointercancel", end, true);
			showLanding(false);
			carried = undefined;
			if (!moved) return;
			const swallow = (click: Event) => {
				click.stopPropagation();
				click.preventDefault();
			};
			window.addEventListener("click", swallow, { capture: true, once: true });
			setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
			if (out && event.type !== "pointercancel" && overPanel(event)) putBack();
		};
		window.addEventListener("pointermove", move, true);
		window.addEventListener("pointerup", end, true);
		window.addEventListener("pointercancel", end, true);
	};

	/** A press on a head that can move it: the main button, and not on one of the head's own buttons. */
	const moves = (event: PointerEvent) => event.button === 0 && !(event.target instanceof Element && event.target.closest(".v3-icon"));

	/** The docked head, pressed: a drag from here takes the conversation out of the panel. */
	const headDown = (event: PointerEvent, section: HTMLElement) => {
		if (moves(event)) follow(event, section);
	};

	// --- the float ------------------------------------------------------------------------------

	/**
	 * The float's section is on the page: give it its size and its place, and make its head move it.
	 * A conversation being carried out of the panel is put under the press that carries it, and that
	 * press goes on as the float's own drag. Returns what to run when the section leaves.
	 */
	const placed = (el: HTMLElement, head: HTMLElement): (() => void) => {
		wear(el, fit(savedSize(), workBox()));
		const home = () => {
			const box = workBox();
			return { x: box.x + box.w - el.offsetWidth - HOME.right, y: HOME.top };
		};
		// Held, it may be carried over the side panel, which is where it is put back; at rest it keeps to the canvas.
		const box = () => {
			const canvas = workBox();
			return el.dataset.dragging === "true" ? { x: 0, y: canvas.y, w: canvas.x + canvas.w, h: canvas.h } : canvas;
		};
		const mine = mountFloat(el, "conversation", head, ".v3-icon", home, "top", undefined, undefined, box);
		float = mine;
		const down = (event: PointerEvent) => {
			if (moves(event)) follow(event);
		};
		// Before the float's own listener, so this one's release is heard first (`follow`).
		head.addEventListener("pointerdown", down, true);
		if (carried) {
			const { event, grab } = carried;
			carried = undefined;
			const work = document.querySelector(".work")?.getBoundingClientRect();
			// The float may be narrower than the panel it left: the press stays on its head.
			mine.grab(event, { x: event.clientX - (work?.left ?? 0) - Math.min(grab.x, el.offsetWidth - 96), y: event.clientY - (work?.top ?? 0) - grab.y });
		}
		return () => {
			head.removeEventListener("pointerdown", down, true);
			mine.dispose();
			if (float === mine) float = undefined;
		};
	};

	/** The float's corner, pressed: a drag from there sizes it (`sizeByCorner`). */
	const cornerDown = (event: PointerEvent) => {
		if (float) sizeByCorner(event, float, workBox);
	};

	return { takeOut, putBack, headDown, placed, cornerDown };
}

// --- its size -------------------------------------------------------------------------------

/** The size the person gave it, kept on this device; its own until then. */
const savedSize = (): Size => {
	try {
		const [w, h] = (localStorage.getItem(SIZE_KEY) ?? "").split(",").map(Number);
		if (w && h && w > 0 && h > 0) return { w, h };
	} catch {
		// Its own size.
	}
	return SIZE;
};
/** A size kept within what is readable and what the canvas has room for. */
const fit = (size: Size, box: Box): Size => ({
	w: Math.round(Math.max(LEAST.w, Math.min(size.w, MOST_W, box.w - 24))),
	h: Math.round(Math.max(LEAST.h, Math.min(size.h, box.h - HOME.top - 12))),
});
const wear = (el: HTMLElement, size: Size) => {
	el.style.setProperty("--chat-float-w", `${size.w}px`);
	el.style.setProperty("--chat-float-h", `${size.h}px`);
};

/**
 * The float's corner, dragged: its size. The corner follows the pointer and the top left stays
 * where it is, so a float still at home is first given the place it stands at (home is its right
 * edge's, and would move the left one). Kept on this device when let go.
 */
function sizeByCorner(event: PointerEvent, float: { placeAt: (p: Point) => void }, workBox: () => Box): void {
	const corner = event.currentTarget as HTMLElement;
	const el = corner.closest<HTMLElement>(".v3-chat");
	if (event.button !== 0 || !el) return;
	event.preventDefault();
	event.stopPropagation();
	float.placeAt({ x: el.offsetLeft, y: el.offsetTop });
	const start = { w: el.offsetWidth, h: el.offsetHeight };
	try {
		corner.setPointerCapture(event.pointerId);
	} catch {
		// The window's listeners follow it.
	}
	el.dataset.sizing = "true";
	let done = false;
	const move = (next: PointerEvent) => {
		if (next.pointerId !== event.pointerId) return;
		if (next.pointerType === "mouse" && (next.buttons & 1) === 0) return end();
		const box = workBox();
		// No wider or taller than the room to its right and below it.
		const room = { w: box.x + box.w - el.offsetLeft - 6, h: box.h - el.offsetTop - 6 };
		wear(el, fit({ w: Math.min(start.w + next.clientX - event.clientX, room.w), h: Math.min(start.h + next.clientY - event.clientY, room.h) }, box));
	};
	const end = () => {
		if (done) return;
		done = true;
		window.removeEventListener("pointermove", move, true);
		window.removeEventListener("pointerup", end, true);
		window.removeEventListener("pointercancel", end, true);
		window.removeEventListener("blur", end);
		delete el.dataset.sizing;
		try {
			localStorage.setItem(SIZE_KEY, `${el.offsetWidth},${el.offsetHeight}`);
		} catch {
			// Kept for the session.
		}
		// Its place is remembered as a share of the room its size leaves: said again for the new size.
		float.placeAt({ x: el.offsetLeft, y: el.offsetTop });
	};
	window.addEventListener("pointermove", move, true);
	window.addEventListener("pointerup", end, true);
	window.addEventListener("pointercancel", end, true);
	window.addEventListener("blur", end);
}
