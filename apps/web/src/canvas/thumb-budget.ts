import { createSignal, onCleanup } from "solid-js";

/**
 * How many board documents may be *starting* at once.
 *
 * A thumbnail is the board itself, scaled down (DESIGN §6.6) — there is no thumbnail service,
 * so a thumbnail is never stale and never a job that has to finish before you can see your
 * deck. The cost is a document per thumbnail, and two things bound it. Which ones are live is
 * the intersection observer's answer and always was; **how many begin at once is this**.
 *
 * They are different problems and only one of them was solved. On a deck of 24, opening the
 * all-canvases modal used to mount every board at once — `rootMargin: 300px` says yes to
 * everything in a grid that fits 24 boards inside 400px — for 53 documents and 24 live
 * frames. A tighter margin fixed the count. What it could not fix is the stampede: a dozen
 * documents parsing `board.css`, `board.js`, KaTeX and Mermaid in the same frame is a dozen
 * times the work with none of it visible any sooner, and the row you are actually looking at
 * finishes last.
 *
 * So visibility still decides *who* is live, in request order, and this decides *when*: two
 * at a time, the next starting as one finishes. The grid fills top-first and the first row is
 * readable while the rest arrive.
 *
 * Deliberately not a cap on how many stay live. That was the first version and it was worse
 * than the problem: an eight-slot LRU keyed on when each thumbnail was last wanted granted a
 * scattered set — `[0,1,5,6,8,13,15,23]` — and then held it, because nothing new became
 * wanted to displace it. The observer already answers "is this on screen", which is the
 * bound that is actually true, and O(1) in the size of the deck for the same reason a
 * scroller is.
 */

/** Documents allowed to be starting at once. */
const LOADING = 2;

interface Holder {
	/** When this thumbnail asked, so the queue is first-come — which in a fresh grid is top-first. */
	askedAt: number;
	live: boolean;
	loaded: boolean;
	notify: (live: boolean) => void;
}

const holders = new Map<symbol, Holder>();
let clock = 0;

/** Start whoever is next, if the queue has room. Cheap: bounded by how many are mounted. */
function settle(): void {
	const starting = [...holders.values()].filter((holder) => holder.live && !holder.loaded).length;
	let budget = Math.max(0, LOADING - starting);
	if (budget <= 0) return;

	const waiting = [...holders.values()]
		.filter((holder) => holder.askedAt > 0 && !holder.live)
		.sort((a, b) => a.askedAt - b.askedAt);
	for (const holder of waiting) {
		if (budget <= 0) return;
		budget -= 1;
		holder.live = true;
		holder.notify(true);
	}
}

/**
 * One thumbnail's place in the queue.
 *
 * `live()` is what the component renders on. `want(true)` when the item comes near the
 * viewport, `loaded()` when its document has finished — without that second signal the queue
 * would never open again.
 */
export function claimThumb(): { live: () => boolean; want: (wanted: boolean) => void; loaded: () => void } {
	const key = Symbol("thumb");
	const [live, setLive] = createSignal(false);
	holders.set(key, { askedAt: 0, live: false, loaded: false, notify: setLive });

	onCleanup(() => {
		holders.delete(key);
		// A thumbnail unmounted mid-load was holding a place in the queue.
		settle();
	});

	return {
		live,
		want: (wanted) => {
			const holder = holders.get(key);
			if (!holder) return;
			if (wanted) {
				// Asking again while already in the queue must not move it, or a stationary
				// list would reshuffle itself on every intersection callback.
				if (holder.askedAt === 0) holder.askedAt = clock += 1;
			} else {
				holder.askedAt = 0;
				if (holder.live) {
					holder.live = false;
					holder.loaded = false;
					holder.notify(false);
				}
			}
			settle();
		},
		loaded: () => {
			const holder = holders.get(key);
			if (!holder || holder.loaded) return;
			holder.loaded = true;
			// A finished load is what frees the queue for whoever is behind it.
			settle();
		},
	};
}

/** For the check that asserts the queue holds. */
export const THUMB_LOADING = LOADING;
