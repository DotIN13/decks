import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { SECTION_KEY, sectionOf, type Section } from "./model.ts";

// The Settings window's behaviour: the section open, kept in this browser;
// Escape closes it; on a phone the open tab carries the mark and scrolls in.

export function createWindow(props: { phone?: boolean; onClose: () => void }) {
	const [section, setSection] = createSignal<Section>(sectionOf(read()));
	const open = (id: Section) => {
		setSection(id);
		try {
			localStorage.setItem(SECTION_KEY, id);
		} catch {
			// Private mode: it opens on Notifications next time.
		}
	};
	onMount(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			props.onClose();
		};
		window.addEventListener("keydown", onKey);
		onCleanup(() => window.removeEventListener("keydown", onKey));
	});
	const tabs = { el: undefined as HTMLDivElement | undefined };
	const [mark, setMark] = createSignal<{ left: number; width: number }>();
	createEffect(
		on([section, () => props.phone], () => {
			if (!props.phone) return;
			queueMicrotask(() => {
				const one = tabs.el?.querySelector<HTMLElement>(`[data-section="${section()}"]`);
				if (!tabs.el || !one) return;
				setMark({ left: one.offsetLeft, width: one.offsetWidth });
				tabs.el.scrollTo({ left: Math.max(0, one.offsetLeft - (tabs.el.clientWidth - one.offsetWidth) / 2), behavior: "smooth" });
			});
		}),
	);
	return { section, open, tabs, mark };
}

function read(): string | null {
	try {
		return localStorage.getItem(SECTION_KEY);
	} catch {
		return null;
	}
}
