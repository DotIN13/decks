import { createSignal, onCleanup, onMount } from "solid-js";
import { notice } from "../../state/index.ts";
import type { FieldRef } from "../bar/actions.ts";
import { startRecording, type Recording } from "./voice.ts";

// Voice as the composer runs it: a recording started and stopped from the mic or Ctrl+M,
// its words put in at the caret.

/** Voice: the mic records, and what was said goes in at the caret when it stops. */
export function createVoice(field: FieldRef) {
	const [recording, setRecording] = createSignal<Recording | undefined>();
	const [listening, setListening] = createSignal(false);
	const [transcribing, setTranscribing] = createSignal(false);
	const [levels, setLevels] = createSignal<number[]>([]);
	const [heard, setHeard] = createSignal({ settled: "", pending: "" });
	const [since, setSince] = createSignal(0);
	const [now, setNow] = createSignal(0);
	let clock: ReturnType<typeof setInterval> | undefined;
	const stopClock = () => {
		clearInterval(clock);
		clock = undefined;
		setListening(false);
		setLevels([]);
		setHeard({ settled: "", pending: "" });
	};
	const start = async () => {
		if (listening() || transcribing()) return;
		setListening(true);
		try {
			const started = await startRecording({ onLevel: (level) => setLevels((was) => [...was.slice(-47), level]), onHeard: (settled, pending) => setHeard({ settled, pending }) });
			setRecording(started);
			setSince(Date.now());
			setNow(Date.now());
			clock = setInterval(() => setNow(Date.now()), 250);
		} catch (error) {
			stopClock();
			notice("warn", (error as Error).message);
		}
	};
	const stop = async () => {
		const running = recording();
		if (!running) return;
		setRecording(undefined);
		stopClock();
		setTranscribing(true);
		try {
			const words = await running.stop();
			if (words) {
				field.api?.focus();
				field.api?.insertText(words);
			}
		} catch (error) {
			notice("warn", (error as Error).message);
		} finally {
			setTranscribing(false);
		}
	};
	const cancel = () => {
		recording()?.cancel();
		setRecording(undefined);
		stopClock();
	};
	return { recording, listening, transcribing, levels, heard, since, now, start, stop, cancel };
}

/** Ctrl+M starts and stops the recording anywhere; Escape throws only the recording away. */
export function voiceKeys(voice: ReturnType<typeof createVoice>): void {
	onMount(() => {
		const key = (event: KeyboardEvent) => {
			if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "m") {
				event.preventDefault();
				void (voice.recording() ? voice.stop() : voice.start());
			} else if (event.key === "Escape" && voice.recording()) {
				event.preventDefault();
				event.stopPropagation();
				voice.cancel();
			}
		};
		document.addEventListener("keydown", key, true);
		onCleanup(() => {
			document.removeEventListener("keydown", key, true);
			voice.cancel();
		});
	});
}
