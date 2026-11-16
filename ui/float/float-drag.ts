import { clamp, fling, settle as restingPlace, toFraction, velocityFrom, verticalShare } from "./float-math.ts";
import { saveStowed, stowedAt, stowSide, stowY } from "./stowed.ts";
import { cancelSettle, clear, onIgnored, place, remember, sendHome, settle, tabWidth, type FloatState } from "./float-place.ts";

/** Fewer pixels than this and a press was a click, not a drag; nothing is saved. */
export const DRAG_THRESHOLD = 3;

/** How many recent pointer positions to keep for the velocity at release. */
const SAMPLES = 8;

/*
 * A drag is followed on the window, not only on the handle, whose capture can be lost: it ends on
 * any release or cancel of its pointer, the window losing focus, or a move with no button held.
 */
export function onWindowMove(f: FloatState, event: PointerEvent): void {
	if (!f.drag || event.pointerId !== f.drag.pointerId) return;
	if (event.pointerType === "mouse" && (event.buttons & 1) === 0) return endDrag(f, event);
	onPointerMove(f, event);
}

export function onWindowUp(f: FloatState, event: PointerEvent): void {
	endDrag(f, event);
}

export function onWindowBlur(f: FloatState): void {
	if (f.drag) endDrag(f, { pointerId: f.drag.pointerId, timeStamp: performance.now() });
}

export function listen(f: FloatState, on: boolean): void {
	const method = on ? "addEventListener" : "removeEventListener";
	window[method]("pointermove", f.h.onWindowMove as EventListener, true);
	window[method]("pointerup", f.h.onWindowUp as EventListener, true);
	window[method]("pointercancel", f.h.onWindowUp as EventListener, true);
	window[method]("blur", f.h.onWindowBlur);
}

export function endDrag(f: FloatState, event: Pick<PointerEvent, "pointerId" | "timeStamp">): void {
	if (!f.drag || event.pointerId !== f.drag.pointerId) return;
	const { moved, samples } = f.drag;
	f.drag = undefined;
	listen(f, false);
	delete f.el.dataset.dragging;
	try {
		f.handle.releasePointerCapture(event.pointerId);
	} catch {
		// Capture may already be gone, as after a pointercancel.
	}
	// A press that did not move is a click, and a click must not turn "home" into a
	// stored position.
	if (!moved || f.current === undefined) {
		if (f.current === undefined) place(f, undefined);
		return;
	}
	// A throw carries on: the velocity at release is projected forward, then the
	// resting place is home if that lands near it, an edge if it lands near one, and
	// inside the bounds whatever else. A placement (the pointer paused before letting
	// go) has no velocity and rests where it was put, edges and home still applying.
	const velocity = velocityFrom(samples, event.timeStamp);
	// Thrown hard at its edge, it is put away. The position it had before this f.drag
	// stays saved, because that is where the tab brings it back to.
	const side = f.options.stow ? stowSide(f.current, velocity, f.size(), f.bounds()) : undefined;
	if (f.options.stow && side) {
		f.stowed = side;
		// Down the edge as far as the throw was heading, bent up only if that is taken.
		const at = clear(f, stowedAt(stowY(f.current, velocity, f.size(), f.bounds(), side), f.size(), f.bounds(), tabWidth(f), 12, side));
		saveStowed(f.key, { fy: verticalShare(at, f.size(), f.bounds(), 6, f.pin), side }, f.storage);
		settle(f, at, false, true);
		return;
	}
	const thrown = fling(f.current, velocity);
	const rest = restingPlace(thrown, f.size(), f.bounds(), f.home());
	if (rest.home) {
		remember(f, "home");
		settle(f, rest.p, true, true);
		return;
	}
	const clearOf = clear(f, rest.p);
	remember(f, toFraction(clearOf, f.size(), f.bounds(), 6, f.pin));
	settle(f, clearOf, false, true);
}

export function onPointerDown(f: FloatState, event: PointerEvent): void {
	if (f.disabled() || f.stowed || event.button !== 0 || f.drag || onIgnored(f, event.target)) return;
	// Taken mid-glide, it stops where it is and the f.drag starts from there.
	cancelSettle(f);
	if (f.current !== undefined && f.options.read) f.current = f.options.read();
	f.drag = {
		pointerId: event.pointerId,
		startPointer: { x: event.clientX, y: event.clientY },
		startPos: f.current ?? f.home(),
		moved: false,
		samples: [{ x: event.clientX, y: event.clientY, t: event.timeStamp }],
	};
	try {
		f.handle.setPointerCapture(event.pointerId);
	} catch {
		// Some engines refuse capture for synthetic pointers; the window's listeners follow it.
	}
	listen(f, true);
	f.el.dataset.dragging = "true";
	event.preventDefault();
}

export function onPointerMove(f: FloatState, event: PointerEvent): void {
	if (!f.drag || event.pointerId !== f.drag.pointerId) return;
	const dx = event.clientX - f.drag.startPointer.x;
	const dy = event.clientY - f.drag.startPointer.y;
	if (!f.drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
	f.drag.moved = true;
	f.drag.samples.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
	if (f.drag.samples.length > SAMPLES) f.drag.samples.shift();
	// Clamped while moving too, so the float never disappears past an edge mid-drag.
	place(f, clamp({ x: f.drag.startPos.x + dx, y: f.drag.startPos.y + dy }, f.size(), f.bounds()));
}

export function onDoubleClick(f: FloatState, event: MouseEvent): void {
	if (f.disabled() || f.stowed || onIgnored(f, event.target)) return;
	event.preventDefault();
	sendHome(f);
}
