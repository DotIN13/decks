import { applySplice, transformSplices, type Splice } from "./index.ts";
import { diffArrays } from "diff";

/**
 * `@decks/docs/merge`: landing a page's edits on a text that may have moved since the page saw
 * it, and turning one text into another as splices.
 *
 * Pure functions over strings, so the whole of the merge rule can be tested without a file.
 */

/** Apply sequential splices, each checked; throws on the first whose `before` is not there. */
export function applySplices(text: string, splices: readonly Splice[]): string {
	let out = text;
	for (const splice of splices) {
		if (out.slice(splice.at, splice.at + splice.before.length) !== splice.before) throw new Error(`Splice at ${splice.at} does not match the text`);
		out = applySplice(out, splice);
	}
	return out;
}

/** Old text no shorter than this may be looked for when the history to move a splice was not kept. */
export const SEARCH_MIN = 8;

/** The occurrence of `needle` nearest to `near`, or -1. */
function nearest(text: string, needle: string, near: number): number {
	let best = -1;
	for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
		if (best === -1 || Math.abs(i - near) < Math.abs(best - near)) best = i;
		if (i > near) break;
	}
	return best;
}

export interface Landed {
	text: string;
	/** What was applied, in the server's text, sequential: what other pages are sent. */
	applied: Splice[];
	/** Indexes into the batch of the splices that did not land. */
	refused: number[];
}

/**
 * Land a page's batch, made on a text that has since had `concurrent` applied to it.
 *
 * Each splice is moved past the concurrent ones (`transformSplices`), and they past it, so the
 * next splice of the batch is moved through them in its own text. Overlaps merge, so with the
 * history kept nothing is refused. Without it (`concurrent` undefined: the page is older than
 * the kept log) a splice is looked for by its old text near where it was made, and refused when
 * that is too short to be sure of, or not there.
 */
export function land(text: string, batch: readonly Splice[], concurrent: readonly Splice[] | undefined): Landed {
	let current = text;
	let others: Splice[] | undefined = concurrent ? [...concurrent] : undefined;
	const applied: Splice[] = [];
	const refused: number[] = [];
	batch.forEach((splice, index) => {
		let pieces: Splice[] | undefined;
		if (others) {
			const moved = transformSplices([splice], others, true);
			pieces = moved.a;
			others = moved.b;
		} else if (splice.before.length >= SEARCH_MIN) {
			const at = nearest(current, splice.before, Math.min(current.length, splice.at));
			if (at !== -1) pieces = [{ at, before: splice.before, text: splice.text }];
		} else if (splice.before.length === 0 && splice.at <= current.length) {
			// A plain insertion with no history: where it was typed is the best there is.
			pieces = [splice];
		}
		if (!pieces || !pieces.every((piece, i) => matches(applyAll(current, pieces!.slice(0, i)), piece))) {
			refused.push(index);
			others = undefined;
			return;
		}
		for (const piece of pieces) {
			current = applySplice(current, piece);
			applied.push(piece);
		}
	});
	return { text: current, applied, refused };
}

function matches(text: string, splice: Splice): boolean {
	return splice.at <= text.length && text.slice(splice.at, splice.at + splice.before.length) === splice.before;
}

function applyAll(text: string, splices: readonly Splice[]): string {
	return splices.reduce(applySplice, text);
}


/**
 * The splices that turn `from` into `to`, sequential and in source order.
 *
 * Diffed by word rather than by character or line: a word keeps the diff fast, and a line would
 * make an agent's one-word change claim the whole line, so a person typing elsewhere on it would
 * collide with it. XML tags are words of their own, since a `document.xml` is one long line.
 */
export function spliceDiff(from: string, to: string): Splice[] {
	if (from === to) return [];
	// The common start and end are cut off first, so the diff only ever sees the part that moved.
	let head = 0;
	const max = Math.min(from.length, to.length);
	while (head < max && from.charCodeAt(head) === to.charCodeAt(head)) head++;
	let tail = 0;
	while (tail < max - head && from.charCodeAt(from.length - 1 - tail) === to.charCodeAt(to.length - 1 - tail)) tail++;
	// Back to a word boundary, so a hunk starts and ends on whole words.
	while (head > 0 && !BOUNDARY.test(from[head - 1]!)) head--;
	while (tail > 0 && !BOUNDARY.test(from[from.length - tail]!)) tail--;
	const a = tokens(from.slice(head, from.length - tail));
	const b = tokens(to.slice(head, to.length - tail));
	const out: Splice[] = [];
	let at = head;
	let before = "";
	let text = "";
	const flush = () => {
		if (before || text) {
			// A changed word keeps its unchanged letters: "small." to "small but reliable." is an insertion.
			let lead = 0;
			while (lead < before.length && lead < text.length && before[lead] === text[lead]) lead++;
			let end = 0;
			while (end < before.length - lead && end < text.length - lead && before[before.length - 1 - end] === text[text.length - 1 - end]) end++;
			// A word that came back exactly as it was is no change at all.
			if (lead < before.length - end || lead < text.length - end) out.push({ at: at + lead, before: before.slice(lead, before.length - end), text: text.slice(lead, text.length - end) });
		}
		at += text.length;
		before = "";
		text = "";
	};
	for (const part of diffArrays(a, b)) {
		const value = part.value.join("");
		if (part.removed) before += value;
		else if (part.added) text += value;
		else {
			flush();
			at += value.length;
		}
	}
	flush();
	return out;
}

const BOUNDARY = /[\s<>]/;

/** Tags, runs of space, and the words between them. */
function tokens(text: string): string[] {
	return text.match(/<[^>]*>|\s+|[^\s<]+/g) ?? [];
}

/** The splices that undo `splices`: each turned round, last first. */
export function invert(splices: readonly Splice[]): Splice[] {
	return [...splices].reverse().map((splice) => ({ at: splice.at, before: splice.text, text: splice.before }));
}

/**
 * Another writer's edits brought into a text that has its own: `theirs` and `ours` both came from
 * `base`, and what `theirs` changed is moved past what `ours` changed and applied to `ours`, with
 * `ours` kept where both touched the same words. An edit both made is taken once. `applied` is what
 * changed in `ours`, sequential, for a page to highlight.
 */
export function merge3(base: string, theirs: string, ours: string): { text: string; applied: Splice[] } {
	if (theirs === base) return { text: ours, applied: [] };
	if (ours === base) return { text: theirs, applied: spliceDiff(ours, theirs) };
	if (ours === theirs) return { text: ours, applied: [] };
	const placed = (splices: readonly Splice[]) => {
		let shift = 0;
		return splices.map((s) => {
			const out = { ...s, at: s.at - shift };
			shift += s.text.length - s.before.length;
			return out;
		});
	};
	const sequential = (splices: readonly Splice[]) => {
		let shift = 0;
		return splices.map((s) => {
			const out = { ...s, at: s.at + shift };
			shift += s.text.length - s.before.length;
			return out;
		});
	};
	const mine = spliceDiff(base, ours);
	const mineAt = new Set(placed(mine).map((s) => `${s.at}|${s.before}|${s.text}`));
	const theirsOnly = sequential(placed(spliceDiff(base, theirs)).filter((s) => !mineAt.has(`${s.at}|${s.before}|${s.text}`)));
	const moved = transformSplices(theirsOnly, mine, false).a;
	let text = ours;
	const applied: Splice[] = [];
	for (const splice of moved) {
		if (text.slice(splice.at, splice.at + splice.before.length) !== splice.before) continue;
		text = applySplice(text, splice);
		applied.push(splice);
	}
	return { text, applied };
}
