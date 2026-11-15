import type { PenDocument } from "@decks/pen";
import { untrack } from "solid-js";
import type { DocEdits } from "../render/types.ts";
import { forgetHistory, onTop, show, showOver, type DrawingRun } from "./edits.ts";

/** The host's drawing came: what it has of the person's edits is no longer shown on top of it. */
export function receive(d: DrawingRun, next: PenDocument, edits: DocEdits | undefined, madeHere: readonly string[] | undefined, at: string | undefined): void {
	const before = untrack(d.given);
	if (at !== d.scope) {
		// Another canvas: nothing on its way belongs to it.
		d.scope = at;
		for (const one of d.pending) clearTimeout(one.timer);
		d.pending = [];
		d.stepsAfter = [];
		d.setWaiting(0);
		forgetHistory(d);
	}
	const ours = (madeHere ?? []).map((id) => [id, d.sent.get(id)] as const).filter((one) => one[1] !== undefined);
	if (next === before && !ours.length) return;
	d.setGiven(next);
	const wasShown = untrack(d.doc);
	const hadPending = d.pending.length > 0;
	keepHistory(d, ours, before, next);
	if (ours.length) settle(d, new Set(ours.map(([id]) => id)));
	if (!hadPending && d.pending.length === 0) {
		d.setWaiting(0);
		// Nothing was shown ahead: the host's drawing as it gave it, with its own edits when they follow from what is shown.
		show(d, next, edits && edits.from === wasShown ? edits : undefined, false);
		return;
	}
	showOver(d, onTop(d, next));
}

/** What the host's history now holds of the person's: their own edit or step, or nothing safe. */
function keepHistory(d: DrawingRun, ours: ReadonlyArray<readonly [string, ReturnType<DrawingRun["sent"]["get"]>]>, before: PenDocument, next: PenDocument): void {
	if (!ours.length) {
		if (next !== before) forgetHistory(d);
		return;
	}
	for (const [, what] of ours) {
		if (what!.step && what!.change) {
			// The step that was shown is made: its entry now ends on the drawing the host gave.
			if (what!.step === "undo") what!.change.before = next;
			else what!.change.after = next;
		} else if (!what!.step) {
			const change = { before, after: next };
			d.history.undo.push(change);
			if (d.history.undo.length > d.depth) d.history.undo.shift();
			d.history.redo = [];
		}
	}
}

/**
 * The edits a drawing has, and every edit sent before the last of those: one call goes at a time, each
 * answered after the host made it, so a drawing with a later one has the earlier ones too, even where
 * its name was not passed on. Heard once: the same names again change nothing.
 */
function settle(d: DrawingRun, done: Set<string>): void {
	for (const id of done) d.sent.delete(id);
	const last = d.pending.findLastIndex((one) => done.has(one.as ?? one.id));
	const had = d.pending.filter((one, at) => done.has(one.as ?? one.id) || (at < last && one.as !== undefined && one.ops));
	for (const one of had) clearTimeout(one.timer);
	d.pending = d.pending.filter((one) => !had.includes(one));
}
