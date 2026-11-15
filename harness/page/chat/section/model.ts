import type { AgentState } from "@decks/protocol";
import { isWorking, workingWords } from "../status/model.ts";

/** Where this device remembers the conversation's height, and whether it was folded. */
export const CHAT_HEIGHT_KEY = "decks.chatHeight";
export const CHAT_FOLDED_KEY = "decks.chatFolded";

/** What an agent is doing, said after its name: "running tools…", "waiting for you", or nothing. */
export function stateWords(state: AgentState, name: string): string | undefined {
	if (state === "waiting") return "waiting for you";
	const words = workingWords(state, name);
	return words && isWorking(state) ? words : undefined;
}

/** A dragged height, kept between 120 px and 160 px short of the panel's own height. */
export function clampHeight(h: number, panelHeight: number | undefined): number {
	const most = panelHeight !== undefined ? panelHeight - 160 : 900;
	return Math.round(Math.max(120, Math.min(most, h)));
}

/** What a key on the resize handle does: a 16 px step, Home for the panel's own split, or nothing. */
export function keyStep(key: string): number | "reset" | undefined {
	if (key === "Home") return "reset";
	if (key === "ArrowUp") return 16;
	if (key === "ArrowDown") return -16;
	return undefined;
}

type Box = { top: number; right: number; bottom: number; left: number };

/** The clip the phone's sheet opens from: the pill's shape, inside the sheet's box. */
export function revealInset(from: Box, to: Box): string {
	const top = Math.max(0, from.top - to.top);
	const right = Math.max(0, to.right - from.right);
	const bottom = Math.max(0, to.bottom - from.bottom);
	const left = Math.max(0, from.left - to.left);
	return `inset(${top}px ${right}px ${bottom}px ${left}px round 17px)`;
}

/** The speed of a drag over its recent moves, in px per ms. */
export function dragSpeed(recent: ReadonlyArray<{ y: number; t: number }>): number {
	const first = recent[0]!;
	const last = recent[recent.length - 1]!;
	return (last.y - first.y) / Math.max(1, last.t - first.t);
}

/** A sheet let go goes away when dragged past a quarter of its height, or flicked down. */
export function sheetGoes(dy: number, height: number, speed: number, cancelled: boolean): boolean {
	return !cancelled && (dy > height / 4 || (speed > 0.4 && dy > 24));
}

/** How the sheet leaves: on at the finger's speed, easing out off the screen. */
export function sheetFling(dy: number, height: number, speed: number): { off: number; ms: number; easing: string } {
	const off = height + 120;
	const remaining = Math.max(1, off - dy);
	const fling = Math.max(0, speed);
	const ms = Math.min(420, Math.max(180, (remaining / Math.max(fling, 0.9)) * 1.4));
	const lift = Math.min(1, (0.25 * fling * ms) / remaining);
	return { off, ms, easing: `cubic-bezier(0.25, ${lift.toFixed(3)}, 0.45, 1)` };
}

/** The words on the fold control, for the sheet, a folded section and an open one. */
export function foldWords(state: { sheet?: boolean; folded: boolean }): { tip: string; label: string } {
	const label = state.folded ? "Show the conversation" : "Fold the conversation";
	return { tip: state.sheet ? "Back into the pill" : label, label };
}
