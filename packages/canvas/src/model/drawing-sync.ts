import type { Setter } from "solid-js";
import { type PenDocument } from "@decks/pen";
import { untrack, type Accessor } from "solid-js";
import { type DocEdits, together, type Pending, type Change, PENDING_MS } from "./drawing.ts";

/** What `createDrawingSync` reads of `createDrawing` (`drawing.ts`), each read when it is used. */
export interface DrawingSyncNeeds {
	readonly host: { send(ops: unknown[], edit?: string): void | Promise<boolean>; step(direction: "undo" | "redo", edit?: string): void; } | undefined;
	inFlight: string | undefined;
	pending: Pending[];
	stepsAfter: (() => void)[];
	readonly sent: Map<string, { step?: "undo" | "redo"; change?: Change; }>;
	readonly wait: (id: string, ms: number) => NodeJS.Timeout;
	inFlightTimer: NodeJS.Timeout | undefined;
	readonly drop: (id: string) => void;
	readonly given: Accessor<PenDocument>;
	scope: string | undefined;
	readonly setWaiting: Setter<number>;
	readonly forgetHistory: () => void;
	readonly setGiven: Setter<PenDocument>;
	readonly doc: Accessor<PenDocument>;
	readonly history: { undo: Change[]; redo: Change[]; };
	readonly depth: number;
	readonly show: (next: PenDocument, edits?: DocEdits, own?: boolean) => void;
	readonly showOver: (next: PenDocument) => void;
	readonly onTop: (base: PenDocument) => PenDocument;
}

export function createDrawingSync(d: DrawingSyncNeeds) {
	/** The edits waiting to go, sent as one call, when nothing is on its way; then any steps asked for after them. */
	const flush = () => {
		if (!d.host || d.inFlight) return;
		const going = d.pending.filter((one) => one.ops && !one.as);
		if (!going.length) {
			const steps = d.stepsAfter;
			d.stepsAfter = [];
			for (const step of steps) step();
			return;
		}
		const as = going[0]!.id;
		for (const one of going) {
			one.as = as;
			// Its name is the first's now: only that one is listened for.
			if (one.id !== as) d.sent.delete(one.id);
			clearTimeout(one.timer);
			one.timer = d.wait(as, PENDING_MS);
		}
		const answer = d.host.send(together(going.map((one) => one.ops!)), as);
		if (!answer || typeof (answer as Promise<boolean>).then !== "function") return flush();
		d.inFlight = as;
		const done = () => {
			if (d.inFlight !== as) return;
			d.inFlight = undefined;
			clearTimeout(d.inFlightTimer);
			flush();
		};
		// A call that never answers holds nothing up for longer than an edit is shown ahead.
		d.inFlightTimer = setTimeout(done, PENDING_MS);
		void (answer as Promise<boolean>).then(
			(ok) => {
				if (!ok) d.drop(as);
				else
					for (const one of d.pending)
						if (one.as === as) {
							// Made: the drawing that has it is on its way, however long the socket takes; given up on only after a while more.
							clearTimeout(one.timer);
							one.timer = d.wait(as, PENDING_MS);
						}
				done();
			},
			() => {
				d.drop(as);
				done();
			},
		);
	};

	/** The host's drawing came: what it has of the person's edits is no longer shown on top of it. */
	const receive = (next: PenDocument, edits: DocEdits | undefined, madeHere: readonly string[] | undefined, at: string | undefined) => {
		const before = untrack(d.given);
		if (at !== d.scope) {
			// Another canvas: nothing on its way belongs to it.
			d.scope = at;
			for (const one of d.pending) clearTimeout(one.timer);
			d.pending = [];
			d.stepsAfter = [];
			d.setWaiting(0);
			d.forgetHistory();
		}
		const ours = (madeHere ?? []).map((id) => [id, d.sent.get(id)] as const).filter((one) => one[1] !== undefined);
		if (next === before && !ours.length) return;
		d.setGiven(next);
		const wasShown = untrack(d.doc);
		const hadPending = d.pending.length > 0;
		// What the host's history now holds of the person's: their own edit or step, or nothing safe.
		if (!ours.length) {
			if (next !== before) d.forgetHistory();
		} else
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
		if (ours.length) {
			const done = new Set(ours.map(([id]) => id));
			// Heard once: a host that gives the same drawing again with the same names (`made` kept on it) changes nothing.
			for (const id of done) d.sent.delete(id);
			/*
			 * What it has, and every edit sent before the last of those: one call goes at a time, each
			 * answered after the host made it, so a drawing with a later one has the earlier ones too,
			 * even where its name was not passed on.
			 */
			const last = d.pending.findLastIndex((one) => done.has(one.as ?? one.id));
			const had = d.pending.filter((one, at) => done.has(one.as ?? one.id) || (at < last && one.as !== undefined && one.ops));
			for (const one of had) clearTimeout(one.timer);
			d.pending = d.pending.filter((one) => !had.includes(one));
		}
		if (!hadPending && d.pending.length === 0) {
			d.setWaiting(0);
			// Nothing was shown ahead: the host's drawing as it gave it, with its own edits when they follow from what is shown.
			d.show(next, edits && edits.from === wasShown ? edits : undefined, false);
			return;
		}
		d.showOver(d.onTop(next));
	};

	return {
		flush,
		receive,
	};
}
