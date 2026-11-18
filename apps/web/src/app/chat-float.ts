import { insets, insetsMoving } from "@decks/canvas/camera";
import { createEffect, createSignal } from "solid-js";
import { panelOpen, setPanelOpen } from "../state/ui.ts";
import type { Floats } from "./floats.ts";

/**
 * The conversation out of the side panel: a float over the canvas, taken out and put back by its grip.
 *
 * In the panel the conversation is its lower half (`shell/ChatSection.tsx`), and that is its home.
 * The grip at the top of its head is its one handle. Dragged, it takes the conversation out: once
 * the press has moved a little the section leaves the panel, and the same press carries it on as a
 * float (`@decks/ui/float`, `grab`), so it is one gesture from the panel to wherever it is let go.
 *
 * Out, it is one of the floats (`floats.ts`), with everything the composer and the tools have: let
 * go it glides on with the throw, it parks against an edge, it keeps clear of the other floats, a
 * hard throw at the left or right edge puts it away behind its tab, it follows the side panel as
 * that is folded or sized, and its place is remembered on this device. What is its own: its corner
 * sizes it, it keeps under the top bars, and its home is the side panel. Let go over the open panel,
 * or thrown at it, it glides into its slot and is the panel's again; while it is held over the panel
 * the panel shows that slot (`landing`, a section of the panel's own layout, so it is exactly the
 * room the conversation takes). A double-click on the grip sends it home, as it does any float.
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

/** Less movement than this and a press on the grip was not a drag. */
const LIFT = 6;
/** The float's size until the person gives it one, and what a size is kept within. */
const SIZE = { w: 380, h: 520 };
const LEAST = { w: 300, h: 220 };
const MOST_W = 760;
/** Where it stands when nothing says where it was put: under the top bar, a margin in from the canvas's right edge. */
const HOME = { top: 68, right: 12 };
/**
 * A throw towards the side panel, from anywhere, goes home: leftwards at this many pixels a
 * millisecond or more (under the 1.2 a throw at an edge takes, so none of those is left to put it
 * away behind the panel), and no steeper than two down or up for one across, the slot being low in
 * the panel.
 */
const HOME_THROW = 0.9;
const HOME_SLOPE = 0.5;
/** How much of it shows when it is put away behind an edge: its tab. */
const STOW_TAB = 28;
const SIZE_KEY = "decks.chatFloatSize";

