import { createEffect, createSignal, onCleanup } from "solid-js";
import { storageKey } from "../connections/connection.ts";
import { state } from "../state/deck.ts";
import type { Tab } from "./kind.ts";
import { kindAt, kindOf } from "./kinds.ts";
import { camerasNow, front, openTab, restoreTabs, tabs } from "./tabs.ts";

/**
 * The row kept, and the window's address in step with it.
 *
 * **Kept**: the tabs open in this window, and the tab each conversation's camera is on, are
 * remembered for the deck, on this device (this browser's storage, per connection, as the cameras'
 * places on a canvas are): a reload, or the deck opened again tomorrow, finds the row as it was left
 * and each agent's chat on the tab it was on. Another deck has its own row.
 *
 * **The address**: the tab in front is named after `#`, as `#canvas/<name>`, `#card/<path>`,
 * `#doc/<path>` or `#app/<name>`; home has none. An address opened with one opens that tab, in front,
 * which is how a tab is opened in the browser's own tab, sent to someone on this deck, or bookmarked.
 */
const KEY = "decks.tabs:";

/** A tab's address in the window's, after `#`: its kind's word and its target, each part of a path its own. Home has none. */
export function addressOf(tab: Pick<Tab, "kind" | "target">): string {
	const word = kindOf(tab.kind)?.address;
	return tab.target === undefined || !word ? "" : `#${word}/${tab.target.split("/").map(encodeURIComponent).join("/")}`;
}

/** The tab an address names after `#`, when it names one of a kind there is. */
export function tabAt(hash: string): { kind: string; target: string } | undefined {
	const match = /^#([a-z]+)\/(.+)$/.exec(hash);
	const kind = match && kindAt(match[1]!);
	if (!match || !kind) return undefined;
	try {
		return { kind: kind.name, target: match[2]!.split("/").map(decodeURIComponent).join("/") };
	} catch {
		return undefined;
	}
}

/** This window's address with a tab's after `#`: what the browser's own tab opens for it. */
export const windowAddressOf = (tab: Pick<Tab, "kind" | "target">): string => `${location.pathname}${location.search}${addressOf(tab)}`;

interface Kept {
	tabs: Array<{ kind: string; target: string }>;
	/** The tab each conversation's camera is on, by agent id; one on home is left out. */
	cameras?: Record<string, string>;
}

function read(key: string): Kept {
	try {
		const kept = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<Kept> | null;
		const row = Array.isArray(kept?.tabs) ? kept.tabs.filter((one) => typeof one?.kind === "string" && typeof one?.target === "string" && !!kindOf(one.kind)) : [];
		const cameras = kept?.cameras && typeof kept.cameras === "object" ? Object.fromEntries(Object.entries(kept.cameras).filter(([, id]) => typeof id === "string")) : {};
		return { tabs: row, cameras };
	} catch {
		return { tabs: [] };
	}
}

/** Keep the row for the deck on screen and the address in step, from now on: called once, where the shell is made. */
export function rememberTabs(): void {
	/** The key of the deck whose row is in the window: nothing is kept until it has been read. */
	const [loaded, setLoaded] = createSignal<string>();
	const openAddressed = () => {
		const asked = tabAt(location.hash);
		if (asked) openTab(asked.kind, asked.target);
	};
	createEffect(() => {
		const deck = state.deck?.path;
		if (!deck) return;
		const key = `${KEY}${storageKey(deck)}`;
		if (loaded() === key) return;
		const kept = read(key);
		restoreTabs(kept.tabs, kept.cameras);
		setLoaded(key);
	});
	/*
	 * The address the page was opened with, once: it names the tab for the conversation on screen,
	 * which the page learns a moment after the deck, so it waits for one (a deck with no agent has none
	 * to wait for, and no tab is anyone's).
	 */
	let addressed = false;
	createEffect(() => {
		if (addressed || !loaded() || !state.focused) return;
		addressed = true;
		openAddressed();
	});
	createEffect(() => {
		const key = loaded();
		if (!key) return;
		const row = tabs().flatMap((tab) => (tab.target === undefined ? [] : [{ kind: tab.kind, target: tab.target }]));
		try {
			localStorage.setItem(key, JSON.stringify({ tabs: row, cameras: camerasNow() } satisfies Kept));
		} catch {
			/* a browser that keeps nothing: the row lasts as long as the page */
		}
		const address = addressOf(front());
		if (location.hash !== address) history.replaceState(history.state, "", `${location.pathname}${location.search}${address}`);
	});
	// The address changed by hand, or by a link to this page: the tab it names comes forward.
	addEventListener("hashchange", openAddressed);
	onCleanup(() => removeEventListener("hashchange", openAddressed));
}
