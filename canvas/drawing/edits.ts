import { apply, baseTheme, diff, withDecksColors, type MeasureText, type PenDocument, type PenEdit } from "@decks/pen";
import { untrack, type Accessor, type Setter } from "solid-js";
import type { DocEdits } from "../render/types.ts";

// The person's edits: applied at once, sent to the host, shown over its drawing until it has
// them, and undone and redone.

/**
 * How long the person's edit is shown ahead of the host's drawing that has it, at most: a host that
 * never says it has it (an older server) or loses it shows its own drawing after this. Counted again
 * from the host's answer to the call that sent it, since the drawing comes by another way (the socket)
 * and may be behind other messages.
 */
export const PENDING_MS = 6000;

/** The host a drawing's edits go to (`DrawingOptions.host`). */
export type DrawingHost = { send(ops: unknown[], edit?: string): void | Promise<boolean>; step(direction: "undo" | "redo", edit?: string): void };

/**
 * The person's edits sent and not yet in a drawing the host gave, oldest first: an edit's ops, or a
 * step's drawing (`to`, what the step makes of `base`, the host's drawing it was taken from).
 */
export type Pending = { id: string; ops?: unknown[]; to?: PenDocument; base?: PenDocument; timer?: ReturnType<typeof setTimeout>; as?: string };
/**
 * The person's steps through their own edits, as the host's drawings before and after each (the
 * host keeps the real history; this is to show a step ahead of its answer). Only what this page
 * saw end to end: any other change to the host's drawing empties it, as it makes the host refuse.
 */
export type Change = { before: PenDocument; after: PenDocument };

/** What `createDrawing` holds, handed to each of its steps. */
export interface DrawingRun {
	look: () => "light" | "dark";
	depth: number;
	measure?: MeasureText;
	readOnly?: boolean;
	onEdits?: (edits: PenEdit[], doc: PenDocument) => void;
	doc: Accessor<PenDocument>;
	setDoc: Setter<PenDocument>;
	/** The person's own edits, to step back and forward through: each entry is the document before (undo) or after (redo). */
	undoStack: PenDocument[];
	redoStack: PenDocument[];
	/** What made the drawing now from the one before, when known: `to` is the drawing they made. */
	made?: DocEdits & { to: PenDocument };
	/** The drawing the person's own edit or step last made: shown at once, by their hand, so it is nothing to glide. */
	ownDoc?: PenDocument;
	// ---- a drawing the host owns: the person's edits shown ahead of its answer ----
	host?: DrawingHost;
	/** The drawing as the host last gave it. */
	given: Accessor<PenDocument>;
	setGiven: Setter<PenDocument>;
	waiting: Accessor<number>;
	setWaiting: Setter<number>;
	scope?: string;
	pending: Pending[];
	/*
	 * One call to the host at a time, when its `send` answers: edits made while one is on its way wait
	 * in `pending` (shown already, `as` unset) and go together as one call once it is answered, so a held
	 * arrow key is a few calls a second rather than thirty, each made after the one before it.
	 * `as` is the name an edit went under: the first of the edits sent together.
	 */
	inFlight?: string;
	inFlightTimer?: ReturnType<typeof setTimeout>;
	/** Steps asked for while edits were still to go: sent after them, in order. */
	stepsAfter: Array<() => void>;
	history: { undo: Change[]; redo: Change[] };
	/** Names this page gave its edits and steps, recent ones, and what each was. */
	sent: Map<string, { step?: "undo" | "redo"; change?: Change }>;
	tab: string;
	named: number;
}

// The person's edit: applied at once, sent, held on top until the host has it
/** Pen operations, as the person's edit: applied, kept for undo, reported. False when refused or a no-op. */
export function edit(d: DrawingRun, given: unknown[]): boolean {
	if (d.readOnly || given.length === 0) return false;
	// What the tools make is coloured by the drawing's own light/dark variables: defined here when it lacks them.
	const ops = withDecksColors(untrack(d.doc), given);
	const prev = untrack(d.doc);
	if (d.host) {
		let next: PenDocument | undefined;
		try {
			next = applied(d, prev, ops);
		} catch {
			// Not one this page can make: the host's to answer, as it always was.
			next = undefined;
		}
		if (!next) {
			d.host.send(ops);
			return true;
		}
		const id = nameOne(d, {});
		d.pending.push({ id, ops });
		d.setWaiting(d.pending.length);
		// Shown at once, even when nothing changed: the stage waits for the drawing that answers its gesture.
		show(d, next, { from: prev, edits: diff(prev, next) });
		flush(d);
		return true;
	}
	let next: PenDocument;
	try {
		next = applied(d, prev, ops);
	} catch (error) {
		console.warn("[canvas] an edit was refused:", error instanceof Error ? error.message : error);
		return false;
	}
	if (!commit(d, prev, next)) {
		// Nothing changed (an item dropped back where it was), but the stage waits for a drawing that
		// answers its gesture, as a server sends one whatever the edit did: a fresh copy is that answer.
		show(d, { ...prev }, { from: prev, edits: [] });
		return false;
	}
	d.undoStack.push(prev);
	if (d.undoStack.length > d.depth) d.undoStack.shift();
	d.redoStack.length = 0;
	return true;
}

/**
 * `ops` applied to `prev` as the server applies them; throws when refused. The arrows an edit
 * touches are routed by the stage engine as it lays the edit out (`reroute_after`), as the server
 * routes them, so the page lays nothing out for them here.
 */
export const applied = (d: DrawingRun, prev: PenDocument, ops: unknown[]) => apply(prev, ops as Parameters<typeof apply>[1], { theme: baseTheme(prev, d.look()), ...(d.measure ? { measure: d.measure } : {}) }).doc;

