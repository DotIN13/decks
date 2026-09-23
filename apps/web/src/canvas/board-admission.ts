import type { Board } from "@decks/protocol";
import { createSignal, onCleanup } from "solid-js";

/**
 * Which boards have a document, and when one is taken away again.
 *
 * Two questions that look like one and are not. **Visibility** decides which boards *get*
 * a document, and lives in `Stage` because the render body asks it too. This file owns the
 * other two: how long a board that has left the screen keeps what it had, and the gate that
 * holds every board back until the app has finished opening.
 *
 * Split out of `Stage.tsx`, which was doing four jobs. Nothing here touches the camera —
 * it only needs to know *when the camera last moved*, which arrives as a getter.
 */

/**
 * How long a board that has left the screen keeps its document.
 *
 * Visibility decides which boards *get* a document; this decides when one is taken
 * away, and the two are deliberately not the same moment. Zooming in on a phone puts
 * every other board outside the margin within a few steps, and zooming back out brings
 * them all back — so a document was torn down in the middle of one gesture and parsed
 * again in the middle of the next: `board.css`, `board.js`, KaTeX, Mermaid, for every
 * board, while the finger was still moving. Measured on 17 boards at 4× CPU throttle,
 * a wheel zoom in and out spent 37ms per step in `Document::shutdown` alone and more
 * again re-parsing, against 8ms of everything else.
 *
 * So a board that leaves the screen is kept until it has been gone for a few seconds
 * **and the camera has been still for one** — a document is never let go in the middle
 * of a gesture, however long the gesture. A board zoomed away from and back to costs
 * nothing the second time; a board really left behind is let go once the canvas is
 * quiet, from an idle callback rather than from inside whatever the user is doing
 * then. The memory cost is bounded by how many boards one gesture can pass over.
 */
const KEEP_MS = 3000;
/**
 * How many documents a stage keeps without letting any go.
 *
 * Letting go is for the deck of forty; a stage of three boards lost a board's document three
 * seconds after it left the screen, so panning back to it was a white box that then filled in,
 * every time. Up to this many, a document once loaded stays until the board leaves the canvas.
 */
const KEEP_ALL = 8;
/** How long the camera has to have been still before a document is taken away. */
const QUIET_MS = 1000;

const whenIdle = (fn: () => void, timeout: number) => {
	const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
	if (idle) idle(fn, { timeout });
	else window.setTimeout(fn, 60);
};

export interface AdmissionHost {
	/** The boards on the canvas. */
	boards: () => Board[];
	/** Whether a board is on screen, or within a viewport of it — `Stage` owns this. */
	isVisible: (board: Board) => boolean;
	/** How large the stage is; zero before the first measurement. */
	view: () => { width: number; height: number };
	/**
	 * Whether the camera is moving right now — a pan, a pinch or a glide.
	 *
	 * A reactive read, unlike `lastMoved`: a board held back during a movement has to be let
	 * in when it ends, and this is what re-runs the question.
	 */
	moving: () => boolean;
	/**
	 * When the camera last moved, as `performance.now()`.
	 *
	 * A getter rather than a value, because the gestures write it synchronously in their own
	 * handler and this file reads it from a timer — passing the number would freeze it at
	 * whichever moment the two happened to be wired together.
	 */
	lastMoved: () => number;
	/** Where a board's centre is on screen, for letting the nearest one in first. */
	screenCentre: (board: Board) => { x: number; y: number };
	/** Whether the app has opened far enough for any board to start. */
	mayStart: () => boolean;
	/** Every board on screen at the open has been let in. */
	onStarted?: () => void;
}

export interface Admission {
	/** Whether a board has a document: on screen now, or was within the last `KEEP_MS`. */
	isMounted: (board: Board) => boolean;
	/** Whether the open still holds this board back. */
	mayHaveDocument: (board: Board) => boolean;
	/** Called from an effect: start letting boards in once the app has opened. */
	begin: () => void;
}

