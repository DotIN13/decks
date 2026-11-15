import { clamp, saveStowed, verticalShare } from "./float-math.ts";
import { DRAG_THRESHOLD, listen } from "./float-drag.ts";
import { cancelSettle, clear, place, settle, type FloatState } from "./float-place.ts";

/** How far a tucked float's tab must be pulled in off its edge before the float comes out with it. */
const PULL_OUT = 48;

/*
 * The tab of a tucked float is a handle too. Pressed and let go, it is a click (its own button
 * brings the float back). Dragged along the edge, the tab goes where it is put, bent up clear of the
 * others. Pulled in off the edge by `PULL_OUT`, the float comes out and the rest is an ordinary drag.
 */
/** A drag of the tab ends in a click on it; that click must not also bring the float back. */
export function swallowClick(f: FloatState): void {
	const swallow = (event: Event): void => {
		event.stopPropagation();
		event.preventDefault();
	};
	f.el.addEventListener("click", swallow, { capture: true, once: true });
	setTimeout(() => f.el.removeEventListener("click", swallow, { capture: true }), 0);
}

export function onTabDown(f: FloatState, event: PointerEvent): void {
	const tab = event.target instanceof Element ? event.target.closest("[data-stowtab]") : null;
	if (!tab || !f.stowed || f.current === undefined || f.disabled() || event.button !== 0 || f.drag || f.tabDrag) return;
	cancelSettle(f);
	f.tabDrag = { pointerId: event.pointerId, tab, startPointer: { x: event.clientX, y: event.clientY }, startY: f.current.y, moved: false };
	try {
		tab.setPointerCapture(event.pointerId);
	} catch {
		// The window's listeners follow it.
	}
	listenTab(f, true);
}

/* The tab's drag is followed on the window too, for the same reason as the float's (`listen`). */
export function onTabWindowMove(f: FloatState, event: PointerEvent): void {
	if (!f.tabDrag || event.pointerId !== f.tabDrag.pointerId) return;
	if (event.pointerType === "mouse" && (event.buttons & 1) === 0) return onTabUp(f, event);
	onTabMove(f, event);
}

export function onTabWindowUp(f: FloatState, event: PointerEvent): void {
	onTabUp(f, event);
}

export function onTabBlur(f: FloatState): void {
	if (f.tabDrag) onTabUp(f, { pointerId: f.tabDrag.pointerId });
}

export function listenTab(f: FloatState, on: boolean): void {
	const method = on ? "addEventListener" : "removeEventListener";
	window[method]("pointermove", f.h.onTabWindowMove as EventListener, true);
	window[method]("pointerup", f.h.onTabWindowUp as EventListener, true);
	window[method]("pointercancel", f.h.onTabWindowUp as EventListener, true);
	window[method]("blur", f.h.onTabBlur);
}

export function onTabMove(f: FloatState, event: PointerEvent): void {
	if (!f.tabDrag || event.pointerId !== f.tabDrag.pointerId || f.current === undefined || !f.stowed) return;
	const dx = event.clientX - f.tabDrag.startPointer.x;
	const dy = event.clientY - f.tabDrag.startPointer.y;
	if (!f.tabDrag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
	if (!f.tabDrag.moved) {
		f.tabDrag.moved = true;
		f.el.dataset.dragging = "true";
	}
	const inward = f.stowed === "right" ? -dx : dx;
	if (inward > PULL_OUT) {
		// Out it comes, held by its own f.handle: the float jumps so the top middle of the
		// f.handle (the grip, or the strip along the composer's top) is under the pointer,
		// as if it had been taken there. From here it is an ordinary f.drag, captured by the
		// f.handle so the f.drag's own listeners take it.
		const { pointerId } = f.tabDrag;
		const box = f.el.getBoundingClientRect();
		const grip = f.handle.getBoundingClientRect();
		const held = { x: grip.left - box.left + grip.width / 2, y: grip.top - box.top + Math.min(7, grip.height / 2) };
		try {
			f.tabDrag.tab.releasePointerCapture(pointerId);
		} catch {
			// Already released.
		}
		swallowClick(f);
		f.tabDrag = undefined;
		listenTab(f, false);
		f.stowed = undefined;
		saveStowed(f.key, undefined, f.storage);
		// Where the f.handle would be under the pointer; placed inside the bounds, but the f.drag
		// starts from the unclamped spot, so a wide float that cannot fit there yet catches up
		// with the pointer as soon as it has room, instead of lagging by the difference.
		const grabbed = { x: f.current.x + event.clientX - (box.left + held.x), y: f.current.y + event.clientY - (box.top + held.y) };
		const out = clamp(grabbed, f.size(), f.bounds());
		place(f, out);
		f.drag = {
			pointerId,
			startPointer: { x: event.clientX, y: event.clientY },
			startPos: grabbed,
			moved: true,
			samples: [{ x: event.clientX, y: event.clientY, t: event.timeStamp }],
		};
		try {
			f.handle.setPointerCapture(pointerId);
		} catch {
			// The window's listeners follow it.
		}
		listen(f, true);
		return;
	}
	const y = clamp({ x: f.bounds().x, y: f.tabDrag.startY + dy }, f.size(), f.bounds(), 12).y;
	place(f, { x: f.current.x, y });
}

export function onTabUp(f: FloatState, event: Pick<PointerEvent, "pointerId">): void {
	if (!f.tabDrag || event.pointerId !== f.tabDrag.pointerId) return;
	const { moved, tab } = f.tabDrag;
	f.tabDrag = undefined;
	listenTab(f, false);
	delete f.el.dataset.dragging;
	try {
		tab.releasePointerCapture(event.pointerId);
	} catch {
		// Capture may already be gone.
	}
	if (!moved || f.current === undefined || !f.stowed) return;
	swallowClick(f);
	const at = clear(f, f.current);
	saveStowed(f.key, { fy: verticalShare(at, f.size(), f.bounds(), 6, f.pin), side: f.stowed }, f.storage);
	settle(f, at, false, true);
}