/** Show `next` and tell the host what changed. */
function commit(d: DrawingRun, prev: PenDocument, next: PenDocument): boolean {
	const edits = diff(prev, next);
	if (edits.length === 0) return false;
	show(d, next, { from: prev, edits });
	d.onEdits?.(edits, next);
	return true;
}

export function nameOne(d: DrawingRun, what: { step?: "undo" | "redo"; change?: Change }): string {
	const id = `${d.tab}.${++d.named}`;
	d.sent.set(id, what);
	if (d.sent.size > 400) d.sent.delete(d.sent.keys().next().value!);
	return id;
}

/** The edits waiting to go, sent as one call, when nothing is on its way; then any steps asked for after them. */
function flush(d: DrawingRun): void {
	const host = d.host;
	if (!host || d.inFlight) return;
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
		one.timer = wait(d, as, PENDING_MS);
	}
	const answer = host.send(together(going.map((one) => one.ops!)), as);
	if (!answer || typeof (answer as Promise<boolean>).then !== "function") return flush(d);
	d.inFlight = as;
	const done = () => {
		if (d.inFlight !== as) return;
		d.inFlight = undefined;
		clearTimeout(d.inFlightTimer);
		flush(d);
	};
	// A call that never answers holds nothing up for longer than an edit is shown ahead.
	d.inFlightTimer = setTimeout(done, PENDING_MS);
	void (answer as Promise<boolean>).then(
		(ok) => {
			if (!ok) drop(d, as);
			else
				for (const one of d.pending)
					if (one.as === as) {
						// Made: the drawing that has it is on its way, however long the socket takes; given up on only after a while more.
						clearTimeout(one.timer);
						one.timer = wait(d, as, PENDING_MS);
					}
			done();
		},
		() => {
			drop(d, as);
			done();
		},
	);
}

/**
 * Edits made one after another, as one list of ops: run after run of plain updates (what the arrow keys,
 * a colour or a board's move write) folded into one update an item, each field as the last set it, and
 * anything else kept as it was, in order.
 */
export function together(edits: readonly (readonly unknown[])[]): unknown[] {
	const ops = edits.flat();
	const out: unknown[] = [];
	/** The updates since the last op that was not one, by item. */
	let run = new Map<string, { op: "update"; id: string; set: Record<string, unknown> }>();
	for (const op of ops) {
		const update = op as { op?: unknown; id?: unknown; set?: unknown };
		const plain = update.op === "update" && typeof update.id === "string" && update.set && typeof update.set === "object" && Object.keys(update).length === 3;
		if (!plain) {
			run = new Map();
			out.push(op);
			continue;
		}
		const held = run.get(update.id as string);
		if (held) Object.assign(held.set, update.set);
		else {
			const one = { op: "update" as const, id: update.id as string, set: { ...(update.set as Record<string, unknown>) } };
			run.set(one.id, one);
			out.push(one);
		}
	}
	return out;
}

const wait = (d: DrawingRun, id: string, ms: number) => setTimeout(() => drop(d, id), ms);

/** An edit on its way is no longer shown: made by now, refused, or given up on. */
export function drop(d: DrawingRun, id: string): void {
	const gone = d.pending.filter((one) => one.id === id || one.as === id);
	if (!gone.length) return;
	for (const one of gone) clearTimeout(one.timer);
	d.pending = d.pending.filter((one) => !gone.includes(one));
	d.setWaiting(d.pending.length);
	showOver(d, onTop(d, untrack(d.given)));
}

// What is shown: the host's drawing with the person's edits on top
export function show(d: DrawingRun, next: PenDocument, edits?: DocEdits, own = true): void {
	d.made = edits ? { ...edits, to: next } : undefined;
	d.ownDoc = own ? next : undefined;
	d.setDoc(next);
}

/** Show `next` in place of what is shown, with what changed between them for the stage. */
export function showOver(d: DrawingRun, next: PenDocument): void {
	const now = untrack(d.doc);
	show(d, next, { from: now, edits: next === now ? [] : diff(now, next) });
}

/** The host's drawing with the edits still on their way on top; an edit that no longer applies is the host's to decide, and goes. */
export function onTop(d: DrawingRun, base: PenDocument): PenDocument {
	let next = base;
	const kept: Pending[] = [];
	for (const one of d.pending) {
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
	d.pending = kept;
	d.setWaiting(kept.length);
	return next;
}

// Undo and redo
export function step(d: DrawingRun, direction: "undo" | "redo"): void {
	const host = d.host;
	if (host) {
		const base = untrack(d.given);
		const stack = direction === "undo" ? d.history.undo : d.history.redo;
		const change = stack[stack.length - 1];
		// Shown ahead only when this page saw the edit it steps through and nothing else since.
		if (!d.pending.length && change && (direction === "undo" ? change.after : change.before) === base) {
			stack.pop();
			(direction === "undo" ? d.history.redo : d.history.undo).push(change);
			const to = direction === "undo" ? change.before : change.after;
			const id = nameOne(d, { step: direction, change });
			d.pending.push({ id, to, base, timer: wait(d, id, PENDING_MS) });
			d.setWaiting(d.pending.length);
			showOver(d, to);
			host.step(direction, id);
			return;
		}
		// After the edits still to go, which the host's history has to have first.
		if (d.inFlight || d.pending.some((one) => one.ops && !one.as)) d.stepsAfter.push(() => host.step(direction));
		else host.step(direction);
		return;
	}
	const from = direction === "undo" ? d.undoStack : d.redoStack;
	const to = direction === "undo" ? d.redoStack : d.undoStack;
	const target = from.pop();
	if (!target) return;
	const now = untrack(d.doc);
	to.push(now);
	commit(d, now, target);
}

export function forgetHistory(d: DrawingRun): void {
	d.history.undo = [];
	d.history.redo = [];
}
