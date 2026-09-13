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
} from "../lib/alerts.ts";
import { openHistory } from "../state/edge.ts";
import { post as postBanner } from "../lib/notify.ts";
import { play as playCue, preload as preloadCues } from "../lib/sound.ts";
import { state } from "../state/deck.ts";
import { setUnattended as paintBadge } from "./favicon.ts";

/** One thing worth interrupting somebody with. */
export interface AlertBanner {
	title: string;
	body?: string;
	tag?: string;
	/** The conversation it is about, so clicking the banner can switch to it. */
	agent?: string;
}

/**
 * What the app is allowed to interrupt you with: a cue, a banner, and a dot on the tab.
 *
 * This was 124 lines in the middle of `App.tsx`, between the socket's setup and its message
 * switch, and it is a subject of its own: the app has three ways of saying "something
 * happened" and **they are deliberately not the same condition**.
 *
 * - The **sound** plays whether or not you are looking, because being in the room is the
 *   common case for "it finished".
 * - The **badge on the tab** counts only what you have *not* seen, and coming back to the
 *   window is looking.
 * - The **banner** is suppressed while the page is in view: an OS notification over a window
 *   you are reading tells you something already on your screen.
 *
 * The policy is in `lib/alerts.ts` and the settings are the user's; what lives here is the
 * live half — the stored prefs as a signal, whether the person is actually present (two
 * facts, not one), the counter, and the one function that raises an alert.
 */
export function createAlerts(deps: {
	/** Clicking a banner switches to the conversation it is about. */
	focusAgent(id: string): void;
}) {
	/**
	 * What the app is allowed to interrupt you with.
	 *
	 * Held as a signal here rather than in `lib/alerts.ts` because Settings has to redraw
	 * when it changes and a module-level `let` is not reactive. The module owns the *rules*
	 * and the shape of what is stored; this owns the copy the components read.
	 */
	const [prefs, setPrefsSignal] = createSignal<AlertPrefs>(loadPrefs());
	const setPrefs = (next: AlertPrefs) => {
		setPrefsSignal(next);
		savePrefs(next);
	};

	/** Whether the person is demonstrably in front of this tab. Two facts, not one. */
	const [presence, setPresence] = createSignal<Presence>({ visible: true, focused: true });
	/**
	 * How many alerts have landed since you last looked at this window.
	 *
	 * Not the same number as any agent's unread count, and deliberately: unread is about a
	 * *conversation* and survives switching tabs, while this is about the *window* and is
	 * cleared by coming back to it. Coming back is looking.
	 */
	const [unattended, setUnattended] = createSignal(0);

	createEffect(() => paintBadge(unattended()));

	onMount(() => {
		const sync = () => {
			const now = { visible: document.visibilityState === "visible", focused: document.hasFocus() };
			setPresence(now);
			if (inView(now)) setUnattended(0);
		};
		sync();
		/*
		 * Three listeners, because the two facts move independently: `visibilitychange` fires
		 * for switching tabs and for minimising, and `focus`/`blur` for moving to another
		 * window with this tab still on screen. A banner is wrong in both cases and only one
		 * of the events covers each.
		 */
		window.addEventListener("focus", sync);
		window.addEventListener("blur", sync);
		document.addEventListener("visibilitychange", sync);
		onCleanup(() => {
			window.removeEventListener("focus", sync);
			window.removeEventListener("blur", sync);
			document.removeEventListener("visibilitychange", sync);
		});
	});

	/*
	 * Fetch the three configured cues on the first gesture.
	 *
	 * Not at mount: a cue is ~8kB and this is the least important thing on the page, so it
	 * should not be competing with the deck for the first paint. On the first real interaction
	 * it is free, and it is well before an agent can have finished anything. Over the network
	 * the alternative is a first "it finished" that lands a round trip after you have looked.
	 */
	onMount(() => {
		const warm = () => preloadCues(Object.values(prefs().sound));
		const events = ["pointerdown", "keydown", "touchstart"] as const;
		for (const name of events) window.addEventListener(name, warm, { once: true, passive: true });
		onCleanup(() => {
			for (const name of events) window.removeEventListener(name, warm);
		});
	});

	/**
	 * Raise one alert: the cue, the badge, and — only if you are elsewhere — the banner.
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
				if (banner.agent && banner.agent !== state.focused) deps.focusAgent(banner.agent);
				openHistory();
			},
		});
	};

	return { prefs, setPrefs, raise };
}
