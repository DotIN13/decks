// Presenting: the canvas alone, full screen, with the chrome hidden until Escape or leaving full screen.
import { createSignal, onCleanup, onMount } from "solid-js";

/** Present: the canvas alone, full screen. Escape, or leaving full screen, brings the chrome back. */
export function createPresenting() {
	const [presenting, setPresenting] = createSignal(false);
	const present = () => {
		setPresenting(true);
		void document.documentElement.requestFullscreen?.().catch(() => {});
	};
	onMount(() => {
		const keys = (event: KeyboardEvent) => {
			if (event.key === "Escape" && presenting()) setPresenting(false);
		};
		const left = () => {
			if (!document.fullscreenElement) setPresenting(false);
		};
		window.addEventListener("keydown", keys);
		document.addEventListener("fullscreenchange", left);
		onCleanup(() => {
			window.removeEventListener("keydown", keys);
			document.removeEventListener("fullscreenchange", left);
		});
	});
	return { presenting, present };
}
