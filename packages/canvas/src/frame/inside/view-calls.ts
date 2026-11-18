import type { Backend } from "./backend.ts";
import { type CanvasHandle } from "../../view/types.ts";
import { type FrameEnd } from "../protocol.ts";
import { type FramePage } from "../protocol.ts";
import { type Start } from "../protocol.ts";
import type { Accessor } from "solid-js";
import { untrack } from "solid-js";
import type { Page, Camera, StageCall } from "@decks/protocol";
import { runViewCall } from "../../camera/view-ops.ts";
import { cardShot } from "../../items/card-surface.tsx";
import { handsOn } from "../../camera/touched.ts";
import type { FrameContext } from "./boot.ts";

/** What `createViewCalls` reads of `wireFrame` (`events.ts`), each read when it is used. */
export interface ViewCallsNeeds {
	readonly pages: Accessor<FramePage[]>;
	readonly agent: Accessor<string | undefined>;
	readonly start: Start;
	readonly moveTo: (to: Camera, animate?: boolean) => void;
	readonly ctx: FrameContext;
	readonly selectCard: (path: string | undefined) => void;
	readonly end: FrameEnd;
	readonly handle: CanvasHandle;
	readonly backend: Backend;
}

export function createViewCalls(d: ViewCallsNeeds) {
	/*
	 * An agent's `decks view …` on this canvas, from the stream: carried out as the page carries it out
	 * for a canvas it holds (`view-ops.ts`), and answered to the harness.
	 */
	const viewCall = (call: StageCall) => {
		if (call.op === "shot") return void shootCard(call);
		let value: unknown;
		try {
			value = runViewCall(call, {
				boards: () => untrack(d.pages) as Page[],
				viewport: () => ({ width: innerWidth, height: innerHeight }),
				focused: () => untrack(d.agent),
				canvasOnScreen: () => d.start.canvas.name,
				setCamera: (to, options) => d.moveTo(to, options?.animate),
				handsOn,
				offerView: (from, to, selected, what) => d.ctx.setOffer({ agent: from, what, go: () => {
					d.moveTo(to, true);
					d.selectCard(selected);
					d.ctx.setOffer(undefined);
				} }),
				// An agent on screen moving to another canvas while the person is using this one: the page moves it when they press Go.
				offerGoto: (from, canvas) => d.ctx.setOffer({ agent: from, what: "canvas", go: () => {
					d.end.emit("goto", { agent: from, canvas });
					d.ctx.setOffer(undefined);
				} }),
				// Kept by the page with the views it parks (`camera/landing.ts`): it arrives when that chat opens.
				rememberView: (id, to, selected) => d.end.emit("camera", { camera: to, agent: id, ...(selected ? { selected } : {}) }),
				select: d.selectCard,
				reload: (path) => d.handle.reloadCard(path),
				cursor: (at) => {
					if (!at) {
						d.ctx.setCursor(null);
						return true;
					}
					// The card by its path as the canvas has it, or by its end (a path given from the canvas's own folder).
					const page = untrack(d.pages).find((one) => one.path === at.path) ?? untrack(d.pages).find((one) => at.path.endsWith(one.path) || one.path.endsWith(at.path));
					if (!page) return false;
					d.ctx.setCursor({ ...at, path: page.path });
					return true;
				},
			});
		} catch (error) {
			value = { error: error instanceof Error ? error.message : String(error) };
		}
		d.backend.answer(call.id, value);
	};

	/*
	 * A card as the person has it now, for an agent's `decks canvas screenshot` of it (`stage.call` op
	 * `shot`): its live root written out (`card-snapshot.ts`) and drawn by the harness's Chrome, so the
	 * picture has what they typed, scrolled and drew in it. `none` when the card is not mounted here, and
	 * the harness takes its own picture from the file.
	 */
	const NONE_AFTER = 1500;

	const shootCard = async (call: StageCall) => {
		const path = (call.args as { path?: unknown } | undefined)?.path;
		let value: unknown;
		try {
			const shot = typeof path === "string" ? cardShot(path) : undefined;
			if (typeof path !== "string" || !shot) {
				/*
				 * Said a moment later: the first answer is the one taken, and another tab showing this canvas
				 * may have the card awake.
				 */
				await new Promise((done) => setTimeout(done, NONE_AFTER));
				value = { how: "none", why: "the card is not awake on the person's canvas" };
			} else {
				const drawn = await d.backend.snapshot(path, shot);
				value = "data" in drawn ? { how: "snapshot", ...drawn } : { how: "none", why: drawn.why };
			}
		} catch (error) {
			value = { how: "none", why: error instanceof Error ? error.message : String(error) };
		}
		d.backend.answer(call.id, value);
	};

	return {
		viewCall,
	};
}
