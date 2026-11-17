import { apply, baseTheme, type MeasureText, type PenDocument } from "@decks/pen";
import { createSignal, untrack } from "solid-js";
import { type Pending, type Change } from "./drawing.ts";

/** What `createPending` reads of `createDrawing` (`drawing.ts`). */
export interface PendingNeeds {
	readonly first: PenDocument;
	readonly look: () => "light" | "dark";
	readonly measure: MeasureText | undefined;
	readonly showOver: (next: PenDocument) => void;
}

/** Edits made here that the server has not confirmed: what is waiting, what is in flight, what they come to on top of what the server gave, and the history undo steps through. */
export function createPending(d: PendingNeeds) {
	/** The drawing as the host last gave it. */
	const [given, setGiven] = createSignal<PenDocument>(d.first);

	const [waiting, setWaiting] = createSignal(0);

	let scope: string | undefined;

	let pending: Pending[] = [];

	/*
	 * One call to the host at a time, when its `send` answers: edits made while one is on its way wait
	 * here (shown already, `as` unset) and go together as one call once it is answered, so a held arrow
	 * key is a few calls a second rather than thirty, each made after the one before it (an edit names
	 * where things end up, so two overtaking each other on the way would leave the earlier one's).
	 * `as` is the name an edit went under: the first of the edits sent together.
	 */
	let inFlight: string | undefined;

	let inFlightTimer: ReturnType<typeof setTimeout> | undefined;

	/** Steps asked for while edits were still to go: sent after them, in order. */
	let stepsAfter: Array<() => void> = [];

	const history: { undo: Change[]; redo: Change[] } = { undo: [], redo: [] };

	/** Names this page gave its edits and steps, recent ones, and what each was. */
	const sent = new Map<string, { step?: "undo" | "redo"; change?: Change }>();

	const tab = Math.random().toString(36).slice(2, 8);

	let named = 0;

	const nameOne = (what: { step?: "undo" | "redo"; change?: Change }) => {
		const id = `${tab}.${++named}`;
		sent.set(id, what);
		if (sent.size > 400) sent.delete(sent.keys().next().value!);
		return id;
	};

	const forgetHistory = () => {
		history.undo = [];
		history.redo = [];
	};

	/** The host's drawing with the edits still on their way on top; an edit that no longer applies is the host's to decide, and goes. */
	const onTop = (base: PenDocument): PenDocument => {
		let next = base;
		const kept: Pending[] = [];
		for (const one of pending) {
			if (one.to) {
				// A step is shown over the host's drawing it was taken from, and over no other.
				if (one.base === base && kept.length === 0) {
					next = one.to;
					kept.push(one);
				} else clearTimeout(one.timer);
				continue;
			}
			try {
				next = apply(next, one.ops as Parameters<typeof apply>[1], { theme: baseTheme(next, d.look()), ...(d.measure ? { measure: d.measure } : {}) }).doc;
				kept.push(one);
			} catch {
				clearTimeout(one.timer);
			}
		}
		pending = kept;
		setWaiting(kept.length);
		return next;
	};

	/** An edit on its way is no longer shown: made by now, refused, or given up on. */
	const drop = (id: string) => {
		const gone = pending.filter((one) => one.id === id || one.as === id);
		if (!gone.length) return;
		for (const one of gone) clearTimeout(one.timer);
		pending = pending.filter((one) => !gone.includes(one));
		setWaiting(pending.length);
		d.showOver(onTop(untrack(given)));
	};

	const wait = (id: string, ms: number) => setTimeout(() => drop(id), ms);

	return {
		sent,
		wait,
		drop,
		given,
		setWaiting,
		forgetHistory,
		setGiven,
		history,
		onTop,
		get inFlight() { return inFlight; },
		set inFlight(next) { inFlight = next; },
		get pending() { return pending; },
		set pending(next) { pending = next; },
		get stepsAfter() { return stepsAfter; },
		set stepsAfter(next) { stepsAfter = next; },
		get inFlightTimer() { return inFlightTimer; },
		set inFlightTimer(next) { inFlightTimer = next; },
		get scope() { return scope; },
		set scope(next) { scope = next; },
		nameOne,
		waiting,
	};
}
