import { cssEscape } from "@decks/ui";
import type { ChatItem } from "@decks/protocol";
import { createEffect, createMemo, createSignal, onCleanup, onMount, untrack, type Accessor } from "solid-js";
import { hasEarlier, LOAD_MORE_AT, WINDOW, windowStart } from "./model.ts";

// How the conversation's column behaves: it follows its foot, draws the last rows and reaches back,
// and answers the wheel, Escape and a jump to a turn.

/** The column's elements, read once mounted. */
export interface Column {
	column: () => HTMLElement | undefined;
	scroller: () => HTMLDivElement | undefined;
	shown: Accessor<boolean>;
}

// Following the foot, and holding the reader's row still away from it.
/** Following the foot while the reader is there, and holding their row still away from it. */
export function createFollow(col: Column) {
	let atFoot = true;
	let anchor: { el: Element; top: number } | undefined;
	const readAnchor = () => {
		const scroller = col.scroller()!;
		const box = scroller.getBoundingClientRect();
		for (const el of scroller.querySelectorAll("[data-item]")) {
			const row = el.getBoundingClientRect();
			if (row.bottom > box.top) return { el, top: row.top - box.top };
		}
		return undefined;
	};
	const toFootNow = () => {
		const scroller = col.scroller();
		if (!scroller) return;
		scroller.scrollTop = scroller.scrollHeight;
		atFoot = true;
		anchor = undefined;
	};
	/** After the column changed: back to the foot if the reader was there, else their row back where it was. */
	const settle = () => {
		const scroller = col.scroller();
		if (!scroller || !untrack(col.shown)) return;
		if (atFoot) return toFootNow();
		// Drawn again (its card named by another row), it is found by its id.
		if (anchor && !anchor.el.isConnected) {
			const again = scroller.querySelector(`[data-item="${cssEscape(anchor.el.getAttribute("data-item") ?? "")}"]`);
			anchor = again ? { el: again, top: anchor.top } : undefined;
		}
		if (!anchor) return void (anchor = readAnchor());
		const moved = anchor.el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.top;
		if (Math.abs(moved) >= 0.5) scroller.scrollTop += moved;
	};
	/** Change the rows with the reader's row held where it is. */
	const hold = (change: () => void) => {
		if (!atFoot) anchor = readAnchor();
		change();
		settle();
	};
	const scrolled = () => {
		const scroller = col.scroller()!;
		atFoot = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 2;
		anchor = atFoot ? undefined : readAnchor();
	};
	return { toFootNow, settle, hold, scrolled };
}

/** Each scroll and each row's change of size settles the column. */
export function watchRows(scroller: HTMLDivElement, follow: ReturnType<typeof createFollow>): void {
	scroller.addEventListener("scroll", follow.scrolled, { passive: true });
	onCleanup(() => scroller.removeEventListener("scroll", follow.scrolled));
	if (typeof ResizeObserver === "undefined") return;
	const sized = new ResizeObserver(() => follow.settle());
	sized.observe(scroller);
	const watch = () => {
		for (const row of scroller.children) sized.observe(row);
	};
	watch();
	// Rows come and go: each is watched from when it is put in.
	const rows = new MutationObserver(watch);
	rows.observe(scroller, { childList: true });
	onCleanup(() => {
		rows.disconnect();
		sized.disconnect();
	});
}

/** Glide to the foot, and follow from exactly there once the glide ends. */
export function glideToFoot(scroller: HTMLDivElement | undefined, pinned: Accessor<boolean>, toFootNow: () => void): void {
	if (!scroller) return;
	if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return toFootNow();
	scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
	const land = () => {
		clearTimeout(timer);
		scroller.removeEventListener("scrollend", land);
		if (pinned()) toFootNow();
	};
	const timer = setTimeout(land, 900);
	scroller.addEventListener("scrollend", land);
}

// The drawn span of the conversation.
/** The props the drawn span of the conversation reads. */
interface WindowInputs {
	items: () => ChatItem[];
	more: () => boolean;
	agentId: () => string;
	onEarlier: () => Promise<number>;
}

/** How much of the conversation is drawn: the last 60 rows, and more as the reader reaches back. */
export function createWindow(inputs: WindowInputs, follow: ReturnType<typeof createFollow>, rearmTop: () => void) {
	const [from, setFrom] = createSignal<string | undefined>();
	const start = createMemo(() => windowStart(inputs.items(), from(), WINDOW));
	createEffect(() => {
		const id = inputs.items()[start()]?.id;
		if (id !== untrack(from)) setFrom(id);
	});
	const shown = createMemo(() => (start() === 0 ? inputs.items() : inputs.items().slice(start())) as ChatItem[]);
	const earlier = () => hasEarlier({ total: inputs.items().length, hidden: start(), more: inputs.more() });
	let fetching = false;
	/** Show more, keeping what the reader is looking at where it is; past what is held, ask once. */
	const showEarlier = () => {
		if (start() > 0) {
			follow.hold(() => setFrom(inputs.items()[Math.max(0, start() - WINDOW)]?.id));
			return rearmTop();
		}
		if (fetching || !inputs.more()) return;
		fetching = true;
		void inputs
			.onEarlier()
			.then((added) => {
				if (added === 0) return;
				// The page went in front of the drawn span: take it in, holding the reader's row.
				follow.hold(() => setFrom(inputs.items()[0]?.id));
				rearmTop();
			})
			.finally(() => (fetching = false));
	};
	return { start, setFrom, shown, earlier, showEarlier };
}

