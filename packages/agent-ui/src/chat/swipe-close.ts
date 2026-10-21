/**
 * Swipe the chat sheet away, the way a phone already knows.
 *
 * The transcript slides in from the right edge on a narrow screen, and the natural way
 * to put it back is to slide it toward that edge and let go — the same gesture iOS and
 * Android both use for a sheet. Screw-up to avoid, and why:
 *
 * - The stream inside the sheet must still scroll. So this does nothing until the
 *   pointer's travel is *horizontal* and past a small threshold; a vertical drag is
 *   never touched and the browser scrolls as it always did.
 * - Once the sheet is being dragged, the CSS transition has to stand aside
 *   (`transition: none`), or it fights the finger — a panel that springs back mid-pull
 *   is a panel being yanked out of the hand. Release restores the transition, so
 *   settling the position is the same slide the open/close already has.
 * - The drag must not start from inside the stream mid-scroll. Horizontal intent is
 *   decided on the first few pixels and held: flipping from scroll to drag halfway is
 *   not a thing a hand can aim.
 *
 * One finger only, and touch only: a mouse has the title-bar button and the pin, and a
 * two-finger touch gesture belongs to the pinch the whole canvas shares.
 */

const HORIZONTAL = 8; // pixels of horizontal intent before a drag starts
const CLOSE_FRACTION = 0.28; // of the sheet's own width
const VELOCITY = 0.6; // px/ms at release that closes regardless of distance

export function attachSwipeClose(
	sheet: HTMLElement,
	isOpen: () => boolean,
	onClose: () => void,
): () => void {
	/** Whether the current drag owns the sheet: moving it with the finger. */
	let dragging = false;
	let startX = 0;
	let startY = 0;
	let dx = 0;
	let lastMove = 0; // timestamp of the most recent move, for the flick test
	let owner: number | undefined;

	const off = () => {
		dragging = false;
		owner = undefined;
		sheet.style.transition = "";
		sheet.style.transform = "";
	};

	const onPointerDown = (event: PointerEvent) => {
		if (event.pointerType !== "touch" || !isOpen() || owner !== undefined) return;
		startX = event.clientX;
		startY = event.clientY;
		dx = 0;
		// Watched on the window so the gesture survives leaving the sheet (a fast swipe
		// outruns the panel easily), and so a second finger joining just gets ignored.
		owner = event.pointerId;
		window.addEventListener("pointermove", onPointerMove, { passive: true });
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("pointercancel", onPointerUp);
	};

	const onPointerMove = (event: PointerEvent) => {
		if (event.pointerId !== owner) return;
		const travelX = event.clientX - startX;
		const travelY = event.clientY - startY;
		// Undecided yet: keep watching, touch nothing. A vertical drag owns the stream's
		// scroll from here on, so once it wins the sheet is released untouched.
		if (!dragging) {
			if (Math.abs(travelY) > Math.abs(travelX) && Math.abs(travelY) > HORIZONTAL) {
				window.removeEventListener("pointermove", onPointerMove);
				owner = undefined;
				return;
			}
			if (Math.abs(travelX) <= HORIZONTAL) return;
			dragging = true;
			event.preventDefault();
			// The panel's own slide is animated with a transition; a dragged panel
			// follows the finger instead, so the transition stands aside until release.
			sheet.style.transition = "none";
		}
		dx = travelX;
		lastMove = event.timeStamp;
		sheet.style.transform = `translateX(${travelX}px)`;
		if (event.cancelable) event.preventDefault();
	};

	const onPointerUp = (event: PointerEvent) => {
		if (event.pointerId !== owner) return;
		// A flick can cover little ground; a slow pull must cross the threshold. Either
		// habit closes the sheet, and neither one is a surprise. Velocity is read from the
		// last move, so a finger that stopped before lifting does not count as a flick.
		const elapsed = Math.max(1, event.timeStamp - lastMove);
		const flung = dx / elapsed > VELOCITY;
		const crossed = dx > sheet.clientWidth * CLOSE_FRACTION;
		// Let the panel's own transition take over for the return curve: a cleared inline
		// transform slides back to whichever state CSS describes.
		sheet.style.transition = "";
		sheet.style.transform = "";
		if (crossed || flung) onClose();
		off();
	};

	sheet.addEventListener("pointerdown", onPointerDown);
	return () => {
		sheet.removeEventListener("pointerdown", onPointerDown);
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", onPointerUp);
		window.removeEventListener("pointercancel", onPointerUp);
		off();
	};
}
const PULL_START = 6; // pixels down before the pull takes the sheet
const PULL_FRACTION = 0.2; // of the sheet's own height
/** The curve iOS moves its sheets on, and how long a sheet let go short of closing takes to settle back. */
const SHEET_CURVE = "cubic-bezier(0.32, 0.72, 0, 1)";
const SETTLE_MS = 320;

