import { m } from "@decks/i18n";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { storageKey } from "../connections/connection.ts";
import { state } from "../state/deck.ts";
import { offer } from "../state/notices.ts";
import type { Tab } from "./kind.ts";
import { kindAt, kindOf } from "./kinds.ts";
import { stageOf, stages } from "../state/canvases.ts";
import { aimCanvas, front, openTab, restoreTabs, rowNow } from "./tabs.ts";

/** The canvas each conversation's camera was last seen on, or was put on by this page: what a canvases frame is news against. */
const seen = new Map<string, string>();

/**
 * This page moved a conversation's camera to a canvas itself (`app/person.ts`, `moveConversation`).
 * The harness's word of it comes a moment later and is no news: taken for a move then, it put the
 * canvas in front over a card the person had picked in that moment.
 */
export const movedHere = (agent: string, canvas: string): void => void seen.set(agent, canvas);

/**
 * The row kept, and the window's address in step with it.
 *
 * **Kept**: the tabs open in this window, and the tab each conversation's camera is on, are
 * remembered for the deck, on this device (this browser's storage, per connection, as the cameras'
 * places on a canvas are): a reload, or the deck opened again tomorrow, finds the row as it was left
 * and each agent's chat on the tab it was on. Another deck has its own row.
 *
 * **The address**: a card, a document or an app in front is named after `#`, as `#card/<path>`,
 * `#doc/<path>` or `#app/<name>`; with a canvas in front the address is plain, since which canvas a
 * chat's camera is on is the harness's to keep. An address opened with a tab after `#`
 * (`#canvas/<name>` too) puts the camera of the chat on screen on that tab, which is how a tab is
 * opened in the browser's own tab, sent to someone on this deck, or bookmarked.
 */
const KEY = "decks.tabs:";

/** A tab's address in the window's, after `#`: its kind's word and its target, each part of a path its own. None for a chat with no canvas. */
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
	/** The tab the page's address named when it was opened, until it has been opened: read now, before the address is put in step with the row. */
	let opening = tabAt(location.hash);
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
	const [addressed, setAddressed] = createSignal(opening === undefined);
	createEffect(() => {
		if (addressed() || !loaded() || !state.focused) return;
		if (opening) openTab(opening.kind, opening.target);
		opening = undefined;
		setAddressed(true);
	});
	createEffect(() => {
		const key = loaded();
		if (!key) return;
		try {
			localStorage.setItem(key, JSON.stringify(rowNow() satisfies Kept));
		} catch {
			/* a browser that keeps nothing: the row lasts as long as the page */
		}
		// Not before the tab the address came with has been opened: it would be written over.
		if (!addressed()) return;
		// A canvas in front is where the chat's camera is, which the harness keeps: the address stays plain, as it always was.
		const address = front().kind === "canvas" ? "" : addressOf(front());
		if (location.hash !== address) history.replaceState(history.state, "", `${location.pathname}${location.search}${address}`);
	});
	/*
	 * A conversation's camera moved to another canvas (its agent's own `view goto` or `view focus`,
	 * the person on another device): it is on that canvas, with no card, document or app left over it.
	 * Not at the first sight of where each one is, which is no move; and not a move this page made,
	 * which said what is in front when it made it (`movedHere`).
	 */
	/*
	 * When this window was last used. A move made elsewhere does not take a canvas from under someone
	 * working here: the chat's camera is shared by every window and device, and the canvas switched four
	 * times under one person, once with Settings open. In a window used in the last half minute the move
	 * is offered (Follow); an idle window follows, as before. A move during the agent's own turn is the
	 * agent showing what it was asked to (`view goto`), and is followed.
	 */
	let usedAt = 0;
	const used = () => (usedAt = Date.now());
	for (const type of ["pointerdown", "keydown", "wheel"] as const) addEventListener(type, used, { capture: true, passive: true });
	onCleanup(() => {
		for (const type of ["pointerdown", "keydown", "wheel"] as const) removeEventListener(type, used, { capture: true });
	});
	const moved = (agent: string, canvas: string) => {
		const working = state.chats.find((chat) => chat.id === agent)?.state !== "idle";
		if (agent !== state.focused || working || Date.now() - usedAt > 30_000) return aimCanvas(agent);
		offer(m.tabs_moved_elsewhere({ canvas }), { label: m.tabs_follow(), run: () => aimCanvas(agent) }, `moved:${agent}`);
	};
	createEffect(() => {
		for (const stage of stages()) {
			for (const agent of stage.agents) {
				/*
				 * Where the page takes the agent to be (`stageOf`), which during a move this page made is
				 * where it is going: a canvases frame sent before the harness had moved it still lists it on
				 * the canvas it left, and read as it is, that frame and the next were two moves.
				 */
				const now = stageOf(agent.id)?.name ?? stage.name;
				const was = seen.get(agent.id);
				seen.set(agent.id, now);
				if (was !== undefined && was !== now) moved(agent.id, stages().find((one) => one.name === now)?.title ?? now);
			}
		}
	});
	// The address changed by hand, or by a link to this page: the tab it names comes forward.
	addEventListener("hashchange", openAddressed);
	onCleanup(() => removeEventListener("hashchange", openAddressed));
}
