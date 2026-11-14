import { createSignal, onCleanup, onMount } from "solid-js";
import { TICK } from "./model.ts";

// The usage panel's behaviour: a clock that ticks every 30 s for "resets in",
// the span of the uses (a day or a week), and Escape to close.

export function createUsage(onClose: () => void) {
	const [now, setNow] = createSignal(Date.now());
	const [span, setSpan] = createSignal<"day" | "week">("day");
	onMount(() => {
		const timer = setInterval(() => setNow(Date.now()), TICK);
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			onClose();
		};
		window.addEventListener("keydown", onKey);
		onCleanup(() => {
			clearInterval(timer);
			window.removeEventListener("keydown", onKey);
		});
	});
	return { now, span, setSpan };
}
