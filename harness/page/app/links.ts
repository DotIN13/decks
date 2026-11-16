import type { Page } from "../state/types/index.ts";
import { createEffect, createSignal } from "solid-js";
import { boxOf, canvasBox, fitInto } from "@decks/canvas/camera";
import { moveCamera } from "../state/camera.ts";
import { setState, state } from "../state/deck.ts";
import { act, stageOnScreen } from "../state/decks.ts";
import { notice } from "../state/notices.ts";
import { setSelected } from "../state/selection.ts";
import { call, warnIfFailed } from "../state/line.ts";

// Flying the camera to cards: framing a list of them, framing one once the server has placed it,
// and following a link from one card to another, placed beside it.

/*
 * Frame these cards, whatever they are: the camera moves to hold them all.
 *
 * A function over a list rather than one card, because the two things that fly — a row in
 * the rail, and a card a link on another card opened (below) — want the same arithmetic,
 * and a list is also what an agent's `decks.view.focus` on several cards asks for.
 *
 * `animate` is what the two of them ask for and nothing else does: after a link or a press a
 * camera that *arrives* says which way it went, where a camera that jumps leaves you to work
 * out how the card you are now looking at relates to the one you were. a fit stays
 * instant, because a keyboard shortcut is a hand and a chat switch is a change of context.
 */
export const flyToPages = (boards: Page[], options?: { animate?: boolean }) => {
	if (boards.length === 0) return;
	const stage = document.querySelector(".stage, iframe.canvas-frame");
	if (!stage) return;
	const view = { width: stage.clientWidth, height: stage.clientHeight };
	moveCamera(fitInto(boards.map(boxOf), view, canvasBox(view)), options);
};

export const flyTo = (board: Page) => {
	setSelected(board.path);
	flyToPages([board], { animate: true });
};

/**
 * Put a card on the canvas and fly to it — **after** the server has said where it landed.
 *
 * A card joining a canvas is placed beside the cards already on it (`server/canvas/place.ts`), so the
 * place it had a moment ago is not where it will be: on a deck this app has been used on for a
 * while, every card carries a place from the old deck-wide layout, hundreds of thousands of
 * pixels down. Flying to the card as it is *now* would land the camera on empty canvas and
 * leave the card off screen, which is the bug this fixes rather than a race worth ignoring.
 *
 * So the flight waits for two frames from the server, in the order they are sent: the deck
 * state, which carries the new place, and the context, which says the card is on the canvas.
 */
export function createFraming(onCanvasNow: () => Page[]) {
	const [framing, setFraming] = createSignal<{ path: string; asked: number } | undefined>();
	/** Fly to a card once the server has placed it and put it on the canvas. */
	const frameWhenPlaced = (path: string) => setFraming({ path, asked: Date.now() });
	const playAndFrame = (path: string) => {
		if (!onCanvasNow().some((one) => one.path === path)) void call("item.insert", { item: { type: "card", card: path }, ...onScreen() }).then(warnIfFailed);
		frameWhenPlaced(path);
	};
	createEffect(() => {
		const wanted = framing();
		if (!wanted) return;
		/* Given up on after ten seconds, so a card that never arrives cannot fly the camera
		   somewhere a minute later, when the person is reading something else. */
		if (Date.now() - wanted.asked > 10_000) {
			setFraming(undefined);
			return;
		}
		if (!onCanvasNow().some((one) => one.path === wanted.path)) return;
		const board = state.pages.find((one) => one.path === wanted.path);
		if (!board) return;
		setFraming(undefined);
		flyTo(board);
	});
	return { frameWhenPlaced, playAndFrame };
}

/**
 * A link **on a card** that points at another card — the app's half of it.
 *
 * Returns whether the deck had that card, because the card itself cannot open one: the
 * canvas is the app's to arrange. A path the deck does not hold is a broken link, and the
 * one answer that is any use is saying so.
 *
 * **Placed, not stacked.** A card that arrives on top of the one the reader is reading is
 * a card they then have to drag apart; so it lands to the right of the link's own card.
 * Only when it is not already on the canvas: a card the user put somewhere is theirs, and
 * following a link is not a reason to move it.
 *
 * **The camera goes to the card that was asked for, and only to it.** It used to frame the
 * pair, on the argument that a card arriving beside another is only useful if you can see
 * that it did. What that costs is the thing the link was followed for: two cards side by
 * side fit at half the zoom of one, which on a laptop is under `LIVE_ZOOM` — the card
 * lands too small to read and too small to click into. Where it sits is answerable by
 * zooming out; text too small to read is not answerable at all.
 */
export const openLinkedPage = (path: string, from: string): boolean => {
	if (!state.pages.some((one) => one.path === path)) {
		notice("warn", `No board at ${path} — the link points at something this deck does not have.`);
		return false;
	}
	/*
	 * A link names the library file (`../../../boards/x.html` from a canvas's copy), and the canvas
	 * shows its own copy of it (`canvases/<canvas>/boards/x.html`): the copy is what moves, is
	 * selected and is flown to, once the canvas has one.
	 */
	const rest = path.replace(/^boards\//, "");
	const playing = () => (state.focused ? state.agents[state.focused]?.inPlay ?? [] : []);
	const onCanvas = () => playing().find((one) => one === path || (one.startsWith("canvases/") && one.split("/").slice(2).join("/") === `boards/${rest}`));
	const opening = !onCanvas();
	const land = (at: string) => {
		const board = state.pages.find((one) => one.path === at);
		const source = state.pages.find((one) => one.path === from);
		if (opening && source) move(at, source.x + source.w + 32, source.y);
		setSelected(at);
		const placed = state.pages.find((one) => one.path === at) ?? board;
		if (placed) flyToPages([placed], { animate: true });
	};
	const there = onCanvas();
	if (there) {
		land(there);
		return true;
	}
	void call("item.insert", { item: { type: "card", card: path }, ...onScreen() }).then(warnIfFailed);
	// The server copies the card into the canvas; it is landed when the copy arrives.
	const started = performance.now();
	const wait = () => {
		const copy = onCanvas();
		if (copy && state.pages.some((one) => one.path === copy)) return land(copy);
		if (performance.now() - started < 4000) setTimeout(wait, 60);
	};
	wait();
	return true;
};

const move = (path: string, x: number, y: number) => {
	// Optimistic, and in place: the card is already where it was dropped, and the
	// server's answer confirms it. Replacing the object here would re-create the
	// row and reload the document that is sitting in it.
	const index = state.pages.findIndex((board) => board.path === path);
	if (index >= 0) setState("pages", index, { x, y });
	void act("item.move", { id: path, at: { x, y }, ...onScreen() });
};

/** The canvas on screen, as a call's option. */
const onScreen = () => {
	const canvas = stageOnScreen();
	return canvas ? { canvas } : {};
};
