/**
 * Opt in from inside an embedded page: keep the scrolls you can use, hand back the rest.
 *
 *     <script src="../lib/embed-guest.js"></script>
 *
 * An `[data-embed]` HTML file is mounted in a sandboxed iframe, one document deeper than
 * the board and in an opaque origin, so the canvas cannot listen for the wheel events
 * that happen over it (DESIGN §4, §7). Without this, board.js covers the frame with a
 * veil and asks for a click before the page gets the pointer at all — correct for a page
 * it knows nothing about, and a nuisance for a demo written in this very deck.
 *
 * So this says the page can be trusted with the pointer, and gives the gesture back when
 * it has no use for it. The rule is the one the canvas already applies to boxes inside a
 * board: a scroll something here can still take is taken here, and everything else —
 * including the moment a box reaches its end — belongs to the canvas.
 *
 * Include it and the page needs no other change. Nothing is read back, no callbacks, and
 * a page that includes it while opened on its own does nothing at all.
 *
 * Fingers go the same way. A one-finger drag over an embed used to move nothing at all —
 * the browser gave it to this document, which had nothing to do with it — and two fingers
 * could not pinch. Both are handed up now, by the same rule, with one difference the
 * canvas already makes: what a page takes over from the browser it has to do by hand, so
 * a box with its own overflow is scrolled here rather than natively (`touch-action: none`
 * is what keeps the events coming, and without it the browser claims the gesture and
 * stops delivering them mid-drag). Taps are untouched: nothing is prevented on a
 * `pointerdown`, so buttons and links behave.
 */
(() => {
	if (window.parent === window) return;

	const post = (message) => {
		try {
			window.parent.postMessage(message, "*");
		} catch {
			/* a parent that has gone away is not an error worth a console line */
		}
	};

	/*
	 * Announced twice on purpose. The board mounts the frame and starts listening before
	 * this file has been fetched, so the first is normally the one that lands; the second
	 * covers a remount of the embed, where a fresh listener wants telling again.
	 */
	post({ t: "decks:embed-ready" });
	window.addEventListener("load", () => post({ t: "decks:embed-ready" }));
	window.addEventListener("pageshow", () => post({ t: "decks:embed-ready" }));

	const canScroll = (element, deltaX, deltaY) => {
		const style = getComputedStyle(element);
		const vertical = /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
		const horizontal = /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;

		if (vertical && Math.abs(deltaY) >= Math.abs(deltaX)) {
			const room = deltaY > 0 ? element.scrollHeight - element.clientHeight - element.scrollTop : element.scrollTop;
			if (room > 1) return true;
		}
		if (horizontal && Math.abs(deltaX) > Math.abs(deltaY)) {
			const room = deltaX > 0 ? element.scrollWidth - element.clientWidth - element.scrollLeft : element.scrollLeft;
			if (room > 1) return true;
		}
		return false;
	};

	/** The nearest box under the pointer that can still take this scroll, if any. */
	const scrollableUnder = (target, deltaX, deltaY) => {
		let node = target instanceof Element ? target : null;
		while (node) {
			if (canScroll(node, deltaX, deltaY)) return node;
			node = node.parentElement;
		}
		// The page itself, when it is the thing with the overflow.
		const root = document.scrollingElement ?? document.documentElement;
		return root && canScroll(root, deltaX, deltaY) ? root : undefined;
	};

	/*
	 * `touch-action: none`, on every element rather than the root.
	 *
	 * The board does this to itself for the same reason (`frame-gestures.ts`): the
	 * browser will claim a finger that lands inside a scroller, scroll it natively and
	 * send a `pointercancel` three events in, leaving half the gesture native and half
	 * ours. Marked `data-decks-ui` like the app's other furniture in somebody else's DOM,
	 * and only ever added when this page is embedded — opened on its own it scrolls the
	 * way any page does.
	 */
	const touchStyle = document.createElement("style");
	touchStyle.dataset.decksUi = "true";
	touchStyle.textContent = "* { touch-action: none; }";
	const wearIt = () => (document.head ?? document.documentElement).appendChild(touchStyle);
	if (document.head) wearIt();
	else window.addEventListener("DOMContentLoaded", wearIt);

	/** Fingers down in here, with where each one landed — the moves cannot be asked. */
	const fingers = new Map();
	/** What this gesture turned out to be, decided on its first real movement. */
	let mode = "undecided";
	let scrolling;

	const onMove = (event) => {
		if (event.pointerType !== "touch") return;
		const was = fingers.get(event.pointerId);
		if (!was) return;
		const dx = event.clientX - was.x;
		const dy = event.clientY - was.y;
		was.x = event.clientX;
		was.y = event.clientY;

		if (fingers.size > 1) {
			// Two fingers are always the canvas, whatever one finger had started.
			mode = "camera";
			scrolling = undefined;
		} else if (mode === "undecided" && (Math.abs(dx) >= 2 || Math.abs(dy) >= 2)) {
			// A wheel's deltas point the way the content moves; a finger travels the other
			// way, so the question asked of the box is the same one, negated.
			const box = scrollableUnder(was.on, -dx, -dy);
			mode = box ? "scroll" : "camera";
			scrolling = box;
		}

		if (mode === "scroll" && scrolling) {
			scrolling.scrollLeft -= dx;
			scrolling.scrollTop -= dy;
			return;
		}
		post({ t: "decks:touch", phase: "move", id: event.pointerId, x: event.clientX, y: event.clientY });
	};

	const onUp = (event) => {
		if (event.pointerType !== "touch") return;
		if (!fingers.delete(event.pointerId)) return;
		post({ t: "decks:touch", phase: "up", id: event.pointerId, x: event.clientX, y: event.clientY });
		if (fingers.size > 0) return;
		mode = "undecided";
		scrolling = undefined;
		document.removeEventListener("pointermove", onMove, true);
		document.removeEventListener("pointerup", onUp, true);
		document.removeEventListener("pointercancel", onUp, true);
	};

	document.addEventListener("pointerdown", (event) => {
		if (event.pointerType !== "touch") return;
		if (fingers.size === 0) {
			mode = "undecided";
			scrolling = undefined;
			document.addEventListener("pointermove", onMove, true);
			document.addEventListener("pointerup", onUp, true);
			document.addEventListener("pointercancel", onUp, true);
		}
		fingers.set(event.pointerId, { x: event.clientX, y: event.clientY, on: event.target });
		post({ t: "decks:touch", phase: "down", id: event.pointerId, x: event.clientX, y: event.clientY });
		try {
			// So a finger that slides out of this page keeps driving the gesture.
			document.documentElement.setPointerCapture(event.pointerId);
		} catch {
			/* capture is a nicety; the document listeners carry the gesture regardless */
		}
	});

	window.addEventListener(
		"wheel",
		(event) => {
			// A pinch is always the canvas zooming; nothing inside an embed zooms.
			const zooming = event.ctrlKey || event.metaKey;
			if (!zooming && scrollableUnder(event.target, event.deltaX, event.deltaY)) return;

			event.preventDefault();
			post({
				t: "decks:wheel",
				dx: event.deltaX,
				dy: event.deltaY,
				x: event.clientX,
				y: event.clientY,
				zooming,
			});
		},
		{ passive: false },
	);
})();