export function createChatFloat(layout: ChatFloatLayout, { workBox, mountFloat }: Floats) {
	/** The press that is taking the conversation out of the panel, until the float is there to take it over. */
	let carried: { event: PointerEvent; grab: Point } | undefined;
	/** The float, while the conversation is out. */
	let float: ReturnType<Floats["mountFloat"]> | undefined;
	/** Whether the conversation is held over the side panel: the panel shows the slot it lands in. */
	const [landing, setLanding] = createSignal(false);

	// --- taking it out, and putting it back ---------------------------------------------------

	const takeOut = () => {
		layout.setChatFolded(false);
		layout.setChatOut(true);
	};
	const putBack = () => {
		setLanding(false);
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

	/** What a press of the grip does to the conversation as it is followed (`followPress`). */
	const press = {
		overPanel,
		landing: setLanding,
		lift: (event: PointerEvent, grab: Point) => {
			carried = { event, grab };
			// The slot first, so the panel's list keeps its size as the conversation lifts out of it.
			setLanding(true);
			takeOut();
		},
		end: () => (carried = undefined),
	};
	const follow = (down: PointerEvent, docked?: HTMLElement) => followPress(down, docked, press);

	/** The docked grip, pressed: a drag from here takes the conversation out of the panel. */
	const gripDown = (event: PointerEvent, section: HTMLElement) => {
		if (event.button !== 0) return;
		// No text is selected by the drag that follows.
		event.preventDefault();
		follow(event, section);
	};

	// --- the float ------------------------------------------------------------------------------

	/**
	 * The float's section is on the page: give it its size and its place, and make its grip move it.
	 * A conversation being carried out of the panel is put under the press that carries it, and that
	 * press goes on as the float's own drag. Called as the section mounts, so the effect that keeps it
	 * beside the side panel ends with the section. Returns its tab's way back, and what to run when the
	 * section leaves.
	 */
	const placed = (el: HTMLElement, grip: HTMLElement): { unstow: () => void; dispose: () => void } => {
		wear(el, fit(savedSize(), workBox()));
		const work = () => document.querySelector(".work")?.getBoundingClientRect();
		// Its home is the side panel: where the conversation's section stands there, or would.
		const home = () => {
			const panel = shell()?.getBoundingClientRect();
			const slot = shell()?.querySelector(".v3-chat")?.getBoundingClientRect();
			return { x: (panel?.left ?? 0) - (work()?.left ?? 0), y: (slot?.top ?? (panel ? panel.top + panel.height / 2 : 0)) - (work()?.top ?? 0) };
		};
		/*
		 * Under the top bars, never over them: thrown upwards it comes to rest a margin below them, in
		 * line with the tools. Held, it may be carried over the side panel, which is its home; at rest it
		 * keeps to the canvas.
		 */
		const box = () => {
			const canvas = workBox();
			const top = underBars();
			const x = el.dataset.dragging === "true" ? 0 : canvas.x;
			return { x, y: top, w: canvas.x + canvas.w - x, h: canvas.h - top };
		};
		/*
		 * A release goes home, while the side panel is open, when the float would rest with its grip over
		 * the panel (let go there, or carried there by its throw), and when it is thrown towards the
		 * panel at all, from however far: a throw's carry is capped, so a hard one from across the canvas
		 * fell short of the panel and was taken for a throw at the edge, which put it away behind the
		 * panel's edge instead. The panel shows the slot, and the float takes the slot's size as it
		 * glides in, so what arrives is what the panel then holds.
		 */
		const homeward = (thrown: Point, velocity: { vx: number; vy: number }) => {
			const panel = panelOpen() ? shell()?.getBoundingClientRect() : undefined;
			const lands = !!panel && thrown.x + (work()?.left ?? 0) + el.offsetWidth / 2 < panel.right;
			const thrownAt = !!panel && -velocity.vx >= HOME_THROW && -velocity.vx >= Math.abs(velocity.vy) * HOME_SLOPE;
			const go = lands || thrownAt;
			setLanding(go);
			if (go) wearSlot(el);
			return go;
		};
		const mine = mountFloat(el, "conversation", grip, "button", home, "top", { tab: STOW_TAB }, undefined, { box, homeward, onHome: putBack });
		float = mine;
		const down = (event: PointerEvent) => {
			if (event.button === 0 && !mine.stowed()) follow(event);
		};
		// A double-click sends it home as it does any float: into the slot, where its home is, or straight back when the panel is folded.
		const goHome = (event: MouseEvent) => {
			event.stopImmediatePropagation();
			event.preventDefault();
			if (mine.stowed()) return;
			if (!panelOpen()) return putBack();
			setLanding(true);
			wearSlot(el);
			mine.goHome();
		};
		// Before the float's own listeners, so this one's release is heard first (`follow`).
		grip.addEventListener("pointerdown", down, true);
		grip.addEventListener("dblclick", goHome, true);
		if (carried) {
			const { event, grab } = carried;
			carried = undefined;
			// The float may be narrower than the panel it left: the press stays on its grip.
			mine.grab(event, { x: event.clientX - (work()?.left ?? 0) - Math.min(grab.x, el.offsetWidth / 2), y: event.clientY - (work()?.top ?? 0) - grab.y });
		} else if (!el.hasAttribute("data-floating") && !mine.stowed()) {
			// Out, with nothing kept of where: it stands under the top-right bar.
			const canvas = workBox();
			mine.placeAt({ x: canvas.x + canvas.w - el.offsetWidth - HOME.right, y: HOME.top });
		}
		// The side panel folded or sized moves the canvas's column, and the float with it, as the other floats go.
		createEffect(() => {
			insets();
			if (insetsMoving()) return mine.follow();
			mine.restore();
		});
		return {
			unstow: () => mine.unstow(),
			dispose: () => {
				grip.removeEventListener("pointerdown", down, true);
				grip.removeEventListener("dblclick", goHome, true);
				mine.dispose();
				if (float === mine) float = undefined;
			},
		};
	};

	/** The float's corner, pressed: a drag from there sizes it (`sizeByCorner`). */
	const cornerDown = (event: PointerEvent) => {
		if (float && !float.stowed()) sizeByCorner(event, float, workBox);
	};

	return { landing, gripDown, placed, cornerDown };
}

// --- a press of the grip ----------------------------------------------------------------------

/**
 * One press of the grip, followed to its end. From the panel (`docked` is the section there) the
 * conversation is lifted out once the press has moved by `LIFT`; from the float it is already out
 * and the float moves itself. Either way the panel shows the slot while the pointer is over it.
 * Where a release sends the float is the float's to say (`homeward`), which hears it after this.
 */
function followPress(
	down: PointerEvent,
	docked: HTMLElement | undefined,
	on: { overPanel: (event: PointerEvent) => boolean; landing: (over: boolean) => void; lift: (event: PointerEvent, grab: Point) => void; end: () => void },
): void {
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
			on.lift(event, { x: down.clientX - from.left, y: down.clientY - from.top });
		}
		on.landing(on.overPanel(event));
	};
	const end = (event: PointerEvent) => {
		if (event.pointerId !== down.pointerId) return;
		window.removeEventListener("pointermove", move, true);
		window.removeEventListener("pointerup", end, true);
		window.removeEventListener("pointercancel", end, true);
		on.end();
		on.landing(false);
	};
	window.addEventListener("pointermove", move, true);
	window.addEventListener("pointerup", end, true);
	window.addEventListener("pointercancel", end, true);
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
/** The slot's size, taken by the float as it glides into it. */
const wearSlot = (el: HTMLElement) => {
	const slot = document.querySelector(".panel-shell .v3-chat-slot")?.getBoundingClientRect();
	if (slot) wear(el, { w: Math.round(slot.width), h: Math.round(slot.height) });
};
/** How far down the top bars reach, in the canvas column's frame: the float keeps under them. */
const underBars = (): number => {
	const top = document.querySelector(".work")?.getBoundingClientRect().top ?? 0;
	let bottom = 0;
	for (const bar of document.querySelectorAll(".v3-topbar, .v3-topright")) if (bar.getClientRects().length > 0) bottom = Math.max(bottom, bar.getBoundingClientRect().bottom - top);
	return bottom;
};
const wear = (el: HTMLElement, size: Size) => {
	el.style.setProperty("--chat-float-w", `${size.w}px`);
	el.style.setProperty("--chat-float-h", `${size.h}px`);
};

/**
 * The float's corner, dragged: its size. The corner follows the pointer and the top left stays
 * where it is. Kept on this device when let go.
 */
function sizeByCorner(event: PointerEvent, float: { placeAt: (p: Point) => void }, workBox: () => Box): void {
	const corner = event.currentTarget as HTMLElement;
	const el = corner.closest<HTMLElement>(".v3-chat");
	if (event.button !== 0 || !el) return;
	event.preventDefault();
	event.stopPropagation();
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
