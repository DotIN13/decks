import type { DocChange, Splice } from "../index.ts";

/**
 * Where a suggestion shows on the page: the words it put in, and a ghost of the words it took out.
 *
 * A mark is kept in the page's own text and moved by every splice that lands after it, local or
 * remote, so a suggestion stays on its words while people type around it. Typing at either edge
 * of an inserted run is never taken into it: what a person types beside a suggestion is theirs.
 */
export type Mark =
	| { change: string; kind: "ins"; start: number; end: number }
	| { change: string; kind: "del"; at: number; text: string };

function point(p: number, s: Splice): number {
	if (p < s.at) return p;
	if (p >= s.at + s.before.length) return p + s.text.length - s.before.length;
	return s.at;
}

/** A run's start: past an insertion made exactly at it. */
function startOf(p: number, s: Splice): number {
	if (p < s.at) return p;
	if (p >= s.at + s.before.length) return p + s.text.length - s.before.length;
	return s.at + s.text.length;
}

/** A run's end: before an insertion made exactly at it. */
function endOf(p: number, s: Splice): number {
	if (p <= s.at) return p;
	if (p >= s.at + s.before.length) return p + s.text.length - s.before.length;
	return s.at;
}

/** Marks moved past one splice; a run whose words were all taken out goes with them. */
export function shiftMarks(marks: readonly Mark[], splice: Splice): Mark[] {
	const out: Mark[] = [];
	for (const mark of marks) {
		if (mark.kind === "del") out.push({ ...mark, at: point(mark.at, splice) });
		else {
			const start = startOf(mark.start, splice);
			const end = endOf(mark.end, splice);
			if (end > start) out.push({ ...mark, start, end });
		}
	}
	return out;
}

/** The marks of a change, from the splices that just applied it to the page's text. */
export function marksOf(change: string, applied: readonly Splice[]): Mark[] {
	let marks: Mark[] = [];
	for (const splice of applied) {
		marks = shiftMarks(marks, splice);
		if (splice.before) marks.push({ change, kind: "del", at: splice.at, text: splice.before });
		if (splice.text) marks.push({ change, kind: "ins", start: splice.at, end: splice.at + splice.text.length });
	}
	return marks;
}

/**
 * The marks of a change the page was not there to see arrive (it opened afterwards): each run of
 * new words looked for near where it was put. A run that is not found is not shown; the change
 * is still listed and can still be accepted or rejected.
 */
export function findMarks(change: DocChange, text: string): Mark[] {
	const marks: Mark[] = [];
	for (const splice of change.splices) {
		if (!splice.text) continue;
		let best = -1;
		for (let i = text.indexOf(splice.text); i !== -1; i = text.indexOf(splice.text, i + 1)) {
			if (best === -1 || Math.abs(i - splice.at) < Math.abs(best - splice.at)) best = i;
		}
		if (best !== -1) marks.push({ change: change.id, kind: "ins", start: best, end: best + splice.text.length });
	}
	return marks;
}

export type Segment = { text: string } | { text: string; mark: Mark };

/** The text cut into runs for drawing: plain words, inserted runs, and the ghosts between them. */
export function segments(text: string, marks: readonly Mark[]): Segment[] {
	const runs = marks
		.filter((m): m is Extract<Mark, { kind: "ins" }> => m.kind === "ins")
		.filter((m) => m.start < m.end && m.end <= text.length)
		.sort((a, b) => a.start - b.start);
	const ghosts = marks.filter((m): m is Extract<Mark, { kind: "del" }> => m.kind === "del" && m.at <= text.length).sort((a, b) => a.at - b.at);
	const out: Segment[] = [];
	let at = 0;
	let g = 0;
	const ghostsUpTo = (limit: number) => {
		while (g < ghosts.length && ghosts[g]!.at <= limit) {
			const ghost = ghosts[g++]!;
			if (ghost.at > at) {
				out.push({ text: text.slice(at, ghost.at) });
				at = ghost.at;
			}
			out.push({ text: "", mark: ghost });
		}
	};
	for (const run of runs) {
		if (run.start < at) continue;
		ghostsUpTo(run.start);
		if (run.start > at) out.push({ text: text.slice(at, run.start) });
		out.push({ text: text.slice(run.start, run.end), mark: run });
		at = run.end;
	}
	ghostsUpTo(text.length);
	if (at < text.length) out.push({ text: text.slice(at) });
	return out;
}

/** The one splice that turns `from` into `to`, placed where the caret says the typing was. */
export function spliceBetween(from: string, to: string, caret: number): Splice | undefined {
	if (from === to) return undefined;
	let head = 0;
	const max = Math.min(from.length, to.length);
	while (head < max && from.charCodeAt(head) === to.charCodeAt(head)) head++;
	// Typing "a" after an "a" matches either way: the caret says which one is new.
	const grown = to.length - from.length;
	if (grown > 0) head = Math.max(0, Math.min(head, caret - grown));
	let tail = 0;
	while (tail < max - head && from.charCodeAt(from.length - 1 - tail) === to.charCodeAt(to.length - 1 - tail)) tail++;
	return { at: head, before: from.slice(head, from.length - tail), text: to.slice(head, to.length - tail) };
}
