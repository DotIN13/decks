import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import {
	inView,
	loadPrefs,
	savePrefs,
	shouldNotify,
	shouldSound,
	type AlertKind,
	type AlertPrefs,
	type Presence,
} from "./policy.ts";
import { post as postBanner } from "./notify.ts";
import { play as playCue, preload as preloadCues } from "./sound.ts";

/** One thing worth interrupting somebody with. */
export interface AlertBanner {
	title: string;
	body?: string;
	tag?: string;
	/** The conversation it is about, so clicking the banner can switch to it. */
	agent?: string;
}

/** Whether the person is in front of this tab: visibility for tabs and minimising, focus for windows. */
function watchPresence(setPresence: (now: Presence) => void, looked: () => void): void {
	const sync = () => {
		const now = { visible: document.visibilityState === "visible", focused: document.hasFocus() };
		setPresence(now);
		if (inView(now)) looked();
	};
	sync();
	window.addEventListener("focus", sync);
	window.addEventListener("blur", sync);
	document.addEventListener("visibilitychange", sync);
	onCleanup(() => {
		window.removeEventListener("focus", sync);
		window.removeEventListener("blur", sync);
		document.removeEventListener("visibilitychange", sync);
	});
}

/** Fetch the configured cues on the first gesture, when the browser lets sound load. */
function warmCues(cues: () => Parameters<typeof preloadCues>[0]): void {
	const warm = () => preloadCues(cues());
	const events = ["pointerdown", "keydown", "touchstart"] as const;
	for (const name of events) window.addEventListener(name, warm, { once: true, passive: true });
	onCleanup(() => {
		for (const name of events) window.removeEventListener(name, warm);
	});
}

/**
 * What the app is allowed to interrupt you with: a cue, a banner, and a dot on the tab.
 */
export function createAlerts(deps: {
	/** A banner was clicked: show the conversation it is about (`agent`, when it names one). */
	open(agent: string | undefined): void;
	/** How many alerts landed since the person last looked: the tab's badge (`createTabBadge`). */
	badge?(count: number): void;
}) {
	const [prefs, setPrefsSignal] = createSignal<AlertPrefs>(loadPrefs());
	const setPrefs = (next: AlertPrefs) => {
		setPrefsSignal(next);
		savePrefs(next);
	};

	/** Whether the person is demonstrably in front of this tab. Two facts, not one. */
	const [presence, setPresence] = createSignal<Presence>({ visible: true, focused: true });
	/**
	 * How many alerts have landed since you last looked at this window.
	 */
	const [unattended, setUnattended] = createSignal(0);

	createEffect(() => deps.badge?.(unattended()));

	onMount(() => watchPresence(setPresence, () => setUnattended(0)));
	onMount(() => warmCues(() => Object.values(prefs().sound)));

	/**
	 * Raise one alert: the cue, the badge, and the banner only if you are elsewhere.
	 */
	const raise = (kind: AlertKind, banner: AlertBanner) => {
		const current = prefs();
		if (shouldSound(kind, current)) playCue(current.sound[kind], current.volume);
		const here = presence();
		if (!inView(here)) setUnattended((count) => count + 1);
		if (!shouldNotify(kind, current, here)) return;
		postBanner({
			title: banner.title,
			body: banner.body,
			tag: banner.tag,
			onClick: () => {
				setUnattended(0);
				// Clicking "Ada finished" and landing on somebody else's conversation is the one
				// way this can be actively unhelpful, so the click switches as well as focuses.
				deps.open(banner.agent);
			},
		});
	};

	return { prefs, setPrefs, raise };
}
