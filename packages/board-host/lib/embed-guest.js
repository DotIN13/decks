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
	// Once a page: the server puts this in a board that is the page, and the page may load it as well.
	if (window.decksGuest) return;
	window.decksGuest = true;

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
		// The page's own scroll: the viewport scrolls unless the root says hidden, and its computed overflow is `visible`.
		const root = element === (document.scrollingElement ?? document.documentElement);
		const scrolls = (overflow) => /auto|scroll/.test(overflow) || (root && overflow !== "hidden" && overflow !== "clip");
		const vertical = scrolls(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
		const horizontal = scrolls(style.overflowX) && element.scrollWidth > element.clientWidth + 1;

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

	/*
	 * A board that is this page (`data-bare`) holds it whole: the frame is made as tall and as wide as
	 * the page, and the board's own box scrolls it, as it scrolls a PDF's pages. So the page itself
	 * never scrolls, and only the boxes inside it are this file's to scroll.
	 */
	let hosted = false;
	const lastSize = { w: 0, h: 0 };
	const sendSize = () => {
		const root = document.documentElement;
		const w = Math.ceil(Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0));
		const h = Math.ceil(Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0));
		if (w === lastSize.w && h === lastSize.h) return;
		lastSize.w = w;
		lastSize.h = h;
		post({ t: "decks:size", w, h });
	};
	window.addEventListener("message", (event) => {
		if (event.source !== window.parent || event.data?.t !== "decks:hosted" || hosted) return;
		hosted = true;
		const style = document.createElement("style");
		style.dataset.decksUi = "true";
		style.textContent = "html, body { overflow: hidden !important; }";
		(document.head ?? document.documentElement).appendChild(style);
		const watch = new ResizeObserver(sendSize);
		watch.observe(document.documentElement);
		if (document.body) watch.observe(document.body);
		new MutationObserver(sendSize).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
		window.addEventListener("load", sendSize);
		sendSize();
	});

	/** The nearest box under the pointer that can still take this scroll, if any. */
	const scrollableUnder = (target, deltaX, deltaY) => {
		const root = document.scrollingElement ?? document.documentElement;
		let node = target instanceof Element ? target : null;
		while (node) {
			if (hosted && (node === root || node === document.body)) return undefined;
			if (canScroll(node, deltaX, deltaY)) return node;
			node = node.parentElement;
		}
		// The page itself, when it is the thing with the overflow.
		return !hosted && root && canScroll(root, deltaX, deltaY) ? root : undefined;
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

	/**
	 * Give the canvas back every finger this page is holding.
	 *
	 * A finger reported from here is counted by the board and by the stage above it, and
	 * this page cannot promise to report the end of one: it is reloaded when the board
	 * that frames it is, and the `pointerup` then goes to a document that no longer
	 * exists. One finger the canvas believes in and the hand does not is enough to make
	 * every later touch read as a pinch, so the ends are sent whenever this page is
	 * about to stop being able to send them.
	 */
	const release = () => {
		for (const [id, was] of [...fingers]) {
			fingers.delete(id);
			post({ t: "decks:touch", phase: "up", id, x: was.x, y: was.y });
		}
		mode = "undecided";
		scrolling = undefined;
	};
	window.addEventListener("pagehide", release);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") release();
	});

	document.addEventListener("pointerdown", (event) => {
		if (event.pointerType !== "touch") return;
		// The first finger of a sequence: anything still held was never released, and
		// saying so now recovers on the next touch instead of not at all.
		if (event.isPrimary && fingers.size > 0) release();
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

	/*
	 * A scroll this page can take is still scrolled by the board's rule (`frame-gestures.ts`): by hand,
	 * the wheel's screen pixels turned into this page's at the canvas's zoom, so what is under the
	 * fingers follows them. Only the board knows the zoom, so the box is asked for by number and the
	 * board answers with the distance.
	 */
	const asks = new Map();
	let asked = 0;
	window.addEventListener("message", (event) => {
		if (event.source !== window.parent) return;
		const message = event.data;
		if (!message || message.t !== "decks:scroll") return;
		const box = asks.get(message.id);
		asks.delete(message.id);
		if (!box) return;
		box.scrollLeft += Number(message.dx) || 0;
		box.scrollTop += Number(message.dy) || 0;
	});

	/*
	 * A middle-drag, or a drag with Space held, pans the canvas wherever it starts, as over a board.
	 * The pointer is handed up as it moves; the board replays it to `frame-gestures.ts`.
	 */
	let space = false;
	const typing = (target) => target instanceof Element && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
	document.addEventListener(
		"keydown",
		(event) => {
			if (event.code !== "Space" || typing(event.target)) return;
			event.preventDefault();
			if (space) return;
			space = true;
			post({ t: "decks:space", held: true });
		},
		true,
	);
	const spaceUp = () => {
		if (!space) return;
		space = false;
		post({ t: "decks:space", held: false });
	};
	document.addEventListener("keyup", (event) => event.code === "Space" && spaceUp(), true);
	window.addEventListener("blur", spaceUp);
	document.addEventListener(
		"pointerdown",
		(event) => {
			if (event.pointerType === "touch") return;
			if (!(event.button === 1 || (event.button === 0 && space))) return;
			event.preventDefault();
			event.stopPropagation();
			// Screen positions: the canvas moves this page under a still mouse, so its own pixels would fight the pan.
			const at = (e) => ({ sx: e.screenX, sy: e.screenY });
			document.documentElement.style.cursor = "grabbing";
			post({ t: "decks:pointer", phase: "down", button: event.button, ...at(event) });
			try {
				document.documentElement.setPointerCapture(event.pointerId);
			} catch {
				/* the document listeners carry the drag regardless */
			}
			// The button this drag is held by, as `buttons` says it: a move without it is a release that never arrived.
			const held = event.button === 1 ? 4 : 1;
			let done = false;
			const up = (e) => {
				if (done) return;
				done = true;
				post({ t: "decks:pointer", phase: "up", button: event.button, ...at(e ?? event) });
				document.documentElement.style.removeProperty("cursor");
				document.removeEventListener("pointermove", move, true);
				document.removeEventListener("pointerup", up, true);
				document.removeEventListener("pointercancel", up, true);
				window.removeEventListener("blur", lost);
				window.removeEventListener("pagehide", lost);
			};
			const lost = () => up(undefined);
			const move = (e) => ((e.buttons & held) === 0 ? up(e) : post({ t: "decks:pointer", phase: "move", button: event.button, ...at(e) }));
			document.addEventListener("pointermove", move, true);
			document.addEventListener("pointerup", up, true);
			document.addEventListener("pointercancel", up, true);
			window.addEventListener("blur", lost);
			window.addEventListener("pagehide", lost);
		},
		true,
	);
	// No autoscroll and no paste from a middle press: it is the canvas's.
	document.addEventListener("auxclick", (event) => event.button === 1 && event.preventDefault(), true);

	window.addEventListener(
		"wheel",
		(event) => {
			// A pinch is always the canvas zooming; nothing inside an embed zooms.
			const zooming = event.ctrlKey || event.metaKey;
			const box = zooming ? undefined : scrollableUnder(event.target, event.deltaX, event.deltaY);
			event.preventDefault();
			if (box) {
				asks.set(++asked, box);
				post({ t: "decks:scroll-ask", id: asked, dx: event.deltaX, dy: event.deltaY });
				return;
			}
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
