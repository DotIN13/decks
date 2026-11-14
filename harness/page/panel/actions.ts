import { createSignal, onCleanup, onMount } from "solid-js";
import { insetsOnly } from "@decks/canvas/camera";
import { FOLDED_KEY, foldedOf, TAB_KEY, tabOf, toggled, type PanelTab } from "./model.ts";
import { clampPanelWidth, loadPanelWidth, PANEL_WIDTH, savePanelWidth } from "./panel-width.ts";

// The side panel's behaviour: its width, set by dragging or arrowing its edge
// and kept; the tab last shown and the folders folded, kept in this browser.

const keep = (key: string, value: string) => {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Private mode: it opens as it did before next time.
	}
};
const kept = (key: string) => {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
};

export function createPanelTab() {
	const [tab, setRaw] = createSignal<PanelTab>(tabOf(kept(TAB_KEY)));
	const setTab = (next: PanelTab) => (setRaw(next), keep(TAB_KEY, next));
	const [folded, setFolded] = createSignal<Set<string>>(foldedOf(kept(FOLDED_KEY)));
	const toggleFolder = (id: string) => {
		const next = toggled(folded(), id);
		setFolded(next);
		keep(FOLDED_KEY, JSON.stringify([...next]));
	};
	return { tab, setTab, folded, toggleFolder };
}

/** One drag of the edge: the width follows the pointer, and ends however the button comes up. */
function dragEdge(event: PointerEvent, width: () => number, resizeTo: (next: number) => void, setResizing: (on: boolean) => void): void {
	const handle = event.currentTarget as HTMLElement;
	const from = width();
	const start = event.clientX;
	event.preventDefault();
	try {
		handle.setPointerCapture(event.pointerId);
	} catch {
		// A synthetic event has no pointer to capture.
	}
	setResizing(true);
	document.documentElement.dataset.panelResizing = "true";
	const shell = handle.closest<HTMLElement>(".panel-shell");
	const beside = shell?.parentElement ? [...shell.parentElement.children].filter((one): one is HTMLElement => one !== shell && one instanceof HTMLElement) : [];
	insetsOnly(() => beside);
	const state = { done: false };
	const move = (moved: PointerEvent) => (moved.pointerType === "mouse" && moved.buttons === 0 ? end() : resizeTo(from + moved.clientX - start));
	const end = () => {
		if (state.done) return;
		state.done = true;
		for (const [name, fn] of [["pointermove", move], ["pointerup", end], ["pointercancel", end]] as const) window.removeEventListener(name, fn as EventListener, true);
		window.removeEventListener("blur", end);
		handle.removeEventListener("lostpointercapture", end);
		try {
			handle.releasePointerCapture(event.pointerId);
		} catch {
			// Already released.
		}
		setResizing(false);
		delete document.documentElement.dataset.panelResizing;
		insetsOnly(undefined);
		savePanelWidth(width());
	};
	for (const [name, fn] of [["pointermove", move], ["pointerup", end], ["pointercancel", end]] as const) window.addEventListener(name, fn as EventListener, true);
	window.addEventListener("blur", end);
	handle.addEventListener("lostpointercapture", end);
}

export function createPanelWidth() {
	const [width, setWidth] = createSignal(clampPanelWidth(loadPanelWidth(), window.innerWidth));
	const [resizing, setResizing] = createSignal(false);
	const resizeTo = (next: number) => setWidth(clampPanelWidth(next, window.innerWidth));
	onMount(() => {
		const onResize = () => setWidth(clampPanelWidth(loadPanelWidth(), window.innerWidth));
		window.addEventListener("resize", onResize);
		onCleanup(() => window.removeEventListener("resize", onResize));
	});
	const onHandleDown = (event: PointerEvent) => event.button === 0 && dragEdge(event, width, resizeTo, setResizing);
	const onHandleKey = (event: KeyboardEvent) => {
		const step = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
		if (event.key === "Home") resizeTo(PANEL_WIDTH);
		else if (step !== 0) resizeTo(width() + step);
		else return;
		event.preventDefault();
		savePanelWidth(width());
	};
	const reset = () => (resizeTo(PANEL_WIDTH), savePanelWidth(width()));
	return { width, resizing, onHandleDown, onHandleKey, reset };
}