/** Sending from the foot drops the pages scrolled back to; another agent opens at its newest turn. */
export function resetWindow(inputs: WindowInputs, win: ReturnType<typeof createWindow>, pinned: Accessor<boolean>, toFoot: () => void): void {
	createEffect((previous: string | undefined) => {
		const latest = [...inputs.items()].reverse().find((item) => item.kind === "user")?.id;
		if (previous !== undefined && latest && latest !== previous && pinned() && untrack(win.start) < inputs.items().length - WINDOW) win.setFrom(undefined);
		return latest;
	});
	createEffect((previous: string | undefined) => {
		if (previous !== undefined && inputs.agentId() !== previous) {
			win.setFrom(undefined);
			toFoot();
		}
		return inputs.agentId();
	});
}

/** The two ends: the foot says whether the reader follows it, the top reaches back when near. */
export function watchEnds(col: Column, ends: { top: () => HTMLElement; foot: () => HTMLElement }, setPinned: (on: boolean) => void, reachBack: () => void) {
	let footWatch: IntersectionObserver | undefined;
	let topWatch: IntersectionObserver | undefined;
	onMount(() => {
		if (typeof IntersectionObserver === "undefined") return;
		footWatch = new IntersectionObserver(([seen]) => seen && setPinned(seen.isIntersecting), { root: col.scroller(), rootMargin: "0px 0px 48px 0px", threshold: 0 });
		footWatch.observe(ends.foot());
		topWatch = new IntersectionObserver(([seen]) => seen?.isIntersecting && reachBack(), { root: col.scroller(), rootMargin: `${LOAD_MORE_AT}px 0px 0px 0px`, threshold: 0 });
		topWatch.observe(ends.top());
	});
	onCleanup(() => {
		footWatch?.disconnect();
		topWatch?.disconnect();
	});
	// Observed again, the top reports where it is now, even when it has not moved in or out.
	return () =>
		requestAnimationFrame(() => {
			topWatch?.unobserve(ends.top());
			topWatch?.observe(ends.top());
		});
}

// The wheel, Escape and a jump to a turn.
/** The wheel scrolls the column from anywhere over it, while there is room; a pinch never does. */
export function wheelOverColumn(col: Column): void {
	const wheel = (event: WheelEvent) => {
		const column = col.column();
		const scroller = col.scroller();
		if (event.ctrlKey || !col.shown() || !column || !scroller) return;
		const box = column.getBoundingClientRect();
		if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) return;
		// At either end the canvas should still zoom.
		const room = scroller.scrollHeight - scroller.clientHeight;
		const at = scroller.scrollTop;
		if (room <= 0 || (event.deltaY < 0 && at <= 0) || (event.deltaY > 0 && at >= room - 1)) return;
		// Over the scroller the browser scrolls it with its own momentum; the event is only kept from the canvas.
		event.stopPropagation();
		if (event.target instanceof Node && scroller.contains(event.target)) return;
		event.preventDefault();
		scroller.scrollTop = at + event.deltaY;
	};
	onMount(() => {
		window.addEventListener("wheel", wheel, { capture: true, passive: false });
		onCleanup(() => window.removeEventListener("wheel", wheel, { capture: true }));
	});
}

/** Escape puts the column away, wherever the focus is, unless a menu over it takes the key first. */
export function escapeCloses(shown: Accessor<boolean>, close: () => void): void {
	const keys = (event: KeyboardEvent) => {
		if (event.key !== "Escape" || event.defaultPrevented || !shown()) return;
		if (document.querySelector(".popover")) return;
		event.preventDefault();
		close();
	};
	onMount(() => {
		window.addEventListener("keydown", keys);
		onCleanup(() => window.removeEventListener("keydown", keys));
	});
}

/** Bring a turn into view, opening the drawn span far enough to hold it first. */
export function followScrollTo(col: Column, target: () => { id: string; at: number } | undefined, items: () => ChatItem[], win: ReturnType<typeof createWindow>, setPinned: (on: boolean) => void): void {
	let travelled: string | undefined;
	createEffect(() => {
		const goal = target();
		const scroller = col.scroller();
		if (!goal || !col.shown() || !scroller) return;
		const key = `${goal.id}:${goal.at}`;
		if (travelled === key) return;
		const at = items().findIndex((item) => item.id === goal.id);
		if (at !== -1 && at < untrack(win.start)) win.setFrom(items()[Math.max(0, at - WINDOW)]?.id);
		requestAnimationFrame(() => {
			const element = scroller.querySelector(`[data-item="${cssEscape(goal.id)}"]`);
			// Not marked as travelled until found: the turn may not have arrived yet.
			if (!element) return;
			travelled = key;
			setPinned(false);
			// Instant: a smooth scroll from the foot would re-pin and be pulled straight back down.
			element.scrollIntoView({ block: "start", behavior: "auto" });
		});
	});
}