/**
 * Pull the history down by its grip to put it away, as a phone's bottom sheet goes.
 *
 * Only from the grip and the header around it, never from the turns: a downward drag in the
 * roll is a scroll. The sheet follows the finger down (never up), and on release it goes if it
 * travelled a fifth of its height or was flicked; otherwise it settles back on the panel's own
 * transition. The header's buttons keep their taps.
 */
export function attachPullClose(sheet: HTMLElement, grip: HTMLElement, isOpen: () => boolean, onClose: () => void): () => void {
	let owner: number | undefined;
	let startY = 0;
	let dy = 0;
	let pulling = false;
	let lastMove = 0;
	let lastDy = 0;
	let speed = 0;

	let settling: ReturnType<typeof setTimeout> | undefined;
	const unlisten = () => {
		owner = undefined;
		pulling = false;
		window.removeEventListener("pointermove", onMove);
		window.removeEventListener("pointerup", onUp);
		window.removeEventListener("pointercancel", onUp);
	};
	const reset = () => {
		clearTimeout(settling);
		unlisten();
		sheet.style.transition = "";
		sheet.style.transform = "";
	};

	/*
	 * Let go: the sheet carries on the way the finger sent it, on iOS's own sheet curve, rather
	 * than being clipped away where it stood. Going, it runs down past the bottom of the screen at
	 * the speed it was thrown (never slower than a brisk 0.9 px/ms), and only then is the history
	 * closed, out of sight; the inline transform is dropped two frames later, behind the closed
	 * clip. Staying, it eases back up on the same curve.
	 */
	const letGo = (go: boolean) => {
		unlisten();
		clearTimeout(settling);
		if (!go) {
			sheet.style.transition = `transform ${SETTLE_MS}ms ${SHEET_CURVE}`;
			sheet.style.transform = "";
			settling = setTimeout(() => (sheet.style.transition = ""), SETTLE_MS + 40);
			return;
		}
		const rest = Math.max(0, window.innerHeight - sheet.getBoundingClientRect().top + 24);
		const ms = Math.round(Math.min(420, Math.max(220, rest / Math.max(0.9, speed))));
		sheet.style.transition = `transform ${ms}ms ${SHEET_CURVE}`;
		sheet.style.transform = `translateY(${dy + rest}px)`;
		settling = setTimeout(() => {
			sheet.style.transition = "none";
			onClose();
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					sheet.style.transform = "";
					sheet.style.transition = "";
				}),
			);
		}, ms);
	};

	const onDown = (event: PointerEvent) => {
		if (event.pointerType === "mouse" || !isOpen() || owner !== undefined) return;
		if ((event.target as Element | null)?.closest?.("button, a")) return;
		owner = event.pointerId;
		startY = event.clientY;
		dy = 0;
		lastDy = 0;
		speed = 0;
		lastMove = event.timeStamp;
		window.addEventListener("pointermove", onMove, { passive: false });
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
	};

	const onMove = (event: PointerEvent) => {
		if (event.pointerId !== owner) return;
		dy = Math.max(0, event.clientY - startY);
		if (!pulling) {
			if (dy < PULL_START) return;
			pulling = true;
			sheet.style.transition = "none";
		}
		const elapsed = Math.max(1, event.timeStamp - lastMove);
		speed = (dy - lastDy) / elapsed;
		lastDy = dy;
		lastMove = event.timeStamp;
		sheet.style.transform = `translateY(${dy}px)`;
		if (event.cancelable) event.preventDefault();
	};

	const onUp = (event: PointerEvent) => {
		if (event.pointerId !== owner) return;
		const go = pulling && (dy > sheet.clientHeight * PULL_FRACTION || (speed > VELOCITY && event.timeStamp - lastMove < 80));
		if (pulling) letGo(go);
		else unlisten();
	};

	grip.addEventListener("pointerdown", onDown);
	return () => {
		grip.removeEventListener("pointerdown", onDown);
		reset();
	};
}