export function createAdmission(host: AdmissionHost): Admission {
	const lastSeen = new Map<string, number>();
	/** Boards with a document **right now**, so a movement never takes one away or starts one. */
	const live = new Set<string>();
	const [sweep, setSweep] = createSignal(0);
	let sweeper: ReturnType<typeof setTimeout> | undefined;

	const sweepLater = (after: number) => {
		if (sweeper !== undefined) return;
		sweeper = setTimeout(() => {
			sweeper = undefined;
			const still = performance.now() - host.lastMoved();
			// Not yet: the camera is moving. Ask again once it has had time to stop.
			if (still < QUIET_MS) return sweepLater(QUIET_MS - still + 50);
			whenIdle(() => setSweep((n) => n + 1), 1000);
		}, after);
	};
	onCleanup(() => clearTimeout(sweeper));

	const isMounted = (board: Board): boolean => {
		void sweep();
		const now = performance.now();
		if (host.isVisible(board)) {
			lastSeen.set(board.path, now);
			/*
			 * **A document is never *started* in the middle of a movement**, which is the other
			 * half of the rule above it: one is never let go in the middle of one either.
			 *
			 * A camera fly sweeps the visible margin across the deck, and every board it passes
			 * used to begin parsing right then — `board.css`, `board.js`, the markdown, the
			 * maths — on the same main thread the flight is drawn on. Measured on a 420ms fly
			 * over 16 boards: nine documents started mid-flight, and the frames they landed in
			 * were 78, 80, 66, 41 and 37ms long, so the move was drawn eleven times instead of
			 * twenty-five. Held back, they start when the camera stops, which is 160ms after it
			 * does and is the moment a person starts reading rather than moving.
			 *
			 * `live` is what it has *now*, not what it has ever had: a board on screen keeps its
			 * document through the movement, and one whose document was let go while it was away
			 * is a new start again, because reloading it costs exactly what the first load did.
			 */
			if (!live.has(board.path) && host.moving()) return false;
			live.add(board.path);
			return true;
		}
		const seen = lastSeen.get(board.path);
		if (seen === undefined) return false;
		/*
		 * Kept means *kept*: only a board that still has its document. The grace below used to
		 * answer for any board ever seen, so the first step of a pan gave an already-let-go board a
		 * new document off screen; when the pan brought it into view, the rule above took that
		 * document away again (on screen, not live, moving); and the pan's end started a third.
		 * Two loads and two white flashes for one pan.
		 */
		if (!live.has(board.path)) return false;
		// Counting only boards still on the canvas: one taken off it has no frame to keep.
		const onCanvas = new Set(host.boards().map((one) => one.path));
		for (const path of live) if (!onCanvas.has(path)) live.delete(path);
		if (live.size <= KEEP_ALL) return true;
		const gone = now - seen;
		const still = now - host.lastMoved();
		/*
		 * Both conditions, here as well as in the timer: this runs on every camera change,
		 * and a board whose grace ran out mid-gesture must not be dropped by the very step
		 * that asked. Come back once both have passed, so the document is let go then.
		 */
		if (gone < KEEP_MS || still < QUIET_MS) {
			sweepLater(Math.max(KEEP_MS - gone, QUIET_MS - still) + 50);
			return true;
		}
		live.delete(board.path);
		return false;
	};

	/*
	 * **Boards start after the app has opened, nearest first, one at a time.**
	 *
	 * A board is a same-origin document, so it runs on the app's own main thread: its
	 * stylesheet, `board.js`, markdown, maths and diagrams are parsed and laid out between the
	 * app's own frames. Opening onto six boards mounted all six in the same second the app was
	 * drawing its chat, and the page did not answer for 846 ms of it — a keystroke typed then
	 * would have waited that long.
	 *
	 * So until the app says it has opened (`mayStart`) no board has a document: the canvas
	 * shows each one's frame and title, which is where the eye goes first anyway. Then they are
	 * let in one at a time, nearest the middle of the screen first, each after the browser has
	 * had an idle moment since the last — that is, once the previous document has done its work.
	 * When every board on screen is in, the gate is gone for the rest of the session and a board
	 * mounts the moment it is visible, as it always did.
	 */
	const [admitted, setAdmitted] = createSignal<ReadonlySet<string>>(new Set());
	const [admitting, setAdmitting] = createSignal(true);
	let admitScheduled = false;
	let stopped = false;
	onCleanup(() => {
		stopped = true;
	});

	const admitNext = () => {
		admitScheduled = false;
		if (stopped || !admitting()) return;
		const v = host.view();
		// Not measured yet: nothing is on screen until it is, and "nothing to let in" is not "done".
		if (v.width === 0) {
			admitScheduled = true;
			window.setTimeout(admitNext, 100);
			return;
		}
		const waiting = host.boards().filter((board) => host.isVisible(board) && !admitted().has(board.path));
		if (waiting.length === 0) {
			setAdmitting(false);
			host.onStarted?.();
			return;
		}
		const middle = { x: v.width / 2, y: v.height / 2 };
		const distance = (board: Board) => {
			const at = host.screenCentre(board);
			return Math.hypot(at.x - middle.x, at.y - middle.y);
		};
		const next = waiting.reduce((best, board) => (distance(board) < distance(best) ? board : best));
		setAdmitted((was) => new Set(was).add(next.path));
		// A frame for it to begin, then an idle moment for it to finish, then the next one.
		admitScheduled = true;
		requestAnimationFrame(() => whenIdle(admitNext, 300));
	};

	return {
		isMounted,
		mayHaveDocument: (board) => !admitting() || admitted().has(board.path),
		begin: () => {
			if (!host.mayStart() || !admitting() || admitScheduled) return;
			admitScheduled = true;
			whenIdle(admitNext, 300);
		},
	};
}
