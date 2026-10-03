import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import { resetDeck } from "../state/deck.ts";
import { resetPens } from "../state/pens.ts";
import { resetStages } from "../state/stages.ts";
import { resetPatches } from "../state/patches.ts";
import { resetHistory } from "../state/history.ts";
import { resetToolResults } from "../chat/tool-results.ts";
import { resetTaken } from "../canvas/shots/adaptors.ts";
import { scratch } from "../state/agent.ts";
import { setComponent, setMarks, setMode, setSelected } from "../state/selection.ts";
import { setDrawing, setInkSelection } from "../state/ink.ts";
import { setPenSelection, setPenTool } from "../state/pen-tools.ts";
import { setCommenting } from "../state/comments.ts";
import { setFocus, setPicking, setPresenting, setSettings } from "../state/ui.ts";
import { stop } from "../state/socket.ts";
import { setBackend, setPairing } from "./backend.ts";
import { readAddress } from "./connection.ts";
import { prepare, warm } from "./worker.ts";

/**
 * Moving the open page to another backend without loading it again.
 *
 * The app is unmounted, the stores that live outside it are emptied of what the last backend said,
 * and it is mounted again: its socket opens to the new backend and the greeting fills everything
 * in, as on a first load. The page itself, its code, its fonts, the CanvasKit it already compiled
 * and the panel as you left it stay, so a switch is the canvas and the conversations reloading
 * rather than a white page.
 *
 * `index.tsx` hands over what to mount (`setMount`); this file is the only one that unmounts it.
 */
let target: HTMLElement | undefined;
/** What belongs on the page: the app, or the start page with why (`index.tsx`). */
let pick: (failed: string | undefined) => JSX.Element = () => null;
let dispose: (() => void) | undefined;

/** Where to mount and what: from `index.tsx`, once. */
export function setMount(root: HTMLElement, choose: (failed: string | undefined) => JSX.Element): void {
	target = root;
	pick = choose;
}

/** Forget the last backend, everywhere outside the app's own component. */
function forget(): void {
	stop();
	resetDeck();
	resetPens();
	resetStages();
	resetPatches();
	resetHistory();
	resetToolResults();
	resetTaken();
	scratch.clear();
	setBackend(undefined);
	setPairing({ paired: [] });
	setSelected(undefined);
	setComponent(undefined);
	setMarks([]);
	setMode("browse");
	setDrawing(false);
	setInkSelection(undefined);
	setPenSelection([]);
	setPenTool("select");
	setCommenting(undefined);
	setFocus(undefined);
	setPicking(undefined);
	setPresenting(undefined);
	setSettings(false);
}

/**
 * Mount the page for the connection the tab is on: unmount what is there, forget the last backend,
 * get the way to the new one ready (`worker.ts`), and mount again. Also the first mount, from
 * `index.tsx`, where there is nothing yet to forget.
 */
export async function remount(move?: () => void): Promise<void> {
	if (dispose) {
		dispose();
		dispose = undefined;
		forget();
	}
	/*
	 * The tab's connection changes only now, with nothing mounted: every address the old view builds
	 * follows it (`api()`), and changed earlier, the old view would have asked the new backend for
	 * its own boards in the moment before it went.
	 */
	move?.();
	// Ready already when the switch came from the switcher (`reach`) or `warm` ran: nothing to wait on.
	const failed = await prepare();
	if (!target) return;
	const root = target;
	dispose = render(() => pick(failed), root);
	warm();
}

/**
 * The back and forward buttons move between connections as well. Only a change of `c` remounts:
 * the app's own routes are in the hash, and moving between those is not a change of backend.
 */
let shown = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("c");
export function noteShown(): void {
	shown = new URLSearchParams(location.search).get("c");
}
if (typeof window !== "undefined") {
	window.addEventListener("popstate", () => {
		const now = new URLSearchParams(location.search).get("c");
		if (now === shown) return;
		shown = now;
		void remount(readAddress);
	});
}
