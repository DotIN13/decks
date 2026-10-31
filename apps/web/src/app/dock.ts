import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { insets, insetsMoving } from "@decks/canvas/camera";
import { dialog } from "../state/deck.ts";
import { draft } from "../state/ui.ts";
import type { Floats } from "./floats.ts";

/** How much of a put-away composer still shows: the tab that brings it back. */
const STOW_TAB = 36;

/** What the dock needs of the layout, read when the page has mounted. */
export interface DockLayout {
	phone: () => boolean;
	phoneChat: () => boolean;
	setPhoneChat: (open: boolean, from?: DOMRect) => void;
	viewWidth: () => number;
}

/**
 * The dock: the composer's float, its phone grip, and what it publishes about itself
 * (how far up it reaches, `--dock-h`, and the top bars' fit beside it).
 */
export function createDock(layout: DockLayout, { workBox, mountFloat }: Floats) {
	let dockEl: HTMLDivElement | undefined;
	/** How far up from the bottom the dock reaches: the canvas frame puts a phone's tool row above it. */
	const [dockCover, setDockCover] = createSignal(0);
	/** Measured from the dock itself, whenever it is drawn: it comes and goes with the conversation. */
	const watchDock = (el: HTMLDivElement) => {
		dockEl = el;
		const measure = () => setDockCover(el.isConnected ? Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top)) : 0);
		const watch = new ResizeObserver(measure);
		watch.observe(el);
		addEventListener("resize", measure);
		queueMicrotask(measure);
		onCleanup(() => {
			watch.disconnect();
			removeEventListener("resize", measure);
			setDockCover(0);
		});
	};
	let unstowComposer = () => {};
	onMount(() => {
		const { phone, phoneChat, setPhoneChat, viewWidth } = layout;
		const dock = dockEl;
		const handle = dock?.querySelector<HTMLElement>(".composer-box");
		if (!dock || !handle) return;
		const keepsOwn = "[data-slot='composer-input'], textarea, input, button, select, a, [role='menu'], [role='listbox'], .send-button";
		// On a phone the composer stays at the foot: its grip opens the conversation instead (below).
		const float = mountFloat(dock, "composer", handle, keepsOwn, () => {
			const box = workBox();
			return { x: box.x + box.w / 2 - dock.offsetWidth / 2, y: box.h - dock.offsetHeight - 12 };
		}, "bottom", { tab: STOW_TAB }, () => phone());
		createEffect(() => {
			phone();
			float.restore();
		});
		/*
		 * On a phone the grip is the conversation's: a tap on it, or a drag up from it, opens the history
		 * out of the composer (the tools give way while it is open); a tap or a drag down closes it again.
		 * The grip is the bar's top band and the little bar in it, not the words or the buttons.
		 */
		const SWIPE = 24;
		handle.addEventListener("pointerdown", (event) => {
			if (!phone() || event.button !== 0 || (event.target instanceof Element && event.target.closest(keepsOwn))) return;
			const start = { x: event.clientX, y: event.clientY, id: event.pointerId };
			let done = false;
			const finish = () => {
				done = true;
				window.removeEventListener("pointermove", move, true);
				window.removeEventListener("pointerup", up, true);
				window.removeEventListener("pointercancel", cancel, true);
			};
			const move = (next: PointerEvent) => {
				if (done || next.pointerId !== start.id) return;
				const dy = next.clientY - start.y;
				if (!phoneChat() && dy < -SWIPE) {
					finish();
					setPhoneChat(true, dock.getBoundingClientRect());
				} else if (phoneChat() && dy > SWIPE) {
					finish();
					setPhoneChat(false);
				}
			};
			const up = (next: PointerEvent) => {
				if (done || next.pointerId !== start.id) return;
				finish();
				if (Math.hypot(next.clientX - start.x, next.clientY - start.y) > 8) return;
				if (phoneChat()) setPhoneChat(false);
				else setPhoneChat(true, dock.getBoundingClientRect());
			};
			const cancel = (next: PointerEvent) => next.pointerId === start.id && finish();
			window.addEventListener("pointermove", move, true);
			window.addEventListener("pointerup", up, true);
			window.addEventListener("pointercancel", cancel, true);
		});
		unstowComposer = () => float.unstow();
		/*
		 * Two things bring it back on their own, because both are the app asking for the
		 * person's attention *in the bar*: a question that needs an answer, and a line put
		 * into the box for them (a comment on a component, a dropped file).
		 */
		createEffect(() => {
			if ((dialog() || draft()) && float.stowed()) float.unstow();
		});
		/* The bounds are the canvas column, which is measured after mount and moves when the
		   sidebar folds. A float restored against the wrong column sits 264px to the left. */
		createEffect(() => {
			insets();
			// While the side panel is dragged a float follows it step by step, cheaply; it is put back properly once the drag ends.
			if (insetsMoving()) return float.follow();
			float.restore();
		});
		/*
		 * The top bar's room beside the one on the right, `--topright-w`, so a narrow column (an iPad
		 * upright with the panel open) never has the two overlap; with little room, `data-tight-top`
		 * drops the agent's kind so its name and the canvas's keep theirs.
		 */
		const fitChrome = () => {
			const right = document.querySelector<HTMLElement>(".v3-topright")?.offsetWidth ?? 0;
			document.documentElement.style.setProperty("--topright-w", `${right}px`);
			const column = workBox().w;
			document.querySelector(".app")?.toggleAttribute("data-tight-top", column - 32 - right < 340);
			// Short of width, the composer takes the column's whole width less its margins, rather than 64px less.
			document.querySelector(".app")?.toggleAttribute("data-narrow-dock", column < 640);
		};
		createEffect(() => {
			insets();
			viewWidth();
			if (insetsMoving()) return;
			fitChrome();
			float.restore();
		});
		if (typeof ResizeObserver !== "undefined") {
			const right = new ResizeObserver(() => fitChrome());
			queueMicrotask(() => {
				const bar = document.querySelector(".v3-topright");
				if (bar) right.observe(bar);
			});
			onCleanup(() => right.disconnect());
		}
		/* How tall the composer is, as a variable: the conversation pads its foot by it so the
		   last lines scroll clear of the bar (`v3.css`). Measured, because the bar grows with its text. */
		if (typeof ResizeObserver !== "undefined") {
			const publish = () => document.documentElement.style.setProperty("--dock-h", `${Math.round(dock.getBoundingClientRect().height)}px`);
			const watcher = new ResizeObserver(publish);
			watcher.observe(dock);
			publish();
			onCleanup(() => watcher.disconnect());
		}
		onCleanup(() => float.dispose());
	});
	return {
		dockCover,
		watchDock,
		/** The composer's box, for the frame to keep its tools clear of. */
		composerBox: () => dockEl?.querySelector<HTMLElement>(".composer-box") ?? undefined,
		unstow: () => unstowComposer(),
	};
}
